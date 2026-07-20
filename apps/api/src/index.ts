import Fastify from 'fastify';
import { createHash, randomBytes } from 'node:crypto';
import { readFile } from 'node:fs/promises';
import { isAbsolute, resolve as resolvePath } from 'node:path';
import helmet from '@fastify/helmet';
import cors from '@fastify/cors';
import rateLimit from '@fastify/rate-limit';
import websocket from '@fastify/websocket';
import multipart from '@fastify/multipart';
import cookie from '@fastify/cookie';
import dotenv from 'dotenv';
import { z } from 'zod';
import { parseFeed, parseHtmlArticle } from '@ans/news-parser';
import { cleanArticleTextForBroadcast, combineEditorialWarnings, summarize, makeScript } from '@ans/content-processing';
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
  updateOverlayProject,
  ensureEditableOverlayDraft,
  latestOverlayDraft,
  latestOverlayVersion,
  overlayVersions,
  updateOverlayDraft,
  publishOverlayVersion,
  rollbackOverlay,
  duplicateOverlayProject,
  deleteOverlayProject,
  getConfiguredOverlay,
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
  getLiveStudioSettings,
  updateLiveStudioSettings,
  listLiveStudioSources,
  upsertLiveStudioSource,
  updateLiveStudioSource,
  setLiveStudioProgramSource,
  removeLiveStudioSource,
  type LiveStudioLayout,
  type LiveStudioSourceLabelStyle,
  type LiveStudioSourceTransition,
  type LiveStudioTransition,
} from '@ans/database';
import { isArticleVisualMedia } from '@ans/database/article-media';
import {
  MAIN_NEWS_SCENE,
  LIVE_STUDIO_SCENE,
  MAINTENANCE_SCENE,
  OVERLAY_INPUTS,
  ObsController,
  liveStudioInputName,
  type PlaybackState,
} from '@ans/obs-controller';
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
import { TtsSettingsManager, registerTtsSettingsRoutes } from './tts-settings.js';
import { prepareRunningObsForConfiguration } from './obs-configuration-preparation.js';
import { ChannelIdentitySettingsManager, registerChannelIdentityRoutes } from './channel-identity-settings.js';
import { resolveYoutubeLiveSource } from './youtube-live-source.js';
import { broadcastStartErrorStatus } from './broadcast-start-errors.js';
import {
  obsProcessStatus,
  startObsProcess,
  stopObsProcess,
  restartObsProcess,
  resetObsYouTubeAuth,
} from './desktop-agent-client.js';
import { PROJECT_ROOT } from './project-root.js';
import { LivePortalClient } from './live-portal-client.js';
dotenv.config({ path: resolvePath(PROJECT_ROOT, '.env') });
const app = Fastify({ logger: true });
installApiErrorHandler(app);
const liveEventBus = new LiveEventBus();
await liveEventBus.start();
async function readStoredFile(storedPath: string) {
  const candidates = isAbsolute(storedPath)
    ? [storedPath]
    : [resolvePath(process.cwd(), storedPath), resolvePath(PROJECT_ROOT, storedPath)];
  let lastError: unknown = null;
  for (const candidate of candidates) {
    try {
      return await readFile(candidate);
    } catch (error) {
      lastError = error;
      if ((error as NodeJS.ErrnoException).code !== 'ENOENT') throw error;
    }
  }
  throw lastError ?? new Error(`Datei nicht gefunden: ${storedPath}`);
}
function tokenHash(token: string) {
  return createHash('sha256').update(token).digest('hex');
}
function eventCursor(value: unknown) {
  const parsed = Number(value ?? 0);
  return Number.isSafeInteger(parsed) && parsed >= 0 ? parsed : 0;
}

function requestPath(rawUrl?: string) {
  try {
    return new URL(rawUrl ?? '/', 'http://studio.local').pathname;
  } catch {
    return '/';
  }
}

function isRealtimeReadRoute(req: { method?: string; url?: string }) {
  if (req.method !== 'GET' && req.method !== 'HEAD') return false;
  const path = requestPath(req.url);
  return (
    path === '/health' ||
    path === '/api/dashboard' ||
    path === '/api/notifications' ||
    path === '/api/channel/identity/public' ||
    path === '/api/channel/logo' ||
    path === '/api/obs/status' ||
    path === '/api/live/status' ||
    path === '/api/overlay/main' ||
    path === '/overlay/events' ||
    path.startsWith('/overlay/live/') ||
    path.startsWith('/api/overlay/live/')
  );
}

await app.register(helmet, { contentSecurityPolicy: false });
await app.register(cors, { origin: true, credentials: true });
const configuredRateLimit = Number(process.env.RATE_LIMIT_MAX ?? 600);
await app.register(rateLimit, {
  max: Number.isFinite(configuredRateLimit) ? Math.max(1, Math.min(100_000, Math.floor(configuredRateLimit))) : 600,
  timeWindow: '1 minute',
  allowList: (req) => isRealtimeReadRoute(req),
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
registerTtsSettingsRoutes(app, new TtsSettingsManager(), requirePermission);
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
const livePortal = new LivePortalClient({
  baseUrl: process.env.LIVE_PORTAL_BASE_URL,
  serviceToken: process.env.LIVE_PORTAL_SERVICE_TOKEN,
  timeoutMs: Number(process.env.LIVE_PORTAL_TIMEOUT_MS ?? 8_000),
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
const overlaySlotLabels: Record<string, string> = {
  'main-news': 'Hauptsendung',
  'breaking-news': 'Breaking News',
  'lower-third': 'Lower Third',
  ticker: 'Ticker',
  maintenance: 'Bereitschaft / Wartung',
  'fullscreen-graphic': 'Vollbild-Grafik',
  'live-studio': 'Live-Studio',
};

const overlaySlotTemplates = Object.keys(OVERLAY_INPUTS);

function absoluteOverlayUrl(url: string) {
  return url.startsWith('http') ? url : `${publicBaseUrl()}${url}`;
}

async function liveOverlayUrl() {
  const configured = await getConfiguredOverlay('live-studio');
  const published = configured ?? (await getPublishedOverlay('live-studio'));
  const publicUrl = published?.obs_configured_url ?? published?.public_url;
  return typeof publicUrl === 'string' && publicUrl ? absoluteOverlayUrl(publicUrl) : null;
}

function liveSourceLayouts(
  sources: Awaited<ReturnType<typeof listLiveStudioSources>>,
  settings?: Awaited<ReturnType<typeof getLiveStudioSettings>>,
) {
  if (settings?.layout === 'reaction' && settings.reaction_enabled) {
    const selectedIds = [settings.reaction_youtube_source_id, ...(settings.reaction_camera_source_ids ?? [])].filter(
      (sourceId): sourceId is string => Boolean(sourceId),
    );
    const selectedIndex = new Map(selectedIds.map((sourceId, index) => [sourceId, index]));
    return [...sources]
      .sort(
        (a, b) =>
          (selectedIndex.get(a.source_id) ?? Number.MAX_SAFE_INTEGER) -
            (selectedIndex.get(b.source_id) ?? Number.MAX_SAFE_INTEGER) || a.slot_index - b.slot_index,
      )
      .map((source, index) => ({
        sourceId: source.source_id,
        index,
        hidden: source.hidden || !selectedIndex.has(source.source_id),
      }));
  }
  return [...sources]
    .sort((a, b) => Number(b.in_program) - Number(a.in_program) || a.slot_index - b.slot_index)
    .map((source, index) => ({ sourceId: source.source_id, index, hidden: source.hidden }));
}

function liveReactionLayout(settings: Awaited<ReturnType<typeof getLiveStudioSettings>>) {
  return {
    position: settings.reaction_position,
    sizePercent: settings.reaction_size_percent,
    gap: settings.reaction_gap,
  };
}

function applyConfiguredLiveLayout(
  settings: Awaited<ReturnType<typeof getLiveStudioSettings>>,
  sources: Awaited<ReturnType<typeof listLiveStudioSources>>,
) {
  return obs.applyLiveStudioLayout(
    settings.layout,
    liveSourceLayouts(sources, settings),
    settings.layout === 'reaction' ? liveReactionLayout(settings) : undefined,
  );
}

const liveStingerKinds = ['live-now', 'breaking-news', 'back-to-program'] as const;
type LiveStingerKind = (typeof liveStingerKinds)[number];
type LiveStingerProfile = {
  enabled: boolean;
  durationMs: number;
  kicker: string;
  title: string;
  subtitle: string;
  accentColor: string;
  animation: 'sweep' | 'zoom' | 'pulse' | 'glitch';
  soundEnabled: boolean;
  volume: number;
};
const defaultLiveStingers: Record<LiveStingerKind, LiveStingerProfile> = {
  'live-now': {
    enabled: true,
    durationMs: 3200,
    kicker: 'LIVE',
    title: 'LIVE SENDUNG JETZT',
    subtitle: 'Wir schalten direkt ins Studio.',
    accentColor: '#d20a2e',
    animation: 'sweep',
    soundEnabled: true,
    volume: 65,
  },
  'breaking-news': {
    enabled: true,
    durationMs: 3000,
    kicker: 'BREAKING NEWS',
    title: 'EILMELDUNG',
    subtitle: 'Aktuelle Entwicklung live.',
    accentColor: '#ffbf00',
    animation: 'glitch',
    soundEnabled: true,
    volume: 72,
  },
  'back-to-program': {
    enabled: true,
    durationMs: 2600,
    kicker: 'PROGRAMM',
    title: 'ZURÜCK ZUR SENDUNG',
    subtitle: 'Der Autopilot übernimmt wieder.',
    accentColor: '#16a34a',
    animation: 'zoom',
    soundEnabled: true,
    volume: 58,
  },
};
const liveStingerProfileSchema = z.object({
  enabled: z.boolean(),
  durationMs: z.number().int().min(250).max(10_000),
  kicker: z.string().trim().min(1).max(40),
  title: z.string().trim().min(1).max(100),
  subtitle: z.string().trim().max(180),
  accentColor: z.string().regex(/^#[0-9a-f]{6}$/i),
  animation: z.enum(['sweep', 'zoom', 'pulse', 'glitch']),
  soundEnabled: z.boolean(),
  volume: z.number().int().min(0).max(100),
});

function liveStingerProfiles(raw: Record<string, unknown> | null | undefined) {
  return Object.fromEntries(
    liveStingerKinds.map((kind) => {
      const parsed = liveStingerProfileSchema.safeParse(raw?.[kind]);
      return [kind, parsed.success ? parsed.data : defaultLiveStingers[kind]];
    }),
  ) as Record<LiveStingerKind, LiveStingerProfile>;
}

function recommendedLiveLayout(visibleSourceCount: number): LiveStudioLayout {
  if (visibleSourceCount <= 1) return 'fullscreen';
  if (visibleSourceCount === 2) return 'split';
  return 'grid';
}

async function liveOverlayState() {
  const [settings, sources] = await Promise.all([getLiveStudioSettings(), listLiveStudioSources()]);
  const sourceById = new Map(sources.map((source) => [source.source_id, source]));
  const visible = liveSourceLayouts(sources, settings)
    .filter((source) => !source.hidden)
    .sort((a, b) => a.index - b.index)
    .map((source) => sourceById.get(source.sourceId))
    .filter((source): source is (typeof sources)[number] => Boolean(source));
  const program = visible.find((source) => source.in_program) ?? visible[0] ?? null;
  return {
    layout: settings.layout,
    sourceCount: visible.length,
    sourceOverlayEnabled: settings.source_overlay_enabled && settings.overlay_visible,
    sourceLabelStyle: settings.source_label_style,
    sourceTransition: settings.source_transition,
    programSourceId: program?.source_id ?? null,
    programSourceName: program?.display_name ?? null,
    summary: settings.reaction_enabled
      ? settings.reaction_title
      : visible.length === 0
        ? 'Live-Studio in Bereitschaft'
        : visible.length === 1
          ? `${visible[0].display_name} live zugeschaltet`
          : `${visible.length} Live-Quellen zugeschaltet`,
    sources: visible.map((source, index) => ({
      id: source.source_id,
      name: source.display_name,
      user: source.user_name,
      muted: source.muted,
      index,
      inProgram: source.in_program,
    })),
    reaction: {
      enabled: settings.reaction_enabled,
      youtubeSourceId: settings.reaction_youtube_source_id,
      cameraSourceIds: visible
        .filter((source) => source.source_id !== settings.reaction_youtube_source_id)
        .map((source) => source.source_id),
      position: settings.reaction_position,
      sizePercent: settings.reaction_size_percent,
      gap: settings.reaction_gap,
      style: settings.reaction_style,
      animation: settings.reaction_animation,
      title: settings.reaction_title,
      accentColor: settings.reaction_accent_color,
    },
    updatedAt: settings.updated_at,
  };
}

async function appendLiveStudioChange(reason: string, payload: Record<string, unknown> = {}) {
  await appendLiveEvent({
    type: 'live-studio-changed',
    payload: { reason, ...payload },
    dedupeKey: `live-studio:${reason}:${Date.now()}:${Math.random().toString(36).slice(2)}`,
  });
}

async function liveOverlayOptions() {
  const projects = (await listOverlayProjects()).filter((project: any) => project.template === 'live-studio');
  const versionsByProject = new Map<string, any[]>();
  await Promise.all(
    projects.map(async (project: any) => versionsByProject.set(project.id, await overlayVersions(project.id))),
  );
  return projects.map((project: any) => ({
    id: project.id,
    name: project.name,
    width: project.width,
    height: project.height,
    publishedVersion: project.published_version ?? null,
    draftVersion: project.draft_version ?? null,
    obsConfiguredUrl: project.obs_configured_url ?? null,
    versions: versionsByProject.get(project.id) ?? [],
  }));
}

function mergeLiveSources(portalSources: Awaited<ReturnType<LivePortalClient['listSources']>>, configured: any[]) {
  const configuredById = new Map(configured.map((source) => [source.source_id, source]));
  const portalById = new Map((portalSources.sources ?? []).map((source) => [source.id, source]));
  const ids = new Set([...configuredById.keys(), ...portalById.keys()]);
  return [...ids].map((id) => {
    const portal = portalById.get(id);
    const local = configuredById.get(id);
    const localState = (local?.last_portal_state ?? {}) as Record<string, unknown>;
    const isYoutube = localState.kind === 'youtube';
    return {
      id,
      name: portal?.name ?? local?.display_name ?? id,
      user: portal?.user ?? local?.user_name ?? (isYoutube ? 'YouTube' : null),
      status: portal?.status ?? (isYoutube ? 'live' : 'offline'),
      resolution: portal?.resolution ?? (isYoutube ? '1920×1080' : null),
      audioLevel: portal?.audioLevel ?? null,
      network: portal?.network ?? (isYoutube ? 'good' : null),
      previewUrl: portal?.previewUrl ?? (typeof localState.previewUrl === 'string' ? localState.previewUrl : null),
      sourceType: isYoutube ? 'youtube' : 'portal',
      startedAt: portal?.startedAt ?? null,
      updatedAt: portal?.updatedAt ?? local?.updated_at ?? null,
      obs: local
        ? {
            inputName: local.input_name,
            viewerUrl: local.viewer_url,
            muted: local.muted,
            hidden: local.hidden,
            index: local.slot_index,
            inProgram: local.in_program,
          }
        : null,
    };
  });
}

function youtubeLiveSource(urlValue: string) {
  try {
    return resolveYoutubeLiveSource(urlValue);
  } catch (error) {
    throw apiError(400, error instanceof Error ? error.message : 'Ungültige YouTube-URL.');
  }
}

async function liveStatusSnapshot() {
  const [settings, configuredSources, portalSources, streamStatus, currentScene, overlays, autopilot, playback] =
    await Promise.all([
      getLiveStudioSettings(),
      listLiveStudioSources(),
      livePortal.listSources().catch((error) => ({
        sources: [],
        unavailable: error instanceof Error ? error.message : String(error),
      })),
      obs.getStreamStatus().catch(() => null),
      obs.getScene().catch(() => null),
      liveOverlayOptions().catch(() => []),
      getAutopilotConfig().catch(() => null),
      getPlaybackState<PlaybackState>().catch(() => null),
    ]);
  return {
    sceneName: LIVE_STUDIO_SCENE,
    settings,
    currentScene,
    portal: { ...livePortal.status(), error: 'unavailable' in portalSources ? portalSources.unavailable : null },
    overlays,
    chat: { url: settings.chat_url, visible: settings.chat_visible },
    autopilot,
    playback,
    sources: mergeLiveSources(portalSources, configuredSources),
    obs: obs.getState(),
    stream: streamStatus,
    serverTime: new Date().toISOString(),
  };
}

const channelIdentityManager = new ChannelIdentitySettingsManager({
  afterChange: async () => {
    await obs.ensureChannelLogo(`${publicBaseUrl()}/channel-logo`);
  },
  runtimeState: async () => {
    const [stream, playback] = await Promise.all([
      obs.getStreamStatus().catch(() => null),
      getPlaybackState<PlaybackState>().catch(() => null),
    ]);
    return {
      streamActive: Boolean(stream?.outputActive),
      broadcastActive: ['preparing', 'playing', 'paused'].includes(playback?.status ?? ''),
    };
  },
});
registerChannelIdentityRoutes(app, channelIdentityManager, requirePermission);

async function restoreChannelLogo() {
  return obs.ensureChannelLogo(`${publicBaseUrl()}/channel-logo`);
}

async function restorePublishedOverlays() {
  const restored: Array<{ template: string; sceneName: string; inputName: string; url: string }> = [];
  for (const template of overlaySlotTemplates) {
    const published = (await getConfiguredOverlay(template)) ?? (await getPublishedOverlay(template));
    if (!published?.public_url || !published?.version_id) continue;
    const url = absoluteOverlayUrl(published.public_url);
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
  const saved = await setAutopilotConfig({ ...current, ...update });
  if (saved.enabled) {
    streamSupervisorPaused = false;
    streamSupervisorNextAttemptAt = null;
    scheduleStreamSupervisor('autopilot-enabled');
  }
  return saved;
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
  const text = cleanArticleTextForBroadcast(article.main_text ?? article.excerpt ?? article.title, 24_000);
  const summary = summarize(text);
  const script = makeScript(article.title, summary, article.source_name ?? 'der Quelle');
  await saveArticlePackage(article.id, summary, script, summary, `${article.title}: ${summary}`);
  return (await getArticleDetail(article.id)) ?? article;
}
async function processArticleWithAi(article: NonNullable<Awaited<ReturnType<typeof getArticleDetail>>>) {
  const sourceText = cleanArticleTextForBroadcast(article.main_text ?? article.excerpt ?? article.title, 24_000);
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
    promptVersion: 'editorial-openrouter-v2',
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
app.get('/api/articles/:id/tts/audio', async (req, reply) => {
  const a = await getArticleDetail((req.params as any).id);
  if (!a) throw apiError(404, 'Artikel nicht gefunden');
  if (!a.audio_path) throw apiError(404, 'Kein Sprecher-Audio für den Artikel vorhanden');
  const buf = await readStoredFile(a.audio_path);
  return reply.headers(cacheHeaders('audio/wav', true)).send(buf);
});
app.get('/api/overlay/main', async () => {
  const published = await getPublishedOverlay('main-news');
  const playback = await getPlaybackState<any>();
  const article = playback?.articleId ? await getArticleDetail(playback.articleId) : null;
  return {
    article: publicArticle(article),
    channel: { name: process.env.CHANNEL_NAME ?? 'Mein Kanal' },
    playback,
    overlay: published?.snapshot ?? null,
    versionId: published?.version_id ?? null,
    serverTime: new Date().toISOString(),
  };
});

const mediaDir = process.env.MEDIA_UPLOAD_DIR ?? 'generated/media';
const overlayProjectSchema = z.object({
  name: z.string().trim().min(1).max(120),
  template: z
    .enum(['main-news', 'breaking-news', 'lower-third', 'ticker', 'maintenance', 'fullscreen-graphic', 'live-studio'])
    .default('main-news'),
  width: z.union([z.literal(1920), z.literal(1080)]).default(1920),
  height: z.union([z.literal(1080), z.literal(1920)]).default(1080),
});
app.get('/api/overlays', async () => listOverlayProjects());
app.post('/api/overlays', async (req, reply) => {
  requirePermission(req, reply, 'obs:write');
  const b = overlayProjectSchema.parse(req.body);
  const snapshot = createTemplate(b.template, b.width, b.height, process.env.CHANNEL_NAME ?? 'Mein Kanal');
  const p = await createOverlayProject({ ...b, snapshot, userId: req.user?.id });
  return { project: p, draft: await latestOverlayDraft(p.id) };
});
app.patch('/api/overlays/:id', async (req, reply) => {
  requirePermission(req, reply, 'obs:write');
  const input = z
    .object({ name: z.string().trim().min(1).max(120) })
    .strict()
    .parse(req.body);
  const project = await updateOverlayProject((req.params as any).id, input);
  if (!project) throw apiError(404, 'Overlay-Projekt nicht gefunden');
  return { project };
});
app.get('/api/overlays/:id', async (req) => {
  const id = (req.params as any).id;
  const project = await getOverlayProject(id);
  if (!project) throw apiError(404, 'Overlay-Projekt nicht gefunden');
  return {
    project,
    draft: await ensureEditableOverlayDraft(id, req.user?.id),
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
  const snapshot = createTemplate(
    project.template as any,
    project.width,
    project.height,
    process.env.CHANNEL_NAME ?? 'Mein Kanal',
  );
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
  const input = z
    .object({ name: z.string().trim().min(1).max(120).optional() })
    .strict()
    .parse(req.body ?? {});
  return duplicateOverlayProject((req.params as any).id, req.user?.id, input.name);
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
    channel: { name: process.env.CHANNEL_NAME ?? 'Mein Kanal' },
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
  const mediaId = (req.params as any).id;
  if (!(req as any).user && !(await isArticleVisualMedia(mediaId)))
    throw apiError(401, 'Authentifizierung erforderlich');
  const m = await getMediaAsset(mediaId);
  if (!m?.storage_path) throw apiError(404, 'Medium nicht gefunden');
  const buf = await readStoredFile(m.storage_path);
  return reply.headers(cacheHeaders(m.mime_type, true)).send(buf);
});
app.get('/media/:id/derivatives/:label', async (req, reply) => {
  const mediaId = (req.params as any).id;
  if (!(req as any).user && !(await isPublicMediaInPublishedOverlay(mediaId)) && !(await isArticleVisualMedia(mediaId)))
    throw apiError(403, 'Medium ist nicht öffentlich veröffentlicht');
  const m = await getMediaAsset(mediaId);
  const label = (req.params as any).label;
  const derivative = m?.derivative_paths?.[label];
  if (derivative?.path) {
    try {
      const buf = await readStoredFile(derivative.path);
      return reply.headers(cacheHeaders(derivative.mime ?? 'image/webp')).send(buf);
    } catch (error) {
      if (
        (error as NodeJS.ErrnoException).code !== 'ENOENT' ||
        !m?.storage_path ||
        !m.mime_type?.startsWith('image/')
      ) {
        throw error;
      }
    }
  }
  if (!m?.storage_path || !m.mime_type?.startsWith('image/')) throw apiError(404, 'Ableitung nicht gefunden');
  const buf = await readStoredFile(m.storage_path);
  return reply.headers(cacheHeaders(m.mime_type)).send(buf);
});

const playlistSettingsSchema = z
  .object({
    pauseSeconds: z.number().int().min(0).max(600).default(5),
    transition: z.enum(['clean', 'fade', 'headline', 'bumper']).default('fade'),
    repeatPolicy: z.enum(['none', 'recent-published', 'loop']).default('recent-published'),
    targetRuntimeMinutes: z
      .number()
      .int()
      .min(1)
      .max(24 * 60)
      .default(30),
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
app.get('/api/stream/status', async () => {
  const [stream, autoStart] = await Promise.all([obs.getStreamStatus(), automaticStreamStartEnabled()]);
  return {
    ...stream,
    autoStart,
    supervisorPaused: streamSupervisorPaused,
    supervisorRunning: streamSupervisorRunning,
    supervisorFailures: streamSupervisorFailures,
    supervisorLastError: streamSupervisorLastError,
    supervisorNextAttemptAt: streamSupervisorNextAttemptAt
      ? new Date(streamSupervisorNextAttemptAt).toISOString()
      : null,
  };
});
app.post('/api/stream/start', async (req, reply) => {
  requirePermission(req, reply, 'obs:write');
  streamSupervisorPaused = false;
  streamSupervisorNextAttemptAt = null;
  await restorePublishedOverlays();
  await restoreChannelLogo();
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
  const [obsProcess, playback, streamStatus, autoStart] = await Promise.all([
    obsProcessStatus(),
    getPlaybackState(),
    obs.getStreamStatus().catch(() => null),
    automaticStreamStartEnabled(),
  ]);
  return {
    ...obs.getState(),
    process: obsProcess,
    playback,
    stream: streamStatus,
    streamProfile: streamProfile(),
    streamSupervisor: {
      autoStart,
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
app.get('/api/obs/overlays', async () => {
  const projects = await listOverlayProjects();
  const versionsByProject = new Map<string, any[]>();
  await Promise.all(
    projects.map(async (project: any) => {
      versionsByProject.set(project.id, await overlayVersions(project.id));
    }),
  );
  const slots = await Promise.all(
    overlaySlotTemplates.map(async (template) => {
      const target = OVERLAY_INPUTS[template];
      const configured = await getConfiguredOverlay(template);
      const published = await getPublishedOverlay(template);
      return {
        template,
        label: overlaySlotLabels[template] ?? template,
        sceneName: target.sceneName,
        inputName: target.inputName,
        configured: configured
          ? {
              projectId: configured.id,
              projectName: configured.name,
              versionId: configured.version_id,
              version: configured.published_version ?? configured.version,
              url: configured.obs_configured_url ?? configured.public_url,
              configuredAt: configured.obs_configured_at,
            }
          : null,
        published: published
          ? {
              projectId: published.id,
              projectName: published.name,
              versionId: published.version_id,
              version: published.published_version ?? published.version,
              url: published.public_url,
            }
          : null,
        projects: projects
          .filter((project: any) => project.template === template)
          .map((project: any) => ({
            ...project,
            versions: versionsByProject.get(project.id) ?? [],
          })),
      };
    }),
  );
  return { slots, obs: obs.getState(), serverTime: new Date().toISOString() };
});
app.post('/api/obs/overlays/:template/apply', async (req, reply) => {
  requirePermission(req, reply, 'obs:write');
  const template = String((req.params as any).template ?? '');
  if (!overlaySlotTemplates.includes(template)) throw apiError(404, 'Unbekannter OBS-Overlay-Slot');
  const body = z
    .object({
      projectId: z.string().uuid(),
      versionId: z.string().uuid().optional(),
    })
    .parse(req.body ?? {});
  const project = await getOverlayProject(body.projectId);
  if (!project) throw apiError(404, 'Overlay-Projekt nicht gefunden');
  if (project.template !== template) {
    throw apiError(409, `Overlay-Typ passt nicht zum OBS-Slot: ${project.template} statt ${template}`);
  }
  const versions = await overlayVersions(project.id);
  const selected =
    versions.find((version: any) => version.id === body.versionId) ??
    (await latestOverlayDraft(project.id)) ??
    (await latestOverlayVersion(project.id));
  if (!selected) throw apiError(409, 'Dieses Overlay hat keine verwendbare Version.');
  let publicUrl = (project as any).public_url as string | undefined;
  if (!publicUrl) {
    const publicToken = randomBytes(32).toString('base64url');
    publicUrl = makeOverlayPublicUrl(publicToken, project.template);
    await ensureOverlayPublicIdentity(project.id, tokenHash(publicToken), publicUrl, randomBytes(12).toString('hex'));
  }
  const version =
    selected.status === 'published' ? selected : await publishOverlayVersion(project.id, selected.id, req.user?.id);
  const absoluteUrl = absoluteOverlayUrl(publicUrl);
  const target = await obs.ensureBrowserOverlay({
    template,
    url: absoluteUrl,
    width: project.width,
    height: project.height,
  });
  const updatedProject = await rememberObsOverlaySource({
    projectId: project.id,
    sceneName: target.sceneName,
    inputName: target.inputName,
    url: absoluteUrl,
    versionId: version.id,
    width: project.width,
    height: project.height,
  });
  await appendLiveEvent({
    type: 'overlay-version-changed',
    overlayVersionId: version.id,
    payload: {
      projectId: project.id,
      versionId: version.id,
      publicUrl: absoluteUrl,
      template,
      reason: 'obs-slot-applied',
    },
    dedupeKey: `overlay-applied:${template}:${version.id}:${Date.now()}`,
  });
  return { ok: true, template, target, project: updatedProject, version, publicUrl: absoluteUrl };
});
app.post('/api/obs/overlays/restore', async (req, reply) => {
  requirePermission(req, reply, 'obs:write');
  const restored = await restorePublishedOverlays();
  await setSetting('obs_status', obs.getState());
  return { ok: true, restored, obs: obs.getState() };
});
app.get('/api/live/status', async (req, reply) => {
  requirePermission(req, reply, 'obs:write');
  return liveStatusSnapshot();
});
app.patch('/api/live/settings', async (req, reply) => {
  requirePermission(req, reply, 'obs:write');
  const body = z
    .object({
      transition: z.enum(['cut', 'fade', 'swipe', 'slide', 'luma_wipe']).optional(),
      transitionDurationMs: z.number().int().min(0).max(5000).optional(),
      sourceTransition: z.enum(['cut', 'fade', 'slide', 'zoom', 'wipe']).optional(),
      sourceTransitionDurationMs: z.number().int().min(0).max(3000).optional(),
      sourceAutoLayout: z.boolean().optional(),
      sourceOverlayEnabled: z.boolean().optional(),
      sourceLabelStyle: z.enum(['lower-third', 'badge', 'minimal']).optional(),
      reactionYoutubeSourceId: z.string().min(1).nullable().optional(),
      reactionCameraSourceIds: z.array(z.string().min(1)).max(8).optional(),
      reactionPosition: z.enum(['left', 'right', 'top', 'bottom']).optional(),
      reactionSizePercent: z.number().int().min(15).max(45).optional(),
      reactionGap: z.number().int().min(0).max(80).optional(),
      reactionStyle: z.enum(['neon', 'news', 'glass', 'clean']).optional(),
      reactionAnimation: z.enum(['fade', 'slide', 'pop', 'pulse']).optional(),
      reactionTitle: z.string().trim().min(1).max(80).optional(),
      reactionAccentColor: z
        .string()
        .regex(/^#[0-9a-f]{6}$/i)
        .optional(),
      stingers: z
        .object({
          'live-now': liveStingerProfileSchema.optional(),
          'breaking-news': liveStingerProfileSchema.optional(),
          'back-to-program': liveStingerProfileSchema.optional(),
        })
        .optional(),
    })
    .parse(req.body ?? {});
  const current = await getLiveStudioSettings();
  const stingers = liveStingerProfiles(current.stinger_settings);
  const settings = await updateLiveStudioSettings({
    transition: body.transition as LiveStudioTransition | undefined,
    transitionDurationMs: body.transitionDurationMs,
    sourceTransition: body.sourceTransition as LiveStudioSourceTransition | undefined,
    sourceTransitionDurationMs: body.sourceTransitionDurationMs,
    sourceAutoLayout: body.sourceAutoLayout,
    sourceOverlayEnabled: body.sourceOverlayEnabled,
    sourceLabelStyle: body.sourceLabelStyle as LiveStudioSourceLabelStyle | undefined,
    reactionYoutubeSourceId: body.reactionYoutubeSourceId,
    reactionCameraSourceIds: body.reactionCameraSourceIds,
    reactionPosition: body.reactionPosition,
    reactionSizePercent: body.reactionSizePercent,
    reactionGap: body.reactionGap,
    reactionStyle: body.reactionStyle,
    reactionAnimation: body.reactionAnimation,
    reactionTitle: body.reactionTitle,
    reactionAccentColor: body.reactionAccentColor,
    stingerSettings: body.stingers ? { ...stingers, ...body.stingers } : undefined,
  });
  await obs.setCurrentTransition(settings.transition, settings.transition_duration_ms);
  await appendLiveStudioChange('settings-updated');
  return { ok: true, ...(await liveStatusSnapshot()) };
});
app.post('/api/live/reaction/activate', async (req, reply) => {
  requirePermission(req, reply, 'obs:write');
  const body = z
    .object({
      youtubeSourceId: z.string().min(1).optional(),
      cameraSourceIds: z.array(z.string().min(1)).max(8).optional(),
      position: z.enum(['left', 'right', 'top', 'bottom']).optional(),
      sizePercent: z.number().int().min(15).max(45).optional(),
      gap: z.number().int().min(0).max(80).optional(),
      style: z.enum(['neon', 'news', 'glass', 'clean']).optional(),
      animation: z.enum(['fade', 'slide', 'pop', 'pulse']).optional(),
      title: z.string().trim().min(1).max(80).optional(),
      accentColor: z
        .string()
        .regex(/^#[0-9a-f]{6}$/i)
        .optional(),
    })
    .parse(req.body ?? {});
  const [current, sources] = await Promise.all([getLiveStudioSettings(), listLiveStudioSources()]);
  const youtubeSources = sources.filter((source) => source.last_portal_state?.kind === 'youtube');
  const youtubeSourceId = body.youtubeSourceId ?? current.reaction_youtube_source_id ?? youtubeSources[0]?.source_id;
  const youtubeSource = sources.find((source) => source.source_id === youtubeSourceId);
  if (!youtubeSource || youtubeSource.last_portal_state?.kind !== 'youtube') {
    throw apiError(409, 'Für den Reaction-Modus muss zuerst eine YouTube-Live-Quelle ausgewählt werden.');
  }
  const defaultCameras = sources
    .filter((source) => source.last_portal_state?.kind !== 'youtube' && !source.hidden)
    .map((source) => source.source_id);
  const savedCameras = current.reaction_camera_source_ids?.length ? current.reaction_camera_source_ids : defaultCameras;
  const cameraSourceIds = [...new Set(body.cameraSourceIds ?? savedCameras)].filter((sourceId) =>
    sources.some((source) => source.source_id === sourceId && source.last_portal_state?.kind !== 'youtube'),
  );
  if (cameraSourceIds.length === 0) {
    throw apiError(409, 'Wähle mindestens eine Kamera- oder Smartphone-Quelle für die Live-Reaction aus.');
  }
  for (const sourceId of [youtubeSourceId, ...cameraSourceIds]) {
    await updateLiveStudioSource(sourceId, { hidden: false });
  }
  await setLiveStudioProgramSource(youtubeSourceId);
  const previousLayout = current.layout === 'reaction' ? current.reaction_previous_layout : current.layout;
  const settings = await updateLiveStudioSettings({
    enabled: true,
    layout: 'reaction',
    sourceAutoLayout: false,
    reactionEnabled: true,
    reactionPreviousLayout: previousLayout,
    reactionPreviousAutoLayout:
      current.layout === 'reaction' ? current.reaction_previous_auto_layout : current.source_auto_layout,
    reactionYoutubeSourceId: youtubeSourceId,
    reactionCameraSourceIds: cameraSourceIds,
    reactionPosition: body.position,
    reactionSizePercent: body.sizePercent,
    reactionGap: body.gap,
    reactionStyle: body.style,
    reactionAnimation: body.animation,
    reactionTitle: body.title,
    reactionAccentColor: body.accentColor,
    programSourceId: youtubeSourceId,
  });
  const updatedSources = await listLiveStudioSources();
  await obs.ensureLiveStudioScene((await liveOverlayUrl()) ?? `${publicBaseUrl()}/overlay/live-studio`);
  await enqueueLiveSourceChange(() =>
    performLiveSourceTransition({
      settings,
      kind: 'reaction',
      sourceName: settings.reaction_title,
      layout: 'reaction',
      operation: async () => {
        await applyConfiguredLiveLayout(settings, updatedSources);
        await obs.setCurrentTransition(settings.transition, settings.transition_duration_ms);
        await obs.setScene(LIVE_STUDIO_SCENE);
        await obs.setLiveOverlayVisible(settings.overlay_visible);
      },
    }),
  );
  await appendLiveStudioChange('reaction-activated', { youtubeSourceId, cameraSourceIds });
  return { ok: true, ...(await liveStatusSnapshot()) };
});
app.post('/api/live/reaction/deactivate', async (req, reply) => {
  requirePermission(req, reply, 'obs:write');
  const current = await getLiveStudioSettings();
  const nextLayout = current.reaction_previous_layout ?? 'grid';
  const settings = await updateLiveStudioSettings({
    layout: nextLayout,
    sourceAutoLayout: current.reaction_previous_auto_layout,
    reactionEnabled: false,
  });
  const sources = await listLiveStudioSources();
  await enqueueLiveSourceChange(() =>
    performLiveSourceTransition({
      settings: current,
      kind: 'reaction',
      sourceName: 'Zurück zur Live-Regie',
      layout: nextLayout,
      operation: () => applyConfiguredLiveLayout(settings, sources),
    }),
  );
  await appendLiveStudioChange('reaction-deactivated', { layout: nextLayout });
  return { ok: true, ...(await liveStatusSnapshot()) };
});
const liveTransitionSchema = z.object({
  transition: z.enum(['cut', 'fade', 'swipe', 'slide', 'luma_wipe']).default('fade'),
  durationMs: z.number().int().min(0).max(5000).default(450),
});
const liveStingerSchema = z.object({
  kind: z.enum(liveStingerKinds).default('live-now'),
  durationMs: z.number().int().min(250).max(10_000).optional(),
});
function liveStingerUrl(kind: LiveStingerKind, profile: LiveStingerProfile) {
  const query = new URLSearchParams({
    kicker: profile.kicker,
    title: profile.title,
    subtitle: profile.subtitle,
    accentColor: profile.accentColor,
    animation: profile.animation,
    soundEnabled: String(profile.soundEnabled),
    volume: String(profile.volume),
    durationMs: String(profile.durationMs),
  });
  return `${publicBaseUrl()}/overlay/live-studio/stinger/${encodeURIComponent(kind)}?${query}`;
}
function liveSourceSwitchUrl(input: {
  kind: 'add' | 'remove' | 'take' | 'layout' | 'show' | 'hide' | 'reorder' | 'reaction';
  sourceName?: string;
  layout: LiveStudioLayout;
  animation: LiveStudioSourceTransition;
  durationMs: number;
}) {
  const query = new URLSearchParams({
    kind: input.kind,
    sourceName: input.sourceName ?? '',
    layout: input.layout,
    animation: input.animation,
    durationMs: String(input.durationMs),
  });
  return `${publicBaseUrl()}/overlay/live-studio/source-switch?${query}`;
}
let liveSourceChangeQueue: Promise<unknown> = Promise.resolve();
function enqueueLiveSourceChange<T>(task: () => Promise<T>): Promise<T> {
  const next = liveSourceChangeQueue.then(task, task);
  liveSourceChangeQueue = next.then(
    () => undefined,
    () => undefined,
  );
  return next;
}
async function performLiveSourceTransition<T>(input: {
  settings: Awaited<ReturnType<typeof getLiveStudioSettings>>;
  kind: 'add' | 'remove' | 'take' | 'layout' | 'show' | 'hide' | 'reorder' | 'reaction';
  sourceName?: string;
  layout: LiveStudioLayout;
  operation: () => Promise<T>;
}) {
  const { settings } = input;
  const durationMs = settings.source_transition === 'cut' ? 0 : settings.source_transition_duration_ms;
  if (!settings.source_overlay_enabled || durationMs <= 0) return input.operation();
  await obs.beginLiveSourceTransition(
    liveSourceSwitchUrl({
      kind: input.kind,
      sourceName: input.sourceName,
      layout: input.layout,
      animation: settings.source_transition,
      durationMs,
    }),
  );
  const leadMs = Math.min(400, Math.max(100, Math.round(durationMs * 0.35)));
  try {
    await new Promise((resolve) => setTimeout(resolve, leadMs));
    const result = await input.operation();
    await new Promise((resolve) => setTimeout(resolve, Math.max(0, durationMs - leadMs)));
    return result;
  } finally {
    await obs.endLiveSourceTransition();
  }
}
app.post('/api/live/mode', async (req, reply) => {
  requirePermission(req, reply, 'obs:write');
  const body = z
    .object({
      enabled: z.boolean().default(true),
      takeProgram: z.boolean().default(true),
      transition: z.enum(['cut', 'fade', 'swipe', 'slide', 'luma_wipe']).optional(),
      durationMs: z.number().int().min(0).max(5000).optional(),
    })
    .parse(req.body ?? {});
  const overlay = await liveOverlayUrl();
  await obs.ensureLiveStudioScene(overlay ?? `${publicBaseUrl()}/overlay/live-studio`);
  const settings = await updateLiveStudioSettings({
    enabled: body.enabled,
    transition: body.transition as LiveStudioTransition | undefined,
    transitionDurationMs: body.durationMs,
  });
  const sources = await listLiveStudioSources();
  await applyConfiguredLiveLayout(settings, sources);
  await obs.setLiveOverlayVisible(settings.overlay_visible);
  if (body.takeProgram) {
    await obs.setCurrentTransition(settings.transition, settings.transition_duration_ms);
    await obs.setScene(LIVE_STUDIO_SCENE);
  }
  await setSetting('obs_status', obs.getState());
  return { ok: true, ...(await liveStatusSnapshot()) };
});
app.post('/api/live/activate', async (req, reply) => {
  requirePermission(req, reply, 'obs:write');
  const body = liveStingerSchema
    .extend({
      transition: z.enum(['cut', 'fade', 'swipe', 'slide', 'luma_wipe']).optional(),
      disableAutopilot: z.boolean().default(true),
    })
    .parse(req.body ?? {});
  if (body.disableAutopilot) await setAutopilotConfig({ ...(await getAutopilotConfig()), enabled: false });
  await obs.pauseMedia().catch(() => undefined);
  const overlay = (await liveOverlayUrl()) ?? `${publicBaseUrl()}/overlay/live-studio`;
  await obs.ensureLiveStudioScene(overlay);
  const settings = await updateLiveStudioSettings({
    enabled: true,
    transition: body.transition as LiveStudioTransition | undefined,
  });
  const profile = liveStingerProfiles(settings.stinger_settings)[body.kind];
  if (body.durationMs !== undefined) profile.durationMs = body.durationMs;
  await obs.setCurrentTransition(settings.transition, settings.transition_duration_ms);
  if (profile.enabled) {
    await obs.playLiveStingerScene({
      url: liveStingerUrl(body.kind, profile),
      durationMs: profile.durationMs,
      nextSceneName: LIVE_STUDIO_SCENE,
    });
  } else {
    await obs.setScene(LIVE_STUDIO_SCENE);
  }
  await obs.setLiveOverlayVisible(settings.overlay_visible);
  await appendLiveStudioChange('live-activated');
  return { ok: true, ...(await liveStatusSnapshot()) };
});
app.post('/api/live/sources/youtube', async (req, reply) => {
  requirePermission(req, reply, 'obs:write');
  const body = z
    .object({
      url: z.string().trim().min(1).max(500),
      name: z.string().trim().min(1).max(100).optional(),
      muted: z.boolean().default(false),
    })
    .parse(req.body ?? {});
  const youtube = youtubeLiveSource(body.url);
  const [existingSources, settings] = await Promise.all([listLiveStudioSources(), getLiveStudioSettings()]);
  const existing = existingSources.find((source) => source.source_id === youtube.sourceId);
  const saved = await upsertLiveStudioSource({
    sourceId: youtube.sourceId,
    inputName: liveStudioInputName(youtube.sourceId),
    displayName: body.name ?? existing?.display_name ?? 'YouTube Live',
    userName: 'YouTube',
    viewerUrl: youtube.viewerUrl,
    muted: existing?.muted ?? body.muted,
    hidden: existing?.hidden ?? false,
    slotIndex: existing?.slot_index ?? existingSources.length,
    inProgram: existing?.in_program ?? false,
    portalState: {
      kind: 'youtube',
      videoId: youtube.videoId,
      previewUrl: youtube.previewUrl,
      canonicalUrl: youtube.canonicalUrl,
    },
  });
  const sources = await listLiveStudioSources();
  const visibleCount = sources.filter((source) => !source.hidden).length;
  const effectiveSettings = settings.source_auto_layout
    ? await updateLiveStudioSettings({ layout: recommendedLiveLayout(visibleCount) })
    : settings;
  await enqueueLiveSourceChange(() =>
    performLiveSourceTransition({
      settings: effectiveSettings,
      kind: 'add',
      sourceName: saved.display_name,
      layout: effectiveSettings.layout,
      operation: () =>
        obs.ensureLiveSource({
          sourceId: saved.source_id,
          viewerUrl: youtube.viewerUrl,
          muted: saved.muted,
          hidden: saved.hidden,
          index: saved.slot_index,
          layout: effectiveSettings.layout,
          sources: liveSourceLayouts(sources, effectiveSettings),
        }),
    }),
  );
  await appendLiveStudioChange('youtube-source-added', {
    sourceId: saved.source_id,
    sourceName: saved.display_name,
  });
  return { ok: true, source: saved, ...(await liveStatusSnapshot()) };
});
app.post('/api/live/sources/:id/add', async (req, reply) => {
  requirePermission(req, reply, 'obs:write');
  const sourceId = String((req.params as any).id ?? '');
  if (!sourceId) throw apiError(400, 'Live-Quelle fehlt');
  const [portalSources, existingSources, settings] = await Promise.all([
    livePortal.listSources(),
    listLiveStudioSources(),
    getLiveStudioSettings(),
  ]);
  const source = portalSources.sources.find((candidate) => candidate.id === sourceId);
  if (!source) throw apiError(404, 'Live-Quelle ist im Portal nicht aktiv');
  const viewer = await livePortal.createViewer(sourceId);
  const slotIndex =
    existingSources.find((candidate) => candidate.source_id === sourceId)?.slot_index ?? existingSources.length;
  const inputName = liveStudioInputName(sourceId);
  const saved = await upsertLiveStudioSource({
    sourceId,
    inputName,
    displayName: source.name,
    userName: source.user ?? null,
    viewerUrl: viewer.viewerUrl,
    slotIndex,
    portalState: source,
  });
  const nextSources = await listLiveStudioSources();
  const visibleCount = nextSources.filter((candidate) => !candidate.hidden).length;
  const effectiveSettings = settings.source_auto_layout
    ? await updateLiveStudioSettings({ layout: recommendedLiveLayout(visibleCount) })
    : settings;
  await enqueueLiveSourceChange(() =>
    performLiveSourceTransition({
      settings: effectiveSettings,
      kind: 'add',
      sourceName: saved.display_name,
      layout: effectiveSettings.layout,
      operation: () =>
        obs.ensureLiveSource({
          sourceId,
          viewerUrl: viewer.viewerUrl,
          muted: saved.muted,
          hidden: saved.hidden,
          index: saved.slot_index,
          layout: effectiveSettings.layout,
          sources: liveSourceLayouts(nextSources, effectiveSettings),
        }),
    }),
  );
  await appendLiveStudioChange('source-added', { sourceId, sourceName: saved.display_name });
  return { ok: true, source: saved, viewer, ...(await liveStatusSnapshot()) };
});
app.delete('/api/live/sources/:id', async (req, reply) => {
  requirePermission(req, reply, 'obs:write');
  const sourceId = String((req.params as any).id ?? '');
  const existing = (await listLiveStudioSources()).find((source) => source.source_id === sourceId);
  await removeLiveStudioSource(sourceId);
  let [settings, sources] = await Promise.all([getLiveStudioSettings(), listLiveStudioSources()]);
  if (settings.reaction_enabled && settings.reaction_youtube_source_id === sourceId) {
    settings = await updateLiveStudioSettings({
      layout: settings.reaction_previous_layout,
      sourceAutoLayout: settings.reaction_previous_auto_layout,
      reactionEnabled: false,
      reactionYoutubeSourceId: null,
    });
  } else if (settings.reaction_camera_source_ids.includes(sourceId)) {
    const remainingCameras = settings.reaction_camera_source_ids.filter((candidate) => candidate !== sourceId);
    settings = await updateLiveStudioSettings({
      reactionCameraSourceIds: remainingCameras,
      ...(settings.reaction_enabled && remainingCameras.length === 0
        ? {
            layout: settings.reaction_previous_layout,
            sourceAutoLayout: settings.reaction_previous_auto_layout,
            reactionEnabled: false,
          }
        : {}),
    });
  }
  const visibleCount = sources.filter((candidate) => !candidate.hidden).length;
  const effectiveSettings = settings.source_auto_layout
    ? await updateLiveStudioSettings({ layout: recommendedLiveLayout(visibleCount) })
    : settings;
  await enqueueLiveSourceChange(() =>
    performLiveSourceTransition({
      settings: effectiveSettings,
      kind: 'remove',
      sourceName: existing?.display_name,
      layout: effectiveSettings.layout,
      operation: async () => {
        await obs.removeLiveSource(sourceId);
        await applyConfiguredLiveLayout(effectiveSettings, sources);
      },
    }),
  );
  await appendLiveStudioChange('source-removed', { sourceId, sourceName: existing?.display_name });
  return { ok: true, ...(await liveStatusSnapshot()) };
});
app.patch('/api/live/sources/:id', async (req, reply) => {
  requirePermission(req, reply, 'obs:write');
  const sourceId = String((req.params as any).id ?? '');
  const body = z
    .object({
      muted: z.boolean().optional(),
      hidden: z.boolean().optional(),
      index: z.number().int().min(0).max(64).optional(),
      preview: z.boolean().optional(),
      program: z.boolean().optional(),
    })
    .parse(req.body ?? {});
  const previousSources = await listLiveStudioSources();
  let updated = await updateLiveStudioSource(sourceId, {
    muted: body.muted,
    hidden: body.hidden,
    in_program: body.program ? true : undefined,
  });
  if (!updated) throw apiError(404, 'Live-Quelle ist nicht in OBS hinzugefügt');
  if (body.index !== undefined) {
    const ordered = previousSources.filter((source) => source.source_id !== sourceId);
    const targetIndex = Math.max(0, Math.min(body.index, ordered.length));
    ordered.splice(targetIndex, 0, updated);
    for (let index = 0; index < ordered.length; index += 1) {
      const reordered = await updateLiveStudioSource(ordered[index].source_id, { slot_index: index });
      if (ordered[index].source_id === sourceId && reordered) updated = reordered;
    }
  }
  const programSource = body.program ? await setLiveStudioProgramSource(sourceId) : updated;
  let settings = await updateLiveStudioSettings({
    previewSourceId: body.preview ? sourceId : undefined,
    programSourceId: body.program ? sourceId : undefined,
  });
  const sources = await listLiveStudioSources();
  if (body.hidden !== undefined && settings.source_auto_layout) {
    settings = await updateLiveStudioSettings({
      layout: recommendedLiveLayout(sources.filter((candidate) => !candidate.hidden).length),
    });
  }
  const visualChange = body.hidden !== undefined || body.index !== undefined || Boolean(body.program);
  const kind = body.program ? 'take' : body.hidden === true ? 'hide' : body.hidden === false ? 'show' : 'reorder';
  await enqueueLiveSourceChange(async () => {
    if (visualChange) {
      await performLiveSourceTransition({
        settings,
        kind,
        sourceName: updated.display_name,
        layout: settings.layout,
        operation: async () => {
          await obs.setLiveSourceState(sourceId, { muted: body.muted, hidden: body.hidden, index: body.index });
          await applyConfiguredLiveLayout(settings, sources);
        },
      });
    } else {
      await obs.setLiveSourceState(sourceId, { muted: body.muted, hidden: body.hidden, index: body.index });
    }
  });
  await appendLiveStudioChange('source-updated', { sourceId, kind });
  return { ok: true, source: programSource, ...(await liveStatusSnapshot()) };
});
app.post('/api/live/layout', async (req, reply) => {
  requirePermission(req, reply, 'obs:write');
  const body = z.object({ layout: z.enum(['fullscreen', 'split', 'grid', 'pip']) }).parse(req.body ?? {});
  const settings = await updateLiveStudioSettings({
    layout: body.layout as LiveStudioLayout,
    sourceAutoLayout: false,
    reactionEnabled: false,
  });
  const sources = await listLiveStudioSources();
  await enqueueLiveSourceChange(() =>
    performLiveSourceTransition({
      settings,
      kind: 'layout',
      layout: settings.layout,
      operation: () => applyConfiguredLiveLayout(settings, sources),
    }),
  );
  await appendLiveStudioChange('layout-changed', { layout: settings.layout });
  return { ok: true, ...(await liveStatusSnapshot()) };
});
app.post('/api/live/transition', async (req, reply) => {
  requirePermission(req, reply, 'obs:write');
  const body = liveTransitionSchema.parse(req.body ?? {});
  const settings = await updateLiveStudioSettings({
    transition: body.transition as LiveStudioTransition,
    transitionDurationMs: body.durationMs,
  });
  await obs.setCurrentTransition(settings.transition, settings.transition_duration_ms);
  return { ok: true, ...(await liveStatusSnapshot()) };
});
app.post('/api/live/stinger', async (req, reply) => {
  requirePermission(req, reply, 'obs:write');
  const body = liveStingerSchema.parse(req.body ?? {});
  const settings = await getLiveStudioSettings();
  const profile = liveStingerProfiles(settings.stinger_settings)[body.kind];
  if (body.durationMs !== undefined) profile.durationMs = body.durationMs;
  if (profile.enabled)
    await obs.showLiveStinger({ url: liveStingerUrl(body.kind, profile), durationMs: profile.durationMs });
  return { ok: true, ...(await liveStatusSnapshot()) };
});
app.post('/api/live/preview', async (req, reply) => {
  requirePermission(req, reply, 'obs:write');
  await obs.ensureLiveStudioScene((await liveOverlayUrl()) ?? `${publicBaseUrl()}/overlay/live-studio`);
  await obs.setPreviewScene(LIVE_STUDIO_SCENE);
  const settings = await updateLiveStudioSettings({ enabled: true });
  await obs.setLiveOverlayVisible(settings.overlay_visible);
  return { ok: true, ...(await liveStatusSnapshot()) };
});
app.post('/api/live/take', async (req, reply) => {
  requirePermission(req, reply, 'obs:write');
  const body = z
    .object({
      sourceId: z.string().min(1).optional(),
      transition: z.enum(['cut', 'fade', 'swipe', 'slide', 'luma_wipe']).optional(),
      durationMs: z.number().int().min(0).max(5000).optional(),
    })
    .parse(req.body ?? {});
  const current = await getLiveStudioSettings();
  const transition = (body.transition ?? current.transition) as LiveStudioTransition;
  const durationMs = body.durationMs ?? current.transition_duration_ms;
  let programSource = null;
  if (body.sourceId) {
    programSource = await setLiveStudioProgramSource(body.sourceId);
    if (!programSource) throw apiError(404, 'Live-Quelle ist nicht in OBS hinzugefügt');
    await updateLiveStudioSettings({ programSourceId: body.sourceId, previewSourceId: null });
  }
  const sources = await listLiveStudioSources();
  await obs.ensureLiveStudioScene((await liveOverlayUrl()) ?? `${publicBaseUrl()}/overlay/live-studio`);
  await enqueueLiveSourceChange(() =>
    performLiveSourceTransition({
      settings: current,
      kind: 'take',
      sourceName: programSource?.display_name,
      layout: current.layout,
      operation: async () => {
        await applyConfiguredLiveLayout(current, sources);
        await obs.setCurrentTransition(transition, durationMs);
        await obs.setScene(LIVE_STUDIO_SCENE);
      },
    }),
  );
  await appendLiveStudioChange('source-taken', { sourceId: body.sourceId ?? null });
  return { ok: true, source: programSource, ...(await liveStatusSnapshot()) };
});
app.post('/api/live/overlay/apply', async (req, reply) => {
  requirePermission(req, reply, 'obs:write');
  const body = z
    .object({
      projectId: z.string().uuid(),
      versionId: z.string().uuid().optional(),
      transition: z.enum(['cut', 'fade', 'swipe', 'slide', 'luma_wipe']).optional(),
      durationMs: z.number().int().min(0).max(5000).optional(),
    })
    .parse(req.body ?? {});
  const project = await getOverlayProject(body.projectId);
  if (!project) throw apiError(404, 'Overlay-Projekt nicht gefunden');
  if (project.template !== 'live-studio') throw apiError(409, 'Dieses Overlay ist kein Live-Studio-Overlay');
  const versions = await overlayVersions(project.id);
  const selected =
    versions.find((version: any) => version.id === body.versionId) ??
    (await latestOverlayDraft(project.id)) ??
    (await latestOverlayVersion(project.id));
  if (!selected) throw apiError(409, 'Dieses Overlay hat keine verwendbare Version.');
  let publicUrl = (project as any).public_url as string | undefined;
  if (!publicUrl) {
    const publicToken = randomBytes(32).toString('base64url');
    publicUrl = makeOverlayPublicUrl(publicToken, project.template);
    await ensureOverlayPublicIdentity(project.id, tokenHash(publicToken), publicUrl, randomBytes(12).toString('hex'));
  }
  const version =
    selected.status === 'published' ? selected : await publishOverlayVersion(project.id, selected.id, req.user?.id);
  const absoluteUrl = absoluteOverlayUrl(publicUrl);
  const target = await obs.ensureBrowserOverlay({
    template: 'live-studio',
    url: absoluteUrl,
    width: project.width,
    height: project.height,
  });
  await rememberObsOverlaySource({
    projectId: project.id,
    sceneName: target.sceneName,
    inputName: target.inputName,
    url: absoluteUrl,
    versionId: version.id,
    width: project.width,
    height: project.height,
  });
  const settings = await updateLiveStudioSettings({
    overlayProjectId: project.id,
    transition: body.transition as LiveStudioTransition | undefined,
    transitionDurationMs: body.durationMs,
  });
  await obs.setCurrentTransition(settings.transition, settings.transition_duration_ms);
  await appendLiveEvent({
    type: 'overlay-version-changed',
    overlayVersionId: version.id,
    payload: {
      projectId: project.id,
      versionId: version.id,
      publicUrl: absoluteUrl,
      template: 'live-studio',
      reason: 'live-regie-overlay-applied',
    },
    dedupeKey: `live-overlay-applied:${version.id}:${Date.now()}`,
  });
  return { ok: true, target, project, version, publicUrl: absoluteUrl, ...(await liveStatusSnapshot()) };
});
app.post('/api/live/overlay/visibility', async (req, reply) => {
  requirePermission(req, reply, 'obs:write');
  const body = z.object({ visible: z.boolean() }).parse(req.body ?? {});
  await obs.ensureLiveStudioScene((await liveOverlayUrl()) ?? `${publicBaseUrl()}/overlay/live-studio`);
  const settings = await updateLiveStudioSettings({ overlayVisible: body.visible });
  await obs.setLiveOverlayVisible(settings.overlay_visible);
  await appendLiveStudioChange('overlay-visibility', { visible: settings.overlay_visible });
  return { ok: true, ...(await liveStatusSnapshot()) };
});
app.post('/api/live/sources/audio', async (req, reply) => {
  requirePermission(req, reply, 'obs:write');
  const body = z.object({ muted: z.boolean() }).parse(req.body ?? {});
  const sources = await listLiveStudioSources();
  for (const source of sources) {
    await updateLiveStudioSource(source.source_id, { muted: body.muted });
    await obs.setLiveSourceState(source.source_id, { muted: body.muted }).catch(() => undefined);
  }
  await appendLiveStudioChange('all-sources-audio', { muted: body.muted });
  return { ok: true, ...(await liveStatusSnapshot()) };
});
app.post('/api/live/sources/sync', async (req, reply) => {
  requirePermission(req, reply, 'obs:write');
  const [portalSources, configured, settings] = await Promise.all([
    livePortal.listSources(),
    listLiveStudioSources(),
    getLiveStudioSettings(),
  ]);
  const portalById = new Map(portalSources.sources.map((source) => [source.id, source]));
  let refreshed = 0;
  for (const local of configured) {
    const source = portalById.get(local.source_id);
    if (!source || source.status !== 'live') continue;
    const viewer = await livePortal.createViewer(local.source_id);
    const saved = await upsertLiveStudioSource({
      sourceId: local.source_id,
      inputName: local.input_name,
      displayName: source.name,
      userName: source.user ?? null,
      viewerUrl: viewer.viewerUrl,
      muted: local.muted,
      hidden: local.hidden,
      slotIndex: local.slot_index,
      inProgram: local.in_program,
      portalState: source,
    });
    await obs.ensureLiveSource({
      sourceId: local.source_id,
      viewerUrl: viewer.viewerUrl,
      muted: saved.muted,
      hidden: saved.hidden,
      index: saved.slot_index,
    });
    refreshed += 1;
  }
  const sources = await listLiveStudioSources();
  await applyConfiguredLiveLayout(settings, sources);
  await appendLiveStudioChange('sources-synchronized', { refreshed });
  return { ok: true, refreshed, ...(await liveStatusSnapshot()) };
});
app.post('/api/live/chat', async (req, reply) => {
  requirePermission(req, reply, 'obs:write');
  const body = z
    .object({
      url: z.union([z.string().url(), z.literal(''), z.null()]).optional(),
      visible: z.boolean().optional(),
    })
    .parse(req.body ?? {});
  const nextUrl = body.url === '' ? null : body.url;
  const settings = await updateLiveStudioSettings({
    chatUrl: nextUrl === undefined ? undefined : nextUrl,
    chatVisible: body.visible,
  });
  if (!settings.chat_url) {
    await obs.removeLiveChatSource();
  } else {
    await obs.ensureLiveChatSource({ url: settings.chat_url, visible: settings.chat_visible });
  }
  return { ok: true, ...(await liveStatusSnapshot()) };
});
app.post('/api/live/program', async (req, reply) => {
  requirePermission(req, reply, 'obs:write');
  await obs.ensureLiveStudioScene((await liveOverlayUrl()) ?? `${publicBaseUrl()}/overlay/live-studio`);
  const current = await getLiveStudioSettings();
  await obs.setCurrentTransition(current.transition, current.transition_duration_ms);
  await obs.setScene(LIVE_STUDIO_SCENE);
  const settings = await updateLiveStudioSettings({ enabled: true });
  await obs.setLiveOverlayVisible(settings.overlay_visible);
  return { ok: true, ...(await liveStatusSnapshot()) };
});
app.post('/api/live/return-to-program', async (req, reply) => {
  requirePermission(req, reply, 'obs:write');
  const body = z
    .object({
      enableAutopilot: z.boolean().default(true),
      target: z.enum(['main-news', 'maintenance']).default('main-news'),
      stinger: z.enum(['back-to-program', 'breaking-news', 'live-now']).default('back-to-program'),
      durationMs: z.number().int().min(250).max(10_000).optional(),
      transition: z.enum(['cut', 'fade', 'swipe', 'slide', 'luma_wipe']).optional(),
    })
    .parse(req.body ?? {});
  const targetSceneName = body.target === 'maintenance' ? MAINTENANCE_SCENE : MAIN_NEWS_SCENE;
  const currentSettings = await getLiveStudioSettings();
  const profile = liveStingerProfiles(currentSettings.stinger_settings)[body.stinger];
  if (body.durationMs !== undefined) profile.durationMs = body.durationMs;
  if (profile.enabled) {
    await obs.playLiveStingerScene({
      url: liveStingerUrl(body.stinger, profile),
      durationMs: profile.durationMs,
      nextSceneName: targetSceneName,
    });
  } else {
    await obs.setScene(targetSceneName);
  }
  const settings = await updateLiveStudioSettings({
    enabled: false,
    layout: currentSettings.reaction_enabled ? currentSettings.reaction_previous_layout : undefined,
    sourceAutoLayout: currentSettings.reaction_enabled ? currentSettings.reaction_previous_auto_layout : undefined,
    reactionEnabled: false,
    transition: body.transition as LiveStudioTransition | undefined,
  });
  if (body.enableAutopilot) {
    const saved = await setAutopilotConfig({ ...(await getAutopilotConfig()), enabled: true });
    if (saved.enabled) {
      streamSupervisorPaused = false;
      streamSupervisorNextAttemptAt = null;
      scheduleStreamSupervisor('live-return-to-autopilot');
    }
  }
  await obs.setCurrentTransition(settings.transition, settings.transition_duration_ms);
  await obs.setScene(targetSceneName);
  if (body.target === 'main-news') await obs.resumeProgramAudio();
  await appendLiveStudioChange('returned-to-program', { target: body.target });
  return { ok: true, ...(await liveStatusSnapshot()) };
});
app.post('/api/live/stream/start', async (req, reply) => {
  requirePermission(req, reply, 'obs:write');
  await obs.ensureLiveStudioScene((await liveOverlayUrl()) ?? `${publicBaseUrl()}/overlay/live-studio`);
  await obs.setScene(LIVE_STUDIO_SCENE);
  const settings = await getLiveStudioSettings();
  await obs.setLiveOverlayVisible(settings.overlay_visible);
  const stream = await obs.startStream();
  resetStreamSupervisorFailures();
  const snapshot = await liveStatusSnapshot();
  return { ...snapshot, ok: true, stream };
});
app.post('/api/live/stream/stop', async (req, reply) => {
  requirePermission(req, reply, 'obs:write');
  streamSupervisorPaused = true;
  const stream = await obs.stopStream();
  const snapshot = await liveStatusSnapshot();
  return { ...snapshot, ok: true, stream };
});
app.post('/api/obs/process/start', async (req, reply) => {
  requirePermission(req, reply, 'obs:write');
  const status = await startObsProcess();
  if (await automaticStreamStartEnabled()) {
    streamSupervisorPaused = false;
    streamSupervisorNextAttemptAt = null;
    scheduleStreamSupervisor('obs-process-started');
  }
  return status;
});
app.post('/api/obs/process/stop', async (req, reply) => {
  requirePermission(req, reply, 'obs:write');
  return stopObsProcess();
});
app.post('/api/obs/process/restart', async (req, reply) => {
  requirePermission(req, reply, 'obs:write');
  const status = await restartObsProcess();
  if (await automaticStreamStartEnabled()) {
    streamSupervisorPaused = false;
    streamSupervisorNextAttemptAt = null;
    scheduleStreamSupervisor('obs-process-restarted');
  }
  return status;
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
    'live-studio-changed',
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
app.get('/overlay/live-studio', async (_req, reply) =>
  reply.type('text/html').send(rendererHtml('/api/overlay/live-studio')),
);
app.get('/api/overlay/live-studio', async () => {
  const configured = (await getConfiguredOverlay('live-studio')) ?? (await getPublishedOverlay('live-studio'));
  const [playback, live] = await Promise.all([getPlaybackState<any>(), liveOverlayState()]);
  const article = playback?.articleId
    ? await getArticleDetail(playback.articleId)
    : ((await getLastPlayedArticle()) ?? (await getPublishedMainArticle()));
  return {
    article: publicArticle(article),
    channel: { name: process.env.CHANNEL_NAME ?? 'Mein Kanal' },
    playback,
    live,
    overlay:
      configured?.snapshot ?? createTemplate('live-studio', 1920, 1080, process.env.CHANNEL_NAME ?? 'Mein Kanal'),
    versionId: configured?.version_id ?? null,
    version: configured?.published_version ?? configured?.version ?? 1,
    eventVersion: Number(playback?.stateRevision ?? 0),
    serverTime: new Date().toISOString(),
  };
});
app.get('/overlay/live-studio/stinger/:kind', async (req, reply) => {
  const kind = z
    .enum(liveStingerKinds)
    .catch('live-now')
    .parse((req.params as any).kind);
  const fallback = defaultLiveStingers[kind];
  const query = z
    .object({
      kicker: z.string().max(40).catch(fallback.kicker),
      title: z.string().max(100).catch(fallback.title),
      subtitle: z.string().max(180).catch(fallback.subtitle),
      accentColor: z
        .string()
        .regex(/^#[0-9a-f]{6}$/i)
        .catch(fallback.accentColor),
      animation: z.enum(['sweep', 'zoom', 'pulse', 'glitch']).catch(fallback.animation),
      soundEnabled: z
        .enum(['true', 'false'])
        .transform((value) => value === 'true')
        .catch(fallback.soundEnabled),
      volume: z.coerce.number().int().min(0).max(100).catch(fallback.volume),
      durationMs: z.coerce.number().int().min(250).max(10_000).catch(fallback.durationMs),
    })
    .parse(req.query ?? {});
  return reply.type('text/html').send(liveStingerHtml(kind, { ...fallback, ...query }));
});
app.get('/overlay/live-studio/source-switch', async (req, reply) => {
  const query = z
    .object({
      kind: z.enum(['add', 'remove', 'take', 'layout', 'show', 'hide', 'reorder', 'reaction']).catch('layout'),
      sourceName: z.string().max(100).catch(''),
      layout: z.enum(['fullscreen', 'split', 'grid', 'pip', 'reaction']).catch('grid'),
      animation: z.enum(['cut', 'fade', 'slide', 'zoom', 'wipe']).catch('fade'),
      durationMs: z.coerce.number().int().min(0).max(3000).catch(650),
    })
    .parse(req.query ?? {});
  return reply.type('text/html').send(liveSourceSwitchHtml(query));
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
  const live = template === 'live-studio' ? await liveOverlayState() : undefined;
  return {
    article: publicArticle(article),
    channel: { name: process.env.CHANNEL_NAME ?? 'Mein Kanal' },
    playback,
    live,
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
function escapeOverlayText(value: string) {
  return value.replace(
    /[&<>"']/g,
    (character) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[character]!,
  );
}
function liveStingerHtml(kind: LiveStingerKind, profile: LiveStingerProfile) {
  const tone = kind === 'breaking-news' ? 1046 : kind === 'back-to-program' ? 660 : 880;
  const outDelayMs = Math.max(0, profile.durationMs - 450);
  const gain = Math.max(0.0001, Math.min(0.3, (profile.volume / 100) * 0.24));
  return `<!doctype html><html lang="de"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><style>
html,body{margin:0;width:100%;height:100%;overflow:hidden;background:transparent;font-family:Inter,Arial,sans-serif;color:#fff}
.wrap{position:fixed;inset:0;display:grid;place-items:center;background:radial-gradient(circle at 50% 45%,rgba(255,255,255,.16),rgba(0,0,0,.78) 42%,rgba(0,0,0,.94));animation:out .45s ease ${outDelayMs}ms forwards}
.bars:before,.bars:after{content:"";position:fixed;left:-20vw;right:-20vw;height:140px;background:${profile.accentColor};filter:drop-shadow(0 0 28px ${profile.accentColor});transform:skewY(-8deg);animation:sweep .7s cubic-bezier(.2,.8,.2,1) both}.bars:before{top:16vh}.bars:after{bottom:16vh;animation-delay:.08s}
.card{text-align:center;transform:scale(.82);opacity:0;animation:pop .55s cubic-bezier(.18,1.25,.35,1) .25s forwards}
.kicker{display:inline-block;background:${profile.accentColor};color:${kind === 'breaking-news' ? '#111' : '#fff'};font-weight:1000;font-size:42px;letter-spacing:.1em;padding:14px 28px;border-radius:8px;box-shadow:0 0 34px ${profile.accentColor}}
h1{font-size:124px;line-height:.9;margin:28px 0 18px;text-shadow:0 12px 44px rgba(0,0,0,.85);letter-spacing:-.045em}
p{font-size:38px;margin:0;font-weight:800;color:#e5e7eb;text-shadow:0 6px 24px #000}
body.anim-zoom .bars:before,body.anim-zoom .bars:after{animation:zoomBar .5s ease-out both}body.anim-zoom .card{animation:zoomCard .6s cubic-bezier(.16,1,.3,1) .12s forwards}
body.anim-pulse .kicker{animation:pulse .55s ease-in-out infinite alternate}body.anim-pulse .bars:before,body.anim-pulse .bars:after{animation:pulseBar .6s ease-out both}
body.anim-glitch h1{animation:glitch .18s steps(2,end) 4 .35s}body.anim-glitch .bars:before{animation:sweep .42s ease-out both}body.anim-glitch .bars:after{animation:sweep .42s ease-out .12s both}
@keyframes sweep{from{transform:translateX(-115%) skewY(-8deg)}to{transform:translateX(0) skewY(-8deg)}}@keyframes pop{to{opacity:1;transform:scale(1)}}@keyframes out{to{opacity:0;transform:scale(1.035)}}
@keyframes zoomBar{from{transform:scaleX(0)}to{transform:scaleX(1)}}@keyframes zoomCard{from{opacity:0;transform:scale(1.45)}to{opacity:1;transform:scale(1)}}
@keyframes pulse{to{transform:scale(1.06);filter:brightness(1.25)}}@keyframes pulseBar{from{opacity:0;transform:scaleY(.1)}to{opacity:1;transform:scaleY(1)}}
@keyframes glitch{0%{translate:-12px 0;text-shadow:12px 0 ${profile.accentColor}}50%{translate:10px -4px;text-shadow:-10px 4px #00d9ff}100%{translate:0 0}}
</style></head><body class="anim-${profile.animation}"><div class="wrap"><div class="bars"></div><div class="card"><div class="kicker">${escapeOverlayText(profile.kicker)}</div><h1>${escapeOverlayText(profile.title)}</h1><p>${escapeOverlayText(profile.subtitle)}</p></div></div><script>
${profile.soundEnabled ? `(() => { try { const c=new AudioContext(); const g=c.createGain(); g.gain.value=.0001; g.connect(c.destination); const t=${tone}; [0,.11,.22].forEach((d,i)=>{ const o=c.createOscillator(); o.type='sawtooth'; o.frequency.value=t*(i===1?1.25:1); o.connect(g); o.start(c.currentTime+d); o.stop(c.currentTime+d+.085); }); g.gain.setValueAtTime(.0001,c.currentTime); g.gain.exponentialRampToValueAtTime(${gain},c.currentTime+.025); g.gain.exponentialRampToValueAtTime(.0001,c.currentTime+.52); } catch {} })();` : ''}
</script></body></html>`;
}
function liveSourceSwitchHtml(input: {
  kind: 'add' | 'remove' | 'take' | 'layout' | 'show' | 'hide' | 'reorder' | 'reaction';
  sourceName: string;
  layout: LiveStudioLayout;
  animation: LiveStudioSourceTransition;
  durationMs: number;
}) {
  const labels = {
    add: ['NEUE LIVE-QUELLE', input.sourceName || 'Quelle wird zugeschaltet'],
    remove: ['QUELLE VERLÄSST DIE SENDUNG', input.sourceName || 'Live-Quelle entfernt'],
    take: ['JETZT IM PROGRAMM', input.sourceName || 'Live-Quelle'],
    layout: ['NEUES BILDLAYOUT', input.layout === 'pip' ? 'Bild-in-Bild' : input.layout],
    show: ['QUELLE EINGEBLENDET', input.sourceName || 'Live-Quelle'],
    hide: ['QUELLE AUSGEBLENDET', input.sourceName || 'Live-Quelle'],
    reorder: ['LIVE-REGIE', input.sourceName || 'Reihenfolge aktualisiert'],
    reaction: ['REACTION SHOW', input.sourceName || 'Reaction-Modus wird aufgebaut'],
  }[input.kind];
  const accent =
    input.kind === 'remove' || input.kind === 'hide' ? '#ef4444' : input.kind === 'take' ? '#22c55e' : '#d20a2e';
  const outDelayMs = Math.max(0, input.durationMs - 220);
  return `<!doctype html><html lang="de"><head><meta charset="utf-8"><style>
html,body{margin:0;width:100%;height:100%;overflow:hidden;background:transparent;font-family:Inter,Arial,sans-serif;color:#fff}.switch{position:fixed;inset:0;display:grid;place-items:center;animation:leave .22s ease ${outDelayMs}ms forwards}.wash{position:absolute;inset:0;background:linear-gradient(115deg,transparent 0,rgba(0,0,0,.8) 38%,rgba(0,0,0,.9) 62%,transparent 100%)}.line{position:absolute;left:0;right:0;top:50%;height:8px;background:${accent};box-shadow:0 0 36px ${accent}}.content{position:relative;text-align:center;padding:24px 50px;border:1px solid rgba(255,255,255,.22);border-radius:10px;background:rgba(8,12,18,.86);box-shadow:0 20px 70px rgba(0,0,0,.5)}.content strong{display:block;color:${accent};font-size:27px;letter-spacing:.14em}.content span{display:block;margin-top:10px;font-size:52px;font-weight:950;max-width:1300px}.anim-fade .content{animation:fadeIn .3s ease both}.anim-slide .content{animation:slideIn .42s cubic-bezier(.16,1,.3,1) both}.anim-zoom .content{animation:zoomIn .38s cubic-bezier(.16,1,.3,1) both}.anim-wipe .wash{animation:wipeIn .4s ease-out both}.anim-wipe .content{animation:fadeIn .2s ease .18s both}@keyframes fadeIn{from{opacity:0}to{opacity:1}}@keyframes slideIn{from{opacity:0;transform:translateX(-180px)}to{opacity:1;transform:none}}@keyframes zoomIn{from{opacity:0;transform:scale(.55)}to{opacity:1;transform:scale(1)}}@keyframes wipeIn{from{clip-path:inset(0 100% 0 0)}to{clip-path:inset(0)}}@keyframes leave{to{opacity:0}}
</style></head><body><div class="switch anim-${input.animation}"><div class="wash"></div><div class="line"></div><div class="content"><strong>${escapeOverlayText(labels[0])}</strong><span>${escapeOverlayText(labels[1])}</span></div></div></body></html>`;
}
function rendererHtml(dataUrl: string, overlayToken?: string) {
  const style = [
    'html,body,#root{margin:0;width:100%;height:100%;overflow:hidden;background:transparent}',
    'body{font-family:Inter,Arial,sans-serif}',
    '.el{position:absolute;white-space:pre-wrap;overflow:hidden;overflow-wrap:anywhere;line-height:1.15}',
    '.ticker{display:flex;align-items:center;white-space:nowrap;animation:ticker 18s linear infinite}',
    '.fade{animation:fade .5s ease-out}',
    '.slide{animation:slide .5s ease-out}',
    '.live-source-label{position:absolute;z-index:900;display:grid;gap:2px;max-width:620px;padding:11px 17px;border-left:7px solid #d20a2e;border-radius:5px;background:rgba(7,11,17,.82);box-shadow:0 10px 32px rgba(0,0,0,.38);color:#fff;box-sizing:border-box}',
    '.live-source-label strong{overflow:hidden;text-overflow:ellipsis;white-space:nowrap;font-size:27px;line-height:1.05}',
    '.live-source-label small{overflow:hidden;text-overflow:ellipsis;white-space:nowrap;color:#cbd5e1;font-size:16px;font-weight:700}',
    '.live-source-label.badge{display:block;width:auto!important;padding:8px 13px;border-left:0;border-radius:999px;background:rgba(210,10,46,.9)}',
    '.live-source-label.badge small{display:none}',
    '.live-source-label.minimal{padding:5px 10px;border-left-width:3px;background:rgba(0,0,0,.55)}',
    '.live-source-label.minimal small{display:none}',
    '.live-source-label.source-fade{animation:sourceFade .45s ease-out}',
    '.live-source-label.source-slide{animation:sourceSlide .55s cubic-bezier(.16,1,.3,1)}',
    '.live-source-label.source-zoom{animation:sourceZoom .45s cubic-bezier(.16,1,.3,1)}',
    '.live-source-label.source-wipe{animation:sourceWipe .5s ease-out}',
    '.reaction-decor{position:absolute;inset:0;z-index:850;pointer-events:none;--reaction-accent:#d20a2e}',
    '.reaction-title{position:absolute;top:54px;left:64px;padding:12px 22px;border-left:8px solid var(--reaction-accent);border-radius:5px;background:rgba(5,8,14,.82);box-shadow:0 10px 36px rgba(0,0,0,.45);color:#fff;font-size:31px;font-weight:950;letter-spacing:.08em}',
    '.reaction-frame{position:absolute;border:5px solid var(--reaction-accent);border-radius:14px;box-sizing:border-box;box-shadow:0 0 0 3px rgba(0,0,0,.55),0 0 34px color-mix(in srgb,var(--reaction-accent) 68%,transparent)}',
    '.reaction-decor.style-news .reaction-frame{border-radius:2px;border-width:7px;border-bottom-width:16px}',
    '.reaction-decor.style-glass .reaction-frame{border-color:rgba(255,255,255,.58);background:linear-gradient(135deg,rgba(255,255,255,.13),transparent 35%);backdrop-filter:saturate(1.2)}',
    '.reaction-decor.style-clean .reaction-frame{border-width:2px;border-color:rgba(255,255,255,.82);box-shadow:0 4px 22px rgba(0,0,0,.45)}',
    '.reaction-decor.anim-fade{animation:reactionFade .55s ease-out}',
    '.reaction-decor.anim-slide .reaction-frame{animation:reactionSlide .62s cubic-bezier(.16,1,.3,1)}',
    '.reaction-decor.anim-pop .reaction-frame{animation:reactionPop .52s cubic-bezier(.16,1.3,.3,1)}',
    '.reaction-decor.anim-pulse .reaction-frame{animation:reactionPulse 1.4s ease-in-out infinite alternate}',
    '@keyframes ticker{from{transform:translateX(100%)}to{transform:translateX(-100%)}}',
    '@keyframes fade{from{opacity:0}to{opacity:1}}',
    '@keyframes slide{from{translate:0 30px}to{translate:0 0}}',
    '@keyframes sourceFade{from{opacity:0}to{opacity:1}}',
    '@keyframes sourceSlide{from{opacity:0;translate:-70px 0}to{opacity:1;translate:0 0}}',
    '@keyframes sourceZoom{from{opacity:0;scale:.65}to{opacity:1;scale:1}}',
    '@keyframes sourceWipe{from{clip-path:inset(0 100% 0 0)}to{clip-path:inset(0)}}',
    '@keyframes reactionFade{from{opacity:0}to{opacity:1}}',
    '@keyframes reactionSlide{from{opacity:0;translate:120px 0}to{opacity:1;translate:0 0}}',
    '@keyframes reactionPop{from{opacity:0;scale:.58}to{opacity:1;scale:1}}',
    '@keyframes reactionPulse{to{filter:brightness(1.35);box-shadow:0 0 48px var(--reaction-accent)}}',
  ].join('');
  const script = [
    `const dataUrl=${JSON.stringify(dataUrl)};`,
    `const token=${JSON.stringify(overlayToken ?? '')};`,
    'let currentVersion=-1,currentDoc=null;',
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
    "    'channel.name':data.channel?.name,",
    "    'live.sourceCount':data.live?.sourceCount,",
    "    'live.layout':data.live?.layout,",
    "    'live.programSourceName':data.live?.programSourceName,",
    "    'live.summary':data.live?.summary,",
    '  };',
    "  return map[el.binding]??el.props?.text??'';",
    '}',
    'function fitText(node,minSize){',
    '  let size=parseFloat(node.style.fontSize)||42;',
    '  while(size>minSize&&(node.scrollHeight>node.clientHeight||node.scrollWidth>node.clientWidth)){',
    "    size-=2;node.style.fontSize=size+'px';",
    '  }',
    '}',
    'function fitCanvas(doc){',
    '  const scale=Math.min(window.innerWidth/doc.width,window.innerHeight/doc.height);',
    "  root.style.position='absolute';",
    "  root.style.left=Math.max(0,(window.innerWidth-doc.width*scale)/2)+'px';",
    "  root.style.top=Math.max(0,(window.innerHeight-doc.height*scale)/2)+'px';",
    "  root.style.transformOrigin='top left';",
    "  root.style.transform='scale('+scale+')';",
    '}',
    'function render(data){',
    '  if(data.eventVersion!==undefined&&data.eventVersion<currentVersion)return;',
    '  currentVersion=data.eventVersion??currentVersion;',
    '  const doc=data.overlay??data.draft?.snapshot??data.draft??null;',
    '  if(!doc)return;',
    '  currentDoc=doc;',
    '  root.replaceChildren();',
    "  root.style.width=doc.width+'px';",
    "  root.style.height=doc.height+'px';",
    '  fitCanvas(doc);',
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
    '  if(data.live?.reaction?.enabled){',
    '    const reaction=data.live.reaction;',
    "    const decor=document.createElement('div');decor.className='reaction-decor style-'+reaction.style+' anim-'+reaction.animation;decor.style.setProperty('--reaction-accent',reaction.accentColor||'#d20a2e');",
    "    const title=document.createElement('div');title.className='reaction-title';title.textContent=reaction.title||'LIVE REACTION';decor.appendChild(title);",
    '    const cameraCount=Math.max(0,(reaction.cameraSourceIds||[]).length);',
    '    const gap=Math.max(0,Math.min(80,reaction.gap||24)),size=Math.max(15,Math.min(45,reaction.sizePercent||28));',
    '    for(let cameraIndex=0;cameraIndex<cameraCount;cameraIndex++){',
    "      const frame=document.createElement('div');frame.className='reaction-frame';let x=gap,y=gap,w=0,h=0;",
    "      if(reaction.position==='left'||reaction.position==='right'){const desiredW=Math.round(doc.width*size/100),maxH=Math.floor((doc.height-gap*(cameraCount+1))/Math.max(1,cameraCount));h=Math.max(120,Math.min(Math.round(desiredW*9/16),maxH));w=Math.round(h*16/9);x=reaction.position==='left'?gap:doc.width-w-gap;y=gap+cameraIndex*(h+gap)}",
    "      else{const desiredH=Math.round(doc.height*size/100),maxW=Math.floor((doc.width-gap*(cameraCount+1))/Math.max(1,cameraCount));w=Math.max(210,Math.min(Math.round(desiredH*16/9),maxW));h=Math.round(w*9/16);x=gap+cameraIndex*(w+gap);y=reaction.position==='top'?gap:doc.height-h-gap}",
    "      frame.style.left=x+'px';frame.style.top=y+'px';frame.style.width=w+'px';frame.style.height=h+'px';decor.appendChild(frame);",
    '    }',
    '    root.appendChild(decor);',
    '  }',
    '  if(data.live?.sourceOverlayEnabled&&Array.isArray(data.live.sources)){',
    '    const sources=data.live.sources;',
    "    const layout=data.live.layout||'grid';",
    '    const count=Math.max(1,sources.length);',
    "    const columns=layout==='split'?2:layout==='grid'?(count<=2?count:Math.ceil(Math.sqrt(count))):1;",
    "    const rows=layout==='grid'?Math.ceil(count/columns):1;",
    '    sources.forEach((source,index)=>{',
    "      const label=document.createElement('div');",
    "      label.className='live-source-label '+(data.live.sourceLabelStyle||'lower-third')+' source-'+(data.live.sourceTransition||'fade');",
    "      const name=document.createElement('strong');name.textContent=source.name||'Live-Quelle';label.appendChild(name);",
    "      const detail=document.createElement('small');detail.textContent=(source.inProgram?'IM PROGRAMM · ':'')+(source.muted?'STUMM':'LIVE-AUDIO');label.appendChild(detail);",
    '      let x=72,y=doc.height-165,w=Math.min(620,doc.width-144);',
    "      if(layout==='split'){w=doc.width/2-72;x=(index%2)*(doc.width/2)+36;y=doc.height-150}",
    "      else if(layout==='grid'){const tileW=doc.width/columns,tileH=doc.height/rows;w=Math.max(220,tileW-48);x=(index%columns)*tileW+24;y=Math.floor(index/columns)*tileH+tileH-92}",
    "      else if(layout==='pip'&&index>0){w=420;x=doc.width-w-28;y=28+(index-1)*330+245}",
    "      else if(layout==='reaction'&&index>0){const reaction=data.live.reaction||{},cameraCount=Math.max(1,sources.length-1),gap=Math.max(0,reaction.gap||24),size=Math.max(15,reaction.sizePercent||28),cameraIndex=index-1;if(reaction.position==='left'||reaction.position==='right'){const desiredW=Math.round(doc.width*size/100),maxH=Math.floor((doc.height-gap*(cameraCount+1))/cameraCount),h=Math.max(120,Math.min(Math.round(desiredW*9/16),maxH));w=Math.round(h*16/9)-24;x=(reaction.position==='left'?gap:doc.width-(w+24)-gap)+12;y=gap+cameraIndex*(h+gap)+h-66}else{const desiredH=Math.round(doc.height*size/100),maxW=Math.floor((doc.width-gap*(cameraCount+1))/cameraCount);w=Math.max(210,Math.min(Math.round(desiredH*16/9),maxW))-24;const h=Math.round((w+24)*9/16);x=gap+cameraIndex*(w+24+gap)+12;y=(reaction.position==='top'?gap:doc.height-h-gap)+h-66}}",
    "      label.style.left=x+'px';label.style.top=y+'px';label.style.width=w+'px';root.appendChild(label);",
    '    });',
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
    "  for(const eventName of ['overlay-published','overlay-version-changed','article-prepared','item-started','item-paused','item-resumed','item-ended','item-skipped','broadcast-stopped','live-studio-changed']){",
    "    events.addEventListener(eventName,(ev)=>{ if(ev.lastEventId) window.localStorage.setItem(\'overlay:\'+token+\':lastEventId\',ev.lastEventId); load(); });",
    '  }',
    '  events.onerror=()=>{events.close();setTimeout(connect,1500)};',
    '}',
    'load();',
    "window.addEventListener('resize',()=>{if(currentDoc)fitCanvas(currentDoc)});",
    'if(token)connect();',
    'setInterval(load,token?30000:1500);',
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

async function automaticStreamStartEnabled() {
  if (process.env.STREAM_AUTO_START === 'true') return true;
  try {
    return Boolean((await getAutopilotConfig()).enabled);
  } catch (error) {
    app.log.warn({ error }, 'Autopilot-Status konnte für automatischen Streamstart nicht geprüft werden');
    return false;
  }
}

function scheduleStreamSupervisor(reason: string) {
  setTimeout(() => {
    void superviseStream();
  }, 1000).unref?.();
  app.log.info({ reason }, 'Automatischer Streamstart wurde eingeplant');
}

async function superviseStream() {
  if (
    !(await automaticStreamStartEnabled()) ||
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
    await restoreChannelLogo();
    await obs.setScene(MAINTENANCE_SCENE);
    await obs.startStream();
    resetStreamSupervisorFailures();
    app.log.info('Stream automatisch gestartet');
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
setTimeout(() => {
  void restoreChannelLogo().catch((error) =>
    app.log.warn({ error }, 'Senderlogo konnte beim Start noch nicht geladen werden'),
  );
}, 1500).unref?.();
setTimeout(() => void superviseStream(), 2000).unref?.();
if (process.env.STREAM_AUTO_RESTART !== 'false') {
  setInterval(() => void superviseStream(), streamSupervisorIntervalMs).unref?.();
}
