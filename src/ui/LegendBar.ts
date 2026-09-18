/**
 * Small legend chip row: color swatches for Bug / Predator / Food / Signal A / Signal B,
 * taken directly from the renderer's palette so the legend can never drift out of sync
 * with what's actually drawn. No meanings are attached to A/B (spec §9/§11/§32) — just a
 * visual key so the two colors can be told apart.
 */
import { COLORS, SIGNAL_COLORS } from '../renderer/palette';
import { el } from './dom';

function hexToCss(hex: number): string {
  return `#${hex.toString(16).padStart(6, '0')}`;
}

function hslToCss(hue01: number, sat01: number, light01: number): string {
  return `hsl(${Math.round(hue01 * 360)}, ${Math.round(sat01 * 100)}%, ${Math.round(light01 * 100)}%)`;
}

function chip(label: string, color: string): HTMLDivElement {
  return el('div', { className: 'legend-chip' }, [
    el('span', { className: 'legend-swatch', style: { background: color } }),
    el('span', { className: 'legend-label' }, [label]),
  ]);
}

export function createLegendBar(): HTMLDivElement {
  const bugColor = hslToCss(COLORS.bugHueBase, COLORS.bugSaturation, 0.6);
  return el('div', { className: 'legend-bar' }, [
    chip('Bug', bugColor),
    chip('Predator', hexToCss(COLORS.predatorGlow)),
    chip('Food', hexToCss(COLORS.food)),
    chip('Signal A', hexToCss(SIGNAL_COLORS.A)),
    chip('Signal B', hexToCss(SIGNAL_COLORS.B)),
  ]);
}
