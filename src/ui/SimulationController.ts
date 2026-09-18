/**
 * SimulationController — owns the Simulation core, the decision provider, the
 * MetricsCollector and the ExperimentLogger, and drives the tick loop.
 *
 * Deliberately headless: no DOM, no three.js import, so it can be unit tested
 * under vitest's `node` environment with an injected scheduler and a fake
 * provider. `App.ts` is the only place that wires this up to a canvas.
 *
 * Loop design: `runLoop` awaits `simulation.step()` (the Jev provider is
 * async), then waits `max(0, targetIntervalMs - elapsed)` via the injected
 * `schedule`. At speed 'MAX' there is no wait, but the loop still yields to
 * the event loop between ticks (via `schedule(fn, 0)`) so the tab never
 * fully blocks. A monotonically increasing `runToken` guards against
 * overlapping steps and against a `stop()` that lands while a step is being
 * awaited — the result of a step from a stale token is discarded.
 */
import type { SimulationConfig } from '../simulation/config';
import { Simulation } from '../simulation/Simulation';
import { MetricsCollector } from '../simulation/metrics/MetricsCollector';
import { ExperimentLogger } from '../simulation/metrics/ExperimentLogger';
import { MockDecisionProvider } from '../simulation/decision/MockDecisionProvider';
import { RandomDecisionProvider } from '../simulation/decision/RandomDecisionProvider';
import { JevDecisionProvider } from '../simulation/decision/JevDecisionProvider';
import type { DecisionProvider } from '../simulation/decision/DecisionProvider';
import type { DecisionProviderKind, RenderSnapshot, TickRecord } from '../simulation/types';
import type { ExperimentExport } from '../experiments/ExperimentConfig';

/** 1x = this many ticks per second. Every other numeric speed is a multiple of it. */
export const BASE_TICKS_PER_SECOND = 5;

export type Speed = 'PAUSED' | 1 | 5 | 20 | 100 | 'MAX';

export type ControllerStatus = 'idle' | 'running' | 'paused' | 'stopped';

export interface ControllerState {
  status: ControllerStatus;
  tick: number;
  ticksPerSecond: number;
  speed: Speed;
  selectedBugId: string | null;
  lastError: string | null;
}

export interface ControllerEvents {
  tick: (record: TickRecord) => void;
  state: (s: ControllerState) => void;
  error: (message: string) => void;
}

export type ProviderFactory = (kind: DecisionProviderKind, config: SimulationConfig) => DecisionProvider;

export interface SimulationControllerDeps {
  providerFactory?: ProviderFactory;
  now?: () => number;
  schedule?: (fn: () => void, ms: number) => unknown;
  cancel?: (handle: unknown) => void;
}

function defaultProviderFactory(kind: DecisionProviderKind, config: SimulationConfig): DecisionProvider {
  if (kind === 'jev') {
    return new JevDecisionProvider({
      batchSize: config.decisionBatchSize,
      concurrency: config.decisionConcurrency,
    });
  }
  if (kind === 'random') return new RandomDecisionProvider();
  return new MockDecisionProvider();
}

type Listener<K extends keyof ControllerEvents> = ControllerEvents[K];

export class SimulationController {
  private readonly providerFactory: ProviderFactory;
  private readonly now: () => number;
  private readonly schedule: (fn: () => void, ms: number) => unknown;
  private readonly cancel: (handle: unknown) => void;

  private _simulation: Simulation | null = null;
  private _metrics: MetricsCollector | null = null;
  private _logger: ExperimentLogger | null = null;
  private _provider: DecisionProvider | null = null;
  private _config: SimulationConfig | null = null;
  private experimentId: string | null = null;
  private startedAt = 0;

  private status: ControllerStatus = 'idle';
  private speed: Speed = 1;
  private tick = 0;
  private selectedBugId: string | null = null;
  private lastError: string | null = null;

  private runToken = 0;
  private stepInFlight = false;
  private scheduledHandle: unknown = null;

  private lastTickAt: number | null = null;
  private ticksPerSecondEma = 0;

  private listeners: { [K in keyof ControllerEvents]: Set<Listener<K>> } = {
    tick: new Set(),
    state: new Set(),
    error: new Set(),
  };

  constructor(deps: SimulationControllerDeps = {}) {
    this.providerFactory = deps.providerFactory ?? defaultProviderFactory;
    this.now = deps.now ?? (() => Date.now());
    this.schedule = deps.schedule ?? ((fn, ms) => setTimeout(fn, ms));
    this.cancel = deps.cancel ?? ((handle) => clearTimeout(handle as ReturnType<typeof setTimeout>));
  }

  // ---------------------------------------------------------------------
  // Lifecycle
  // ---------------------------------------------------------------------

  start(config: SimulationConfig): void {
    this.teardown();
    this.runToken += 1;
    const token = this.runToken;

    this._config = config;
    this._provider = this.providerFactory(config.decisionProvider, config);
    this._simulation = new Simulation(config, this._provider);
    this._metrics = new MetricsCollector({ windowTicks: 500 });
    this._logger = new ExperimentLogger({ logEvery: 10 });
    this.experimentId = `${config.mode}-${config.memoryMode}-seed${config.seed}-${this.now()}`;
    this.startedAt = this.now();

    this.tick = 0;
    this.speed = 1;
    this.lastError = null;
    this.selectedBugId = null;
    this.lastTickAt = null;
    this.ticksPerSecondEma = 0;
    this.status = 'running';

    this.emitState();
    this.runLoop(token);
  }

  stop(): void {
    this.runToken += 1; // invalidate any in-flight step/loop
    this.cancelScheduled();
    this._provider?.dispose?.();
    this._simulation?.dispose();
    const hadRun = this._simulation !== null;
    this.status = hadRun ? 'stopped' : 'idle';
    this.stepInFlight = false;
    this.emitState();
  }

  pause(): void {
    if (this.status !== 'running') return;
    this.status = 'paused';
    this.speed = 'PAUSED';
    this.cancelScheduled();
    this.emitState();
  }

  resume(): void {
    if (this.status !== 'paused') return;
    this.status = 'running';
    if (this.speed === 'PAUSED') this.speed = 1;
    this.emitState();
    this.runLoop(this.runToken);
  }

  setSpeed(s: Speed): void {
    this.speed = s;
    if (s === 'PAUSED') {
      this.pause();
      return;
    }
    if (this.status === 'paused') {
      this.resume();
      return;
    }
    this.emitState();
  }

  /** Single manual tick — only meaningful while paused (or idle/stopped, where it is a no-op). */
  async step(): Promise<void> {
    if (!this._simulation || this.status !== 'paused') return;
    await this.tickOnce(this.runToken);
  }

  selectBug(id: string | null): void {
    this.selectedBugId = id;
    this.emitState();
  }

  dispose(): void {
    this.stop();
    this.listeners.tick.clear();
    this.listeners.state.clear();
    this.listeners.error.clear();
  }

  // ---------------------------------------------------------------------
  // Accessors
  // ---------------------------------------------------------------------

  getState(): ControllerState {
    return {
      status: this.status,
      tick: this.tick,
      ticksPerSecond: this.ticksPerSecondEma,
      speed: this.speed,
      selectedBugId: this.selectedBugId,
      lastError: this.lastError,
    };
  }

  get simulation(): Simulation | null {
    return this._simulation;
  }

  get metrics(): MetricsCollector | null {
    return this._metrics;
  }

  get provider(): DecisionProvider | null {
    return this._provider;
  }

  get config(): SimulationConfig | null {
    return this._config;
  }

  getRenderSnapshot(): RenderSnapshot | null {
    if (!this._simulation) return null;
    return this._simulation.getRenderSnapshot(this.selectedBugId);
  }

  buildExport(): ExperimentExport | null {
    if (!this._logger || !this._metrics || !this._config || !this._simulation) return null;
    const population = this._simulation.getBugs().length;
    return this._logger.toExport({
      experimentId: this.experimentId ?? `run-${this._config.seed}`,
      seed: this._config.seed,
      mode: this._config.mode,
      memoryMode: this._config.memoryMode,
      provider: this._provider?.name ?? this._config.decisionProvider,
      ticksRequested: this.tick,
      ticksRun: this.tick,
      extinct: population === 0,
      durationMs: this.now() - this.startedAt,
      config: this._config,
      metrics: this._metrics,
    });
  }

  on<K extends keyof ControllerEvents>(event: K, cb: ControllerEvents[K]): () => void {
    this.listeners[event].add(cb as Listener<K>);
    return () => {
      this.listeners[event].delete(cb as Listener<K>);
    };
  }

  // ---------------------------------------------------------------------
  // Internals
  // ---------------------------------------------------------------------

  private teardown(): void {
    if (this._simulation || this._provider) {
      this.runToken += 1;
      this.cancelScheduled();
      this._provider?.dispose?.();
      this._simulation?.dispose();
    }
    this._simulation = null;
    this._metrics = null;
    this._logger = null;
    this._provider = null;
    this._config = null;
    this.experimentId = null;
  }

  private cancelScheduled(): void {
    if (this.scheduledHandle !== null) {
      this.cancel(this.scheduledHandle);
      this.scheduledHandle = null;
    }
  }

  private intervalForSpeedMs(): number {
    if (this.speed === 'PAUSED') return Number.POSITIVE_INFINITY;
    if (this.speed === 'MAX') return 0;
    const ticksPerSecond = BASE_TICKS_PER_SECOND * this.speed;
    return 1000 / ticksPerSecond;
  }

  private runLoop(token: number): void {
    if (token !== this.runToken) return;
    if (this.status !== 'running') return;

    const startedAt = this.now();
    void this.tickOnce(token).then(() => {
      if (token !== this.runToken) return;
      if (this.status !== 'running') return;
      const target = this.intervalForSpeedMs();
      if (!Number.isFinite(target)) return;
      const elapsed = this.now() - startedAt;
      const waitMs = Math.max(0, target - elapsed);
      this.scheduledHandle = this.schedule(() => this.runLoop(token), waitMs);
    });
  }

  private async tickOnce(token: number): Promise<void> {
    if (this.stepInFlight) return;
    if (!this._simulation || !this._metrics || !this._logger) return;
    this.stepInFlight = true;
    const t0 = this.now();
    try {
      const record = await this._simulation.step();
      if (token !== this.runToken) return; // stopped while awaiting — discard
      this._metrics.record(record);
      this._logger.record(record, this._metrics);
      this.tick = record.tick;
      this.updateTicksPerSecond(t0);
      this.emitTick(record);
      this.emitState();
    } catch (err) {
      if (token !== this.runToken) return;
      const message = err instanceof Error ? err.message : String(err);
      this.lastError = message;
      this.emitError(message);
      this.emitState();
    } finally {
      this.stepInFlight = false;
    }
  }

  private updateTicksPerSecond(tickStartedAt: number): void {
    const now = this.now();
    if (this.lastTickAt != null) {
      const dt = now - this.lastTickAt;
      if (dt > 0) {
        const instant = 1000 / dt;
        const alpha = Math.min(1, dt / 1000); // ~1s time constant EMA
        this.ticksPerSecondEma = this.ticksPerSecondEma === 0 ? instant : this.ticksPerSecondEma + alpha * (instant - this.ticksPerSecondEma);
      }
    } else {
      // First tick: seed with an instant estimate from step duration alone.
      const stepDt = Math.max(1, now - tickStartedAt);
      this.ticksPerSecondEma = 1000 / stepDt;
    }
    this.lastTickAt = now;
  }

  private emitState(): void {
    const s = this.getState();
    for (const cb of this.listeners.state) cb(s);
  }

  private emitTick(record: TickRecord): void {
    for (const cb of this.listeners.tick) cb(record);
  }

  private emitError(message: string): void {
    for (const cb of this.listeners.error) cb(message);
  }
}
