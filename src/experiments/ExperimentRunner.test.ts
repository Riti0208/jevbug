import { describe, expect, it } from 'vitest';
import { DEFAULT_COMPARISON_CONDITIONS, runExperiment } from './ExperimentRunner';

// The simulation core (Simulation.ts) and the mock/random decision providers
// are owned by other engineers and may not exist yet. Rather than hard-fail,
// probe for them and skip the integration suite if they're missing — see the
// task report for what this means in practice.
let simulationAvailable = true;
try {
  await import('../simulation/Simulation');
  await import('../simulation/decision/MockDecisionProvider');
} catch {
  simulationAvailable = false;
}

describe('DEFAULT_COMPARISON_CONDITIONS (spec §49 grid)', () => {
  it('has exactly 4 conditions (A-D)', () => {
    expect(DEFAULT_COMPARISON_CONDITIONS).toHaveLength(4);
  });

  it('covers all three experiment modes and both memory modes', () => {
    const modes = new Set(DEFAULT_COMPARISON_CONDITIONS.map((c) => c.mode));
    const memoryModes = new Set(DEFAULT_COMPARISON_CONDITIONS.map((c) => c.memoryMode));
    expect(modes).toEqual(new Set(['COMMUNICATION', 'NO_COMMUNICATION', 'SHUFFLED_COMMUNICATION']));
    expect(memoryModes).toEqual(new Set(['WITH_MEMORY', 'NO_MEMORY']));
  });
});

describe.skipIf(!simulationAvailable)(
  'ExperimentRunner (integration, real Simulation + MockDecisionProvider)',
  () => {
    it('is deterministic for the same seed (same rows, same final stats)', async () => {
      const cfg = {
        seed: 42,
        mode: 'COMMUNICATION' as const,
        ticks: 200,
        provider: 'mock' as const,
      };
      const a = await runExperiment(cfg);
      const b = await runExperiment({ ...cfg, experimentId: a.experimentId });
      expect(a.ticksRun).toBe(200);
      expect(b.rows).toEqual(a.rows);
      expect(b.final).toEqual(a.final);
      expect(b.deaths).toEqual(a.deaths);
    });

    it('produces a row every logEvery ticks and logs deaths', async () => {
      const result = await runExperiment({
        seed: 7,
        mode: 'NO_COMMUNICATION',
        ticks: 150,
        provider: 'mock',
        logEvery: 25,
      });
      expect(result.rows.length).toBeGreaterThan(0);
      for (const row of result.rows) {
        expect(row.tick % 25).toBe(0);
      }
    });

    it('stops early and reports extinct when the population collapses', async () => {
      const result = await runExperiment({
        seed: 1,
        mode: 'NO_COMMUNICATION',
        ticks: 5000,
        provider: 'mock',
        stopOnExtinction: true,
        config: {
          initialBugs: 2,
          initialPredators: 0,
          initialFood: 0,
          foodSpawnRate: 0,
          initialBugEnergy: 0.01,
          energyBaseline: -0.5,
          maxAge: 5,
        },
      });
      expect(result.extinct).toBe(true);
      expect(result.ticksRun).toBeLessThan(5000);
    });
  },
);
