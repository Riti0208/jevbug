/**
 * Simulation Core barrel (spec §16). Re-exports the public surface other
 * modules (renderer, metrics, experiments, Jev provider) code against.
 */
export * from './types';
export * from './config';
export { SeededRandom, hashString, clamp } from './rng';
export * from './geometry';
export { SpatialIndex } from './SpatialIndex';

export { World } from './World';
export type { WorldRngStreams, InFlightSignal } from './World';

export { Simulation } from './Simulation';
export type { SimulationStats } from './Simulation';

export { createBug, createInitialTraits, inheritTraits } from './entities/Bug';
export { createPredator } from './entities/Predator';
export { createFood } from './entities/Food';

export {
  buildPerceptionIndices,
  perceiveBug,
  findNearestFood,
  findNearestPredator,
} from './systems/PerceptionSystem';
export type { PerceptionIndices, NearestMatch } from './systems/PerceptionSystem';

export { applyMovement } from './systems/MovementSystem';
export { applyEnergyUpdate } from './systems/EnergySystem';
export { applyHeardSignalsMode, emitSignal } from './systems/SignalSystem';
export type { EmittedSignal } from './systems/SignalSystem';
export { updatePredators } from './systems/PredatorSystem';
export type { PredatorTickResult } from './systems/PredatorSystem';
export { applyReproduction } from './systems/ReproductionSystem';
export { applyDeaths } from './systems/DeathSystem';
export { computeOutcome } from './systems/OutcomeSystem';
export type { OutcomeInput } from './systems/OutcomeSystem';

export { pushMemory, recentMemory, deriveSignalExperience } from './memory/AgentMemory';

export type {
  DecisionProvider,
  DecisionProviderOptions,
} from './decision/DecisionProvider';
export {
  uniformActionDecision,
  uniformSignalDecision,
  normalizeProbabilities,
} from './decision/DecisionProvider';
export { MockDecisionProvider } from './decision/MockDecisionProvider';
export { RandomDecisionProvider } from './decision/RandomDecisionProvider';
export { createSignalDefinitions } from './decision/signalTokens';
