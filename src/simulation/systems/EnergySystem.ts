/**
 * EnergySystem (spec §16 step 10). Runs once per tick, per bug still alive
 * at this point (a bug already killed by a predator this tick does not get
 * a baseline/age/fear update).
 */
import { clamp } from '../rng';
import type { SimulationConfig } from '../config';
import type { Bug } from '../types';

export function applyEnergyUpdate(bug: Bug, config: SimulationConfig): void {
  bug.energy = clamp(bug.energy + config.energyBaseline, 0, 1);
  bug.age += 1;
  const predatorVisible = bug.lastPerception?.predatorDirection != null;
  bug.fear = clamp(bug.fear * config.fearDecay + (predatorVisible ? config.fearOnPredator : 0), 0, 1);
}
