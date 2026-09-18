/**
 * Communication metrics panel: conditional probabilities and mutual
 * information over the sliding window (see MetricsCollector). Every number
 * here is a statistical correlation, never evidence of meaning — the badge
 * text and footnote are intentionally worded to avoid overclaiming
 * (docs/METRICS.md, spec §9/§11/§32: never call it "language").
 */
import type { SimulationController } from './SimulationController';
import type { HeardCategory } from '../simulation/metrics/MetricsCollector';
import { el, setChildren } from './dom';
import { formatInt, formatPercent, formatBits } from './format';

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

const HEARD_ORDER: HeardCategory[] = ['NONE', 'A', 'B', 'MIXED'];

export function createCommunicationPanel(controller: SimulationController): PanelHandle {
  const badge = el('div', { className: 'comm-badge hidden' }, ['Potential communication detected']);
  const body = el('div', { className: 'metrics-section' });
  const element = el('div', { className: 'panel-body comm-panel' }, [
    el('h2', { className: 'panel-heading' }, ['Communication metrics']),
    badge,
    body,
    el(
      'p',
      { className: 'footnote', title: 'statistical correlation only; not proof of meaning' },
      ['statistical correlation only; not proof of meaning'],
    ),
  ]);

  function refresh(): void {
    const metrics = controller.metrics;
    if (!metrics) {
      badge.classList.add('hidden');
      setChildren(body, [el('p', { className: 'muted' }, ['No run yet.'])]);
      return;
    }
    const c = metrics.getCommunication();
    badge.classList.toggle('hidden', !c.potentialCommunication);

    const rows: HTMLElement[] = [
      statRow('Sample size', `${formatInt(c.sampleSize)} (window ${formatInt(c.windowTicks)} ticks)`),
      el('div', { className: 'stat-divider' }),
      el('h3', { className: 'panel-subheading' }, ['P(signal | predator visible)']),
      statRow('P(A | predator)', formatPercent(c.pSignalGivenPredatorVisible.A, 1)),
      statRow('P(A | no predator)', formatPercent(c.pSignalGivenNoPredator.A, 1)),
      statRow('P(B | predator)', formatPercent(c.pSignalGivenPredatorVisible.B, 1)),
      statRow('P(B | no predator)', formatPercent(c.pSignalGivenNoPredator.B, 1)),
      el('h3', { className: 'panel-subheading' }, ['P(signal | food visible)']),
      statRow('P(A | food)', formatPercent(c.pSignalGivenFoodVisible.A, 1)),
      statRow('P(A | no food)', formatPercent(c.pSignalGivenNoFood.A, 1)),
      statRow('P(B | food)', formatPercent(c.pSignalGivenFoodVisible.B, 1)),
      statRow('P(B | no food)', formatPercent(c.pSignalGivenNoFood.B, 1)),
      el('h3', { className: 'panel-subheading' }, ['P(flee | heard)']),
      ...HEARD_ORDER.map((h) => statRow(`P(flee | ${h})`, formatPercent(c.pFleeGivenHeard[h], 1))),
      el('h3', { className: 'panel-subheading' }, ['P(flee | heard, no predator visible)']),
      ...HEARD_ORDER.map((h) => statRow(`P(flee | ${h}, no predator)`, formatPercent(c.pFleeGivenHeardNoPredator[h], 1))),
      el('div', { className: 'stat-divider' }),
      el('h3', { className: 'panel-subheading' }, ['Mutual information']),
      statRow('MI(Signal;Predator)', formatBits(c.miSignalPredator)),
      statRow('MI(Signal;Food)', formatBits(c.miSignalFood)),
      statRow('MI(Signal;ReceiverAction)', formatBits(c.miSignalReceiverAction)),
      statRow('MI(Signal;ReceiverFlee)', formatBits(c.miSignalReceiverFlee)),
    ];
    setChildren(body, rows);
  }

  refresh();
  return { element, refresh };
}
