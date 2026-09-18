/**
 * Uniform-random decision provider. Useful as a null baseline.
 */
import type { DecisionProvider } from './DecisionProvider';
import { uniformActionDecision, uniformSignalDecision } from './DecisionProvider';
import type { ActionDecision, Bug, BugPerception, DecisionRequest, DecisionResult, SignalDecision } from '../types';

export class RandomDecisionProvider implements DecisionProvider {
  readonly name = 'random';

  async decideBatch(requests: DecisionRequest[]): Promise<DecisionResult[]> {
    return requests.map((req) => ({
      bugId: req.bugId,
      action: uniformActionDecision(),
      signal: uniformSignalDecision(),
      source: 'random',
    }));
  }

  async decideAction(_bug: Bug, _perception: BugPerception): Promise<ActionDecision> {
    return uniformActionDecision();
  }

  async decideSignal(_bug: Bug, _perception: BugPerception): Promise<SignalDecision> {
    return uniformSignalDecision();
  }
}
