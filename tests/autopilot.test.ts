import { describe, expect, it } from 'vitest';
import { isAutopilotCandidate } from '../apps/worker/src/autopilot.js';

const base = {
  source_id: '00000000-0000-4000-8000-000000000001',
  status: 'new' as const,
  trust_score: 90,
  warnings: [] as string[],
};

describe('broadcast autopilot policy', () => {
  it('accepts an unflagged article above the trust threshold', () => {
    expect(isAutopilotCandidate(base, 80, new Set())).toBe(true);
  });

  it('blocks critical, low-trust, and already final articles', () => {
    expect(isAutopilotCandidate({ ...base, warnings: ['wahl'] }, 80, new Set())).toBe(false);
    expect(isAutopilotCandidate({ ...base, trust_score: 79 }, 80, new Set())).toBe(false);
    expect(isAutopilotCandidate({ ...base, status: 'published' }, 80, new Set())).toBe(false);
  });

  it('honors an explicit source allowlist', () => {
    expect(isAutopilotCandidate(base, 80, new Set([base.source_id]))).toBe(true);
    expect(isAutopilotCandidate(base, 80, new Set(['00000000-0000-4000-8000-000000000002']))).toBe(false);
  });
});
