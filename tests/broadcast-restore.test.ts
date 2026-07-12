import { describe, it, expect, vi, beforeEach } from 'vitest';
vi.mock('@ans/database', () => {
  const state: any = {
    playlist: { id: 'pl', current_position: 1 },
    items: [
      { id: 'i1', article_id: 'a1', audio_path: '/tmp/a.wav', status: 'played' },
      { id: 'i2', article_id: 'a2', audio_path: '/tmp/b.wav', status: 'planned' },
    ],
    run: { id: 'run', playlist_id: 'pl', status: 'running' },
    marks: [],
  };
  return {
    __state: state,
    activeBroadcastRun: vi.fn(async () => state.run),
    tryStartBroadcastRun: vi.fn(),
    getBroadcastPlaylist: vi.fn(async () => state.playlist),
    listBroadcastItems: vi.fn(async () => state.items),
    markBroadcastItem: vi.fn(async (...a) => state.marks.push(a)),
    setArticleStatus: vi.fn(),
    setBroadcastPlaylistState: vi.fn(async (_id, _status, pos) => {
      if (pos !== undefined) state.playlist.current_position = pos;
    }),
    setPlaybackState: vi.fn(),
    updateBroadcastRun: vi.fn(async (_id, status) => (state.run.status = status)),
  };
});
import { BroadcastRunner } from '@ans/broadcast-engine';
describe('broadcast recovery resume', () => {
  beforeEach(async () => {
    const db = (await import('@ans/database')) as any;
    db.__state.run = { id: 'run', playlist_id: 'pl', status: 'running' };
    db.__state.marks = [];
  });
  it('continues at stored position and does not replay played items', async () => {
    const obs: any = { playTestContribution: vi.fn(async () => undefined) };
    await new BroadcastRunner({
      obs,
      playlistId: 'pl',
      overlayUrl: 'http://overlay',
      recoverRunId: 'run',
      maintenanceDelayMs: 0,
    }).start();
    expect(obs.playTestContribution).toHaveBeenCalledTimes(1);
    const db = (await import('@ans/database')) as any;
    expect(db.__state.marks).not.toContainEqual(['i1', 'played']);
    expect(db.__state.marks).toContainEqual(['i2', 'played']);
  });
});
