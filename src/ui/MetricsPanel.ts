/**
 * Global metrics panel + provider status line. `refresh()` is called by App
 * at a fixed rate (spec: 4 Hz) — this component never self-subscribes to
 * per-tick events, so it stays cheap even at MAX speed.
 */
import type { SimulationController } from './SimulationController';
import type { JevDecisionProvider, JevProviderStats } from '../simulation/decision/JevDecisionProvider';
import { el, meter, setChildren } from './dom';
import { formatInt, formatFixed, formatPercent, formatTicksPerSecond, formatDuration } from './format';

export interface PanelHandle {
  element: HTMLElement;
  refresh: () => void;
}

function statRow(label: string, value: string): HTMLElement {
  return el('div', { className: 'stat-row' }, [
    el('span', { className: 'stat-label' }, [label]),
    el('span', { className: 'stat-value' }, [value]),
  ]);
}

function traitRow(label: string, value: number): HTMLElement {
  return el('div', { className: 'trait-row' }, [
    el('span', { className: 'stat-label' }, [label]),
    meter(value),
    el('span', { className: 'stat-value stat-value-narrow' }, [formatFixed(value, 2)]),
  ]);
}

function hasGetStats(provider: unknown): provider is JevDecisionProvider {
  return !!provider && typeof (provider as { getStats?: unknown }).getStats === 'function';
}

export function createMetricsPanel(controller: SimulationController): PanelHandle {
  const globalSection = el('div', { className: 'metrics-section' });
  const providerSection = el('div', { className: 'metrics-section' });
  const element = el('div', { className: 'panel-body metrics-panel' }, [
    el('h2', { className: 'panel-heading' }, ['Global metrics']),
    globalSection,
    el('h2', { className: 'panel-heading' }, ['Provider']),
    providerSection,
  ]);

  function renderGlobal(): void {
    const metrics = controller.metrics;
    const state = controller.getState();
    if (!metrics) {
      setChildren(globalSection, [el('p', { className: 'muted' }, ['No run yet.'])]);
      return;
    }
    const g = metrics.getGlobal();
    const traits = g.averageTraits;

    setChildren(globalSection, [
      statRow('Tick', formatInt(state.tick)),
      statRow('Ticks/sec', formatTicksPerSecond(state.ticksPerSecond)),
      statRow('Population', formatInt(g.population)),
      statRow('Avg age', formatFixed(g.averageAge, 1)),
      statRow('Avg energy', formatFixed(g.averageEnergy, 3)),
      statRow('Max generation', formatInt(g.maxGeneration)),
      statRow('Avg generation', formatFixed(g.averageGeneration, 2)),
      el('div', { className: 'stat-divider' }),
      statRow('Signal A (window)', formatInt(g.signalCountsWindow.A)),
      statRow('Signal B (window)', formatInt(g.signalCountsWindow.B)),
      statRow('Signal A (cumulative)', formatInt(g.signalCounts.A)),
      statRow('Signal B (cumulative)', formatInt(g.signalCounts.B)),
      statRow('Signal rate', formatPercent(g.signalRate, 1)),
      el('div', { className: 'stat-divider' }),
      statRow('Deaths (total)', formatInt(g.deaths.total)),
      statRow('— predator', formatInt(g.deaths.predator)),
      statRow('— starvation', formatInt(g.deaths.starvation)),
      statRow('— old age', formatInt(g.deaths.oldAge)),
      statRow('Births', formatInt(g.births)),
      statRow('Avg lifespan', formatFixed(g.averageLifespan, 1)),
      el('div', { className: 'stat-divider' }),
      el('h3', { className: 'panel-subheading' }, ['Average traits']),
      traitRow('Curiosity', traits.curiosity),
      traitRow('Aggression', traits.aggression),
      traitRow('Sociality', traits.sociality),
      traitRow('Signal tendency', traits.signalTendency),
      traitRow('Speed', traits.speed),
      statRow('Memory length', formatFixed(traits.memoryLength, 1)),
    ]);
  }

  function renderProvider(): void {
    const provider = controller.provider;
    if (!provider) {
      setChildren(providerSection, [el('p', { className: 'muted' }, ['No run yet.'])]);
      return;
    }
    const rows: HTMLElement[] = [statRow('Provider', provider.name)];
    if (hasGetStats(provider)) {
      const stats: JevProviderStats = provider.getStats();
      rows.push(
        statRow('Requests', formatInt(stats.requests)),
        statRow('Cache hits', formatInt(stats.cacheHits)),
        statRow('Fallbacks', formatInt(stats.fallbacks)),
        statRow('Errors', formatInt(stats.errors)),
        statRow('Avg latency', formatDuration(stats.avgLatencyMs)),
        statRow('Circuit', stats.circuitOpen ? 'open' : 'closed'),
        statRow('Last error', stats.lastError ?? '—'),
      );
    }
    const controllerError = controller.getState().lastError;
    if (controllerError) rows.push(statRow('Controller error', controllerError));
    setChildren(providerSection, rows);
  }

  function refresh(): void {
    renderGlobal();
    renderProvider();
  }

  refresh();
  return { element, refresh };
}
