import { describe, expect, it } from 'vitest';
import { boundedRunnerNumber } from '../apps/broadcast-runner/src/runtime-values.js';

describe('broadcast runner runtime values', () => {
  it('prevents invalid delays from creating a busy loop', () => {
    expect(boundedRunnerNumber('invalid', 1000, 100, 60_000)).toBe(1000);
    expect(boundedRunnerNumber('0', 1000, 100, 60_000)).toBe(100);
    expect(boundedRunnerNumber('Infinity', 2000, 250, 300_000)).toBe(2000);
  });

  it('keeps service ports valid', () => {
    expect(boundedRunnerNumber('-1', 12_100, 1, 65_535)).toBe(1);
    expect(boundedRunnerNumber('99999', 12_100, 1, 65_535)).toBe(65_535);
  });
});
