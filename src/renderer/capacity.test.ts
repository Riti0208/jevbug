import { describe, expect, it } from 'vitest';
import { growCapacity } from './capacity';

describe('growCapacity', () => {
  it('keeps the current capacity when it already fits', () => {
    expect(growCapacity(16, 10)).toBe(16);
    expect(growCapacity(16, 16)).toBe(16);
  });

  it('starts from minCapacity when growing from zero', () => {
    expect(growCapacity(0, 1)).toBe(16);
    expect(growCapacity(0, 16)).toBe(16);
  });

  it('doubles to the next power of two that fits the needed count', () => {
    expect(growCapacity(16, 17)).toBe(32);
    expect(growCapacity(16, 32)).toBe(32);
    expect(growCapacity(16, 33)).toBe(64);
    expect(growCapacity(512, 1000)).toBe(1024);
  });

  it('respects a custom minCapacity', () => {
    expect(growCapacity(0, 5, 8)).toBe(8);
    expect(growCapacity(0, 9, 8)).toBe(16);
  });

  it('never shrinks', () => {
    expect(growCapacity(1024, 1)).toBe(1024);
  });

  it('handles large jumps in one call', () => {
    expect(growCapacity(16, 10000)).toBe(16384);
  });
});
