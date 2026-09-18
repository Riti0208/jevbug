/**
 * Headless experiment runner. No three.js, no DOM — safe to run under Node
 * (the CLI) or inside a Vitest test. The concrete Simulation core and the
 * concrete DecisionProvider implementations are pulled in with dynamic
 * `import()` from inside `runExperiment` rather than at module scope, so:
 *  - this module can be imported (e.g. by scripts/run-experiment.ts or a test
 *    that only exercises the arg parser / CSV export) even before those
 *    modules exist or without paying their load cost, and
 *  - the 'jev' provider path (which pulls in `api/_lib/jev.ts`) is never
 *    bundled into a browser build that only ever runs 'mock'/'random'.
 */
import type { DecisionProvider } from '../simulation/decision/DecisionProvider';
import { createConfig, type SimulationConfig } from '../simulation/config';
import type { ExperimentMode, MemoryMode } from '../simulation/types';
import { MetricsCollector } from '../simulation/metrics/MetricsCollector';
import { ExperimentLogger } from '../simulation/metrics/ExperimentLogger';
import type { ExperimentConfig, ExperimentExport, ProviderKind, RunProgress } from './ExperimentConfig';

export type ProviderFactory = (
  kind: ProviderKind,
  config: SimulationConfig,
) => DecisionProvider | Promise<DecisionProvider>;

export interface RunHooks {
  onProgress?: (progress: RunProgress) => void;
  signal?: AbortSignal;
  providerFactory?: ProviderFactory;
}

/** How often (in ticks) the event loop gets a chance to breathe. */
const YIELD_EVERY_TICKS = 200;

async function defaultProviderFactory(kind: ProviderKind, config: SimulationConfig): Promise<DecisionProvider> {
  if (kind === 'mock') {
    const { MockDecisionProvider } = await import('../simulation/decision/MockDecisionProvider');
    return new MockDecisionProvider();
  }
  if (kind === 'random') {
    const { RandomDecisionProvider } = await import('../simulation/decision/RandomDecisionProvider');
    return new RandomDecisionProvider();
  }
  const [{ JevDecisionProvider }, { createInProcessTransport }] = await Promise.all([
    import('../simulation/decision/JevDecisionProvider'),
    import('../../api/_lib/jev'),
  ]);
  void config;
  return new JevDecisionProvider({ transport: createInProcessTransport(process.env) });
}

function yieldToEventLoop(): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, 0));
}

export async function runExperiment(cfg: ExperimentConfig, hooks: RunHooks = {}): Promise<ExperimentExport> {
  const startedAt = Date.now();
  const memoryMode: MemoryMode = cfg.memoryMode ?? 'WITH_MEMORY';
  const providerKind: ProviderKind = cfg.provider ?? 'mock';
  const experimentId = cfg.experimentId ?? `${cfg.mode}-${memoryMode}-seed${cfg.seed}-${Date.now()}`;
  const stopOnExtinction = cfg.stopOnExtinction ?? true;

  const config = createConfig({
    seed: cfg.seed,
    mode: cfg.mode,
    memoryMode,
    decisionProvider: providerKind,
    ...cfg.config,
  });

  const providerFactory = hooks.providerFactory ?? defaultProviderFactory;
  const provider = await providerFactory(providerKind, config);

  const { Simulation } = await import('../simulation/Simulation');
  const simulation = new Simulation(config, provider);

  const metrics = new MetricsCollector(cfg.metrics);
  const logger = new ExperimentLogger({ logEvery: cfg.logEvery ?? 10 });

  let ticksRun = 0;
  let extinct = false;
  let lastProgressAt = Date.now();
  let lastProgressTick = 0;
  let lastPopulation = 0;

  try {
    for (let i = 0; i < cfg.ticks; i++) {
      if (hooks.signal?.aborted) break;

      const tickRecord = await simulation.step();
      metrics.record(tickRecord);
      logger.record(tickRecord, metrics);
      ticksRun = i + 1;
      lastPopulation = tickRecord.population;

      if (stopOnExtinction && tickRecord.population === 0) {
        extinct = true;
        break;
      }

      if (ticksRun % YIELD_EVERY_TICKS === 0) {
        await yieldToEventLoop();
      }

      if (hooks.onProgress) {
        const now = Date.now();
        const elapsedS = (now - lastProgressAt) / 1000;
        if (elapsedS >= 1) {
          const ticksPerSecond = (ticksRun - lastProgressTick) / elapsedS;
          hooks.onProgress({ tick: ticksRun, ticks: cfg.ticks, population: lastPopulation, ticksPerSecond });
          lastProgressAt = now;
          lastProgressTick = ticksRun;
        }
      }
    }
  } finally {
    simulation.dispose();
    provider.dispose?.();
  }

  const durationMs = Date.now() - startedAt;

  return logger.toExport({
    experimentId,
    seed: cfg.seed,
    mode: cfg.mode,
    memoryMode,
    provider: provider.name ?? providerKind,
    ticksRequested: cfg.ticks,
    ticksRun,
    extinct,
    durationMs,
    config,
    metrics,
  });
}

export interface ComparisonCondition {
  /** Human-readable label (A/B/C/D in the spec §49 grid); purely informational. */
  label?: string;
  mode: ExperimentMode;
  memoryMode: MemoryMode;
}

/**
 * The standard 4-condition comparison grid (spec §49):
 *   A. COMMUNICATION      + WITH_MEMORY  — the full experimental condition.
 *   B. NO_COMMUNICATION   + WITH_MEMORY  — communication ablated.
 *   C. SHUFFLED_COMMUNICATION + WITH_MEMORY — communication present but decoupled
 *      from the sender (receivers can't learn anything from it).
 *   D. COMMUNICATION      + NO_MEMORY    — memory ablated, to separate the
 *      contribution of within-lifetime learning from communication itself.
 */
export const DEFAULT_COMPARISON_CONDITIONS: ComparisonCondition[] = [
  { label: 'A', mode: 'COMMUNICATION', memoryMode: 'WITH_MEMORY' },
  { label: 'B', mode: 'COMMUNICATION', memoryMode: 'NO_MEMORY' },
  { label: 'C', mode: 'NO_COMMUNICATION', memoryMode: 'WITH_MEMORY' },
  { label: 'D', mode: 'SHUFFLED_COMMUNICATION', memoryMode: 'WITH_MEMORY' },
];

export interface RunComparisonOptions {
  seeds: number[];
  ticks: number;
  provider?: ProviderKind;
  config?: Partial<SimulationConfig>;
  conditions?: ComparisonCondition[];
  onRunDone?: (exportedRun: ExperimentExport) => void;
}

/** Runs the standard comparison grid (spec §49): for each seed x each of the 4 conditions A-D. */
export async function runComparison(opts: RunComparisonOptions): Promise<ExperimentExport[]> {
  const conditions = opts.conditions ?? DEFAULT_COMPARISON_CONDITIONS;
  const results: ExperimentExport[] = [];

  for (const seed of opts.seeds) {
    for (const condition of conditions) {
      const run = await runExperiment({
        seed,
        mode: condition.mode,
        memoryMode: condition.memoryMode,
        ticks: opts.ticks,
        provider: opts.provider,
        config: opts.config,
      });
      results.push(run);
      opts.onRunDone?.(run);
    }
  }

  return results;
}
