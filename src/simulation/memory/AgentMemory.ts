/**
 * Per-bug episodic memory (spec §13, §34).
 *
 * Pure counts only — this module never attaches a "meaning" label to a
 * signal. `deriveSignalExperience` reports statistics an individual bug
 * could plausibly track about its own history: how often a signal preceded
 * particular *outcomes*, never what the signal "means".
 */
import type { Bug, MemoryEntry, Signal, SignalExperience } from '../types';
import { EMITTABLE_SIGNALS } from '../types';

/** Push a memory entry, trimming to the bug's own `traits.memoryLength`. */
export function pushMemory(bug: Bug, entry: MemoryEntry): void {
  bug.memory.push(entry);
  const maxLen = Math.max(0, bug.traits.memoryLength);
  while (bug.memory.length > maxLen) bug.memory.shift();
}

/** Last `window` memory entries (most recent last). */
export function recentMemory(memory: readonly MemoryEntry[], window: number): MemoryEntry[] {
  if (window <= 0) return [];
  return memory.slice(Math.max(0, memory.length - window));
}

const PREDATOR_OUTCOMES = new Set(['PREDATOR_ENCOUNTER', 'ATTACKED', 'ESCAPED']);
const FOOD_OUTCOMES = new Set(['FOOD_FOUND', 'ENERGY_GAINED']);

/**
 * One entry per emittable signal ('A' and 'B'), always both, zeros allowed.
 * For each occurrence of the signal in `signalsReceived` at memory index i,
 * looks at the window {entry i, entry i+1 if present} and counts, at most
 * once per occurrence, whether that window contained a predator-related
 * outcome, a food-related outcome, an escape, or an attack.
 */
export function deriveSignalExperience(memory: readonly MemoryEntry[]): SignalExperience[] {
  const results: SignalExperience[] = [];

  for (const signal of EMITTABLE_SIGNALS) {
    let receivedCount = 0;
    let followedByPredator = 0;
    let followedByFood = 0;
    let followedByEscape = 0;
    let followedByAttack = 0;
    let energyDeltaSum = 0;
    let windowCount = 0;

    for (let i = 0; i < memory.length; i++) {
      const entry = memory[i];
      const occurrences = countOccurrences(entry.signalsReceived, signal);
      if (occurrences === 0) continue;

      const window = i + 1 < memory.length ? [entry, memory[i + 1]] : [entry];
      const hasPredator = window.some(
        (e) => e.perception.predatorDirection != null || PREDATOR_OUTCOMES.has(e.outcome),
      );
      const hasFood = window.some((e) => FOOD_OUTCOMES.has(e.outcome));
      const hasEscape = window.some((e) => e.outcome === 'ESCAPED');
      const hasAttack = window.some((e) => e.outcome === 'ATTACKED');
      const windowEnergyDelta = window.reduce((sum, e) => sum + e.energyDelta, 0) / window.length;

      for (let k = 0; k < occurrences; k++) {
        receivedCount += 1;
        if (hasPredator) followedByPredator += 1;
        if (hasFood) followedByFood += 1;
        if (hasEscape) followedByEscape += 1;
        if (hasAttack) followedByAttack += 1;
        energyDeltaSum += windowEnergyDelta;
        windowCount += 1;
      }
    }

    results.push({
      signal,
      receivedCount,
      followedByPredator,
      followedByFood,
      followedByEscape,
      followedByAttack,
      averageEnergyDelta: windowCount > 0 ? energyDeltaSum / windowCount : 0,
    });
  }

  return results;
}

function countOccurrences(list: readonly Signal[], signal: Signal): number {
  let n = 0;
  for (const s of list) if (s === signal) n += 1;
  return n;
}
