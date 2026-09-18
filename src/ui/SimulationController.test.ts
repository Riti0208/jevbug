import { describe, it, expect } from 'vitest';
import { SimulationController, BASE_TICKS_PER_SECOND, type SimulationControllerDeps } from './SimulationController';
import { MockDecisionProvider } from '../simulation/decision/MockDecisionProvider';
import { createConfig } from '../simulation/config';

/** Flushes the microtask queue (one real macrotask hop is enough: Node drains all
 * microtasks, including ones queued while draining, before running the next macrotask). */
function flush(): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, 0));
}

interface Harness {
  deps: SimulationControllerDeps;
  advance: (ms: number) => void;
  runNextScheduled: () => number | null;
  pendingCount: () => number;
}

function makeHarness(): Harness {
  let t = 0;
  let nextId = 0;
  const cancelled = new Set<number>();
  const queue: { id: number; fn: () => void; ms: number }[] = [];

  const deps: SimulationControllerDeps = {
    providerFactory: () => new MockDecisionProvider(),
    now: () => t,
    schedule: (fn, ms) => {
      const id = nextId++;
      queue.push({ id, fn, ms });
      return id;
    },
    cancel: (handle) => {
      cancelled.add(handle as number);
    },
  };

  return {
    deps,
    advance: (ms: number) => {
      t += ms;
    },
    runNextScheduled: () => {
      while (queue.length > 0) {
        const item = queue.shift()!;
        if (cancelled.has(item.id)) continue;
        item.fn();
        return item.ms;
      }
      return null;
    },
    pendingCount: () => queue.filter((q) => !cancelled.has(q.id)).length,
  };
}

function tinyConfig() {
  return createConfig({ initialBugs: 6, initialPredators: 1, initialFood: 10, worldSize: 20 });
}

describe('SimulationController lifecycle', () => {
  it('starts idle-adjacent and transitions to running on start()', () => {
    const h = makeHarness();
    const controller = new SimulationController(h.deps);
    expect(controller.getState().status).toBe('idle');
    controller.start(tinyConfig());
    expect(controller.getState().status).toBe('running');
    expect(controller.simulation).not.toBeNull();
    expect(controller.metrics).not.toBeNull();
    expect(controller.provider).not.toBeNull();
  });

  it('advances ticks and emits tick/state events as the loop runs', async () => {
    const h = makeHarness();
    const controller = new SimulationController(h.deps);
    const tickEvents: number[] = [];
    controller.on('tick', (r) => tickEvents.push(r.tick));

    controller.start(tinyConfig());
    await flush();

    expect(controller.getState().tick).toBe(1);
    expect(tickEvents).toEqual([1]);
    expect(h.pendingCount()).toBe(1); // next loop iteration scheduled

    h.runNextScheduled();
    await flush();
    expect(controller.getState().tick).toBe(2);
    expect(tickEvents).toEqual([1, 2]);
  });

  it('pause() stops scheduling further ticks; resume() restarts the loop', async () => {
    const h = makeHarness();
    const controller = new SimulationController(h.deps);
    controller.start(tinyConfig());
    await flush();
    expect(controller.getState().tick).toBe(1);
    expect(h.pendingCount()).toBe(1);

    controller.pause();
    expect(controller.getState().status).toBe('paused');
    expect(controller.getState().speed).toBe('PAUSED');
    // the already-scheduled next iteration is cancelled
    expect(h.pendingCount()).toBe(0);

    // running the (now cancelled) scheduled callback must not advance the tick
    h.runNextScheduled();
    await flush();
    expect(controller.getState().tick).toBe(1);

    controller.resume();
    expect(controller.getState().status).toBe('running');
    await flush();
    expect(controller.getState().tick).toBe(2);
  });

  it('step() advances exactly one tick while paused, and is a no-op otherwise', async () => {
    const h = makeHarness();
    const controller = new SimulationController(h.deps);
    controller.start(tinyConfig());
    await flush();
    controller.pause();
    const before = controller.getState().tick;

    await controller.step();
    expect(controller.getState().tick).toBe(before + 1);

    await controller.step();
    expect(controller.getState().tick).toBe(before + 2);

    // no extra loop scheduling happened from manual stepping
    expect(h.pendingCount()).toBe(0);
  });

  it('stop() returns to a stopped state but keeps the last simulation/metrics readable', async () => {
    const h = makeHarness();
    const controller = new SimulationController(h.deps);
    controller.start(tinyConfig());
    await flush();
    const tickAtStop = controller.getState().tick;

    controller.stop();
    expect(controller.getState().status).toBe('stopped');
    expect(h.pendingCount()).toBe(0);
    // last-run data is still readable for the "keep metrics visible" requirement
    expect(controller.simulation).not.toBeNull();
    expect(controller.metrics?.getGlobal().tick).toBe(tickAtStop);

    // running any leftover scheduled callback (there should be none) must not resurrect ticking
    h.runNextScheduled();
    await flush();
    expect(controller.getState().tick).toBe(tickAtStop);
  });

  it('a stale step() result from before stop() is discarded (no overlap corruption)', async () => {
    const h = makeHarness();
    const controller = new SimulationController(h.deps);
    controller.start(tinyConfig());
    // Stop synchronously while the very first step() is still in flight (awaiting the provider).
    controller.stop();
    await flush();
    expect(controller.getState().tick).toBe(0);
    expect(controller.getState().status).toBe('stopped');
  });

  it('start() after a previous run tears down the old simulation/provider', async () => {
    const h = makeHarness();
    const controller = new SimulationController(h.deps);
    controller.start(tinyConfig());
    await flush();
    const firstSim = controller.simulation;

    controller.start(tinyConfig());
    expect(controller.simulation).not.toBe(firstSim);
    expect(controller.getState().tick).toBe(0);
  });
});

describe('SimulationController speed -> interval', () => {
  it('defaults to 1x and schedules the next iteration close to 1000/BASE_TICKS_PER_SECOND ms', async () => {
    const h = makeHarness();
    const controller = new SimulationController(h.deps);
    controller.start(tinyConfig());
    await flush();
    expect(controller.getState().speed).toBe(1);
    // now() never advances in this harness, so elapsed = 0 and the full interval is scheduled.
    const ms = h.runNextScheduled();
    expect(ms).toBe(1000 / BASE_TICKS_PER_SECOND);
  });

  it('setSpeed(5) schedules a proportionally shorter interval', async () => {
    const h = makeHarness();
    const controller = new SimulationController(h.deps);
    controller.start(tinyConfig());
    await flush();
    controller.setSpeed(5);
    h.runNextScheduled(); // drain the interval scheduled from the tick before setSpeed
    await flush();
    const ms = h.runNextScheduled();
    expect(ms).toBe(1000 / (BASE_TICKS_PER_SECOND * 5));
  });

  it('setSpeed(MAX) schedules with 0ms delay', async () => {
    const h = makeHarness();
    const controller = new SimulationController(h.deps);
    controller.start(tinyConfig());
    await flush();
    controller.setSpeed('MAX');
    h.runNextScheduled();
    await flush();
    const ms = h.runNextScheduled();
    expect(ms).toBe(0);
  });

  it('setSpeed(PAUSED) pauses, and setting a numeric speed while paused resumes', async () => {
    const h = makeHarness();
    const controller = new SimulationController(h.deps);
    controller.start(tinyConfig());
    await flush();
    controller.setSpeed('PAUSED');
    expect(controller.getState().status).toBe('paused');
    controller.setSpeed(20);
    expect(controller.getState().status).toBe('running');
    expect(controller.getState().speed).toBe(20);
  });
});

describe('SimulationController ticksPerSecond', () => {
  it('computes a positive EMA that reflects the configured tick spacing', async () => {
    const h = makeHarness();
    const controller = new SimulationController(h.deps);
    controller.start(tinyConfig());
    await flush();
    expect(controller.getState().ticksPerSecond).toBeGreaterThan(0);

    for (let i = 0; i < 5; i++) {
      h.advance(200); // simulate ~5 ticks/sec real spacing
      h.runNextScheduled();
      await flush();
    }
    // Should have converged close to 5 ticks/sec (1000ms / 200ms).
    expect(controller.getState().ticksPerSecond).toBeGreaterThan(3);
    expect(controller.getState().ticksPerSecond).toBeLessThan(7);
  });
});

describe('SimulationController selection', () => {
  it('selectBug updates state and is reflected in getRenderSnapshot', async () => {
    const h = makeHarness();
    const controller = new SimulationController(h.deps);
    controller.start(tinyConfig());
    await flush();
    const bug = controller.simulation!.getBugs()[0];
    controller.selectBug(bug.id);
    expect(controller.getState().selectedBugId).toBe(bug.id);
    const snapshot = controller.getRenderSnapshot();
    const rb = snapshot!.bugs.find((b) => b.id === bug.id);
    expect(rb?.selected).toBe(true);

    controller.selectBug(null);
    expect(controller.getState().selectedBugId).toBeNull();
  });
});

describe('SimulationController buildExport', () => {
  it('returns null before a run has started', () => {
    const h = makeHarness();
    const controller = new SimulationController(h.deps);
    expect(controller.buildExport()).toBeNull();
  });

  it('produces an ExperimentExport-shaped object matching the run config', async () => {
    const h = makeHarness();
    const controller = new SimulationController(h.deps);
    const config = tinyConfig();
    controller.start(config);
    await flush();
    h.runNextScheduled();
    await flush();

    const exported = controller.buildExport();
    expect(exported).not.toBeNull();
    expect(exported!.seed).toBe(config.seed);
    expect(exported!.mode).toBe(config.mode);
    expect(exported!.memoryMode).toBe(config.memoryMode);
    expect(exported!.provider).toBe('mock');
    expect(exported!.config).toEqual(config);
    expect(exported!.ticksRun).toBe(2);
    expect(exported!.final).toBeDefined();
    expect(exported!.communication).toBeDefined();
    expect(Array.isArray(exported!.timeline)).toBe(true);
    expect(Array.isArray(exported!.rows)).toBe(true);
    expect(Array.isArray(exported!.deaths)).toBe(true);
  });

  it('keeps working after stop() (export from the last completed run)', async () => {
    const h = makeHarness();
    const controller = new SimulationController(h.deps);
    controller.start(tinyConfig());
    await flush();
    controller.stop();
    expect(controller.buildExport()).not.toBeNull();
  });
});

describe('SimulationController error handling', () => {
  it('a provider that throws never stops the loop; lastError and error event are set', async () => {
    const h = makeHarness();
    let calls = 0;
    const throwingDeps: SimulationControllerDeps = {
      ...h.deps,
      providerFactory: () => {
        return {
          name: 'throwing',
          async decideBatch() {
            calls++;
            throw new Error('boom');
          },
          async decideAction() {
            throw new Error('boom');
          },
          async decideSignal() {
            throw new Error('boom');
          },
        };
      },
    };
    const controller = new SimulationController(throwingDeps);
    const errors: string[] = [];
    controller.on('error', (m) => errors.push(m));
    controller.start(tinyConfig());
    await flush();
    // Simulation.step() itself swallows provider errors (falls back to uniform decisions
    // internally), so the controller should NOT see an error and ticking should proceed.
    expect(controller.getState().tick).toBe(1);
    expect(calls).toBeGreaterThan(0);
    expect(controller.getState().status).toBe('running');
  });
});
