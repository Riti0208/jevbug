/**
 * Deterministic heuristic decision provider used to validate the simulation
 * core without a Jev backend. It has NO signal semantics: the identity of
 * the emitted signal (A vs B) is never conditioned on anything — only the
 * overall tendency to signal at all depends on traits, and the remainder is
 * always split exactly equally between A and B.
 */
import type { DecisionProvider, DecisionProviderOptions } from './DecisionProvider';
import { normalizeProbabilities } from './DecisionProvider';
import { BUG_ACTIONS } from '../types';
import type {
  ActionDecision,
  Bug,
  BugAction,
  BugPerception,
  DecisionRequest,
  DecisionResult,
  Signal,
  SignalDecision,
} from '../types';

export class MockDecisionProvider implements DecisionProvider {
  readonly name = 'mock';

  // eslint-disable-next-line @typescript-eslint/no-unused-vars
  configure(_options: DecisionProviderOptions): void {
    // No-op: the mock never reads signal tokens/relabeling — see class doc.
  }

  async decideBatch(requests: DecisionRequest[]): Promise<DecisionResult[]> {
    return requests.map((req) => this.decideOne(req));
  }

  async decideAction(bug: Bug, perception: BugPerception): Promise<ActionDecision> {
    const [result] = await this.decideBatch([minimalRequest(bug, perception)]);
    return result.action;
  }

  async decideSignal(bug: Bug, perception: BugPerception): Promise<SignalDecision> {
    const [result] = await this.decideBatch([minimalRequest(bug, perception)]);
    return result.signal;
  }

  private decideOne(req: DecisionRequest): DecisionResult {
    const { perception, traits, creature } = req;
    const raw: Partial<Record<BugAction, number>> = {};
    for (const a of BUG_ACTIONS) raw[a] = 0.02;

    const hasPredator = perception.predatorDirection != null;
    const hasFood = perception.foodDirection != null;

    if (hasPredator) {
      raw.FLEE = (raw.FLEE ?? 0) + 0.6 + 0.3 * (1 - traits.aggression);
    }

    if (perception.foodDirection === 'front') {
      raw.MOVE_FORWARD = (raw.MOVE_FORWARD ?? 0) + 0.5;
      raw.EAT = (raw.EAT ?? 0) + 0.5;
    } else if (perception.foodDirection === 'left') {
      raw.TURN_LEFT = (raw.TURN_LEFT ?? 0) + 0.6;
    } else if (perception.foodDirection === 'right') {
      raw.TURN_RIGHT = (raw.TURN_RIGHT ?? 0) + 0.6;
    }

    if (!hasFood && !hasPredator) {
      raw.MOVE_FORWARD = (raw.MOVE_FORWARD ?? 0) + 0.4 + 0.3 * traits.curiosity;
      raw.TURN_LEFT = (raw.TURN_LEFT ?? 0) + 0.15;
      raw.TURN_RIGHT = (raw.TURN_RIGHT ?? 0) + 0.15;
    }

    if (creature.energy < 0.15 && !hasFood) {
      raw.REST = (raw.REST ?? 0) + 0.3;
    }

    if (creature.carryingFood && creature.energy < 0.5) {
      raw.EAT = (raw.EAT ?? 0) + 0.5;
    }

    const actionProbabilities = normalizeProbabilities(raw, BUG_ACTIONS);

    // Signal tendency only: identity (A vs B) is never conditioned on state.
    const noneP = 1 - 0.3 * traits.signalTendency;
    const remainder = 1 - noneP;
    const signalProbabilities: Record<Signal, number> = {
      NONE: noneP,
      A: remainder / 2,
      B: remainder / 2,
    };

    return {
      bugId: req.bugId,
      action: { probabilities: actionProbabilities },
      signal: { probabilities: signalProbabilities },
      source: 'mock',
    };
  }
}

function minimalRequest(bug: Bug, perception: BugPerception): DecisionRequest {
  return {
    bugId: bug.id,
    tick: 0,
    creature: {
      energy: bug.energy,
      fear: bug.fear,
      age: bug.age,
      generation: bug.generation,
      carryingFood: bug.carryingFood,
    },
    traits: bug.traits,
    perception,
    signalExperience: null,
    recentMemory: null,
  };
}
