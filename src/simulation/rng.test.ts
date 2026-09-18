import { describe, expect, it } from 'vitest';
import { SeededRandom } from './rng';

describe('SeededRandom determinism', () => {
  it('produces identical sequences for the same seed', () => {
    const a = new SeededRandom(42);
    const b = new SeededRandom(42);
    const seqA = Array.from({ length: 20 }, () => a.next());
    const seqB = Array.from({ length: 20 }, () => b.next());
    expect(seqA).toEqual(seqB);
  });

  it('produces different sequences for different seeds', () => {
    const a = new SeededRandom(1);
    const b = new SeededRandom(2);
    const seqA = Array.from({ length: 20 }, () => a.next());
    const seqB = Array.from({ length: 20 }, () => b.next());
    expect(seqA).not.toEqual(seqB);
  });

  it('fork(label) is deterministic for the same parent state + label', () => {
    const a = new SeededRandom(7);
    const b = new SeededRandom(7);
    const forkedA = a.fork('world');
    const forkedB = b.fork('world');
    expect(forkedA.next()).toBeCloseTo(forkedB.next());
  });

  it('fork(label) yields independent streams for different labels', () => {
    const a = new SeededRandom(7).fork('world');
    const b = new SeededRandom(7).fork('food');
    const seqA = Array.from({ length: 10 }, () => a.next());
    const seqB = Array.from({ length: 10 }, () => b.next());
    expect(seqA).not.toEqual(seqB);
  });

  it('all values stay within [0, 1)', () => {
    const rng = new SeededRandom(123);
    for (let i = 0; i < 1000; i++) {
      const v = rng.next();
      expect(v).toBeGreaterThanOrEqual(0);
      expect(v).toBeLessThan(1);
    }
  });
});

describe('weighted sampling', () => {
  it('always returns a zero-weight-free key and respects proportions over many draws', () => {
    const rng = new SeededRandom(99);
    const counts: Record<string, number> = { a: 0, b: 0, c: 0 };
    const probs = { a: 0.1, b: 0.6, c: 0.3 };
    const draws = 20000;
    for (let i = 0; i < draws; i++) {
      const key = rng.weighted(probs);
      counts[key] += 1;
    }
    expect(counts.a / draws).toBeCloseTo(0.1, 1);
    expect(counts.b / draws).toBeCloseTo(0.6, 1);
    expect(counts.c / draws).toBeCloseTo(0.3, 1);
  });

  it('falls back to uniform when all weights are zero', () => {
    const rng = new SeededRandom(5);
    const counts: Record<string, number> = { a: 0, b: 0 };
    for (let i = 0; i < 2000; i++) {
      counts[rng.weighted({ a: 0, b: 0 })] += 1;
    }
    expect(counts.a).toBeGreaterThan(0);
    expect(counts.b).toBeGreaterThan(0);
  });

  it('is deterministic for a fixed seed', () => {
    const a = new SeededRandom(11);
    const b = new SeededRandom(11);
    const probs = { x: 0.5, y: 0.5 };
    const seqA = Array.from({ length: 50 }, () => a.weighted(probs));
    const seqB = Array.from({ length: 50 }, () => b.weighted(probs));
    expect(seqA).toEqual(seqB);
  });
});
