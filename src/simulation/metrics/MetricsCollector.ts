/**
 * MetricsCollector — consumes TickRecords and produces:
 *  - GlobalMetrics: cumulative population/energy/death/signal stats.
 *  - CommunicationMetrics: conditional probabilities and mutual-information
 *    statistics over a bounded sliding window, used to flag "potential
 *    communication" (a purely statistical correlation, see the doc comment
 *    on `potentialCommunication` below and docs/METRICS.md — never call it
 *    "language").
 *  - A downsampled timeline for charting.
 *
 * Performance note: the sliding window stores compact per-observation tuples
 * (not full BugObservation/TickRecord objects) so memory is bounded by
 * `windowTicks * averagePopulation`. All the categorical variables involved
 * (Signal, boolean visibility, heard-category, action) have tiny domains, so
 * rather than replaying the whole window on every query, we maintain running
 * joint-count tables that are updated incrementally as ticks enter and leave
 * the window (O(population) per tick, not O(windowTicks * population)).
 * mutual information / conditional probabilities are then read directly off
 * those small tables, which is why they can safely be recomputed every tick
 * (needed to track how long the "potential communication" condition has been
 * sustained) instead of only on demand.
 */
import type { BugAction, BugTraits, DeathCause, Signal, TickRecord } from '../types';
import { BUG_ACTIONS, SIGNALS } from '../types';
import {
  addPair,
  emptyJointCounts,
  mutualInformationFromCounts,
  removePair,
  rowDistribution,
  type JointCounts,
} from './MutualInformation';

/** What a bug heard this tick, collapsed to one of four buckets (see classifyHeard). */
export type HeardCategory = 'NONE' | 'A' | 'B' | 'MIXED';
export const HEARD_CATEGORIES: readonly HeardCategory[] = ['NONE', 'A', 'B', 'MIXED'] as const;

/**
 * Collapse the (possibly duplicated, spec §39) list of signals a bug heard
 * this tick into one of four buckets:
 *  - no signals heard -> 'NONE'
 *  - only 'A' (one or more times) -> 'A'
 *  - only 'B' (one or more times) -> 'B'
 *  - a mix of 'A' and 'B' -> 'MIXED'
 */
export function classifyHeard(signalsHeard: readonly ('A' | 'B')[]): HeardCategory {
  if (signalsHeard.length === 0) return 'NONE';
  let hasA = false;
  let hasB = false;
  for (const s of signalsHeard) {
    if (s === 'A') hasA = true;
    else if (s === 'B') hasB = true;
  }
  if (hasA && hasB) return 'MIXED';
  if (hasA) return 'A';
  return 'B';
}

const ZERO_TRAITS: BugTraits = {
  curiosity: 0,
  aggression: 0,
  sociality: 0,
  signalTendency: 0,
  memoryLength: 0,
  speed: 0,
};

function zeroSignalRecord(): Record<Signal, number> {
  const out = {} as Record<Signal, number>;
  for (const s of SIGNALS) out[s] = 0;
  return out;
}

export interface GlobalMetrics {
  tick: number;
  population: number;
  averageAge: number;
  averageEnergy: number;
  maxGeneration: number;
  averageGeneration: number;
  /** Cumulative emitted signal counts (including NONE) since the collector started. */
  signalCounts: Record<Signal, number>;
  /** Emitted signal counts within the current sliding window only. */
  signalCountsWindow: Record<Signal, number>;
  /** (A + B) / observations, within the window. 0 if the window is empty. */
  signalRate: number;
  deaths: { total: number; predator: number; starvation: number; oldAge: number };
  births: number;
  /** Mean age at death, over every death recorded so far. */
  averageLifespan: number;
  averageTraits: BugTraits;
  /** Cumulative count of decisions answered by each provider/source label. */
  decisionSources: Record<string, number>;
}

export interface CommunicationMetrics {
  windowTicks: number;
  sampleSize: number;
  pSignalGivenPredatorVisible: Record<Signal, number>;
  pSignalGivenNoPredator: Record<Signal, number>;
  pSignalGivenFoodVisible: Record<Signal, number>;
  pSignalGivenNoFood: Record<Signal, number>;
  pFleeGivenHeard: Record<HeardCategory, number>;
  pFleeGivenHeardNoPredator: Record<HeardCategory, number>;
  miSignalPredator: number;
  miSignalFood: number;
  miSignalReceiverAction: number;
  miSignalReceiverFlee: number;
  /**
   * Statistical heuristic only: true when both `miSignalPredator` and
   * `miSignalReceiverAction` have stayed above `miThreshold` for at least
   * `sustainTicks` consecutive ticks. It measures correlation, not meaning —
   * see docs/METRICS.md for the full caveat. Consumers should present this as
   * "potential communication detected", never "language".
   */
  potentialCommunication: boolean;
}

export interface TimelinePoint {
  tick: number;
  population: number;
  averageLifespan: number;
  signalRate: number;
  miSignalPredator: number;
  miSignalReceiverAction: number;
  averageEnergy: number;
  maxGeneration: number;
}

export interface MetricsCollectorOptions {
  windowTicks?: number;
  sampleEvery?: number;
  maxTimelinePoints?: number;
  miThreshold?: number;
  sustainTicks?: number;
}

interface CompactObs {
  signalEmitted: Signal;
  predatorVisible: boolean;
  foodVisible: boolean;
  heard: HeardCategory;
  action: BugAction;
}

interface TickBlock {
  tick: number;
  obs: CompactObs[];
}

/** Running joint-count tables maintained over exactly the ticks in the window. */
interface WindowAggregate {
  sampleSize: number;
  signalCounts: Record<Signal, number>;
  /** x = String(predatorVisible), y = signal */
  jointPredatorSignal: JointCounts;
  /** x = String(foodVisible), y = signal */
  jointFoodSignal: JointCounts;
  /** x = heard category, y = action */
  jointHeardAction: JointCounts;
  /** x = heard category, y = String(action === 'FLEE') */
  jointHeardFlee: JointCounts;
  /** x = heard category, y = action, restricted to predatorVisible === false */
  jointHeardActionNoPredator: JointCounts;
}

function emptyAggregate(): WindowAggregate {
  return {
    sampleSize: 0,
    signalCounts: zeroSignalRecord(),
    jointPredatorSignal: emptyJointCounts(),
    jointFoodSignal: emptyJointCounts(),
    jointHeardAction: emptyJointCounts(),
    jointHeardFlee: emptyJointCounts(),
    jointHeardActionNoPredator: emptyJointCounts(),
  };
}

export function emptyGlobalMetrics(): GlobalMetrics {
  return {
    tick: 0,
    population: 0,
    averageAge: 0,
    averageEnergy: 0,
    maxGeneration: 0,
    averageGeneration: 0,
    signalCounts: zeroSignalRecord(),
    signalCountsWindow: zeroSignalRecord(),
    signalRate: 0,
    deaths: { total: 0, predator: 0, starvation: 0, oldAge: 0 },
    births: 0,
    averageLifespan: 0,
    averageTraits: { ...ZERO_TRAITS },
    decisionSources: {},
  };
}

export function emptyCommunicationMetrics(windowTicks = 500): CommunicationMetrics {
  const zeroSignal = zeroSignalRecord();
  const zeroHeard = {} as Record<HeardCategory, number>;
  for (const h of HEARD_CATEGORIES) zeroHeard[h] = 0;
  return {
    windowTicks,
    sampleSize: 0,
    pSignalGivenPredatorVisible: { ...zeroSignal },
    pSignalGivenNoPredator: { ...zeroSignal },
    pSignalGivenFoodVisible: { ...zeroSignal },
    pSignalGivenNoFood: { ...zeroSignal },
    pFleeGivenHeard: { ...zeroHeard },
    pFleeGivenHeardNoPredator: { ...zeroHeard },
    miSignalPredator: 0,
    miSignalFood: 0,
    miSignalReceiverAction: 0,
    miSignalReceiverFlee: 0,
    potentialCommunication: false,
  };
}

export class MetricsCollector {
  private readonly windowTicksOption: number;
  private readonly sampleEvery: number;
  private readonly maxTimelinePoints: number;
  private readonly miThreshold: number;
  private readonly sustainTicks: number;

  // Ring buffer of per-tick compact observation blocks (bounds memory to
  // windowTicks ticks worth of observations).
  private blocks: (TickBlock | undefined)[];
  private blockStart = 0;
  private blockCount = 0;
  private agg: WindowAggregate;

  // Cumulative (whole-run) counters.
  private cumulativeSignalCounts: Record<Signal, number> = zeroSignalRecord();
  private cumulativeBirths = 0;
  private cumulativeDeaths = { total: 0, predator: 0, starvation: 0, oldAge: 0 };
  private sumAgeAtDeath = 0;
  private runningMaxGeneration = 0;
  private cumulativeDecisionSources: Record<string, number> = {};

  private lastTick = 0;
  private latestTickRecord: TickRecord | null = null;

  private sustainStreak = 0;
  private commCache: CommunicationMetrics | null = null;

  private timeline: TimelinePoint[] = [];
  private sampleStride = 1;

  constructor(options: MetricsCollectorOptions = {}) {
    this.windowTicksOption = Math.max(1, options.windowTicks ?? 500);
    this.sampleEvery = Math.max(1, options.sampleEvery ?? 10);
    this.maxTimelinePoints = Math.max(2, options.maxTimelinePoints ?? 4000);
    this.miThreshold = options.miThreshold ?? 0.05;
    this.sustainTicks = Math.max(1, options.sustainTicks ?? 300);

    this.blocks = new Array(this.windowTicksOption);
    this.agg = emptyAggregate();
  }

  reset(): void {
    this.blocks = new Array(this.windowTicksOption);
    this.blockStart = 0;
    this.blockCount = 0;
    this.agg = emptyAggregate();

    this.cumulativeSignalCounts = zeroSignalRecord();
    this.cumulativeBirths = 0;
    this.cumulativeDeaths = { total: 0, predator: 0, starvation: 0, oldAge: 0 };
    this.sumAgeAtDeath = 0;
    this.runningMaxGeneration = 0;
    this.cumulativeDecisionSources = {};

    this.lastTick = 0;
    this.latestTickRecord = null;
    this.sustainStreak = 0;
    this.commCache = null;
    this.timeline = [];
    this.sampleStride = 1;
  }

  record(tick: TickRecord): void {
    this.lastTick = tick.tick;
    this.latestTickRecord = tick;

    for (const s of SIGNALS) {
      this.cumulativeSignalCounts[s] += tick.signalCounts[s] ?? 0;
    }
    this.cumulativeBirths += tick.births;
    for (const d of tick.deaths) {
      this.cumulativeDeaths.total++;
      const cause: DeathCause = d.cause;
      if (cause === 'PREDATOR') this.cumulativeDeaths.predator++;
      else if (cause === 'STARVATION') this.cumulativeDeaths.starvation++;
      else if (cause === 'OLD_AGE') this.cumulativeDeaths.oldAge++;
      this.sumAgeAtDeath += d.age;
    }
    this.runningMaxGeneration = Math.max(this.runningMaxGeneration, tick.maxGeneration);
    for (const [source, count] of Object.entries(tick.decisionSources)) {
      this.cumulativeDecisionSources[source] = (this.cumulativeDecisionSources[source] ?? 0) + count;
    }

    const obs: CompactObs[] = tick.observations.map((o) => ({
      signalEmitted: o.signalEmitted,
      predatorVisible: o.predatorVisible,
      foodVisible: o.foodVisible,
      heard: classifyHeard(o.signalsHeard),
      action: o.action,
    }));
    this.pushBlock({ tick: tick.tick, obs });

    const comm = this.computeCommunicationMetrics();
    if (comm.miSignalPredator > this.miThreshold && comm.miSignalReceiverAction > this.miThreshold) {
      this.sustainStreak++;
    } else {
      this.sustainStreak = 0;
    }
    comm.potentialCommunication = this.sustainStreak >= this.sustainTicks;
    this.commCache = comm;

    if (tick.tick % (this.sampleEvery * this.sampleStride) === 0) {
      this.pushTimelinePoint(tick, comm);
    }
  }

  getGlobal(): GlobalMetrics {
    const t = this.latestTickRecord;
    return {
      tick: this.lastTick,
      population: t?.population ?? 0,
      averageAge: t?.averageAge ?? 0,
      averageEnergy: t?.averageEnergy ?? 0,
      maxGeneration: this.runningMaxGeneration,
      averageGeneration: t?.averageGeneration ?? 0,
      signalCounts: { ...this.cumulativeSignalCounts },
      signalCountsWindow: { ...this.agg.signalCounts },
      signalRate: this.computeSignalRate(),
      deaths: { ...this.cumulativeDeaths },
      births: this.cumulativeBirths,
      averageLifespan: this.computeAverageLifespan(),
      averageTraits: t?.averageTraits ?? { ...ZERO_TRAITS },
      decisionSources: { ...this.cumulativeDecisionSources },
    };
  }

  getCommunication(): CommunicationMetrics {
    if (this.commCache) return this.commCache;
    const comm = this.computeCommunicationMetrics();
    comm.potentialCommunication = this.sustainStreak >= this.sustainTicks;
    return comm;
  }

  getTimeline(): readonly TimelinePoint[] {
    return this.timeline;
  }

  private computeSignalRate(): number {
    const { sampleSize, signalCounts } = this.agg;
    if (sampleSize <= 0) return 0;
    return (signalCounts.A + signalCounts.B) / sampleSize;
  }

  private computeAverageLifespan(): number {
    return this.cumulativeDeaths.total > 0 ? this.sumAgeAtDeath / this.cumulativeDeaths.total : 0;
  }

  private pushBlock(block: TickBlock): void {
    const capacity = this.blocks.length;
    if (this.blockCount === capacity) {
      const evicted = this.blocks[this.blockStart];
      if (evicted) {
        for (const o of evicted.obs) this.removeObs(o);
      }
      this.blocks[this.blockStart] = block;
      this.blockStart = (this.blockStart + 1) % capacity;
    } else {
      const idx = (this.blockStart + this.blockCount) % capacity;
      this.blocks[idx] = block;
      this.blockCount++;
    }
    for (const o of block.obs) this.addObs(o);
  }

  private addObs(o: CompactObs): void {
    const agg = this.agg;
    agg.sampleSize++;
    agg.signalCounts[o.signalEmitted]++;
    addPair(agg.jointPredatorSignal, String(o.predatorVisible), o.signalEmitted);
    addPair(agg.jointFoodSignal, String(o.foodVisible), o.signalEmitted);
    addPair(agg.jointHeardAction, o.heard, o.action);
    addPair(agg.jointHeardFlee, o.heard, String(o.action === 'FLEE'));
    if (!o.predatorVisible) {
      addPair(agg.jointHeardActionNoPredator, o.heard, o.action);
    }
  }

  private removeObs(o: CompactObs): void {
    const agg = this.agg;
    agg.sampleSize--;
    agg.signalCounts[o.signalEmitted]--;
    removePair(agg.jointPredatorSignal, String(o.predatorVisible), o.signalEmitted);
    removePair(agg.jointFoodSignal, String(o.foodVisible), o.signalEmitted);
    removePair(agg.jointHeardAction, o.heard, o.action);
    removePair(agg.jointHeardFlee, o.heard, String(o.action === 'FLEE'));
    if (!o.predatorVisible) {
      removePair(agg.jointHeardActionNoPredator, o.heard, o.action);
    }
  }

  private computeCommunicationMetrics(): CommunicationMetrics {
    const agg = this.agg;

    const pSignalGivenPredatorVisible = rowDistribution(
      agg.jointPredatorSignal,
      'true',
      SIGNALS,
    ) as Record<Signal, number>;
    const pSignalGivenNoPredator = rowDistribution(
      agg.jointPredatorSignal,
      'false',
      SIGNALS,
    ) as Record<Signal, number>;
    const pSignalGivenFoodVisible = rowDistribution(agg.jointFoodSignal, 'true', SIGNALS) as Record<
      Signal,
      number
    >;
    const pSignalGivenNoFood = rowDistribution(agg.jointFoodSignal, 'false', SIGNALS) as Record<
      Signal,
      number
    >;

    const pFleeGivenHeard = {} as Record<HeardCategory, number>;
    const pFleeGivenHeardNoPredator = {} as Record<HeardCategory, number>;
    for (const h of HEARD_CATEGORIES) {
      const fleeDist = rowDistribution(agg.jointHeardFlee, h, ['true', 'false']);
      pFleeGivenHeard[h] = fleeDist['true'] ?? 0;
      const noPredatorDist = rowDistribution(agg.jointHeardActionNoPredator, h, BUG_ACTIONS);
      pFleeGivenHeardNoPredator[h] = noPredatorDist['FLEE'] ?? 0;
    }

    return {
      windowTicks: this.windowTicksOption,
      sampleSize: agg.sampleSize,
      pSignalGivenPredatorVisible,
      pSignalGivenNoPredator,
      pSignalGivenFoodVisible,
      pSignalGivenNoFood,
      pFleeGivenHeard,
      pFleeGivenHeardNoPredator,
      miSignalPredator: mutualInformationFromCounts(agg.jointPredatorSignal),
      miSignalFood: mutualInformationFromCounts(agg.jointFoodSignal),
      miSignalReceiverAction: mutualInformationFromCounts(agg.jointHeardAction),
      miSignalReceiverFlee: mutualInformationFromCounts(agg.jointHeardFlee),
      potentialCommunication: false,
    };
  }

  private pushTimelinePoint(tick: TickRecord, comm: CommunicationMetrics): void {
    const point: TimelinePoint = {
      tick: tick.tick,
      population: tick.population,
      averageLifespan: this.computeAverageLifespan(),
      signalRate: this.computeSignalRate(),
      miSignalPredator: comm.miSignalPredator,
      miSignalReceiverAction: comm.miSignalReceiverAction,
      averageEnergy: tick.averageEnergy,
      maxGeneration: tick.maxGeneration,
    };
    this.timeline.push(point);
    if (this.timeline.length > this.maxTimelinePoints) {
      const downsampled: TimelinePoint[] = [];
      for (let i = 0; i < this.timeline.length; i += 2) downsampled.push(this.timeline[i]);
      this.timeline = downsampled;
      this.sampleStride *= 2;
    }
  }
}
