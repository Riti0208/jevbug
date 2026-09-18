/**
 * SignalSystem (spec §16 steps 2 & 4).
 *
 * Mode transforms never look at *which* signal was sent to decide anything
 * about meaning — SHUFFLED_COMMUNICATION replaces identity uniformly at
 * random, preserving only how many signals a receiver heard.
 */
import type { SimulationConfig } from '../config';
import type { SeededRandom } from '../rng';
import type { Bug, BugPerception, ExperimentMode, Signal, Vec2 } from '../types';
import { EMITTABLE_SIGNALS } from '../types';

export interface EmittedSignal {
  bugId: string;
  position: Vec2;
  signal: Exclude<Signal, 'NONE'>;
}

/** Apply the experiment mode's delivery policy to a freshly perceived bug. */
export function applyHeardSignalsMode(
  perception: BugPerception,
  mode: ExperimentMode,
  shuffleRng: SeededRandom,
): BugPerception {
  if (mode === 'NO_COMMUNICATION') {
    return perception.heardSignals.length === 0 ? perception : { ...perception, heardSignals: [] };
  }
  if (mode === 'SHUFFLED_COMMUNICATION') {
    if (perception.heardSignals.length === 0) return perception;
    return {
      ...perception,
      heardSignals: perception.heardSignals.map(() => ({ signal: shuffleRng.pick(EMITTABLE_SIGNALS) })),
    };
  }
  return perception;
}

/**
 * Resolve a bug's sampled signal decision into its final emitted signal,
 * charging `energySignal` and appending to `emitted` when it actually
 * signals. In NO_COMMUNICATION nothing is ever emitted.
 */
export function emitSignal(
  bug: Bug,
  sampledSignal: Signal,
  mode: ExperimentMode,
  config: SimulationConfig,
  emitted: EmittedSignal[],
): void {
  const actual: Signal = mode === 'NO_COMMUNICATION' ? 'NONE' : sampledSignal;
  bug.lastSignalEmitted = actual;
  if (actual !== 'NONE') {
    bug.energy += config.energySignal;
    emitted.push({ bugId: bug.id, position: { x: bug.position.x, y: bug.position.y }, signal: actual });
  }
}
