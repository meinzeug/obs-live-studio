import Fastify from 'fastify';
import { createHash, randomBytes } from 'node:crypto';
import { readFile } from 'node:fs/promises';
import { resolve as resolvePath } from 'node:path';
import helmet from '@fastify/helmet';
import cors from '@fastify/cors';
import rateLimit from '@fastify/rate-limit';
import websocket from '@fastify/websocket';
import multipart from '@fastify/multipart';
import cookie from '@fastify/cookie';
import dotenv from 'dotenv';
import { z } from 'zod';
import { parseFeed, parseHtmlArticle } from '@ans/news-parser';
import { combineEditorialWarnings, summarize, makeScript } from '@ans/content-processing';
import { improveOverlayCopy, planBroadcast, prepareEditorialArticle, suggestSourceSettings } from '@ans/ai-provider';
import { assertPublicHttpUrl, maskSecret } from '@ans/security';
import { fetchHttpText } from '@ans/source-connectors';
import {
  createSource,
  dashboardStats,
  getArticleDetail,
  getPublishedMainArticle,
  getLastPlayedArticle,
  listArticles,
  listSources,
  recordSourceCheck,
  saveArticlePackage,
  saveAudioAsset,
  setArticleStatus,
  setSourceActive,
  updateSource,
  getPlaybackState,
  getPlaybackSnapshot,
  setSetting,
  createOverlayProject,
  listOverlayProjects,
  getOverlayProject,
  latestOverlayDraft,
  overlayVersions,
  updateOverlayDraft,
  publishOverlayVersion,
  rollbackOverlay,
  duplicateOverlayProject,
  deleteOverlayProject,
  getPublishedOverlay,
  listMediaAssets,
  getMediaAsset,
  linkMedia,
  findPublishedOverlayByTokenHash,
  createMediaAssetWithDerivatives,
  listMediaUsage,
  createBroadcastPlaylist,
  createBroadcastPlaylistWithArticles,
  listBroadcastPlaylists,
  getBroadcastPlaylist,
  updateBroadcastPlaylist,
  deleteBroadcastPlaylist as removeBroadcastPlaylist,
  listBroadcastItems,
  listBroadcastCandidateArticles,
  addBroadcastItem,
  removeBroadcastItem,
  reorderBroadcastItems,
  activeBroadcastRun,
  recoverActiveBroadcastRuns,
  appendLiveEvent,
  createBroadcastCommand,
  getBroadcastCommand,
  listBroadcastCommands,
  getRunnerLease,
  requestBroadcastStart,
  requestBroadcastRecoveryOperation,
  ensureOverlayPublicIdentity,
  rotateOverlayPublicToken,
  rememberObsOverlaySource,
  publishedMainOverlayUrl,
  isPublicMediaInPublishedOverlay,
  getAutopilotConfig,
  setAutopilotConfig,
} from '@ans/database';
import { MAINTENANCE_SCENE, ObsController, type PlaybackState } from '@ans/obs-controller';
import { createTemplate, validateOverlayDocument } from '@ans/overlay-engine';
import { cacheHeaders, storeUploadedImage } from '@ans/media-engine';
import { validateTransition } from '@ans/broadcast-engine';
import { LiveEventBus } from './liveEventBus.js';
import { registerAuth, requirePermission } from './auth.js';
import { installArticleMediaRoutes } from './article-media-routes.js';
import { apiError, installApiErrorHandler } from './error-handler.js';
import { boundedRuntimeNumber } from './runtime-values.js';
import { resolveMultipartLimits } from './multipart-limits.js';
import { installUuidRouteParamValidation } from './route-params.js';
import { BackupManager, registerBackupManagementRoutes } from './backup-management.js';
import { StreamTargetSettingsManager, registerStreamTargetSettingsRoutes } from './stream-target-settings.js';
import { generateTtsAudio } from './tts-generation.js';
import { AiSettingsManager, registerAiSettingsRoutes } from './ai-settings.js';
import { MediaSettingsManager, registerMediaSettingsRoutes } from './media-settings.js';
import { prepareRunningObsForConfiguration } from './obs-configuration-preparation.js';
import { broadcastStartErrorStatus } from './broadcast-start-errors.js';
import {
  obsProcessStatus,
  startObsProcess,
  stopObsProcess,
  restartObsProcess,
  resetObsYouTubeAuth,
} from './desktop-agent-client.js';
import { PROJECT_ROOT } from './project-root.js';
dotenv.config({ path: resolvePath(PROJECT_ROOT, '.env') });
const app = Fastify({ logger: true });
installApiErrorHandler(app);
const liveEventBus = new LiveEventBus();
await liveEventBus.start();
function tokenHash(token: string) {
  return createHash('sha256').update(token).digest('hex');
}
function eventCursor(value: unknown) {
  const parsed = Number(value ?? 0);
  return Number.isSafeInteger(parsed) && parsed >= 0 ? parsed : 0;
}
await app.register(helmet, { contentSecurityPolicy: false });
await app.register(cors, { origin: true, credentials: true });
const configuredRateLimit = Number(process.env.RATE_LIMIT_MAX ?? 600);
await app.register(rateLimit, {
  max: Number.isFinite(configuredRateLimit) ? Math.max(1, Math.min(100_000, Math.floor(configuredRateLimit))) : 600,
  timeWindow: '1 minute',
});
const configuredAiRateLimit = Number(process.env.OPENROUTER_RATE_LIMIT_PER_MINUTE ?? 30);
const aiCompletionRouteOptions = {
  config: {
    rateLimit: {
      max: Number.isFinite(configuredAiRateLimit) ? Math.max(1, Math.min(120, Math.floor(configuredAiRateLimit))) : 30,
      timeWindow: '1 minute',
    },
  },
};
await app.register(websocket);
await app.register(multipart, { limits: resolveMultipartLimits(process.env) });
await app.register(cookie);
await registerAuth(app);
installUuidRouteParamValidation(app);
installArticleMediaRoutes(app);
registerBackupManagementRoutes(app, new BackupManager(), requirePermission);
registerAiSettingsRoutes(app, new AiSettingsManager(), requirePermission);
registerMediaSettingsRoutes(app, new MediaSettingsManager(), requirePermission);
function isLocalTestFeed(raw: string) {
  const url = new URL(raw);
  return (
    ['127.0.0.1', 'localhost'].includes(url.hostname) &&
    url.port === String(process.env.APP_PORT ?? 12000) &&
    url.pathname === '/test-feed.xml'
  );
}
const allowPrivate = process.env.ALLOW_PRIVATE_SOURCES === 'true';
function streamProfile() {
  return {
    channelName: process.env.CHANNEL_NAME ?? 'ArgumentationsKette',
    channelUrl: process.env.CHANNEL_URL ?? process.env.YOUTUBE_CHANNEL_URL ?? '',
    service: process.env.STREAM_SERVICE ?? 'custom',
    server: process.env.STREAM_SERVER ?? '',
    streamKey: process.env.STREAM_KEY ? maskSecret(process.env.STREAM_KEY) : '',
  };
}
const startupRun = await activeBroadcastRun();
const startupLease = startupRun ? await getRunnerLease(startupRun.id) : null;
const startupRunnerActive = Boolean(
  startupLease?.lease_expires_at && new Date(startupLease.lease_expires_at).getTime() > Date.now(),
);
const recoveredRun =
  startupRun && !startupRunnerActive
    ? await recoverActiveBroadcastRuns(process.env.BROADCAST_RESTORE_MODE === 'interrupt' ? 'interrupt' : 'resume')
    : null;
const obs = new ObsController({
  host: process.env.OBS_HOST ?? '127.0.0.1',
  port: Number(process.env.OBS_PORT ?? 4455),
  password: process.env.OBS_PASSWORD,
  overlayUrl: process.env.PUBLIC_OVERLAY_URL,
  streamStartTimeoutMs: Number(process.env.STREAM_START_TIMEOUT_MS ?? 15_000),
});
let streamSupervisorPaused = false;
let streamSupervisorRunning = false;
registerStreamTargetSettingsRoutes(
  app,
  new StreamTargetSettingsManager({
    beforeApply: async () => {
      const previousSupervisorPaused = streamSupervisorPaused;
      streamSupervisorPaused = true;
      try {
        if (streamSupervisorRunning) {
          throw Object.assign(new Error('Die automatische Streamsteuerung ist gerade aktiv. Bitte erneut versuchen.'), {
            statusCode: 409,
          });
        }
        const processStatus = (await obsProcessStatus()) as { state?: string };
        if (processStatus.state === 'unavailable') {
          throw Object.assign(
            new Error(
              'Streaming-Ziele können erst angewendet werden, wenn der OBS-Desktop-Agent wieder erreichbar ist.',
            ),
            { statusCode: 503 },
          );
        }
        if (processStatus.state === 'starting') {
          throw Object.assign(new Error('OBS wird gerade gestartet. Bitte erneut versuchen.'), { statusCode: 409 });
        }
        const wasRunning = processStatus.state === 'running';
        let authenticationRecovered = false;
        if (wasRunning) {
          const preparation = await prepareRunningObsForConfiguration({
            getStreamStatus: () => obs.getStreamStatus(),
            reconnect: () => obs.ensureConnectedWithRetry(3),
            disconnect: () => obs.disconnect(),
            stopProcess: () => stopObsProcess(),
          });
          authenticationRecovered = preparation.authenticationRecovered;
          if (authenticationRecovered) {
            app.log.warn('OBS-WebSocket-Passwort wird beim Speichern der Streaming-Ziele neu synchronisiert');
          }
        }
        return { wasRunning, previousSupervisorPaused, authenticationRecovered };
      } catch (error) {
        streamSupervisorPaused = previousSupervisorPaused;
        throw error;
      }
    },
    afterApply: async (context) => {
      const state = context as { wasRunning: boolean; previousSupervisorPaused: boolean };
      try {
        if (state.wasRunning) {
          await startObsProcess();
          void obs.ensureConnectedWithRetry(30).catch((error) => {
            app.log.warn({ error }, 'OBS wurde neu gestartet, die WebSocket-Verbindung ist noch nicht bereit');
          });
        }
      } finally {
        streamSupervisorPaused = state.previousSupervisorPaused;
      }
    },
  }),
  requirePermission,
);
const ttsEngine = (process.env.TTS_ENGINE ?? 'piper').toLowerCase();
const piperModelPath = process.env.PIPER_MODEL_PATH ?? process.env.TTS_MODEL_PATH;
let streamSupervisorFailures = 0;
let streamSupervisorLastError: string | null = null;
let streamSupervisorNextAttemptAt: number | null = null;
const streamSupervisorIntervalMs = boundedRuntimeNumber(
  process.env.STREAM_SUPERVISOR_INTERVAL_MS,
  15_000,
  1000,
  300_000,
);
const streamSupervisorMaxBackoffMs = boundedRuntimeNumber(
  process.env.STREAM_SUPERVISOR_MAX_BACKOFF_MS,
  300_000,
  streamSupervisorIntervalMs,
  3_600_000,
);

function resetStreamSupervisorFailures() {
  streamSupervisorFailures = 0;
  streamSupervisorLastError = null;
  streamSupervisorNextAttemptAt = null;
}
function isTtsConfigured() {
  return ttsEngine === 'espeak-ng' || ttsEngine === 'espeak' || Boolean(piperModelPath);
}
function publicBaseUrl() {
  return (
    process.env.PUBLIC_APP_URL ??
    `http://${process.env.APP_PUBLIC_HOST ?? '127.0.0.1'}:${process.env.APP_PORT ?? 12000}`
  );
}
async function overlayUrl() {
  const published = await publishedMainOverlayUrl();
  if (published) return published.startsWith('http') ? published : `${publicBaseUrl()}${published}`;
  throw new Error('Kein veröffentlichtes Hauptnachrichten-Overlay mit öffentlicher Live-URL vorhanden');
}
async function restorePublishedOverlays() {
  const restored: Array<{ template: string; sceneName: string; inputName: string; url: string }> = [];
  for (const template of ['main-news', 'breaking-news', 'lower-third', 'ticker', 'maintenance', 'fullscreen-graphic']) {
    const published = await getPublishedOverlay(template);
    if (!published?.public_url || !published?.version_id) continue;
    const url = published.public_url.startsWith('http')
      ? published.public_url
      : `${publicBaseUrl()}${published.public_url}`;
    const target = await obs.ensureBrowserOverlay({
      template,
      url,
      width: published.width,
      height: published.height,
    });
    await rememberObsOverlaySource({
      projectId: published.id,
      sceneName: target.sceneName,
      inputName: target.inputName,
      url,
      versionId: published.version_id,
      width: published.width,
      height: published.height,
    });
    restored.push({ template, ...target, url });
  }
  return restored;
}
function makeOverlayPublicUrl(token: string, template: string) {
  return `${publicBaseUrl()}/overlay/live/${encodeURIComponent(token)}/${encodeURIComponent(template)}`;
}
if (recoveredRun && process.env.BROADCAST_RESTORE_MODE === 'resume') {
  await requestBroadcastRecoveryOperation({
    broadcastRunId: recoveredRun.id,
    reason: 'api-startup-recovery',
    operationType: 'recover',
  }).catch(() => undefined);
}
const sourceSchema = z.object({
  name: z.string().min(1),
  url: z.string().url(),
  type: z.enum(['rss', 'atom', 'feed', 'website']).default('rss'),
  category: z.string().optional().nullable(),
  region: z.string().optional().nullable(),
  language: z.string().default('de'),
  description: z.string().optional().nullable(),
  priority: z.number().int().default(0),
  trustLevel: z.number().int().min(0).max(100).default(50),
  fetchIntervalSeconds: z.number().int().min(60).max(86400).default(900),
  maxArticles: z.number().int().min(1).max(100).default(20),
  maxFetchSeconds: z.number().int().min(1).max(60).default(20),
  active: z.boolean().default(true),
  userAgent: z.string().optional().nullable(),
});
function publicArticle(a: any) {
  const publishedAt = a?.published_at ?? a?.fetched_at ?? null;
  return a
    ? {
        id: a.id,
        title: a.title,
        summary: a.summary ?? a.excerpt ?? '',
        source: a.source_name ?? 'Quelle',
        category: a.category ?? '',
        region: a.region ?? '',
        publishedAt,
        publishedDate: publishedAt
          ? new Date(publishedAt).toLocaleDateString('de-DE', { day: '2-digit', month: '2-digit', year: 'numeric' })
          : '',
        status: a.status,
        updatedAt: a.fetched_at,
        audioPath: a.audio_path,
        durationSeconds: a.audio_duration_seconds,
      }
    : null;
}
app.get('/health', async () => ({
  status: 'online',
  components: {
    backend: 'online',
    database: process.env.DATABASE_URL ? 'configured' : 'not_configured',
    worker: 'separate_process',
    obs: obs.getState().status,
    tts: isTtsConfigured() ? `configured:${ttsEngine}` : 'optional',
  },
  time: new Date().toISOString(),
}));
app.get('/test-feed.xml', async (_req, reply) =>
  reply
    .type('application/rss+xml')
    .send(
      `<?xml version="1.0"?><rss version="2.0"><channel><title>ArgumentationsKette Studiofeed</title><item><title>ArgumentationsKette ist auf Sendung</title><link>http://127.0.0.1:${process.env.APP_PORT ?? 12000}/test/articles/on-air</link><guid>argumentationskette-on-air</guid><pubDate>Sun, 12 Jul 2026 22:00:00 GMT</pubDate><description>Willkommen bei ArgumentationsKette. Das automatisierte Studio verbindet Nachrichten, Einordnung und nachvollziehbare Argumente in einer fortlaufenden Live-Sendung. Die technische Sendekette arbeitet lokal mit redaktioneller Quellenverwaltung, deutscher Sprachausgabe und einer direkten YouTube-Übertragung.</description></item></channel></rss>`,
    ),
);
app.get('/test/articles/on-air', async (_req, reply) =>
  reply.type('text/html; charset=utf-8').send(`<!doctype html>
<html lang="de"><head><meta charset="utf-8"><title>ArgumentationsKette ist auf Sendung</title></head>
<body><main><article><h1>ArgumentationsKette ist auf Sendung</h1>
<p>Willkommen bei ArgumentationsKette. Das automatisierte Studio verbindet Nachrichten, Einordnung und nachvollziehbare Argumente in einer fortlaufenden Live-Sendung.</p>
<p>Die technische Sendekette arbeitet lokal mit redaktioneller Quellenverwaltung, deutscher Sprachausgabe und einer direkten YouTube-Übertragung.</p>
</article></main></body></html>`),
);
app.get('/api/dashboard', async () => {
  const c = await dashboardStats();
  const a = await listArticles(1);
  const automation = await getAutopilotConfig();
  const playback = await getPlaybackSnapshot();
  const currentArticle = playback?.articleId
    ? await getArticleDetail(playback.articleId)
    : ((await getLastPlayedArticle()) ?? a[0]);
  return {
    status: 'Bereit',
    counts: {
      newArticles: c.new_articles,
      approved: c.approved,
      planned: c.planned,
      discarded: c.discarded,
      failedSources: c.failed_sources,
    },
    current: {
      item: currentArticle?.title ?? 'Keine Nachricht geladen',
      next: 'Keine Sendeliste geplant',
      scene: 'Hauptnachrichten-Overlay',
    },
    obs: obs.getState(),
    stream: await obs.getStreamStatus().catch(() => null),
    automation,
    playback,
    actions: ['test-contribution'],
  };
});
app.get('/api/autopilot', async () => getAutopilotConfig());
app.post('/api/autopilot', async (req, reply) => {
  requirePermission(req, reply, 'broadcast:write');
  const current = await getAutopilotConfig();
  const update = z
    .object({
      enabled: z.boolean().optional(),
      minimumTrust: z.number().int().min(0).max(100).optional(),
      requireStream: z.boolean().optional(),
      requireVideo: z.boolean().optional(),
      showItemCount: z.number().int().min(1).max(20).optional(),
      pauseSeconds: z.number().int().min(0).max(600).optional(),
      pauseBetweenShowsSeconds: z.number().int().min(0).max(3600).optional(),
      sourceIds: z.array(z.string().uuid()).optional(),
      scanLimit: z.number().int().min(1).max(500).optional(),
    })
    .parse(req.body ?? {});
  return setAutopilotConfig({ ...current, ...update });
});
app.get('/api/sources', async () => listSources());
app.post('/api/sources', async (req, reply) => {
  requirePermission(req, reply, 'sources:write');
  const body = sourceSchema.parse(req.body);
  await assertPublicHttpUrl(body.url, allowPrivate || isLocalTestFeed(body.url));
  return createSource(body);
});
app.put('/api/sources/:id', async (req, reply) => {
  requirePermission(req, reply, 'sources:write');
  return updateSource((req.params as any).id, sourceSchema.partial().parse(req.body));
});
app.post('/api/sources/:id/active', async (req, reply) => {
  requirePermission(req, reply, 'sources:write');
  const { active } = z.object({ active: z.boolean() }).parse(req.body);
  return setSourceActive((req.params as any).id, active);
});
app.post('/api/sources/test', async (req, reply) => {
  requirePermission(req, reply, 'sources:write');
  const body = z.object({ url: z.string().url(), maxFetchSeconds: z.number().optional() }).parse(req.body);
  const res = await fetchHttpText(body.url, {
    timeoutMs: (body.maxFetchSeconds ?? 10) * 1000,
    maxBytes: 512 * 1024,
    allowPrivate: allowPrivate || isLocalTestFeed(body.url),
    userAgent: process.env.NEWS_USER_AGENT,
  });
  const detected =
    res.contentType.includes('xml') || /<(rss|feed)\b/i.test(res.body.slice(0, 300)) ? 'feed' : 'website';
  const preview =
    detected === 'feed' ? parseFeed(res.body, res.url).slice(0, 5) : [parseHtmlArticle(res.body, res.url)];
  await recordSourceCheck(null, 'ok', { url: body.url, detected, status: res.status });
  return {
    detected,
    status: res.status,
    finalUrl: res.url,
    preview,
    etag: res.etag,
    lastModified: res.lastModified,
    paywallSuspected: /paywall|subscribe|abo/i.test(res.body),
    javascriptLikely: /__NEXT_DATA__|window\.__|app-root/i.test(res.body),
  };
});
app.post('/api/ai/source-suggestion', aiCompletionRouteOptions, async (req, reply) => {
  requirePermission(req, reply, 'sources:write');
  const body = z
    .object({
      url: z.string().url(),
      name: z.string().max(120).optional(),
      detectedType: z.string().max(30).optional(),
      preview: z
        .array(
          z.object({
            title: z.string().max(500).optional(),
            excerpt: z.string().max(2000).optional(),
            url: z.string().max(2000).optional(),
          }),
        )
        .max(5)
        .optional(),
    })
    .strict()
    .parse(req.body);
  return suggestSourceSettings(body);
});
app.get('/api/articles', async (req) => {
  const { limit } = z.object({ limit: z.coerce.number().int().min(1).max(500).default(100) }).parse(req.query ?? {});
  return listArticles(limit);
});
app.get('/api/articles/:id', async (req) => {
  const article = await getArticleDetail((req.params as any).id);
  if (!article) throw Object.assign(new Error('Artikel nicht gefunden'), { statusCode: 404 });
  return article;
});
async function processArticle(article: NonNullable<Awaited<ReturnType<typeof getArticleDetail>>>) {
  const text = article.main_text ?? article.excerpt ?? article.title;
  const summary = summarize(text);
  const script = makeScript(article.title, summary, article.source_name ?? 'der Quelle');
  await saveArticlePackage(article.id, summary, script, summary, `${article.title}: ${summary}`);
  return (await getArticleDetail(article.id)) ?? article;
}
async function processArticleWithAi(article: NonNullable<Awaited<ReturnType<typeof getArticleDetail>>>) {
  const sourceText = article.main_text ?? article.excerpt ?? article.title;
  const result = await prepareEditorialArticle({
    title: article.title,
    text: sourceText,
    source: article.source_name ?? 'Unbekannte Quelle',
    sourceUrl: article.canonical_url ?? article.url,
    publishedAt: article.published_at,
    category: article.category,
    region: article.region,
    existingWarnings: combineEditorialWarnings(article.title, sourceText),
    channelName: process.env.CHANNEL_NAME ?? 'Studio',
  });
  const output = result.output;
  const warnings = combineEditorialWarnings(article.title, sourceText, output.riskFlags);
  await saveArticlePackage(article.id, output.summary, output.speakerScript, output.screenText, output.tickerText, {
    sourcePassages: [
      JSON.stringify({ kind: 'rewritten-headline', text: output.rewrittenHeadline }),
      JSON.stringify({ kind: 'context', text: output.context }),
      ...output.keyPoints.map((text) => JSON.stringify({ kind: 'key-point', text })),
      ...output.uncertainties.map((text) => JSON.stringify({ kind: 'uncertainty', text })),
      ...output.riskFlags.map((text) => JSON.stringify({ kind: 'risk-flag', text })),
    ],
    modelName: 'openrouter',
    modelVersion: result.model,
    promptVersion: 'editorial-openrouter-v1',
    category: output.category,
    warnings,
  });
  return {
    ...((await getArticleDetail(article.id)) ?? article),
    ai: { model: result.model, tier: result.tier, usage: result.usage },
  };
}
app.post('/api/articles/:id/process', async (req, reply) => {
  requirePermission(req, reply, 'articles:write');
  const a = await getArticleDetail((req.params as any).id);
  if (!a) throw Object.assign(new Error('Artikel nicht gefunden'), { statusCode: 404 });
  return processArticle(a);
});
app.post('/api/articles/:id/ai', aiCompletionRouteOptions, async (req, reply) => {
  requirePermission(req, reply, 'articles:write');
  const article = await getArticleDetail((req.params as any).id);
  if (!article) throw Object.assign(new Error('Artikel nicht gefunden'), { statusCode: 404 });
  return processArticleWithAi(article);
});
app.post('/api/articles/:id/status', async (req, reply) => {
  requirePermission(req, reply, 'articles:write');
  const { status } = z
    .object({ status: z.enum(['new', 'review', 'approved', 'blocked', 'published', 'discarded']) })
    .parse(req.body);
  const article = await setArticleStatus((req.params as any).id, status);
  if (!article) throw apiError(404, 'Artikel nicht gefunden');
  return article;
});
app.post('/api/articles/:id/tts', async (req, reply) => {
  requirePermission(req, reply, 'articles:write');
  let a = await getArticleDetail((req.params as any).id);
  if (!a) throw Object.assign(new Error('Artikel nicht gefunden'), { statusCode: 404 });
  if (!a.script_text?.trim()) {
    try {
      a = await processArticleWithAi(a);
    } catch (error) {
      req.log.warn(
        { err: error, articleId: a.id },
        'KI-Aufbereitung für TTS fehlgeschlagen; Regel-Fallback wird verwendet',
      );
      a = await processArticle(a);
    }
  }
  if (!a.script_text?.trim()) {
    throw new Error('Der Sprechertext konnte nicht vorbereitet werden.');
  }
  const out = await generateTtsAudio(a.script_text);
  await saveAudioAsset(a.id, out.file, out.durationSeconds);
  return out;
});
app.get('/api/overlay/main', async () => {
  const published = await getPublishedOverlay('main-news');
  const playback = await getPlaybackState<any>();
  const article = playback?.articleId ? await getArticleDetail(playback.articleId) : null;
  return {
    article: publicArticle(article),
    playback,
    overlay: published?.snapshot ?? null,
    versionId: published?.version_id ?? null,
    serverTime: new Date().toISOString(),
  };
});

const mediaDir = process.env.MEDIA_UPLOAD_DIR ?? 'generated/media';
const overlayProjectSchema = z.object({
  name: z.string().min(1),
  template: z
    .enum(['main-news', 'breaking-news', 'lower-third', 'ticker', 'maintenance', 'fullscreen-graphic'])
    .default('main-news'),
  width: z.union([z.literal(1920), z.literal(1080)]).default(1920),
  height: z.union([z.literal(1080), z.literal(1920)]).default(1080),
});
app.get('/api/overlays', async () => listOverlayProjects());
app.post('/api/overlays', async (req, reply) => {
  requirePermission(req, reply, 'obs:write');
  const b = overlayProjectSchema.parse(req.body);
  const snapshot = createTemplate(b.template, b.width, b.height);
  const p = await createOverlayProject({ ...b, snapshot, userId: req.user?.id });
  return { project: p, draft: await latestOverlayDraft(p.id) };
});
app.get('/api/overlays/:id', async (req) => {
  const id = (req.params as any).id;
  const project = await getOverlayProject(id);
  if (!project) throw apiError(404, 'Overlay-Projekt nicht gefunden');
  return {
    project,
    draft: await latestOverlayDraft(id),
    versions: await overlayVersions(id),
  };
});
app.put('/api/overlays/:id/draft', async (req, reply) => {
  requirePermission(req, reply, 'obs:write');
  const doc = validateOverlayDocument(req.body);
  const p = await updateOverlayDraft((req.params as any).id, doc, req.user?.id);
  return { project: p, draft: await latestOverlayDraft(p.id) };
});
app.post('/api/overlays/:id/publish', async (req, reply) => {
  requirePermission(req, reply, 'obs:write');
  const b = z.object({ versionId: z.string().uuid(), description: z.string().optional() }).parse(req.body);
  const projectId = (req.params as any).id;
  const project = await getOverlayProject(projectId);
  if (!project) throw apiError(404, 'Overlay-Projekt nicht gefunden');
  let publicUrl = (project as any).public_url as string | undefined;
  if (!publicUrl) {
    const publicToken = randomBytes(32).toString('base64url');
    publicUrl = makeOverlayPublicUrl(publicToken, project.template);
    await ensureOverlayPublicIdentity(projectId, tokenHash(publicToken), publicUrl, randomBytes(12).toString('hex'));
  }
  const target = await obs.ensureBrowserOverlay({
    template: project.template,
    url: publicUrl,
    width: project.width,
    height: project.height,
  });
  const v = await publishOverlayVersion(projectId, b.versionId, req.user?.id);
  await rememberObsOverlaySource({
    projectId,
    sceneName: target.sceneName,
    inputName: target.inputName,
    url: publicUrl,
    versionId: v.id,
    width: project.width,
    height: project.height,
  });
  await appendLiveEvent({
    type: 'overlay-published',
    overlayVersionId: v.id,
    payload: { projectId, versionId: v.id, publicUrl, template: project.template },
    dedupeKey: `overlay-published:${v.id}`,
  });
  return { ok: true, version: v, publicUrl };
});

app.post('/api/overlays/:id/rotate-token', async (req, reply) => {
  requirePermission(req, reply, 'users:write');
  const project = await getOverlayProject((req.params as any).id);
  if (!project) throw apiError(404, 'Overlay-Projekt nicht gefunden');
  const publicToken = randomBytes(32).toString('base64url');
  const publicUrl = makeOverlayPublicUrl(publicToken, project.template);
  const updated = await rotateOverlayPublicToken(project.id, tokenHash(publicToken), publicUrl);
  const published = await getPublishedOverlay(project.template);
  if (published?.version_id) {
    const target = await obs.ensureBrowserOverlay({
      template: project.template,
      url: publicUrl,
      width: project.width,
      height: project.height,
    });
    await rememberObsOverlaySource({
      projectId: project.id,
      sceneName: target.sceneName,
      inputName: target.inputName,
      url: publicUrl,
      versionId: published.version_id,
      width: project.width,
      height: project.height,
    });
  }
  await appendLiveEvent({
    type: 'overlay-version-changed',
    payload: { projectId: project.id, reason: 'token-rotated' },
    dedupeKey: `overlay-token-rotated:${project.id}:${Date.now()}`,
  });
  return { ok: true, project: updated, publicUrl };
});
app.post('/api/overlays/:id/reset-template', async (req, reply) => {
  requirePermission(req, reply, 'obs:write');
  const project = await getOverlayProject((req.params as any).id);
  if (!project) throw apiError(404, 'Overlay-Projekt nicht gefunden');
  const snapshot = createTemplate(project.template as any, project.width, project.height);
  const updated = await updateOverlayDraft(project.id, snapshot, req.user?.id);
  return { project: updated, draft: await latestOverlayDraft(project.id) };
});
app.post('/api/overlays/:id/rollback', async (req, reply) => {
  requirePermission(req, reply, 'obs:write');
  const b = z.object({ versionId: z.string().uuid() }).parse(req.body);
  return { project: await rollbackOverlay((req.params as any).id, b.versionId, req.user?.id) };
});
app.post('/api/overlays/:id/duplicate', async (req, reply) => {
  requirePermission(req, reply, 'obs:write');
  return duplicateOverlayProject((req.params as any).id, req.user?.id);
});
app.delete('/api/overlays/:id', async (req, reply) => {
  requirePermission(req, reply, 'obs:write');
  await deleteOverlayProject((req.params as any).id);
  return { ok: true };
});
app.get('/api/overlays/:id/preview', async (req) => {
  const id = (req.params as any).id;
  const project = await getOverlayProject(id);
  if (!project) throw apiError(404, 'Overlay-Projekt nicht gefunden');
  return {
    project,
    draft: await latestOverlayDraft(id),
    playback: await getPlaybackState(),
    serverTime: new Date().toISOString(),
  };
});
app.post('/api/ai/overlay-copy', aiCompletionRouteOptions, async (req, reply) => {
  requirePermission(req, reply, 'obs:write');
  const body = z
    .object({
      text: z.string().min(1).max(1000),
      elementName: z.string().max(120).optional(),
      binding: z.string().max(120).optional(),
      template: z.string().max(120).optional(),
    })
    .strict()
    .parse(req.body);
  return improveOverlayCopy(body);
});
app.get('/api/media', async (req) => listMediaAssets(String((req.query as any).q ?? '')));
app.post('/api/media', async (req, reply) => {
  requirePermission(req, reply, 'articles:write');
  const file = await req.file();
  if (!file) throw new Error('Datei fehlt');
  const stored = await storeUploadedImage({
    stream: file.file,
    filename: file.filename,
    declaredMime: file.mimetype,
    directory: mediaDir,
  });
  const fields = file.fields as Record<string, any>;
  const media = await createMediaAssetWithDerivatives({
    filename: file.filename,
    mimeType: stored.mime,
    sizeBytes: stored.size,
    storagePath: stored.originalPath,
    sha256: stored.sha256,
    author: fields.author?.value,
    source: fields.source?.value,
    licenseName: fields.license?.value,
    attribution: fields.attribution?.value,
    metadata: { width: stored.width, height: stored.height, format: stored.format },
    derivativePaths: Object.fromEntries(
      stored.derivatives.map((d) => [
        d.label,
        { path: d.path, width: d.width, height: d.height, mime: d.mime, sizeBytes: d.sizeBytes },
      ]),
    ),
  });
  await appendLiveEvent({
    type: 'media-derivative-updated',
    payload: { mediaId: media.id },
    dedupeKey: `media-updated:${media.id}:${Date.now()}`,
  });
  return media;
});
app.post('/api/media/:id/link', async (req, reply) => {
  requirePermission(req, reply, 'articles:write');
  const b = z
    .object({
      articleId: z.string().uuid().optional(),
      overlayProjectId: z.string().uuid().optional(),
      purpose: z.string().default('attachment'),
    })
    .parse(req.body);
  return linkMedia((req.params as any).id, b.articleId, b.overlayProjectId, b.purpose);
});
app.get('/api/media/:id/usage', async (req) => listMediaUsage((req.params as any).id));
app.get('/media/:id', async (req, reply) => {
  if (!(req as any).user) throw apiError(401, 'Authentifizierung erforderlich');
  const m = await getMediaAsset((req.params as any).id);
  if (!m?.storage_path) throw apiError(404, 'Medium nicht gefunden');
  const buf = await readFile(m.storage_path);
  reply.headers(cacheHeaders(m.mime_type, true)).send(buf);
});
app.get('/media/:id/derivatives/:label', async (req, reply) => {
  const mediaId = (req.params as any).id;
  if (!(req as any).user && !(await isPublicMediaInPublishedOverlay(mediaId)))
    throw apiError(403, 'Medium ist nicht öffentlich veröffentlicht');
  const m = await getMediaAsset(mediaId);
  const label = (req.params as any).label;
  const derivative = m?.derivative_paths?.[label];
  if (!derivative?.path) throw apiError(404, 'Ableitung nicht gefunden');
  const buf = await readFile(derivative.path);
  reply.headers(cacheHeaders(derivative.mime ?? 'image/webp')).send(buf);
});

const playlistSettingsSchema = z
  .object({
    pauseSeconds: z.number().int().min(0).max(600).default(5),
    transition: z.enum(['clean', 'fade', 'headline', 'bumper']).default('fade'),
    repeatPolicy: z.enum(['none', 'recent-published', 'loop']).default('recent-published'),
    targetRuntimeMinutes: z.number().int().min(1).max(24 * 60).default(30),
    notes: z.string().max(2000).optional(),
  })
  .partial()
  .default({});
const playlistBodySchema = z
  .object({
    name: z.string().trim().min(1).max(160).default('Sendeliste'),
    description: z.string().trim().max(2000).optional().nullable(),
    scheduledAt: z.string().datetime().optional().nullable(),
    kind: z.enum(['playlist', 'show', 'hour', 'special']).default('show'),
    overlayProjectId: z.string().uuid().optional().nullable(),
    articleIds: z.array(z.string().uuid()).max(50).default([]),
    settings: playlistSettingsSchema,
  })
  .strict();
app.get('/api/broadcast/articles', async (req) => {
  const { limit } = z.object({ limit: z.coerce.number().int().min(1).max(500).default(120) }).parse(req.query ?? {});
  return listBroadcastCandidateArticles(limit);
});
app.get('/api/broadcast/playlists', async () => listBroadcastPlaylists());
app.post('/api/broadcast/playlists', async (req, reply) => {
  requirePermission(req, reply, 'broadcast:write');
  const body = playlistBodySchema.parse(req.body ?? {});
  if (body.articleIds.length) {
    return createBroadcastPlaylistWithArticles(body.name, body.articleIds, {
      description: body.description,
      scheduledAt: body.scheduledAt,
      kind: body.kind,
      overlayProjectId: body.overlayProjectId,
      settings: body.settings,
    });
  }
  return createBroadcastPlaylist(body.name, {
    description: body.description,
    scheduledAt: body.scheduledAt,
    kind: body.kind,
    overlayProjectId: body.overlayProjectId,
    settings: body.settings,
  });
});
app.post('/api/ai/broadcast-plan', aiCompletionRouteOptions, async (req, reply) => {
  requirePermission(req, reply, 'broadcast:write');
  const { maximumItems } = z.object({ maximumItems: z.number().int().min(1).max(16).default(8) }).parse(req.body ?? {});
  const candidates = (await listArticles(60)).filter((article) => ['approved', 'published'].includes(article.status));
  if (!candidates.length) {
    throw Object.assign(new Error('Für eine KI-Sendeliste sind freigegebene Beiträge erforderlich.'), {
      statusCode: 409,
    });
  }
  const result = await planBroadcast({
    channelName: process.env.CHANNEL_NAME ?? 'Studio',
    maximumItems,
    articles: candidates.map((article) => ({
      id: article.id,
      title: article.title,
      excerpt: article.excerpt,
      category: article.category,
      region: article.region,
      source: article.source_name,
      trustScore: article.trust_score,
      publishedAt: article.published_at,
    })),
  });
  const allowedIds = new Set(candidates.map((article) => article.id));
  const articleIds = [...new Set(result.output.articleIds)].filter((id) => allowedIds.has(id)).slice(0, maximumItems);
  if (!articleIds.length)
    throw Object.assign(new Error('Die KI hat keine gültigen Beiträge ausgewählt.'), { statusCode: 502 });
  const { playlist, items } = await createBroadcastPlaylistWithArticles(result.output.name, articleIds);
  return {
    playlist,
    items,
    rationale: result.output.rationale,
    ai: { model: result.model, tier: result.tier, usage: result.usage },
  };
});
app.get('/api/broadcast/playlists/:id', async (req) => {
  const id = (req.params as any).id;
  const playlist = await getBroadcastPlaylist(id);
  if (!playlist) throw apiError(404, 'Sendeliste nicht gefunden');
  return { playlist, items: await listBroadcastItems(id) };
});
app.put('/api/broadcast/playlists/:id', async (req, reply) => {
  requirePermission(req, reply, 'broadcast:write');
  const body = playlistBodySchema.partial().parse(req.body ?? {});
  const playlist = await updateBroadcastPlaylist((req.params as any).id, {
    name: body.name,
    description: body.description,
    scheduledAt: body.scheduledAt,
    kind: body.kind,
    overlayProjectId: body.overlayProjectId,
    settings: body.settings,
  });
  return { playlist, items: await listBroadcastItems((req.params as any).id) };
});
app.delete('/api/broadcast/playlists/:id', async (req, reply) => {
  requirePermission(req, reply, 'broadcast:write');
  await removeBroadcastPlaylist((req.params as any).id);
  return { ok: true };
});
app.post('/api/broadcast/playlists/:id/items', async (req, reply) => {
  requirePermission(req, reply, 'broadcast:write');
  const { articleId } = z.object({ articleId: z.string().uuid() }).parse(req.body);
  const item = await addBroadcastItem((req.params as any).id, articleId);
  if (!item) {
    throw Object.assign(new Error('Sendeliste oder freigegebener Beitrag nicht gefunden.'), { statusCode: 409 });
  }
  return item;
});
app.delete('/api/broadcast/playlists/:id/items/:itemId', async (req, reply) => {
  requirePermission(req, reply, 'broadcast:write');
  await removeBroadcastItem((req.params as any).id, (req.params as any).itemId);
  return { ok: true };
});
app.post('/api/broadcast/playlists/:id/reorder', async (req, reply) => {
  requirePermission(req, reply, 'broadcast:write');
  const { itemIds } = z.object({ itemIds: z.array(z.string().uuid()) }).parse(req.body);
  await reorderBroadcastItems((req.params as any).id, itemIds);
  return { ok: true, items: await listBroadcastItems((req.params as any).id) };
});
app.get('/api/broadcast/status', async () => {
  const run = await activeBroadcastRun();
  const playback = await getPlaybackState<any>();
  const commands = run ? await listBroadcastCommands(run.id, 10) : [];
  const lease = run ? await getRunnerLease(run.id) : null;
  const items = run ? await listBroadcastItems(run.playlist_id) : [];
  return { run, playback, commands, lease, items, inProcess: false, runnerMode: 'external' };
});
app.post('/api/broadcast/playlists/:id/start', async (req, reply) => {
  requirePermission(req, reply, 'broadcast:write');
  try {
    const startBodySchema = z
      .object({
        idempotencyKey: z
          .string()
          .min(1)
          .max(128)
          .regex(/^[A-Za-z0-9.:_-]+$/)
          .optional(),
        startConfig: z
          .record(z.string(), z.unknown())
          .refine((value) => JSON.stringify(value).length <= 16 * 1024, 'startConfig is too large')
          .optional(),
      })
      .strict();
    const parsedBody = startBodySchema.safeParse(req.body ?? {});
    if (!parsedBody.success) return reply.code(400).send({ ok: false, error: 'invalid-start-request-body' });
    const body = parsedBody.data;
    const headerKey = req.headers['idempotency-key'];
    const parsedHeaderKey = Array.isArray(headerKey) ? headerKey[0] : typeof headerKey === 'string' ? headerKey : null;
    if (parsedHeaderKey && !/^[A-Za-z0-9.:_-]{1,128}$/.test(parsedHeaderKey)) {
      return reply.code(400).send({ ok: false, error: 'invalid-idempotency-key-header' });
    }
    if (body.idempotencyKey && parsedHeaderKey && body.idempotencyKey !== parsedHeaderKey) {
      return reply.code(400).send({ ok: false, error: 'idempotency-key-mismatch' });
    }
    const idempotencyKey = body.idempotencyKey ?? parsedHeaderKey;
    const started = await requestBroadcastStart({
      playlistId: (req.params as any).id,
      requestedByUserId: req.user!.id,
      idempotencyKey,
      config: body.startConfig ?? {},
    });
    return reply.code(202).send({
      ok: true,
      operationId: started.operation.id,
      runId: started.run.id,
      status: 'queued',
      playback: started.playback,
    });
  } catch (error) {
    const rawMessage = error instanceof Error ? error.message : String(error);
    const message = rawMessage.includes('active-broadcast-run-exists')
      ? 'Es läuft bereits eine Sendung. Bitte zuerst stoppen oder warten, bis sie beendet ist.'
      : rawMessage.includes('playlist-has-no-broadcastable-items')
        ? 'Diese Sendung enthält aktuell keine abspielbaren Beiträge mit Sprecher-Audio.'
        : rawMessage;
    const status = broadcastStartErrorStatus(error);
    if (status === null) throw error;
    return reply.code(status).send({ ok: false, error: message });
  }
});
app.post('/api/broadcast/control', async (req, reply) => {
  requirePermission(req, reply, 'broadcast:write');
  const schema = z.object({
    action: z.enum(['pause', 'resume', 'skip', 'stop']),
    idempotencyKey: z.string().min(1).optional(),
  });
  const { action, idempotencyKey } = schema.parse(req.body);
  const run = await activeBroadcastRun();
  if (!run) return reply.code(409).send({ ok: false, action, error: 'Kein aktiver Sendelauf' });
  const before = await getPlaybackSnapshot();
  const currentStatus = before.status;
  const transition = validateTransition(currentStatus as any, action);
  if (!transition.accepted) {
    return reply.code(409).send({ ok: false, action, state: before, acceptedSequence: [], error: transition.reason });
  }
  const cmd = await createBroadcastCommand({
    broadcastRunId: run.id,
    playlistId: run.playlist_id,
    command: action,
    idempotencyKey: idempotencyKey ?? req.headers['idempotency-key']?.toString() ?? null,
  });
  return reply.code(202).send({
    ok: true,
    commandId: cmd.id,
    sequence: Number(cmd.sequence),
    expectedState: transition.to,
    status: cmd.status,
    action,
  });
});
app.get('/api/broadcast/commands/:id', async (req) => {
  const command = await getBroadcastCommand((req.params as any).id);
  if (!command) throw apiError(404, 'Broadcast-Befehl nicht gefunden');
  return command;
});
app.get('/api/broadcast/runs/:id/commands', async (req) =>
  listBroadcastCommands(
    (req.params as any).id,
    z.coerce
      .number()
      .int()
      .min(1)
      .max(100)
      .default(25)
      .parse((req.query as any).limit),
  ),
);
app.get('/api/broadcast/runs/:id/lease', async (req) => getRunnerLease((req.params as any).id));
app.post('/api/broadcast/runs/:id/lease/takeover', async (req, reply) => {
  requirePermission(req, reply, 'broadcast:write');
  try {
    const operation = await requestBroadcastRecoveryOperation({
      broadcastRunId: (req.params as any).id,
      reason: 'admin-takeover',
      operationType: 'takeover',
    });
    return reply.code(202).send({
      ok: true,
      operationId: operation.id,
      recoveryStatus: operation.status,
      previousRunnerId: operation.previous_runner_id,
      previousLeaseGeneration: operation.previous_lease_generation,
    });
  } catch (e) {
    return reply.code(409).send({ ok: false, error: e instanceof Error ? e.message : String(e) });
  }
});

app.get('/api/stream-profile', async () => streamProfile());
app.get('/api/stream/status', async () => ({
  ...(await obs.getStreamStatus()),
  autoStart: process.env.STREAM_AUTO_START === 'true',
  supervisorPaused: streamSupervisorPaused,
  supervisorRunning: streamSupervisorRunning,
  supervisorFailures: streamSupervisorFailures,
  supervisorLastError: streamSupervisorLastError,
  supervisorNextAttemptAt: streamSupervisorNextAttemptAt ? new Date(streamSupervisorNextAttemptAt).toISOString() : null,
}));
app.post('/api/stream/start', async (req, reply) => {
  requirePermission(req, reply, 'obs:write');
  streamSupervisorPaused = false;
  streamSupervisorNextAttemptAt = null;
  await restorePublishedOverlays();
  await obs.setScene(MAINTENANCE_SCENE);
  const result = await obs.startStream();
  resetStreamSupervisorFailures();
  return { ok: true, stream: result };
});
app.post('/api/stream/stop', async (req, reply) => {
  requirePermission(req, reply, 'obs:write');
  streamSupervisorPaused = true;
  return { ok: true, stream: await obs.stopStream() };
});
app.get('/api/obs/status', async () => {
  const [obsProcess, playback, streamStatus] = await Promise.all([
    obsProcessStatus(),
    getPlaybackState(),
    obs.getStreamStatus().catch(() => null),
  ]);
  return {
    ...obs.getState(),
    process: obsProcess,
    playback,
    stream: streamStatus,
    streamProfile: streamProfile(),
    streamSupervisor: {
      autoStart: process.env.STREAM_AUTO_START === 'true',
      supervisorPaused: streamSupervisorPaused,
      supervisorRunning: streamSupervisorRunning,
      supervisorFailures: streamSupervisorFailures,
      supervisorLastError: streamSupervisorLastError,
      supervisorNextAttemptAt: streamSupervisorNextAttemptAt
        ? new Date(streamSupervisorNextAttemptAt).toISOString()
        : null,
    },
  };
});
app.post('/api/obs/process/start', async (req, reply) => {
  requirePermission(req, reply, 'obs:write');
  return startObsProcess();
});
app.post('/api/obs/process/stop', async (req, reply) => {
  requirePermission(req, reply, 'obs:write');
  return stopObsProcess();
});
app.post('/api/obs/process/restart', async (req, reply) => {
  requirePermission(req, reply, 'obs:write');
  return restartObsProcess();
});
app.post('/api/obs/youtube/reset', async (req, reply) => {
  requirePermission(req, reply, 'obs:write');
  const streamStatus = await obs.getStreamStatus().catch(() => null);
  if (streamStatus?.outputActive) {
    return reply
      .code(409)
      .send({ error: 'Das YouTube-Konto kann während einer laufenden Sendung nicht gewechselt werden.' });
  }
  streamSupervisorPaused = true;
  await obs.disconnect().catch(() => undefined);
  const result = await resetObsYouTubeAuth();
  await obs.ensureConnectedWithRetry(10);
  return { ok: true, process: result.status, obs: obs.getState() };
});
app.post('/api/obs/connect', async (req, reply) => {
  requirePermission(req, reply, 'obs:write');
  await obs.ensureConnectedWithRetry();
  await setSetting('obs_status', obs.getState());
  return obs.getState();
});
app.post('/api/obs/setup', async (req, reply) => {
  requirePermission(req, reply, 'obs:write');
  const restored = await restorePublishedOverlays();
  if (!restored.some((item) => item.template === 'main-news')) await obs.ensureMainNewsScene(await overlayUrl());
  await setSetting('obs_status', obs.getState());
  return { ok: true, restored, ...obs.getState() };
});
app.post('/api/obs/test-contribution', async (req, reply) => {
  requirePermission(req, reply, 'obs:write');
  const { articleId } = z.object({ articleId: z.string().uuid().optional() }).parse(req.body ?? {});
  const a = articleId ? await getArticleDetail(articleId) : await getPublishedMainArticle();
  if (!a) throw apiError(404, 'Kein Artikel ausgewählt oder freigegeben');
  if (!a.audio_path) throw apiError(409, 'Kein Sprecher-Audio für den Artikel vorhanden');
  await setArticleStatus(a.id, 'published');
  let playback: PlaybackState = { status: 'preparing', articleId: a.id };
  await obs.playTestContribution({
    articleId: a.id,
    audioPath: a.audio_path,
    overlayUrl: await overlayUrl(),
    onState: (state) => {
      playback = state;
    },
  });
  await setSetting('obs_status', obs.getState());
  return { ok: true, articleId: a.id, playback, obs: obs.getState() };
});
app.get('/api/events/internal', async (req, reply) => {
  requirePermission(req, reply, 'broadcast:write');
  const lastId = eventCursor(req.headers['last-event-id'] ?? (req.query as any).lastEventId);
  await liveEventBus.add(reply as any, lastId);
});
app.get('/overlay/events', async (req, reply) => {
  const lastId = eventCursor(req.headers['last-event-id'] ?? (req.query as any).lastEventId);
  const token = (req.query as any).token?.toString();
  if (!token) return reply.code(403).send({ error: 'overlay-token-required' });
  const published = await findPublishedOverlayByTokenHash(tokenHash(token));
  if (!published) return reply.code(404).send({ error: 'overlay-token-invalid' });
  const allowed = new Set([
    'overlay-published',
    'overlay-version-changed',
    'article-prepared',
    'item-started',
    'item-paused',
    'item-resumed',
    'item-ended',
    'item-skipped',
    'broadcast-stopped',
  ]);
  await liveEventBus.add(reply as any, lastId, (ev) => {
    if (!allowed.has(String(ev.type))) return false;
    if (ev.overlay_version_id && ev.overlay_version_id !== published.version_id) return false;
    if (ev.payload && typeof ev.payload === 'object') {
      delete ev.payload.runnerId;
      delete ev.payload.leaseGeneration;
      delete ev.payload.commandRecord;
      delete ev.payload.errorDetails;
      delete ev.payload.audioPath;
    }
    return true;
  });
});
app.get('/overlay/live/:token/:template', async (req, reply) => {
  const { token, template } = req.params as any;
  const published = await findPublishedOverlayByTokenHash(tokenHash(token), template);
  if (!published) throw apiError(404, 'Veröffentlichtes Overlay nicht gefunden');
  return reply
    .type('text/html')
    .send(rendererHtml(`/api/overlay/live/${encodeURIComponent(token)}/${encodeURIComponent(template)}`, token));
});
app.get('/api/overlay/live/:token/:template', async (req) => {
  const { token, template } = req.params as any;
  const published = await findPublishedOverlayByTokenHash(tokenHash(token), template);
  if (!published) throw apiError(404, 'Veröffentlichtes Overlay nicht gefunden');
  const playback = await getPlaybackState<any>();
  const article = playback?.articleId
    ? await getArticleDetail(playback.articleId)
    : ((await getLastPlayedArticle()) ?? (await getPublishedMainArticle()));
  return {
    article: publicArticle(article),
    playback,
    overlay: published.snapshot,
    versionId: published.version_id,
    version: published.published_version,
    eventVersion: Number(playback?.stateRevision ?? 0),
    serverTime: new Date().toISOString(),
  };
});
app.get('/overlay/preview/:id', async (req, reply) =>
  reply.type('text/html').send(rendererHtml(`/api/overlays/${(req.params as any).id}/preview`)),
);
function rendererHtml(dataUrl: string, overlayToken?: string) {
  const style = [
    'html,body,#root{margin:0;width:100%;height:100%;overflow:hidden;background:transparent}',
    'body{font-family:Inter,Arial,sans-serif}',
    '.el{position:absolute;white-space:pre-wrap;overflow:hidden;overflow-wrap:anywhere;line-height:1.15}',
    '.ticker{display:flex;align-items:center;white-space:nowrap;animation:ticker 18s linear infinite}',
    '.fade{animation:fade .5s ease-out}',
    '.slide{animation:slide .5s ease-out}',
    '@keyframes ticker{from{transform:translateX(100%)}to{transform:translateX(-100%)}}',
    '@keyframes fade{from{opacity:0}to{opacity:1}}',
    '@keyframes slide{from{translate:0 30px}to{translate:0 0}}',
  ].join('');
  const script = [
    `const dataUrl=${JSON.stringify(dataUrl)};`,
    `const token=${JSON.stringify(overlayToken ?? '')};`,
    'let currentVersion=-1;',
    "const root=document.getElementById('root');",
    'function applyStyle(node,style){',
    '  for(const [key,value] of Object.entries(style)){node.style[key]=String(value)}',
    '}',
    'function bind(el,data){',
    '  const map={',
    "    'article.title':data.article?.title,",
    "    'article.summary':data.article?.summary,",
    "    'article.source':data.article?.source,",
    "    'article.publishedAt':data.article?.publishedAt,",
    "    'article.publishedDate':data.article?.publishedDate,",
    "    'article.category':data.article?.category,",
    "    'article.region':data.article?.region,",
    "    'playlist.current':data.playlist?.current,",
    "    'clock.time':new Date(data.serverTime||Date.now()).toLocaleTimeString('de-DE',{hour:'2-digit',minute:'2-digit'}),",
    "    'playback.status':data.playback?.status,",
    '  };',
    "  return map[el.binding]??el.props?.text??'';",
    '}',
    'function fitText(node,minSize){',
    '  let size=parseFloat(node.style.fontSize)||42;',
    '  while(size>minSize&&(node.scrollHeight>node.clientHeight||node.scrollWidth>node.clientWidth)){',
    "    size-=2;node.style.fontSize=size+'px';",
    '  }',
    '}',
    'function render(data){',
    '  if(data.eventVersion!==undefined&&data.eventVersion<currentVersion)return;',
    '  currentVersion=data.eventVersion??currentVersion;',
    '  const doc=data.overlay??data.draft?.snapshot??data.draft??null;',
    '  if(!doc)return;',
    '  root.replaceChildren();',
    "  root.style.width=doc.width+'px';",
    "  root.style.height=doc.height+'px';",
    '  for(const el of [...doc.elements].filter((item)=>!item.hidden).sort((a,b)=>a.zIndex-b.zIndex)){',
    "    const tag=el.type==='image'||el.type==='logo'?'img':'div';",
    '    const node=document.createElement(tag);',
    "    const animation=el.props?.animation==='ticker'?'ticker':el.props?.animation==='fade'?'fade':el.props?.animation==='slide'?'slide':'';",
    "    node.className='el '+animation;",
    '    applyStyle(node,{',
    "      left:el.x+'px',top:el.y+'px',width:el.width+'px',height:el.height+'px',opacity:el.opacity,",
    '      zIndex:el.zIndex,background:el.props.background,color:el.props.color,',
    "      border:el.props.borderWidth+'px solid '+el.props.borderColor,borderRadius:el.props.borderRadius+'px',",
    "      padding:el.props.padding+'px',fontSize:el.props.fontSize+'px',fontWeight:el.props.fontWeight,",
    "      textAlign:el.props.align,boxSizing:'border-box',",
    '    });',
    "    if(node.tagName==='IMG') {",
    "      node.src=el.props.src||'';",
    "      node.alt='';",
    "      node.style.objectFit=el.props.objectFit||'contain';",
    "    } else if (el.type!=='shape') {",
    '      node.textContent=bind(el,data);',
    '    }',
    '    root.appendChild(node);',
    "    if(el.type==='text')fitText(node,18);",
    '  }',
    '}',
    'async function load(){',
    "  const response=await fetch(dataUrl,{cache:'no-store'});",
    '  render(await response.json());',
    '}',
    'function connect(){',
    "  const last=window.localStorage.getItem('overlay:'+token+':lastEventId')||'0';",
    "  const events=new EventSource('/overlay/events?token='+encodeURIComponent(token)+'&lastEventId='+encodeURIComponent(last));",
    "  events.onmessage=(ev)=>{ if(ev.lastEventId) window.localStorage.setItem('overlay:'+token+':lastEventId',ev.lastEventId); load(); };",
    "  events.addEventListener('heartbeat',()=>{});",
    "  for(const eventName of ['overlay-published','overlay-version-changed','article-prepared','item-started','item-paused','item-resumed','item-ended','item-skipped','broadcast-stopped']){",
    "    events.addEventListener(eventName,(ev)=>{ if(ev.lastEventId) window.localStorage.setItem(\'overlay:\'+token+\':lastEventId\',ev.lastEventId); load(); });",
    '  }',
    '  events.onerror=()=>{events.close();setTimeout(connect,1500)};',
    '}',
    'load();',
    'connect();',
    'setInterval(load,30000);',
  ].join('\n');
  return [
    '<!doctype html>',
    '<html><head><meta charset="utf-8"><title>OBS Overlay</title>',
    `<style>${style}</style></head><body>`,
    '<div id="root"></div>',
    `<script type="module">${script}</script>`,
    '</body></html>',
  ].join('');
}
await app.listen({ host: process.env.APP_HOST ?? '127.0.0.1', port: Number(process.env.APP_PORT ?? 12000) });

async function superviseStream() {
  if (
    process.env.STREAM_AUTO_START !== 'true' ||
    streamSupervisorPaused ||
    streamSupervisorRunning ||
    (streamSupervisorNextAttemptAt !== null && Date.now() < streamSupervisorNextAttemptAt)
  )
    return;
  streamSupervisorRunning = true;
  try {
    await obs.ensureConnectedWithRetry(10);
    const status = await obs.getStreamStatus();
    if (status.outputActive) {
      resetStreamSupervisorFailures();
      return;
    }
    await restorePublishedOverlays();
    await obs.setScene(MAINTENANCE_SCENE);
    await obs.startStream();
    resetStreamSupervisorFailures();
    app.log.info('YouTube-Stream automatisch gestartet');
  } catch (error) {
    streamSupervisorFailures += 1;
    streamSupervisorLastError = error instanceof Error ? error.message : String(error);
    const retryDelayMs = Math.min(
      streamSupervisorMaxBackoffMs,
      streamSupervisorIntervalMs * 2 ** Math.min(streamSupervisorFailures - 1, 10),
    );
    streamSupervisorNextAttemptAt = Date.now() + retryDelayMs;
    app.log.warn(
      {
        error,
        supervisorFailures: streamSupervisorFailures,
        retryAt: new Date(streamSupervisorNextAttemptAt).toISOString(),
      },
      'Automatischer Streamstart ist noch nicht möglich',
    );
  } finally {
    streamSupervisorRunning = false;
  }
}
if (process.env.STREAM_AUTO_START === 'true') {
  setTimeout(() => void superviseStream(), 2000);
  if (process.env.STREAM_AUTO_RESTART !== 'false') {
    setInterval(() => void superviseStream(), streamSupervisorIntervalMs);
  }
}
