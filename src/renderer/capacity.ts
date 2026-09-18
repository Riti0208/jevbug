/**
 * Pure capacity-growth helper shared by every growable typed-array buffer in the renderer
 * (bug/predator/food Points geometries, the signal InstancedMesh). Kept dependency-free
 * (no three.js, no DOM) so it can be unit-tested directly.
 */

/**
 * Given the current allocated capacity and the number of live items that must fit,
 * return the capacity to allocate: unchanged if it already fits, otherwise the next
 * power of two at or above `needed` (and at or above `minCapacity`).
 */
export function growCapacity(current: number, needed: number, minCapacity = 16): number {
  if (needed <= current) return current;
  let cap = Math.max(current, minCapacity, 1);
  while (cap < needed) cap *= 2;
  return cap;
}
