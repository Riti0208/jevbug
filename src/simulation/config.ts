import type {
  DecisionProviderKind,
  ExperimentMode,
  MemoryMode,
  SignalTokenMode,
} from './types';

/**
 * All tunable numbers live here (spec §18: "数値はConfig化する").
 * Every field can be overridden from the UI start form or from an ExperimentConfig.
 */
export interface SimulationConfig {
  /** Deterministic seed (spec §27). */
  seed: number;
  mode: ExperimentMode;
  memoryMode: MemoryMode;
  decisionProvider: DecisionProviderKind;
  /** 'AB' passes "A"/"B" to the provider; 'RANDOM' passes seed-derived opaque tokens (spec §35). */
  signalTokenMode: SignalTokenMode;

  // ---- World ----
  worldSize: number;
  initialBugs: number;
  initialPredators: number;
  /** Food items spawned per tick (fractional allowed: 0.5 = one every two ticks on average). */
  foodSpawnRate: number;
  /** Hard cap on food items in the world. */
  maxFood: number;
  /** Food items placed at world creation. */
  initialFood: number;
  /** Energy granted by one food item (added to EAT gain). */
  foodValue: number;

  // ---- Perception ----
  /** How far a bug can see food and predators. */
  bugViewDistance: number;
  bugSignalDistance: number;
  /** How far a predator can see bugs (predator-side only, spec §17). */
  predatorViewDistance: number;
  /** Half-angle (radians) of the "front" cone; the rest is left/right by sign of the angle. */
  frontConeHalfAngle: number;
  /** Distance within which "nearbyBugCount" is counted. */
  bugNeighborDistance: number;

  // ---- Movement ----
  /** World units per tick at speed trait = 1. */
  bugBaseSpeed: number;
  /** Minimum fraction of bugBaseSpeed even at speed trait = 0. */
  bugMinSpeedFactor: number;
  /** Radians per TURN_LEFT/TURN_RIGHT action. */
  bugTurnAngle: number;
  /** FLEE moves away from the perceived predator (or forward if none) at this multiplier. */
  fleeSpeedMultiplier: number;
  predatorSpeed: number;
  predatorTurnRate: number;
  predatorAttackRange: number;
  /** Ticks between attacks of the same predator. */
  predatorAttackCooldown: number;
  /** Probability [0..1] that an attack kills instead of only draining energy. */
  predatorKillProbability: number;
  /** Distance within which a bug may EAT / PICKUP food. */
  eatDistance: number;

  // ---- Energy ----
  energyMove: number;
  energyTurn: number;
  energySignal: number;
  energyRest: number;
  energyEat: number;
  energyPredatorAttack: number;
  /** Baseline metabolic cost every tick regardless of action. */
  energyBaseline: number;
  energyFlee: number;
  energyPickup: number;
  energyDrop: number;
  initialBugEnergy: number;

  // ---- Fear ----
  /** Fear added when a predator is visible. */
  fearOnPredator: number;
  fearOnAttack: number;
  /** Multiplicative decay per tick. */
  fearDecay: number;

  // ---- Reproduction / Evolution ----
  reproductionEnergyThreshold: number;
  reproductionMinAge: number;
  reproductionCost: number;
  initialChildEnergy: number;
  /** Std-dev of the gaussian noise applied to each trait on inheritance. */
  mutationRate: number;
  memoryLengthMin: number;
  memoryLengthMax: number;
  /** Bugs die of old age past this many ticks (0 = never). */
  maxAge: number;
  /** Hard population cap to keep the browser alive. Reproduction is skipped above it. */
  maxPopulation: number;

  // ---- Decision ----
  /** Max concurrent provider requests (Jev batching). */
  decisionConcurrency: number;
  /** Max bugs per provider batch call (one HTTP round trip to /api/jev carries up to this many bugs). */
  decisionBatchSize: number;
  /** How many recent memory entries are exposed to the provider. */
  recentMemoryWindow: number;

  // ---- Predators ----
  /** Predators respawn when killed? Not in Exp 0 — predators are immortal; kept for future use. */
  predatorRespawn: boolean;
}

export const DEFAULT_CONFIG: SimulationConfig = {
  seed: 12345,
  mode: 'COMMUNICATION',
  memoryMode: 'WITH_MEMORY',
  decisionProvider: 'mock',
  signalTokenMode: 'AB',

  worldSize: 50,
  initialBugs: 30,
  initialPredators: 2,
  foodSpawnRate: 0.8,
  maxFood: 120,
  initialFood: 60,
  foodValue: 0.25,

  bugViewDistance: 6,
  bugSignalDistance: 8,
  predatorViewDistance: 7,
  frontConeHalfAngle: Math.PI / 6,
  bugNeighborDistance: 6,

  bugBaseSpeed: 0.5,
  bugMinSpeedFactor: 0.4,
  bugTurnAngle: Math.PI / 4,
  fleeSpeedMultiplier: 1.6,
  predatorSpeed: 0.35,
  predatorTurnRate: 0.4,
  predatorAttackRange: 0.8,
  predatorAttackCooldown: 5,
  predatorKillProbability: 0.5,
  eatDistance: 0.8,

  energyMove: -0.003,
  energyTurn: -0.001,
  energySignal: -0.001,
  energyRest: 0.001,
  energyEat: 0.25,
  energyPredatorAttack: -0.5,
  energyBaseline: -0.0015,
  energyFlee: -0.005,
  energyPickup: -0.002,
  energyDrop: -0.001,
  initialBugEnergy: 0.6,

  fearOnPredator: 0.3,
  fearOnAttack: 0.6,
  fearDecay: 0.9,

  reproductionEnergyThreshold: 0.85,
  reproductionMinAge: 100,
  reproductionCost: 0.4,
  initialChildEnergy: 0.5,
  mutationRate: 0.08,
  memoryLengthMin: 5,
  memoryLengthMax: 60,
  maxAge: 3000,
  maxPopulation: 400,

  decisionConcurrency: 8,
  decisionBatchSize: 32,
  recentMemoryWindow: 10,

  predatorRespawn: false,
};

export function createConfig(overrides: Partial<SimulationConfig> = {}): SimulationConfig {
  return { ...DEFAULT_CONFIG, ...overrides };
}
