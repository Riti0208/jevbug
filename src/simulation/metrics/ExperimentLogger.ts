/**
 * ExperimentLogger — collects the per-run data an ExperimentExport needs:
 * a periodic summary row (ExperimentRow), every DeathRecord (bounded), and
 * optionally a bounded ring of raw BugObservations (off by default — this can
 * get large fast).
 *
 * This file only takes `type` imports from src/experiments/ExperimentConfig.ts
 * (erased at compile time, so there is no runtime dependency and no cycle) —
 * it is the single source of truth for the ExperimentRow / ExperimentExport
 * shapes so metrics and export stay in sync.
 */
import type { DeathRecord, TickRecord, BugObservation } from '../types';
import type { MetricsCollector } from './MetricsCollector';
import type { ExperimentExport, ExperimentRow } from '../../experiments/ExperimentConfig';

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

/** Fields the logger fills in about a completed run when asked to export it. */
export type ExperimentLoggerMeta = Pick<
  ExperimentExport,
  | 'experimentId'
  | 'seed'
  | 'mode'
  | 'memoryMode'
  | 'provider'
  | 'ticksRequested'
  | 'ticksRun'
  | 'extinct'
  | 'durationMs'
  | 'config'
> & {
  /** Metrics collector to pull the final/communication/timeline snapshots from. */
  metrics: MetricsCollector;
};

type ExperimentRowDraft = Omit<ExperimentRow, 'experimentId' | 'seed' | 'mode' | 'memoryMode'>;

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

  toExport(meta: ExperimentLoggerMeta): ExperimentExport {
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
