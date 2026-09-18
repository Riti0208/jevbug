#!/usr/bin/env -S npx tsx
/**
 * Headless experiment CLI. Run with `npm run experiment -- <args>`.
 *
 * Examples:
 *   npm run experiment -- --seed 1 --mode COMMUNICATION --ticks 2000
 *   npm run experiment -- --seeds 1-5 --mode all --memory both --ticks 5000
 *   npm run experiment -- --compare --seeds 1-10 --ticks 3000 --provider mock
 *   npm run experiment -- --seed 1 --ticks 1000 --config maxPopulation=200,mutationRate=0.1
 *
 * Writes one `<experimentId>.json` per run plus `summary.csv` and `rows.csv`
 * to --out (default: experiments-out/). See docs/METRICS.md for what the
 * columns mean.
 */
import { mkdirSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { EXPERIMENT_MODES } from '../src/simulation/types';
import type { ExperimentMode, MemoryMode } from '../src/simulation/types';
import type { SimulationConfig } from '../src/simulation/config';
import {
  runExperiment,
  runComparison,
  toJson,
  rowsToCsv,
  summaryToCsv,
  type ExperimentConfig,
  type ExperimentExport,
  type ProviderKind,
  type RunProgress,
} from '../src/experiments';

interface CliArgs {
  seeds: number[];
  modes: ExperimentMode[];
  memories: MemoryMode[];
  ticks: number;
  provider: ProviderKind;
  out: string;
  configOverrides: Partial<SimulationConfig>;
  compare: boolean;
}

function parseSeeds(seedArg: string | undefined, seedsArg: string | undefined): number[] {
  if (seedsArg) {
    const range = seedsArg.match(/^(\d+)-(\d+)$/);
    if (range) {
      const start = Number(range[1]);
      const end = Number(range[2]);
      const out: number[] = [];
      for (let s = start; s <= end; s++) out.push(s);
      return out;
    }
    return seedsArg
      .split(',')
      .map((s) => s.trim())
      .filter(Boolean)
      .map(Number);
  }
  if (seedArg) {
    return seedArg
      .split(',')
      .map((s) => s.trim())
      .filter(Boolean)
      .map(Number);
  }
  return [1];
}

function validateMode(m: string): ExperimentMode {
  if ((EXPERIMENT_MODES as readonly string[]).includes(m)) return m as ExperimentMode;
  throw new Error(`Unknown --mode "${m}". Expected one of ${EXPERIMENT_MODES.join(', ')}, or "all".`);
}

function validateMemory(m: string): MemoryMode {
  if (m === 'WITH_MEMORY' || m === 'NO_MEMORY') return m;
  throw new Error(`Unknown --memory "${m}". Expected WITH_MEMORY, NO_MEMORY, or "both".`);
}

function parseConfigOverrides(spec: string | undefined): Partial<SimulationConfig> {
  if (!spec) return {};
  const out: Record<string, unknown> = {};
  for (const pair of spec.split(',')) {
    const eq = pair.indexOf('=');
    if (eq === -1) continue;
    const key = pair.slice(0, eq).trim();
    const rawValue = pair.slice(eq + 1).trim();
    if (!key || rawValue === '') continue;
    if (rawValue === 'true') out[key] = true;
    else if (rawValue === 'false') out[key] = false;
    else if (rawValue.trim() !== '' && !Number.isNaN(Number(rawValue))) out[key] = Number(rawValue);
    else out[key] = rawValue;
  }
  return out as Partial<SimulationConfig>;
}

/** Simple hand-rolled `--flag value` / `--flag=value` / `--flag` (boolean) parser. */
function tokenize(argv: string[]): { values: Map<string, string>; flags: Set<string> } {
  const values = new Map<string, string>();
  const flags = new Set<string>();
  for (let i = 0; i < argv.length; i++) {
    const arg = argv[i];
    if (!arg.startsWith('--')) continue;
    const eq = arg.indexOf('=');
    if (eq !== -1) {
      values.set(arg.slice(2, eq), arg.slice(eq + 1));
      continue;
    }
    const key = arg.slice(2);
    const next = argv[i + 1];
    if (next !== undefined && !next.startsWith('--')) {
      values.set(key, next);
      i++;
    } else {
      flags.add(key);
    }
  }
  return { values, flags };
}

export function parseArgs(argv: string[]): CliArgs {
  const { values, flags } = tokenize(argv);

  const seeds = parseSeeds(values.get('seed'), values.get('seeds'));

  const modeArg = values.get('mode') ?? 'COMMUNICATION';
  const modes: ExperimentMode[] = modeArg === 'all' ? [...EXPERIMENT_MODES] : [validateMode(modeArg)];

  const memoryArg = values.get('memory') ?? 'WITH_MEMORY';
  const memories: MemoryMode[] = memoryArg === 'both' ? ['WITH_MEMORY', 'NO_MEMORY'] : [validateMemory(memoryArg)];

  const ticks = Number(values.get('ticks') ?? '2000');
  const provider = (values.get('provider') ?? 'mock') as ProviderKind;
  const out = values.get('out') ?? 'experiments-out';
  const configOverrides = parseConfigOverrides(values.get('config'));
  const compare = flags.has('compare') || values.get('compare') === 'true';

  return { seeds, modes, memories, ticks, provider, out, configOverrides, compare };
}

function writeRunFiles(outDir: string, run: ExperimentExport): void {
  writeFileSync(join(outDir, `${run.experimentId}.json`), toJson(run));
}

function printSummaryTable(exports: ExperimentExport[]): void {
  console.log('\n=== Summary ===');
  const rows = exports.map((e) => ({
    experimentId: e.experimentId,
    seed: e.seed,
    mode: e.mode,
    memory: e.memoryMode,
    ticksRun: e.ticksRun,
    extinct: e.extinct,
    finalPop: e.final.population,
    maxGen: e.final.maxGeneration,
    avgLifespan: Number(e.final.averageLifespan.toFixed(1)),
    signalRate: Number(e.final.signalRate.toFixed(3)),
    MI_predator: Number(e.communication.miSignalPredator.toFixed(4)),
    MI_action: Number(e.communication.miSignalReceiverAction.toFixed(4)),
    potentialComm: e.communication.potentialCommunication,
  }));
  console.table(rows);
}

function makeProgressPrinter(): (p: RunProgress) => void {
  let last = 0;
  return (p: RunProgress) => {
    const now = Date.now();
    if (now - last < 1000) return;
    last = now;
    const pct = p.ticks > 0 ? ((100 * p.tick) / p.ticks).toFixed(1) : '?';
    process.stdout.write(
      `\r  tick ${p.tick}/${p.ticks} (${pct}%)  population=${p.population}  ${p.ticksPerSecond.toFixed(1)} ticks/s   `,
    );
  };
}

export async function main(argv = process.argv.slice(2)): Promise<void> {
  const args = parseArgs(argv);
  mkdirSync(args.out, { recursive: true });

  const exports: ExperimentExport[] = [];

  if (args.compare) {
    console.log(
      `Running comparison grid (spec §49): seeds=${args.seeds.join(',')} ticks=${args.ticks} provider=${args.provider}`,
    );
    await runComparison({
      seeds: args.seeds,
      ticks: args.ticks,
      provider: args.provider,
      config: args.configOverrides,
      onRunDone: (run) => {
        process.stdout.write('\n');
        console.log(`  done: ${run.experimentId} (mode=${run.mode}, memory=${run.memoryMode})`);
        exports.push(run);
        writeRunFiles(args.out, run);
      },
    });
  } else {
    for (const seed of args.seeds) {
      for (const mode of args.modes) {
        for (const memoryMode of args.memories) {
          console.log(
            `\nRunning seed=${seed} mode=${mode} memory=${memoryMode} ticks=${args.ticks} provider=${args.provider}`,
          );
          const cfg: ExperimentConfig = {
            seed,
            mode,
            memoryMode,
            ticks: args.ticks,
            provider: args.provider,
            config: args.configOverrides,
          };
          const run = await runExperiment(cfg, { onProgress: makeProgressPrinter() });
          process.stdout.write('\n');
          exports.push(run);
          writeRunFiles(args.out, run);
        }
      }
    }
  }

  writeFileSync(join(args.out, 'summary.csv'), summaryToCsv(exports));
  writeFileSync(join(args.out, 'rows.csv'), rowsToCsv(exports));
  console.log(`\nWrote ${exports.length} run(s) to ${args.out}/ (summary.csv, rows.csv, <experimentId>.json each).`);

  printSummaryTable(exports);
}

const isMain = process.argv[1] && import.meta.url === `file://${process.argv[1]}`;
if (isMain) {
  main().catch((err) => {
    console.error(err);
    process.exitCode = 1;
  });
}
