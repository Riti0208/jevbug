/**
 * Simulation: orchestrates one tick exactly per spec §16 and exposes the
 * read-only views the renderer/UI/metrics need.
 */
import type { SimulationConfig } from './config';
import { createSignalDefinitions } from './decision/signalTokens';
import type { DecisionProvider } from './decision/DecisionProvider';
import { uniformActionDecision, uniformSignalDecision } from './decision/DecisionProvider';
import { createFood } from './entities/Food';
import { torusDistance } from './geometry';
import { deriveSignalExperience, pushMemory, recentMemory } from './memory/AgentMemory';
import { clamp, SeededRandom } from './rng';
import { buildPerceptionIndices, perceiveBug } from './systems/PerceptionSystem';
import type { PerceptionIndices } from './systems/PerceptionSystem';
import { applyMovement } from './systems/MovementSystem';
import { applyEnergyUpdate } from './systems/EnergySystem';
import { applyHeardSignalsMode, emitSignal } from './systems/SignalSystem';
import type { EmittedSignal } from './systems/SignalSystem';
import { updatePredators } from './systems/PredatorSystem';
import { applyReproduction } from './systems/ReproductionSystem';
import { applyDeaths } from './systems/DeathSystem';
import { computeOutcome } from './systems/OutcomeSystem';
import { World } from './World';
import { BUG_ACTIONS, SIGNALS } from './types';
import type {
  ActionDecision,
  Bug,
  BugAction,
  BugObservation,
  BugTraits,
  DecisionRequest,
  DecisionResult,
  DeathRecord,
  Food,
  MemoryEntry,
  Outcome,
  RenderSnapshot,
  Signal,
  SignalDecision,
  SignalDefinition,
  SignalExperience,
  TickRecord,
  Vec2,
} from './types';

export interface SimulationStats {
  tick: number;
  population: number;
  births: number;
  deaths: { total: number; starvation: number; predator: number; oldAge: number };
  /** mean age at death over all deaths so far (0 if none) */
  averageLifespan: number;
  maxGeneration: number;
  signalCountsTotal: Record<Signal, number>;
}

function emptySignalCounts(): Record<Signal, number> {
  const out = {} as Record<Signal, number>;
  for (const s of SIGNALS) out[s] = 0;
  return out;
}

function isValidActionDecision(action: ActionDecision | undefined | null): action is ActionDecision {
  if (!action?.probabilities) return false;
  for (const a of BUG_ACTIONS) {
    const v = action.probabilities[a];
    if (typeof v !== 'number' || !Number.isFinite(v)) return false;
  }
  return true;
}

function isValidSignalDecision(signal: SignalDecision | undefined | null): signal is SignalDecision {
  if (!signal?.probabilities) return false;
  for (const s of SIGNALS) {
    const v = signal.probabilities[s];
    if (typeof v !== 'number' || !Number.isFinite(v)) return false;
  }
  return true;
}

/** Nearest food within `eatDistance`, or -1. Linear scan: `foods.length` is small (<= maxFood). */
function findNearestFoodIndex(pos: Vec2, foods: Food[], maxDistance: number, worldSize: number): number {
  let bestIdx = -1;
  let bestDist = Infinity;
  for (let i = 0; i < foods.length; i++) {
    const d = torusDistance(pos, foods[i].position, worldSize);
    if (d <= maxDistance && d < bestDist) {
      bestDist = d;
      bestIdx = i;
    }
  }
  return bestIdx;
}

/** Food interaction (spec §16 step 8): EAT / PICKUP / DROP resolution. Returns whether the bug ate. */
function applyFoodInteraction(bug: Bug, action: BugAction, world: World, config: SimulationConfig): boolean {
  if (action === 'EAT') {
    if (bug.carryingFood) {
      bug.energy += config.energyEat;
      bug.carryingFood = false;
      return true;
    }
    const idx = findNearestFoodIndex(bug.position, world.foods, config.eatDistance, config.worldSize);
    if (idx >= 0) {
      const [food] = world.foods.splice(idx, 1);
      bug.energy += food.value;
      return true;
    }
    return false;
  }

  if (action === 'PICKUP') {
    if (!bug.carryingFood) {
      const idx = findNearestFoodIndex(bug.position, world.foods, config.eatDistance, config.worldSize);
      if (idx >= 0) {
        world.foods.splice(idx, 1);
        bug.carryingFood = true;
      }
    }
    return false;
  }

  if (action === 'DROP') {
    if (bug.carryingFood) {
      bug.carryingFood = false;
      world.foods.push(createFood(world.nextFoodId(), { ...bug.position }, config.foodValue));
    }
    return false;
  }

  return false;
}

function spawnFood(world: World, config: SimulationConfig): void {
  world.foodSpawnAccumulator += config.foodSpawnRate;
  while (world.foodSpawnAccumulator >= 1 && world.foods.length < config.maxFood) {
    world.foodSpawnAccumulator -= 1;
    const position: Vec2 = {
      x: world.rng.food.range(0, config.worldSize),
      y: world.rng.food.range(0, config.worldSize),
    };
    world.foods.push(createFood(world.nextFoodId(), position, config.foodValue));
  }
}

function averageTraitsOf(bugs: readonly Bug[]): BugTraits {
  if (bugs.length === 0) {
    return { curiosity: 0, aggression: 0, sociality: 0, signalTendency: 0, memoryLength: 0, speed: 0 };
  }
  const sum = { curiosity: 0, aggression: 0, sociality: 0, signalTendency: 0, memoryLength: 0, speed: 0 };
  for (const b of bugs) {
    sum.curiosity += b.traits.curiosity;
    sum.aggression += b.traits.aggression;
    sum.sociality += b.traits.sociality;
    sum.signalTendency += b.traits.signalTendency;
    sum.memoryLength += b.traits.memoryLength;
    sum.speed += b.traits.speed;
  }
  const n = bugs.length;
  return {
    curiosity: sum.curiosity / n,
    aggression: sum.aggression / n,
    sociality: sum.sociality / n,
    signalTendency: sum.signalTendency / n,
    memoryLength: sum.memoryLength / n,
    speed: sum.speed / n,
  };
}

export class Simulation {
  readonly config: SimulationConfig;
  readonly world: World;
  readonly provider: DecisionProvider;
  readonly signalDefinitions: SignalDefinition[];

  private lastEmittedSignals: EmittedSignal[] = [];
  private lastEmittedTick = 0;

  // Cumulative stats across the whole run (spec: getStats()).
  private cumulativeBirths = 0;
  private cumulativeDeaths = { total: 0, starvation: 0, predator: 0, oldAge: 0 };
  private cumulativeAgeAtDeathSum = 0;
  private cumulativeMaxGeneration = 0;
  private cumulativeSignalCountsTotal: Record<Signal, number> = emptySignalCounts();

  constructor(config: SimulationConfig, provider: DecisionProvider) {
    this.config = config;
    this.provider = provider;
    const rootRng = new SeededRandom(config.seed);
    this.world = new World(config, rootRng);
    this.signalDefinitions = createSignalDefinitions(config.seed, config.signalTokenMode);
    this.provider.configure?.({
      signalDefinitions: this.signalDefinitions,
      memoryMode: config.memoryMode,
      seed: config.seed,
    });
  }

  get tick(): number {
    return this.world.tick;
  }

  buildDecisionRequest(bug: Bug): DecisionRequest {
    const basePerception = bug.lastPerception ?? this.computeFreshPerception(bug);
    let perception = basePerception;
    let signalExperience: SignalExperience[] | null = null;
    let recentMemoryEntries: MemoryEntry[] | null = null;

    if (this.config.memoryMode === 'WITH_MEMORY') {
      signalExperience = bug.memory.length > 0 ? deriveSignalExperience(bug.memory) : null;
      recentMemoryEntries = recentMemory(bug.memory, this.config.recentMemoryWindow);
    } else {
      perception = { ...basePerception, previousAction: null, previousOutcome: null };
    }

    return {
      bugId: bug.id,
      tick: this.world.tick,
      creature: {
        energy: bug.energy,
        fear: bug.fear,
        age: bug.age,
        generation: bug.generation,
        carryingFood: bug.carryingFood,
      },
      traits: bug.traits,
      perception,
      signalExperience,
      recentMemory: recentMemoryEntries,
    };
  }

  private computeFreshPerception(bug: Bug) {
    const snapshot = this.world.snapshot();
    const indices = buildPerceptionIndices(snapshot, this.config);
    return perceiveBug(bug, snapshot, indices, this.config);
  }

  async step(): Promise<TickRecord> {
    const world = this.world;
    const config = this.config;
    const t = world.tick;

    const startAliveBugs = world.aliveBugs();
    const bugById = new Map(world.bugs.map((b) => [b.id, b] as const));

    // ---- Step 1: snapshot ----
    const snapshot = world.snapshot();
    const indices: PerceptionIndices = buildPerceptionIndices(snapshot, config);

    const energyAtStart = new Map<string, number>();
    const previousPerceptionByBug = new Map<string, ReturnType<typeof perceiveBug> | null>();
    for (const bug of startAliveBugs) {
      energyAtStart.set(bug.id, bug.energy);
      previousPerceptionByBug.set(bug.id, bug.lastPerception);
    }

    // ---- Step 2: perception ----
    for (const bug of startAliveBugs) {
      const raw = perceiveBug(bug, snapshot, indices, config);
      bug.lastPerception = applyHeardSignalsMode(raw, config.mode, world.rng.shuffle);
    }

    // ---- Step 3: decision ----
    const requests: DecisionRequest[] = startAliveBugs.map((bug) => this.buildDecisionRequest(bug));
    let results: DecisionResult[] = [];
    try {
      results = await this.provider.decideBatch(requests);
    } catch {
      results = [];
    }
    const resultByBugId = new Map(results.map((r) => [r.bugId, r] as const));

    const decisionSources: Record<string, number> = {};
    const actionByBugId = new Map<string, BugAction>();
    const signalByBugId = new Map<string, Signal>();

    for (const bug of startAliveBugs) {
      const result = resultByBugId.get(bug.id);
      let actionDecision: ActionDecision;
      let signalDecision: SignalDecision;
      let source: string;

      if (result && isValidActionDecision(result.action) && isValidSignalDecision(result.signal)) {
        actionDecision = result.action;
        signalDecision = result.signal;
        source = result.source || 'unknown';
      } else {
        actionDecision = uniformActionDecision();
        signalDecision = uniformSignalDecision();
        source = 'fallback:missing';
      }

      decisionSources[source] = (decisionSources[source] ?? 0) + 1;
      bug.lastActionDecision = actionDecision;
      bug.lastSignalDecision = signalDecision;

      actionByBugId.set(bug.id, world.rng.sampling.weighted(actionDecision.probabilities));
      signalByBugId.set(bug.id, world.rng.sampling.weighted(signalDecision.probabilities));
    }

    // ---- Step 4: signal emission ----
    const emittedThisTick: EmittedSignal[] = [];
    for (const bug of startAliveBugs) {
      const sampledSignal = signalByBugId.get(bug.id) as Signal;
      emitSignal(bug, sampledSignal, config.mode, config, emittedThisTick);
    }

    // ---- Step 5: signal propagation ----
    world.signalsInFlight = emittedThisTick;

    // ---- Step 6: movement ----
    for (const bug of startAliveBugs) {
      const action = actionByBugId.get(bug.id) as BugAction;
      applyMovement(bug, action, snapshot, indices, config);
    }

    // ---- Step 7: predator movement ----
    const { attackedBugIds } = updatePredators(world.predators, world.bugs, config.worldSize, config, world.rng.predator);

    // ---- Step 8: food interaction ----
    const ateByBugId = new Map<string, boolean>();
    for (const bug of startAliveBugs) {
      const action = actionByBugId.get(bug.id) as BugAction;
      ateByBugId.set(bug.id, applyFoodInteraction(bug, action, world, config));
    }
    spawnFood(world, config);

    // ---- Step 9: predator interaction ----
    const attackDeaths: DeathRecord[] = [];
    for (const bugId of attackedBugIds) {
      const bug = bugById.get(bugId);
      if (!bug || !bug.alive) continue;
      bug.energy += config.energyPredatorAttack;
      bug.fear += config.fearOnAttack;
      if (world.rng.predator.bool(config.predatorKillProbability)) {
        bug.alive = false;
        attackDeaths.push({ tick: t, bugId: bug.id, cause: 'PREDATOR', age: bug.age, generation: bug.generation });
      }
    }

    // ---- Step 10: energy update ----
    for (const bug of startAliveBugs) {
      if (!bug.alive) continue;
      applyEnergyUpdate(bug, config);
    }

    // ---- Step 11: outcome ----
    for (const bug of startAliveBugs) {
      const action = actionByBugId.get(bug.id) as BugAction;
      const attacked = attackedBugIds.has(bug.id);
      const energyBefore = energyAtStart.get(bug.id) as number;
      const energyDelta = bug.energy - energyBefore;
      const outcome: Outcome = computeOutcome({
        attacked,
        action,
        perception: bug.lastPerception!,
        previousPerception: previousPerceptionByBug.get(bug.id) ?? null,
        ate: ateByBugId.get(bug.id) ?? false,
        energyDelta,
      });
      bug.lastOutcome = outcome;
      bug.lastAction = action;
    }

    // ---- Step 12: memory update ----
    if (config.memoryMode === 'WITH_MEMORY') {
      for (const bug of startAliveBugs) {
        if (!bug.alive) continue;
        const entry: MemoryEntry = {
          tick: t,
          perception: bug.lastPerception!,
          signalsReceived: bug.lastPerception!.heardSignals.map((h) => h.signal),
          signalEmitted: bug.lastSignalEmitted,
          action: bug.lastAction!,
          outcome: bug.lastOutcome!,
          energyDelta: bug.energy - (energyAtStart.get(bug.id) as number),
        };
        pushMemory(bug, entry);
      }
    }

    // ---- Step 13: reproduction ----
    const births = applyReproduction(world, config);

    // ---- Step 14: death ----
    const staleDeaths = applyDeaths(world, config);
    const allDeaths = [...attackDeaths, ...staleDeaths];

    // ---- Step 15: metrics ----
    const observations: BugObservation[] = startAliveBugs.map((bug) => ({
      tick: t,
      bugId: bug.id,
      predatorVisible: bug.lastPerception!.predatorDirection != null,
      foodVisible: bug.lastPerception!.foodDirection != null,
      signalEmitted: bug.lastSignalEmitted,
      signalsHeard: bug.lastPerception!.heardSignals.map((h) => h.signal),
      action: bug.lastAction!,
      outcome: bug.lastOutcome!,
      energy: bug.energy,
    }));

    const signalCounts = emptySignalCounts();
    for (const bug of startAliveBugs) signalCounts[bug.lastSignalEmitted] += 1;

    const aliveNow = world.aliveBugs();
    const population = aliveNow.length;
    let sumEnergy = 0;
    let sumAge = 0;
    let sumGeneration = 0;
    let maxGeneration = 0;
    for (const bug of aliveNow) {
      sumEnergy += bug.energy;
      sumAge += bug.age;
      sumGeneration += bug.generation;
      if (bug.generation > maxGeneration) maxGeneration = bug.generation;
    }

    const tickRecord: TickRecord = {
      tick: t,
      observations,
      deaths: allDeaths,
      births,
      population,
      predatorCount: world.predators.length,
      foodCount: world.foods.length,
      signalCounts,
      averageEnergy: population > 0 ? sumEnergy / population : 0,
      averageAge: population > 0 ? sumAge / population : 0,
      maxGeneration,
      averageGeneration: population > 0 ? sumGeneration / population : 0,
      averageTraits: averageTraitsOf(aliveNow),
      decisionSources,
    };

    // ---- cumulative stats ----
    this.cumulativeBirths += births;
    for (const d of allDeaths) {
      this.cumulativeDeaths.total += 1;
      this.cumulativeAgeAtDeathSum += d.age;
      if (d.cause === 'STARVATION') this.cumulativeDeaths.starvation += 1;
      else if (d.cause === 'PREDATOR') this.cumulativeDeaths.predator += 1;
      else if (d.cause === 'OLD_AGE') this.cumulativeDeaths.oldAge += 1;
    }
    if (maxGeneration > this.cumulativeMaxGeneration) this.cumulativeMaxGeneration = maxGeneration;
    for (const s of SIGNALS) this.cumulativeSignalCountsTotal[s] += signalCounts[s];

    this.lastEmittedSignals = emittedThisTick;
    this.lastEmittedTick = t;
    world.tick += 1;

    return tickRecord;
  }

  getRenderSnapshot(selectedBugId?: string | null): RenderSnapshot {
    const bugs = this.world.aliveBugs().map((b) => ({
      id: b.id,
      x: b.position.x,
      y: b.position.y,
      direction: b.direction,
      energy: b.energy,
      generation: b.generation,
      fear: b.fear,
      selected: selectedBugId != null && b.id === selectedBugId,
    }));
    const predators = this.world.predators.map((p) => ({
      id: p.id,
      x: p.position.x,
      y: p.position.y,
      direction: p.direction,
    }));
    const foods = this.world.foods.map((f) => ({ id: f.id, x: f.position.x, y: f.position.y }));
    const signals = this.lastEmittedSignals.map((s) => ({
      id: s.bugId,
      x: s.position.x,
      y: s.position.y,
      signal: s.signal,
      tick: this.lastEmittedTick,
    }));

    return {
      tick: this.world.tick,
      worldSize: this.config.worldSize,
      bugs,
      predators,
      foods,
      signals,
    };
  }

  getBug(id: string): Bug | undefined {
    return this.world.bugs.find((b) => b.id === id);
  }

  getBugs(): readonly Bug[] {
    return this.world.aliveBugs();
  }

  getSignalExperience(bug: Bug): SignalExperience[] {
    return deriveSignalExperience(bug.memory);
  }

  findNearestBug(pos: Vec2, maxDistance: number): Bug | null {
    let best: Bug | null = null;
    let bestDist = Infinity;
    for (const bug of this.world.aliveBugs()) {
      const d = torusDistance(pos, bug.position, this.config.worldSize);
      if (d <= maxDistance && d < bestDist) {
        bestDist = d;
        best = bug;
      }
    }
    return best;
  }

  getStats(): SimulationStats {
    return {
      tick: this.world.tick,
      population: this.world.aliveBugs().length,
      births: this.cumulativeBirths,
      deaths: { ...this.cumulativeDeaths },
      averageLifespan:
        this.cumulativeDeaths.total > 0 ? this.cumulativeAgeAtDeathSum / this.cumulativeDeaths.total : 0,
      maxGeneration: this.cumulativeMaxGeneration,
      signalCountsTotal: { ...this.cumulativeSignalCountsTotal },
    };
  }

  dispose(): void {
    this.provider.dispose?.();
  }
}

// Re-export for convenience so consumers can `clamp` without reaching into rng.ts directly.
export { clamp };
