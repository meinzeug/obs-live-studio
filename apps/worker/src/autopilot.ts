import {
  activeBroadcastRun,
  addBroadcastItem,
  createBroadcastPlaylist,
  getArticleDetail,
  getAutopilotConfig,
  getSetting,
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
import { makeScript, scriptWithChannelName, summarize } from '@ans/content-processing';
import { ObsController } from '@ans/obs-controller';
import {
  DEFAULT_PIPER_EXECUTABLE,
  DEFAULT_PIPER_MODEL_PATH,
  DEFAULT_PIPER_VOICE,
  DEFAULT_TTS_ENGINE,
  probeAudioDuration,
  synthesizeEspeak,
  synthesizePiper,
  synthesizeQwen3Tts,
} from '@ans/tts-engine';
import { stat } from 'node:fs/promises';
import { isAbsolute, resolve } from 'node:path';
import { isAutopilotCandidate } from './autopilot-policy.js';
import { prepareAndSaveAiEditorial } from './ai-editorial.js';
import { PROJECT_ROOT } from './project-root.js';

export { isAutopilotCandidate } from './autopilot-policy.js';

const AUTOPILOT_LOCK_KEY = '4711708359795181';

type Log = (event: string, extra?: Record<string, unknown>) => void;

async function currentChannelIdentity() {
  const identity = await getSetting<{ channelName?: string; channelAliases?: string[] }>('studio.identity').catch(
    () => null,
  );
  return {
    channelName: identity?.channelName?.trim() || process.env.CHANNEL_NAME?.trim() || 'Studio',
    channelAliases: Array.isArray(identity?.channelAliases) ? identity.channelAliases : [],
  };
}

async function withAutopilotLock<T>(fn: () => Promise<T>) {
  const client = await pool.connect();
  let locked = false;
  try {
    locked = Boolean(
      (await client.query<{ locked: boolean }>('select pg_try_advisory_lock($1::bigint) locked', [AUTOPILOT_LOCK_KEY]))
        .rows[0]?.locked,
    );
    if (!locked) return null;
    return await fn();
  } finally {
    if (locked)
      await client.query('select pg_advisory_unlock($1::bigint)', [AUTOPILOT_LOCK_KEY]).catch(() => undefined);
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
     order by case when a.status='approved' then 0 else 1 end,
              max(bi.finished_at) asc nulls first,
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
     left join broadcast_items bi on bi.article_id=a.id and bi.status in ('played','skipped','error')
     where a.deleted_at is null
       and a.status in ('approved','published')
       and a.trust_score >= $1
       and coalesce(array_length(a.warnings,1),0)=0
       and s.active=true and s.deleted_at is null
     group by a.id,s.name
     order by case when a.status='approved' then 0 else 1 end,
              max(bi.finished_at) asc nulls first,
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

function configuredTtsTimeoutMs() {
  const configured = Number(process.env.TTS_TIMEOUT_MS ?? 120_000);
  const qwen = String(process.env.TTS_ENGINE ?? DEFAULT_TTS_ENGINE).toLowerCase() === 'qwen3-tts';
  const minimum = qwen ? 300_000 : 1_000;
  const fallback = qwen ? 300_000 : 120_000;
  return Number.isFinite(configured) ? Math.max(minimum, Math.floor(configured)) : fallback;
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

async function synthesize(text: string, timeoutMs: number) {
  const outputDirectory = resolveLocalPath(
    process.env.TTS_OUTPUT_DIR ?? process.env.TTS_OUTPUT_DIRECTORY ?? './var/tts',
  )!;
  const engine = (process.env.TTS_ENGINE ?? DEFAULT_TTS_ENGINE).toLowerCase();
  if (engine === 'qwen3-tts') {
    return synthesizeQwen3Tts(text, {
      outputDirectory,
      executable: resolveLocalPath(process.env.QWEN3_TTS_EXECUTABLE ?? './var/qwen3-tts-venv/bin/python'),
      model: process.env.QWEN3_TTS_MODEL ?? 'Qwen/Qwen3-TTS-12Hz-0.6B-CustomVoice',
      modelDirectory: resolveLocalPath(process.env.QWEN3_TTS_MODEL_DIR),
      language: process.env.QWEN3_TTS_LANGUAGE ?? 'German',
      speaker: process.env.QWEN3_TTS_SPEAKER ?? 'Ryan',
      instruct:
        process.env.QWEN3_TTS_INSTRUCT ??
        'Sprich wie ein ruhiger deutscher Nachrichtensprecher: klar, seriös, neutral und gut verständlich.',
      timeoutMs,
    });
  }
  if (engine === 'espeak-ng' || engine === 'espeak') {
    return synthesizeEspeak(text, {
      outputDirectory,
      executable: resolveLocalPath(process.env.ESPEAK_EXECUTABLE),
      voice: process.env.TTS_DEFAULT_VOICE ?? 'de',
      speed: Number(process.env.TTS_SPEED ?? 165),
      volume: Number(process.env.TTS_VOLUME ?? 100),
      timeoutMs,
    });
  }
  const modelPath = process.env.PIPER_MODEL_PATH ?? process.env.TTS_MODEL_PATH ?? DEFAULT_PIPER_MODEL_PATH;
  return synthesizePiper(text, {
    outputDirectory,
    modelPath: resolveLocalPath(modelPath)!,
    piperExecutable: resolveLocalPath(process.env.PIPER_EXECUTABLE ?? DEFAULT_PIPER_EXECUTABLE)!,
    voice: process.env.TTS_DEFAULT_VOICE ?? DEFAULT_PIPER_VOICE,
    speed: Number(process.env.TTS_SPEED ?? 1),
    volume: Number(process.env.TTS_VOLUME ?? 1),
    timeoutMs,
  });
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
    const timeoutMs = configuredTtsTimeoutMs();
    const speech = await synthesize(detail.script_text ?? detail.summary ?? detail.title, timeoutMs);
    const durationSeconds = await probeAudioDuration(
      speech.file,
      process.env.FFPROBE_EXECUTABLE,
      Math.min(timeoutMs, 30_000),
    );
    await saveAudioAsset(detail.id, speech.file, durationSeconds);
    log('autopilot_audio_ready', {
      articleId: detail.id,
      durationSeconds,
      cached: speech.cached,
      voice: 'voice' in speech ? speech.voice : (process.env.TTS_DEFAULT_VOICE ?? 'de'),
    });
    detail = (await getArticleDetail(article.id)) ?? detail;
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
  const engine = String(process.env.TTS_ENGINE ?? DEFAULT_TTS_ENGINE).toLowerCase();
  return engine === 'qwen3-tts' ? 1 : 3;
}

export async function autopilotOnce(log: Log) {
  const config = await getAutopilotConfig();
  if (!config.enabled) return null;
  return withAutopilotLock(async () => {
    if (await activeBroadcastRun()) return null;
    if (await recentAutopilotShowIsCoolingDown(config)) {
      log('autopilot_waiting', { reason: 'between-shows-pause', seconds: config.pauseBetweenShowsSeconds });
      return null;
    }
    const [articles, activeSources] = await Promise.all([listArticles(config.scanLimit), activeSourceIds()]);
    const configuredSourceIds = new Set(config.sourceIds);
    const candidates = articles.filter((article) =>
      isAutopilotCandidate(article, config.minimumTrust, configuredSourceIds, activeSources),
    );
    const readyCandidates = await readyAudioFallbackCandidates(config, activeSources);
    const fallbackCandidates =
      candidates.length || readyCandidates.length ? [] : await recentPublishedFallbackCandidates(config, activeSources);
    if (!candidates.length && !readyCandidates.length && !fallbackCandidates.length) return null;
    if (!(await streamIsReady(config.requireStream))) {
      log('autopilot_waiting', {
        reason: 'stream-inactive',
        candidates: candidates.length + readyCandidates.length + fallbackCandidates.length,
      });
      return null;
    }

    if (readyCandidates.length) {
      const prepared: string[] = [];
      const preparationLimit = Math.min(config.showItemCount, maxSynchronousPreparationsPerTick());
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
    const preparationLimit = Math.min(config.showItemCount, maxSynchronousPreparationsPerTick());
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
