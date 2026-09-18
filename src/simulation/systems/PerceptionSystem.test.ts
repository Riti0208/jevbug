import { describe, expect, it } from 'vitest';
import { createConfig } from '../config';
import { createBug } from '../entities/Bug';
import { createFood } from '../entities/Food';
import { createPredator } from '../entities/Predator';
import type { WorldSnapshot } from '../types';
import { buildPerceptionIndices, perceiveBug } from './PerceptionSystem';

const config = createConfig({ worldSize: 50, bugViewDistance: 6, bugSignalDistance: 8, bugNeighborDistance: 6 });

function snapshotOf(partial: Partial<WorldSnapshot>): WorldSnapshot {
  return {
    tick: 0,
    worldSize: config.worldSize,
    bugs: [],
    predators: [],
    foods: [],
    signalsInFlight: [],
    ...partial,
  };
}

describe('PerceptionSystem direction classification', () => {
  it('classifies food directly ahead as front', () => {
    const bug = createBug('b1', { x: 25, y: 25 }, 0, dummyTraits(), config);
    const food = createFood('f1', { x: 28, y: 25 }, 0.25);
    const snapshot = snapshotOf({ bugs: [bug], foods: [food] });
    const indices = buildPerceptionIndices(snapshot, config);
    const perception = perceiveBug(bug, snapshot, indices, config);
    expect(perception.foodDirection).toBe('front');
  });

  it('classifies food to the left / right correctly', () => {
    const bug = createBug('b1', { x: 25, y: 25 }, 0, dummyTraits(), config);
    const foodLeft = createFood('fl', { x: 25, y: 28 }, 0.25); // +y is counter-clockwise ("left") of facing +x
    const snapLeft = snapshotOf({ bugs: [bug], foods: [foodLeft] });
    const idxLeft = buildPerceptionIndices(snapLeft, config);
    expect(perceiveBug(bug, snapLeft, idxLeft, config).foodDirection).toBe('left');

    const foodRight = createFood('fr', { x: 25, y: 22 }, 0.25);
    const snapRight = snapshotOf({ bugs: [bug], foods: [foodRight] });
    const idxRight = buildPerceptionIndices(snapRight, config);
    expect(perceiveBug(bug, snapRight, idxRight, config).foodDirection).toBe('right');
  });

  it('sees nothing beyond view distance', () => {
    const bug = createBug('b1', { x: 25, y: 25 }, 0, dummyTraits(), config);
    const farFood = createFood('far', { x: 25 + config.bugViewDistance + 1, y: 25 }, 0.25);
    const snapshot = snapshotOf({ bugs: [bug], foods: [farFood] });
    const indices = buildPerceptionIndices(snapshot, config);
    expect(perceiveBug(bug, snapshot, indices, config).foodDirection).toBeNull();
  });

  it('wraps around the torus seam to see food across the edge', () => {
    const bug = createBug('b1', { x: 1, y: 25 }, Math.PI, dummyTraits(), config); // facing -x, toward the seam
    const food = createFood('f1', { x: 49, y: 25 }, 0.25); // 2 units away across the seam
    const snapshot = snapshotOf({ bugs: [bug], foods: [food] });
    const indices = buildPerceptionIndices(snapshot, config);
    const perception = perceiveBug(bug, snapshot, indices, config);
    expect(perception.foodDirection).toBe('front');
  });

  it('detects predators the same way as food, within bugViewDistance', () => {
    const bug = createBug('b1', { x: 10, y: 10 }, 0, dummyTraits(), config);
    const predator = createPredator('p1', { x: 13, y: 10 }, 0);
    const snapshot = snapshotOf({ bugs: [bug], predators: [predator] });
    const indices = buildPerceptionIndices(snapshot, config);
    expect(perceiveBug(bug, snapshot, indices, config).predatorDirection).toBe('front');
  });
});

describe('PerceptionSystem heard signals', () => {
  it('hears a signal within range, from another bug', () => {
    const bug = createBug('b1', { x: 10, y: 10 }, 0, dummyTraits(), config);
    const snapshot = snapshotOf({
      bugs: [bug],
      signalsInFlight: [{ bugId: 'other', position: { x: 12, y: 10 }, signal: 'A' }],
    });
    const indices = buildPerceptionIndices(snapshot, config);
    const perception = perceiveBug(bug, snapshot, indices, config);
    expect(perception.heardSignals).toEqual([{ signal: 'A' }]);
  });

  it('does not hear its own emitted signal', () => {
    const bug = createBug('b1', { x: 10, y: 10 }, 0, dummyTraits(), config);
    const snapshot = snapshotOf({
      bugs: [bug],
      signalsInFlight: [{ bugId: 'b1', position: { x: 10, y: 10 }, signal: 'A' }],
    });
    const indices = buildPerceptionIndices(snapshot, config);
    expect(perceiveBug(bug, snapshot, indices, config).heardSignals).toEqual([]);
  });

  it('does not hear signals beyond bugSignalDistance', () => {
    const bug = createBug('b1', { x: 10, y: 10 }, 0, dummyTraits(), config);
    const snapshot = snapshotOf({
      bugs: [bug],
      signalsInFlight: [{ bugId: 'other', position: { x: 10 + config.bugSignalDistance + 1, y: 10 }, signal: 'A' }],
    });
    const indices = buildPerceptionIndices(snapshot, config);
    expect(perceiveBug(bug, snapshot, indices, config).heardSignals).toEqual([]);
  });

  it('preserves duplicate signals and their order', () => {
    const bug = createBug('b1', { x: 10, y: 10 }, 0, dummyTraits(), config);
    const snapshot = snapshotOf({
      bugs: [bug],
      signalsInFlight: [
        { bugId: 'x', position: { x: 11, y: 10 }, signal: 'A' },
        { bugId: 'y', position: { x: 9, y: 10 }, signal: 'A' },
        { bugId: 'z', position: { x: 10, y: 11 }, signal: 'B' },
      ],
    });
    const indices = buildPerceptionIndices(snapshot, config);
    expect(perceiveBug(bug, snapshot, indices, config).heardSignals).toEqual([
      { signal: 'A' },
      { signal: 'A' },
      { signal: 'B' },
    ]);
  });
});

function dummyTraits() {
  return { curiosity: 0.5, aggression: 0.5, sociality: 0.5, signalTendency: 0.5, memoryLength: 10, speed: 0.5 };
}
