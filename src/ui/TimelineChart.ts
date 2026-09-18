/**
 * Timeline charts (uPlot): population & average lifespan on one scale, and
 * signal rate / MI(Signal;Predator) / MI(Signal;ReceiverAction) on a 0..1-ish
 * scale on a second, stacked chart. Data comes from `metrics.getTimeline()`.
 * `refresh()` is driven by App at <= 2 Hz (spec). Both charts resize with
 * their container via ResizeObserver.
 */
import type uPlot from 'uplot';
import 'uplot/dist/uPlot.min.css';
import type { SimulationController } from './SimulationController';
import { el } from './dom';

type UPlotCtor = typeof uPlot;

/**
 * uPlot is loaded lazily: its module initialisation touches `Intl` with the
 * browser locale, and an exotic locale (or an old browser) must only disable
 * the chart, never the whole instrument.
 */
let uPlotPromise: Promise<UPlotCtor | null> | null = null;
function loadUPlot(): Promise<UPlotCtor | null> {
  if (!uPlotPromise) {
    uPlotPromise = import('uplot')
      .then((m) => m.default)
      .catch((err: unknown) => {
        console.warn('[TimelineChart] uPlot unavailable, timeline disabled:', err);
        return null;
      });
  }
  return uPlotPromise;
}

export interface PanelHandle {
  element: HTMLElement;
  refresh: () => void;
  dispose: () => void;
}

const IS_TOUCH = typeof window !== 'undefined' && window.matchMedia?.('(pointer: coarse)').matches;

function baseOptions(width: number, height: number, title: string): uPlot.Options {
  return {
    width,
    height,
    title,
    cursor: { show: !IS_TOUCH, drag: { x: !IS_TOUCH, y: false } },
    legend: { show: true },
    scales: { x: { time: false } },
    axes: [
      { stroke: '#8fa5b8', grid: { stroke: '#1c2530', width: 1 }, ticks: { stroke: '#2a3644' } },
      { stroke: '#8fa5b8', grid: { stroke: '#1c2530', width: 1 }, ticks: { stroke: '#2a3644' } },
    ],
    series: [{ label: 'tick' }],
  };
}

export function createTimelineChart(controller: SimulationController): PanelHandle {
  const container = el('div', { className: 'panel-body timeline-panel' }, [
    el('h2', { className: 'panel-heading' }, ['Timeline']),
  ]);
  const popHost = el('div', { className: 'chart-host' });
  const rateHost = el('div', { className: 'chart-host' });
  container.appendChild(popHost);
  container.appendChild(rateHost);

  let popChart: uPlot | null = null;
  let rateChart: uPlot | null = null;
  let UPlot: UPlotCtor | null = null;
  let disposed = false;
  let failed = false;
  void loadUPlot().then((ctor) => {
    if (disposed) return;
    if (!ctor) {
      failed = true;
      container.appendChild(el('p', { className: 'field-note' }, ['Timeline chart unavailable in this browser.']));
      return;
    }
    UPlot = ctor;
    refresh();
  });

  function width(host: HTMLElement): number {
    return Math.max(120, Math.floor(host.clientWidth || container.clientWidth || 280));
  }

  function ensureCharts(): void {
    if (!UPlot) return;
    if (!popChart) {
      const opts = baseOptions(width(popHost), 150, 'Population & avg lifespan');
      opts.series = [
        { label: 'tick' },
        { label: 'population', stroke: '#7dd3fc', width: 2 },
        { label: 'avg lifespan', stroke: '#c084fc', width: 2 },
      ];
      popChart = new UPlot(opts, [[0], [0], [0]], popHost);
    }
    if (!rateChart) {
      const opts = baseOptions(width(rateHost), 150, 'Signal rate & mutual information');
      opts.scales = { x: { time: false }, y: { range: [0, 1] } };
      opts.series = [
        { label: 'tick' },
        { label: 'signal rate', stroke: '#4fd1ff', width: 2 },
        { label: 'MI(Signal;Predator)', stroke: '#ffb347', width: 2 },
        { label: 'MI(Signal;Action)', stroke: '#4fdc82', width: 2 },
      ];
      rateChart = new UPlot(opts, [[0], [0], [0], [0]], rateHost);
    }
  }

  function refresh(): void {
    const metrics = controller.metrics;
    if (!metrics || failed) return;
    ensureCharts();
    if (!popChart || !rateChart) return;
    const timeline = metrics.getTimeline();
    if (timeline.length === 0) return;

    const ticks = timeline.map((p) => p.tick);
    const population = timeline.map((p) => p.population);
    const lifespan = timeline.map((p) => p.averageLifespan);
    const signalRate = timeline.map((p) => p.signalRate);
    const miPredator = timeline.map((p) => p.miSignalPredator);
    const miAction = timeline.map((p) => p.miSignalReceiverAction);

    popChart.setData([ticks, population, lifespan]);
    rateChart.setData([ticks, signalRate, miPredator, miAction]);
  }

  const resizeObserver = new ResizeObserver(() => {
    if (popChart) popChart.setSize({ width: width(popHost), height: 150 });
    if (rateChart) rateChart.setSize({ width: width(rateHost), height: 150 });
  });
  resizeObserver.observe(container);

  return {
    element: container,
    refresh,
    dispose: () => {
      disposed = true;
      resizeObserver.disconnect();
      popChart?.destroy();
      rateChart?.destroy();
    },
  };
}
