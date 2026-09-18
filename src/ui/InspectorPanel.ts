/**
 * Bug inspector: everything known about the currently selected bug. Refreshed
 * by App at 8 Hz (spec). Because a dead bug is removed from `world.bugs` the
 * same tick it dies, this panel caches the last live `Bug` object reference
 * for the current selection so it can still render "(dead)" with its final
 * state and still pretty-print `buildDecisionRequest` afterwards (the object
 * itself is frozen in place once removed from the world, so reading its
 * fields remains safe).
 *
 * Signal names are always shown via `signalDefinitions[i].displayName` — the
 * raw provider-facing token id only ever appears inside the "what the
 * provider sees" JSON dump (spec §35/§36 — never surface it as the primary label).
 */
import type { SimulationController } from './SimulationController';
import type { Bug, BugAction, Signal, SignalDefinition } from '../simulation/types';
import { SIGNALS } from '../simulation/types';
import { el, meter, setChildren } from './dom';
import { formatFixed, formatInt, formatOrDash, formatPercent, formatSigned, titleCase } from './format';

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

function barRow(label: string, fraction: number, valueText: string): HTMLElement {
  return el('div', { className: 'trait-row' }, [
    el('span', { className: 'stat-label' }, [label]),
    meter(fraction),
    el('span', { className: 'stat-value stat-value-narrow' }, [valueText]),
  ]);
}

function displayNameFor(defs: readonly SignalDefinition[], signal: Exclude<Signal, 'NONE'>): string {
  return defs.find((d) => d.signal === signal)?.displayName ?? signal;
}

export function createInspectorPanel(controller: SimulationController): PanelHandle {
  const element = el('div', { className: 'panel-body inspector-panel' });

  let cachedSelectedId: string | null = null;
  let cachedBug: Bug | null = null;
  let cachedAlive = false;
  let showRequestJson = false;

  function renderEmpty(): void {
    setChildren(element, [
      el('h2', { className: 'panel-heading' }, ['Inspector']),
      el('p', { className: 'muted' }, ['Tap a bug on the canvas to inspect it.']),
    ]);
  }

  function renderBug(bug: Bug, alive: boolean): void {
    const sim = controller.simulation!;
    const defs = sim.signalDefinitions;
    const perception = bug.lastPerception;

    const deselectBtn = el('button', { type: 'button', className: 'btn btn-ghost btn-small' }, ['Deselect']);
    deselectBtn.addEventListener('click', () => controller.selectBug(null));

    const header = el('div', { className: 'inspector-header' }, [
      el('span', { className: 'inspector-id' }, [`Bug ${bug.id}`, alive ? '' : ' (dead)']),
      deselectBtn,
    ]);

    const vitals = el('div', { className: 'metrics-section' }, [
      statRow('Generation', formatInt(bug.generation)),
      statRow('Age', formatInt(bug.age)),
      barRow('Energy', bug.energy, formatFixed(bug.energy, 3)),
      barRow('Fear', bug.fear, formatFixed(bug.fear, 3)),
      statRow('Carrying food', bug.carryingFood ? 'yes' : 'no'),
    ]);

    const traits = el('div', { className: 'metrics-section' }, [
      el('h3', { className: 'panel-subheading' }, ['Traits']),
      barRow('Curiosity', bug.traits.curiosity, formatFixed(bug.traits.curiosity, 2)),
      barRow('Aggression', bug.traits.aggression, formatFixed(bug.traits.aggression, 2)),
      barRow('Sociality', bug.traits.sociality, formatFixed(bug.traits.sociality, 2)),
      barRow('Signal tendency', bug.traits.signalTendency, formatFixed(bug.traits.signalTendency, 2)),
      barRow('Speed', bug.traits.speed, formatFixed(bug.traits.speed, 2)),
      statRow('Memory length', formatInt(bug.traits.memoryLength)),
    ]);

    const heardText =
      perception && perception.heardSignals.length > 0
        ? perception.heardSignals.map((h) => displayNameFor(defs, h.signal)).join(', ')
        : '—';

    const perceptionSection = el('div', { className: 'metrics-section' }, [
      el('h3', { className: 'panel-subheading' }, ['Perception']),
      statRow('Food direction', formatOrDash(perception?.foodDirection ?? null)),
      statRow('Predator direction', formatOrDash(perception?.predatorDirection ?? null)),
      statRow('Nearby bugs', formatInt(perception?.nearbyBugCount ?? 0)),
      statRow('Heard signals', heardText),
      statRow('Previous action', perception?.previousAction ? titleCase(perception.previousAction) : '—'),
      statRow('Previous outcome', perception?.previousOutcome ? titleCase(perception.previousOutcome) : '—'),
    ]);

    const actionEntries = bug.lastActionDecision
      ? (Object.entries(bug.lastActionDecision.probabilities) as [BugAction, number][]).sort((a, b) => b[1] - a[1])
      : [];
    const signalDecision = bug.lastSignalDecision?.probabilities;

    const decisionSection = el('div', { className: 'metrics-section' }, [
      el('h3', { className: 'panel-subheading' }, ['Current decision — action']),
      ...(actionEntries.length > 0
        ? actionEntries.map(([action, p]) => barRow(titleCase(action), p, formatPercent(p, 1)))
        : [el('p', { className: 'muted' }, ['No decision yet.'])]),
      el('h3', { className: 'panel-subheading' }, ['Current decision — signal']),
      ...(signalDecision
        ? (SIGNALS as readonly Signal[]).map((s) => {
            const label = s === 'NONE' ? 'NONE' : displayNameFor(defs, s);
            return barRow(label, signalDecision[s], formatPercent(signalDecision[s], 1));
          })
        : [el('p', { className: 'muted' }, ['No decision yet.'])]),
    ]);

    const experience = sim.getSignalExperience(bug);
    const expTable = el('table', { className: 'exp-table' }, [
      el('thead', {}, [
        el('tr', {}, [
          el('th', {}, ['Signal']),
          el('th', {}, ['Received']),
          el('th', {}, ['Predator', el('br'), 'after']),
          el('th', {}, ['Food', el('br'), 'after']),
          el('th', {}, ['Escape', el('br'), 'after']),
          el('th', {}, ['Attack', el('br'), 'after']),
          el('th', {}, ['Avg ΔE']),
        ]),
      ]),
      el(
        'tbody',
        {},
        experience.map((exp) =>
          el('tr', {}, [
            el('td', {}, [displayNameFor(defs, exp.signal)]),
            el('td', {}, [formatInt(exp.receivedCount)]),
            el('td', {}, [formatInt(exp.followedByPredator)]),
            el('td', {}, [formatInt(exp.followedByFood)]),
            el('td', {}, [formatInt(exp.followedByEscape)]),
            el('td', {}, [formatInt(exp.followedByAttack)]),
            el('td', {}, [formatSigned(exp.averageEnergyDelta, 3)]),
          ]),
        ),
      ),
    ]);
    const experienceSection = el('div', { className: 'metrics-section' }, [
      el('h3', { className: 'panel-subheading' }, ['Signal experience']),
      el('div', { className: 'exp-table-wrap' }, [expTable]),
    ]);

    const recent = bug.memory.slice(-10).reverse();
    const memoryList = el(
      'ul',
      { className: 'memory-list' },
      recent.length > 0
        ? recent.map((m) => {
            const heard = m.signalsReceived.length > 0 ? m.signalsReceived.map((s) => displayNameFor(defs, s)).join(',') : '—';
            const emitted = m.signalEmitted === 'NONE' ? 'NONE' : displayNameFor(defs, m.signalEmitted);
            return el('li', { className: 'memory-item' }, [
              `t${m.tick} · heard ${heard} · emitted ${emitted} · ${titleCase(m.action)} → ${titleCase(m.outcome)} · ${formatSigned(m.energyDelta, 3)}`,
            ]);
          })
        : [el('li', { className: 'muted' }, ['No memory yet.'])],
    );
    const memorySection = el('div', { className: 'metrics-section' }, [
      el('h3', { className: 'panel-subheading' }, ['Recent memory']),
      memoryList,
    ]);

    const jsonToggle = el('button', { type: 'button', className: 'btn btn-ghost btn-small' }, [
      showRequestJson ? 'Hide what the provider sees' : 'Show what the provider sees',
    ]);
    const jsonPre = el('pre', { className: `provider-json ${showRequestJson ? '' : 'hidden'}` }, [
      showRequestJson ? JSON.stringify(sim.buildDecisionRequest(bug), null, 2) : '',
    ]);
    jsonToggle.addEventListener('click', () => {
      showRequestJson = !showRequestJson;
      refresh();
    });
    const jsonSection = el('div', { className: 'metrics-section' }, [jsonToggle, jsonPre]);

    setChildren(element, [
      el('h2', { className: 'panel-heading' }, ['Inspector']),
      header,
      vitals,
      traits,
      perceptionSection,
      decisionSection,
      experienceSection,
      memorySection,
      jsonSection,
    ]);
  }

  function refresh(): void {
    const state = controller.getState();
    const id = state.selectedBugId;
    const sim = controller.simulation;

    if (id !== cachedSelectedId) {
      cachedSelectedId = id;
      cachedBug = null;
      cachedAlive = false;
    }

    if (id && sim) {
      const found = sim.getBug(id);
      if (found) {
        cachedBug = found;
        cachedAlive = true;
      } else if (cachedBug) {
        cachedAlive = false;
      }
    }

    if (!id || !cachedBug || !sim) {
      renderEmpty();
      return;
    }
    renderBug(cachedBug, cachedAlive);
  }

  renderEmpty();
  return { element, refresh };
}
