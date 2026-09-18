/**
 * Pure translation between the simulation's `DecisionRequest` and Jev's wire
 * protocol (state + questions in, choice answers out). No I/O, no fetch, no
 * randomness — fully unit-testable.
 *
 * EXPERIMENTAL INTEGRITY (see repo-level spec, and jevState.test.ts for the
 * automated guard):
 *  - Never attach meaning to a signal. The ONLY sentence describing signals is
 *    `SIGNAL_SENTENCE` below (near-verbatim, per the integration spec).
 *  - Signal criteria descriptions are `null` for the tokens themselves.
 *  - Never include sender identity or any world-global data — only fields
 *    already present on `DecisionRequest`.
 *  - Action criteria describe actions mechanically and never mention signals.
 *  - Signal token relabeling: everything sent to Jev uses `SignalDefinition.id`;
 *    everything returned is mapped back to canonical 'A' | 'B'.
 */
import type {
  ActionDecision,
  BugAction,
  DecisionRequest,
  MemoryEntry,
  Signal,
  SignalDecision,
  SignalExperience,
  SignalDefinition,
} from '../types';
import { BUG_ACTIONS, SIGNALS } from '../types';
import { normalizeProbabilities } from './DecisionProvider';
import type { JevQuestion, JevWireAnswer, JevWireRequest, JsonObject, JsonValue } from './jevProtocol';

/** Cap on how many recent memory entries are ever sent (also enforced by config elsewhere). */
const MAX_RECENT_MEMORY = 10;

/**
 * The only allowed description of signals anywhere in a Jev prompt. Do not
 * paraphrase away from this — it is the boundary of what the model is told.
 */
function signalSentence(tokenA: string, tokenB: string): string {
  return `Nearby creatures may emit abstract signals named ${tokenA} or ${tokenB}. These signals have no predefined meaning. You may use your own observed experience with these signals when making decisions.`;
}

const ACTION_CRITERIA: Record<BugAction, string> = {
  MOVE_FORWARD: 'Move one step in the current heading.',
  TURN_LEFT: 'Rotate heading to the left.',
  TURN_RIGHT: 'Rotate heading to the right.',
  EAT: 'Eat food if it is within reach, or eat carried food.',
  PICKUP: 'Pick up food within reach to carry it.',
  DROP: 'Drop carried food here.',
  FLEE: 'Move quickly away from the perceived predator direction.',
  REST: 'Stay still and recover a little energy.',
};

function round2(n: number): number {
  return Math.round(n * 100) / 100;
}

interface ResolvedDefs {
  /** canonical 'A'/'B' -> token id sent to Jev */
  toToken: Record<Exclude<Signal, 'NONE'>, string>;
  /** token id -> canonical 'A'/'B' */
  toSignal: Record<string, Exclude<Signal, 'NONE'>>;
  tokenA: string;
  tokenB: string;
}

/** Fills in identity ('A' -> 'A', 'B' -> 'B') for any signal missing from `defs`. */
function resolveDefs(defs: SignalDefinition[]): ResolvedDefs {
  const toToken = { A: 'A', B: 'B' } as Record<Exclude<Signal, 'NONE'>, string>;
  for (const def of defs) {
    if (def.signal === 'A' || def.signal === 'B') toToken[def.signal] = def.id;
  }
  const toSignal: Record<string, Exclude<Signal, 'NONE'>> = {};
  toSignal[toToken.A] = 'A';
  toSignal[toToken.B] = 'B';
  return { toToken, toSignal, tokenA: toToken.A, tokenB: toToken.B };
}

function signalToToken(signal: Signal, resolved: ResolvedDefs): string {
  if (signal === 'NONE') return 'NONE';
  return resolved.toToken[signal];
}

function buildMemoryEntry(entry: MemoryEntry, resolved: ResolvedDefs): JsonObject {
  return {
    tick: entry.tick,
    heard: entry.signalsReceived.map((s) => signalToToken(s, resolved)),
    emitted: signalToToken(entry.signalEmitted, resolved),
    action: entry.action,
    outcome: entry.outcome,
    energy_delta: round2(entry.energyDelta),
  };
}

function buildExperienceEntry(exp: SignalExperience): JsonObject {
  return {
    received_count: exp.receivedCount,
    followed_by_predator: exp.followedByPredator,
    followed_by_food: exp.followedByFood,
    followed_by_escape: exp.followedByEscape,
    followed_by_attack: exp.followedByAttack,
    average_energy_delta: round2(exp.averageEnergyDelta),
  };
}

/** Builds the JSON `state` sent to Jev for one bug. Contains ONLY that bug's own data. */
export function buildJevState(req: DecisionRequest, defs: SignalDefinition[]): JsonObject {
  const resolved = resolveDefs(defs);

  const state: JsonObject = {
    creature: {
      energy: round2(req.creature.energy),
      fear: round2(req.creature.fear),
      age: req.creature.age,
      generation: req.creature.generation,
      carrying_food: req.creature.carryingFood,
    },
    traits: {
      curiosity: round2(req.traits.curiosity),
      aggression: round2(req.traits.aggression),
      sociality: round2(req.traits.sociality),
      signal_tendency: round2(req.traits.signalTendency),
    },
    perception: {
      food_direction: req.perception.foodDirection,
      predator_direction: req.perception.predatorDirection,
      nearby_bug_count: req.perception.nearbyBugCount,
      heard_signals: req.perception.heardSignals.map((obs) => signalToToken(obs.signal, resolved)),
      previous_action: req.perception.previousAction,
      previous_outcome: req.perception.previousOutcome,
    },
  };

  if (req.signalExperience !== null) {
    const recentExperience: JsonObject = {};
    for (const exp of req.signalExperience) {
      const token = signalToToken(exp.signal, resolved);
      recentExperience[`signal_${token}`] = buildExperienceEntry(exp);
    }
    state.recent_experience = recentExperience;
  }

  if (req.recentMemory !== null) {
    const capped = req.recentMemory.slice(-MAX_RECENT_MEMORY);
    state.recent_memory = capped.map((entry) => buildMemoryEntry(entry, resolved));
  }

  return state;
}

/** Builds the two 'choice' questions (action, signal) sent alongside the state. */
export function buildJevQuestions(defs: SignalDefinition[]): { action: JevQuestion; signal: JevQuestion } {
  const { tokenA, tokenB } = resolveDefs(defs);
  const sentence = signalSentence(tokenA, tokenB);

  const action: JevQuestion = {
    type: 'choice',
    instructions:
      "You are a small creature in a 2D world. Given the creature's current perceived state, traits and its own recent experience, choose its next action. " +
      sentence,
    criteria: { ...ACTION_CRITERIA },
  };

  const signal: JevQuestion = {
    type: 'choice',
    instructions:
      `Given the creature's current perceived state, choose whether it emits NONE, ${tokenA}, or ${tokenB}. ` +
      sentence +
      ' Emitting a signal costs a small amount of energy.',
    criteria: {
      NONE: 'Emit no signal.',
      [tokenA]: null,
      [tokenB]: null,
    },
  };

  return { action, signal };
}

/** Builds the full wire request (id = bugId) for one bug's decision. */
export function toWireRequest(req: DecisionRequest, defs: SignalDefinition[]): JevWireRequest {
  return {
    id: req.bugId,
    state: buildJevState(req, defs),
    questions: buildJevQuestions(defs),
  };
}

/** Maps Jev's raw choice answers back into simulation-native decisions. `null` if unusable. */
export function answersToDecisions(
  answers: Record<string, JevWireAnswer> | undefined,
  defs: SignalDefinition[],
): { action: ActionDecision; signal: SignalDecision } | null {
  if (!answers) return null;
  const actionAnswer = answers.action;
  const signalAnswer = answers.signal;
  if (!actionAnswer || actionAnswer.type !== 'choice') return null;
  if (!signalAnswer || signalAnswer.type !== 'choice') return null;

  const actionSet = new Set<string>(BUG_ACTIONS);
  let actionPartial: Partial<Record<BugAction, number>> = {};
  if (actionAnswer.probabilities) {
    let any = false;
    for (const [k, v] of Object.entries(actionAnswer.probabilities)) {
      if (actionSet.has(k)) {
        actionPartial[k as BugAction] = v;
        any = true;
      }
    }
    if (!any) return null;
  } else {
    if (!actionSet.has(actionAnswer.choice)) return null;
    actionPartial = { [actionAnswer.choice as BugAction]: 1 };
  }
  const action: ActionDecision = { probabilities: normalizeProbabilities(actionPartial, BUG_ACTIONS) };

  const { toSignal } = resolveDefs(defs);
  const mapToken = (tok: string): Signal | null => (tok === 'NONE' ? 'NONE' : (toSignal[tok] ?? null));

  let signalPartial: Partial<Record<Signal, number>> = {};
  if (signalAnswer.probabilities) {
    let any = false;
    for (const [k, v] of Object.entries(signalAnswer.probabilities)) {
      const sig = mapToken(k);
      if (sig) {
        signalPartial[sig] = (signalPartial[sig] ?? 0) + v;
        any = true;
      }
    }
    if (!any) return null;
  } else {
    const sig = mapToken(signalAnswer.choice);
    if (!sig) return null;
    signalPartial = { [sig]: 1 };
  }
  const signal: SignalDecision = { probabilities: normalizeProbabilities(signalPartial, SIGNALS) };

  return { action, signal };
}

/** Stable JSON serialization (sorted keys) used as an LRU cache key for identical states. */
export function stateCacheKey(state: JsonObject): string {
  return JSON.stringify(sortForKey(state));
}

function sortForKey(value: JsonValue): JsonValue {
  if (Array.isArray(value)) return value.map(sortForKey);
  if (value !== null && typeof value === 'object') {
    const out: JsonObject = {};
    for (const key of Object.keys(value).sort()) {
      out[key] = sortForKey((value as JsonObject)[key]);
    }
    return out;
  }
  return value;
}
