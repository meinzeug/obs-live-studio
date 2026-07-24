import { describe, expect, it } from 'vitest';
import { automaticEditorialStatus } from '../apps/worker/src/ai-editorial.js';

describe('automatic editorial publishing policy', () => {
  it('automatically approves a fully prepared and trusted article', () => {
    expect(automaticEditorialStatus({ trust_score: 90 }, [], 80)).toBe('approved');
  });

  it('keeps warning-bearing articles in editorial review', () => {
    expect(automaticEditorialStatus({ trust_score: 100 }, ['Faktenlage prüfen'], 80)).toBe('review');
  });

  it('keeps articles below the configured trust threshold in review', () => {
    expect(automaticEditorialStatus({ trust_score: 79 }, [], 80)).toBe('review');
  });
});
