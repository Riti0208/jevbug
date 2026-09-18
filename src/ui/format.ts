/**
 * Pure number/percent/text formatting helpers for the UI layer. No DOM, no
 * three.js — safe to unit test in Node.
 */

/** Integer with thousands separators, e.g. 12345 -> "12,345". */
export function formatInt(n: number): string {
  if (!Number.isFinite(n)) return '—';
  return Math.round(n).toLocaleString('en-US');
}

/** Fixed-point number, trimmed of trailing zeros is NOT done on purpose (stable column widths). */
export function formatFixed(n: number, decimals = 2): string {
  if (!Number.isFinite(n)) return '—';
  return n.toFixed(decimals);
}

/** 0..1 fraction -> "42%" (decimals controls fractional percent digits). */
export function formatPercent(fraction: number, decimals = 0): string {
  if (!Number.isFinite(fraction)) return '—';
  return `${(fraction * 100).toFixed(decimals)}%`;
}

/** Signed fixed-point, e.g. +0.012 / -0.045 / 0.000 — used for energy deltas. */
export function formatSigned(n: number, decimals = 3): string {
  if (!Number.isFinite(n)) return '—';
  const sign = n > 0 ? '+' : n < 0 ? '' : '±';
  return `${sign}${n.toFixed(decimals)}`;
}

/** Mutual information in bits, 3 decimals, e.g. "0.123 bits". */
export function formatBits(n: number): string {
  if (!Number.isFinite(n)) return '—';
  return `${n.toFixed(3)} bits`;
}

/** Ticks/sec readout, e.g. "4.8 t/s". */
export function formatTicksPerSecond(n: number): string {
  if (!Number.isFinite(n) || n <= 0) return '0.0 t/s';
  return `${n.toFixed(1)} t/s`;
}

/** ms -> "1.2s" / "850ms" / "3m 12s". */
export function formatDuration(ms: number): string {
  if (!Number.isFinite(ms) || ms < 0) return '—';
  if (ms < 1000) return `${Math.round(ms)}ms`;
  const totalSeconds = ms / 1000;
  if (totalSeconds < 60) return `${totalSeconds.toFixed(1)}s`;
  const minutes = Math.floor(totalSeconds / 60);
  const seconds = Math.round(totalSeconds - minutes * 60);
  return `${minutes}m ${seconds}s`;
}

/** Clamp to [0, 1] — used before rendering a meter/bar width. */
export function clamp01(n: number): number {
  if (!Number.isFinite(n)) return 0;
  return Math.min(1, Math.max(0, n));
}

/** null-safe label, e.g. for RelativeDirection | null. */
export function formatOrDash(value: string | null | undefined): string {
  return value == null || value === '' ? '—' : value;
}

/** Title-cases an UPPER_SNAKE_CASE enum value, e.g. "MOVE_FORWARD" -> "Move Forward". */
export function titleCase(value: string): string {
  return value
    .toLowerCase()
    .split('_')
    .map((w) => (w.length > 0 ? w[0].toUpperCase() + w.slice(1) : w))
    .join(' ');
}

/** Formats a config field key (camelCase) into a human label, e.g. "bugViewDistance" -> "Bug View Distance". */
export function labelizeKey(key: string): string {
  const spaced = key.replace(/([a-z0-9])([A-Z])/g, '$1 $2');
  return spaced.charAt(0).toUpperCase() + spaced.slice(1);
}
