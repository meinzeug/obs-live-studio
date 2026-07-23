import { describe, expect, it } from 'vitest';
import { evaluatePlayoutProbe } from '../apps/worker/src/autonomous-operations.js';

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
