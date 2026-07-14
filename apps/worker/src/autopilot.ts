import {
  activeBroadcastRun,
  addBroadcastItem,
  createBroadcastPlaylist,
  getArticleDetail,
  getAutopilotConfig,
  listArticles,
  pool,
  query,
  requestBroadcastRecoveryOperation,
  saveArticlePackage,
  saveAudioAsset,
  setArticleStatus,
  tryStartBroadcastRun,
  type ArticleRecord,
} from '@ans/database';
import { makeScript, summarize } from '@ans/content-processing';
import { ObsController } from '@ans/obs-controller';
import { probeAudioDuration, synthesizeEspeak, synthesizePiper } from '@ans/tts-engine';

const AUTOPILOT_LOCK_KEY = '4711708359795181';

type Log = (event: string, extra?: Record<string, unknown>) => void;

export function isAutopilotCandidate(
  article: Pick<ArticleRecord, 'source_id' | 'status' | 'trust_score' | 'warnings'>,
  minimumTrust = Number(process.env.AUTOPILOT_MIN_TRUST ?? 80),
  sourceIds = new Set(
    (process.env.AUTOPILOT_SOURCE_IDS ?? '')
      .split(',')
      .map((value) => value.trim())
      .filter(Boolean),
  ),
  activeSourceIds?: ReadonlySet<string>,
) {
  if (!['new', 'review', 'approved'].includes(article.status)) return false;
  if (Number(article.trust_score) < minimumTrust) return false;
  if (article.warnings?.length) return false;
  if (!article.source_id) return false;
  if (activeSourceIds && !activeSourceIds.has(article.source_id)) return false;
  return sourceIds.size === 0 || sourceIds.has(article.source_id);
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

async function synthesize(text: string) {
  const outputDirectory = process.env.TTS_OUTPUT_DIR ?? process.env.TTS_OUTPUT_DIRECTORY ?? './var/tts';
  const engine = (process.env.TTS_ENGINE ?? 'piper').toLowerCase();
  if (engine === 'espeak-ng' || engine === 'espeak') {
    return synthesizeEspeak(text, {
      outputDirectory,
      executable: process.env.ESPEAK_EXECUTABLE,
      voice: process.env.TTS_DEFAULT_VOICE ?? 'de',
      speed: Number(process.env.TTS_SPEED ?? 165),
      volume: Number(process.env.TTS_VOLUME ?? 100),
    });
  }
  const modelPath = process.env.PIPER_MODEL_PATH ?? process.env.TTS_MODEL_PATH;
  if (!modelPath) throw new Error('Für den Piper-TTS-Autopiloten fehlt PIPER_MODEL_PATH');
  return synthesizePiper(text, {
    outputDirectory,
    modelPath,
    piperExecutable: process.env.PIPER_EXECUTABLE,
    voice: process.env.TTS_DEFAULT_VOICE,
    speed: Number(process.env.TTS_SPEED ?? 1),
    volume: Number(process.env.TTS_VOLUME ?? 1),
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
  const run = await tryStartBroadcastRun(playlistId);
  if (!run) {
    log('autopilot_queued', { articleId, playlistId, reason: 'broadcast-busy' });
    return { status: 'queued', articleId, playlistId } as const;
  }
  const operation = await requestBroadcastRecoveryOperation({
    broadcastRunId: run.id,
    reason: 'autopilot-start',
    operationType: 'recover',
  }).catch(() => null);
  log('autopilot_started', {
    articleId,
    playlistId,
    runId: run.id,
    operationId: operation?.id ?? null,
  });
  return { status: 'started', articleId, playlistId, runId: run.id } as const;
}

async function prepareAndStart(article: ArticleRecord, log: Log) {
  const previous = await existingBroadcast(article.id);
  if (previous) {
    if (previous.item_status === 'planned' && previous.playlist_status === 'draft') {
      return startPlaylist(previous.playlist_id, article.id, log);
    }
    return null;
  }

  let detail = await getArticleDetail(article.id);
  if (!detail) return null;
  if (!detail.summary?.trim() || !detail.script_text?.trim()) {
    const sourceText = (detail.main_text || detail.excerpt || detail.title).trim();
    const summary = summarize(sourceText) || sourceText.slice(0, 520);
    const script = makeScript(detail.title, summary, detail.source_name ?? 'der Originalquelle');
    await saveArticlePackage(detail.id, summary, script, detail.title, summary.slice(0, 140));
    detail = await getArticleDetail(article.id);
    if (!detail) throw new Error(`Artikel ${article.id} ist nach der Aufbereitung nicht mehr verfügbar`);
  }
  if (detail.status !== 'approved') {
    await setArticleStatus(detail.id, 'approved');
    detail = (await getArticleDetail(article.id)) ?? detail;
  }
  if (!detail.audio_path) {
    const speech = await synthesize(detail.script_text ?? detail.summary ?? detail.title);
    const durationSeconds = await probeAudioDuration(speech.file);
    await saveAudioAsset(detail.id, speech.file, durationSeconds);
    detail = (await getArticleDetail(article.id)) ?? detail;
  }
  if (!detail.audio_path) throw new Error(`Für Artikel ${article.id} wurde kein Sprecher-Audio gespeichert`);

  const playlist = await createBroadcastPlaylist(
    `ArgumentationsKette Auto ${new Date().toISOString().replace('T', ' ').slice(0, 19)} UTC`,
  );
  const item = await addBroadcastItem(playlist.id, detail.id);
  if (!item) throw new Error(`Artikel ${article.id} konnte nicht in die automatische Sendeliste aufgenommen werden`);
  return startPlaylist(playlist.id, detail.id, log);
}

export async function autopilotOnce(log: Log) {
  const config = await getAutopilotConfig();
  if (!config.enabled) return null;
  return withAutopilotLock(async () => {
    if (await activeBroadcastRun()) return null;
    const [articles, activeSources] = await Promise.all([listArticles(config.scanLimit), activeSourceIds()]);
    const configuredSourceIds = new Set(config.sourceIds);
    const candidates = articles.filter((article) =>
      isAutopilotCandidate(article, config.minimumTrust, configuredSourceIds, activeSources),
    );
    if (!candidates.length) return null;
    if (!(await streamIsReady(config.requireStream))) {
      log('autopilot_waiting', { reason: 'stream-inactive', candidates: candidates.length });
      return null;
    }
    for (const article of candidates) {
      const result = await prepareAndStart(article, log);
      if (result) return result;
    }
    return null;
  });
}
