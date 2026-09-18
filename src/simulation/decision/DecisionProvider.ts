import type {
  ActionDecision,
  Bug,
  BugAction,
  BugPerception,
  DecisionRequest,
  DecisionResult,
  Signal,
  SignalDecision,
  SignalDefinition,
} from '../types';
import { BUG_ACTIONS, SIGNALS } from '../types';

/**
 * Abstract decision provider (spec §14, §30).
 *
 * The simulation core only talks to this interface. Implementations:
 *  - JevDecisionProvider    (calls Jev through /api/jev; all Jev-specific code lives there)
 *  - MockDecisionProvider   (deterministic heuristic, no signal semantics)
 *  - RandomDecisionProvider (uniform)
 *
 * `decideBatch` is the primary entry point: the simulation gathers all requests for a
 * tick, and the provider may batch/parallelise them however it wants. Results MUST be
 * returned for every request (same length, matching bugIds) — on failure, return a
 * fallback decision and tag `source` accordingly. Never throw for a single bug.
 */
export interface DecisionProvider {
  readonly name: string;
  decideBatch(requests: DecisionRequest[]): Promise<DecisionResult[]>;
  /** Convenience single-bug entry points (spec §14). Default impls wrap decideBatch. */
  decideAction(bug: Bug, perception: BugPerception): Promise<ActionDecision>;
  decideSignal(bug: Bug, perception: BugPerception): Promise<SignalDecision>;
  /**
   * Called once when the simulation starts so the provider knows which opaque tokens to
   * use for signals (spec §35). Providers that ignore relabeling may no-op.
   */
  configure?(options: DecisionProviderOptions): void;
  /** Release resources (abort in-flight requests). */
  dispose?(): void;
}

export interface DecisionProviderOptions {
  signalDefinitions: SignalDefinition[];
  /** 'NO_MEMORY' means requests will carry `signalExperience: null` and `recentMemory: null`. */
  memoryMode: 'WITH_MEMORY' | 'NO_MEMORY';
  seed: number;
}

export function uniformActionDecision(): ActionDecision {
  const p = 1 / BUG_ACTIONS.length;
  const probabilities = {} as Record<BugAction, number>;
  for (const a of BUG_ACTIONS) probabilities[a] = p;
  return { probabilities };
}

export function uniformSignalDecision(): SignalDecision {
  const p = 1 / SIGNALS.length;
  const probabilities = {} as Record<Signal, number>;
  for (const s of SIGNALS) probabilities[s] = p;
  return { probabilities };
}

/** Normalise a partial/unnormalised probability map into a full distribution over `keys`. */
export function normalizeProbabilities<K extends string>(
  partial: Partial<Record<K, number>>,
  keys: readonly K[],
): Record<K, number> {
  const out = {} as Record<K, number>;
  let total = 0;
  for (const k of keys) {
    const v = partial[k];
    const w = typeof v === 'number' && Number.isFinite(v) && v > 0 ? v : 0;
    out[k] = w;
    total += w;
  }
  if (total <= 0) {
    for (const k of keys) out[k] = 1 / keys.length;
    return out;
  }
  for (const k of keys) out[k] = out[k] / total;
  return out;
}
