/**
 * OutcomeSystem (spec §16 step 11). Priority order, first match wins.
 */
import type { BugAction, BugPerception, Outcome } from '../types';

export interface OutcomeInput {
  attacked: boolean;
  action: BugAction;
  perception: BugPerception;
  previousPerception: BugPerception | null;
  ate: boolean;
  energyDelta: number;
}

export function computeOutcome(input: OutcomeInput): Outcome {
  const { attacked, action, perception, previousPerception, ate, energyDelta } = input;

  if (attacked) return 'ATTACKED';
  if (perception.predatorDirection != null && action === 'FLEE' && !attacked) return 'ESCAPED';
  if (perception.predatorDirection != null) return 'PREDATOR_ENCOUNTER';
  if (ate) return 'ENERGY_GAINED';
  if (perception.foodDirection != null) return 'FOOD_FOUND';
  if (energyDelta <= -0.05) return 'ENERGY_LOST';
  if (previousPerception?.predatorDirection != null && perception.predatorDirection == null) return 'SAFE';
  return 'NOTHING';
}
