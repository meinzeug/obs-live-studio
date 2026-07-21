import { mkdtemp, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, beforeEach, describe, it, expect, vi } from 'vitest';
import {
  BroadcastRunner,
  nullableBroadcastReference,
  shouldPlayProgramIntro,
  youtubeContextPauseDurationMs,
  youtubePlaybackWindow,
} from '@ans/broadcast-engine';

let audioDir = '';
async function makeAudioFile(name: string) {
  const file = join(audioDir, name);
  await writeFile(file, Buffer.alloc(128));
  return file;
}

vi.mock('@ans/database', () => {
  let currentRunnerId = '';
  const state: any = {
    playlist: { id: 'pl', current_position: 0 },
    items: [
      { id: 'i1', article_id: 'a1', audio_path: '/tmp/a.wav' },
      { id: 'i2', article_id: 'a2', audio_path: null },
    ],
    run: { id: 'run', playlist_id: 'pl', status: 'starting' },
    marks: [],
    playback: null,
  };
  return {
    __state: state,
    activeBroadcastRun: vi.fn(async () => state.run),
    tryStartBroadcastRun: vi.fn(),
    getBroadcastPlaylist: vi.fn(async () => state.playlist),
    getPlaybackSnapshot: vi.fn(async () => state.playback ?? { status: 'idle', stateRevision: 0 }),
    attachRunnerToPlaybackRun: vi.fn(async ({ broadcastRunId, playlistId, runnerId, leaseGeneration }) => {
      state.playback = {
        ...(state.playback ?? {}),
        status: state.playback?.status ?? 'starting',
        runId: broadcastRunId,
        playlistId,
        runnerId,
        leaseGeneration,
        stateRevision: Number(state.playback?.stateRevision ?? 1) + 1,
      };
      return { snapshot: state.playback, event: { type: 'runner-attached' } };
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
      return {
        broadcast_run_id: runId,
        runner_id: runnerId,
        lease_generation: 1,
        lease_expires_at: new Date(Date.now() + 15000).toISOString(),
      };
    }),
    renewRunnerLease: vi.fn(async (runId, runnerId) => ({ broadcast_run_id: runId, runner_id: runnerId })),
    releaseRunnerLease: vi.fn(async () => undefined),
    claimNextBroadcastCommand: vi.fn(async () => null),
    completeBroadcastCommand: vi.fn(async () => undefined),
    getRunnerLease: vi.fn(async () => ({ runner_id: currentRunnerId, lease_generation: 1 })),
    resetYoutubeContextPlaybackControl: vi.fn(async () => ({ paused: false })),
    getYoutubeContextPlaybackControl: vi.fn(async () => ({ paused: false })),
  };
});
describe('BroadcastRunner state machine', () => {
  it('plays the station intro only for a fresh, not-yet-started show', () => {
    expect(shouldPlayProgramIntro({ recoveryMode: 'fresh', currentPosition: 0, items: [{ status: 'planned' }] })).toBe(
      true,
    );
    expect(
      shouldPlayProgramIntro({ recoveryMode: 'resumed', currentPosition: 0, items: [{ status: 'planned' }] }),
    ).toBe(false);
    expect(shouldPlayProgramIntro({ recoveryMode: 'fresh', currentPosition: 0, items: [{ status: 'playing' }] })).toBe(
      false,
    );
    expect(shouldPlayProgramIntro({ recoveryMode: 'fresh', currentPosition: 2, items: [{ status: 'planned' }] })).toBe(
      false,
    );
  });

  it('keeps missing article references null for YouTube pause commands', () => {
    expect(nullableBroadcastReference(null)).toBeNull();
    expect(nullableBroadcastReference(undefined)).toBeNull();
    expect(nullableBroadcastReference('null')).toBeNull();
    expect(nullableBroadcastReference('context-item')).toBe('context-item');
  });

  it('subtracts AVA pause time when resuming a YouTube context item', () => {
    const now = Date.parse('2026-07-21T09:00:00.000Z');
    const accumulatedPauseMs = youtubeContextPauseDurationMs(
      {
        paused: true,
        pause_started_at: '2026-07-21T08:59:55.000Z',
        accumulated_pause_ms: 40_000,
      },
      now,
    );
    expect(accumulatedPauseMs).toBe(45_000);
    expect(
      youtubePlaybackWindow(
        { status: 'playing', started_at: '2026-07-21T08:58:00.000Z', finished_at: null },
        300_000,
        now,
        accumulatedPauseMs,
      ),
    ).toEqual({ startSeconds: 75, remainingDurationMs: 225_000 });
  });

  beforeEach(async () => {
    audioDir = await mkdtemp(join(tmpdir(), 'broadcast-engine-audio-'));
    const db = (await import('@ans/database')) as any;
    db.__state.items[0].audio_path = await makeAudioFile('a.wav');
  });

  afterEach(async () => {
    if (audioDir) await rm(audioDir, { recursive: true, force: true });
    audioDir = '';
  });

  it('throws unexpected item errors after marking run and playlist failed', async () => {
    const obs: any = {
      playTestContribution: vi.fn(async ({ onState }: any) => {
        await onState({ status: 'playing' });
      }),
    };
    const runner = new BroadcastRunner({ obs, playlistId: 'pl', overlayUrl: 'http://overlay', maintenanceDelayMs: 0 });
    await expect(runner.start()).rejects.toThrow(/Kein Sprecher-Audio/);
    const db = (await import('@ans/database')) as any;
    expect(obs.playTestContribution).toHaveBeenCalledOnce();
    expect(db.__state.marks).toContainEqual(['i1', 'played']);
    expect(db.__state.marks).toContainEqual(['i2', 'error']);
    expect(db.__state.run.status).toBe('error');
    expect(db.__state.playback).toMatchObject({ status: 'error', articleId: 'a2' });
  });

  it('routes YouTube context items through their dedicated scene and hold control', async () => {
    const db = (await import('@ans/database')) as any;
    db.__state.playlist = { id: 'pl', current_position: 0 };
    db.__state.items = [
      {
        id: 'context-item',
        article_id: null,
        duration_seconds: 30,
        status: 'planned',
        rules: {
          kind: 'youtube-context',
          youtubeVideoId: 'abcDEF12345',
          title: 'Einordnungstest',
          channelTitle: 'Testkanal',
          url: 'https://www.youtube.com/watch?v=abcDEF12345',
          durationSeconds: 30,
          sidebarRotationSeconds: 18,
        },
      },
    ];
    db.__state.run = { id: 'run-context', playlist_id: 'pl', status: 'starting' };
    db.__state.playback = { status: 'idle', stateRevision: 0 };
    db.__state.marks = [];
    const obs: any = {
      playYoutubeContextContribution: vi.fn(async ({ onState, shouldHoldPlayback }: any) => {
        await onState({ status: 'playing' });
        expect(await shouldHoldPlayback()).toBe(false);
      }),
    };
    const runner = new BroadcastRunner({ obs, playlistId: 'pl', overlayUrl: 'http://overlay', maintenanceDelayMs: 0 });
    await expect(runner.start()).resolves.toBeUndefined();
    expect(obs.playYoutubeContextContribution).toHaveBeenCalledOnce();
    const options = obs.playYoutubeContextContribution.mock.calls[0][0];
    expect(options.viewerUrl).toContain('broadcastItem=context-item');
    expect(options.overlayUrl).toContain('/overlay/youtube-context');
    expect(db.resetYoutubeContextPlaybackControl).toHaveBeenCalledWith('context-item', false);
  });

  it('preserves the active item and run during a graceful service restart', async () => {
    const db = (await import('@ans/database')) as any;
    db.__state.playlist = { id: 'pl', current_position: 0, status: 'running' };
    db.__state.items = [
      {
        id: 'restart-item',
        article_id: null,
        duration_seconds: 900,
        status: 'playing',
        started_at: new Date(Date.now() - 30_000).toISOString(),
        rules: {
          kind: 'youtube-context',
          youtubeVideoId: 'abcDEF12345',
          title: 'Recovery-Test',
          channelTitle: 'Testkanal',
          durationSeconds: 900,
        },
      },
    ];
    db.__state.run = { id: 'run-restart', playlist_id: 'pl', status: 'running' };
    db.__state.playback = { status: 'playing', stateRevision: 8, position: 0, itemId: 'restart-item' };
    db.__state.marks = [];
    db.finalizePlaybackRun.mockClear();
    db.releaseRunnerLease.mockClear();

    let contributionStarted!: () => void;
    const started = new Promise<void>((resolve) => {
      contributionStarted = resolve;
    });
    const obs: any = {
      pauseMedia: vi.fn(async () => undefined),
      playYoutubeContextContribution: vi.fn(async ({ onState, control }: any) => {
        await onState({ status: 'playing' });
        contributionStarted();
        while (true) {
          await control();
          await new Promise((resolve) => setTimeout(resolve, 2));
        }
      }),
    };
    const runner = new BroadcastRunner({
      obs,
      playlistId: 'pl',
      overlayUrl: 'http://overlay',
      maintenanceDelayMs: 0,
      runnerId: 'runner-restart-test',
    });
    await runner.initialize();
    const running = runner.run();
    await started;
    await runner.shutdown();
    await expect(running).resolves.toBeUndefined();

    expect(obs.pauseMedia).toHaveBeenCalledOnce();
    expect(db.finalizePlaybackRun).not.toHaveBeenCalled();
    expect(db.__state.marks).not.toContainEqual(['restart-item', 'played']);
    expect(db.__state.marks).not.toContainEqual(['restart-item', 'error']);
    expect(db.__state.playlist.current_position).toBe(0);
    expect(db.__state.run.status).toBe('running');
    expect(db.releaseRunnerLease).toHaveBeenCalledOnce();
  });
});
