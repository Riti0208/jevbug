import { describe, it, expect } from 'vitest';
import {
  formatInt,
  formatFixed,
  formatPercent,
  formatSigned,
  formatBits,
  formatTicksPerSecond,
  formatDuration,
  clamp01,
  formatOrDash,
  titleCase,
  labelizeKey,
} from './format';

describe('formatInt', () => {
  it('adds thousands separators and rounds', () => {
    expect(formatInt(12345)).toBe('12,345');
    expect(formatInt(12345.6)).toBe('12,346');
  });
  it('handles non-finite input', () => {
    expect(formatInt(NaN)).toBe('—');
    expect(formatInt(Infinity)).toBe('—');
  });
});

describe('formatFixed', () => {
  it('formats with the requested decimals', () => {
    expect(formatFixed(1.23456, 2)).toBe('1.23');
    expect(formatFixed(1, 3)).toBe('1.000');
  });
});

describe('formatPercent', () => {
  it('converts a 0..1 fraction to a percent string', () => {
    expect(formatPercent(0.4231, 1)).toBe('42.3%');
    expect(formatPercent(1)).toBe('100%');
    expect(formatPercent(0)).toBe('0%');
  });
});

describe('formatSigned', () => {
  it('prefixes a plus sign for positive numbers', () => {
    expect(formatSigned(0.012, 3)).toBe('+0.012');
  });
  it('keeps the minus sign for negative numbers', () => {
    expect(formatSigned(-0.045, 3)).toBe('-0.045');
  });
  it('uses a neutral marker for exactly zero', () => {
    expect(formatSigned(0, 3)).toBe('±0.000');
  });
});

describe('formatBits', () => {
  it('always shows 3 decimals with a bits suffix', () => {
    expect(formatBits(0.1)).toBe('0.100 bits');
    expect(formatBits(0)).toBe('0.000 bits');
  });
});

describe('formatTicksPerSecond', () => {
  it('formats a positive rate with one decimal', () => {
    expect(formatTicksPerSecond(4.83)).toBe('4.8 t/s');
  });
  it('floors non-positive/invalid rates to 0.0 t/s', () => {
    expect(formatTicksPerSecond(0)).toBe('0.0 t/s');
    expect(formatTicksPerSecond(-1)).toBe('0.0 t/s');
    expect(formatTicksPerSecond(NaN)).toBe('0.0 t/s');
  });
});

describe('formatDuration', () => {
  it('shows milliseconds below one second', () => {
    expect(formatDuration(850)).toBe('850ms');
  });
  it('shows seconds with one decimal below a minute', () => {
    expect(formatDuration(1500)).toBe('1.5s');
  });
  it('shows minutes and seconds at or above a minute', () => {
    expect(formatDuration(192_000)).toBe('3m 12s');
  });
});

describe('clamp01', () => {
  it('clamps into [0,1] and treats non-finite as 0', () => {
    expect(clamp01(-1)).toBe(0);
    expect(clamp01(2)).toBe(1);
    expect(clamp01(0.5)).toBe(0.5);
    expect(clamp01(NaN)).toBe(0);
  });
});

describe('formatOrDash', () => {
  it('renders a dash for null/undefined/empty', () => {
    expect(formatOrDash(null)).toBe('—');
    expect(formatOrDash(undefined)).toBe('—');
    expect(formatOrDash('')).toBe('—');
  });
  it('passes through non-empty strings', () => {
    expect(formatOrDash('front')).toBe('front');
  });
});

describe('titleCase', () => {
  it('converts UPPER_SNAKE_CASE to Title Case', () => {
    expect(titleCase('MOVE_FORWARD')).toBe('Move Forward');
    expect(titleCase('FLEE')).toBe('Flee');
  });
});

describe('labelizeKey', () => {
  it('splits camelCase config keys into readable labels', () => {
    expect(labelizeKey('bugViewDistance')).toBe('Bug View Distance');
    expect(labelizeKey('seed')).toBe('Seed');
  });
});
