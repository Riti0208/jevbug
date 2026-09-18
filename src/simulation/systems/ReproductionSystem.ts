/**
 * ReproductionSystem (spec §16 step 13, spec §17 mutation).
 */
import { inheritTraits, createBug } from '../entities/Bug';
import { wrap } from '../geometry';
import type { World } from '../World';
import type { SimulationConfig } from '../config';

/** Applies reproduction for every currently-alive bug; returns the number of births. */
export function applyReproduction(world: World, config: SimulationConfig): number {
  let births = 0;
  const parents = world.bugs.filter((b) => b.alive);
  let aliveCount = parents.length;

  for (const parent of parents) {
    if (!parent.alive) continue;
    if (aliveCount >= config.maxPopulation) continue;
    if (parent.energy < config.reproductionEnergyThreshold) continue;
    if (parent.age < config.reproductionMinAge) continue;

    parent.energy -= config.reproductionCost;

    const offsetAngle = world.rng.world.range(0, Math.PI * 2);
    const offsetRadius = world.rng.world.range(0, 0.5);
    const childPosition = {
      x: wrap(parent.position.x + Math.cos(offsetAngle) * offsetRadius, config.worldSize),
      y: wrap(parent.position.y + Math.sin(offsetAngle) * offsetRadius, config.worldSize),
    };
    const childDirection = world.rng.world.range(-Math.PI, Math.PI);
    const childTraits = inheritTraits(parent.traits, world.rng.mutation, config);
    const child = createBug(
      world.nextBugId(),
      childPosition,
      childDirection,
      childTraits,
      config,
      parent.generation + 1,
      config.initialChildEnergy,
    );

    world.bugs.push(child);
    births += 1;
    aliveCount += 1;
  }

  return births;
}
