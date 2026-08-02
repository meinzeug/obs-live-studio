import { readFile } from 'node:fs/promises';
import { describe, expect, it } from 'vitest';
import { isCurrentGermanBroadcastDay } from '../apps/worker/src/newsroom-planner.js';

describe('ausschließlich tagesaktuelle Sendethemen', () => {
  it('verwendet den deutschen Kalendertag einschließlich Sommerzeit', () => {
    const beforeBerlinMidnight = new Date('2026-08-02T21:59:59Z');
    const afterBerlinMidnight = new Date('2026-08-02T22:00:01Z');

    expect(isCurrentGermanBroadcastDay('2026-08-02T00:00:00Z', beforeBerlinMidnight)).toBe(true);
    expect(isCurrentGermanBroadcastDay('2026-08-02T00:00:00Z', afterBerlinMidnight)).toBe(false);
    expect(isCurrentGermanBroadcastDay(null, beforeBerlinMidnight)).toBe(false);
  });

  it('gated Vorproduktion, Planung und Playout technisch auf heute', async () => {
    const [preproduction, script, transcript, database, planner, autopilot, provider, migration, migrate] =
      await Promise.all([
        readFile('packages/database/src/youtube-preproduction.ts', 'utf8'),
        readFile('scripts/preproduce-youtube-library.ts', 'utf8'),
        readFile('apps/api/src/youtube-transcript.ts', 'utf8'),
        readFile('packages/database/src/index.ts', 'utf8'),
        readFile('apps/worker/src/newsroom-planner.ts', 'utf8'),
        readFile('apps/worker/src/autopilot.ts', 'utf8'),
        readFile('packages/ai-provider/src/index.ts', 'utf8'),
        readFile('packages/database/src/096_daily_current_news_only.sql', 'utf8'),
        readFile('packages/database/src/migrate.ts', 'utf8'),
      ]);

    for (const source of [preproduction, database, planner, autopilot, migration]) {
      expect(source).toContain("time zone 'Europe/Berlin'");
    }
    expect(database).toContain(
      'media_position_ms=greatest(youtube_context_playback_controls.media_position_ms,greatest(0,$2))',
    );
    expect(preproduction).toContain('yv.published_at desc nulls last');
    expect(preproduction).toContain('video.published_at desc,video.updated_at desc');
    expect(preproduction).toContain("script.status='unavailable' and script.updated_at<now()-interval '2 hours'");
    expect(script).toContain("!argv.includes('--allow-stale')");
    expect(script).toContain('YOUTUBE_PREPRODUCTION_TTS_CONCURRENCY');
    expect(transcript).toContain("'--impersonate',");
    expect(transcript).toContain("'youtube:fetch_pot=always'");
    expect(transcript).not.toContain('if (!browserCookies)');
    expect(planner).toContain('evidence.videos.length < 2');
    expect(planner).toContain('const lockClient = await pool.connect()');
    expect(planner).toContain("where status='planning'");
    expect(autopilot).toContain('expireStaleYoutubePlaylists');
    expect(autopilot).toContain("where playlist.status='draft'\n       and exists(");
    expect(autopilot).toContain('isCurrentGermanArticle');
    expect(autopilot).toContain("coalesce(a.published_at,a.fetched_at)>=date_trunc('day'");
    expect(provider).toContain('Tagesaktualität ist ein hartes Sendekriterium');
    expect(provider).toContain('Evergreen-, Rückblick-, Historien- oder reines Meinungsvideo');
    expect(provider).toContain('editorialPriorityYieldDeadline');
    expect(provider).toContain("priority === 'background' && Date.now() < editorialPriorityYieldDeadline");
    expect(provider).toContain('backgroundWaiterDirectory');
    expect(provider).toContain('agedBackgroundWaiting');
    expect(provider).toContain('liveBackgroundWaiters.sort');
    expect(provider).toContain('liveBackgroundWaiters[0]?.path !== backgroundWaiterFile');
    expect(provider).toContain('livePriorityWaiters.sort');
    expect(provider).toContain('livePriorityWaiters[0]?.path !== priorityWaiterFile');
    expect(migration).toContain("'rejectEvergreenWithoutTodayDevelopment',true");
    expect(migration).toContain("where playlist.status='draft'\n  and exists(");
    expect(migration).toContain("jsonb_array_elements(coalesce(item.rules->'news','[]'::jsonb))");
    expect(migrate).toContain('096_daily_current_news_only.sql');
  });
});
