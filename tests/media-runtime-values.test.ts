import { describe, expect, it } from 'vitest';
import { boundedMediaNumber } from '../packages/media-engine/src/runtime-values.js';

describe('media runtime values', () => {
  it('does not let invalid configuration disable resource limits', () => {
    expect(boundedMediaNumber('invalid', 250, 1, 2000)).toBe(250);
    expect(boundedMediaNumber(Number.NaN, 15, 1, 100)).toBe(15);
    expect(boundedMediaNumber(Infinity, 180, 1, 3600)).toBe(180);
  });

  it('bounds and normalizes configured limits', () => {
    expect(boundedMediaNumber('-10', 30, 1, 100)).toBe(1);
    expect(boundedMediaNumber('1000', 30, 1, 100)).toBe(100);
    expect(boundedMediaNumber('12.6', 30, 1, 100)).toBe(13);
    expect(boundedMediaNumber('12.6', 30, 1, 100, { integer: false })).toBe(12.6);
  });
});
