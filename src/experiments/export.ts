/**
 * JSON / CSV serialisation for ExperimentExport results. Pure functions, no
 * filesystem access — scripts/run-experiment.ts decides where to write.
 */
import type { ExperimentExport, ExperimentRow } from './ExperimentConfig';
import { EXPERIMENT_ROW_COLUMNS } from './ExperimentConfig';

export function toJson(e: ExperimentExport | ExperimentExport[]): string {
  return JSON.stringify(e, null, 2);
}

function csvEscape(value: unknown): string {
  if (value === null || value === undefined) return '';
  const s = typeof value === 'string' ? value : String(value);
  if (/[",\n\r]/.test(s)) {
    return `"${s.replace(/"/g, '""')}"`;
  }
  return s;
}

function csvLine(values: readonly unknown[]): string {
  return values.map(csvEscape).join(',');
}

/** One row per logged tick across all runs. Column order is stable (EXPERIMENT_ROW_COLUMNS). */
export function rowsToCsv(exports: readonly ExperimentExport[]): string {
  const lines = [csvLine(EXPERIMENT_ROW_COLUMNS)];
  for (const run of exports) {
    for (const row of run.rows) {
      lines.push(csvLine(EXPERIMENT_ROW_COLUMNS.map((col) => row[col as keyof ExperimentRow])));
    }
  }
  return lines.join('\n') + '\n';
}

const SUMMARY_COLUMNS = [
  'experimentId',
  'seed',
  'mode',
  'memoryMode',
  'provider',
  'ticksRequested',
  'ticksRun',
  'extinct',
  'durationMs',
  'finalPopulation',
  'maxGeneration',
  'averageLifespan',
  'signalRate',
  'signalCount_NONE',
  'signalCount_A',
  'signalCount_B',
  'MI_signal_predator',
  'MI_signal_food',
  'MI_signal_action',
  'MI_signal_flee',
  'potentialCommunication',
] as const;

/** One row per run: experimentId, seed, mode, memoryMode, ticksRun, finalPopulation, maxGeneration, averageLifespan, signal rates, MI values, potentialCommunication. */
export function summaryToCsv(exports: readonly ExperimentExport[]): string {
  const lines = [csvLine(SUMMARY_COLUMNS)];
  for (const e of exports) {
    lines.push(
      csvLine([
        e.experimentId,
        e.seed,
        e.mode,
        e.memoryMode,
        e.provider,
        e.ticksRequested,
        e.ticksRun,
        e.extinct,
        e.durationMs,
        e.final.population,
        e.final.maxGeneration,
        e.final.averageLifespan,
        e.final.signalRate,
        e.final.signalCounts.NONE,
        e.final.signalCounts.A,
        e.final.signalCounts.B,
        e.communication.miSignalPredator,
        e.communication.miSignalFood,
        e.communication.miSignalReceiverAction,
        e.communication.miSignalReceiverFlee,
        e.communication.potentialCommunication,
      ]),
    );
  }
  return lines.join('\n') + '\n';
}
