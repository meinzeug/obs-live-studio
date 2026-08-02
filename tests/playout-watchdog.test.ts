import { describe, expect, it } from 'vitest';
import { evaluatePlayoutProbe, evaluateWatchdogRecoveryFollowUp } from '../apps/worker/src/autonomous-operations.js';

const now = Date.parse('2026-07-23T22:00:00.000Z');

function probe(overrides: Partial<Parameters<typeof evaluatePlayoutProbe>[0]> = {}) {
  return evaluatePlayoutProbe({
    nowMs: now,
    runId: 'run-1',
    playlistId: 'playlist-1',
    runStartedAt: new Date(now - 120_000).toISOString(),
    playbackStatus: 'playing',
    playbackUpdatedAt: new Date(now - 2_000).toISOString(),
    itemId: 'item-1',
    itemKind: 'youtube-context',
    preproducedShow: false,
    itemStartedAt: new Date(now - 90_000).toISOString(),
    controlPaused: false,
    playerState: 1,
    lastProgressAt: new Date(now - 2_000).toISOString(),
    mediaPositionMs: 55_000,
    mediaDurationMs: 600_000,
    obsMediaStatus: null,
    ...overrides,
  });
}

describe('permanent master-control playout watchdog', () => {
  it('detects off-air operation immediately', () => {
    expect(probe({ runId: null, itemId: null, playbackStatus: 'idle' })).toMatchObject({
      healthy: false,
      code: 'off-air',
    });
  });

  it('does not interrupt an intentional AVA pause', () => {
    expect(probe({ controlPaused: true, playerState: 2 })).toMatchObject({ healthy: true });
  });

  it('detects a missing YouTube progress signal', () => {
    expect(probe({ lastProgressAt: null })).toMatchObject({
      healthy: false,
      code: 'youtube-no-progress',
    });
  });

  it('allows a complete preproduced show extra time for its intro and browser startup', () => {
    expect(probe({ preproducedShow: true, lastProgressAt: null })).toMatchObject({ healthy: true, code: null });
    expect(
      probe({
        preproducedShow: true,
        lastProgressAt: null,
        itemStartedAt: new Date(now - 181_000).toISOString(),
      }),
    ).toMatchObject({ healthy: false, code: 'youtube-no-progress' });
  });

  it('detects an unexpectedly paused player', () => {
    expect(probe({ playerState: 2 })).toMatchObject({
      healthy: false,
      code: 'youtube-unexpected-pause',
    });
  });

  it('accepts a fresh running player', () => {
    expect(probe()).toMatchObject({ healthy: true, code: null });
  });
});

describe('master-control recovery follow-up', () => {
  const operationId = '11111111-1111-4111-8111-111111111111';
  const runId = 'run-1';
  const requestedAt = new Date(now - 60_000).toISOString();
  const operation = {
    id: operationId,
    broadcast_run_id: runId,
    status: 'pending',
    created_at: requestedAt,
    claimed_at: null,
  };

  function followUp(overrides: Partial<Parameters<typeof evaluateWatchdogRecoveryFollowUp>[0]> = {}) {
    return evaluateWatchdogRecoveryFollowUp({
      sameFailure: true,
      runId,
      lastAction: `recover-runner:${operationId}`,
      lastActionAt: requestedAt,
      operation,
      nowMs: now,
      timeoutMs: 180_000,
      ...overrides,
    });
  }

  it.each(['pending', 'claimed'])('waits only for a fresh %s recovery operation', (status) => {
    expect(followUp({ operation: { ...operation, status } })).toMatchObject({
      action: 'wait',
      operationId,
      status,
    });
  });

  it.each(['failed', 'expired', 'completed'])('allows remediation after a terminal %s operation', (status) => {
    expect(followUp({ operation: { ...operation, status } })).toMatchObject({
      action: 'retry',
      operationId,
      status,
    });
  });

  it('allows remediation when an active recovery operation exceeds the pending timeout', () => {
    const staleAt = new Date(now - 180_001).toISOString();
    expect(
      followUp({
        lastActionAt: staleAt,
        operation: { ...operation, created_at: staleAt, claimed_at: staleAt },
      }),
    ).toMatchObject({ action: 'retry', operationId, status: 'pending' });
  });

  it('allows remediation when the recorded operation disappeared or belongs to another run', () => {
    expect(followUp({ operation: null })).toMatchObject({ action: 'retry', operationId, status: null });
    expect(followUp({ operation: { ...operation, broadcast_run_id: 'run-2' } })).toMatchObject({
      action: 'retry',
      operationId,
    });
  });

  it('ignores an older recovery action after the failure fingerprint changes', () => {
    expect(followUp({ sameFailure: false })).toMatchObject({ action: 'none', operationId });
  });
});
