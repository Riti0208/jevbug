/**
 * Manual visual harness for the renderer — not wired into any index.html (there isn't
 * one yet). The UI engineer / orchestrator can call `runRendererDemo(container)` from a
 * scratch page or a browser console to eyeball bugs, predators, food, signals, panning,
 * zooming and selection without the simulation core being ready.
 *
 * Generates a synthetic `RenderSnapshot` each frame: 30 bugs walking in slow circles,
 * 2 predators drifting, 60 stationary food items, and a random A/B signal emitted every
 * few frames from a random bug.
 */
import type { RenderBug, RenderPredator, RenderFood, RenderSignal, RenderSnapshot } from '@/simulation/types';
import { ThreeRenderer } from './ThreeRenderer';

const WORLD_SIZE = 40;
const BUG_COUNT = 30;
const PREDATOR_COUNT = 2;
const FOOD_COUNT = 60;

function mulberry32(seed: number): () => number {
  let a = seed;
  return () => {
    a |= 0;
    a = (a + 0x6d2b79f5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

export function runRendererDemo(container: HTMLElement): () => void {
  const renderer = new ThreeRenderer(container, {
    worldSize: WORLD_SIZE,
    signalRadius: 8,
    signalLifetimeMs: 700,
  });

  const rand = mulberry32(1234);

  const bugSeeds = Array.from({ length: BUG_COUNT }, (_, i) => ({
    id: `bug-${i}`,
    centerX: rand() * WORLD_SIZE,
    centerY: rand() * WORLD_SIZE,
    orbitRadius: 1 + rand() * 6,
    angularSpeed: (0.2 + rand() * 0.6) * (rand() < 0.5 ? -1 : 1),
    phase: rand() * Math.PI * 2,
    generation: Math.floor(rand() * 8),
    baseEnergy: 0.3 + rand() * 0.7,
  }));

  const predatorSeeds = Array.from({ length: PREDATOR_COUNT }, (_, i) => ({
    id: `predator-${i}`,
    centerX: rand() * WORLD_SIZE,
    centerY: rand() * WORLD_SIZE,
    orbitRadius: 6 + rand() * 10,
    angularSpeed: (0.05 + rand() * 0.1) * (rand() < 0.5 ? -1 : 1),
    phase: rand() * Math.PI * 2,
  }));

  const foods: RenderFood[] = Array.from({ length: FOOD_COUNT }, (_, i) => ({
    id: `food-${i}`,
    x: rand() * WORLD_SIZE,
    y: rand() * WORLD_SIZE,
  }));

  // Click a bug to select it, click empty space to clear the selection — exercises
  // screenToWorld / onClick / setSelectedBug end to end.
  let selectedId: string | null = null;
  const unsubscribeClick = renderer.onClick((world) => {
    let closest: RenderBug | null = null;
    let closestDist = Infinity;
    for (const seed of bugSeeds) {
      const d = Math.hypot(world.x - seed.centerX, world.y - seed.centerY);
      if (d < closestDist) {
        closestDist = d;
        closest = { id: seed.id } as RenderBug;
      }
    }
    const pickRadiusWorld = 1.5 * renderer.getWorldUnitsPerPixel() * 20;
    selectedId = closest && closestDist < pickRadiusWorld ? closest.id : null;
    renderer.setSelectedBug(selectedId);
  });

  let tick = 0;
  let lastSignalTick = 0;
  let rafId = 0;

  const step = (nowMs: number) => {
    tick++;
    const t = nowMs / 1000;

    const bugs: RenderBug[] = bugSeeds.map((s) => {
      const angle = s.phase + t * s.angularSpeed;
      const x = ((s.centerX + Math.cos(angle) * s.orbitRadius) % WORLD_SIZE + WORLD_SIZE) % WORLD_SIZE;
      const y = ((s.centerY + Math.sin(angle) * s.orbitRadius) % WORLD_SIZE + WORLD_SIZE) % WORLD_SIZE;
      const energy = Math.max(0.05, Math.min(1, s.baseEnergy + 0.2 * Math.sin(t * 0.3 + s.phase)));
      const fear = Math.max(0, Math.min(1, 0.5 + 0.5 * Math.sin(t * 0.7 + s.phase * 2)));
      return {
        id: s.id,
        x,
        y,
        direction: angle + Math.PI / 2,
        energy,
        generation: s.generation,
        fear: fear > 0.85 ? fear : 0, // mostly calm, occasionally fearful
        selected: s.id === selectedId,
      };
    });

    const predators: RenderPredator[] = predatorSeeds.map((s) => {
      const angle = s.phase + t * s.angularSpeed;
      const x = ((s.centerX + Math.cos(angle) * s.orbitRadius) % WORLD_SIZE + WORLD_SIZE) % WORLD_SIZE;
      const y = ((s.centerY + Math.sin(angle) * s.orbitRadius) % WORLD_SIZE + WORLD_SIZE) % WORLD_SIZE;
      return { id: s.id, x, y, direction: angle + Math.PI / 2 };
    });

    const signals: RenderSignal[] = [];
    if (tick - lastSignalTick > 20 + Math.floor(rand() * 40)) {
      lastSignalTick = tick;
      const emitterCount = 1 + Math.floor(rand() * 3);
      for (let i = 0; i < emitterCount; i++) {
        const emitter = bugSeeds[Math.floor(rand() * bugSeeds.length)];
        const bug = bugs.find((b) => b.id === emitter.id);
        if (!bug) continue;
        signals.push({
          id: emitter.id,
          x: bug.x,
          y: bug.y,
          signal: rand() < 0.5 ? 'A' : 'B',
          tick,
        });
      }
    }

    const snapshot: RenderSnapshot = { tick, worldSize: WORLD_SIZE, bugs, predators, foods, signals };
    renderer.setSnapshot(snapshot);
    renderer.render(nowMs);
    rafId = requestAnimationFrame(step);
  };

  rafId = requestAnimationFrame(step);

  return () => {
    cancelAnimationFrame(rafId);
    unsubscribeClick();
    renderer.dispose();
  };
}
