import { describe, expect, it } from 'vitest';
import {
  addPair,
  conditionalProbabilities,
  emptyJointCounts,
  entropy,
  jointCounts,
  mutualInformation,
  mutualInformationFromCounts,
  removePair,
  rowDistribution,
} from './MutualInformation';

/** Deterministic LCG so "independent" tests are reproducible, not flaky. */
function makeLcg(seed: number) {
  let s = seed >>> 0;
  return () => {
    s = (s * 1664525 + 1013904223) >>> 0;
    return s / 4294967296;
  };
}

describe('entropy', () => {
  it('is 0 for empty input', () => {
    expect(entropy([])).toBe(0);
  });

  it('is 0 for a constant sequence', () => {
    expect(entropy(['x', 'x', 'x', 'x'])).toBe(0);
  });

  it('is 1 bit for a balanced binary sequence', () => {
    expect(entropy(['a', 'b', 'a', 'b'])).toBeCloseTo(1, 10);
  });
});

describe('mutualInformation', () => {
  it('is 0 for empty input', () => {
    expect(mutualInformation([], [])).toBe(0);
  });

  it('throws on mismatched lengths', () => {
    expect(() => mutualInformation(['a'], ['a', 'b'])).toThrow();
  });

  it('is ~0 for independent variables', () => {
    const rngX = makeLcg(1);
    const rngY = makeLcg(2);
    const xs: string[] = [];
    const ys: string[] = [];
    for (let i = 0; i < 20_000; i++) {
      xs.push(rngX() < 0.5 ? 'x0' : 'x1');
      ys.push(rngY() < 0.5 ? 'y0' : 'y1');
    }
    const mi = mutualInformation(xs, ys);
    expect(mi).toBeLessThan(0.005);
  });

  it('is 1 bit for a perfectly dependent balanced binary pair', () => {
    const xs: string[] = [];
    const ys: string[] = [];
    for (let i = 0; i < 1000; i++) {
      const v = i % 2 === 0 ? 'x0' : 'x1';
      xs.push(v);
      ys.push(v === 'x0' ? 'y0' : 'y1');
    }
    expect(mutualInformation(xs, ys)).toBeCloseTo(1, 6);
  });

  it('matches a hand-computed 2x2 table', () => {
    // P(00)=0.4, P(01)=0.1, P(10)=0.1, P(11)=0.4 -> I(X;Y) ~= 0.278072 bits
    const pairs: Array<[string, string]> = [];
    for (let i = 0; i < 40; i++) pairs.push(['0', '0']);
    for (let i = 0; i < 10; i++) pairs.push(['0', '1']);
    for (let i = 0; i < 10; i++) pairs.push(['1', '0']);
    for (let i = 0; i < 40; i++) pairs.push(['1', '1']);
    const xs = pairs.map((p) => p[0]);
    const ys = pairs.map((p) => p[1]);
    expect(mutualInformation(xs, ys)).toBeCloseTo(0.278072, 5);
  });
});

describe('jointCounts / addPair / removePair', () => {
  it('builds counts and total from pairs', () => {
    const joint = jointCounts([
      ['a', 'x'],
      ['a', 'x'],
      ['a', 'y'],
      ['b', 'y'],
    ]);
    expect(joint.total).toBe(4);
    expect(joint.counts.get('a')?.get('x')).toBe(2);
    expect(joint.counts.get('a')?.get('y')).toBe(1);
    expect(joint.counts.get('b')?.get('y')).toBe(1);
  });

  it('removePair undoes addPair and cleans up empty rows', () => {
    const joint = emptyJointCounts();
    addPair(joint, 'a', 'x');
    addPair(joint, 'a', 'x');
    removePair(joint, 'a', 'x');
    expect(joint.total).toBe(1);
    expect(joint.counts.get('a')?.get('x')).toBe(1);
    removePair(joint, 'a', 'x');
    expect(joint.total).toBe(0);
    expect(joint.counts.has('a')).toBe(false);
  });

  it('removePair on an unknown pair is a safe no-op', () => {
    const joint = emptyJointCounts();
    removePair(joint, 'a', 'x');
    expect(joint.total).toBe(0);
  });

  it('mutualInformationFromCounts matches mutualInformation built the slow way', () => {
    const xs = ['a', 'a', 'b', 'b', 'a', 'b'];
    const ys = ['x', 'x', 'y', 'x', 'y', 'y'];
    const joint = jointCounts(xs.map((x, i) => [x, ys[i]] as const));
    expect(mutualInformationFromCounts(joint)).toBeCloseTo(mutualInformation(xs, ys), 10);
  });
});

describe('conditionalProbabilities', () => {
  it('computes P(y | x)', () => {
    const table = conditionalProbabilities([
      ['predator', 'A'],
      ['predator', 'A'],
      ['predator', 'B'],
      ['no-predator', 'B'],
      ['no-predator', 'B'],
    ]);
    expect(table['predator']['A']).toBeCloseTo(2 / 3, 10);
    expect(table['predator']['B']).toBeCloseTo(1 / 3, 10);
    expect(table['no-predator']['B']).toBeCloseTo(1, 10);
  });
});

describe('rowDistribution', () => {
  it('returns 0 for keys never seen and normalizes over the given key set', () => {
    const joint = jointCounts([
      ['true', 'A'],
      ['true', 'A'],
      ['true', 'B'],
    ]);
    const dist = rowDistribution(joint, 'true', ['NONE', 'A', 'B']);
    expect(dist.NONE).toBe(0);
    expect(dist.A).toBeCloseTo(2 / 3, 10);
    expect(dist.B).toBeCloseTo(1 / 3, 10);
  });

  it('returns all 0s for an x key that was never observed', () => {
    const joint = jointCounts([['true', 'A']]);
    const dist = rowDistribution(joint, 'false', ['NONE', 'A', 'B']);
    expect(dist).toEqual({ NONE: 0, A: 0, B: 0 });
  });
});
