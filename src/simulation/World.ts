/**
 * World: mutable simulation state (spec §16). Owns the RNG streams, entity
 * arrays and id generation. Systems mutate a World's arrays in place;
 * `snapshot()` gives a read-only view for the decision phase.
 */
import type { SimulationConfig } from './config';
import { createBug, createInitialTraits } from './entities/Bug';
import { createFood } from './entities/Food';
import { createPredator } from './entities/Predator';
import { SeededRandom } from './rng';
import type { Bug, Food, Predator, Signal, Vec2, WorldSnapshot } from './types';

export interface WorldRngStreams {
  world: SeededRandom;
  food: SeededRandom;
  predator: SeededRandom;
  mutation: SeededRandom;
  sampling: SeededRandom;
  shuffle: SeededRandom;
  traits: SeededRandom;
}

export interface InFlightSignal {
  bugId: string;
  position: Vec2;
  signal: Exclude<Signal, 'NONE'>;
}

export class World {
  readonly config: SimulationConfig;
  readonly rng: WorldRngStreams;

  tick = 0;
  bugs: Bug[] = [];
  predators: Predator[] = [];
  foods: Food[] = [];
  signalsInFlight: InFlightSignal[] = [];

  /** Fractional food-spawn accumulator carried across ticks. */
  foodSpawnAccumulator = 0;

  private bugIdCounter = 0;
  private foodIdCounter = 0;

  constructor(config: SimulationConfig, rng: SeededRandom) {
    this.config = config;
    this.rng = {
      world: rng.fork('world'),
      food: rng.fork('food'),
      predator: rng.fork('predator'),
      mutation: rng.fork('mutation'),
      sampling: rng.fork('sampling'),
      shuffle: rng.fork('shuffle'),
      traits: rng.fork('traits'),
    };

    for (let i = 0; i < config.initialBugs; i++) {
      const position: Vec2 = {
        x: this.rng.world.range(0, config.worldSize),
        y: this.rng.world.range(0, config.worldSize),
      };
      const direction = this.rng.world.range(-Math.PI, Math.PI);
      const traits = createInitialTraits(this.rng.traits, config);
      this.bugs.push(
        createBug(this.nextBugId(), position, direction, traits, config, 0, config.initialBugEnergy),
      );
    }

    for (let i = 0; i < config.initialPredators; i++) {
      const position: Vec2 = {
        x: this.rng.predator.range(0, config.worldSize),
        y: this.rng.predator.range(0, config.worldSize),
      };
      const direction = this.rng.predator.range(-Math.PI, Math.PI);
      this.predators.push(createPredator(`predator-${i + 1}`, position, direction));
    }

    for (let i = 0; i < config.initialFood; i++) {
      const position: Vec2 = {
        x: this.rng.food.range(0, config.worldSize),
        y: this.rng.food.range(0, config.worldSize),
      };
      this.foods.push(createFood(this.nextFoodId(), position, config.foodValue));
    }
  }

  nextBugId(): string {
    this.bugIdCounter += 1;
    return `bug-${this.bugIdCounter}`;
  }

  nextFoodId(): string {
    this.foodIdCounter += 1;
    return `food-${this.foodIdCounter}`;
  }

  aliveBugs(): Bug[] {
    return this.bugs.filter((b) => b.alive);
  }

  snapshot(): WorldSnapshot {
    return {
      tick: this.tick,
      worldSize: this.config.worldSize,
      bugs: this.bugs,
      predators: this.predators,
      foods: this.foods,
      signalsInFlight: this.signalsInFlight,
    };
  }
}
