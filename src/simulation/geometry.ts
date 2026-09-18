/**
 * Torus geometry helpers. The world wraps at `worldSize` in both axes.
 */
import type { Vec2 } from './types';

const TWO_PI = Math.PI * 2;

/** Wrap a scalar into [0, size). */
export function wrap(v: number, size: number): number {
  let r = v % size;
  if (r < 0) r += size;
  return r;
}

/** Shortest vector from `from` to `to` on a torus of the given size. */
export function torusDelta(from: Vec2, to: Vec2, size: number): Vec2 {
  let dx = to.x - from.x;
  let dy = to.y - from.y;
  const half = size / 2;
  if (dx > half) dx -= size;
  else if (dx < -half) dx += size;
  if (dy > half) dy -= size;
  else if (dy < -half) dy += size;
  return { x: dx, y: dy };
}

/** Shortest distance between two points on a torus of the given size. */
export function torusDistance(a: Vec2, b: Vec2, size: number): number {
  const d = torusDelta(a, b, size);
  return Math.sqrt(d.x * d.x + d.y * d.y);
}

/** Normalize an angle into (-π, π]. */
export function normalizeAngle(a: number): number {
  let r = a % TWO_PI;
  if (r <= -Math.PI) r += TWO_PI;
  else if (r > Math.PI) r -= TWO_PI;
  return r;
}

/** Signed shortest angular difference a - b, normalized into (-π, π]. */
export function angleDiff(a: number, b: number): number {
  return normalizeAngle(a - b);
}
