/**
 * Shared domain types for JevBug Experiment 0.
 *
 * This file is the contract between Simulation Core, Decision Providers,
 * Metrics, Renderer and UI. Keep it dependency-free (no three.js, no DOM).
 *
 * EXPERIMENTAL INTEGRITY (spec §9, §11, §32):
 *  - Signals "A" and "B" have NO predefined meaning anywhere in the code base.
 *  - Never map a signal to a concept (danger/food/...) in code, config, prompts or UI.
 *  - Receivers never learn the sender's perception, id or reasoning.
 */

export interface Vec2 {
  x: number;
  y: number;
}

/** Canonical signal identifiers used inside the simulation and in the UI. */
export type Signal = 'NONE' | 'A' | 'B';
export const SIGNALS: readonly Signal[] = ['NONE', 'A', 'B'] as const;
export const EMITTABLE_SIGNALS: readonly Exclude<Signal, 'NONE'>[] = ['A', 'B'] as const;

/**
 * Optional relabeling of signal tokens (spec §35/§36).
 * `id` is what a DecisionProvider (e.g. Jev) sees; `displayName` is what the UI shows.
 * The simulation core always works with the canonical `Signal` ('A' | 'B').
 */
export interface SignalDefinition {
  /** Canonical signal this definition stands for. */
  signal: Exclude<Signal, 'NONE'>;
  /** Opaque token passed to the decision provider, e.g. "SIG_X7Q". */
  id: string;
  /** Human-readable label, e.g. "A". */
  displayName: string;
}

export type BugAction =
  | 'MOVE_FORWARD'
  | 'TURN_LEFT'
  | 'TURN_RIGHT'
  | 'EAT'
  | 'PICKUP'
  | 'DROP'
  | 'FLEE'
  | 'REST';

export const BUG_ACTIONS: readonly BugAction[] = [
  'MOVE_FORWARD',
  'TURN_LEFT',
  'TURN_RIGHT',
  'EAT',
  'PICKUP',
  'DROP',
  'FLEE',
  'REST',
] as const;

export type Outcome =
  | 'SAFE'
  | 'FOOD_FOUND'
  | 'ENERGY_GAINED'
  | 'ENERGY_LOST'
  | 'PREDATOR_ENCOUNTER'
  | 'ATTACKED'
  | 'ESCAPED'
  | 'NOTHING';

export const OUTCOMES: readonly Outcome[] = [
  'SAFE',
  'FOOD_FOUND',
  'ENERGY_GAINED',
  'ENERGY_LOST',
  'PREDATOR_ENCOUNTER',
  'ATTACKED',
  'ESCAPED',
  'NOTHING',
] as const;

export type RelativeDirection = 'front' | 'left' | 'right';

export interface BugTraits {
  /** 0..1 */
  curiosity: number;
  /** 0..1 */
  aggression: number;
  /** 0..1 */
  sociality: number;
  /** 0..1 */
  signalTendency: number;
  /** integer >= 0, number of memory entries kept */
  memoryLength: number;
  /** 0..1, scaled by config.bugBaseSpeed */
  speed: number;
}

/** One signal heard this tick. Intentionally carries NO sender information (spec §38). */
export interface SignalObservation {
  signal: Exclude<Signal, 'NONE'>;
}

/** Everything a bug is allowed to know about the world this tick (spec §7). */
export interface BugPerception {
  energy: number;
  fear: number;
  foodDirection: RelativeDirection | null;
  predatorDirection: RelativeDirection | null;
  nearbyBugCount: number;
  /** Duplicates are preserved on purpose (spec §39). Order is deterministic. */
  heardSignals: SignalObservation[];
  previousAction: BugAction | null;
  previousOutcome: Outcome | null;
}

export interface MemoryEntry {
  tick: number;
  perception: BugPerception;
  /** Signals received this tick (canonical). Empty array when nothing heard. */
  signalsReceived: Exclude<Signal, 'NONE'>[];
  signalEmitted: Signal;
  action: BugAction;
  outcome: Outcome;
  /** energy after outcome minus energy before action */
  energyDelta: number;
}

/**
 * Statistics derived from an individual's own memory (spec §13).
 * Counts only — never a label such as "meaning".
 */
export interface SignalExperience {
  signal: Exclude<Signal, 'NONE'>;
  receivedCount: number;
  followedByPredator: number;
  followedByFood: number;
  followedByEscape: number;
  followedByAttack: number;
  averageEnergyDelta: number;
}

export interface Bug {
  id: string;
  position: Vec2;
  /** radians, 0 = +x, counter-clockwise */
  direction: number;
  /** 0..1 */
  energy: number;
  /** 0..1 */
  fear: number;
  age: number;
  carryingFood: boolean;
  traits: BugTraits;
  memory: MemoryEntry[];
  generation: number;
  alive: boolean;
  /** Filled by the simulation each tick; useful for the inspector. */
  lastPerception: BugPerception | null;
  lastActionDecision: ActionDecision | null;
  lastSignalDecision: SignalDecision | null;
  lastAction: BugAction | null;
  lastSignalEmitted: Signal;
  lastOutcome: Outcome | null;
}

export interface Predator {
  id: string;
  position: Vec2;
  direction: number;
  /** id of the bug being chased, if any */
  targetBugId: string | null;
  /** ticks until it may attack again */
  attackCooldown: number;
}

export interface Food {
  id: string;
  position: Vec2;
  /** energy granted when eaten */
  value: number;
}

export interface ActionDecision {
  probabilities: Record<BugAction, number>;
}

export interface SignalDecision {
  probabilities: Record<Signal, number>;
}

/** A single bug's decision request. Contains ONLY that bug's own state (spec §32-4). */
export interface DecisionRequest {
  bugId: string;
  tick: number;
  creature: { energy: number; fear: number; age: number; generation: number; carryingFood: boolean };
  traits: BugTraits;
  perception: BugPerception;
  /**
   * Derived from the bug's own memory. `null` when memory is disabled (JEV_NO_MEMORY, spec §34)
   * or when the bug has no experience yet.
   */
  signalExperience: SignalExperience[] | null;
  /** Recent memory entries (most recent last), may be empty. `null` when memory is disabled. */
  recentMemory: MemoryEntry[] | null;
}

export interface DecisionResult {
  bugId: string;
  action: ActionDecision;
  signal: SignalDecision;
  /** Which provider actually produced this (e.g. "jev", "fallback:random"). */
  source: string;
}

export type ExperimentMode = 'COMMUNICATION' | 'NO_COMMUNICATION' | 'SHUFFLED_COMMUNICATION';
export const EXPERIMENT_MODES: readonly ExperimentMode[] = [
  'COMMUNICATION',
  'NO_COMMUNICATION',
  'SHUFFLED_COMMUNICATION',
] as const;

export type MemoryMode = 'WITH_MEMORY' | 'NO_MEMORY';
export type DecisionProviderKind = 'jev' | 'mock' | 'random';
export type SignalTokenMode = 'AB' | 'RANDOM';

/** Cause of a bug's death. */
export type DeathCause = 'STARVATION' | 'PREDATOR' | 'OLD_AGE';

export interface DeathRecord {
  tick: number;
  bugId: string;
  cause: DeathCause;
  age: number;
  generation: number;
}

/**
 * Per-bug observation record emitted every tick for metrics (spec §25).
 * This is the ONLY input MetricsCollector needs for communication metrics.
 */
export interface BugObservation {
  tick: number;
  bugId: string;
  predatorVisible: boolean;
  foodVisible: boolean;
  /** Signal this bug emitted this tick (after mode processing; 'NONE' in NO_COMMUNICATION). */
  signalEmitted: Signal;
  /** Signals this bug heard this tick (after mode processing: shuffled in SHUFFLED_COMMUNICATION). */
  signalsHeard: Exclude<Signal, 'NONE'>[];
  action: BugAction;
  outcome: Outcome;
  energy: number;
}

/** Everything that happened in one tick, for metrics/logging. */
export interface TickRecord {
  tick: number;
  observations: BugObservation[];
  deaths: DeathRecord[];
  births: number;
  population: number;
  predatorCount: number;
  foodCount: number;
  /** Signals actually emitted this tick after mode processing (all 'NONE' in NO_COMMUNICATION). */
  signalCounts: Record<Signal, number>;
  averageEnergy: number;
  averageAge: number;
  maxGeneration: number;
  averageGeneration: number;
  /** Mean of each trait over living bugs. */
  averageTraits: BugTraits;
  /** Number of decision requests answered by the primary provider vs fallback. */
  decisionSources: Record<string, number>;
}

/** Renderer input (spec §41). Pure data, rebuilt each frame from the simulation. */
export interface RenderBug {
  id: string;
  x: number;
  y: number;
  direction: number;
  energy: number;
  generation: number;
  fear: number;
  selected: boolean;
}

export interface RenderPredator {
  id: string;
  x: number;
  y: number;
  direction: number;
}

export interface RenderFood {
  id: string;
  x: number;
  y: number;
}

export interface RenderSignal {
  /** bug id of emitter */
  id: string;
  x: number;
  y: number;
  signal: Exclude<Signal, 'NONE'>;
  /** tick at which it was emitted */
  tick: number;
}

export interface RenderSnapshot {
  tick: number;
  worldSize: number;
  bugs: RenderBug[];
  predators: RenderPredator[];
  foods: RenderFood[];
  /** Signals emitted during the last tick (each lives exactly one tick in the sim, the renderer animates the fade). */
  signals: RenderSignal[];
}

/** Read-only view of the world handed to systems during a tick (spec §16: decisions read a snapshot). */
export interface WorldSnapshot {
  tick: number;
  worldSize: number;
  bugs: readonly Bug[];
  predators: readonly Predator[];
  foods: readonly Food[];
  /** Signals emitted in the previous tick (they propagate one tick after emission is decided). */
  signalsInFlight: readonly { bugId: string; position: Vec2; signal: Exclude<Signal, 'NONE'> }[];
}
