import { describe, expect, it } from 'vitest';
import { SignalWavePool } from './SignalParticles';
import type { RenderSignal } from '@/simulation/types';

function sig(overrides: Partial<RenderSignal> = {}): RenderSignal {
  return { id: 'bug-1', x: 5, y: 5, signal: 'A', tick: 1, ...overrides };
}

describe('SignalWavePool', () => {
  it('starts empty', () => {
    const pool = new SignalWavePool(700, 8);
    expect(pool.size).toBe(0);
    expect(pool.getActive(0)).toEqual([]);
  });

  it('ingests a new signal and stamps it with the given nowMs', () => {
    const pool = new SignalWavePool(700, 8);
    pool.ingest([sig()], 1000);
    expect(pool.size).toBe(1);
    const active = pool.getActive(1000);
    expect(active).toHaveLength(1);
    expect(active[0].radius).toBeCloseTo(0);
    expect(active[0].opacity).toBeCloseTo(1);
    expect(active[0].kind).toBe(0);
  });

  it('maps signal B to kind 1', () => {
    const pool = new SignalWavePool(700, 8);
    pool.ingest([sig({ signal: 'B' })], 1000);
    expect(pool.getActive(1000)[0].kind).toBe(1);
  });

  it('does not restart a wave already tracked under the same id:tick key', () => {
    const pool = new SignalWavePool(700, 8);
    pool.ingest([sig()], 1000);
    pool.ingest([sig()], 5000); // same id+tick, arrives "late" (e.g. redundant snapshot)
    expect(pool.size).toBe(1);
    const active = pool.getActive(1000 + 350); // 350ms after the true start
    expect(active[0].opacity).toBeCloseTo(0.5, 1);
  });

  it('treats different ticks from the same bug as distinct waves', () => {
    const pool = new SignalWavePool(700, 8);
    pool.ingest([sig({ tick: 1 })], 1000);
    pool.ingest([sig({ tick: 2 })], 1200);
    expect(pool.size).toBe(2);
  });

  it('radius eases out with easeOutCubic from 0 to signalRadius over the lifetime', () => {
    const pool = new SignalWavePool(1000, 10);
    pool.ingest([sig()], 0);
    const atStart = pool.getActive(0)[0];
    const atHalf = pool.getActive(500)[0];
    const atEnd = pool.getActive(999)[0];
    expect(atStart.radius).toBeCloseTo(0);
    // easeOutCubic(0.5) = 1 - 0.5^3 = 0.875
    expect(atHalf.radius).toBeCloseTo(10 * 0.875, 5);
    expect(atEnd.radius).toBeGreaterThan(atHalf.radius);
    expect(atEnd.radius).toBeLessThanOrEqual(10);
  });

  it('opacity fades linearly from 1 to 0 over the lifetime', () => {
    const pool = new SignalWavePool(1000, 10);
    pool.ingest([sig()], 0);
    expect(pool.getActive(0)[0].opacity).toBeCloseTo(1);
    expect(pool.getActive(250)[0].opacity).toBeCloseTo(0.75);
    expect(pool.getActive(750)[0].opacity).toBeCloseTo(0.25);
  });

  it('drops a wave from getActive once its lifetime has fully elapsed', () => {
    const pool = new SignalWavePool(700, 8);
    pool.ingest([sig()], 0);
    expect(pool.getActive(699)).toHaveLength(1);
    expect(pool.getActive(700)).toHaveLength(0);
    expect(pool.getActive(10000)).toHaveLength(0);
  });

  it('prune() removes expired waves from internal storage', () => {
    const pool = new SignalWavePool(700, 8);
    pool.ingest([sig()], 0);
    expect(pool.size).toBe(1);
    pool.prune(699);
    expect(pool.size).toBe(1);
    pool.prune(700);
    expect(pool.size).toBe(0);
  });

  it('tracks multiple concurrent waves independently', () => {
    const pool = new SignalWavePool(700, 8);
    pool.ingest([sig({ id: 'a', tick: 1, signal: 'A' })], 0);
    pool.ingest([sig({ id: 'b', tick: 1, signal: 'B' })], 350);
    const active = pool.getActive(400);
    expect(active).toHaveLength(2);
    const a = active.find((w) => w.key === 'a:1')!;
    const b = active.find((w) => w.key === 'b:1')!;
    expect(a.opacity).toBeLessThan(b.opacity); // a started earlier, has faded more
  });

  it('clear() removes all waves', () => {
    const pool = new SignalWavePool(700, 8);
    pool.ingest([sig()], 0);
    pool.clear();
    expect(pool.size).toBe(0);
  });

  it('setLifetimeMs/setRadius affect subsequently computed waves', () => {
    const pool = new SignalWavePool(1000, 10);
    pool.ingest([sig()], 0);
    pool.setLifetimeMs(2000);
    pool.setRadius(20);
    const active = pool.getActive(1000); // was 100% through old lifetime, now 50% through new one
    expect(active[0].opacity).toBeCloseTo(0.5);
    // easeOutCubic(0.5) = 0.875, radius base is now 20
    expect(active[0].radius).toBeCloseTo(20 * 0.875, 5);
  });
});
