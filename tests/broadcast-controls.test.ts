import { describe, it, expect, vi, beforeEach } from 'vitest';
import { BroadcastRunner } from '@ans/broadcast-engine';
vi.mock('@ans/database', () => {
  const state: any = {
    playlist: { id: 'pl', current_position: 0 },
    items: [
      { id: 'i1', article_id: 'a1', audio_path: '/tmp/a.wav' },
      { id: 'i2', article_id: 'a2', audio_path: '/tmp/b.wav' },
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
        const signal = await control();
        if (signal) throw new Error(signal);
      }),
    };
    const runner = new BroadcastRunner({ obs, playlistId: 'pl', overlayUrl: 'http://overlay', maintenanceDelayMs: 0 });
    runner.control('skip');
    await runner.start();
    const db = (await import('@ans/database')) as any;
    expect(db.__state.marks).toContainEqual(['i1', 'skipped', 'Manuell übersprungen']);
    expect(calls).toBe(1);
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
    expect(db.__state.run.status).toBe('interrupted');
  });
});
