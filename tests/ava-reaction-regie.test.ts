import { readFile } from 'node:fs/promises';
import { describe, expect, it } from 'vitest';

describe('AVA reaction in the live control room', () => {
  it('persists a distinct AVA reaction mode and registers its migration', async () => {
    const [migration, migrationRunner, database] = await Promise.all([
      readFile('packages/database/src/071_ava_reaction_control.sql', 'utf8'),
      readFile('packages/database/src/migrate.ts', 'utf8'),
      readFile('packages/database/src/index.ts', 'utf8'),
    ]);
    expect(migration).toContain('reaction_mode');
    expect(migration).toContain('reaction_youtube_library_id');
    expect(migration).toContain('reaction_ava_intensity');
    expect(migration).toContain('reaction_chat_enabled');
    expect(migrationRunner).toContain("'071_ava_reaction_control.sql'");
    expect(database).toContain("reactionMode?: 'camera' | 'ava'");
  });

  it('starts a manual context session without requiring a broadcast rundown item', async () => {
    const [staffDatabase, runtime, api] = await Promise.all([
      readFile('packages/database/src/ai-staff.ts', 'utf8'),
      readFile('apps/api/src/ai-tv-team.ts', 'utf8'),
      readFile('apps/api/src/index.ts', 'utf8'),
    ]);
    expect(staffDatabase).toContain('startManualAiHostSession');
    expect(staffDatabase).toContain('youtubeLibraryItemForAiHost');
    expect(staffDatabase).toContain("values(null,$1,$2,$3,$4,$5,'youtube-context'");
    expect(runtime).toContain('existingDirection?.manualReaction === true');
    expect(runtime).toContain('minimumCommentariesPerHour');
    expect(api).toContain("mode: z.enum(['camera', 'ava', 'live'])");
    expect(runtime).toContain('queueContextPreparation(video.youtube_library_id');
    expect(api).toContain('aiHostOverlayState()');
  });

  it('takes the current YouTube timecode into a portal-based Reaction Live Show', async () => {
    const [migration, migrationRunner, api, page, obs] = await Promise.all([
      readFile('packages/database/src/081_reaction_live_show.sql', 'utf8'),
      readFile('packages/database/src/migrate.ts', 'utf8'),
      readFile('apps/api/src/index.ts', 'utf8'),
      readFile('apps/web/src/pages/LivePage.tsx', 'utf8'),
      readFile('packages/obs-controller/src/index.ts', 'utf8'),
    ]);
    expect(migration).toContain("'{camera,ava,live}'");
    expect(migrationRunner).toContain("'081_reaction_live_show.sql'");
    expect(api).toContain('currentYoutubeReactionProgram');
    expect(api).toContain('reactionStartSeconds');
    expect(api).toContain('JETZT LIVE EINORDNUNG');
    expect(api).toContain('livePortal.createViewer(liveSourceId)');
    expect(page).toContain('Reaction Live Show');
    expect(page).toContain('Mit Teaser live übernehmen');
    expect(page).toContain('Programmaudio unter dem Gast');
    expect(obs).toContain('setLiveSourceVolume');
  });

  it('keeps scheduled presenter media available when an unrelated manual session exists', async () => {
    const runtime = await readFile('apps/api/src/ai-tv-team.ts', 'utf8');
    expect(runtime).toContain('const persistentMediaFallback = Boolean(itemId && !session)');
    expect(runtime).toContain('mediaFallback: persistentMediaFallback');
    expect(runtime).toContain('idleVideoUrl');
    expect(runtime).toContain('speakingVideoUrl');
  });

  it('offers video selection, moderation density, and chat control in the Regie', async () => {
    const [page, styles] = await Promise.all([
      readFile('apps/web/src/pages/LivePage.tsx', 'utf8'),
      readFile('apps/web/src/style.css', 'utf8'),
    ]);
    expect(page).toContain('AVA moderiert');
    expect(page).toContain('Video in der Mediathek suchen');
    expect(page).toContain('Moderationsdichte');
    expect(page).toContain('Live-Chat in die Show einbeziehen');
    expect(page).toContain('AVA-Reaction jetzt starten');
    expect(styles).toContain('.reaction-library-picker');
    expect(styles).toContain('.reaction-mode-switch');
  });
});
