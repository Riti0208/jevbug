/**
 * DeathSystem (spec §16 step 14). Predator kills are already recorded (and
 * `bug.alive` already set false) by the time this runs — it only adds
 * STARVATION / OLD_AGE and then compacts `world.bugs`.
 */
import type { World } from '../World';
import type { SimulationConfig } from '../config';
import type { DeathRecord } from '../types';

export function applyDeaths(world: World, config: SimulationConfig): DeathRecord[] {
  const records: DeathRecord[] = [];

  for (const bug of world.bugs) {
    if (!bug.alive) continue;
    let cause: DeathRecord['cause'] | null = null;
    if (bug.energy <= 0) {
      cause = 'STARVATION';
    } else if (config.maxAge > 0 && bug.age >= config.maxAge) {
      cause = 'OLD_AGE';
    }
    if (cause) {
      bug.alive = false;
      records.push({ tick: world.tick, bugId: bug.id, cause, age: bug.age, generation: bug.generation });
    }
  }

  world.bugs = world.bugs.filter((b) => b.alive);
  return records;
}
