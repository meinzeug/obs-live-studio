import { readFile } from 'node:fs/promises';
import { describe, expect, it } from 'vitest';

describe('broadcast director instant cues', () => {
  it('persists restart-safe timed cues and exposes a public OBS renderer', async () => {
    const [migration, database, api, obs] = await Promise.all([
      readFile('packages/database/src/066_broadcast_director_cues.sql', 'utf8'),
      readFile('packages/database/src/index.ts', 'utf8'),
      readFile('apps/api/src/index.ts', 'utf8'),
      readFile('packages/obs-controller/src/index.ts', 'utf8'),
    ]);
    expect(migration).toContain('broadcast_director_cues');
    expect(migration).toContain('expires_at');
    expect(database).toContain('createBroadcastDirectorCue');
    expect(database).toContain('getActiveBroadcastDirectorCue');
    expect(api).toContain("app.get('/overlay/director-cue'");
    expect(api).toContain("app.post('/api/broadcast/director-cues'");
    expect(obs).toContain("DIRECTOR_CUE_INPUT = 'ANS_DIRECTOR_CUE_OVERLAY'");
    expect(obs).toContain('ensureDirectorCueOverlay');
  });

  it('offers the operator text, breaking, image, and video controls', async () => {
    const page = await readFile('apps/web/src/pages/BroadcastPage.tsx', 'utf8');
    expect(page).toContain('Sofort ins Bild');
    expect(page).toContain('Soforteinblendung');
    expect(page).toContain('Bild / Clip');
    expect(page).toContain('Jetzt einblenden');
  });
});
