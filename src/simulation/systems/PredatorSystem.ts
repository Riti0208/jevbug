/**
 * PredatorSystem (spec §16 step 7). Rule-based: chase the nearest visible
 * bug, otherwise wander; attack when in range and off cooldown.
 */
import type { SimulationConfig } from '../config';
import { angleDiff, normalizeAngle, torusDelta, torusDistance, wrap } from '../geometry';
import { clamp, SeededRandom } from '../rng';
import { SpatialIndex } from '../SpatialIndex';
import type { Bug, Predator } from '../types';

export interface PredatorTickResult {
  attackedBugIds: Set<string>;
}

export function updatePredators(
  predators: Predator[],
  bugs: readonly Bug[],
  worldSize: number,
  config: SimulationConfig,
  rng: SeededRandom,
): PredatorTickResult {
  const attackedBugIds = new Set<string>();
  const aliveBugs = bugs.filter((b) => b.alive);
  const bugIndex = new SpatialIndex(worldSize, Math.max(config.predatorViewDistance, 1), aliveBugs, (b) => b.position);

  for (const predator of predators) {
    const candidates = bugIndex.queryRadius(predator.position, config.predatorViewDistance);
    let nearest: Bug | null = null;
    let nearestDist = Infinity;
    for (const candidate of candidates) {
      const d = torusDistance(predator.position, candidate.position, worldSize);
      if (d <= config.predatorViewDistance && d < nearestDist) {
        nearest = candidate;
        nearestDist = d;
      }
    }

    if (nearest) {
      predator.targetBugId = nearest.id;
      const delta = torusDelta(predator.position, nearest.position, worldSize);
      const targetAngle = Math.atan2(delta.y, delta.x);
      const diff = angleDiff(targetAngle, predator.direction);
      const turn = clamp(diff, -config.predatorTurnRate, config.predatorTurnRate);
      predator.direction = normalizeAngle(predator.direction + turn);
      predator.position = {
        x: wrap(predator.position.x + Math.cos(predator.direction) * config.predatorSpeed, worldSize),
        y: wrap(predator.position.y + Math.sin(predator.direction) * config.predatorSpeed, worldSize),
      };
      if (nearestDist <= config.predatorAttackRange && predator.attackCooldown === 0) {
        attackedBugIds.add(nearest.id);
        predator.attackCooldown = config.predatorAttackCooldown;
      }
    } else {
      predator.targetBugId = null;
      if (rng.bool(0.1)) {
        predator.direction = normalizeAngle(predator.direction + rng.range(-1, 1));
      }
      predator.position = {
        x: wrap(predator.position.x + Math.cos(predator.direction) * config.predatorSpeed * 0.6, worldSize),
        y: wrap(predator.position.y + Math.sin(predator.direction) * config.predatorSpeed * 0.6, worldSize),
      };
    }
  }

  // Decrement cooldowns for all predators, uniformly, after this tick's attacks.
  for (const predator of predators) {
    if (predator.attackCooldown > 0) predator.attackCooldown -= 1;
  }

  return { attackedBugIds };
}
