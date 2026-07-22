import {
  activeBroadcastRun,
  addBroadcastItem,
  addBroadcastYoutubeItem,
  addBroadcastYoutubeNewsSidebarItem,
  addBroadcastYoutubeContextItem,
  createBroadcastPlaylist,
  getArticleDetail,
  getAutopilotConfig,
  getSetting,
  listBroadcastCandidateArticles,
  listYoutubeVideos,
  listArticles,
  pool,
  query,
  requestBroadcastStart,
  saveArticlePackage,
  saveAudioAsset,
  setArticleStatus,
  type AutopilotConfig,
  type ArticleRecord,
} from '@ans/database';
import { getArticleMediaReadiness, queueArticleMediaDiscovery } from '@ans/database/article-media';
import { cleanArticleTextForBroadcast, makeScript, scriptWithChannelName, summarize } from '@ans/content-processing';
import { ObsController } from '@ans/obs-controller';
import { stat } from 'node:fs/promises';
import { isAbsolute, resolve } from 'node:path';
import { isAutopilotCandidate, isUnplayableAutopilotPlaylistError } from './autopilot-policy.js';
import { prepareAndSaveAiEditorial } from './ai-editorial.js';
import { PROJECT_ROOT } from './project-root.js';
import { generateTtsAudio } from '../../api/src/tts-generation.js';
import { prepareYoutubeContextForVideo } from '../../api/src/youtube-context.js';

export { isAutopilotCandidate, isUnplayableAutopilotPlaylistError } from './autopilot-policy.js';

type Log = (event: string, extra?: Record<string, unknown>) => void;

function timestampMs(value: unknown) {
  if (!value) return 0;
  if (value instanceof Date) return value.getTime();
  const parsed = Date.parse(String(value));
  return Number.isFinite(parsed) ? parsed : 0;
}

function defaultAutopilotFormats(config: AutopilotConfig): AutopilotConfig['dailyFormats'] {
  const durationMinutes = Math.max(
    30,
    config.contentMode === 'youtube-news-sidebar' || config.contentMode === 'youtube-context'
      ? config.showItemCount * 10
      : 60,
  );
  const slotMinutes = Math.max(15, durationMinutes);
  const formats: AutopilotConfig['dailyFormats'] = [];
  for (let minuteOfDay = 0; minuteOfDay < 24 * 60; minuteOfDay += slotMinutes) {
    const hour = Math.floor(minuteOfDay / 60);
    const minute = minuteOfDay % 60;
    const startTime = `${String(hour).padStart(2, '0')}:${String(minute).padStart(2, '0')}`;
    formats.push({
      id: `default-${config.contentMode}-${startTime.replace(':', '')}`,
      name:
        config.contentMode === 'mixed'
          ? 'Zeitkante Mix'
          : config.contentMode === 'youtube-news-sidebar'
            ? 'YouTube mit News-Sidebar'
            : config.contentMode === 'youtube-context'
              ? 'YouTube-Einordnung mit AVA'
              : config.contentMode === 'youtube'
                ? 'YouTube Videos'
                : 'Nachrichten',
      startTime,
      durationMinutes,
      contentMode: config.contentMode,
      youtubeCategoryIds: config.youtubeCategoryIds,
      sourceIds: config.sourceIds,
      enabled: true,
    });
  }
  return formats;
}

function pickDiverseYoutubeItems<
  T extends {
    id: string;
    enabled: boolean;
    category_id?: string | null;
    channel_title?: string | null;
    last_scheduled_at?: unknown;
    created_at?: unknown;
  },
>(videos: T[], categoryIds: string[], count: number, scheduledAtMs: number, runtimeLastScheduled: Map<string, number>) {
  const sorted = videos
    .filter(
      (video) =>
        video.enabled && (!categoryIds.length || (video.category_id && categoryIds.includes(video.category_id))),
    )
    .sort((a, b) => {
      const at = runtimeLastScheduled.get(a.id) ?? timestampMs(a.last_scheduled_at);
      const bt = runtimeLastScheduled.get(b.id) ?? timestampMs(b.last_scheduled_at);
      const afresh = timestampMs(a.created_at);
      const bfresh = timestampMs(b.created_at);
      if (!at && !bt) return bfresh - afresh;
      return at - bt || bfresh - afresh;
    });
  const selected: T[] = [];
  const selectedIds = new Set<string>();
  const selectedChannels = new Set<string>();
  for (const video of sorted) {
    const channel = (video.channel_title ?? '').trim().toLowerCase() || video.id;
    if (selectedChannels.has(channel)) continue;
    selected.push(video);
    selectedIds.add(video.id);
    selectedChannels.add(channel);
    if (selected.length >= count) break;
  }
  if (selected.length < count) {
    for (const video of sorted) {
      if (selectedIds.has(video.id)) continue;
      selected.push(video);
      selectedIds.add(video.id);
      if (selected.length >= count) break;
    }
  }
  selected.forEach((video, index) => runtimeLastScheduled.set(video.id, scheduledAtMs + index));
  return selected;
}

function articleFreshnessMs(article: { published_at?: unknown; fetched_at?: unknown; created_at?: unknown }) {
  return timestampMs(article.published_at) || timestampMs(article.fetched_at) || timestampMs(article.created_at);
}

function pickDiverseArticleItems<
  T extends {
    id: string;
    source_id?: string | null;
    published_at?: unknown;
    fetched_at?: unknown;
    created_at?: unknown;
  },
>(
  articles: T[],
  sourceIds: string[],
  count: number,
  scheduledAtMs: number,
  runtimeLastScheduled: Map<string, number>,
  updateRuntime = true,
) {
  const sorted = articles
    .filter((article) => !sourceIds.length || (article.source_id && sourceIds.includes(article.source_id)))
    .sort((a, b) => {
      const at = runtimeLastScheduled.get(a.id) ?? 0;
      const bt = runtimeLastScheduled.get(b.id) ?? 0;
      const afresh = articleFreshnessMs(a);
      const bfresh = articleFreshnessMs(b);
      if (!at && !bt) return bfresh - afresh;
      return at - bt || bfresh - afresh;
    });
  const selected: T[] = [];
  for (const article of sorted) {
    selected.push(article);
    if (selected.length >= count) break;
  }
  if (updateRuntime) selected.forEach((article, index) => runtimeLastScheduled.set(article.id, scheduledAtMs + index));
  return selected;
}

async function currentChannelIdentity() {
  const identity = await getSetting<{ channelName?: string; channelAliases?: string[] }>('studio.identity').catch(
    () => null,
  );
  return {
    channelName: identity?.channelName?.trim() || process.env.CHANNEL_NAME?.trim() || 'Studio',
    channelAliases: Array.isArray(identity?.channelAliases) ? identity.channelAliases : [],
  };
}

async function sidebarNewsFromArticleIds(articleIds: string[]) {
  if (!articleIds.length) return [];
  const rows = (
    await query<{
      id: string;
      title: string;
      summary: string | null;
      excerpt: string | null;
      main_text: string | null;
      source_name: string | null;
    }>(
      `select a.id,a.title,sm.summary,a.excerpt,a.main_text,s.name source_name
       from articles a
       left join sources s on s.id=a.source_id
       left join lateral (select summary from summaries where article_id=a.id order by created_at desc limit 1) sm on true
       where a.id=any($1::uuid[])
         and a.deleted_at is null
         and a.status in ('approved','published')`,
      [articleIds],
    )
  ).rows;
  const byId = new Map(rows.map((article) => [article.id, article]));
  return articleIds
    .map((id) => byId.get(id))
    .filter((article): article is NonNullable<typeof article> => Boolean(article))
    .map((article) => ({
      articleId: article.id,
      title: article.title,
      text: sidebarNewsText(article),
      source: article.source_name ?? 'Quelle',
    }))
    .filter(
      (item) =>
        item.title.trim().length > 0 &&
        item.text.trim().length >= 180 &&
        !/lokaler sendetest/i.test(item.source) &&
        !/^login\b/i.test(item.title.trim()),
    );
}

function sidebarNewsText(article: {
  main_text: string | null;
  summary: string | null;
  excerpt: string | null;
  title: string;
}) {
  const candidates = [article.main_text, article.summary, article.excerpt, article.title]
    .map((value) => cleanArticleTextForBroadcast(value ?? '', 12_000).trim())
    .filter(Boolean)
    .map((text) => ({ text, score: sidebarNewsTextScore(text) }))
    .sort((a, b) => b.score - a.score);
  return (candidates[0]?.text || article.title).slice(0, 2200);
}

function sidebarNewsTextScore(text: string) {
  const boilerplateCount = (
    text.match(
      /\b(Werbung|Anmelden|Registrieren|Newsletter|Datenschutzerklärung|Impressum|Kommentar schreiben|Loading|Unser Team|Unsere Mission|Kontakt)\b/gi,
    ) ?? []
  ).length;
  const startsWithNavigation = /^(Über uns|Unser Team|Unsere Mission|Akademie|Kontakt|Allgemeiner Kontakt)\b/i.test(
    text,
  );
  const shortPenalty = text.length < 180 ? 1000 : 0;
  const navigationPenalty = startsWithNavigation ? 900 : 0;
  return Math.min(text.length, 2200) - boilerplateCount * 180 - shortPenalty - navigationPenalty;
}

async function withAutopilotLock<T>(fn: () => Promise<T>) {
  const client = await pool.connect();
  let locked = false;
  try {
    locked = Boolean(
      (
        await client.query<{ locked: boolean }>(
          `select pg_try_advisory_lock(
             hashtextextended(current_database()||':'||current_schema()||':autopilot',0)
           ) locked`,
        )
      ).rows[0]?.locked,
    );
    if (!locked) return null;
    return await fn();
  } finally {
    if (locked)
      await client
        .query(
          `select pg_advisory_unlock(
             hashtextextended(current_database()||':'||current_schema()||':autopilot',0)
           )`,
        )
        .catch(() => undefined);
    client.release();
  }
}

async function activeSourceIds() {
  const result = await query<{ id: string }>(
    'select id from sources where active=true and deleted_at is null order by id',
  );
  return new Set(result.rows.map((row) => row.id));
}

async function recentAutopilotShowIsCoolingDown(config: AutopilotConfig) {
  if (config.pauseBetweenShowsSeconds <= 0) return false;
  const result = await query<{ recent: boolean }>(
    `select exists(
       select 1
       from broadcast_runs br
       join broadcast_playlists bp on bp.id=br.playlist_id
       where br.status='ended'
         and br.ended_at is not null
         and coalesce((bp.settings->>'autopilot')::boolean,false)=true
         and br.ended_at > now() - ($1 || ' seconds')::interval
     ) recent`,
    [config.pauseBetweenShowsSeconds],
  );
  return Boolean(result.rows[0]?.recent);
}

async function recentPublishedFallbackCandidates(
  config: AutopilotConfig,
  activeSources: Set<string>,
): Promise<ArticleRecord[]> {
  const configuredSourceIds = new Set(config.sourceIds);
  const result = await query<ArticleRecord & { last_played_at: string | null }>(
    `select a.*,s.name source_name,max(bi.finished_at) last_played_at
     from articles a
     join sources s on s.id=a.source_id
     left join broadcast_items bi on bi.article_id=a.id and bi.status in ('played','skipped')
     where a.deleted_at is null
       and a.status in ('approved','published')
       and coalesce(a.published_at,a.fetched_at) >= now() - interval '3 days'
       and a.trust_score >= $1
       and coalesce(array_length(a.warnings,1),0)=0
       and s.active=true and s.deleted_at is null
     group by a.id,s.name
     order by max(bi.finished_at) asc nulls first,
              case when a.status='approved' then 0 else 1 end,
              coalesce(a.published_at,a.fetched_at) desc
     limit $2`,
    [config.minimumTrust, config.scanLimit],
  );
  return result.rows.filter(
    (article) =>
      Boolean(article.source_id) &&
      activeSources.has(article.source_id!) &&
      (configuredSourceIds.size === 0 || configuredSourceIds.has(article.source_id!)),
  );
}

async function readyAudioFallbackCandidates(
  config: AutopilotConfig,
  activeSources: Set<string>,
): Promise<ArticleRecord[]> {
  const configuredSourceIds = new Set(config.sourceIds);
  const result = await query<ArticleRecord & { last_played_at: string | null }>(
    `select a.*,s.name source_name,max(bi.finished_at) last_played_at
     from articles a
     join sources s on s.id=a.source_id
     join lateral (select sc.id from scripts sc where sc.article_id=a.id order by sc.created_at desc limit 1) sc on true
     join lateral (
       select aa.duration_seconds,ma.filename
       from audio_assets aa
       join media_assets ma on ma.id=aa.media_id
       where aa.script_id=sc.id
         and ma.filename is not null
         and aa.duration_seconds > 0
       order by aa.id desc
       limit 1
     ) aa on true
     left join broadcast_items bi on bi.article_id=a.id
     where a.deleted_at is null
       and a.status in ('approved','published')
       and a.trust_score >= $1
       and coalesce(array_length(a.warnings,1),0)=0
       and s.active=true and s.deleted_at is null
       and not exists(
         select 1
         from broadcast_items used
         join broadcast_playlists used_playlist on used_playlist.id=used.playlist_id
         where used.article_id=a.id
           and used.status in ('planned','preparing','playing','played','skipped','error')
           and coalesce((used_playlist.settings->>'autopilot')::boolean,false)=true
       )
     group by a.id,s.name
     order by max(bi.finished_at) asc nulls first,
              case when a.status='approved' then 0 else 1 end,
              coalesce(a.published_at,a.fetched_at) desc
     limit $2`,
    [config.minimumTrust, Math.max(config.showItemCount, config.scanLimit)],
  );
  return result.rows.filter(
    (article) =>
      Boolean(article.source_id) &&
      activeSources.has(article.source_id!) &&
      (configuredSourceIds.size === 0 || configuredSourceIds.has(article.source_id!)),
  );
}

async function streamIsReady(required: boolean) {
  if (!required) return true;
  const obs = new ObsController({
    host: process.env.OBS_HOST ?? '127.0.0.1',
    port: Number(process.env.OBS_PORT ?? 4455),
    password: process.env.OBS_PASSWORD,
  });
  try {
    return (await obs.getStreamStatus()).outputActive;
  } finally {
    await obs.disconnect().catch(() => undefined);
  }
}

async function startDueAutopilotPlaylist(config: AutopilotConfig, log: Log) {
  const due = (
    await query<{ id: string }>(
      `select id
       from broadcast_playlists
       where status='draft'
         and scheduled_at is not null
         and scheduled_at <= now()
         and coalesce((settings->>'autopilot')::boolean,false)=true
       order by scheduled_at asc
       limit 1`,
    )
  ).rows[0];
  if (!due) return null;
  if (!(await streamIsReady(config.requireStream))) {
    log('autopilot_waiting', { reason: 'stream-inactive', playlistId: due.id });
    return null;
  }
  try {
    const started = await requestBroadcastStart({
      playlistId: due.id,
      requestedBySystem: 'autopilot',
      idempotencyKey: `autopilot:scheduled:${due.id}`,
    });
    log('autopilot_scheduled_started', { playlistId: due.id, runId: started.run?.id ?? null });
    return started.run ? { status: 'started', playlistId: due.id, runId: started.run.id } : null;
  } catch (error) {
    if (error instanceof Error && error.message === 'active-broadcast-run-exists') return null;
    if (isUnplayableAutopilotPlaylistError(error)) {
      const code = 'playlist-has-no-broadcastable-items';
      await query(
        `update broadcast_playlists
         set status='error',ended_at=now(),
             settings=jsonb_set(coalesce(settings,'{}'::jsonb),'{autopilotStartError}',to_jsonb($2::text),true)
         where id=$1 and status='draft'`,
        [due.id, code],
      );
      log('autopilot_scheduled_invalid', {
        playlistId: due.id,
        reason: code,
        recovery: 'marked-error-and-continued',
      });
      return null;
    }
    throw error;
  }
}

async function ensureAutopilotSchedule24h(config: AutopilotConfig, log: Log) {
  const formats = config.dailyFormats.filter((format) => format.enabled);
  if (!formats.length && config.contentMode === 'news') return;
  const effectiveFormats = formats.length ? formats : defaultAutopilotFormats(config);
  const { channelName } = await currentChannelIdentity();
  const [videos, articles] = await Promise.all([listYoutubeVideos(), listBroadcastCandidateArticles(config.scanLimit)]);
  const runtimeYoutubeLastScheduled = new Map(videos.map((video) => [video.id, timestampMs(video.last_scheduled_at)]));
  const runtimeArticleLastScheduled = new Map<string, number>();
  const readyArticles = articles.filter(
    (article) => article.audio_path && Number(article.audio_duration_seconds ?? 0) > 0,
  );
  const now = new Date();
  const horizon = new Date(now.getTime() + 24 * 3600_000);
  for (const dayOffset of [0, 1]) {
    for (const format of effectiveFormats) {
      const [hour, minute] = format.startTime.split(':').map(Number);
      const scheduled = new Date(now);
      scheduled.setDate(now.getDate() + dayOffset);
      scheduled.setHours(hour, minute, 0, 0);
      if (scheduled <= now || scheduled > horizon) continue;
      const scheduledAt = scheduled.toISOString();
      const exists = (
        await query<{ exists: boolean }>(
          `select exists(
             select 1 from broadcast_playlists
             where coalesce((settings->>'autopilot24h')::boolean,false)=true
               and settings->>'autopilotFormatId'=$1
               and scheduled_at=$2::timestamptz
           ) exists`,
          [format.id, scheduledAt],
        )
      ).rows[0]?.exists;
      if (exists) continue;
      const categoryIds = format.youtubeCategoryIds.length ? format.youtubeCategoryIds : config.youtubeCategoryIds;
      const sourceIds = format.sourceIds.length ? format.sourceIds : config.sourceIds;
      const useSidebar = format.contentMode === 'youtube-news-sidebar';
      const useYoutubeContext = format.contentMode === 'youtube-context';
      const youtubeItems =
        format.contentMode === 'youtube' || format.contentMode === 'mixed' || useSidebar || useYoutubeContext
          ? pickDiverseYoutubeItems(
              videos,
              categoryIds,
              Math.max(1, Math.ceil(format.durationMinutes / 20)),
              scheduled.getTime(),
              runtimeYoutubeLastScheduled,
            )
          : [];
      const articleItems =
        format.contentMode === 'news' || format.contentMode === 'mixed' || useSidebar || useYoutubeContext
          ? pickDiverseArticleItems(
              useSidebar || useYoutubeContext ? articles : readyArticles,
              sourceIds,
              Math.max(
                1,
                useSidebar || useYoutubeContext
                  ? Math.min(
                      config.scanLimit,
                      Math.max(config.showItemCount * 4, Math.ceil(format.durationMinutes / 6)),
                    )
                  : Math.min(config.showItemCount, Math.ceil(format.durationMinutes / 6)),
              ),
              scheduled.getTime(),
              runtimeArticleLastScheduled,
              !useSidebar && !useYoutubeContext,
            )
          : [];
      if (!youtubeItems.length && !articleItems.length) continue;
      const playlist = await createBroadcastPlaylist(`${channelName} ${format.name}`, {
        description: `Autopilot-Format ${format.name}, automatisch 24 Stunden voraus geplant.`,
        scheduledAt,
        kind: format.contentMode === 'youtube' ? 'special' : 'show',
        settings: {
          autopilot: true,
          autopilot24h: true,
          autopilotFormatId: format.id,
          contentMode: format.contentMode,
          youtubeNewsSidebar: useSidebar,
          youtubeContext: useYoutubeContext,
          pauseSeconds: config.pauseSeconds,
          transition: 'fade',
          repeatPolicy: 'none',
          targetRuntimeMinutes: format.durationMinutes,
        },
      });
      if (useYoutubeContext) {
        const news = (await sidebarNewsFromArticleIds(articleItems.map((article) => article.id))).slice(
          0,
          config.showItemCount,
        );
        news.forEach((item, index) => runtimeArticleLastScheduled.set(item.articleId, scheduled.getTime() + index));
        for (const video of youtubeItems) {
          const preparation = await prepareYoutubeContextForVideo(video.id);
          await addBroadcastYoutubeContextItem(
            playlist.id,
            {
              id: video.id,
              title: video.title,
              url: video.url,
              videoId: video.video_id,
              channelTitle: video.channel_title,
              categoryId: video.category_id,
              categoryName: video.category_name,
              durationSeconds: video.duration_seconds,
              sidebarRotationSeconds: config.sidebarRotationSeconds,
            },
            {
              analysis: preparation.analysis,
              analysisModel: preparation.model,
              fallbackReason: preparation.fallbackReason,
              newsFallback: news,
              pauseDuringAva: true,
            },
          );
        }
        if (youtubeItems.length) {
          await query(`update youtube_videos set last_scheduled_at=$1,updated_at=now() where id=any($2::uuid[])`, [
            scheduledAt,
            youtubeItems.map((video) => video.id),
          ]);
        }
        log('autopilot_schedule_created', {
          playlistId: playlist.id,
          formatId: format.id,
          scheduledAt,
          contentMode: 'youtube-context',
        });
        continue;
      }
      if (useSidebar) {
        const news = (await sidebarNewsFromArticleIds(articleItems.map((article) => article.id))).slice(
          0,
          config.showItemCount,
        );
        news.forEach((item, index) => runtimeArticleLastScheduled.set(item.articleId, scheduled.getTime() + index));
        for (const video of youtubeItems) {
          await addBroadcastYoutubeNewsSidebarItem(
            playlist.id,
            {
              id: video.id,
              title: video.title,
              url: video.url,
              videoId: video.video_id,
              channelTitle: video.channel_title,
              categoryId: video.category_id,
              categoryName: video.category_name,
              durationSeconds: video.duration_seconds,
              sidebarRotationSeconds: config.sidebarRotationSeconds,
            },
            news,
          );
        }
        if (youtubeItems.length) {
          await query(`update youtube_videos set last_scheduled_at=$1,updated_at=now() where id=any($2::uuid[])`, [
            scheduledAt,
            youtubeItems.map((video) => video.id),
          ]);
        }
        log('autopilot_schedule_created', { playlistId: playlist.id, formatId: format.id, scheduledAt });
        continue;
      }
      for (const article of articleItems) await addBroadcastItem(playlist.id, article.id);
      for (const video of youtubeItems) {
        await addBroadcastYoutubeItem(playlist.id, {
          id: video.id,
          title: video.title,
          url: video.url,
          videoId: video.video_id,
          channelTitle: video.channel_title,
          categoryId: video.category_id,
          categoryName: video.category_name,
          durationSeconds: video.duration_seconds,
        });
      }
      if (youtubeItems.length) {
        await query(`update youtube_videos set last_scheduled_at=$1,updated_at=now() where id=any($2::uuid[])`, [
          scheduledAt,
          youtubeItems.map((video) => video.id),
        ]);
      }
      log('autopilot_schedule_created', { playlistId: playlist.id, formatId: format.id, scheduledAt });
    }
  }
}

async function createAndStartYoutubePlaylist(config: AutopilotConfig, log: Log, reason: string) {
  const requested = Math.max(1, config.showItemCount);
  const usedVideoIds = new Set(
    (
      await query<{ video_id: string }>(
        `select distinct rules->>'youtubeVideoId' video_id
         from broadcast_items bi
         join broadcast_playlists bp on bp.id=bi.playlist_id
         where bi.rules->>'kind'='youtube-video'
           and bi.status in ('planned','preparing','playing','played','skipped','error')
           and coalesce((bp.settings->>'autopilot')::boolean,false)=true
           and coalesce(bi.finished_at,bp.scheduled_at,bp.created_at) > now() - interval '7 days'`,
      )
    ).rows.map((row) => row.video_id),
  );
  const pool = (await listYoutubeVideos()).filter(
    (video) =>
      video.enabled &&
      (!config.youtubeCategoryIds.length ||
        (video.category_id && config.youtubeCategoryIds.includes(video.category_id))),
  );
  const freshPool = pool.filter((video) => !usedVideoIds.has(video.video_id));
  const videos = (freshPool.length >= requested ? freshPool : pool)
    .sort((a, b) => {
      const at = timestampMs(a.last_scheduled_at);
      const bt = timestampMs(b.last_scheduled_at);
      return at - bt || timestampMs(a.created_at) - timestampMs(b.created_at);
    })
    .slice(0, requested);
  if (!videos.length) return null;
  const { channelName } = await currentChannelIdentity();
  const scheduledAt = new Date().toISOString();
  const playlist = await createBroadcastPlaylist(
    `${channelName} YouTube ${scheduledAt.replace('T', ' ').slice(0, 19)} UTC`,
    {
      kind: 'special',
      description: `${videos.length} automatisch zusammengestellte YouTube-Videos`,
      scheduledAt,
      settings: {
        autopilot: true,
        contentMode: 'youtube',
        pauseSeconds: config.pauseSeconds,
        transition: 'fade',
        repeatPolicy: reason,
        targetRuntimeMinutes: Math.max(
          1,
          Math.ceil(videos.reduce((sum, video) => sum + video.duration_seconds, 0) / 60),
        ),
      },
    },
  );
  for (const video of videos) {
    await addBroadcastYoutubeItem(playlist.id, {
      id: video.id,
      title: video.title,
      url: video.url,
      videoId: video.video_id,
      channelTitle: video.channel_title,
      categoryId: video.category_id,
      categoryName: video.category_name,
      durationSeconds: video.duration_seconds,
    });
  }
  await query(`update youtube_videos set last_scheduled_at=$1,updated_at=now() where id=any($2::uuid[])`, [
    scheduledAt,
    videos.map((video) => video.id),
  ]);
  log('autopilot_youtube_playlist_ready', {
    playlistId: playlist.id,
    videoIds: videos.map((video) => video.video_id),
    reason,
  });
  return startPlaylist(playlist.id, `youtube:${videos[0]!.video_id}`, log);
}

async function createAndStartYoutubeNewsSidebarPlaylist(config: AutopilotConfig, log: Log, reason: string) {
  const requested = Math.max(1, config.showItemCount);
  const scheduledAt = new Date();
  const allVideos = await listYoutubeVideos();
  const videos = pickDiverseYoutubeItems(
    allVideos,
    config.youtubeCategoryIds,
    requested,
    scheduledAt.getTime(),
    new Map(allVideos.map((video) => [video.id, timestampMs(video.last_scheduled_at)])),
  );
  if (!videos.length) {
    log('autopilot_waiting', { reason: 'youtube-sidebar-library-empty' });
    return null;
  }

  const articles = pickDiverseArticleItems(
    await listBroadcastCandidateArticles(config.scanLimit),
    config.sourceIds,
    Math.min(config.scanLimit, Math.max(requested * 4, requested)),
    scheduledAt.getTime(),
    new Map(),
    false,
  );
  const news = (await sidebarNewsFromArticleIds(articles.map((article) => article.id))).slice(0, requested);
  const { channelName } = await currentChannelIdentity();
  const scheduledAtIso = scheduledAt.toISOString();
  const playlist = await createBroadcastPlaylist(
    `${channelName} YouTube mit News-Sidebar ${scheduledAtIso.replace('T', ' ').slice(0, 19)} UTC`,
    {
      kind: 'show',
      description: `${videos.length} YouTube-Videos mit fortlaufend aktualisierten Nachrichten in der Sidebar`,
      scheduledAt: scheduledAtIso,
      settings: {
        autopilot: true,
        contentMode: 'youtube-news-sidebar',
        youtubeNewsSidebar: true,
        sidebarRotationSeconds: config.sidebarRotationSeconds,
        pauseSeconds: config.pauseSeconds,
        transition: 'fade',
        repeatPolicy: reason,
        targetRuntimeMinutes: Math.max(
          1,
          Math.ceil(videos.reduce((sum, video) => sum + video.duration_seconds, 0) / 60),
        ),
      },
    },
  );
  for (const video of videos) {
    await addBroadcastYoutubeNewsSidebarItem(
      playlist.id,
      {
        id: video.id,
        title: video.title,
        url: video.url,
        videoId: video.video_id,
        channelTitle: video.channel_title,
        categoryId: video.category_id,
        categoryName: video.category_name,
        durationSeconds: video.duration_seconds,
        sidebarRotationSeconds: config.sidebarRotationSeconds,
      },
      news,
    );
  }
  await query(`update youtube_videos set last_scheduled_at=$1,updated_at=now() where id=any($2::uuid[])`, [
    scheduledAtIso,
    videos.map((video) => video.id),
  ]);
  log('autopilot_youtube_sidebar_playlist_ready', {
    playlistId: playlist.id,
    videoIds: videos.map((video) => video.video_id),
    newsArticleIds: news.map((item) => item.articleId),
    reason,
  });
  return startPlaylist(playlist.id, `youtube:${videos[0]!.video_id}`, log);
}

async function createAndStartYoutubeContextPlaylist(config: AutopilotConfig, log: Log, reason: string) {
  const requested = Math.max(1, config.showItemCount);
  const scheduledAt = new Date();
  const allVideos = await listYoutubeVideos();
  const videos = pickDiverseYoutubeItems(
    allVideos,
    config.youtubeCategoryIds,
    requested,
    scheduledAt.getTime(),
    new Map(allVideos.map((video) => [video.id, timestampMs(video.last_scheduled_at)])),
  );
  if (!videos.length) {
    log('autopilot_waiting', { reason: 'youtube-context-library-empty' });
    return null;
  }
  const articles = pickDiverseArticleItems(
    await listBroadcastCandidateArticles(config.scanLimit),
    config.sourceIds,
    Math.min(config.scanLimit, Math.max(requested * 4, requested)),
    scheduledAt.getTime(),
    new Map(),
    false,
  );
  const news = (await sidebarNewsFromArticleIds(articles.map((article) => article.id))).slice(0, requested);
  // Transkript und Einordnung zuerst vorbereiten. Wird der Worker während der
  // längeren KI-Arbeit neu gestartet, bleibt dadurch keine leere, fällige
  // Sendung zurück, die den Autopiloten anschließend blockiert.
  const preparedVideos: Array<{
    video: (typeof videos)[number];
    preparation: Awaited<ReturnType<typeof prepareYoutubeContextForVideo>>;
  }> = [];
  for (const video of videos) {
    preparedVideos.push({ video, preparation: await prepareYoutubeContextForVideo(video.id) });
  }
  const { channelName } = await currentChannelIdentity();
  const scheduledAtIso = scheduledAt.toISOString();
  const playlist = await createBroadcastPlaylist(
    `${channelName} YouTube-Einordnung ${scheduledAtIso.replace('T', ' ').slice(0, 19)} UTC`,
    {
      kind: 'show',
      description: `${videos.length} YouTube-Videos, live eingeordnet durch AVA und das KI-Redaktionsteam`,
      scheduledAt: scheduledAtIso,
      settings: {
        autopilot: true,
        contentMode: 'youtube-context',
        youtubeContext: true,
        sidebarRotationSeconds: config.sidebarRotationSeconds,
        pauseSeconds: config.pauseSeconds,
        transition: 'fade',
        repeatPolicy: reason,
        targetRuntimeMinutes: Math.max(
          1,
          Math.ceil(videos.reduce((sum, video) => sum + video.duration_seconds, 0) / 60),
        ),
      },
    },
  );
  for (const { video, preparation } of preparedVideos) {
    await addBroadcastYoutubeContextItem(
      playlist.id,
      {
        id: video.id,
        title: video.title,
        url: video.url,
        videoId: video.video_id,
        channelTitle: video.channel_title,
        categoryId: video.category_id,
        categoryName: video.category_name,
        durationSeconds: video.duration_seconds,
        sidebarRotationSeconds: config.sidebarRotationSeconds,
      },
      {
        analysis: preparation.analysis,
        analysisModel: preparation.model,
        fallbackReason: preparation.fallbackReason,
        newsFallback: news,
        pauseDuringAva: true,
      },
    );
  }
  await query(`update youtube_videos set last_scheduled_at=$1,updated_at=now() where id=any($2::uuid[])`, [
    scheduledAtIso,
    videos.map((video) => video.id),
  ]);
  log('autopilot_youtube_context_playlist_ready', {
    playlistId: playlist.id,
    videoIds: videos.map((video) => video.video_id),
    newsArticleIds: news.map((item) => item.articleId),
    reason,
  });
  return startPlaylist(playlist.id, `youtube:${videos[0]!.video_id}`, log);
}

function resolveLocalPath(value: string | undefined | null) {
  const trimmed = value?.trim();
  if (!trimmed) return undefined;
  if (!trimmed.includes('/') || isAbsolute(trimmed)) return trimmed;
  return resolve(PROJECT_ROOT, trimmed);
}

async function usableAudioPath(file: string | null | undefined) {
  if (!file?.trim()) return false;
  try {
    const path = resolveLocalPath(file);
    return Boolean(path && (await stat(path)).size > 44);
  } catch {
    return false;
  }
}

async function existingBroadcast(articleId: string) {
  return (
    await query<{
      item_status: string;
      playlist_id: string;
      playlist_status: string;
    }>(
      `select bi.status item_status,bi.playlist_id,bp.status playlist_status
       from broadcast_items bi
       join broadcast_playlists bp on bp.id=bi.playlist_id
       where bi.article_id=$1
       order by bp.created_at desc
       limit 1`,
      [articleId],
    )
  ).rows[0];
}

async function startPlaylist(playlistId: string, articleId: string, log: Log) {
  let started: Awaited<ReturnType<typeof requestBroadcastStart>>;
  try {
    started = await requestBroadcastStart({
      playlistId,
      requestedBySystem: 'autopilot',
      idempotencyKey: `autopilot:${playlistId}`,
    });
  } catch (error) {
    if (error instanceof Error && error.message === 'active-broadcast-run-exists') {
      log('autopilot_queued', { articleId, playlistId, reason: 'broadcast-busy' });
      return { status: 'queued', articleId, playlistId } as const;
    }
    throw error;
  }
  if (!started.run) {
    log('autopilot_queued', { articleId, playlistId, reason: 'broadcast-busy' });
    return { status: 'queued', articleId, playlistId } as const;
  }
  log('autopilot_started', {
    articleId,
    playlistId,
    runId: started.run.id,
    operationId: started.operation?.id ?? null,
  });
  return { status: 'started', articleId, playlistId, runId: started.run.id } as const;
}

async function prepareAndStart(
  article: ArticleRecord,
  config: AutopilotConfig,
  log: Log,
  allowReplay = false,
  deferStart = false,
  synthesizeMissingAudio = true,
) {
  const mediaReadiness = await getArticleMediaReadiness(article.id);
  if (!mediaReadiness.ready) {
    await queueArticleMediaDiscovery(article.id);
    const event = {
      articleId: article.id,
      reason: 'required-visual-missing',
      candidates: mediaReadiness.candidates,
      references: mediaReadiness.references,
    };
    if (config.requireVideo) {
      log('autopilot_waiting', event);
      return null;
    }
    log('autopilot_continuing_without_visual', event);
  }

  const previous = allowReplay ? null : await existingBroadcast(article.id);
  if (previous) {
    if (deferStart) return null;
    if (previous.item_status === 'planned' && previous.playlist_status === 'draft') {
      return startPlaylist(previous.playlist_id, article.id, log);
    }
    return null;
  }

  let detail = await getArticleDetail(article.id);
  if (!detail) return null;
  const { channelName, channelAliases } = await currentChannelIdentity();
  if (!detail.summary?.trim() || !detail.script_text?.trim()) {
    try {
      const ai = await prepareAndSaveAiEditorial(detail, detail.source_name ?? 'der Originalquelle', {
        automatic: true,
        channelName,
      });
      if (ai) log('autopilot_ai_prepared', { articleId: detail.id, model: ai.model, tier: ai.tier });
    } catch (error) {
      log('autopilot_ai_failed', {
        articleId: detail.id,
        error: error instanceof Error ? error.message : String(error),
      });
    }
    detail = await getArticleDetail(article.id);
    if (!detail) throw new Error(`Artikel ${article.id} ist nach der KI-Aufbereitung nicht mehr verfügbar`);
    if (!detail.summary?.trim() || !detail.script_text?.trim()) {
      const sourceText = (detail.main_text || detail.excerpt || detail.title).trim();
      const summary = summarize(sourceText) || sourceText.slice(0, 520);
      const script = makeScript(detail.title, summary, detail.source_name ?? 'der Originalquelle', channelName);
      await saveArticlePackage(detail.id, summary, script, detail.title, summary.slice(0, 140));
    }
    detail = await getArticleDetail(article.id);
    if (!detail) throw new Error(`Artikel ${article.id} ist nach der Aufbereitung nicht mehr verfügbar`);
  }
  const channelScript = scriptWithChannelName(
    detail.script_text ?? detail.summary ?? detail.title,
    channelName,
    channelAliases,
  );
  if (channelScript !== detail.script_text) {
    await saveArticlePackage(
      detail.id,
      detail.summary ?? summarize(detail.main_text ?? detail.excerpt ?? detail.title),
      channelScript,
      detail.screen_text ?? detail.summary ?? detail.title,
      detail.ticker_text ?? detail.title.slice(0, 140),
      { promptVersion: 'channel-ident-v1', category: detail.category, warnings: detail.warnings },
    );
    detail = (await getArticleDetail(article.id)) ?? { ...detail, script_text: channelScript, audio_path: null };
  }
  if (detail.status !== 'approved') {
    await setArticleStatus(detail.id, 'approved');
    detail = (await getArticleDetail(article.id)) ?? detail;
  }
  if (detail.audio_path && !(await usableAudioPath(detail.audio_path))) {
    log('autopilot_audio_missing_file', { articleId: detail.id, audioPath: detail.audio_path });
    detail = { ...detail, audio_path: null };
  }
  if (!detail.audio_path && !synthesizeMissingAudio) {
    log('autopilot_skipping_unusable_ready_audio', { articleId: detail.id });
    return null;
  }
  if (!detail.audio_path) {
    try {
      const speech = await generateTtsAudio(detail.script_text ?? detail.summary ?? detail.title);
      await saveAudioAsset(detail.id, speech.file, speech.durationSeconds);
      log('autopilot_audio_ready', {
        articleId: detail.id,
        durationSeconds: speech.durationSeconds,
        cached: speech.cached,
        engine: speech.engine,
        configuredEngine: speech.configuredEngine,
        voice: speech.voice,
      });
      detail = (await getArticleDetail(article.id)) ?? detail;
    } catch (error) {
      log('autopilot_audio_failed', {
        articleId: detail.id,
        error: error instanceof Error ? error.message : String(error),
      });
      return null;
    }
  }
  if (!detail.audio_path) throw new Error(`Für Artikel ${article.id} wurde kein Sprecher-Audio gespeichert`);
  if (deferStart) return { status: 'prepared', articleId: detail.id } as const;

  const scheduledAt = new Date().toISOString();
  const playlist = await createBroadcastPlaylist(
    `${channelName} Auto ${scheduledAt.replace('T', ' ').slice(0, 19)} UTC`,
    {
      kind: 'show',
      scheduledAt,
      settings: {
        autopilot: true,
        pauseSeconds: config.pauseSeconds,
        transition: 'fade',
        repeatPolicy: 'recent-published',
        targetRuntimeMinutes: Math.max(1, Math.ceil(config.showItemCount * 1.5)),
      },
    },
  );
  const item = await addBroadcastItem(playlist.id, detail.id);
  if (!item) throw new Error(`Artikel ${article.id} konnte nicht in die automatische Sendeliste aufgenommen werden`);
  return startPlaylist(playlist.id, detail.id, log);
}

async function createAndStartPreparedPlaylist(articleIds: string[], config: AutopilotConfig, log: Log, reason: string) {
  const playableArticleIds: string[] = [];
  for (const articleId of articleIds) {
    const detail = await getArticleDetail(articleId);
    if (detail?.audio_path && (await usableAudioPath(detail.audio_path))) playableArticleIds.push(articleId);
    else log('autopilot_candidate_failed', { articleId, phase: 'playlist-validation', error: 'audio-unavailable' });
  }
  if (!playableArticleIds.length) return null;
  const { channelName } = await currentChannelIdentity();
  const scheduledAt = new Date().toISOString();
  const playlist = await createBroadcastPlaylist(
    `${channelName} Auto ${scheduledAt.replace('T', ' ').slice(0, 19)} UTC`,
    {
      kind: 'show',
      description: `${playableArticleIds.length} automatisch zusammengestellte Beiträge`,
      scheduledAt,
      settings: {
        autopilot: true,
        pauseSeconds: config.pauseSeconds,
        transition: 'fade',
        repeatPolicy: reason,
        targetRuntimeMinutes: Math.max(1, Math.ceil(playableArticleIds.length * 1.5)),
      },
    },
  );
  for (const articleId of playableArticleIds) {
    await addBroadcastItem(playlist.id, articleId);
  }
  log('autopilot_playlist_ready', { playlistId: playlist.id, articleIds: playableArticleIds, reason });
  return startPlaylist(playlist.id, playableArticleIds[0], log);
}

function maxSynchronousPreparationsPerTick() {
  const configured = Number(process.env.AUTOPILOT_MAX_SYNC_TTS_PER_TICK);
  if (Number.isFinite(configured)) return Math.max(1, Math.min(20, Math.floor(configured)));
  const engine = String(process.env.TTS_ENGINE ?? 'pocket-tts').toLowerCase();
  return engine === 'qwen3-tts' || engine === 'pocket-tts' ? 1 : 3;
}

export async function autopilotOnce(log: Log) {
  const config = await getAutopilotConfig();
  if (!config.enabled) return null;
  return withAutopilotLock(async () => {
    await ensureAutopilotSchedule24h(config, log);
    if (await activeBroadcastRun()) return null;
    const scheduled = await startDueAutopilotPlaylist(config, log);
    if (scheduled) return scheduled;
    if (await recentAutopilotShowIsCoolingDown(config)) {
      log('autopilot_waiting', { reason: 'between-shows-pause', seconds: config.pauseBetweenShowsSeconds });
      return null;
    }
    if (config.contentMode === 'youtube') {
      if (!(await streamIsReady(config.requireStream))) {
        log('autopilot_waiting', { reason: 'stream-inactive', candidates: 'youtube-library' });
        return null;
      }
      return createAndStartYoutubePlaylist(config, log, 'youtube-library');
    }
    if (config.contentMode === 'youtube-news-sidebar') {
      if (!(await streamIsReady(config.requireStream))) {
        log('autopilot_waiting', { reason: 'stream-inactive', candidates: 'youtube-sidebar-library' });
        return null;
      }
      return createAndStartYoutubeNewsSidebarPlaylist(config, log, 'youtube-sidebar-library');
    }
    if (config.contentMode === 'youtube-context') {
      if (!(await streamIsReady(config.requireStream))) {
        log('autopilot_waiting', { reason: 'stream-inactive', candidates: 'youtube-context-library' });
        return null;
      }
      return createAndStartYoutubeContextPlaylist(config, log, 'youtube-context-library');
    }
    const [articles, activeSources] = await Promise.all([listArticles(config.scanLimit), activeSourceIds()]);
    const configuredSourceIds = new Set(config.sourceIds);
    const usedAutopilotArticleIds = new Set(
      (
        await query<{ article_id: string }>(
          `select distinct bi.article_id
           from broadcast_items bi
           join broadcast_playlists bp on bp.id=bi.playlist_id
           where bi.article_id is not null
             and bi.status in ('planned','preparing','playing','played','skipped','error')
             and coalesce((bp.settings->>'autopilot')::boolean,false)=true`,
        )
      ).rows.map((row) => row.article_id),
    );
    const candidates = articles.filter(
      (article) =>
        !usedAutopilotArticleIds.has(article.id) &&
        isAutopilotCandidate(article, config.minimumTrust, configuredSourceIds, activeSources),
    );
    const readyCandidates = await readyAudioFallbackCandidates(config, activeSources);
    const fallbackCandidates =
      candidates.length || readyCandidates.length ? [] : await recentPublishedFallbackCandidates(config, activeSources);
    if (!candidates.length && !readyCandidates.length && !fallbackCandidates.length) {
      if (config.contentMode === 'mixed') {
        if (!(await streamIsReady(config.requireStream))) {
          log('autopilot_waiting', { reason: 'stream-inactive', candidates: 'youtube-library' });
          return null;
        }
        return createAndStartYoutubePlaylist(config, log, 'mixed-youtube-fallback');
      }
      return null;
    }
    if (!(await streamIsReady(config.requireStream))) {
      log('autopilot_waiting', {
        reason: 'stream-inactive',
        candidates: candidates.length + readyCandidates.length + fallbackCandidates.length,
      });
      return null;
    }

    if (readyCandidates.length) {
      const prepared: string[] = [];
      const preparationLimit = config.showItemCount;
      for (const article of readyCandidates) {
        try {
          const result = await prepareAndStart(article, config, log, true, true, true);
          if (result?.status === 'prepared') prepared.push(result.articleId);
        } catch (error) {
          log('autopilot_candidate_failed', {
            articleId: article.id,
            phase: 'ready-audio',
            error: error instanceof Error ? error.message : String(error),
          });
        }
        if (prepared.length >= preparationLimit) break;
      }
      if (prepared.length) {
        log('autopilot_reused_ready_audio', { articleIds: prepared });
        return createAndStartPreparedPlaylist(prepared, config, log, 'ready-audio');
      }
    }

    const pool = candidates.length ? candidates : fallbackCandidates;
    const allowReplay = candidates.length === 0;
    const preparationLimit = candidates.length
      ? Math.min(config.showItemCount, maxSynchronousPreparationsPerTick())
      : config.showItemCount;
    const prepared: string[] = [];
    for (const article of pool) {
      try {
        const result = await prepareAndStart(article, config, log, allowReplay, true);
        if (result?.status === 'prepared') prepared.push(result.articleId);
      } catch (error) {
        log('autopilot_candidate_failed', {
          articleId: article.id,
          phase: 'prepare',
          error: error instanceof Error ? error.message : String(error),
        });
      }
      if (prepared.length >= preparationLimit) break;
    }
    if (!prepared.length) return null;
    if (allowReplay) log('autopilot_replayed_published', { articleIds: prepared });
    return createAndStartPreparedPlaylist(prepared, config, log, allowReplay ? 'recent-published' : 'newly-prepared');
  });
}
