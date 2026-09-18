import { describe, expect, it } from 'vitest';
import { angleDiff, normalizeAngle, torusDelta, torusDistance, wrap } from './geometry';

describe('wrap', () => {
  it('wraps positive overflow into [0, size)', () => {
    expect(wrap(12, 10)).toBeCloseTo(2);
    expect(wrap(10, 10)).toBeCloseTo(0);
  });

  it('wraps negative values into [0, size)', () => {
    expect(wrap(-1, 10)).toBeCloseTo(9);
    expect(wrap(-11, 10)).toBeCloseTo(9);
  });

  it('leaves in-range values untouched', () => {
    expect(wrap(5, 10)).toBeCloseTo(5);
  });
});

describe('torusDelta / torusDistance', () => {
  it('takes the direct path when nothing wraps', () => {
    const d = torusDelta({ x: 1, y: 1 }, { x: 3, y: 4 }, 50);
    expect(d.x).toBeCloseTo(2);
    expect(d.y).toBeCloseTo(3);
  });

  it('takes the short way around the seam', () => {
    const d = torusDelta({ x: 1, y: 1 }, { x: 49, y: 1 }, 50);
    expect(d.x).toBeCloseTo(-2);
    expect(d.y).toBeCloseTo(0);
  });

  it('distance across the seam is short, not the naive long way', () => {
    const naive = Math.hypot(49 - 1, 0);
    const dist = torusDistance({ x: 1, y: 1 }, { x: 49, y: 1 }, 50);
    expect(dist).toBeCloseTo(2);
    expect(dist).toBeLessThan(naive);
  });

  it('handles both axes wrapping at once', () => {
    const dist = torusDistance({ x: 0.5, y: 0.5 }, { x: 49.5, y: 49.5 }, 50);
    expect(dist).toBeCloseTo(Math.hypot(1, 1));
  });
});

describe('normalizeAngle', () => {
  it('is a no-op inside (-π, π]', () => {
    expect(normalizeAngle(1)).toBeCloseTo(1);
    expect(normalizeAngle(Math.PI)).toBeCloseTo(Math.PI);
  });

  it('wraps values outside the range', () => {
    expect(normalizeAngle(Math.PI * 3)).toBeCloseTo(Math.PI);
    expect(normalizeAngle(-Math.PI * 3)).toBeCloseTo(Math.PI);
    expect(normalizeAngle(-Math.PI - 0.1)).toBeCloseTo(Math.PI - 0.1);
  });
});

describe('angleDiff', () => {
  it('is zero for equal angles', () => {
    expect(angleDiff(1, 1)).toBeCloseTo(0);
  });

  it('picks the shorter rotational direction across the wrap', () => {
    // From nearly +π to nearly -π is a tiny step forward, not almost a full turn.
    const d = angleDiff(-Math.PI + 0.1, Math.PI - 0.1);
    expect(d).toBeCloseTo(0.2);
  });

  it('is positive when a is counter-clockwise ("left") of b', () => {
    expect(angleDiff(Math.PI / 2, 0)).toBeCloseTo(Math.PI / 2);
  });
});
