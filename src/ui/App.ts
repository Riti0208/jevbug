/**
 * App — builds the DOM, wires the start screen and the run layout together.
 * Owns the ThreeRenderer (created fresh per run) and the rAF render loop;
 * everything simulation-related lives in SimulationController.
 */
import { ThreeRenderer } from '../renderer/ThreeRenderer';
import type { SimulationConfig } from '../simulation/config';
import { SimulationController } from './SimulationController';
import { createStartForm } from './StartForm';
import { createControlBar } from './ControlBar';
import { createMetricsPanel } from './MetricsPanel';
import { createCommunicationPanel } from './CommunicationPanel';
import { createTimelineChart } from './TimelineChart';
import { createInspectorPanel } from './InspectorPanel';
import { createLegendBar } from './LegendBar';
import { el, setChildren } from './dom';

const DESKTOP_QUERY = '(min-width: 900px)';
/** Cap on how often a new tick's RenderSnapshot is uploaded to the renderer, so MAX
 * speed (which can produce far more than 30 ticks in 33ms) never floods three.js. */
const MAX_SNAPSHOT_UPLOADS_PER_SEC = 30;

type MobileTab = 'controls' | 'metrics' | 'inspector';

export function createApp(root: HTMLElement): void {
  const controller = new SimulationController();
  showStartScreen();

  function showStartScreen(): void {
    setChildren(root, [createStartForm({ onStart: startRun })]);
  }

  function startRun(config: SimulationConfig): void {
    controller.start(config);
    const { element, cleanup } = buildRunLayout(config, () => {
      cleanup();
      showStartScreen();
    });
    setChildren(root, [element]);
  }

  function buildRunLayout(config: SimulationConfig, onStop: () => void): { element: HTMLElement; cleanup: () => void } {
    const disposers: (() => void)[] = [];

    // ---- stage (canvas) ----
    const canvasHost = el('div', { className: 'canvas-host' });
    const stage = el('div', { className: 'stage' }, [canvasHost]);

    let renderer: ThreeRenderer | null = null;
    try {
      renderer = new ThreeRenderer(canvasHost, { worldSize: config.worldSize });
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      stage.appendChild(
        el('div', { className: 'stage-error' }, [
          `Renderer unavailable (${message}). The simulation keeps running — metrics, the inspector and export still work.`,
        ]),
      );
    }

    const legendHelpBlock = el('div', { className: 'legend-help-block' }, [
      createLegendBar(),
      el('p', { className: 'help-line' }, ['drag to pan · wheel/pinch to zoom · tap a bug to inspect']),
      el('p', { className: 'help-line' }, ['keys: space pause · 1-5 speed · f fit · esc deselect']),
    ]);

    if (renderer) {
      const r = renderer;
      const unsubClick = r.onClick((world) => {
        const sim = controller.simulation;
        if (!sim) return;
        const pickRadius = Math.max(1.0, 22 * r.getWorldUnitsPerPixel());
        const bug = sim.findNearestBug(world, pickRadius);
        controller.selectBug(bug ? bug.id : null);
        // On phones the inspector lives in the bottom sheet: open it when a bug is tapped.
        if (bug && !isDesktop()) setActiveTab('inspector');
      });
      disposers.push(unsubClick);
    }

    // ---- control bar ----
    const controlBar = createControlBar(controller, {
      onStop: onStop,
      onFitView: () => renderer?.fitWorld(),
    });
    disposers.push(controlBar.dispose);

    // ---- panels (created once; reparented between desktop columns and the mobile sheet) ----
    const metricsPanel = createMetricsPanel(controller);
    const commPanel = createCommunicationPanel(controller);
    const timelineChart = createTimelineChart(controller);
    const inspectorPanel = createInspectorPanel(controller);
    disposers.push(timelineChart.dispose);

    const desktopLeft = el('div', { className: 'desktop-col desktop-left' });
    const desktopRight = el('div', { className: 'desktop-col desktop-right' });

    const tabButtons: Record<MobileTab, HTMLButtonElement> = {
      controls: el('button', { type: 'button', className: 'sheet-tab' }, ['Controls']),
      metrics: el('button', { type: 'button', className: 'sheet-tab' }, ['Metrics']),
      inspector: el('button', { type: 'button', className: 'sheet-tab' }, ['Inspector']),
    };
    const slots: Record<MobileTab, HTMLElement> = {
      controls: el('div', { className: 'sheet-slot', 'data-tab': 'controls' }),
      metrics: el('div', { className: 'sheet-slot', 'data-tab': 'metrics' }),
      inspector: el('div', { className: 'sheet-slot', 'data-tab': 'inspector' }),
    };
    let activeTab: MobileTab = 'metrics';
    const mobileSheet = el('div', { className: 'mobile-sheet' }, [
      el('div', { className: 'sheet-tabbar' }, [tabButtons.controls, tabButtons.metrics, tabButtons.inspector]),
      el('div', { className: 'sheet-body' }, [slots.controls, slots.metrics, slots.inspector]),
    ]);

    function setActiveTab(tab: MobileTab, opts: { toggleCollapse?: boolean } = {}): void {
      const isSameTab = tab === activeTab && opts.toggleCollapse;
      activeTab = tab;
      for (const t of Object.keys(tabButtons) as MobileTab[]) {
        tabButtons[t].classList.toggle('active', t === tab);
        slots[t].classList.toggle('active', t === tab);
      }
      if (isSameTab) {
        mobileSheet.classList.toggle('collapsed');
      } else {
        mobileSheet.classList.remove('collapsed');
      }
    }
    (Object.keys(tabButtons) as MobileTab[]).forEach((tab) => {
      tabButtons[tab].addEventListener('click', () => setActiveTab(tab, { toggleCollapse: true }));
    });
    setActiveTab('metrics');
    // Start collapsed on mobile so the canvas is fully visible until the user opens a tab
    // (desktop ignores this class — .mobile-sheet is hidden there entirely).
    mobileSheet.classList.add('collapsed');

    function isDesktop(): boolean {
      return window.matchMedia(DESKTOP_QUERY).matches;
    }

    function applyLayout(): void {
      if (isDesktop()) {
        desktopLeft.append(legendHelpBlock);
        desktopRight.append(metricsPanel.element, commPanel.element, timelineChart.element, inspectorPanel.element);
      } else {
        slots.controls.append(legendHelpBlock);
        slots.metrics.append(metricsPanel.element, commPanel.element, timelineChart.element);
        slots.inspector.append(inspectorPanel.element);
      }
    }
    applyLayout();

    const mql = window.matchMedia(DESKTOP_QUERY);
    const onLayoutChange = () => applyLayout();
    mql.addEventListener?.('change', onLayoutChange);
    disposers.push(() => mql.removeEventListener?.('change', onLayoutChange));

    const layout = el('div', { className: 'run-layout' }, [
      controlBar.element,
      stage,
      desktopLeft,
      desktopRight,
      mobileSheet,
    ]);

    // ---- render loop (rAF; only rendering — the sim loop inside SimulationController
    // uses setTimeout so it keeps advancing while the tab is hidden/backgrounded) ----
    let lastRenderedTick = -1;
    let lastSnapshotUploadAt = 0;
    let lastSelectedId: string | null = null;
    let rafId = 0;

    function frame(now: number): void {
      const state = controller.getState();
      if (renderer) {
        if (state.selectedBugId !== lastSelectedId) {
          lastSelectedId = state.selectedBugId;
          renderer.setSelectedBug(lastSelectedId);
        }
        if (state.tick !== lastRenderedTick) {
          const elapsed = now - lastSnapshotUploadAt;
          if (elapsed >= 1000 / MAX_SNAPSHOT_UPLOADS_PER_SEC) {
            const snapshot = controller.getRenderSnapshot();
            if (snapshot) {
              renderer.setSnapshot(snapshot);
              lastRenderedTick = state.tick;
              lastSnapshotUploadAt = now;
            }
          }
        }
        renderer.render(now);
      }
      rafId = requestAnimationFrame(frame);
    }
    rafId = requestAnimationFrame(frame);
    disposers.push(() => cancelAnimationFrame(rafId));

    // ---- panel refresh intervals (App drives rate limiting, not the panels) ----
    const metricsInterval = window.setInterval(() => metricsPanel.refresh(), 250); // 4 Hz
    const commInterval = window.setInterval(() => commPanel.refresh(), 250); // 4 Hz
    const timelineInterval = window.setInterval(() => timelineChart.refresh(), 500); // 2 Hz
    const inspectorInterval = window.setInterval(() => inspectorPanel.refresh(), 125); // 8 Hz
    disposers.push(() => {
      clearInterval(metricsInterval);
      clearInterval(commInterval);
      clearInterval(timelineInterval);
      clearInterval(inspectorInterval);
    });

    // ---- keyboard shortcuts (PC only; ignored while a form field has focus) ----
    function onKeyDown(e: KeyboardEvent): void {
      const target = e.target;
      if (target instanceof HTMLElement && ['INPUT', 'TEXTAREA', 'SELECT'].includes(target.tagName)) return;
      switch (e.key) {
        case ' ': {
          e.preventDefault();
          const s = controller.getState();
          if (s.status === 'running') controller.pause();
          else if (s.status === 'paused') controller.resume();
          break;
        }
        case '1':
          controller.setSpeed(1);
          break;
        case '2':
          controller.setSpeed(5);
          break;
        case '3':
          controller.setSpeed(20);
          break;
        case '4':
          controller.setSpeed(100);
          break;
        case '5':
          controller.setSpeed('MAX');
          break;
        case 'f':
        case 'F':
          renderer?.fitWorld();
          break;
        case 'Escape':
          controller.selectBug(null);
          break;
        default:
          break;
      }
    }
    window.addEventListener('keydown', onKeyDown);
    disposers.push(() => window.removeEventListener('keydown', onKeyDown));

    function cleanup(): void {
      for (const dispose of disposers) dispose();
      renderer?.dispose();
    }

    return { element: layout, cleanup };
  }
}
