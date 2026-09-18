/**
 * Shared types for the headless experiment runner / logger / export pipeline.
 * No runtime logic here — see ExperimentRunner.ts, ExperimentLogger.ts and
 * export.ts.
 */
import type { SimulationConfig } from '../simulation/config';
import type { DeathRecord, ExperimentMode, MemoryMode } from '../simulation/types';
import type {
  CommunicationMetrics,
  GlobalMetrics,
  MetricsCollectorOptions,
  TimelinePoint,
} from '../simulation/metrics';

export type ProviderKind = 'mock' | 'random' | 'jev';

export interface ExperimentConfig {
  /** Defaults to `${mode}-${memoryMode}-seed${seed}-${Date.now()}`. */
  experimentId?: string;
  /** Deterministic seed (spec §27). */
  seed: number;
  mode: ExperimentMode;
  /** Defaults to 'WITH_MEMORY'. */
  memoryMode?: MemoryMode;
  /** Defaults to 'mock'. */
  provider?: ProviderKind;
  ticks: number;
  config?: Partial<SimulationConfig>;
  metrics?: MetricsCollectorOptions;
  /** How often (in ticks) a summary row is logged. Defaults to 10. */
  logEvery?: number;
  /** Stop early if population hits 0. Defaults to true. */
  stopOnExtinction?: boolean;
}

/**
 * One logged tick, flattened for CSV export (spec §29 minimum: experimentId,
 * seed, mode, tick, population, generation, signalCounts, averageLifespan,
 * MI_signal_predator, MI_signal_action, ...). Field names for the MI columns
 * intentionally match the spec's snake-ish naming so the CSV headers read the
 * same as the spec text.
 */
export interface ExperimentRow {
  experimentId: string;
  seed: number;
  mode: ExperimentMode;
  memoryMode: MemoryMode;
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

/** Stable column order for rowsToCsv (export.ts). */
export const EXPERIMENT_ROW_COLUMNS: readonly (keyof ExperimentRow)[] = [
  'experimentId',
  'seed',
  'mode',
  'memoryMode',
  'tick',
  'population',
  'births',
  'deathsTotal',
  'deathsPredator',
  'deathsStarvation',
  'deathsOldAge',
  'maxGeneration',
  'averageGeneration',
  'averageEnergy',
  'averageAge',
  'averageLifespan',
  'signalCountNone',
  'signalCountA',
  'signalCountB',
  'signalRate',
  'MI_signal_predator',
  'MI_signal_food',
  'MI_signal_action',
  'MI_signal_flee',
  'potentialCommunication',
] as const;

export interface ExperimentExport {
  experimentId: string;
  seed: number;
  mode: ExperimentMode;
  memoryMode: MemoryMode;
  /** Provider name/source label actually used (e.g. "mock", "jev"). */
  provider: string;
  ticksRequested: number;
  ticksRun: number;
  extinct: boolean;
  durationMs: number;
  config: SimulationConfig;
  final: GlobalMetrics;
  communication: CommunicationMetrics;
  timeline: TimelinePoint[];
  rows: ExperimentRow[];
  deaths: DeathRecord[];
}

export interface RunProgress {
  tick: number;
  ticks: number;
  population: number;
  ticksPerSecond: number;
}

/** Re-exported here for convenience of callers that only import ExperimentConfig.ts. */
export type { Signal };
