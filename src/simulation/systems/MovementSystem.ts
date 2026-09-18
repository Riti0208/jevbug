/**
 * MovementSystem (spec §16 step 6).
 *
 * Applies the sampled action's movement + its energy cost. EAT/PICKUP/DROP
 * resolution against the world (food removal/pickup/drop) happens later
 * (food interaction, step 8); only their energy cost is charged here.
 */
import type { SimulationConfig } from '../config';
import { normalizeAngle, torusDelta, wrap } from '../geometry';
import type { PerceptionIndices } from './PerceptionSystem';
import { findNearestPredator } from './PerceptionSystem';
import type { Bug, BugAction, WorldSnapshot } from '../types';

function moveForward(bug: Bug, distance: number, worldSize: number): void {
  bug.position = {
    x: wrap(bug.position.x + Math.cos(bug.direction) * distance, worldSize),
    y: wrap(bug.position.y + Math.sin(bug.direction) * distance, worldSize),
  };
}

export function applyMovement(
  bug: Bug,
  action: BugAction,
  snapshot: WorldSnapshot,
  indices: PerceptionIndices,
  config: SimulationConfig,
): void {
  const speed = config.bugBaseSpeed * (config.bugMinSpeedFactor + (1 - config.bugMinSpeedFactor) * bug.traits.speed);

  switch (action) {
    case 'MOVE_FORWARD':
      moveForward(bug, speed, snapshot.worldSize);
      bug.energy += config.energyMove;
      break;

    case 'TURN_LEFT':
      bug.direction = normalizeAngle(bug.direction + config.bugTurnAngle);
      bug.energy += config.energyTurn;
      break;

    case 'TURN_RIGHT':
      bug.direction = normalizeAngle(bug.direction - config.bugTurnAngle);
      bug.energy += config.energyTurn;
      break;

    case 'FLEE': {
      if (bug.lastPerception?.predatorDirection != null) {
        const nearest = findNearestPredator(bug, snapshot, indices, config);
        if (nearest) {
          const delta = torusDelta(nearest.item.position, bug.position, snapshot.worldSize);
          if (delta.x !== 0 || delta.y !== 0) {
            bug.direction = normalizeAngle(Math.atan2(delta.y, delta.x));
          }
        }
      }
      moveForward(bug, speed * config.fleeSpeedMultiplier, snapshot.worldSize);
      bug.energy += config.energyFlee;
      break;
    }

    case 'REST':
      bug.energy += config.energyRest;
      break;

    case 'EAT':
      // No cost of its own; resolved (and its energy gain applied) in food interaction.
      break;

    case 'PICKUP':
      bug.energy += config.energyPickup;
      break;

    case 'DROP':
      bug.energy += config.energyDrop;
      break;
  }

  bug.position = { x: wrap(bug.position.x, snapshot.worldSize), y: wrap(bug.position.y, snapshot.worldSize) };
}
