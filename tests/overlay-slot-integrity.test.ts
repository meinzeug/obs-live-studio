import { readFile } from 'node:fs/promises';
import { describe, expect, it } from 'vitest';

describe('overlay slot integrity', () => {
  it('keeps recurring AVA migrations idempotent and archives historic generated duplicates', async () => {
    const [formatSeed, styling, cleanup, migrate] = await Promise.all([
      readFile('packages/database/src/061_ava_context_format_suite.sql', 'utf8'),
      readFile('packages/database/src/065_format_specific_obs_overlays.sql', 'utf8'),
      readFile('packages/database/src/084_overlay_slot_integrity.sql', 'utf8'),
      readFile('packages/database/src/migrate.ts', 'utf8'),
    ]);

    expect(formatSeed).toContain('join broadcast_templates format on format.system_key=seed.system_key');
    expect(styling).toContain('and version.snapshot=styled_snapshot');
    expect(cleanup).toContain("duplicate.template='youtube-context'");
    expect(cleanup).toContain('set deleted_at=now()');
    expect(migrate).toContain('084_overlay_slot_integrity.sql');
  });

  it('resolves configured overlays by their exact OBS scene and browser input', async () => {
    const [database, api, library] = await Promise.all([
      readFile('packages/database/src/index.ts', 'utf8'),
      readFile('apps/api/src/index.ts', 'utf8'),
      readFile('apps/web/src/pages/OverlaysPage.tsx', 'utf8'),
    ]);

    expect(database).toContain('getConfiguredOverlayForTarget');
    expect(api).toContain('getConfiguredOverlayForTarget(targetSlot.sceneName, targetSlot.inputName)');
    expect(api).toContain("and project.template='youtube-context'");
    expect(library).toContain('OBS-Slots synchronisieren');
    expect(library).toContain('Bibliothek und OBS-Slots sind unterschiedliche Ebenen');
  });
});
