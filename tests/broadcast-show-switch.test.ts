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

  it('exposes play-now controls for playlists, timeline entries, and rundown items', async () => {
    const [routes, page, styles] = await Promise.all([
      readFile('apps/api/src/index.ts', 'utf8'),
      readFile('apps/web/src/pages/BroadcastPage.tsx', 'utf8'),
      readFile('apps/web/src/style.css', 'utf8'),
    ]);
    expect(routes).toContain("'/api/broadcast/playlists/:id/take'");
    expect(routes).toContain("'/api/broadcast/show-switches/:id'");
    expect(page).toContain('executeShowSwitch');
    expect(page).toContain('Start ab Beitrag');
    expect(page).toContain('Jetzt spielen');
    expect(styles).toContain('.broadcast-switch-progress');
  });
});
