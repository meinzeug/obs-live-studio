import { readFile } from 'node:fs/promises';
import { describe, expect, it } from 'vitest';

describe('durable broadcast show takeover', () => {
  it('persists a single restart-safe switch and consumes the selected rundown item', async () => {
    const [migration, database, runner] = await Promise.all([
      readFile('packages/database/src/058_broadcast_show_switch.sql', 'utf8'),
      readFile('packages/database/src/index.ts', 'utf8'),
      readFile('apps/broadcast-runner/src/index.ts', 'utf8'),
    ]);
    expect(migration).toContain('broadcast_show_switches');
    expect(migration).toContain('idx_single_active_broadcast_show_switch');
    expect(database).toContain('requestBroadcastShowSwitch');
    expect(database).toContain('claimReadyBroadcastShowSwitch');
    expect(database).toContain('startItemId');
    expect(runner).toContain('claimBroadcastRecoveryOperationById');
    expect(runner).toContain('completeBroadcastShowSwitch');
  });

  it('exposes controlled takeovers in the control room and a confirmed handoff from planning', async () => {
    const [routes, planningPage, controlPage, styles] = await Promise.all([
      readFile('apps/api/src/index.ts', 'utf8'),
      readFile('apps/web/src/pages/BroadcastPage.tsx', 'utf8'),
      readFile('apps/web/src/pages/LivePage.tsx', 'utf8'),
      readFile('apps/web/src/style.css', 'utf8'),
    ]);
    expect(routes).toContain("'/api/broadcast/playlists/:id/take'");
    expect(routes).toContain("'/api/broadcast/show-switches/:id'");
    expect(planningPage).toContain('takeReadyPlaylist');
    expect(planningPage).toContain('Jetzt übernehmen');
    expect(controlPage).toContain('executeShowSwitch');
    expect(controlPage).toContain('Kontrolliert übernehmen');
    expect(controlPage).toContain('Ab hier');
    expect(styles).toContain('.broadcast-switch-progress');
  });

  it('exposes protected deletion next to edit in cards and timeline entries', async () => {
    const page = await readFile('apps/web/src/pages/BroadcastPage.tsx', 'utf8');
    expect(page.match(/deletePlaylist\(playlist\.id, playlist\.name\)/g)?.length).toBeGreaterThanOrEqual(2);
    expect(page).toContain('status?.run?.playlist_id === playlist.id');
    expect(page).toContain("deletingPlaylistId === playlist.id ? 'Lösche …' : 'Löschen'");
  });
});
