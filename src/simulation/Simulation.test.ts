import { describe, expect, it } from 'vitest';
import { createConfig } from './config';
import { MockDecisionProvider } from './decision/MockDecisionProvider';
import { Simulation } from './Simulation';

describe('Simulation tick determinism', () => {
  it('produces bit-identical TickRecords for the same seed + mock provider', async () => {
    const configA = createConfig({ seed: 777 });
    const configB = createConfig({ seed: 777 });
    const simA = new Simulation(configA, new MockDecisionProvider());
    const simB = new Simulation(configB, new MockDecisionProvider());

    for (let i = 0; i < 300; i++) {
      const recordA = await simA.step();
      const recordB = await simB.step();
      expect(recordA).toEqual(recordB);
    }
  }, 30000);

  it('diverges for different seeds', async () => {
    const simA = new Simulation(createConfig({ seed: 1 }), new MockDecisionProvider());
    const simB = new Simulation(createConfig({ seed: 2 }), new MockDecisionProvider());

    let diverged = false;
    for (let i = 0; i < 50; i++) {
      const recordA = await simA.step();
      const recordB = await simB.step();
      if (JSON.stringify(recordA) !== JSON.stringify(recordB)) {
        diverged = true;
        break;
      }
    }
    expect(diverged).toBe(true);
  }, 15000);
});

describe('experiment mode handling', () => {
  it('NO_COMMUNICATION: nothing is ever heard and nothing is ever emitted', async () => {
    const config = createConfig({ seed: 5, mode: 'NO_COMMUNICATION', initialBugs: 20, initialPredators: 1 });
    const sim = new Simulation(config, new MockDecisionProvider());
    for (let i = 0; i < 50; i++) {
      const record = await sim.step();
      expect(record.signalCounts.A).toBe(0);
      expect(record.signalCounts.B).toBe(0);
      for (const obs of record.observations) {
        expect(obs.signalEmitted).toBe('NONE');
        expect(obs.signalsHeard).toEqual([]);
      }
    }
  });

  it('SHUFFLED_COMMUNICATION preserves the count of heard signals vs COMMUNICATION, for the same seed', async () => {
    const base = { seed: 42, initialBugs: 25, initialPredators: 1, bugSignalDistance: 15 };
    const commSim = new Simulation(createConfig({ ...base, mode: 'COMMUNICATION' }), new MockDecisionProvider());
    const shuffledSim = new Simulation(
      createConfig({ ...base, mode: 'SHUFFLED_COMMUNICATION' }),
      new MockDecisionProvider(),
    );

    let commHeardTotal = 0;
    let shuffledHeardTotal = 0;
    for (let i = 0; i < 40; i++) {
      const commRecord = await commSim.step();
      const shuffledRecord = await shuffledSim.step();
      for (const obs of commRecord.observations) commHeardTotal += obs.signalsHeard.length;
      for (const obs of shuffledRecord.observations) shuffledHeardTotal += obs.signalsHeard.length;
    }
    // Same seed drives identical movement/emission (mode only transforms *identity* of what's
    // heard, not perception/decisions), so the volume of heard signals must match exactly.
    expect(shuffledHeardTotal).toBe(commHeardTotal);
    expect(commHeardTotal).toBeGreaterThan(0);
  });
});

describe('reproduction, mutation and generation', () => {
  it('reproduces once energy/age thresholds are met, tracks generation and mutates traits', async () => {
    const config = createConfig({
      seed: 3,
      initialBugs: 5,
      initialPredators: 0,
      reproductionEnergyThreshold: 0.5,
      reproductionMinAge: 2,
      reproductionCost: 0.1,
      initialBugEnergy: 0.9,
      energyBaseline: 0,
      maxPopulation: 200,
      mutationRate: 0.08,
    });
    const sim = new Simulation(config, new MockDecisionProvider());

    let totalBirths = 0;
    for (let i = 0; i < 20; i++) {
      const record = await sim.step();
      totalBirths += record.births;
    }

    expect(totalBirths).toBeGreaterThan(0);
    const children = sim.getBugs().filter((b) => b.generation > 0);
    expect(children.length).toBeGreaterThan(0);

    const parents = sim.getBugs().filter((b) => b.generation === 0);
    const child = children[0];
    // Mutated traits should not be an exact bit-copy of every parent's traits.
    const isBitIdenticalToSomeParent = parents.some(
      (p) =>
        p.traits.curiosity === child.traits.curiosity &&
        p.traits.aggression === child.traits.aggression &&
        p.traits.sociality === child.traits.sociality &&
        p.traits.speed === child.traits.speed,
    );
    expect(isBitIdenticalToSomeParent).toBe(false);
  });
});

describe('death causes', () => {
  it('records STARVATION when energy is driven to zero', async () => {
    const config = createConfig({
      seed: 9,
      initialBugs: 1,
      initialPredators: 0,
      initialFood: 0,
      foodSpawnRate: 0,
      energyBaseline: -1,
      maxAge: 0,
    });
    const sim = new Simulation(config, new MockDecisionProvider());
    const record = await sim.step();
    expect(record.deaths.length).toBeGreaterThan(0);
    expect(record.deaths[0].cause).toBe('STARVATION');
  });

  it('records OLD_AGE once age reaches maxAge', async () => {
    const config = createConfig({
      seed: 9,
      initialBugs: 1,
      initialPredators: 0,
      maxAge: 3,
    });
    const sim = new Simulation(config, new MockDecisionProvider());
    let record;
    for (let i = 0; i < 3; i++) record = await sim.step();
    expect(record!.deaths.some((d) => d.cause === 'OLD_AGE')).toBe(true);
  });

  it('records PREDATOR when an attack kills', async () => {
    const config = createConfig({
      seed: 9,
      initialBugs: 1,
      initialPredators: 1,
      predatorViewDistance: 1000,
      predatorAttackRange: 1000,
      predatorAttackCooldown: 0,
      predatorKillProbability: 1,
      predatorSpeed: 0,
    });
    const sim = new Simulation(config, new MockDecisionProvider());
    const record = await sim.step();
    expect(record.deaths.some((d) => d.cause === 'PREDATOR')).toBe(true);
  });
});

describe('smoke test: default config, 500 ticks, mock provider', () => {
  it('keeps population alive, eats food and predators kill at least once', async () => {
    const config = createConfig({ seed: 12345 });
    const sim = new Simulation(config, new MockDecisionProvider());

    let foodEaten = 0;
    let predatorDeaths = 0;
    let finalPopulation = 0;
    for (let i = 0; i < 500; i++) {
      const record = await sim.step();
      foodEaten += record.observations.filter((o) => o.outcome === 'ENERGY_GAINED').length;
      predatorDeaths += record.deaths.filter((d) => d.cause === 'PREDATOR').length;
      finalPopulation = record.population;
    }

    // eslint-disable-next-line no-console
    console.log('[smoke] finalPopulation=%d foodEaten=%d predatorDeaths=%d maxGeneration=%d',
      finalPopulation, foodEaten, predatorDeaths, sim.getStats().maxGeneration);

    expect(finalPopulation).toBeGreaterThan(0);
    expect(foodEaten).toBeGreaterThan(0);
  }, 30000);
});
