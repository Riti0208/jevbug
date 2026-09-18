/**
 * PerceptionSystem (spec §7).
 *
 * Computes exactly what a bug is allowed to know this tick. Never exposes
 * anything outside `bugViewDistance` / `bugSignalDistance`, never exposes a
 * sender's id or perception, and never labels a signal with a concept.
 */
import type { SimulationConfig } from '../config';
import { angleDiff, torusDelta, torusDistance } from '../geometry';
import { SpatialIndex } from '../SpatialIndex';
import type { Bug, BugPerception, Food, Predator, RelativeDirection, Vec2, WorldSnapshot } from '../types';

export interface PerceptionIndices {
  foodIndex: SpatialIndex<Food>;
  bugIndex: SpatialIndex<Bug>;
  predatorIndex: SpatialIndex<Predator>;
}

/** Build (once per tick) the spatial indices perception queries run against. */
export function buildPerceptionIndices(
  snapshot: WorldSnapshot,
  config: SimulationConfig,
): PerceptionIndices {
  const maxDistance = Math.max(
    config.bugViewDistance,
    config.predatorViewDistance,
    config.bugNeighborDistance,
    config.bugSignalDistance,
    1,
  );
  const aliveBugs = snapshot.bugs.filter((b) => b.alive);
  return {
    foodIndex: new SpatialIndex(snapshot.worldSize, maxDistance, snapshot.foods, (f) => f.position),
    bugIndex: new SpatialIndex(snapshot.worldSize, maxDistance, aliveBugs, (b) => b.position),
    predatorIndex: new SpatialIndex(snapshot.worldSize, maxDistance, snapshot.predators, (p) => p.position),
  };
}

function classifyDirection(
  fromPos: Vec2,
  fromDirection: number,
  toPos: Vec2,
  worldSize: number,
  frontConeHalfAngle: number,
): RelativeDirection {
  const delta = torusDelta(fromPos, toPos, worldSize);
  const angleToTarget = Math.atan2(delta.y, delta.x);
  const d = angleDiff(angleToTarget, fromDirection);
  if (Math.abs(d) <= frontConeHalfAngle) return 'front';
  return d > 0 ? 'left' : 'right';
}

export interface NearestMatch<T> {
  item: T;
  distance: number;
}

export function findNearestFood(
  bug: Bug,
  snapshot: WorldSnapshot,
  indices: PerceptionIndices,
  config: SimulationConfig,
): NearestMatch<Food> | null {
  return findNearest(bug.position, indices.foodIndex, config.bugViewDistance, snapshot.worldSize);
}

export function findNearestPredator(
  bug: Bug,
  snapshot: WorldSnapshot,
  indices: PerceptionIndices,
  config: SimulationConfig,
): NearestMatch<Predator> | null {
  return findNearest(bug.position, indices.predatorIndex, config.bugViewDistance, snapshot.worldSize);
}

function findNearest<T extends { position: Vec2 }>(
  fromPos: Vec2,
  index: SpatialIndex<T>,
  maxDistance: number,
  worldSize: number,
): NearestMatch<T> | null {
  const candidates = index.queryRadius(fromPos, maxDistance);
  let best: T | null = null;
  let bestDist = Infinity;
  for (const candidate of candidates) {
    const d = torusDistance(fromPos, candidate.position, worldSize);
    if (d <= maxDistance && d < bestDist) {
      bestDist = d;
      best = candidate;
    }
  }
  return best ? { item: best, distance: bestDist } : null;
}

function countNearbyBugs(
  bug: Bug,
  indices: PerceptionIndices,
  config: SimulationConfig,
  worldSize: number,
): number {
  const candidates = indices.bugIndex.queryRadius(bug.position, config.bugNeighborDistance);
  let count = 0;
  for (const other of candidates) {
    if (other.id === bug.id) continue;
    if (torusDistance(bug.position, other.position, worldSize) <= config.bugNeighborDistance) count += 1;
  }
  return count;
}

const round3 = (v: number): number => Math.round(v * 1000) / 1000;

/**
 * Raw perception for `bug` this tick, including heard signals directly from
 * `snapshot.signalsInFlight` (self-exclusion + range filter, duplicates kept,
 * order preserved). Experiment-mode transforms (NO_COMMUNICATION,
 * SHUFFLED_COMMUNICATION) are applied by the caller (Simulation.step),
 * because they are policy about delivery, not about what physically reached
 * the bug.
 */
export function perceiveBug(
  bug: Bug,
  snapshot: WorldSnapshot,
  indices: PerceptionIndices,
  config: SimulationConfig,
): BugPerception {
  const nearestFood = findNearestFood(bug, snapshot, indices, config);
  const nearestPredator = findNearestPredator(bug, snapshot, indices, config);

  const foodDirection = nearestFood
    ? classifyDirection(bug.position, bug.direction, nearestFood.item.position, snapshot.worldSize, config.frontConeHalfAngle)
    : null;
  const predatorDirection = nearestPredator
    ? classifyDirection(bug.position, bug.direction, nearestPredator.item.position, snapshot.worldSize, config.frontConeHalfAngle)
    : null;

  const heardSignals: BugPerception['heardSignals'] = [];
  for (const emitted of snapshot.signalsInFlight) {
    if (emitted.bugId === bug.id) continue;
    if (torusDistance(bug.position, emitted.position, snapshot.worldSize) <= config.bugSignalDistance) {
      heardSignals.push({ signal: emitted.signal });
    }
  }

  return {
    energy: round3(bug.energy),
    fear: round3(bug.fear),
    foodDirection,
    predatorDirection,
    nearbyBugCount: countNearbyBugs(bug, indices, config, snapshot.worldSize),
    heardSignals,
    previousAction: bug.lastAction,
    previousOutcome: bug.lastOutcome,
  };
}
