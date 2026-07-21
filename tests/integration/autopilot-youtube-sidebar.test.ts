import { randomUUID } from 'node:crypto';
import { afterEach, describe, expect, it } from 'vitest';
import {
  createYoutubeVideo,
  getSetting,
  query,
  setSetting,
  type AutopilotConfig,
} from '../../packages/database/src/index.js';
import { autopilotOnce } from '../../apps/worker/src/autopilot.js';
import {
  cleanupBroadcastFixtures,
  createBroadcastFixture,
  type BroadcastFixture,
} from '../helpers/broadcast-fixtures.js';

const integration = process.env.VITEST_INCLUDE_INTEGRATION === 'true' ? describe : describe.skip;

integration('Autopilot YouTube news sidebar runtime', () => {
  let overlayFixture: BroadcastFixture | null = null;
  let originalConfig: unknown;
  let originalIdentity: unknown;
  let prefix = '';
  let articleId: string | null = null;

  afterEach(async () => {
    if (prefix) {
      const playlistIds = (
        await query<{ id: string }>('select id from broadcast_playlists where name like $1', [`${prefix}%`])
      ).rows.map((row) => row.id);
      if (playlistIds.length) {
        const runIds = (
          await query<{ id: string }>('select id from broadcast_runs where playlist_id=any($1::uuid[])', [playlistIds])
        ).rows.map((row) => row.id);
        if (runIds.length) {
          await query('delete from broadcast_commands where broadcast_run_id=any($1::uuid[])', [runIds]);
          await query('delete from live_events where broadcast_run_id=any($1::uuid[])', [runIds]);
          await query('delete from broadcast_recovery_operations where broadcast_run_id=any($1::uuid[])', [runIds]);
          await query('delete from broadcast_runner_leases where broadcast_run_id=any($1::uuid[])', [runIds]);
          await query('delete from broadcast_runs where id=any($1::uuid[])', [runIds]);
        }
        await query(`delete from playback_state where (state->>'playlistId')=any($1::text[])`, [playlistIds]);
        await query('delete from broadcast_items where playlist_id=any($1::uuid[])', [playlistIds]);
        await query('delete from broadcast_playlists where id=any($1::uuid[])', [playlistIds]);
      }
      await query('delete from youtube_videos where video_id like $1', [`${prefix}-%`]);
    }
    if (articleId) {
      await query("delete from worker_jobs where payload->>'articleId'=$1", [articleId]);
      await query('delete from article_media_candidates where article_id=$1', [articleId]);
      await query('delete from media_links where article_id=$1', [articleId]);
      await query('delete from articles where id=$1', [articleId]);
    }
    if (originalConfig === null || originalConfig === undefined) {
      await query("delete from system_settings where key='autopilot.config'");
    } else {
      await setSetting('autopilot.config', originalConfig);
    }
    if (originalIdentity === null || originalIdentity === undefined) {
      await query("delete from system_settings where key='studio.identity'");
    } else {
      await setSetting('studio.identity', originalIdentity);
    }
    if (overlayFixture) await cleanupBroadcastFixtures('broadcast-integration', overlayFixture);
    overlayFixture = null;
    prefix = '';
    articleId = null;
  });

  it('creates another combined sidebar show instead of falling back to an article-only show', async () => {
    const suffix = randomUUID().replaceAll('-', '').slice(0, 12);
    prefix = `sidebar-runtime-${suffix}`;
    originalConfig = await getSetting('autopilot.config');
    originalIdentity = await getSetting('studio.identity');
    overlayFixture = await createBroadcastFixture({ scope: 'broadcast-integration', items: 1 });

    const article = (
      await query<{ id: string }>(
        `insert into articles(title,url,canonical_url,content_hash,status,main_text,trust_score)
         values($1,$2,$2,$3,'approved',$4,100)
         returning id`,
        [
          `${prefix} Aktuelle Nachricht`,
          `https://example.test/${prefix}/article`,
          suffix.padEnd(64, '0'),
          'Dies ist eine ausführliche aktuelle Nachricht für die Sidebar. '.repeat(12),
        ],
      )
    ).rows[0];
    articleId = article.id;
    for (const index of [1, 2]) {
      await createYoutubeVideo({
        title: `${prefix} Video ${index}`,
        url: `https://www.youtube.com/watch?v=${prefix}-${index}`,
        videoId: `${prefix}-${index}`,
        channelTitle: `Testkanal ${index}`,
        durationSeconds: 90 + index,
      });
    }

    const future = new Date(Date.now() + 2 * 3_600_000);
    const config: AutopilotConfig = {
      enabled: true,
      contentMode: 'youtube-news-sidebar',
      minimumTrust: 0,
      requireStream: false,
      requireVideo: false,
      showItemCount: 2,
      pauseSeconds: 0,
      pauseBetweenShowsSeconds: 0,
      sidebarRotationSeconds: 10,
      sourceIds: [],
      youtubeCategoryIds: [],
      dailyFormats: [
        {
          id: `${prefix}-future`,
          name: `${prefix} Future`,
          startTime: `${String(future.getHours()).padStart(2, '0')}:${String(future.getMinutes()).padStart(2, '0')}`,
          durationMinutes: 30,
          contentMode: 'youtube-news-sidebar',
          youtubeCategoryIds: [],
          sourceIds: [],
          enabled: true,
        },
      ],
      scanLimit: 20,
    };
    await setSetting('studio.identity', { channelName: prefix, channelAliases: [] });
    await setSetting('autopilot.config', config);

    const events: Array<{ event: string; extra?: Record<string, unknown> }> = [];
    const result = await autopilotOnce((event, extra) => events.push({ event, extra }));
    expect(result).toMatchObject({ status: 'started' });
    if (!result || !('playlistId' in result)) throw new Error('Sidebar-Sendung wurde nicht gestartet');

    const playlist = (
      await query<{ settings: Record<string, unknown> }>('select settings from broadcast_playlists where id=$1', [
        result.playlistId,
      ])
    ).rows[0];
    const items = (
      await query<{
        article_id: string | null;
        rules: { kind?: string; news?: Array<{ articleId: string }> };
      }>('select article_id,rules from broadcast_items where playlist_id=$1 order by position', [result.playlistId])
    ).rows;
    expect(playlist.settings).toMatchObject({
      contentMode: 'youtube-news-sidebar',
      youtubeNewsSidebar: true,
      repeatPolicy: 'youtube-sidebar-library',
    });
    expect(items).toHaveLength(2);
    expect(items.every((item) => item.article_id === null && item.rules.kind === 'youtube-news-sidebar')).toBe(true);
    expect(items.every((item) => item.rules.news?.some((news) => news.articleId === articleId))).toBe(true);
    expect(events.some(({ event }) => event === 'autopilot_youtube_sidebar_playlist_ready')).toBe(true);
  });
});
