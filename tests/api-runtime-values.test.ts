import { describe, expect, it } from 'vitest';
import { boundedRuntimeNumber } from '../apps/api/src/runtime-values.js';

describe('API runtime values', () => {
  it('uses safe fallbacks for missing and non-finite values', () => {
    expect(boundedRuntimeNumber(undefined, 15_000, 1000, 300_000)).toBe(15_000);
    expect(boundedRuntimeNumber('not-a-number', 15_000, 1000, 300_000)).toBe(15_000);
    expect(boundedRuntimeNumber('Infinity', 15_000, 1000, 300_000)).toBe(15_000);
  });

  it('keeps runtime intervals inside their operational bounds', () => {
    expect(boundedRuntimeNumber('0', 15_000, 1000, 300_000)).toBe(1000);
    expect(boundedRuntimeNumber('9999999', 15_000, 1000, 300_000)).toBe(300_000);
    expect(boundedRuntimeNumber('1500.4', 15_000, 1000, 300_000)).toBe(1500);
  });
});
