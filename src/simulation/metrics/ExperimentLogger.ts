/**
 * ExperimentLogger — collects the per-run data an ExperimentExport needs:
 * a periodic summary row (see ExperimentRow in src/experiments/ExperimentConfig.ts),
 * every DeathRecord (bounded), and optionally a bounded ring of raw
 * BugObservations (off by default — this can get large fast).
 *
 * This file only depends on `../types` and MetricsCollector; it does not know
 * about experiment configuration. src/experiments/ExperimentRunner.ts feeds it
 * a TickRecord + the MetricsCollector every tick, then calls `toExport(meta)`
 * once the run is done to assemble the full ExperimentExport.
 */
import type { BugObservation, DeathRecord, ExperimentMode, MemoryMode, TickRecord } from '../types';
import type { MetricsCollector } from './MetricsCollector';

// Kept structurally identical to (a subset of) ExperimentExport / ExperimentRow
// from src/experiments/ExperimentConfig.ts, but this file does not import that
// module (metrics/ has no dependency on experiments/) — ExperimentRunner is
// responsible for making sure the shapes line up, which the integration test
// checks.
export interface ExperimentRowDraft {
  tick: number;
  population: number;
  births: number;
  deathsTotal: number;
  deathsPredator: number;
  deathsStarvation: number;
  deathsOldAge: number;
  maxGeneration: number;
  averageGeneration: number;
  averageEnergy: number;
  averageAge: number;
  averageLifespan: number;
  signalCountNone: number;
  signalCountA: number;
  signalCountB: number;
  signalRate: number;
  MI_signal_predator: number;
  MI_signal_food: number;
  MI_signal_action: number;
  MI_signal_flee: number;
  potentialCommunication: boolean;
}

export type ExperimentRow = ExperimentRowDraft & {
  experimentId: string;
  seed: number;
  mode: ExperimentMode;
  memoryMode: MemoryMode;
};

export interface ExperimentLoggerOptions {
  /** Log a summary row every N ticks. Defaults to 10. */
  logEvery?: number;
  /** Keep a bounded ring of raw per-bug observations. Defaults to false. */
  keepObservations?: boolean;
  /** Bound on how many DeathRecords are retained. Defaults to 50 000. */
  maxDeathRecords?: number;
  /** Bound on how many observations are retained when keepObservations is true. */
  maxObservationEntries?: number;
}

export interface ExperimentLoggerMeta {
  experimentId: string;
  seed: number;
  mode: ExperimentMode;
  memoryMode: MemoryMode;
  provider: string;
  ticksRequested: number;
  ticksRun: number;
  extinct: boolean;
  durationMs: number;
  config: unknown;
  /** Metrics collector to pull final/communication/timeline snapshots from. */
  metrics: MetricsCollector;
}

export interface ExperimentExportLike {
  experimentId: string;
  seed: number;
  mode: ExperimentMode;
  memoryMode: MemoryMode;
  provider: string;
  ticksRequested: number;
  ticksRun: number;
  extinct: boolean;
  durationMs: number;
  config: unknown;
  final: ReturnType<MetricsCollector['getGlobal']>;
  communication: ReturnType<MetricsCollector['getCommunication']>;
  timeline: ReturnType<MetricsCollector['getTimeline']>;
  rows: ExperimentRow[];
  deaths: DeathRecord[];
}

export class ExperimentLogger {
  private readonly logEvery: number;
  private readonly keepObservations: boolean;
  private readonly maxDeathRecords: number;
  private readonly maxObservationEntries: number;

  private rowDrafts: ExperimentRowDraft[] = [];
  private deaths: DeathRecord[] = [];
  private observations: BugObservation[] = [];

  constructor(options: ExperimentLoggerOptions = {}) {
    this.logEvery = Math.max(1, options.logEvery ?? 10);
    this.keepObservations = options.keepObservations ?? false;
    this.maxDeathRecords = options.maxDeathRecords ?? 50_000;
    this.maxObservationEntries = options.maxObservationEntries ?? 20_000;
  }

  record(tick: TickRecord, metrics: MetricsCollector): void {
    if (tick.deaths.length > 0) {
      this.deaths.push(...tick.deaths);
      if (this.deaths.length > this.maxDeathRecords) {
        this.deaths.splice(0, this.deaths.length - this.maxDeathRecords);
      }
    }

    if (this.keepObservations && tick.observations.length > 0) {
      this.observations.push(...tick.observations);
      if (this.observations.length > this.maxObservationEntries) {
        this.observations.splice(0, this.observations.length - this.maxObservationEntries);
      }
    }

    if (tick.tick % this.logEvery === 0) {
      const g = metrics.getGlobal();
      const c = metrics.getCommunication();
      this.rowDrafts.push({
        tick: tick.tick,
        population: g.population,
        births: g.births,
        deathsTotal: g.deaths.total,
        deathsPredator: g.deaths.predator,
        deathsStarvation: g.deaths.starvation,
        deathsOldAge: g.deaths.oldAge,
        maxGeneration: g.maxGeneration,
        averageGeneration: g.averageGeneration,
        averageEnergy: g.averageEnergy,
        averageAge: g.averageAge,
        averageLifespan: g.averageLifespan,
        signalCountNone: g.signalCounts.NONE,
        signalCountA: g.signalCounts.A,
        signalCountB: g.signalCounts.B,
        signalRate: g.signalRate,
        MI_signal_predator: c.miSignalPredator,
        MI_signal_food: c.miSignalFood,
        MI_signal_action: c.miSignalReceiverAction,
        MI_signal_flee: c.miSignalReceiverFlee,
        potentialCommunication: c.potentialCommunication,
      });
    }
  }

  getRows(): readonly ExperimentRowDraft[] {
    return this.rowDrafts;
  }

  getDeaths(): readonly DeathRecord[] {
    return this.deaths;
  }

  getObservations(): readonly BugObservation[] {
    return this.observations;
  }

  toExport(meta: ExperimentLoggerMeta): ExperimentExportLike {
    const rows: ExperimentRow[] = this.rowDrafts.map((draft) => ({
      experimentId: meta.experimentId,
      seed: meta.seed,
      mode: meta.mode,
      memoryMode: meta.memoryMode,
      ...draft,
    }));

    return {
      experimentId: meta.experimentId,
      seed: meta.seed,
      mode: meta.mode,
      memoryMode: meta.memoryMode,
      provider: meta.provider,
      ticksRequested: meta.ticksRequested,
      ticksRun: meta.ticksRun,
      extinct: meta.extinct,
      durationMs: meta.durationMs,
      config: meta.config,
      final: meta.metrics.getGlobal(),
      communication: meta.metrics.getCommunication(),
      timeline: [...meta.metrics.getTimeline()],
      rows,
      deaths: [...this.deaths],
    };
  }
}
