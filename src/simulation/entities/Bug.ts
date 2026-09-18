import { clamp } from '../rng';
import type { SeededRandom } from '../rng';
import type { SimulationConfig } from '../config';
import type { Bug, BugTraits, Vec2 } from '../types';

/** Random initial traits for a bug created at world genesis. */
export function createInitialTraits(rng: SeededRandom, config: SimulationConfig): BugTraits {
  return {
    curiosity: rng.next(),
    aggression: rng.next(),
    sociality: rng.next(),
    signalTendency: rng.next(),
    memoryLength: rng.int(config.memoryLengthMin, config.memoryLengthMax),
    speed: rng.next(),
  };
}

/** Mutate a parent's traits for a child (spec §17: gaussian noise per trait). */
export function inheritTraits(
  parent: BugTraits,
  rng: SeededRandom,
  config: SimulationConfig,
): BugTraits {
  const mutate01 = (v: number): number => clamp(v + rng.gaussian(0, config.mutationRate), 0, 1);
  const memoryLength = clamp(
    Math.round(parent.memoryLength + rng.gaussian(0, config.mutationRate * 20)),
    config.memoryLengthMin,
    config.memoryLengthMax,
  );
  return {
    curiosity: mutate01(parent.curiosity),
    aggression: mutate01(parent.aggression),
    sociality: mutate01(parent.sociality),
    signalTendency: mutate01(parent.signalTendency),
    memoryLength,
    speed: mutate01(parent.speed),
  };
}

export function createBug(
  id: string,
  position: Vec2,
  direction: number,
  traits: BugTraits,
  _config: SimulationConfig,
  generation = 0,
  energy = 0.6,
): Bug {
  return {
    id,
    position,
    direction,
    energy,
    fear: 0,
    age: 0,
    carryingFood: false,
    traits,
    memory: [],
    generation,
    alive: true,
    lastPerception: null,
    lastActionDecision: null,
    lastSignalDecision: null,
    lastAction: null,
    lastSignalEmitted: 'NONE',
    lastOutcome: null,
  };
}
