import { describe, expect, it } from 'vitest';
import { answersToDecisions, buildJevQuestions, buildJevState, stateCacheKey, toWireRequest } from './jevState';
import type { JevWireAnswer } from './jevProtocol';
import type { DecisionRequest, SignalDefinition } from '../types';
import { BUG_ACTIONS, SIGNALS } from '../types';

const AB_DEFS: SignalDefinition[] = [
  { signal: 'A', id: 'A', displayName: 'A' },
  { signal: 'B', id: 'B', displayName: 'B' },
];

const RELABELED_DEFS: SignalDefinition[] = [
  { signal: 'A', id: 'SIG_X7Q', displayName: 'A' },
  { signal: 'B', id: 'SIG_M2P', displayName: 'B' },
];

function richRequest(overrides: Partial<DecisionRequest> = {}): DecisionRequest {
  return {
    bugId: 'bug-42',
    tick: 118,
    creature: { energy: 0.3123, fear: 0.7189, age: 120, generation: 3, carryingFood: false },
    traits: { curiosity: 0.6234, aggression: 0.1444, sociality: 0.7777, signalTendency: 0.512, memoryLength: 20, speed: 0.5 },
    perception: {
      energy: 0.3123,
      fear: 0.7189,
      foodDirection: null,
      predatorDirection: 'left',
      nearbyBugCount: 3,
      heardSignals: [{ signal: 'B' }, { signal: 'B' }, { signal: 'A' }],
      previousAction: 'MOVE_FORWARD',
      previousOutcome: 'NOTHING',
    },
    signalExperience: [
      { signal: 'B', receivedCount: 8, followedByPredator: 5, followedByFood: 1, followedByEscape: 4, followedByAttack: 1, averageEnergyDelta: -0.0234 },
      { signal: 'A', receivedCount: 2, followedByPredator: 0, followedByFood: 2, followedByEscape: 0, followedByAttack: 0, averageEnergyDelta: 0.041 },
    ],
    recentMemory: Array.from({ length: 15 }, (_, i) => ({
      tick: 100 + i,
      perception: {
        energy: 0.5,
        fear: 0.1,
        foodDirection: null,
        predatorDirection: null,
        nearbyBugCount: 0,
        heardSignals: [],
        previousAction: null,
        previousOutcome: null,
      },
      signalsReceived: i % 3 === 0 ? (['B'] as const) : [],
      signalEmitted: i % 4 === 0 ? 'A' : 'NONE',
      action: 'MOVE_FORWARD' as const,
      outcome: 'NOTHING' as const,
      energyDelta: -0.0111,
    })),
    ...overrides,
  };
}

describe('buildJevState', () => {
  it('produces the documented snake_case shape, rounded to 2 decimals', () => {
    const state = buildJevState(richRequest(), AB_DEFS);

    expect(state.creature).toEqual({ energy: 0.31, fear: 0.72, age: 120, generation: 3, carrying_food: false });
    expect(state.traits).toEqual({ curiosity: 0.62, aggression: 0.14, sociality: 0.78, signal_tendency: 0.51 });
    expect(state.perception).toEqual({
      food_direction: null,
      predator_direction: 'left',
      nearby_bug_count: 3,
      heard_signals: ['B', 'B', 'A'],
      previous_action: 'MOVE_FORWARD',
      previous_outcome: 'NOTHING',
    });
  });

  it('omits age rounding (passes the integer through unchanged)', () => {
    const state = buildJevState(richRequest({ creature: { energy: 0.5, fear: 0.5, age: 137, generation: 1, carryingFood: false } }), AB_DEFS);
    expect((state.creature as Record<string, unknown>).age).toBe(137);
  });

  it('preserves duplicate heard_signals in order', () => {
    const state = buildJevState(richRequest(), AB_DEFS);
    expect((state.perception as Record<string, unknown>).heard_signals).toEqual(['B', 'B', 'A']);
  });

  it('includes recent_experience keyed by signal_<token>, rounded', () => {
    const state = buildJevState(richRequest(), AB_DEFS);
    expect(state.recent_experience).toEqual({
      signal_B: { received_count: 8, followed_by_predator: 5, followed_by_food: 1, followed_by_escape: 4, followed_by_attack: 1, average_energy_delta: -0.02 },
      signal_A: { received_count: 2, followed_by_predator: 0, followed_by_food: 2, followed_by_escape: 0, followed_by_attack: 0, average_energy_delta: 0.04 },
    });
  });

  it('caps recent_memory at 10 entries, most recent last', () => {
    const req = richRequest();
    const state = buildJevState(req, AB_DEFS);
    const memory = state.recent_memory as Array<Record<string, unknown>>;
    expect(memory).toHaveLength(10);
    expect(memory[memory.length - 1].tick).toBe(114); // last of the 15 generated entries (100..114)
  });

  it('maps recent_memory heard/emitted through the token relabeling', () => {
    const req = richRequest();
    const state = buildJevState(req, RELABELED_DEFS);
    const memory = state.recent_memory as Array<Record<string, unknown>>;
    // entry 0 -> tick 105 after slicing to last 10 (indices 5..14); i=5 => heard 'B' (i%3===0? 5%3=2 no), emitted i%4===0? 5%4=1 no => NONE
    const first = memory[0];
    expect(first.tick).toBe(105);
    expect(first.emitted).toBe('NONE');
    // find an entry with heard signal present, confirm it's the relabeled token, never canonical 'B'
    const withHeard = memory.find((m) => (m.heard as string[]).length > 0);
    expect(withHeard?.heard).toEqual(['SIG_M2P']);
    const withEmit = memory.find((m) => m.emitted !== 'NONE');
    expect(withEmit?.emitted).toBe('SIG_X7Q');
  });

  it('omits recent_experience and recent_memory entirely under NO_MEMORY (null fields)', () => {
    const state = buildJevState(richRequest({ signalExperience: null, recentMemory: null }), AB_DEFS);
    expect(state).not.toHaveProperty('recent_experience');
    expect(state).not.toHaveProperty('recent_memory');
  });

  it('includes an empty recent_experience object when memory is enabled but there is no experience yet', () => {
    const state = buildJevState(richRequest({ signalExperience: [] }), AB_DEFS);
    expect(state.recent_experience).toEqual({});
  });

  it('never includes bugId, tick, sender, or world keys', () => {
    const state = buildJevState(richRequest(), AB_DEFS);
    const json = JSON.stringify(state);
    expect(json).not.toMatch(/bugId/i);
    expect(json).not.toMatch(/"tick":118/); // the request's own tick must not leak into the wire state
    expect(state).not.toHaveProperty('bugId');
    expect(state).not.toHaveProperty('sender');
    expect(state).not.toHaveProperty('world');
  });
});

describe('buildJevQuestions', () => {
  it('describes actions mechanically and never mentions signals in action criteria', () => {
    const { action } = buildJevQuestions(AB_DEFS);
    for (const key of BUG_ACTIONS) {
      expect(action.criteria[key]).toBeTruthy();
      expect((action.criteria[key] as string).toLowerCase()).not.toContain('signal');
    }
  });

  it('gives signal tokens a null description and NONE a neutral one, using relabeled ids', () => {
    const { signal } = buildJevQuestions(RELABELED_DEFS);
    expect(signal.criteria).toEqual({ NONE: 'Emit no signal.', SIG_X7Q: null, SIG_M2P: null });
  });

  it('uses the exact allowed signal sentence, with real tokens substituted', () => {
    const { action, signal } = buildJevQuestions(RELABELED_DEFS);
    const sentence =
      'Nearby creatures may emit abstract signals named SIG_X7Q or SIG_M2P. These signals have no predefined meaning. You may use your own observed experience with these signals when making decisions.';
    expect(action.instructions as string).toContain(sentence);
    expect(signal.instructions as string).toContain(sentence);
  });
});

describe('integrity: no forbidden words, no sender/world leakage', () => {
  const FORBIDDEN_WORDS = [
    'danger',
    'warn',
    'warning',
    'alarm',
    'alert',
    'threat',
    'food signal',
    'predator signal',
    'means',
    'meaning',
    'indicates',
    'call',
    'cry',
  ];

  it('the serialized state+questions for a rich request contain none of the forbidden words, outside the one allowed signal disclaimer', () => {
    const req = richRequest();
    const wire = toWireRequest(req, RELABELED_DEFS);
    const serialized = JSON.stringify(wire);

    // The spec mandates exactly one sentence describing signals, and it happens to
    // contain "meaning" ("no predefined meaning"). Strip every occurrence of that
    // exact, required sentence, then verify nothing forbidden remains anywhere else.
    const ALLOWED_SENTENCE =
      'Nearby creatures may emit abstract signals named SIG_X7Q or SIG_M2P. These signals have no predefined meaning. You may use your own observed experience with these signals when making decisions.';
    expect(serialized).toContain(ALLOWED_SENTENCE);
    const withoutAllowedSentence = serialized.split(ALLOWED_SENTENCE).join('').toLowerCase();

    for (const word of FORBIDDEN_WORDS) {
      expect(withoutAllowedSentence.includes(word.toLowerCase())).toBe(false);
    }
  });

  it('never sends sender id, bugId, or world info; only heard_signals with duplicates preserved', () => {
    const req = richRequest();
    const wire = toWireRequest(req, RELABELED_DEFS);
    const serialized = JSON.stringify(wire.state);
    expect(serialized).not.toMatch(/sender/i);
    expect(serialized).not.toMatch(/bugId/);
    expect(serialized).not.toMatch(/world/i);
    expect((wire.state.perception as Record<string, unknown>).heard_signals).toEqual(['SIG_M2P', 'SIG_M2P', 'SIG_X7Q']);
  });

  it('signal criteria for the two tokens are null, and the "meaning" wording matches the allowed sentence only', () => {
    const wire = toWireRequest(richRequest(), RELABELED_DEFS);
    expect(wire.questions.signal.criteria.SIG_X7Q).toBeNull();
    expect(wire.questions.signal.criteria.SIG_M2P).toBeNull();
  });
});

describe('answersToDecisions', () => {
  it('normalizes full probability distributions and maps tokens back to canonical signals', () => {
    const answers: Record<string, JevWireAnswer> = {
      action: { type: 'choice', choice: 'MOVE_FORWARD', probabilities: { MOVE_FORWARD: 0.6, REST: 0.4 } },
      signal: { type: 'choice', choice: 'SIG_X7Q', probabilities: { NONE: 0.5, SIG_X7Q: 0.3, SIG_M2P: 0.2 } },
    };
    const decoded = answersToDecisions(answers, RELABELED_DEFS);
    expect(decoded).not.toBeNull();
    expect(decoded!.action.probabilities.MOVE_FORWARD).toBeCloseTo(0.6);
    expect(decoded!.action.probabilities.REST).toBeCloseTo(0.4);
    expect(decoded!.action.probabilities.EAT).toBe(0);
    expect(decoded!.signal.probabilities.A).toBeCloseTo(0.3);
    expect(decoded!.signal.probabilities.B).toBeCloseTo(0.2);
    expect(decoded!.signal.probabilities.NONE).toBeCloseTo(0.5);
    for (const key of SIGNALS) expect(decoded!.signal.probabilities[key]).toBeGreaterThanOrEqual(0);
  });

  it('one-hots on `choice` when probabilities are absent', () => {
    const answers: Record<string, JevWireAnswer> = {
      action: { type: 'choice', choice: 'FLEE' },
      signal: { type: 'choice', choice: 'NONE' },
    };
    const decoded = answersToDecisions(answers, AB_DEFS);
    expect(decoded!.action.probabilities.FLEE).toBe(1);
    expect(decoded!.signal.probabilities.NONE).toBe(1);
  });

  it('returns null for an unknown action choice', () => {
    const answers: Record<string, JevWireAnswer> = {
      action: { type: 'choice', choice: 'DANCE' },
      signal: { type: 'choice', choice: 'NONE' },
    };
    expect(answersToDecisions(answers, AB_DEFS)).toBeNull();
  });

  it('returns null for an unmappable signal token choice', () => {
    const answers: Record<string, JevWireAnswer> = {
      action: { type: 'choice', choice: 'REST' },
      signal: { type: 'choice', choice: 'SIG_UNKNOWN' },
    };
    expect(answersToDecisions(answers, RELABELED_DEFS)).toBeNull();
  });

  it('returns null when answers are missing', () => {
    expect(answersToDecisions(undefined, AB_DEFS)).toBeNull();
  });
});

describe('token relabeling round-trip', () => {
  it('toWireRequest -> answersToDecisions round-trips through relabeled tokens back to canonical A/B', () => {
    const req = richRequest();
    const wire = toWireRequest(req, RELABELED_DEFS);
    expect(Object.keys(wire.questions.signal.criteria).sort()).toEqual(['NONE', 'SIG_M2P', 'SIG_X7Q'].sort());

    const answers: Record<string, JevWireAnswer> = {
      action: { type: 'choice', choice: 'REST' },
      signal: { type: 'choice', choice: 'SIG_M2P' },
    };
    const decoded = answersToDecisions(answers, RELABELED_DEFS);
    expect(decoded!.signal.probabilities.B).toBe(1);
    expect(decoded!.signal.probabilities.A).toBe(0);
  });
});

describe('stateCacheKey', () => {
  it('is stable regardless of key insertion order', () => {
    const a = { creature: { energy: 0.5, fear: 0.1 }, traits: { curiosity: 0.2 } };
    const b = { traits: { curiosity: 0.2 }, creature: { fear: 0.1, energy: 0.5 } };
    expect(stateCacheKey(a)).toBe(stateCacheKey(b));
  });

  it('differs when values differ', () => {
    const a = { creature: { energy: 0.5 } };
    const b = { creature: { energy: 0.6 } };
    expect(stateCacheKey(a)).not.toBe(stateCacheKey(b));
  });

  it('is stable for the same rich request', () => {
    const state = buildJevState(richRequest(), AB_DEFS);
    expect(stateCacheKey(state)).toBe(stateCacheKey(state));
  });
});
