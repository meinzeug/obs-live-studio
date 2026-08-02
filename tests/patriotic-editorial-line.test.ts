import { readFile } from 'node:fs/promises';
import { describe, expect, it } from 'vitest';
import { GERMANY_PATRIOTIC_EDITORIAL_LINE } from '@ans/ai-provider';

describe('deutschlandfreundliche verfassungspatriotische Senderhaltung', () => {
  it('bindet patriotische Bewertung an Fakten, konkrete Kritik und demokratische Grenzen', () => {
    expect(GERMANY_PATRIOTIC_EDITORIAL_LINE).toContain('deutschlandfreundlich');
    expect(GERMANY_PATRIOTIC_EDITORIAL_LINE).toContain('demokratischen Verfassungspatriotismus');
    expect(GERMANY_PATRIOTIC_EDITORIAL_LINE).toContain('Interessen der Bürger in Deutschland');
    expect(GERMANY_PATRIOTIC_EDITORIAL_LINE).toContain('besonders kritisch');
    expect(GERMANY_PATRIOTIC_EDITORIAL_LINE).toContain('„woke“ nie als pauschales Schimpfwort');
    expect(GERMANY_PATRIOTIC_EDITORIAL_LINE).toContain('keine Parteipropaganda');
    expect(GERMANY_PATRIOTIC_EDITORIAL_LINE).toContain('denselben Belegstandard');
  });

  it('propagiert die Haltung in Redaktion, sechs Moderatoren und laufende Sendepläne', async () => {
    const [provider, planner, migration, migrate] = await Promise.all([
      readFile('packages/ai-provider/src/index.ts', 'utf8'),
      readFile('apps/worker/src/newsroom-planner.ts', 'utf8'),
      readFile('packages/database/src/095_germany_patriotic_editorial_line.sql', 'utf8'),
      readFile('packages/database/src/migrate.ts', 'utf8'),
    ]);

    for (const task of [
      'editorial',
      'newsroom-plan',
      'youtube-context',
      'youtube-show-script',
      'host-response',
      'shorts-editorial',
      'studio-strategy',
    ]) {
      expect(provider).toContain(`'${task}'`);
    }
    expect(provider).toContain('PATRIOTIC_EDITORIAL_TASKS.has(task)');
    expect(provider).toContain('Nora. Bei kind=translation');
    expect(planner).toContain("editorialPerspective: 'democratic-constitutional-patriotism-de'");
    expect(migration).toContain("'germanyFriendly',true");
    expect(migration).toContain("'identityPoliticsStance','critical'");
    expect(migration).toContain(
      "where id in (\n  'moderator','chat-moderator','presenter-lea','presenter-leon','presenter-jonas','presenter-karim'",
    );
    expect(migration).toContain("where id='translator'");
    expect(migration).toContain("playlist.status in ('draft','running','paused')");
    expect(migrate).toContain('095_germany_patriotic_editorial_line.sql');
  });
});
