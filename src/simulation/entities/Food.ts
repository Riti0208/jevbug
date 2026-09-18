import type { Food, Vec2 } from '../types';

export function createFood(id: string, position: Vec2, value: number): Food {
  return { id, position, value };
}
