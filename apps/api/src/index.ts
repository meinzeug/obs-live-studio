import Fastify from 'fastify';
import { createHash, randomBytes } from 'node:crypto';
import { readFile } from 'node:fs/promises';
import helmet from '@fastify/helmet';
import cors from '@fastify/cors';
import rateLimit from '@fastify/rate-limit';
import websocket from '@fastify/websocket';
import multipart from '@fastify/multipart';
import cookie from '@fastify/cookie';
import dotenv from 'dotenv';
import { z } from 'zod';
import { parseFeed, parseHtmlArticle } from '@ans/news-parser';
import { summarize, makeScript } from '@ans/content-processing';
import { assertPublicHttpUrl, maskSecret } from '@ans/security';
import { fetchHttpText } from '@ans/source-connectors';
import {
  createSource,
  dashboardStats,
  getArticleDetail,
  getPublishedMainArticle,
  listArticles,
  listSources,
  recordSourceCheck,
  saveArticlePackage,
  saveAudioAsset,
  setArticleStatus,
  setSourceActive,
  updateSource,
  getPlaybackState,
  setPlaybackState,
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
  listBroadcastPlaylists,
  getBroadcastPlaylist,
  listBroadcastItems,
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
  takeOverExpiredLease,
  ensureOverlayPublicIdentity,
  rotateOverlayPublicToken,
  rememberObsOverlaySource,
  publishedMainOverlayUrl,
  isPublicMediaInPublishedOverlay,
} from '@ans/database';
import { synthesizePiper, probeAudioDuration } from '@ans/tts-engine';
import { ObsController } from '@ans/obs-controller';
import { createTemplate, validateOverlayDocument } from '@ans/overlay-engine';
import { cacheHeaders, storeUploadedImage } from '@ans/media-engine';
import { BroadcastRunner, startInBackground, validateTransition } from '@ans/broadcast-engine';
import { LiveEventBus } from './liveEventBus.js';
import { registerAuth, requirePermission } from './auth.js';
import { obsProcessStatus, startObsProcess, stopObsProcess, restartObsProcess } from './desktop-agent-client.js';
dotenv.config();
const app = Fastify({ logger: true });
const liveEventBus = new LiveEventBus();
await liveEventBus.start();
function tokenHash(token: string) {
  return createHash('sha256').update(token).digest('hex');
}
await app.register(helmet, { contentSecurityPolicy: false });
await app.register(cors, { origin: true, credentials: true });
await app.register(rateLimit, { max: 120, timeWindow: '1 minute' });
await app.register(websocket);
await app.register(multipart, { limits: { fileSize: 50 * 1024 * 1024 } });
await app.register(cookie);
await registerAuth(app);
function isLocalTestFeed(raw: string) {
  const url = new URL(raw);
  return (
    ['127.0.0.1', 'localhost'].includes(url.hostname) &&
    url.port === String(process.env.APP_PORT ?? 12000) &&
    url.pathname === '/test-feed.xml'
  );
}
const allowPrivate = process.env.ALLOW_PRIVATE_SOURCES === 'true';
const stream = {
  service: process.env.STREAM_SERVICE ?? 'custom',
  server: process.env.STREAM_SERVER ?? '',
  streamKey: process.env.STREAM_KEY ? maskSecret(process.env.STREAM_KEY) : '',
};
let activeRunner: BroadcastRunner | null = null;
const recoveredRun = await recoverActiveBroadcastRuns(
  process.env.BROADCAST_RESTORE_MODE === 'resume' ? 'resume' : 'interrupt',
);
const obs = new ObsController({
  host: process.env.OBS_HOST ?? '127.0.0.1',
  port: Number(process.env.OBS_PORT ?? 4455),
  password: process.env.OBS_PASSWORD,
  overlayUrl: process.env.PUBLIC_OVERLAY_URL,
});
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
function makeOverlayPublicUrl(token: string, template: string) {
  return `${publicBaseUrl()}/overlay/live/${encodeURIComponent(token)}/${encodeURIComponent(template)}`;
}
if (recoveredRun && process.env.BROADCAST_RESTORE_MODE === 'resume') {
  activeRunner = startInBackground(
    new BroadcastRunner({
      obs,
      playlistId: recoveredRun.playlist_id,
      overlayUrl: await overlayUrl(),
      recoverRunId: recoveredRun.id,
    }),
  );
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
  return a
    ? {
        id: a.id,
        title: a.title,
        summary: a.summary ?? a.excerpt ?? '',
        source: a.source_name ?? 'Quelle',
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
    tts: process.env.PIPER_MODEL_PATH ? 'configured' : 'optional',
  },
  time: new Date().toISOString(),
}));
app.get('/test-feed.xml', async (_req, reply) =>
  reply
    .type('application/rss+xml')
    .send(
      `<?xml version="1.0"?><rss version="2.0"><channel><title>Lokaler Testfeed</title><item><title>Testmeldung eins</title><link>http://127.0.0.1:${process.env.APP_PORT ?? 12000}/test/articles/1</link><guid>local-1</guid><pubDate>Sun, 12 Jul 2026 10:00:00 GMT</pubDate><description>Reproduzierbarer lokaler Nachrichtentext für Integrations- und Regressionstests.</description></item></channel></rss>`,
    ),
);
app.get('/api/dashboard', async () => {
  const c = await dashboardStats();
  const a = await listArticles(1);
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
      item: a[0]?.title ?? 'Keine Nachricht geladen',
      next: 'Keine Sendeliste geplant',
      scene: 'Hauptnachrichten-Overlay',
    },
    obs: obs.getState(),
    playback: await getPlaybackState(),
    actions: ['test-contribution'],
  };
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
app.get('/api/articles', async (req) => listArticles(Number((req.query as any).limit ?? 100)));
app.get('/api/articles/:id', async (req) => getArticleDetail((req.params as any).id));
app.post('/api/articles/:id/process', async (req, reply) => {
  requirePermission(req, reply, 'articles:write');
  const a = await getArticleDetail((req.params as any).id);
  if (!a) throw new Error('Artikel nicht gefunden');
  const text = a.main_text ?? a.excerpt ?? a.title;
  const summary = summarize(text);
  const script = makeScript(a.title, summary, a.source_name ?? 'der Quelle');
  await saveArticlePackage(a.id, summary, script, summary, `${a.title}: ${summary}`);
  return getArticleDetail(a.id);
});
app.post('/api/articles/:id/status', async (req, reply) => {
  requirePermission(req, reply, 'articles:write');
  const { status } = z
    .object({ status: z.enum(['new', 'review', 'approved', 'blocked', 'published', 'discarded']) })
    .parse(req.body);
  return setArticleStatus((req.params as any).id, status);
});
app.post('/api/articles/:id/tts', async (req, reply) => {
  requirePermission(req, reply, 'articles:write');
  const a = await getArticleDetail((req.params as any).id);
  if (!a?.script_text) throw new Error('Kein Sprechertext vorhanden');
  if (!process.env.PIPER_MODEL_PATH) return { skipped: true, reason: 'Piper ist nicht konfiguriert' };
  const out = await synthesizePiper(a.script_text, {
    modelPath: process.env.PIPER_MODEL_PATH,
    outputDirectory: process.env.TTS_OUTPUT_DIR ?? 'generated/audio',
    piperExecutable: process.env.PIPER_EXECUTABLE,
  });
  const duration = await probeAudioDuration(out.file, process.env.FFPROBE_EXECUTABLE);
  await saveAudioAsset(a.id, out.file, duration);
  return { file: out.file, durationSeconds: duration };
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
  return {
    project: await getOverlayProject(id),
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
  if (!project) throw new Error('Overlay-Projekt nicht gefunden');
  const v = await publishOverlayVersion(projectId, b.versionId, req.user?.id);
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
    payload: { projectId, publicUrl, template: project.template },
  });
  await appendLiveEvent({
    type: 'overlay-published',
    overlayVersionId: v.id,
    payload: { projectId, versionId: v.id, publicUrl },
    dedupeKey: `overlay-published:${v.id}`,
  });
  return { ok: true, version: v, publicUrl };
});

app.post('/api/overlays/:id/rotate-token', async (req, reply) => {
  requirePermission(req, reply, 'users:write');
  const project = await getOverlayProject((req.params as any).id);
  if (!project) throw new Error('Overlay-Projekt nicht gefunden');
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
  });
  await appendLiveEvent({
    type: 'overlay-version-changed',
    payload: { projectId: project.id, reason: 'token-rotated' },
    dedupeKey: `overlay-token-rotated:${project.id}:${Date.now()}`,
  });
  return { ok: true, project: updated, publicUrl };
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
  return {
    project: await getOverlayProject(id),
    draft: await latestOverlayDraft(id),
    playback: await getPlaybackState(),
    serverTime: new Date().toISOString(),
  };
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
  if (!(req as any).user) throw new Error('Authentifizierung erforderlich');
  const m = await getMediaAsset((req.params as any).id);
  if (!m?.storage_path) throw new Error('Medium nicht gefunden');
  const buf = await readFile(m.storage_path);
  reply.headers(cacheHeaders(m.mime_type, true)).send(buf);
});
app.get('/media/:id/derivatives/:label', async (req, reply) => {
  const mediaId = (req.params as any).id;
  if (!(req as any).user && !(await isPublicMediaInPublishedOverlay(mediaId)))
    throw new Error('Medium ist nicht öffentlich veröffentlicht');
  const m = await getMediaAsset(mediaId);
  const label = (req.params as any).label;
  const derivative = m?.derivative_paths?.[label];
  if (!derivative?.path) throw new Error('Ableitung nicht gefunden');
  const buf = await readFile(derivative.path);
  reply.headers(cacheHeaders(derivative.mime ?? 'image/webp')).send(buf);
});

app.get('/api/broadcast/playlists', async () => listBroadcastPlaylists());
app.post('/api/broadcast/playlists', async (req, reply) => {
  requirePermission(req, reply, 'broadcast:write');
  const { name } = z.object({ name: z.string().min(1).default('Sendeliste') }).parse(req.body ?? {});
  return createBroadcastPlaylist(name);
});
app.get('/api/broadcast/playlists/:id', async (req) => {
  const id = (req.params as any).id;
  return { playlist: await getBroadcastPlaylist(id), items: await listBroadcastItems(id) };
});
app.post('/api/broadcast/playlists/:id/items', async (req, reply) => {
  requirePermission(req, reply, 'broadcast:write');
  const { articleId } = z.object({ articleId: z.string().uuid() }).parse(req.body);
  return addBroadcastItem((req.params as any).id, articleId);
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
  return { run, playback, commands, lease, items, inProcess: activeRunner?.isRunning() ?? false };
});
app.post('/api/broadcast/playlists/:id/start', async (req, reply) => {
  requirePermission(req, reply, 'broadcast:write');
  if (activeRunner?.isRunning()) throw new Error('Es läuft bereits ein aktiver Sendelauf');
  const runner = new BroadcastRunner({ obs, playlistId: (req.params as any).id, overlayUrl: await overlayUrl() });
  activeRunner = startInBackground(runner);
  return { ok: true, runnerId: runner.id, playback: await getPlaybackState() };
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
  const before = await getPlaybackState<any>();
  const currentStatus = typeof before?.status === 'string' ? before.status : 'idle';
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
app.get('/api/broadcast/commands/:id', async (req) => getBroadcastCommand((req.params as any).id));
app.get('/api/broadcast/runs/:id/commands', async (req) =>
  listBroadcastCommands((req.params as any).id, Number((req.query as any).limit ?? 25)),
);
app.get('/api/broadcast/runs/:id/lease', async (req) => getRunnerLease((req.params as any).id));
app.post('/api/broadcast/runs/:id/lease/takeover', async (req, reply) => {
  requirePermission(req, reply, 'broadcast:write');
  const runnerId = `manual-${randomBytes(12).toString('hex')}`;
  const lease = await takeOverExpiredLease((req.params as any).id, runnerId);
  if (!lease) return reply.code(409).send({ ok: false, error: 'Lease ist nicht abgelaufen' });
  return { ok: true, lease };
});

app.get('/api/stream-profile', async () => stream);
app.get('/api/obs/status', async () => ({
  ...obs.getState(),
  process: await obsProcessStatus(),
  playback: await getPlaybackState(),
}));
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
app.post('/api/obs/connect', async (req, reply) => {
  requirePermission(req, reply, 'obs:write');
  await obs.ensureConnectedWithRetry();
  await setSetting('obs_status', obs.getState());
  return obs.getState();
});
app.post('/api/obs/setup', async (req, reply) => {
  requirePermission(req, reply, 'obs:write');
  await obs.ensureMainNewsScene(await overlayUrl());
  await setSetting('obs_status', obs.getState());
  return { ok: true, ...obs.getState() };
});
app.post('/api/obs/test-contribution', async (req, reply) => {
  requirePermission(req, reply, 'obs:write');
  const { articleId } = z.object({ articleId: z.string().uuid().optional() }).parse(req.body ?? {});
  const a = articleId ? await getArticleDetail(articleId) : await getPublishedMainArticle();
  if (!a) throw new Error('Kein Artikel ausgewählt oder freigegeben');
  if (!a.audio_path) throw new Error('Kein Sprecher-Audio für den Artikel vorhanden');
  await setArticleStatus(a.id, 'published');
  await setPlaybackState({ status: 'preparing', articleId: a.id });
  try {
    await obs.playTestContribution({
      articleId: a.id,
      audioPath: a.audio_path,
      overlayUrl: await overlayUrl(),
      onState: setPlaybackState,
    });
    await setSetting('obs_status', obs.getState());
    return { ok: true, articleId: a.id, playback: await getPlaybackState(), obs: obs.getState() };
  } catch (e) {
    const message = e instanceof Error ? e.message : String(e);
    await setPlaybackState({ status: 'error', articleId: a.id, error: message });
    throw e;
  }
});
app.get('/overlay/events', async (req, reply) => {
  const lastId = Number(req.headers['last-event-id'] ?? (req.query as any).lastEventId ?? 0);
  await liveEventBus.add(reply as any, lastId);
});
app.get('/overlay/live/:token/:template', async (req, reply) => {
  const { token, template } = req.params as any;
  const published = await findPublishedOverlayByTokenHash(tokenHash(token), template);
  if (!published) throw new Error('Veröffentlichtes Overlay nicht gefunden');
  return reply
    .type('text/html')
    .send(rendererHtml(`/api/overlay/live/${encodeURIComponent(token)}/${encodeURIComponent(template)}`));
});
app.get('/api/overlay/live/:token/:template', async (req) => {
  const { token, template } = req.params as any;
  const published = await findPublishedOverlayByTokenHash(tokenHash(token), template);
  if (!published) throw new Error('Veröffentlichtes Overlay nicht gefunden');
  const playback = await getPlaybackState<any>();
  const article = playback?.articleId ? await getArticleDetail(playback.articleId) : await getPublishedMainArticle();
  return {
    article: publicArticle(article),
    playback,
    overlay: published.snapshot,
    versionId: published.version_id,
    version: published.published_version,
    eventVersion: 0,
    serverTime: new Date().toISOString(),
  };
});
app.get('/overlay/preview/:id', async (req, reply) =>
  reply.type('text/html').send(rendererHtml(`/api/overlays/${(req.params as any).id}/preview`)),
);
function rendererHtml(dataUrl: string) {
  const style = [
    'html,body,#root{margin:0;width:100%;height:100%;overflow:hidden;background:transparent}',
    'body{font-family:Inter,Arial,sans-serif}',
    '.el{position:absolute;white-space:pre-wrap;overflow:hidden}',
    '.ticker{white-space:nowrap;animation:ticker 18s linear infinite}',
    '.fade{animation:fade .5s ease-out}',
    '.slide{animation:slide .5s ease-out}',
    '@keyframes ticker{from{transform:translateX(100%)}to{transform:translateX(-100%)}}',
    '@keyframes fade{from{opacity:0}to{opacity:1}}',
    '@keyframes slide{from{translate:0 30px}to{translate:0 0}}',
  ].join('');
  const script = [
    `const dataUrl=${JSON.stringify(dataUrl)};`,
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
    "    'playlist.current':data.playlist?.current,",
    "    'clock.time':new Date(data.serverTime||Date.now()).toLocaleTimeString('de-DE',{hour:'2-digit',minute:'2-digit'}),",
    "    'playback.status':data.playback?.status,",
    '  };',
    "  return map[el.binding]??el.props?.text??'';",
    '}',
    'function render(data){',
    '  if(data.eventVersion!==undefined&&data.eventVersion<currentVersion)return;',
    '  currentVersion=data.eventVersion??currentVersion;',
    '  const doc=data.overlay;',
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
    '  }',
    '}',
    'async function load(){',
    "  const response=await fetch(dataUrl,{cache:'no-store'});",
    '  render(await response.json());',
    '}',
    'function connect(){',
    "  const events=new EventSource('/overlay/events');",
    '  events.onmessage=load;',
    "  events.addEventListener('heartbeat',()=>{});",
    "  for(const eventName of ['overlay-published','broadcast-control','media-updated']){",
    '    events.addEventListener(eventName,load);',
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
app.listen({ host: process.env.APP_HOST ?? '127.0.0.1', port: Number(process.env.APP_PORT ?? 12000) });
