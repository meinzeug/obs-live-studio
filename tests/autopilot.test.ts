import { describe, expect, it } from 'vitest';
import { isAutopilotCandidate } from '../apps/worker/src/autopilot.js';

const sourceId = '00000000-0000-4000-8000-000000000001';
const base = {
  source_id: sourceId,
  status: 'new' as const,
  trust_score: 90,
  warnings: [] as string[],
};

describe('broadcast autopilot policy', () => {
  it('accepts an unflagged article above the trust threshold from an active source', () => {
    expect(isAutopilotCandidate(base, 80, new Set(), new Set([sourceId]))).toBe(true);
  });

  it('blocks articles from inactive or deleted sources', () => {
    expect(isAutopilotCandidate(base, 80, new Set(), new Set())).toBe(false);
    expect(isAutopilotCandidate(base, 80, new Set(), new Set(['00000000-0000-4000-8000-000000000002']))).toBe(
      false,
    );
    expect(isAutopilotCandidate({ ...base, source_id: null }, 80, new Set(), new Set([sourceId]))).toBe(false);
  });

  it('blocks critical, low-trust, and already final articles', () => {
    const activeSources = new Set([sourceId]);
    expect(isAutopilotCandidate({ ...base, warnings: ['wahl'] }, 80, new Set(), activeSources)).toBe(false);
    expect(isAutopilotCandidate({ ...base, trust_score: 79 }, 80, new Set(), activeSources)).toBe(false);
    expect(isAutopilotCandidate({ ...base, status: 'published' }, 80, new Set(), activeSources)).toBe(false);
  });

  it('honors an explicit source allowlist in addition to active-source checks', () => {
    const activeSources = new Set([sourceId]);
    expect(isAutopilotCandidate(base, 80, new Set([sourceId]), activeSources)).toBe(true);
    expect(
      isAutopilotCandidate(
        base,
        80,
        new Set(['00000000-0000-4000-8000-000000000002']),
        activeSources,
      ),
    ).toBe(false);
  });
});
