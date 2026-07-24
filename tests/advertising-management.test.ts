import { readFile } from 'node:fs/promises';
import { describe, expect, it } from 'vitest';

describe('advertising management', () => {
  it('persists campaigns, weighted creatives, schedules, and auditable playouts', async () => {
    const [migration, database, api] = await Promise.all([
      readFile('packages/database/src/067_advertising_management.sql', 'utf8'),
      readFile('packages/database/src/advertising.ts', 'utf8'),
      readFile('apps/api/src/advertising.ts', 'utf8'),
    ]);
    expect(migration).toContain('advertising_campaigns');
    expect(migration).toContain('advertising_creatives');
    expect(migration).toContain('advertising_schedules');
    expect(migration).toContain('advertising_playouts');
    expect(migration).toContain("'Werbung · Master Overlay'");
    expect(database).toContain('claimDueAdvertisingPlayout');
    expect(database).toContain('minimum_gap_seconds');
    expect(database).toContain('max_per_hour');
    expect(api).toContain("'/api/advertising/creatives/:id/play'");
    expect(api).toContain("'/overlay/advertising'");
  });

  it('provides a dedicated workspace and OBS overlay', async () => {
    const [page, navigation, workspace, obs] = await Promise.all([
      readFile('apps/web/src/pages/AdvertisingPage.tsx', 'utf8'),
      readFile('apps/web/src/navigation.ts', 'utf8'),
      readFile('apps/web/src/workspace-navigation.ts', 'utf8'),
      readFile('packages/obs-controller/src/index.ts', 'utf8'),
    ]);
    expect(navigation).toContain("advertising: '/advertising'");
    expect(workspace).toContain("label: 'Werbung'");
    expect(page).toContain('Zeit & Rotation');
    expect(page).toContain('Ausspielprotokoll');
    expect(obs).toContain("ADVERTISING_SCENE = '20_ADVERTISING'");
    expect(obs).toContain("ADVERTISING_INPUT = 'ANS_AD_OVERLAY'");
  });
});
