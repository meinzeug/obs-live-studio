import { readFile } from 'node:fs/promises';
import { describe, expect, it } from 'vitest';
import { workspaces } from '../apps/web/src/workspace-navigation.js';

describe('TikTok Shorts Creator', () => {
  it('persists platform-specific jobs and never enables blind automatic publishing', async () => {
    const [migration, handoffMigration, intervalMigration] = await Promise.all([
      readFile('packages/database/src/038_tiktok_shorts.sql', 'utf8'),
      readFile('packages/database/src/039_tiktok_manual_handoff.sql', 'utf8'),
      readFile('packages/database/src/048_shorts_minimum_production_interval.sql', 'utf8'),
    ]);
    expect(migration).toContain('create table if not exists tiktok_shorts_settings');
    expect(migration).toContain('create table if not exists tiktok_short_jobs');
    expect(migration).toContain('source_job_id uuid not null references youtube_short_jobs(id) on delete cascade');
    expect(migration).not.toContain('auto_upload');
    expect(migration).toContain('privacy_level text');
    expect(migration).toContain('rights_confirmed boolean not null default false');
    expect(migration).toContain('music_usage_confirmed boolean not null default false');
    expect(handoffMigration).toContain("publishing_mode text not null default 'manual'");
    expect(handoffMigration).toContain("'handed-off'");
    expect(handoffMigration).toContain('manual_published_at timestamptz');
    expect(intervalMigration).toContain('alter table tiktok_shorts_settings');
  });

  it('keeps the automatic daily cap without blocking an explicit manual moment', async () => {
    const database = await readFile('packages/database/src/tiktok-shorts.ts', 'utf8');
    expect(database).toContain('!manual && (settings.daily_limit <= 0 || dailyCount >= settings.daily_limit)');
    expect(database).toContain('settings.minimum_interval_hours * 3_600_000');
    expect(database).toContain("coalesce(source.metadata->'requestedPlatforms','[]'::jsonb) ? 'tiktok'");
  });

  it('uses a separate native render without the YouTube PNG watermark', async () => {
    const worker = await readFile('apps/worker/src/tiktok-shorts.ts', 'utf8');
    expect(worker).toContain('renderTikTokShort');
    expect(worker).toContain('tiktokNativeRender: true');
    expect(worker).toContain('isAigc: true');
    expect(worker).toContain("state.status === 'PUBLISH_COMPLETE'");
    expect(worker).not.toContain('settings.overlay_path');
    expect(worker).not.toContain('ZEITKANTE_OVERLAY_SHORTS');
  });

  it('exposes a lazy page and a compliant explicit publishing dialog', async () => {
    const [app, navigation, page, api] = await Promise.all([
      readFile('apps/web/src/App.tsx', 'utf8'),
      readFile('apps/web/src/navigation.ts', 'utf8'),
      readFile('apps/web/src/pages/TikTokShortsPage.tsx', 'utf8'),
      readFile('apps/api/src/tiktok-shorts.ts', 'utf8'),
    ]);
    expect(navigation).toContain("tiktokShorts: '/tiktok-shorts'");
    expect(app).toContain('<TikTokShortsPage user={user} />');
    expect(workspaces.find((entry) => entry.id === 'shorts')?.children).toContainEqual(
      expect.objectContaining({ label: 'TikTok Shorts Creator', to: '/tiktok-shorts' }),
    );
    expect(page).toContain('Bitte auswählen …');
    expect(page).toContain('Kommentare erlauben');
    expect(page).toContain('TikTok Music Usage Confirmation');
    expect(page).toMatch(/KI-generierter Inhalt wird als\s+AIGC gekennzeichnet/);
    expect(page).toContain('Mit einem Klick an TikTok übergeben');
    expect(page).toContain('Freigabewarteschlange · empfohlen');
    expect(page).toContain('Mindestabstand zwischen automatischen Shorts');
    expect(page).toContain('https://www.tiktok.com/upload');
    expect(page).not.toContain('autoUpload');
    expect(api).toContain("app.get('/api/tiktok-shorts/creator-info'");
    expect(api).toContain("app.post('/api/tiktok-shorts/create-current'");
    expect(api).toContain('if (!result.queued) return reply.code(200).send(result)');
    expect(api).not.toContain('reply.code(result.job ? 409 : 422)');
    expect(api).toContain("app.post('/api/tiktok-shorts/jobs/:id/publish'");
    expect(api).toContain("app.post('/api/tiktok-shorts/jobs/:id/handoff'");
    expect(api).toContain("app.post('/api/tiktok-shorts/jobs/:id/manual-published'");
    expect(api).toContain("input.privacyLevel !== 'SELF_ONLY'");
  });

  it('registers TikTok LIVE in the shared platform manager', async () => {
    const [platforms, schema] = await Promise.all([
      readFile('packages/streaming-platforms/index.mjs', 'utf8'),
      readFile('apps/api/src/stream-target-settings.ts', 'utf8'),
    ]);
    expect(platforms).toContain("id: 'tiktok'");
    expect(platforms).toContain("label: 'TikTok LIVE'");
    expect(schema).toContain("'tiktok'");
  });
});
