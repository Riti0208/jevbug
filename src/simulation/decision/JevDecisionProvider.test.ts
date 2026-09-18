import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { JevDecisionProvider } from './JevDecisionProvider';
import type { JevBatchRequest, JevBatchResponse, JevTransport } from './jevProtocol';
import type { DecisionRequest } from '../types';

function makeRequest(bugId: string, energy = 0.5): DecisionRequest {
  return {
    bugId,
    tick: 1,
    creature: { energy, fear: 0.1, age: 10, generation: 0, carryingFood: false },
    traits: { curiosity: 0.5, aggression: 0.1, sociality: 0.5, signalTendency: 0.5, memoryLength: 10, speed: 0.5 },
    perception: {
      energy,
      fear: 0.1,
      foodDirection: null,
      predatorDirection: null,
      nearbyBugCount: 0,
      heardSignals: [],
      previousAction: null,
      previousOutcome: null,
    },
    signalExperience: null,
    recentMemory: null,
  };
}

function successResponse(batch: JevBatchRequest, choice = 'REST'): JevBatchResponse {
  return {
    results: batch.requests.map((r) => ({
      id: r.id,
      answers: {
        action: { type: 'choice', choice },
        signal: { type: 'choice', choice: 'NONE' },
      },
      usage: { inputTokens: 10, outputTokens: 2 },
      latencyMs: 5,
    })),
    model: 'typesafe-ai/jev-latest',
    backend: 'gateway',
    totalLatencyMs: 5,
  };
}

describe('JevDecisionProvider', () => {
  afterEach(() => {
    vi.useRealTimers();
  });

  it('preserves order and length, one result per request', async () => {
    const transport: JevTransport = vi.fn(async (batch) => successResponse(batch));
    const provider = new JevDecisionProvider({ transport, cache: false });

    const requests = [makeRequest('a', 0.1), makeRequest('b', 0.2), makeRequest('c', 0.3)];
    const results = await provider.decideBatch(requests);

    expect(results).toHaveLength(3);
    expect(results.map((r) => r.bugId)).toEqual(['a', 'b', 'c']);
    for (const r of results) expect(r.source).toBe('jev');
  });

  it('returns [] for an empty batch without calling the transport', async () => {
    const transport: JevTransport = vi.fn(async (batch) => successResponse(batch));
    const provider = new JevDecisionProvider({ transport });
    const results = await provider.decideBatch([]);
    expect(results).toEqual([]);
    expect(transport).not.toHaveBeenCalled();
  });

  it('dedupes identical states and serves duplicates from cache (in-batch and cross-call)', async () => {
    const transport: JevTransport = vi.fn(async (batch) => successResponse(batch));
    const provider = new JevDecisionProvider({ transport, cache: true, batchSize: 32 });

    // Two bugs with an identical state (same energy/traits/perception) in one batch.
    const requests = [makeRequest('a', 0.4), makeRequest('b', 0.4)];
    const results = await provider.decideBatch(requests);

    expect(transport).toHaveBeenCalledTimes(1);
    const batchArg = (transport as ReturnType<typeof vi.fn>).mock.calls[0][0] as JevBatchRequest;
    expect(batchArg.requests).toHaveLength(1); // deduped to a single wire request

    const sources = results.map((r) => r.source).sort();
    expect(sources).toEqual(['jev', 'jev:cache']);

    const stats1 = provider.getStats();
    expect(stats1.cacheHits).toBe(1);
    expect(stats1.answered).toBe(2);

    // A later call with the same state should hit the persistent LRU cache without a new transport call.
    const results2 = await provider.decideBatch([makeRequest('c', 0.4)]);
    expect(transport).toHaveBeenCalledTimes(1);
    expect(results2[0].source).toBe('jev:cache');
    expect(provider.getStats().cacheHits).toBe(2);
  });

  it('falls back only the specific bug that got a per-result error', async () => {
    const transport: JevTransport = vi.fn(async (batch) => {
      const response = successResponse(batch);
      response.results[1] = { id: batch.requests[1].id, error: { message: 'bad state', retryable: false } };
      return response;
    });
    const provider = new JevDecisionProvider({ transport, cache: false });

    const requests = [makeRequest('a', 0.1), makeRequest('b', 0.2), makeRequest('c', 0.3)];
    const results = await provider.decideBatch(requests);

    expect(results[0].source).toBe('jev');
    expect(results[1].source).toBe('fallback:jev-error');
    expect(results[2].source).toBe('jev');
    expect(provider.getStats().fallbacks).toBe(1);
    expect(provider.getStats().answered).toBe(2);
  });

  it('never throws from decideBatch when decode of a malformed answer fails', async () => {
    const transport: JevTransport = vi.fn(async (batch: JevBatchRequest) => ({
      results: batch.requests.map((r) => ({ id: r.id, answers: { action: { type: 'choice' as const, choice: 'NOT_A_REAL_ACTION' }, signal: { type: 'choice' as const, choice: 'NONE' } } })),
      model: 'x',
      backend: 'gateway' as const,
      totalLatencyMs: 1,
    }));
    const provider = new JevDecisionProvider({ transport, cache: false });
    const results = await provider.decideBatch([makeRequest('a')]);
    expect(results[0].source).toBe('fallback:decode-error');
  });

  describe('circuit breaker (fake timers)', () => {
    beforeEach(() => {
      vi.useFakeTimers();
    });

    it('opens after failureThreshold whole-chunk transport failures, falls back meanwhile, and closes again after a successful probe past cooldownMs', async () => {
      let shouldFail = true;
      const transport: JevTransport = vi.fn(async (batch) => {
        if (shouldFail) throw new Error('network down');
        return successResponse(batch);
      });

      const provider = new JevDecisionProvider({
        transport,
        cache: false,
        circuitBreaker: { failureThreshold: 2, cooldownMs: 1000 },
      });

      // Call 1: fails (1 initial + 1 retry attempt inside the provider).
      const p1 = provider.decideBatch([makeRequest('a', 0.11)]);
      await vi.advanceTimersByTimeAsync(600);
      const r1 = await p1;
      expect(r1[0].source).toBe('fallback:transport-error');
      expect(provider.getStats().circuitOpen).toBe(false);

      // Call 2: fails again -> breaker opens.
      const p2 = provider.decideBatch([makeRequest('b', 0.22)]);
      await vi.advanceTimersByTimeAsync(600);
      const r2 = await p2;
      expect(r2[0].source).toBe('fallback:transport-error');
      expect(provider.getStats().circuitOpen).toBe(true);

      const callsBeforeOpenCheck = (transport as ReturnType<typeof vi.fn>).mock.calls.length;

      // Call 3: breaker is open -> immediate fallback, transport is not invoked again.
      const r3 = await provider.decideBatch([makeRequest('c', 0.33)]);
      expect(r3[0].source).toBe('fallback:circuit-open');
      expect((transport as ReturnType<typeof vi.fn>).mock.calls.length).toBe(callsBeforeOpenCheck);

      // Let the cooldown elapse, then let the next call succeed (the probe).
      shouldFail = false;
      await vi.advanceTimersByTimeAsync(1100);
      const r4 = await provider.decideBatch([makeRequest('d', 0.44)]);
      expect(r4[0].source).toBe('jev');
      expect(provider.getStats().circuitOpen).toBe(false);
    });
  });

  it('dispose() aborts in-flight requests (they resolve as fallback, never throw)', async () => {
    const transport: JevTransport = (_batch, signal) =>
      new Promise((_resolve, reject) => {
        if (signal?.aborted) {
          reject(new Error('aborted'));
          return;
        }
        signal?.addEventListener('abort', () => reject(new Error('aborted')));
      });
    const provider = new JevDecisionProvider({ transport, cache: false, timeoutMs: 60_000 });

    const pending = provider.decideBatch([makeRequest('a')]);
    provider.dispose();
    const results = await pending;

    expect(results[0].source).toBe('fallback:transport-error');
  });
});
