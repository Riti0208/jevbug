/**
 * Start screen: every important initial SimulationConfig field is editable here.
 * Basic fields are explicit; the "Advanced" section is generated from
 * `DEFAULT_CONFIG`'s remaining keys so nothing is missed as the config grows.
 * Last-used values persist to localStorage (best-effort; never throws).
 */
import { createConfig, DEFAULT_CONFIG, type SimulationConfig } from '../simulation/config';
import { EXPERIMENT_MODES } from '../simulation/types';
import { el, setChildren } from './dom';
import { labelizeKey } from './format';

const STORAGE_KEY = 'jevbug:lastConfig:v1';

/** Fields shown directly on the start screen (spec's explicit list). Order = display order. */
const BASIC_NUMERIC_FIELDS: { key: keyof SimulationConfig; label: string }[] = [
  { key: 'seed', label: 'Seed' },
  { key: 'initialBugs', label: 'Initial bugs' },
  { key: 'initialPredators', label: 'Initial predators' },
  { key: 'initialFood', label: 'Initial food' },
  { key: 'foodSpawnRate', label: 'Food spawn rate' },
  { key: 'maxFood', label: 'Max food' },
  { key: 'worldSize', label: 'World size' },
  { key: 'bugViewDistance', label: 'Bug view distance' },
  { key: 'bugSignalDistance', label: 'Signal distance' },
  { key: 'predatorViewDistance', label: 'Predator view distance' },
  { key: 'energySignal', label: 'Signal energy cost' },
  { key: 'reproductionEnergyThreshold', label: 'Reproduction threshold' },
  { key: 'mutationRate', label: 'Mutation rate' },
  { key: 'maxPopulation', label: 'Max population' },
];

const BASIC_KEYS = new Set<string>([
  'mode',
  'memoryMode',
  'decisionProvider',
  'signalTokenMode',
  ...BASIC_NUMERIC_FIELDS.map((f) => f.key as string),
]);

function loadSavedOverrides(): Partial<SimulationConfig> {
  try {
    const raw = window.localStorage.getItem(STORAGE_KEY);
    if (!raw) return {};
    const parsed: unknown = JSON.parse(raw);
    if (parsed && typeof parsed === 'object') return parsed as Partial<SimulationConfig>;
  } catch {
    // localStorage unavailable (private mode, disabled) — fall back to defaults.
  }
  return {};
}

function saveOverrides(config: SimulationConfig): void {
  try {
    window.localStorage.setItem(STORAGE_KEY, JSON.stringify(config));
  } catch {
    // best-effort only
  }
}

interface HealthInfo {
  ok: boolean;
  backend?: string;
  model?: string;
  hasKey?: boolean;
}

export interface StartFormOptions {
  onStart: (config: SimulationConfig) => void;
}

export function createStartForm(options: StartFormOptions): HTMLElement {
  const state: SimulationConfig = createConfig(loadSavedOverrides());
  let health: HealthInfo | null = null;
  let healthError = false;

  const root = el('div', { className: 'start-screen' });
  const card = el('div', { className: 'start-card' });
  root.appendChild(card);

  const providerNote = el('p', { className: 'field-note' }, ['Checking Jev availability…']);

  function numberInput(key: keyof SimulationConfig, label: string): HTMLElement {
    const value = state[key] as number;
    const input = el('input', {
      type: 'number',
      step: 'any',
      value: String(value),
      className: 'field-input',
      'aria-label': label,
    }) as HTMLInputElement;
    input.addEventListener('input', () => {
      const parsed = Number(input.value);
      if (!Number.isFinite(parsed)) return;
      const isIntDefault = Number.isInteger(DEFAULT_CONFIG[key] as number);
      (state as unknown as Record<string, number>)[key as string] = isIntDefault ? Math.round(parsed) : parsed;
    });
    return el('label', { className: 'field' }, [el('span', { className: 'field-label' }, [label]), input]);
  }

  function checkboxInput(key: keyof SimulationConfig, label: string): HTMLElement {
    const input = el('input', {
      type: 'checkbox',
      className: 'field-checkbox',
      checked: Boolean(state[key]),
    }) as HTMLInputElement;
    input.addEventListener('change', () => {
      (state as unknown as Record<string, boolean>)[key as string] = input.checked;
    });
    return el('label', { className: 'field field-checkbox-row' }, [input, el('span', { className: 'field-label' }, [label])]);
  }

  function selectInput<T extends string>(
    key: keyof SimulationConfig,
    label: string,
    optionValues: readonly T[],
    onChange?: (value: T) => void,
  ): HTMLElement {
    const select = el('select', { className: 'field-input', 'aria-label': label }) as HTMLSelectElement;
    for (const opt of optionValues) {
      select.appendChild(el('option', { value: opt, selected: state[key] === opt }, [opt]));
    }
    select.addEventListener('change', () => {
      (state as unknown as Record<string, string>)[key as string] = select.value;
      onChange?.(select.value as T);
    });
    return el('label', { className: 'field' }, [el('span', { className: 'field-label' }, [label]), select]);
  }

  function updateProviderNote(): void {
    if (healthError) {
      providerNote.textContent = 'Jev: unknown (health check failed — mock/random still work offline).';
      providerNote.className = 'field-note warn';
      return;
    }
    if (!health) {
      providerNote.textContent = 'Checking Jev availability…';
      providerNote.className = 'field-note';
      return;
    }
    const configured = health.hasKey === true;
    if (state.decisionProvider !== 'jev') {
      providerNote.textContent = configured
        ? `Jev: configured (${health.backend ?? 'gateway'} / ${health.model ?? 'default model'}).`
        : 'Jev: not configured.';
      providerNote.className = 'field-note';
      return;
    }
    if (configured) {
      providerNote.textContent = `Jev: configured (${health.backend ?? 'gateway'} / ${health.model ?? 'default model'}).`;
      providerNote.className = 'field-note ok';
    } else {
      providerNote.textContent =
        'Jev: not configured (no API key set). The run will still start — every decision falls back to uniform random.';
      providerNote.className = 'field-note warn';
    }
  }

  function render(): void {
    const basicFields = BASIC_NUMERIC_FIELDS.map((f) => numberInput(f.key, f.label));

    const advancedKeys = (Object.keys(DEFAULT_CONFIG) as (keyof SimulationConfig)[]).filter(
      (k) => !BASIC_KEYS.has(k as string),
    );
    const advancedFields = advancedKeys.map((k) => {
      const def = DEFAULT_CONFIG[k];
      const label = labelizeKey(k as string);
      if (typeof def === 'boolean') return checkboxInput(k, label);
      if (typeof def === 'number') return numberInput(k, label);
      return null;
    }).filter((x): x is HTMLElement => x !== null);

    const modeField = selectInput('mode', 'Experiment mode', EXPERIMENT_MODES);
    const memoryField = selectInput('memoryMode', 'Memory mode', ['WITH_MEMORY', 'NO_MEMORY'] as const);
    const providerField = selectInput('decisionProvider', 'Decision provider', ['jev', 'mock', 'random'] as const, () =>
      updateProviderNote(),
    );
    const tokenModeField = selectInput('signalTokenMode', 'Signal token mode', ['AB', 'RANDOM'] as const);

    const resetBtn = el('button', { type: 'button', className: 'btn btn-ghost' }, ['Reset to defaults']);
    resetBtn.addEventListener('click', () => {
      Object.assign(state, DEFAULT_CONFIG);
      try {
        window.localStorage.removeItem(STORAGE_KEY);
      } catch {
        /* ignore */
      }
      render();
    });

    const startBtn = el('button', { type: 'submit', className: 'btn btn-primary btn-large' }, ['Start']);

    const advancedDetails = el('details', { className: 'advanced-section' }, [
      el('summary', {}, ['Advanced']),
      el('div', { className: 'field-grid' }, advancedFields),
    ]);

    const form = el(
      'form',
      { className: 'start-form', noValidate: true },
      [
        el('h1', { className: 'start-title' }, ['JevBug — Experiment 0']),
        el('p', { className: 'start-subtitle' }, [
          'An observable environment for meaning-free signals. Set your run below.',
        ]),
        el('div', { className: 'field-grid' }, [modeField, memoryField, providerField, tokenModeField]),
        providerNote,
        el('div', { className: 'field-grid' }, basicFields),
        advancedDetails,
        el('div', { className: 'start-actions' }, [resetBtn, startBtn]),
      ],
    );

    form.addEventListener('submit', (e) => {
      e.preventDefault();
      const finalConfig: SimulationConfig = { ...state };
      saveOverrides(finalConfig);
      options.onStart(finalConfig);
    });

    setChildren(card, [form]);
    updateProviderNote();
  }

  render();

  fetch('/api/health')
    .then((r) => r.json())
    .then((data: HealthInfo) => {
      health = data;
      updateProviderNote();
    })
    .catch(() => {
      healthError = true;
      updateProviderNote();
    });

  return root;
}
