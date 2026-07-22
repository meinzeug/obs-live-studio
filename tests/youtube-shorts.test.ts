import { readFile } from 'node:fs/promises';
import { describe, expect, it } from 'vitest';
import { workspaces } from '../apps/web/src/workspace-navigation.js';

describe('YouTube Shorts Creator', () => {
  it('persists exact 90-second jobs, one per source video, with a configurable daily limit', async () => {
    const [migration, channelMigration, intervalMigration] = await Promise.all([
      readFile('packages/database/src/035_youtube_shorts_and_chat_reliability.sql', 'utf8'),
      readFile('packages/database/src/036_youtube_shorts_channel_selection.sql', 'utf8'),
      readFile('packages/database/src/048_shorts_minimum_production_interval.sql', 'utf8'),
    ]);
    expect(migration).toContain('daily_limit int not null default 3');
    expect(migration).toContain('clip_duration_seconds int not null default 90');
    expect(migration).toContain('youtube_short_jobs_one_per_video unique(youtube_video_id)');
    expect(migration).toContain('/home/dennis/Dokumente/ZEITKANTE_OVERLAY_SHORTS_V2.png');
    expect(channelMigration).toContain("youtube_channel_id text not null default ''");
    expect(intervalMigration).toContain('minimum_interval_hours double precision not null default 3');
  });

  it('keeps broadcast cleanup race-safe while the Shorts worker and live runner are active', async () => {
    const migration = await readFile('packages/database/src/037_live_event_run_cleanup.sql', 'utf8');
    expect(migration).toContain('references broadcast_runs(id) on delete cascade');
  });

  it('requires a real transcript and qualified non-fallback AVA context before enqueueing', async () => {
    const database = await readFile('packages/database/src/youtube-shorts.ts', 'utf8');
    expect(database).toContain("session.format_kind='youtube-context'");
    expect(database).toContain("turn.staff_member_id='moderator'");
    expect(database).toContain("turn.transcript_status !== 'ready'");
    expect(database).toContain('transcriptSegments.length < 3');
    expect(database).toContain("turn.editorial_analysis_status !== 'ready'");
    expect(database).toContain('/fallback|redaktioneller-fallback/i');
    expect(database).toContain('eligibilityReason(turn, options.manual === true)');
    expect(database).toContain('premiumUpgradeRequired');
    expect(database).toContain('automaticPlatformBlockReason');
    expect(database).toContain('settings.minimum_interval_hours');
    expect(database).toContain("coalesce(job.metadata->'requestedPlatforms','[\"youtube\"]'::jsonb) ? 'youtube'");
    expect(database).toContain("select pg_advisory_xact_lock(hashtext('youtube-shorts-daily'))");
    expect(database).toContain("select pg_advisory_xact_lock(hashtext('youtube-shorts-upload-daily'))");
    expect(database).toContain("daily.status='uploaded'");
    expect(database).toContain("daily.status='uploading'");
    expect(database).toContain(')<settings.daily_limit');
    expect(database).toContain("(settings.enabled or coalesce(tiktok.enabled,false)) and job.status='queued'");
    expect(database).toContain('$1 and settings.enabled and settings.rights_confirmed and settings.daily_limit>0');
    expect(database).toContain("job.status='upload-queued'");
  });

  it('renders source, PNG design, AVA speech and idle loop on one synchronized timeline', async () => {
    const worker = await readFile('apps/worker/src/youtube-shorts.ts', 'utf8');
    expect(worker).toContain('job.clip_duration_seconds - leadSeconds - speechSeconds');
    expect(worker).toContain('scale=1000:562:force_original_aspect_ratio=decrease:force_divisible_by=2');
    expect(worker).toContain('trim=duration=${speechSeconds.toFixed(3)}');
    expect(worker).toContain('adelay=${Math.round(leadSeconds * 1000)}');
    expect(worker).toContain('[idlepre][speaking][idlepost]concat=n=3:v=1:a=0[avatar]');
    expect(worker).toContain('[stage4][branding]overlay=0:0:shortest=0');
    expect(worker).toContain('Math.abs(renderedDuration - job.clip_duration_seconds) > 0.15');
    expect(worker).toContain('generatePremiumShortSpeech');
    expect(worker).toContain('uploadYoutubeVideoResumable');
    expect(worker).toContain('channelId: channelId || null');
    expect(worker).toContain('Every\n        // upload—including a manually requested one—must be claimed');
    expect(worker).not.toContain('const result = await upload(ready, settings, env)');
  });

  it('exposes a lazy-loaded menu page, settings modal, production journal and secure OAuth workflow', async () => {
    const [app, navigation, workspace, page, routes] = await Promise.all([
      readFile('apps/web/src/App.tsx', 'utf8'),
      readFile('apps/web/src/navigation.ts', 'utf8'),
      readFile('apps/web/src/workspace-navigation.ts', 'utf8'),
      readFile('apps/web/src/pages/YoutubeShortsPage.tsx', 'utf8'),
      readFile('apps/api/src/youtube-shorts.ts', 'utf8'),
    ]);
    expect(navigation).toContain("youtubeShorts: '/youtube-shorts'");
    expect(app).toContain('<YoutubeShortsPage user={user} />');
    expect(workspace).toContain("label: 'Shorts & Clips'");
    expect(workspaces.find((entry) => entry.id === 'shorts')).toMatchObject({
      label: 'Shorts & Clips',
      to: '/youtube-shorts',
    });
    expect(workspaces.find((entry) => entry.id === 'shorts')?.children).toContainEqual(
      expect.objectContaining({ label: 'YouTube Shorts', to: '/youtube-shorts' }),
    );
    expect(workspaces.find((entry) => entry.id === 'automation')?.children).not.toContainEqual(
      expect.objectContaining({ to: '/youtube-shorts' }),
    );
    expect(page).toContain('Automation einrichten');
    expect(page).toContain('Produktionsjournal');
    expect(page).toContain('Shorts verwalten');
    expect(page).toContain('YouTube abgleichen');
    expect(page).toContain('Auf YouTube gelöscht');
    expect(page).toContain('Short bearbeiten');
    expect(page).toContain("deleteConfirmation !== 'LÖSCHEN'");
    expect(page).toContain('Shorts Creator konnte nicht geladen werden');
    expect(page).toContain('Nutzungsrechte bestätigt');
    expect(page).toContain('Mindestabstand zwischen automatischen Shorts');
    expect(routes).toContain("'/api/youtube/oauth'");
    expect(page).toContain('Zentrale YouTube-Verbindung verwalten');
    expect(page).toContain('Zielkanal für Shorts');
    expect(page).toContain('Weiteren Kanal verbinden');
    expect(page).not.toContain('OAuth Client-ID');
    expect(routes).toContain("'/api/youtube-shorts/create-current'");
    expect(routes).toContain('if (!result.queued) return reply.code(200).send(result)');
    expect(routes).not.toContain('reply.code(result.job ? 409 : 422)');
    expect(routes).toContain("'/api/youtube-shorts/reconcile'");
    expect(routes).toContain("app.patch('/api/youtube-shorts/jobs/:id'");
    expect(routes).toContain("app.delete('/api/youtube-shorts/jobs/:id'");
    expect(routes).toContain("youtubeRemoteState: state ? 'available' : 'missing'");
  });
});
