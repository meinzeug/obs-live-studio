import { describe, it, expect, vi } from 'vitest';
import { BroadcastRunner } from '@ans/broadcast-engine';
vi.mock('@ans/database', () => {
  let currentRunnerId = '';
  const state: any = {
    playlist: { id: 'pl', current_position: 0 },
    items: [
      { id: 'i1', article_id: 'a1', audio_path: '/tmp/a.wav' },
      { id: 'i2', article_id: 'a2', audio_path: null },
    ],
    run: null,
    marks: [],
    playback: null,
  };
  return {
    __state: state,
    activeBroadcastRun: vi.fn(async () => state.run),
    tryStartBroadcastRun: vi.fn(async (id) => (state.run = { id: 'run', playlist_id: id, status: 'running' })),
    getBroadcastPlaylist: vi.fn(async () => state.playlist),
    getPlaybackSnapshot: vi.fn(async () => state.playback ?? { status: 'idle', stateRevision: 0 }),
    initializePlaybackRun: vi.fn(async ({ broadcastRunId, playlistId, status }) => {
      state.playback = { status: status ?? 'starting', runId: broadcastRunId, playlistId, stateRevision: 1 };
      return state.playback;
    }),
    applyRuntimeTransition: vi.fn(async (input) => {
      state.playback = {
        status: input.status,
        runId: input.broadcastRunId,
        playlistId: input.playlistId,
        itemId: input.itemId ?? null,
        articleId: input.articleId ?? null,
        position: input.position ?? null,
        stateRevision: Number(state.playback?.stateRevision ?? 0) + 1,
      };
      if (input.itemStatus && input.itemId) state.marks.push([input.itemId, input.itemStatus]);
      state.playlist.status = input.playlistStatus;
      if (input.position !== undefined) state.playlist.current_position = input.position;
      if (state.run) state.run.status = input.runStatus;
      return { snapshot: state.playback };
    }),
    finalizePlaybackRun: vi.fn(async (input) => {
      state.playback = {
        ...(state.playback ?? {}),
        status: input.status,
        stateRevision: Number(state.playback?.stateRevision ?? 0) + 1,
      };
      if (state.run) state.run.status = input.status;
      state.playlist.status = input.status;
      return { snapshot: state.playback };
    }),
    listBroadcastItems: vi.fn(async () => state.items),
    markBroadcastItem: vi.fn(async (...a) => state.marks.push(a)),
    setArticleStatus: vi.fn(),
    setBroadcastPlaylistState: vi.fn(async (_id, status, pos) => {
      state.playlist.status = status;
      if (pos !== undefined) state.playlist.current_position = pos;
    }),
    setPlaybackState: vi.fn(async (s) => (state.playback = s)),
    updateBroadcastRun: vi.fn(async (_id, status) => (state.run.status = status)),
    appendLiveEvent: vi.fn(async () => undefined),
    acquireRunnerLease: vi.fn(async (runId, runnerId) => {
      currentRunnerId = runnerId;
      return { broadcast_run_id: runId, runner_id: runnerId };
    }),
    renewRunnerLease: vi.fn(async (runId, runnerId) => ({ broadcast_run_id: runId, runner_id: runnerId })),
    releaseRunnerLease: vi.fn(async () => undefined),
    claimNextBroadcastCommand: vi.fn(async () => null),
    completeBroadcastCommand: vi.fn(async () => undefined),
    getRunnerLease: vi.fn(async () => ({ runner_id: currentRunnerId })),
  };
});
describe('BroadcastRunner state machine', () => {
  it('plays items sequentially and records item errors without blocking the run', async () => {
    const obs: any = {
      playTestContribution: vi.fn(async ({ onState }: any) => {
        await onState({ status: 'playing' });
      }),
    };
    const runner = new BroadcastRunner({ obs, playlistId: 'pl', overlayUrl: 'http://overlay', maintenanceDelayMs: 0 });
    await runner.start();
    const db = (await import('@ans/database')) as any;
    expect(obs.playTestContribution).toHaveBeenCalledOnce();
    expect(db.__state.marks).toContainEqual(['i1', 'played']);
    expect(db.__state.run.status).toBe('ended');
    expect(db.__state.playback).toMatchObject({ status: 'ended', articleId: 'a1' });
  });
});
