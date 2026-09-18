import { describe, expect, it } from 'vitest';
import { rowsToCsv, summaryToCsv, toJson } from './export';
import { EXPERIMENT_ROW_COLUMNS, type ExperimentExport, type ExperimentRow } from './ExperimentConfig';
import { emptyCommunicationMetrics, emptyGlobalMetrics } from '../simulation/metrics';
import { DEFAULT_CONFIG } from '../simulation/config';

function makeRow(overrides: Partial<ExperimentRow> = {}): ExperimentRow {
  return {
    experimentId: 'exp-1',
    seed: 1,
    mode: 'COMMUNICATION',
    memoryMode: 'WITH_MEMORY',
    tick: 10,
    population: 30,
    births: 1,
    deathsTotal: 0,
    deathsPredator: 0,
    deathsStarvation: 0,
    deathsOldAge: 0,
    maxGeneration: 2,
    averageGeneration: 1.2,
    averageEnergy: 0.6,
    averageAge: 50,
    averageLifespan: 120,
    signalCountNone: 10,
    signalCountA: 5,
    signalCountB: 3,
    signalRate: 0.44,
    MI_signal_predator: 0.12,
    MI_signal_food: 0.02,
    MI_signal_action: 0.3,
    MI_signal_flee: 0.1,
    potentialCommunication: false,
    ...overrides,
  };
}

function makeExport(overrides: Partial<ExperimentExport> = {}): ExperimentExport {
  return {
    experimentId: 'exp-1',
    seed: 1,
    mode: 'COMMUNICATION',
    memoryMode: 'WITH_MEMORY',
    provider: 'mock',
    ticksRequested: 100,
    ticksRun: 100,
    extinct: false,
    durationMs: 1234,
    config: DEFAULT_CONFIG,
    final: emptyGlobalMetrics(),
    communication: emptyCommunicationMetrics(500),
    timeline: [],
    rows: [makeRow()],
    deaths: [],
    ...overrides,
  };
}

describe('toJson', () => {
  it('round-trips a single export', () => {
    const exp = makeExport();
    const parsed = JSON.parse(toJson(exp));
    expect(parsed).toEqual(exp);
  });

  it('round-trips an array of exports', () => {
    const exps = [makeExport({ experimentId: 'a' }), makeExport({ experimentId: 'b' })];
    const parsed = JSON.parse(toJson(exps));
    expect(parsed).toEqual(exps);
  });
});

describe('rowsToCsv', () => {
  it('emits a stable header matching EXPERIMENT_ROW_COLUMNS', () => {
    const csv = rowsToCsv([makeExport()]);
    const header = csv.split('\n')[0];
    expect(header).toBe(EXPERIMENT_ROW_COLUMNS.join(','));
  });

  it('emits one data row per logged tick, across multiple runs', () => {
    const run1 = makeExport({ rows: [makeRow({ tick: 1 }), makeRow({ tick: 2 })] });
    const run2 = makeExport({ experimentId: 'exp-2', rows: [makeRow({ tick: 1, experimentId: 'exp-2' })] });
    const csv = rowsToCsv([run1, run2]);
    const lines = csv.trim().split('\n');
    expect(lines.length).toBe(1 + 3); // header + 3 data rows
  });

  it('escapes commas, quotes and newlines', () => {
    const run = makeExport({
      rows: [makeRow({ experimentId: 'has,comma "quote"\nand newline' })],
    });
    const csv = rowsToCsv([run]);
    const dataLine = csv.trim().split('\n')[1];
    expect(dataLine.startsWith('"has,comma ""quote""')).toBe(true);
  });

  it('produces an empty-but-headered CSV for no runs', () => {
    const csv = rowsToCsv([]);
    expect(csv.trim().split('\n')).toEqual([EXPERIMENT_ROW_COLUMNS.join(',')]);
  });
});

describe('summaryToCsv', () => {
  it('emits exactly one row per run', () => {
    const exps = [makeExport({ experimentId: 'a' }), makeExport({ experimentId: 'b' }), makeExport({ experimentId: 'c' })];
    const csv = summaryToCsv(exps);
    const lines = csv.trim().split('\n');
    expect(lines.length).toBe(1 + 3);
  });

  it('includes MI and potentialCommunication columns', () => {
    const csv = summaryToCsv([makeExport()]);
    const header = csv.split('\n')[0];
    expect(header).toContain('MI_signal_predator');
    expect(header).toContain('potentialCommunication');
  });

  it('escapes fields containing the delimiter', () => {
    const csv = summaryToCsv([makeExport({ experimentId: 'a,b' })]);
    const dataLine = csv.trim().split('\n')[1];
    expect(dataLine.startsWith('"a,b"')).toBe(true);
  });
});
