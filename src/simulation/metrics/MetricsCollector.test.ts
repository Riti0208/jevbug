import { describe, expect, it } from 'vitest';
import type { BugObservation, BugTraits, DeathRecord, Signal, TickRecord } from '../types';
import { classifyHeard, MetricsCollector } from './MetricsCollector';

function makeLcg(seed: number) {
  let s = seed >>> 0;
  return () => {
    s = (s * 1664525 + 1013904223) >>> 0;
    return s / 4294967296;
  };
}

const ZERO_TRAITS: BugTraits = {
  curiosity: 0.5,
  aggression: 0.5,
  sociality: 0.5,
  signalTendency: 0.5,
  memoryLength: 5,
  speed: 0.5,
};

function makeObs(overrides: Partial<BugObservation> = {}): BugObservation {
  return {
    tick: 0,
    bugId: 'b',
    predatorVisible: false,
    foodVisible: false,
    signalEmitted: 'NONE',
    signalsHeard: [],
    action: 'REST',
    outcome: 'NOTHING',
    energy: 0.5,
    ...overrides,
  };
}

function makeTick(tick: number, obs: BugObservation[], overrides: Partial<TickRecord> = {}): TickRecord {
  const signalCounts: Record<Signal, number> = { NONE: 0, A: 0, B: 0 };
  for (const o of obs) signalCounts[o.signalEmitted]++;
  return {
    tick,
    observations: obs.map((o) => ({ ...o, tick })),
    deaths: [],
    births: 0,
    population: obs.length,
    predatorCount: 0,
    foodCount: 0,
    signalCounts,
    averageEnergy: 0.5,
    averageAge: 10,
    maxGeneration: 0,
    averageGeneration: 0,
    averageTraits: { ...ZERO_TRAITS },
    decisionSources: { mock: obs.length },
    ...overrides,
  };
}

describe('classifyHeard', () => {
  it('classifies no signals as NONE', () => {
    expect(classifyHeard([])).toBe('NONE');
  });
  it('classifies only A as A (including duplicates)', () => {
    expect(classifyHeard(['A'])).toBe('A');
    expect(classifyHeard(['A', 'A', 'A'])).toBe('A');
  });
  it('classifies only B as B', () => {
    expect(classifyHeard(['B'])).toBe('B');
  });
  it('classifies a mix of A and B as MIXED', () => {
    expect(classifyHeard(['A', 'B'])).toBe('MIXED');
    expect(classifyHeard(['B', 'A', 'B'])).toBe('MIXED');
  });
});

describe('MetricsCollector - communication metrics', () => {
  it('reports ~0 mutual information when emitted signal is independent of predator visibility', () => {
    const collector = new MetricsCollector({ windowTicks: 500 });
    const rngPredator = makeLcg(11);
    const rngSignal = makeLcg(97);

    for (let t = 1; t <= 300; t++) {
      const obs: BugObservation[] = [];
      for (let b = 0; b < 20; b++) {
        const predatorVisible = rngPredator() < 0.5;
        const signalEmitted: Signal = rngSignal() < 0.5 ? 'A' : 'B';
        obs.push(makeObs({ predatorVisible, signalEmitted }));
      }
      collector.record(makeTick(t, obs));
    }

    const comm = collector.getCommunication();
    expect(comm.sampleSize).toBeGreaterThan(0);
    expect(comm.miSignalPredator).toBeLessThan(0.01);
  });

  it('reports clearly positive mutual information when emitted signal correlates with predator visibility', () => {
    const collector = new MetricsCollector({ windowTicks: 500 });

    for (let t = 1; t <= 100; t++) {
      const obs: BugObservation[] = [];
      for (let b = 0; b < 20; b++) {
        const predatorVisible = (t + b) % 2 === 0;
        const signalEmitted: Signal = predatorVisible ? 'A' : 'B';
        obs.push(makeObs({ predatorVisible, signalEmitted }));
      }
      collector.record(makeTick(t, obs));
    }

    const comm = collector.getCommunication();
    expect(comm.miSignalPredator).toBeGreaterThan(0.9);
    expect(comm.pSignalGivenPredatorVisible.A).toBeCloseTo(1, 5);
    expect(comm.pSignalGivenNoPredator.B).toBeCloseTo(1, 5);
  });

  it('evicts ticks older than windowTicks so old patterns stop affecting the metrics', () => {
    const collector = new MetricsCollector({ windowTicks: 50 });

    // First 50 ticks: independent (roughly balanced, alternating with an odd
    // phase so it doesn't accidentally correlate with the tick parity used below).
    for (let t = 1; t <= 50; t++) {
      const obs: BugObservation[] = [];
      for (let b = 0; b < 10; b++) {
        const predatorVisible = b % 2 === 0;
        const signalEmitted: Signal = Math.floor(b / 3) % 2 === 0 ? 'A' : 'B';
        obs.push(makeObs({ predatorVisible, signalEmitted }));
      }
      collector.record(makeTick(t, obs));
    }

    // Next 50 ticks: perfectly correlated.
    for (let t = 51; t <= 100; t++) {
      const obs: BugObservation[] = [];
      for (let b = 0; b < 10; b++) {
        const predatorVisible = b % 2 === 0;
        const signalEmitted: Signal = predatorVisible ? 'A' : 'B';
        obs.push(makeObs({ predatorVisible, signalEmitted }));
      }
      collector.record(makeTick(t, obs));
    }

    const comm = collector.getCommunication();
    // Window (50 ticks) should now contain only the correlated block.
    expect(comm.sampleSize).toBe(50 * 10);
    expect(comm.miSignalPredator).toBeGreaterThan(0.9);
  });

  it('computes pFleeGivenHeard and miSignalReceiverAction from heard categories', () => {
    const collector = new MetricsCollector({ windowTicks: 200 });

    for (let t = 1; t <= 50; t++) {
      const obs: BugObservation[] = [];
      for (let b = 0; b < 10; b++) {
        const heardA = b % 2 === 0;
        obs.push(
          makeObs({
            signalsHeard: heardA ? ['A'] : ['B'],
            action: heardA ? 'FLEE' : 'REST',
          }),
        );
      }
      collector.record(makeTick(t, obs));
    }

    const comm = collector.getCommunication();
    expect(comm.pFleeGivenHeard.A).toBeCloseTo(1, 5);
    expect(comm.pFleeGivenHeard.B).toBeCloseTo(0, 5);
    expect(comm.miSignalReceiverAction).toBeGreaterThan(0.9);
  });
});

describe('MetricsCollector - global metrics', () => {
  it('aggregates deaths and computes average lifespan across all deaths so far', () => {
    const collector = new MetricsCollector();
    const deaths: DeathRecord[] = [
      { tick: 1, bugId: 'a', cause: 'PREDATOR', age: 100, generation: 0 },
      { tick: 2, bugId: 'b', cause: 'STARVATION', age: 50, generation: 0 },
      { tick: 3, bugId: 'c', cause: 'OLD_AGE', age: 300, generation: 1 },
    ];
    collector.record(makeTick(1, [makeObs()], { deaths: [deaths[0]] }));
    collector.record(makeTick(2, [makeObs()], { deaths: [deaths[1]] }));
    collector.record(makeTick(3, [makeObs()], { deaths: [deaths[2]] }));

    const g = collector.getGlobal();
    expect(g.deaths).toEqual({ total: 3, predator: 1, starvation: 1, oldAge: 1 });
    expect(g.averageLifespan).toBeCloseTo((100 + 50 + 300) / 3, 10);
  });

  it('accumulates births, signal counts and decision sources cumulatively', () => {
    const collector = new MetricsCollector();
    collector.record(
      makeTick(1, [makeObs({ signalEmitted: 'A' }), makeObs({ signalEmitted: 'B' })], {
        births: 2,
        decisionSources: { mock: 2 },
      }),
    );
    collector.record(
      makeTick(2, [makeObs({ signalEmitted: 'A' })], {
        births: 1,
        decisionSources: { mock: 1, 'fallback:random': 1 },
      }),
    );

    const g = collector.getGlobal();
    expect(g.births).toBe(3);
    expect(g.signalCounts).toEqual({ NONE: 0, A: 2, B: 1 });
    expect(g.decisionSources).toEqual({ mock: 3, 'fallback:random': 1 });
  });

  it('reset() clears all accumulated state', () => {
    const collector = new MetricsCollector();
    collector.record(makeTick(1, [makeObs({ signalEmitted: 'A' })], { births: 5 }));
    collector.reset();
    const g = collector.getGlobal();
    expect(g.tick).toBe(0);
    expect(g.births).toBe(0);
    expect(g.signalCounts).toEqual({ NONE: 0, A: 0, B: 0 });
    expect(collector.getTimeline()).toEqual([]);
  });
});

describe('MetricsCollector - timeline', () => {
  it('samples every sampleEvery ticks and bounds length via downsampling', () => {
    const collector = new MetricsCollector({ sampleEvery: 1, maxTimelinePoints: 10 });
    for (let t = 1; t <= 100; t++) {
      collector.record(makeTick(t, [makeObs()]));
    }
    const timeline = collector.getTimeline();
    expect(timeline.length).toBeLessThanOrEqual(10);
    // Ticks in the timeline should stay in increasing order.
    for (let i = 1; i < timeline.length; i++) {
      expect(timeline[i].tick).toBeGreaterThan(timeline[i - 1].tick);
    }
  });
});

describe('MetricsCollector - potentialCommunication', () => {
  it('stays false until the correlation has been sustained for sustainTicks ticks, then flips true, then resets when the window fills with unrelated data', () => {
    // windowTicks chosen so that, after feeding exactly as many independent
    // ticks as the window holds, the correlated ticks are fully evicted and
    // the window ends up 100% independent (see the walk-through in the PR
    // description / docs/METRICS.md).
    const collector = new MetricsCollector({
      windowTicks: 30,
      miThreshold: 0.05,
      sustainTicks: 15,
    });

    const feedCorrelated = (fromTick: number, toTick: number) => {
      for (let t = fromTick; t <= toTick; t++) {
        const obs: BugObservation[] = [];
        for (let b = 0; b < 10; b++) {
          const predatorVisible = b % 2 === 0;
          const signalEmitted: Signal = predatorVisible ? 'A' : 'B';
          obs.push(
            makeObs({
              predatorVisible,
              signalEmitted,
              signalsHeard: predatorVisible ? ['A'] : ['B'],
              action: predatorVisible ? 'FLEE' : 'REST',
            }),
          );
        }
        collector.record(makeTick(t, obs));
      }
    };

    feedCorrelated(1, 10);
    expect(collector.getCommunication().potentialCommunication).toBe(false);

    feedCorrelated(11, 20);
    expect(collector.getCommunication().potentialCommunication).toBe(true);

    // Feed exactly `windowTicks` (30) independent ticks: this evicts all 20
    // correlated ticks and leaves the window 100% independent data, so both
    // MI values should fall back under the threshold and the streak resets.
    const rngPredator = makeLcg(3);
    const rngSignal = makeLcg(4);
    for (let t = 21; t <= 50; t++) {
      const obs: BugObservation[] = [];
      for (let b = 0; b < 20; b++) {
        obs.push(
          makeObs({
            predatorVisible: rngPredator() < 0.5,
            signalEmitted: rngSignal() < 0.5 ? 'A' : 'B',
          }),
        );
      }
      collector.record(makeTick(t, obs));
    }
    const comm = collector.getCommunication();
    expect(comm.miSignalPredator).toBeLessThan(0.05);
    expect(comm.potentialCommunication).toBe(false);
  });
});
