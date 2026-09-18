/**
 * Top control strip shown while a run is active: Stop, the speed selector
 * (Pause/1x/5x/20x/100x/MAX — Pause doubles as the pause/resume control),
 * Fit view, Export JSON/CSV, and the tick + ticks/sec readout.
 */
import type { SimulationController, Speed } from './SimulationController';
import { toJson, summaryToCsv, rowsToCsv } from '../experiments/export';
import { el, downloadText } from './dom';
import { formatInt, formatTicksPerSecond } from './format';

export interface ControlBarCallbacks {
  /** Called after controller.stop() has been invoked — App swaps back to the start screen. */
  onStop: () => void;
  onFitView: () => void;
}

const SPEED_OPTIONS: { label: string; speed: Speed }[] = [
  { label: 'Pause', speed: 'PAUSED' },
  { label: '1x', speed: 1 },
  { label: '5x', speed: 5 },
  { label: '20x', speed: 20 },
  { label: '100x', speed: 100 },
  { label: 'MAX', speed: 'MAX' },
];

export interface ControlBarHandle {
  element: HTMLElement;
  dispose: () => void;
}

export function createControlBar(controller: SimulationController, callbacks: ControlBarCallbacks): ControlBarHandle {
  const readout = el('div', { className: 'control-readout' }, ['tick 0 · 0.0 t/s']);

  const speedButtons = new Map<Speed, HTMLButtonElement>();
  const speedRow = el(
    'div',
    { className: 'speed-row', role: 'group', 'aria-label': 'Simulation speed' },
    SPEED_OPTIONS.map(({ label, speed }) => {
      const btn = el('button', { type: 'button', className: 'btn btn-speed' }, [label]);
      btn.addEventListener('click', () => controller.setSpeed(speed));
      speedButtons.set(speed, btn);
      return btn;
    }),
  );

  const stopBtn = el('button', { type: 'button', className: 'btn btn-danger' }, ['Stop']);
  stopBtn.addEventListener('click', () => {
    controller.stop();
    callbacks.onStop();
  });

  const fitBtn = el('button', { type: 'button', className: 'btn btn-ghost' }, ['Fit view']);
  fitBtn.addEventListener('click', () => callbacks.onFitView());

  function exportFilenameBase(): string {
    const exported = controller.buildExport();
    return exported?.experimentId ?? `jevbug-run-${Date.now()}`;
  }

  const exportJsonBtn = el('button', { type: 'button', className: 'btn btn-ghost' }, ['Export JSON']);
  exportJsonBtn.addEventListener('click', () => {
    const exported = controller.buildExport();
    if (!exported) return;
    downloadText(`${exportFilenameBase()}.json`, toJson(exported), 'application/json');
  });

  const exportCsvBtn = el('button', { type: 'button', className: 'btn btn-ghost' }, ['Export CSV']);
  exportCsvBtn.addEventListener('click', () => {
    const exported = controller.buildExport();
    if (!exported) return;
    const csv = `# summary\n${summaryToCsv([exported])}\n# rows\n${rowsToCsv([exported])}`;
    downloadText(`${exportFilenameBase()}.csv`, csv, 'text/csv');
  });

  const element = el('div', { className: 'control-bar' }, [
    stopBtn,
    speedRow,
    fitBtn,
    el('div', { className: 'control-bar-spacer' }),
    readout,
    exportJsonBtn,
    exportCsvBtn,
  ]);

  function refresh(): void {
    const s = controller.getState();
    readout.textContent = `tick ${formatInt(s.tick)} · ${formatTicksPerSecond(s.ticksPerSecond)}`;
    for (const [speed, btn] of speedButtons) {
      const isActive = s.status === 'paused' ? speed === 'PAUSED' : speed === s.speed;
      btn.classList.toggle('active', isActive);
    }
  }

  refresh();
  const unsubscribe = controller.on('state', refresh);

  return {
    element,
    dispose: () => {
      unsubscribe();
    },
  };
}
