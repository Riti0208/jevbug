/**
 * DecisionProvider backed by Jev (typesafe-ai/jev-latest) over HTTP (browser:
 * fetch('/api/jev'); Node/CLI: an in-process transport — see api/_lib/jev.ts).
 *
 * All Jev-specific wire building/parsing lives in jevState.ts / jevProtocol.ts.
 * This file owns batching, caching, concurrency, retries, the circuit breaker
 * and the fallback path. It must NEVER throw out of decideBatch — every
 * request gets a result, real or fallback.
 */
import type {
  ActionDecision,
  Bug,
  BugPerception,
  DecisionRequest,
  DecisionResult,
  SignalDecision,
  SignalDefinition,
} from '../types';
import type { DecisionProvider, DecisionProviderOptions } from './DecisionProvider';
import { uniformActionDecision, uniformSignalDecision } from './DecisionProvider';
import { answersToDecisions, stateCacheKey, toWireRequest } from './jevState';
import type { JevBatchRequest, JevBatchResponse, JevTransport, JevWireRequest } from './jevProtocol';
import { JEV_LIMITS } from './jevProtocol';

const MAX_RECENT_MEMORY = 10;

export interface JevProviderStats {
  requests: number;
  answered: number;
  cacheHits: number;
  fallbacks: number;
  errors: number;
  lastError: string | null;
  avgLatencyMs: number;
  circuitOpen: boolean;
  inputTokens: number;
  outputTokens: number;
}

export interface JevDecisionProviderOptions {
  /** Defaults to `createFetchTransport(endpoint)`. */
  transport?: JevTransport;
  endpoint?: string;
  /** Defaults to a local uniform-random provider. */
  fallback?: DecisionProvider;
  /** Parallel HTTP batches. */
  concurrency?: number;
  /** Bugs per HTTP batch. */
  batchSize?: number;
  /** LRU cache of identical states, keyed by stateCacheKey. Default true, max 5000 entries. */
  cache?: boolean;
  /** Per-batch timeout. */
  timeoutMs?: number;
  circuitBreaker?: { failureThreshold?: number; cooldownMs?: number };
  onStats?: (stats: JevProviderStats) => void;
}

/** A tiny local uniform fallback — deliberately not the other engineer's RandomDecisionProvider. */
class UniformFallbackProvider implements DecisionProvider {
  readonly name = 'fallback:uniform';

  async decideBatch(requests: DecisionRequest[]): Promise<DecisionResult[]> {
    return requests.map((req) => ({
      bugId: req.bugId,
      action: uniformActionDecision(),
      signal: uniformSignalDecision(),
      source: this.name,
    }));
  }

  async decideAction(): Promise<ActionDecision> {
    return uniformActionDecision();
  }

  async decideSignal(): Promise<SignalDecision> {
    return uniformSignalDecision();
  }
}

/** Simple insertion-order LRU (Map preserves insertion order; re-set on hit to bump recency). */
class LruCache<V> {
  private readonly map = new Map<string, V>();
  constructor(private readonly maxSize: number) {}

  get(key: string): V | undefined {
    const v = this.map.get(key);
    if (v === undefined) return undefined;
    this.map.delete(key);
    this.map.set(key, v);
    return v;
  }

  set(key: string, value: V): void {
    if (this.map.has(key)) this.map.delete(key);
    this.map.set(key, value);
    if (this.map.size > this.maxSize) {
      const oldest = this.map.keys().next();
      if (!oldest.done) this.map.delete(oldest.value);
    }
  }
}

type CachedDecision = { action: ActionDecision; signal: SignalDecision };

interface FetchGroup {
  key: string;
  wireReq: JevWireRequest;
  indices: number[];
}

/** Delay helper — a plain setTimeout so it plays well with vitest fake timers. */
function delay(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

export function createFetchTransport(endpoint = '/api/jev', fetchImpl: typeof fetch = fetch): JevTransport {
  return async (batch: JevBatchRequest, signal?: AbortSignal): Promise<JevBatchResponse> => {
    const res = await fetchImpl(endpoint, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify(batch),
      signal,
    });
    if (!res.ok) {
      let message = `Jev request failed with status ${res.status}`;
      try {
        const body = (await res.json()) as { error?: string };
        if (body && typeof body.error === 'string' && body.error.length > 0) message = body.error;
      } catch {
        // ignore body parse failures, keep the status-based message
      }
      throw new Error(message);
    }
    return (await res.json()) as JevBatchResponse;
  };
}

export class JevDecisionProvider implements DecisionProvider {
  readonly name = 'jev';

  private readonly transport: JevTransport;
  private readonly fallback: DecisionProvider;
  private readonly concurrency: number;
  private readonly batchSize: number;
  private readonly cacheEnabled: boolean;
  private readonly cache: LruCache<CachedDecision>;
  private readonly timeoutMs: number;
  private readonly failureThreshold: number;
  private readonly cooldownMs: number;
  private readonly onStats?: (stats: JevProviderStats) => void;

  private signalDefinitions: SignalDefinition[] = [
    { signal: 'A', id: 'A', displayName: 'A' },
    { signal: 'B', id: 'B', displayName: 'B' },
  ];
  private memoryMode: 'WITH_MEMORY' | 'NO_MEMORY' = 'WITH_MEMORY';

  private breakerFailures = 0;
  private breakerOpenUntil = 0;
  private readonly disposeController = new AbortController();

  private stats: JevProviderStats = {
    requests: 0,
    answered: 0,
    cacheHits: 0,
    fallbacks: 0,
    errors: 0,
    lastError: null,
    avgLatencyMs: 0,
    circuitOpen: false,
    inputTokens: 0,
    outputTokens: 0,
  };
  private latencySum = 0;
  private latencyCount = 0;

  constructor(options: JevDecisionProviderOptions = {}) {
    this.transport = options.transport ?? createFetchTransport(options.endpoint ?? '/api/jev');
    this.fallback = options.fallback ?? new UniformFallbackProvider();
    this.concurrency = Math.max(1, options.concurrency ?? 2);
    this.batchSize = Math.max(1, options.batchSize ?? 32);
    this.cacheEnabled = options.cache ?? true;
    this.cache = new LruCache<CachedDecision>(5000);
    this.timeoutMs = options.timeoutMs ?? 20_000;
    this.failureThreshold = options.circuitBreaker?.failureThreshold ?? 3;
    this.cooldownMs = options.circuitBreaker?.cooldownMs ?? 15_000;
    this.onStats = options.onStats;
  }

  configure(options: DecisionProviderOptions): void {
    this.signalDefinitions = options.signalDefinitions;
    this.memoryMode = options.memoryMode;
  }

  async decideBatch(requests: DecisionRequest[]): Promise<DecisionResult[]> {
    const n = requests.length;
    const results: DecisionResult[] = new Array(n);
    if (n === 0) return results;
    this.stats.requests += n;

    if (this.isBreakerOpen()) {
      await this.resolveFallbacks(requests, results, requests.map((_, i) => ({ idx: i, reason: 'circuit-open' })));
      this.emitStats();
      return results;
    }

    const groups = new Map<string, number[]>();
    for (let i = 0; i < n; i++) {
      const key = stateCacheKey(toWireRequest(requests[i], this.signalDefinitions).state);
      let g = groups.get(key);
      if (!g) {
        g = [];
        groups.set(key, g);
      }
      g.push(i);
    }

    const toFetch: FetchGroup[] = [];
    for (const [key, indices] of groups) {
      const cached = this.cacheEnabled ? this.cache.get(key) : undefined;
      if (cached) {
        for (const idx of indices) {
          results[idx] = { bugId: requests[idx].bugId, action: cached.action, signal: cached.signal, source: 'jev:cache' };
        }
        this.stats.cacheHits += indices.length;
        this.stats.answered += indices.length;
        continue;
      }
      toFetch.push({ key, wireReq: toWireRequest(requests[indices[0]], this.signalDefinitions), indices });
    }

    const pending: { idx: number; reason: string }[] = [];

    if (toFetch.length > 0) {
      const chunkSize = Math.max(1, Math.min(this.batchSize, JEV_LIMITS.maxRequestsPerBatch));
      const chunks: FetchGroup[][] = [];
      for (let i = 0; i < toFetch.length; i += chunkSize) chunks.push(toFetch.slice(i, i + chunkSize));

      await this.runWithConcurrency(chunks, async (chunk) => {
        await this.processChunk(chunk, requests, results, pending);
      });
    }

    await this.resolveFallbacks(requests, results, pending);
    this.emitStats();
    return results;
  }

  async decideAction(bug: Bug, perception: BugPerception): Promise<ActionDecision> {
    const [result] = await this.decideBatch([this.toDecisionRequest(bug, perception)]);
    return result.action;
  }

  async decideSignal(bug: Bug, perception: BugPerception): Promise<SignalDecision> {
    const [result] = await this.decideBatch([this.toDecisionRequest(bug, perception)]);
    return result.signal;
  }

  getStats(): JevProviderStats {
    return { ...this.stats, avgLatencyMs: this.latencyCount > 0 ? this.latencySum / this.latencyCount : 0, circuitOpen: this.isBreakerOpen() };
  }

  dispose(): void {
    this.disposeController.abort();
  }

  // ---- internals ----

  /**
   * Thin single-bug convenience wrapper (spec: "Default impls wrap decideBatch").
   * It has no access to per-tick memory analytics, so it sends no recent-experience
   * summary and only the bug's own raw recent memory (capped), or nothing under
   * NO_MEMORY. The simulation's real per-tick path should build DecisionRequest
   * objects itself and call decideBatch directly.
   */
  private toDecisionRequest(bug: Bug, perception: BugPerception): DecisionRequest {
    const noMemory = this.memoryMode === 'NO_MEMORY';
    return {
      bugId: bug.id,
      tick: 0,
      creature: { energy: bug.energy, fear: bug.fear, age: bug.age, generation: bug.generation, carryingFood: bug.carryingFood },
      traits: bug.traits,
      perception,
      signalExperience: null,
      recentMemory: noMemory ? null : bug.memory.slice(-MAX_RECENT_MEMORY),
    };
  }

  private isBreakerOpen(): boolean {
    return this.breakerOpenUntil !== 0 && Date.now() < this.breakerOpenUntil;
  }

  private recordBreakerFailure(): void {
    this.breakerFailures++;
    if (this.breakerFailures >= this.failureThreshold) {
      this.breakerOpenUntil = Date.now() + this.cooldownMs;
    }
  }

  private recordBreakerSuccess(): void {
    this.breakerFailures = 0;
    this.breakerOpenUntil = 0;
  }

  private emitStats(): void {
    this.onStats?.(this.getStats());
  }

  private async runWithConcurrency<T>(items: T[], fn: (item: T) => Promise<void>): Promise<void> {
    let idx = 0;
    const workerCount = Math.min(this.concurrency, items.length);
    const workers = Array.from({ length: workerCount }, async () => {
      while (idx < items.length) {
        const i = idx++;
        await fn(items[i]);
      }
    });
    await Promise.all(workers);
  }

  private async callTransportOnce(batch: JevBatchRequest): Promise<JevBatchResponse> {
    const controller = new AbortController();
    const onAbort = () => controller.abort();
    if (this.disposeController.signal.aborted) controller.abort();
    else this.disposeController.signal.addEventListener('abort', onAbort);
    const timer = setTimeout(() => controller.abort(), this.timeoutMs);
    try {
      return await this.transport(batch, controller.signal);
    } finally {
      clearTimeout(timer);
      this.disposeController.signal.removeEventListener('abort', onAbort);
    }
  }

  private async callTransportWithRetry(batch: JevBatchRequest): Promise<JevBatchResponse> {
    try {
      return await this.callTransportOnce(batch);
    } catch {
      await delay(500);
      return this.callTransportOnce(batch);
    }
  }

  private async processChunk(
    chunk: FetchGroup[],
    requests: DecisionRequest[],
    results: DecisionResult[],
    pending: { idx: number; reason: string }[],
  ): Promise<void> {
    const batch: JevBatchRequest = { requests: chunk.map((g) => g.wireReq) };
    let response: JevBatchResponse;
    try {
      response = await this.callTransportWithRetry(batch);
    } catch (err) {
      for (const g of chunk) for (const idx of g.indices) pending.push({ idx, reason: 'transport-error' });
      this.stats.errors += 1;
      this.stats.lastError = err instanceof Error ? err.message : String(err);
      this.recordBreakerFailure();
      return;
    }
    this.recordBreakerSuccess();

    const byId = new Map(response.results.map((r) => [r.id, r]));
    for (const g of chunk) {
      const r = byId.get(g.wireReq.id);
      if (!r || r.error) {
        for (const idx of g.indices) pending.push({ idx, reason: r?.error ? 'jev-error' : 'no-answer' });
        this.stats.errors += 1;
        if (r?.error?.message) this.stats.lastError = r.error.message;
        continue;
      }
      const decoded = answersToDecisions(r.answers, this.signalDefinitions);
      if (!decoded) {
        for (const idx of g.indices) pending.push({ idx, reason: 'decode-error' });
        this.stats.errors += 1;
        continue;
      }
      if (this.cacheEnabled) this.cache.set(g.key, decoded);
      if (r.usage) {
        this.stats.inputTokens += r.usage.inputTokens ?? 0;
        this.stats.outputTokens += r.usage.outputTokens ?? 0;
      }
      if (typeof r.latencyMs === 'number') {
        this.latencySum += r.latencyMs;
        this.latencyCount += 1;
      }
      let first = true;
      for (const idx of g.indices) {
        results[idx] = { bugId: requests[idx].bugId, action: decoded.action, signal: decoded.signal, source: first ? 'jev' : 'jev:cache' };
        first = false;
      }
      this.stats.answered += g.indices.length;
      // Duplicates within this same batch shared one live Jev call — count them as cache hits too.
      if (g.indices.length > 1) this.stats.cacheHits += g.indices.length - 1;
    }
  }

  private async resolveFallbacks(
    requests: DecisionRequest[],
    results: DecisionResult[],
    pending: { idx: number; reason: string }[],
  ): Promise<void> {
    if (pending.length === 0) return;
    const reqs = pending.map((p) => requests[p.idx]);
    let decisions: DecisionResult[];
    try {
      decisions = await this.fallback.decideBatch(reqs);
    } catch {
      decisions = reqs.map((r) => ({ bugId: r.bugId, action: uniformActionDecision(), signal: uniformSignalDecision(), source: 'fallback:uniform' }));
    }
    this.stats.fallbacks += pending.length;
    for (let k = 0; k < pending.length; k++) {
      const { idx, reason } = pending[k];
      const d = decisions[k];
      const action = d?.action ?? uniformActionDecision();
      const signal = d?.signal ?? uniformSignalDecision();
      results[idx] = { bugId: requests[idx].bugId, action, signal, source: `fallback:${reason}` };
    }
  }
}
