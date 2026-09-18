import { describe, expect, it } from 'vitest';
import { createBug } from '../entities/Bug';
import { createConfig } from '../config';
import type { BugPerception, MemoryEntry } from '../types';
import { deriveSignalExperience, pushMemory, recentMemory } from './AgentMemory';

const config = createConfig();

function perception(overrides: Partial<BugPerception> = {}): BugPerception {
  return {
    energy: 0.5,
    fear: 0,
    foodDirection: null,
    predatorDirection: null,
    nearbyBugCount: 0,
    heardSignals: [],
    previousAction: null,
    previousOutcome: null,
    ...overrides,
  };
}

function entry(overrides: Partial<MemoryEntry> = {}): MemoryEntry {
  return {
    tick: 0,
    perception: perception(),
    signalsReceived: [],
    signalEmitted: 'NONE',
    action: 'REST',
    outcome: 'NOTHING',
    energyDelta: 0,
    ...overrides,
  };
}

describe('pushMemory trimming', () => {
  it('trims to traits.memoryLength, dropping the oldest entries', () => {
    const bug = createBug('b1', { x: 0, y: 0 }, 0, { ...dummyTraits(), memoryLength: 3 }, config);
    for (let i = 0; i < 5; i++) pushMemory(bug, entry({ tick: i }));
    expect(bug.memory).toHaveLength(3);
    expect(bug.memory.map((e) => e.tick)).toEqual([2, 3, 4]);
  });

  it('keeps everything when under the cap', () => {
    const bug = createBug('b1', { x: 0, y: 0 }, 0, { ...dummyTraits(), memoryLength: 10 }, config);
    pushMemory(bug, entry({ tick: 1 }));
    pushMemory(bug, entry({ tick: 2 }));
    expect(bug.memory.map((e) => e.tick)).toEqual([1, 2]);
  });
});

describe('recentMemory', () => {
  it('returns the last `window` entries, most recent last', () => {
    const memory = [entry({ tick: 1 }), entry({ tick: 2 }), entry({ tick: 3 })];
    expect(recentMemory(memory, 2).map((e) => e.tick)).toEqual([2, 3]);
  });

  it('returns empty for a zero window', () => {
    const memory = [entry({ tick: 1 })];
    expect(recentMemory(memory, 0)).toEqual([]);
  });
});

describe('deriveSignalExperience', () => {
  it('always reports both A and B, zeros allowed', () => {
    const result = deriveSignalExperience([]);
    expect(result.map((r) => r.signal).sort()).toEqual(['A', 'B']);
    for (const r of result) {
      expect(r.receivedCount).toBe(0);
      expect(r.averageEnergyDelta).toBe(0);
    }
  });

  it('counts receivedCount per occurrence, including duplicates in one entry', () => {
    const memory = [entry({ signalsReceived: ['A', 'A', 'B'] })];
    const result = deriveSignalExperience(memory);
    const a = result.find((r) => r.signal === 'A')!;
    const b = result.find((r) => r.signal === 'B')!;
    expect(a.receivedCount).toBe(2);
    expect(b.receivedCount).toBe(1);
  });

  it('counts followedByPredator/food/escape/attack from the {i, i+1} window, at most once per occurrence', () => {
    const memory = [
      entry({ tick: 0, signalsReceived: ['A'], outcome: 'NOTHING' }),
      entry({ tick: 1, signalsReceived: [], outcome: 'ATTACKED' }),
    ];
    const result = deriveSignalExperience(memory);
    const a = result.find((r) => r.signal === 'A')!;
    expect(a.receivedCount).toBe(1);
    expect(a.followedByAttack).toBe(1);
    expect(a.followedByPredator).toBe(1); // ATTACKED counts as a predator-related outcome too
  });

  it('does not look past the window (i, i+1)', () => {
    const memory = [
      entry({ tick: 0, signalsReceived: ['B'], outcome: 'NOTHING' }),
      entry({ tick: 1, signalsReceived: [], outcome: 'NOTHING' }),
      entry({ tick: 2, signalsReceived: [], outcome: 'ATTACKED' }),
    ];
    const result = deriveSignalExperience(memory);
    const b = result.find((r) => r.signal === 'B')!;
    expect(b.followedByAttack).toBe(0);
  });

  it('averages energyDelta over the window', () => {
    const memory = [
      entry({ tick: 0, signalsReceived: ['A'], energyDelta: 0.1 }),
      entry({ tick: 1, signalsReceived: [], energyDelta: -0.3 }),
    ];
    const result = deriveSignalExperience(memory);
    const a = result.find((r) => r.signal === 'A')!;
    expect(a.averageEnergyDelta).toBeCloseTo((0.1 + -0.3) / 2);
  });

  it('handles the last entry (no i+1) using a single-entry window', () => {
    const memory = [entry({ tick: 0, signalsReceived: ['A'], energyDelta: 0.5, outcome: 'FOOD_FOUND' })];
    const result = deriveSignalExperience(memory);
    const a = result.find((r) => r.signal === 'A')!;
    expect(a.receivedCount).toBe(1);
    expect(a.followedByFood).toBe(1);
    expect(a.averageEnergyDelta).toBeCloseTo(0.5);
  });
});

function dummyTraits() {
  return { curiosity: 0.5, aggression: 0.5, sociality: 0.5, signalTendency: 0.5, memoryLength: 10, speed: 0.5 };
}
