import type { Predator, Vec2 } from '../types';

export function createPredator(id: string, position: Vec2, direction: number): Predator {
  return {
    id,
    position,
    direction,
    targetBugId: null,
    attackCooldown: 0,
  };
}
