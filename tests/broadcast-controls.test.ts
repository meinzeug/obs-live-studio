import { describe, it, expect, vi, beforeEach } from 'vitest';
import { BroadcastRunner } from '@ans/broadcast-engine';
vi.mock('@ans/database', () => {
  let currentRunnerId = '';
  const state: any = {
    playlist: { id: 'pl', current_position: 0 },
    items: [
      { id: 'i1', article_id: 'a1', audio_path: '/tmp/a.wav' },
      { id: 'i2', article_id: 'a2', audio_path: '/tmp/b.wav' },
      { id: 'i3', article_id: 'a3', audio_path: '/tmp/c.wav' },
    ],
    run: null,
    marks: [],
    playback: null,
    runStates: [],
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
    updateBroadcastRun: vi.fn(async (_id, status, last) => {
      state.run.status = status;
      state.runStates.push([status, last]);
    }),
    appendLiveEvent: vi.fn(async () => undefined),
    acquireRunnerLease: vi.fn(async (runId, runnerId) => {
      currentRunnerId = runnerId;
      return {
        broadcast_run_id: runId,
        runner_id: runnerId,
        lease_expires_at: new Date(Date.now() + 15000).toISOString(),
      };
    }),
    renewRunnerLease: vi.fn(async (runId, runnerId) => ({ broadcast_run_id: runId, runner_id: runnerId })),
    releaseRunnerLease: vi.fn(async () => undefined),
    claimNextBroadcastCommand: vi.fn(async () => null),
    completeBroadcastCommand: vi.fn(async () => undefined),
    rejectBroadcastCommand: vi.fn(async () => undefined),
    getRunnerLease: vi.fn(async () => ({ runner_id: currentRunnerId })),
  };
});
describe('BroadcastRunner live controls', () => {
  beforeEach(async () => {
    const db = (await import('@ans/database')) as any;
    db.__state.run = null;
    db.__state.marks = [];
    db.__state.runStates = [];
  });
  it('skips during active audio playback immediately', async () => {
    let calls = 0;
    const obs: any = {
      playTestContribution: vi.fn(async ({ control }: any) => {
        calls++;
        if (calls === 1) runner.control('skip');
        const signal = await control();
        if (signal) throw new Error(signal);
      }),
    };
    const runner = new BroadcastRunner({ obs, playlistId: 'pl', overlayUrl: 'http://overlay', maintenanceDelayMs: 0 });
    await runner.start();
    const db = (await import('@ans/database')) as any;
    expect(db.__state.marks).toContainEqual(['i1', 'skipped']);
    expect(calls).toBe(3);
    expect(db.__state.marks).toContainEqual(['i2', 'played']);
  });
  it('stops during active audio playback and marks the run interrupted', async () => {
    const obs: any = {
      playTestContribution: vi.fn(async ({ control }: any) => {
        runner.control('stop');
        const signal = await control();
        if (signal) throw new Error(signal);
      }),
    };
    const runner = new BroadcastRunner({ obs, playlistId: 'pl', overlayUrl: 'http://overlay', maintenanceDelayMs: 0 });
    await runner.start();
    const db = (await import('@ans/database')) as any;
    expect(db.__state.run.status).toBe('ended');
  });
});
