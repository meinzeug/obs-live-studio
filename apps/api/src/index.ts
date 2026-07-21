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
import {
  cleanArticleTextForBroadcast,
  combineEditorialWarnings,
  summarize,
  makeScript,
  scriptWithChannelName,
} from '@ans/content-processing';
import { improveOverlayCopy, planBroadcast, prepareEditorialArticle, suggestSourceSettings } from '@ans/ai-provider';
import { assertPublicHttpUrl, maskSecret } from '@ans/security';
import { fetchHttpText } from '@ans/source-connectors';
import { queueSourceFetch, unreadOperationalNotificationCount } from '@ans/database/notifications';
import {
  createSource,
  createManualArticle,
  dashboardStats,
  deleteArticle,
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
  updateArticle,
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
  addBroadcastYoutubeItem,
  addBroadcastYoutubeNewsSidebarItem,
  removeBroadcastItem,
  reorderBroadcastItems,
  listYoutubeVideoCategories,
  createYoutubeVideoCategory,
  updateYoutubeVideoCategory,
  deleteYoutubeVideoCategory,
  listYoutubeVideos,
  createYoutubeVideo,
  updateYoutubeVideo,
  deleteYoutubeVideo,
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
  getSetting,
  query,
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
import { updateSourceState as updateSource } from '@ans/database/source-updates';
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
import {
  resolveYoutubeLiveSource,
  resolveYoutubeOEmbedMetadata,
  resolveYoutubeVideoMetadata,
  youtubeObsPlayerHtml,
  youtubeObsViewerUrl,
} from './youtube-live-source.js';
import { importYoutubeChannelVideos, previewYoutubeChannelSource } from './youtube-channel-source.js';
import { registerStudioControlRoutes, studioResourceSnapshot } from './studio-control.js';
import { AiTvTeamRuntime, aiHostOverlayState, registerAiTvTeamRoutes } from './ai-tv-team.js';
import {
  deterministicBroadcastPlan,
  filterBroadcastCandidates,
  type BroadcastPlannerOptions,
} from './broadcast-planner.js';
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
const aiTvTeam = new AiTvTeamRuntime(async (reason, payload = {}) => {
  await appendLiveEvent({
    type: 'ai-host-updated',
    payload: { reason, ...payload },
    dedupeKey: `ai-host:${reason}:${Date.now()}:${Math.random().toString(36).slice(2)}`,
  });
});
await registerAiTvTeamRoutes(app, requirePermission, aiTvTeam, readStoredFile, async (reason, payload = {}) => {
  await appendLiveEvent({
    type: 'ai-host-updated',
    payload: { reason, ...payload },
    dedupeKey: `ai-host:${reason}:${Date.now()}:${Math.random().toString(36).slice(2)}`,
  });
});
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
  'youtube-video': 'YouTube Video',
  'youtube-news-sidebar': 'News links + YouTube rechts',
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
      youtubeReady: isYoutube ? localState.ready === true : true,
      youtubeAuthPreparing: isYoutube ? localState.authPreparing === true : false,
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
    const source = resolveYoutubeLiveSource(urlValue);
    return { ...source, viewerUrl: youtubeObsViewerUrl(publicBaseUrl(), source.videoId) };
  } catch (error) {
    throw apiError(400, error instanceof Error ? error.message : 'Ungültige YouTube-URL.');
  }
}

function youtubeVideoId(source: Awaited<ReturnType<typeof listLiveStudioSources>>[number]) {
  const stateId = source.last_portal_state?.videoId;
  const storedId = typeof stateId === 'string' ? stateId : '';
  const sourceId = source.source_id.startsWith('youtube:') ? source.source_id.slice('youtube:'.length) : '';
  const candidate = storedId || sourceId;
  return /^[a-zA-Z0-9_-]{6,20}$/.test(candidate) ? candidate : null;
}

async function restoreYoutubeLiveSources() {
  const sources = await listLiveStudioSources();
  for (const source of sources) {
    const videoId = youtubeVideoId(source);
    if (!videoId) continue;
    const authPreparing = source.last_portal_state?.authPreparing === true;
    const viewerUrl = authPreparing
      ? `https://www.youtube.com/watch?v=${encodeURIComponent(videoId)}`
      : youtubeObsViewerUrl(publicBaseUrl(), videoId);
    const ready = source.last_portal_state?.ready === true;
    const saved = await upsertLiveStudioSource({
      sourceId: source.source_id,
      inputName: source.input_name,
      displayName: source.display_name,
      userName: source.user_name,
      viewerUrl,
      muted: source.muted,
      hidden: ready ? source.hidden : true,
      slotIndex: source.slot_index,
      inProgram: source.in_program,
      portalState: { ...source.last_portal_state, ready, authPreparing },
    });
    await obs.ensureLiveSource({
      sourceId: saved.source_id,
      viewerUrl,
      muted: saved.muted,
      hidden: saved.hidden,
      index: saved.slot_index,
    });
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

const defaultYoutubeOverlaySlots = [
  {
    template: 'youtube-video',
    name: 'YouTube Video Overlay',
    category: 'YouTube',
  },
  {
    template: 'youtube-news-sidebar',
    name: 'News links + YouTube rechts',
    category: 'YouTube',
  },
] as const;

async function ensureDefaultYoutubeOverlaySlots(options: { configureObs?: boolean } = {}) {
  const identity = await currentChannelIdentity().catch(() => null);
  const channelName = identity?.channelName ?? process.env.CHANNEL_NAME ?? 'Mein Kanal';
  const ensured: Array<{
    template: string;
    projectId: string;
    versionId: string;
    publicUrl: string;
    target?: { sceneName: string; inputName: string };
  }> = [];

  for (const slot of defaultYoutubeOverlaySlots) {
    const snapshot = createTemplate(slot.template, 1920, 1080, channelName);
    await query(
      `insert into overlay_templates(name,category,snapshot)
       values($1,$2,$3)
       on conflict(name) do update
       set category=excluded.category,
           snapshot=excluded.snapshot`,
      [slot.template, slot.category, snapshot],
    );

    const projects = (await listOverlayProjects()).filter((project: any) => project.template === slot.template);
    let project: any = (await getConfiguredOverlay(slot.template)) ?? (await getPublishedOverlay(slot.template));
    if (!project) project = projects[0];
    if (!project) {
      project = await createOverlayProject({
        name: slot.name,
        width: 1920,
        height: 1080,
        template: slot.template,
        snapshot,
      });
    }

    let version: any = await getPublishedOverlay(slot.template);
    if (!version || version.id !== project.id) {
      const selected = (await latestOverlayDraft(project.id)) ?? (await latestOverlayVersion(project.id));
      if (!selected) throw new Error(`Kein Overlay-Entwurf für ${slot.template} vorhanden`);
      version = await publishOverlayVersion(project.id, selected.id);
    }

    let publicUrl = (project.public_url ?? version.public_url) as string | undefined;
    if (!publicUrl) {
      const publicToken = randomBytes(32).toString('base64url');
      publicUrl = makeOverlayPublicUrl(publicToken, slot.template);
      project = await ensureOverlayPublicIdentity(
        project.id,
        tokenHash(publicToken),
        publicUrl,
        randomBytes(12).toString('hex'),
      );
    }

    const absoluteUrl = absoluteOverlayUrl(publicUrl);
    let target: { sceneName: string; inputName: string } | undefined;
    if (options.configureObs) {
      target = await obs.ensureBrowserOverlay({
        template: slot.template,
        url: absoluteUrl,
        width: project.width ?? 1920,
        height: project.height ?? 1080,
      });
      await obs.ensureYoutubeVideoSceneItem(
        target.sceneName,
        slot.template === 'youtube-news-sidebar' ? 'news-sidebar' : 'fullscreen',
      );
      await rememberObsOverlaySource({
        projectId: project.id,
        sceneName: target.sceneName,
        inputName: target.inputName,
        url: absoluteUrl,
        versionId: version.version_id ?? version.id,
        width: project.width ?? 1920,
        height: project.height ?? 1080,
      });
    }

    ensured.push({
      template: slot.template,
      projectId: project.id,
      versionId: version.version_id ?? version.id,
      publicUrl: absoluteUrl,
      target,
    });
  }

  return ensured;
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

async function setupObsStudio() {
  const youtubeOverlays = await ensureDefaultYoutubeOverlaySlots({ configureObs: true });
  const restored = await restorePublishedOverlays();
  if (!restored.some((item) => item.template === 'main-news')) await obs.ensureMainNewsScene(await overlayUrl());
  await setSetting('obs_status', obs.getState());
  return { ok: true, youtubeOverlays, restored, ...obs.getState() };
}

registerStudioControlRoutes(
  app,
  {
    projectRoot: PROJECT_ROOT,
    channelName: () => process.env.CHANNEL_NAME ?? 'Mein Kanal',
    streamConfigured: () => Boolean(process.env.STREAM_SERVER?.trim() && process.env.STREAM_KEY?.trim()),
    obsState: () => obs.getState(),
    ttsConfigured: () => isTtsConfigured(),
    aiConfigured: () => Boolean(process.env.OPENROUTER_API_KEY?.trim()),
    reconnectObs: async () => {
      await obs.ensureConnectedWithRetry();
      await setSetting('obs_status', obs.getState());
      return obs.getState();
    },
    setupObs: () => setupObsStudio(),
    restoreOverlays: () => restorePublishedOverlays(),
  },
  requirePermission,
);
function makeOverlayPublicUrl(token: string, template: string) {
  return `${publicBaseUrl()}/overlay/live/${encodeURIComponent(token)}/${encodeURIComponent(template)}`;
}
await ensureDefaultYoutubeOverlaySlots({ configureObs: true }).catch((error) => {
  app.log.warn(
    {
      err: error instanceof Error ? { message: error.message, stack: error.stack } : error,
    },
    'youtube overlay slots could not be fully initialized',
  );
});
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
  type: z.enum(['rss', 'atom', 'feed', 'website', 'youtube-channel']).default('rss'),
  category: z.string().optional().nullable(),
  region: z.string().optional().nullable(),
  language: z.string().default('de'),
  description: z.string().optional().nullable(),
  priority: z.coerce.number().int().default(0),
  trustLevel: z.coerce.number().int().min(0).max(100).default(50),
  fetchIntervalSeconds: z.coerce.number().int().min(60).max(86400).default(900),
  maxArticles: z.coerce.number().int().min(1).max(100).default(20),
  maxFetchSeconds: z.coerce.number().int().min(1).max(60).default(20),
  active: z.boolean().default(true),
  userAgent: z.string().optional().nullable(),
});
const sourceCreateSchema = sourceSchema.extend({
  importInitialVideos: z.coerce.number().int().min(0).max(100).default(0),
});
const youtubeCategoryBodySchema = z.object({
  name: z.string().trim().min(1).max(80),
  description: z.string().trim().max(500).optional().nullable(),
  color: z
    .string()
    .trim()
    .regex(/^#[0-9a-fA-F]{6}$/)
    .optional(),
  sortOrder: z.number().int().min(0).max(10_000).optional(),
});
const youtubeVideoBodySchema = z.object({
  title: z.string().trim().min(1).max(180),
  url: z.string().url(),
  categoryId: z.string().uuid().optional().nullable(),
  description: z.string().trim().max(1200).optional().nullable(),
  durationSeconds: z
    .number()
    .int()
    .min(30)
    .max(24 * 3600)
    .optional(),
  enabled: z.boolean().default(true),
});
const autopilotDailyFormatSchema = z.object({
  id: z.string().trim().min(1).max(80),
  name: z.string().trim().min(1).max(120),
  startTime: z.string().regex(/^\d{2}:\d{2}$/),
  durationMinutes: z
    .number()
    .int()
    .min(5)
    .max(24 * 60),
  contentMode: z.enum(['news', 'youtube', 'mixed', 'youtube-news-sidebar']),
  youtubeCategoryIds: z.array(z.string().uuid()).max(30).default([]),
  sourceIds: z.array(z.string().uuid()).max(50).default([]),
  enabled: z.boolean().default(true),
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
function timestampMs(value: unknown) {
  if (!value) return 0;
  if (value instanceof Date) return value.getTime();
  const parsed = Date.parse(String(value));
  return Number.isFinite(parsed) ? parsed : 0;
}
function defaultAutopilotFormats(config: Awaited<ReturnType<typeof getAutopilotConfig>>): typeof config.dailyFormats {
  const durationMinutes = Math.max(30, config.contentMode === 'youtube-news-sidebar' ? config.showItemCount * 10 : 60);
  const slotMinutes = Math.max(15, durationMinutes);
  const formats: typeof config.dailyFormats = [];
  for (let minuteOfDay = 0; minuteOfDay < 24 * 60; minuteOfDay += slotMinutes) {
    const hour = Math.floor(minuteOfDay / 60);
    const minute = minuteOfDay % 60;
    const startTime = `${String(hour).padStart(2, '0')}:${String(minute).padStart(2, '0')}`;
    formats.push({
      id: `default-${config.contentMode}-${startTime.replace(':', '')}`,
      name:
        config.contentMode === 'youtube'
          ? 'YouTube Videos'
          : config.contentMode === 'mixed'
            ? 'Zeitkante Mix'
            : config.contentMode === 'youtube-news-sidebar'
              ? 'YouTube mit News-Sidebar'
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
app.get('/api/dashboard', async (req) => {
  const [c, a, automation, playback, resources, libraryResult, scheduleResult, unreadCount] = await Promise.all([
    dashboardStats(),
    listArticles(1),
    getAutopilotConfig(),
    getPlaybackSnapshot(),
    studioResourceSnapshot(PROJECT_ROOT),
    query<{
      sources: number;
      articles: number;
      youtube_videos: number;
      media: number;
      overlays: number;
    }>(`select
      (select count(*)::int from sources where deleted_at is null) sources,
      (select count(*)::int from articles where deleted_at is null) articles,
      (select count(*)::int from youtube_videos) youtube_videos,
      (select count(*)::int from media_assets) media,
      (select count(*)::int from overlay_projects where deleted_at is null) overlays`),
    query<{
      id: string;
      name: string;
      description: string | null;
      scheduled_at: string;
      status: string;
      kind: string;
      item_count: number;
      duration_seconds: number;
    }>(`select bp.id,bp.name,bp.description,bp.scheduled_at,bp.status,bp.kind,
              count(bi.id)::int item_count,
              coalesce(sum(greatest(coalesce(bi.duration_seconds,0),0)),0)::int duration_seconds
       from broadcast_playlists bp
       left join broadcast_items bi on bi.playlist_id=bp.id
       where bp.scheduled_at is not null
         and bp.scheduled_at >= now() - interval '3 hours'
         and bp.status not in ('interrupted','error')
       group by bp.id
       order by bp.scheduled_at asc
       limit 12`),
    unreadOperationalNotificationCount(req.user!.id),
  ]);
  const currentArticle = playback?.articleId
    ? await getArticleDetail(playback.articleId)
    : ((await getLastPlayedArticle()) ?? a[0]);
  const schedule = scheduleResult.rows.map((entry) => ({
    id: entry.id,
    name: entry.name,
    description: entry.description,
    scheduledAt: entry.scheduled_at,
    status: entry.status,
    kind: entry.kind,
    itemCount: entry.item_count,
    durationSeconds: entry.duration_seconds,
  }));
  const nextShow = schedule.find((entry) => new Date(entry.scheduledAt).getTime() > Date.now());
  const library = libraryResult.rows[0] ?? {
    sources: 0,
    articles: 0,
    youtube_videos: 0,
    media: 0,
    overlays: 0,
  };
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
      next: nextShow?.name ?? 'Keine weitere Sendung geplant',
      nextAt: nextShow?.scheduledAt ?? null,
      scene: playback?.scene ?? playback?.sceneName ?? 'Hauptnachrichten-Overlay',
    },
    obs: obs.getState(),
    stream: await obs.getStreamStatus().catch(() => null),
    automation,
    playback,
    schedule,
    resources,
    library: {
      sources: library.sources,
      articles: library.articles,
      youtubeVideos: library.youtube_videos,
      media: library.media,
      overlays: library.overlays,
    },
    notifications: { unreadCount },
    serverTime: new Date().toISOString(),
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
      contentMode: z.enum(['news', 'youtube', 'mixed', 'youtube-news-sidebar']).optional(),
      minimumTrust: z.number().int().min(0).max(100).optional(),
      requireStream: z.boolean().optional(),
      requireVideo: z.boolean().optional(),
      showItemCount: z.number().int().min(1).max(20).optional(),
      pauseSeconds: z.number().int().min(0).max(600).optional(),
      pauseBetweenShowsSeconds: z.number().int().min(0).max(3600).optional(),
      sidebarRotationSeconds: z.number().int().min(3).max(120).optional(),
      sourceIds: z.array(z.string().uuid()).optional(),
      youtubeCategoryIds: z.array(z.string().uuid()).optional(),
      dailyFormats: z.array(autopilotDailyFormatSchema).max(48).optional(),
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
app.get('/api/youtube-videos', async () => ({
  categories: await listYoutubeVideoCategories(),
  videos: await listYoutubeVideos(),
}));
app.post('/api/youtube-videos/categories', async (req, reply) => {
  requirePermission(req, reply, 'broadcast:write');
  return createYoutubeVideoCategory(youtubeCategoryBodySchema.parse(req.body ?? {}));
});
app.put('/api/youtube-videos/categories/:id', async (req, reply) => {
  requirePermission(req, reply, 'broadcast:write');
  const saved = await updateYoutubeVideoCategory(
    (req.params as any).id,
    youtubeCategoryBodySchema.partial().parse(req.body ?? {}),
  );
  if (!saved) throw apiError(404, 'YouTube-Kategorie nicht gefunden.');
  return saved;
});
app.delete('/api/youtube-videos/categories/:id', async (req, reply) => {
  requirePermission(req, reply, 'broadcast:write');
  await deleteYoutubeVideoCategory((req.params as any).id);
  return { ok: true };
});
app.post('/api/youtube-videos', async (req, reply) => {
  requirePermission(req, reply, 'broadcast:write');
  const body = youtubeVideoBodySchema.parse(req.body ?? {});
  const youtube = resolveYoutubeLiveSource(body.url);
  const metadata = await resolveYoutubeVideoMetadata(youtube.videoId, {
    apiKey: process.env.YOUTUBE_DATA_API_KEY,
  }).catch((error) => {
    throw apiError(502, error instanceof Error ? error.message : 'YouTube-Laufzeit konnte nicht ermittelt werden.');
  });
  return createYoutubeVideo({
    title: body.title,
    url: youtube.canonicalUrl,
    videoId: youtube.videoId,
    channelTitle: metadata.channelTitle,
    categoryId: body.categoryId,
    description: body.description,
    durationSeconds: metadata.durationSeconds,
    enabled: body.enabled,
  });
});
app.put('/api/youtube-videos/:id', async (req, reply) => {
  requirePermission(req, reply, 'broadcast:write');
  const body = youtubeVideoBodySchema.partial().parse(req.body ?? {});
  const youtube = body.url ? resolveYoutubeLiveSource(body.url) : null;
  const metadata = youtube
    ? await resolveYoutubeVideoMetadata(youtube.videoId, {
        apiKey: process.env.YOUTUBE_DATA_API_KEY,
      }).catch((error) => {
        throw apiError(502, error instanceof Error ? error.message : 'YouTube-Laufzeit konnte nicht ermittelt werden.');
      })
    : null;
  const saved = await updateYoutubeVideo((req.params as any).id, {
    title: body.title,
    url: youtube?.canonicalUrl,
    videoId: youtube?.videoId,
    channelTitle: metadata?.channelTitle,
    categoryId: body.categoryId,
    description: body.description,
    durationSeconds: metadata?.durationSeconds ?? body.durationSeconds,
    enabled: body.enabled,
  });
  if (!saved) throw apiError(404, 'YouTube-Video nicht gefunden.');
  return saved;
});
app.delete('/api/youtube-videos/:id', async (req, reply) => {
  requirePermission(req, reply, 'broadcast:write');
  await deleteYoutubeVideo((req.params as any).id);
  return { ok: true };
});
async function createAutopilotSchedule24h() {
  const config = await getAutopilotConfig();
  const identity = await currentChannelIdentity();
  const formats =
    config.dailyFormats.length > 0
      ? config.dailyFormats.filter((format) => format.enabled)
      : defaultAutopilotFormats(config);
  const [videos, articles] = await Promise.all([listYoutubeVideos(), listBroadcastCandidateArticles(config.scanLimit)]);
  const runtimeYoutubeLastScheduled = new Map(videos.map((video) => [video.id, timestampMs(video.last_scheduled_at)]));
  const runtimeArticleLastScheduled = new Map<string, number>();
  const readyArticles = articles.filter(
    (article) => article.audio_path && Number(article.audio_duration_seconds ?? 0) > 0,
  );
  const now = new Date();
  const horizon = new Date(now.getTime() + 24 * 3600_000);
  const created: any[] = [];
  const skipped: Array<{ formatId: string; reason: string; scheduledAt?: string }> = [];
  for (const dayOffset of [0, 1]) {
    for (const format of formats) {
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
      if (exists) {
        skipped.push({ formatId: format.id, scheduledAt, reason: 'exists' });
        continue;
      }
      const categoryIds = format.youtubeCategoryIds.length ? format.youtubeCategoryIds : config.youtubeCategoryIds;
      const sourceIds = format.sourceIds.length ? format.sourceIds : config.sourceIds;
      const useYoutube =
        format.contentMode === 'youtube' ||
        format.contentMode === 'mixed' ||
        format.contentMode === 'youtube-news-sidebar';
      const useNews =
        format.contentMode === 'news' ||
        format.contentMode === 'mixed' ||
        format.contentMode === 'youtube-news-sidebar';
      const useSidebar = format.contentMode === 'youtube-news-sidebar';
      const youtubeItems = useYoutube
        ? pickDiverseYoutubeItems(
            videos,
            categoryIds,
            Math.max(1, Math.ceil(format.durationMinutes / 20)),
            scheduled.getTime(),
            runtimeYoutubeLastScheduled,
          )
        : [];
      const articlePool = useSidebar ? articles : readyArticles;
      const articleItems = useNews
        ? pickDiverseArticleItems(
            articlePool,
            sourceIds,
            Math.max(
              1,
              useSidebar
                ? Math.min(config.scanLimit, Math.max(config.showItemCount * 4, Math.ceil(format.durationMinutes / 6)))
                : Math.min(config.showItemCount, Math.ceil(format.durationMinutes / 6)),
            ),
            scheduled.getTime(),
            runtimeArticleLastScheduled,
            !useSidebar,
          )
        : [];
      if (!youtubeItems.length && !articleItems.length) {
        skipped.push({ formatId: format.id, scheduledAt, reason: 'empty' });
        continue;
      }
      const playlist = await createBroadcastPlaylist(`${identity.channelName} ${format.name}`, {
        description: `Autopilot-Format ${format.name}, automatisch 24 Stunden voraus geplant.`,
        scheduledAt,
        kind: format.contentMode === 'youtube' ? 'special' : 'show',
        settings: {
          autopilot: true,
          autopilot24h: true,
          autopilotFormatId: format.id,
          contentMode: format.contentMode,
          youtubeNewsSidebar: useSidebar,
          pauseSeconds: config.pauseSeconds,
          transition: 'fade',
          repeatPolicy: 'none',
          targetRuntimeMinutes: format.durationMinutes,
        },
      });
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
        created.push(playlist);
        continue;
      }
      let articleIndex = 0;
      let youtubeIndex = 0;
      while (articleIndex < articleItems.length || youtubeIndex < youtubeItems.length) {
        if (format.contentMode !== 'youtube' && articleIndex < articleItems.length) {
          await addBroadcastItem(playlist.id, articleItems[articleIndex++]!.id);
        }
        if (format.contentMode !== 'news' && youtubeIndex < youtubeItems.length) {
          const video = youtubeItems[youtubeIndex++]!;
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
      }
      if (youtubeItems.length) {
        await query(`update youtube_videos set last_scheduled_at=$1,updated_at=now() where id=any($2::uuid[])`, [
          scheduledAt,
          youtubeItems.map((video) => video.id),
        ]);
      }
      created.push(playlist);
    }
  }
  return { created, skipped };
}
app.post('/api/autopilot/plan-24h', async (req, reply) => {
  requirePermission(req, reply, 'broadcast:write');
  return createAutopilotSchedule24h();
});
app.get('/api/sources', async () => listSources());
app.post('/api/sources', async (req, reply) => {
  requirePermission(req, reply, 'sources:write');
  const body = sourceCreateSchema.parse(req.body);
  await assertPublicHttpUrl(body.url, allowPrivate || isLocalTestFeed(body.url));
  const source = await createSource(body);
  if (source.type === 'youtube-channel' && body.importInitialVideos > 0) {
    try {
      const imported = await importYoutubeChannelVideos(source, {
        limit: body.importInitialVideos,
        userAgent: source.user_agent ?? process.env.NEWS_USER_AGENT,
        apiKey: process.env.YOUTUBE_DATA_API_KEY,
      });
      return { source, imported };
    } catch (error) {
      await queueSourceFetch(source.id);
      return {
        source,
        queued: true,
        warning: error instanceof Error ? error.message : String(error),
      };
    }
  }
  if (source.type === 'youtube-channel') {
    await queueSourceFetch(source.id);
    return { source, queued: true };
  }
  return source;
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
  const body = z
    .object({
      url: z.string().url(),
      type: z.enum(['rss', 'atom', 'feed', 'website', 'youtube-channel']).optional(),
      maxFetchSeconds: z.coerce.number().optional(),
    })
    .parse(req.body);
  if (body.type === 'youtube-channel') {
    const preview = await previewYoutubeChannelSource(body.url, {
      limit: 5,
      userAgent: process.env.NEWS_USER_AGENT,
    });
    await recordSourceCheck(null, 'ok', {
      url: body.url,
      detected: 'youtube-channel',
      status: preview.fetched.status,
      feedUrl: preview.feedUrl,
    });
    return {
      detected: 'youtube-channel',
      status: preview.fetched.status,
      finalUrl: preview.fetched.url,
      feedUrl: preview.feedUrl,
      preview: preview.preview,
      etag: preview.fetched.etag,
      lastModified: preview.fetched.lastModified,
      paywallSuspected: false,
      javascriptLikely: false,
    };
  }
  const targetUrl = body.url;
  const res = await fetchHttpText(targetUrl, {
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
app.post('/api/articles', async (req, reply) => {
  requirePermission(req, reply, 'articles:write');
  const body = z
    .object({
      title: z.string().trim().min(3).max(500),
      excerpt: z.string().trim().max(5000).nullable().optional(),
      mainText: z.string().trim().max(100000).nullable().optional(),
      author: z.string().trim().max(300).nullable().optional(),
      category: z.string().trim().max(120).nullable().optional(),
      region: z.string().trim().max(120).nullable().optional(),
      canonicalUrl: z.string().trim().url().max(4000).nullable().optional(),
      publishedAt: z.string().trim().datetime().nullable().optional(),
      trustScore: z.coerce.number().int().min(0).max(100).optional(),
    })
    .strict()
    .parse(req.body);
  const article = await createManualArticle({
    title: body.title,
    excerpt: body.excerpt?.trim() || null,
    mainText: body.mainText?.trim() || body.excerpt?.trim() || null,
    author: body.author?.trim() || req.user?.display_name || null,
    category: body.category?.trim() || null,
    region: body.region?.trim() || null,
    canonicalUrl: body.canonicalUrl?.trim() || null,
    publishedAt: body.publishedAt || null,
    trustScore: body.trustScore ?? 70,
    warnings: ['Manuell erstellte Nachricht: Quelle und Faktenlage redaktionell prüfen.'],
  });
  if (!article) throw apiError(500, 'Nachricht konnte nicht erstellt werden');
  return getArticleDetail(article.id);
});
app.get('/api/articles/:id', async (req) => {
  const article = await getArticleDetail((req.params as any).id);
  if (!article) throw Object.assign(new Error('Artikel nicht gefunden'), { statusCode: 404 });
  return article;
});
app.patch('/api/articles/:id', async (req, reply) => {
  requirePermission(req, reply, 'articles:write');
  const articleId = (req.params as any).id;
  const body = z
    .object({
      title: z.string().trim().min(3).max(500),
      excerpt: z.string().trim().max(5000).nullable().optional(),
      mainText: z.string().trim().max(100000).nullable().optional(),
      author: z.string().trim().max(300).nullable().optional(),
      category: z.string().trim().max(120).nullable().optional(),
      region: z.string().trim().max(120).nullable().optional(),
      canonicalUrl: z.string().trim().url().max(4000).nullable().optional(),
    })
    .strict()
    .parse(req.body);
  const current = await getArticleDetail(articleId);
  if (!current) throw apiError(404, 'Artikel nicht gefunden');
  const hasField = (field: keyof typeof body) => Object.prototype.hasOwnProperty.call(body, field);
  const normalizedText = (field: keyof typeof body, currentValue: string | null) => {
    if (!hasField(field)) return currentValue;
    const value = body[field];
    return typeof value === 'string' && value.trim() ? value.trim() : null;
  };
  const normalized = {
    title: body.title,
    excerpt: normalizedText('excerpt', current.excerpt),
    mainText: normalizedText('mainText', current.main_text),
    author: normalizedText('author', current.author),
    category: normalizedText('category', current.category),
    region: normalizedText('region', current.region),
    canonicalUrl: body.canonicalUrl?.trim() || current.canonical_url || current.url,
  };
  const article = await updateArticle(articleId, normalized);
  if (!article) throw apiError(404, 'Artikel nicht gefunden');
  return getArticleDetail(article.id);
});
app.delete('/api/articles/:id', async (req, reply) => {
  requirePermission(req, reply, 'articles:write');
  const deleted = await deleteArticle((req.params as any).id);
  if (!deleted) throw apiError(404, 'Artikel nicht gefunden');
  return { ok: true, id: deleted.id };
});
async function currentChannelIdentity() {
  const identity = await getSetting<{ channelName?: string; channelAliases?: string[] }>('studio.identity').catch(
    () => null,
  );
  return {
    channelName: identity?.channelName?.trim() || process.env.CHANNEL_NAME?.trim() || 'Studio',
    channelAliases: Array.isArray(identity?.channelAliases) ? identity.channelAliases : [],
  };
}
async function processArticle(article: NonNullable<Awaited<ReturnType<typeof getArticleDetail>>>) {
  const text = cleanArticleTextForBroadcast(article.main_text ?? article.excerpt ?? article.title, 24_000);
  const summary = summarize(text);
  const { channelName } = await currentChannelIdentity();
  const script = makeScript(article.title, summary, article.source_name ?? 'der Quelle', channelName);
  await saveArticlePackage(article.id, summary, script, summary, `${article.title}: ${summary}`);
  return (await getArticleDetail(article.id)) ?? article;
}
async function processArticleWithAi(article: NonNullable<Awaited<ReturnType<typeof getArticleDetail>>>) {
  const sourceText = cleanArticleTextForBroadcast(article.main_text ?? article.excerpt ?? article.title, 24_000);
  const { channelName } = await currentChannelIdentity();
  const result = await prepareEditorialArticle({
    title: article.title,
    text: sourceText,
    source: article.source_name ?? 'Unbekannte Quelle',
    sourceUrl: article.canonical_url ?? article.url,
    publishedAt: article.published_at,
    category: article.category,
    region: article.region,
    existingWarnings: combineEditorialWarnings(article.title, sourceText),
    channelName,
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
  const identity = await currentChannelIdentity();
  const channelScript = scriptWithChannelName(a.script_text, identity.channelName, identity.channelAliases);
  if (channelScript !== a.script_text) {
    await saveArticlePackage(
      a.id,
      a.summary ?? summarize(a.main_text ?? a.excerpt ?? a.title),
      channelScript,
      a.screen_text ?? a.summary ?? a.title,
      a.ticker_text ?? a.title.slice(0, 140),
      { promptVersion: 'channel-ident-v1', category: a.category, warnings: a.warnings },
    );
    a = (await getArticleDetail(a.id)) ?? { ...a, script_text: channelScript };
  }
  const out = await generateTtsAudio(channelScript);
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
    .enum([
      'main-news',
      'breaking-news',
      'lower-third',
      'ticker',
      'maintenance',
      'fullscreen-graphic',
      'live-studio',
      'youtube-video',
      'youtube-news-sidebar',
    ])
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
    youtubeNewsSidebar: z.boolean().default(false),
    sidebarRotationSeconds: z.number().int().min(3).max(120).default(12),
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
    youtubeVideoIds: z.array(z.string().uuid()).max(50).default([]),
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
  if (body.articleIds.length && !body.youtubeVideoIds.length && !body.settings.youtubeNewsSidebar) {
    return createBroadcastPlaylistWithArticles(body.name, body.articleIds, {
      description: body.description,
      scheduledAt: body.scheduledAt,
      kind: body.kind,
      overlayProjectId: body.overlayProjectId,
      settings: body.settings,
    });
  }
  const playlist = await createBroadcastPlaylist(body.name, {
    description: body.description,
    scheduledAt: body.scheduledAt,
    kind: body.kind,
    overlayProjectId: body.overlayProjectId,
    settings: body.settings,
  });
  if (body.settings.youtubeNewsSidebar) {
    if (!body.articleIds.length || !body.youtubeVideoIds.length) {
      throw apiError(
        409,
        'Für den Modus „YouTube + News-Sidebar“ müssen Nachrichten und YouTube-Videos ausgewählt sein.',
      );
    }
    const [news, videos] = await Promise.all([sidebarNewsFromArticleIds(body.articleIds), listYoutubeVideos()]);
    if (!news.length) throw apiError(409, 'Keine freigegebenen Nachrichten für die Sidebar verfügbar.');
    const byId = new Map(videos.map((video) => [video.id, video]));
    for (const videoId of body.youtubeVideoIds) {
      const video = byId.get(videoId);
      if (!video || !video.enabled)
        throw apiError(409, 'Mindestens ein ausgewähltes YouTube-Video ist nicht verfügbar.');
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
          sidebarRotationSeconds: body.settings.sidebarRotationSeconds,
        },
        news,
      );
    }
    return { playlist, items: await listBroadcastItems(playlist.id) };
  }
  for (const articleId of body.articleIds) {
    const item = await addBroadcastItem(playlist.id, articleId);
    if (!item) throw apiError(409, 'Mindestens ein ausgewählter Beitrag ist nicht mehr freigegeben.');
  }
  if (body.youtubeVideoIds.length) {
    const videos = await listYoutubeVideos();
    const byId = new Map(videos.map((video) => [video.id, video]));
    for (const videoId of body.youtubeVideoIds) {
      const video = byId.get(videoId);
      if (!video || !video.enabled)
        throw apiError(409, 'Mindestens ein ausgewähltes YouTube-Video ist nicht verfügbar.');
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
  }
  return { playlist, items: await listBroadcastItems(playlist.id) };
});
app.post('/api/ai/broadcast-plan', aiCompletionRouteOptions, async (req, reply) => {
  requirePermission(req, reply, 'broadcast:write');
  const body = z
    .object({
      name: z.string().trim().max(140).optional(),
      maximumItems: z.number().int().min(1).max(16).default(8),
      targetRuntimeMinutes: z.number().int().min(2).max(180).default(20),
      minimumTrust: z.number().int().min(0).max(100).default(50),
      freshnessHours: z
        .number()
        .int()
        .min(1)
        .max(24 * 30)
        .default(72),
      focus: z
        .enum([
          'balanced',
          'breaking',
          'politics',
          'economy',
          'technology',
          'regional',
          'international',
          'culture',
          'sports',
        ])
        .default('balanced'),
      diversity: z.enum(['high', 'balanced', 'focused']).default('balanced'),
      categoryFilters: z.array(z.string().trim().min(1).max(80)).max(20).default([]),
      sourceIds: z.array(z.string().uuid()).max(50).default([]),
      instructions: z.string().trim().max(1200).optional(),
      scheduledAt: z.string().datetime().nullable().optional(),
      kind: z.enum(['playlist', 'show', 'hour', 'special']).default('show'),
      overlayProjectId: z.string().uuid().nullable().optional(),
      pauseSeconds: z.number().int().min(0).max(600).default(5),
      transition: z.enum(['clean', 'fade', 'headline', 'bumper']).default('fade'),
    })
    .parse(req.body ?? {});
  const plannerOptions: BroadcastPlannerOptions = body;
  const identity = await currentChannelIdentity();
  const candidates = filterBroadcastCandidates(await listBroadcastCandidateArticles(240), plannerOptions);
  if (!candidates.length) {
    throw Object.assign(
      new Error('Für diese Filter sind keine ausreichend aktuellen, freigegebenen Beiträge vorhanden.'),
      {
        statusCode: 409,
      },
    );
  }
  const fallback = deterministicBroadcastPlan({
    channelName: identity.channelName,
    articles: candidates,
    options: plannerOptions,
  });
  let aiResult: Awaited<ReturnType<typeof planBroadcast>> | null = null;
  let aiError = '';
  try {
    aiResult = await planBroadcast({
      channelName: identity.channelName,
      maximumItems: body.maximumItems,
      targetRuntimeMinutes: body.targetRuntimeMinutes,
      focus: body.focus,
      diversity: body.diversity,
      instructions: body.instructions,
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
  } catch (error) {
    aiError = error instanceof Error ? error.message : String(error);
    req.log.warn({ err: error }, 'KI-Sendeplanung fehlgeschlagen; deterministischer Ersatzplan wird verwendet');
  }
  const allowedIds = new Set(candidates.map((article) => article.id));
  const aiIds = aiResult
    ? [...new Set(aiResult.output.articleIds)].filter((id) => allowedIds.has(id)).slice(0, body.maximumItems)
    : [];
  const articleIds = aiIds.length ? aiIds : fallback.articleIds;
  if (!articleIds.length)
    throw apiError(409, 'Aus den gewählten Filtern konnte keine Sendung zusammengestellt werden.');
  const rationale = aiIds.length ? aiResult!.output.rationale : fallback.rationale;
  const { playlist, items } = await createBroadcastPlaylistWithArticles(
    body.name?.trim() || (aiIds.length ? aiResult!.output.name : fallback.name),
    articleIds,
    {
      description: body.instructions || rationale,
      scheduledAt: body.scheduledAt ?? null,
      kind: body.kind,
      overlayProjectId: body.overlayProjectId ?? null,
      settings: {
        aiPlanned: true,
        plannerFallback: !aiIds.length,
        focus: body.focus,
        diversity: body.diversity,
        targetRuntimeMinutes: body.targetRuntimeMinutes,
        pauseSeconds: body.pauseSeconds,
        transition: body.transition,
        repeatPolicy: 'none',
        categoryFilters: body.categoryFilters,
        sourceIds: body.sourceIds,
        minimumTrust: body.minimumTrust,
        freshnessHours: body.freshnessHours,
      },
    },
  );
  return {
    playlist,
    items,
    rationale,
    estimatedRuntimeSeconds: fallback.estimatedRuntimeSeconds,
    ai: aiIds.length
      ? { model: aiResult!.model, tier: aiResult!.tier, usage: aiResult!.usage, fallback: false }
      : { model: 'lokaler-redaktionsplaner', tier: 'free', usage: null, fallback: true, warning: aiError },
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
  const body = z
    .object({
      articleId: z.string().uuid().optional(),
      youtubeVideoId: z.string().uuid().optional(),
      sidebarArticleIds: z.array(z.string().uuid()).max(50).default([]),
    })
    .refine((value) => Boolean(value.articleId) !== Boolean(value.youtubeVideoId), {
      message: 'Genau ein Inhalt muss ausgewählt sein.',
    })
    .parse(req.body);
  const playlistId = (req.params as any).id;
  const item = body.articleId
    ? await addBroadcastItem(playlistId, body.articleId)
    : await (async () => {
        const video = (await listYoutubeVideos()).find((candidate) => candidate.id === body.youtubeVideoId);
        if (!video || !video.enabled) return undefined;
        if (body.sidebarArticleIds.length) {
          const news = await sidebarNewsFromArticleIds(body.sidebarArticleIds);
          if (!news.length) return undefined;
          return addBroadcastYoutubeNewsSidebarItem(
            playlistId,
            {
              id: video.id,
              title: video.title,
              url: video.url,
              videoId: video.video_id,
              channelTitle: video.channel_title,
              categoryId: video.category_id,
              categoryName: video.category_name,
              durationSeconds: video.duration_seconds,
              sidebarRotationSeconds: 12,
            },
            news,
          );
        }
        return addBroadcastYoutubeItem(playlistId, {
          id: video.id,
          title: video.title,
          url: video.url,
          videoId: video.video_id,
          channelTitle: video.channel_title,
          categoryId: video.category_id,
          categoryName: video.category_name,
          durationSeconds: video.duration_seconds,
        });
      })();
  if (!item) {
    throw Object.assign(new Error('Sendeliste oder freigegebener Inhalt nicht gefunden.'), { statusCode: 409 });
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
app.get('/live/youtube/:videoId', async (req, reply) => {
  const videoId = z
    .string()
    .regex(/^[a-zA-Z0-9_-]{6,20}$/)
    .parse((req.params as { videoId?: unknown }).videoId);
  const startSeconds = z.coerce
    .number()
    .int()
    .min(0)
    .max(86_400)
    .default(0)
    .parse((req.query as { start?: unknown }).start ?? 0);
  return reply
    .headers({
      'Cache-Control': 'no-store',
      'Referrer-Policy': 'strict-origin-when-cross-origin',
      'Content-Security-Policy':
        "default-src 'none'; frame-src https://www.youtube.com https://www.youtube-nocookie.com; style-src 'unsafe-inline'",
    })
    .type('text/html; charset=utf-8')
    .send(youtubeObsPlayerHtml(publicBaseUrl(), videoId, startSeconds));
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
  if (youtubeSource.last_portal_state.ready !== true) {
    throw apiError(
      409,
      'Die YouTube-Quelle ist noch nicht freigegeben. Melde dich über OBS → Quelle rechtsklicken → Interagieren bei YouTube an und bestätige die Quelle anschließend in der Live-Regie.',
    );
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
  const youtubeId = youtubeVideoId(youtubeSource);
  if (!youtubeId) {
    throw apiError(409, 'Die ausgewählte YouTube-Quelle enthält keine gültige Video-ID.');
  }
  const youtubeViewerUrl = youtubeObsViewerUrl(publicBaseUrl(), youtubeId);
  const refreshedYoutubeSource = await upsertLiveStudioSource({
    sourceId: youtubeSource.source_id,
    inputName: youtubeSource.input_name,
    displayName: youtubeSource.display_name,
    userName: youtubeSource.user_name,
    viewerUrl: youtubeViewerUrl,
    muted: youtubeSource.muted,
    hidden: false,
    slotIndex: youtubeSource.slot_index,
    inProgram: true,
    portalState: youtubeSource.last_portal_state,
  });
  await obs.ensureLiveSource({
    sourceId: refreshedYoutubeSource.source_id,
    viewerUrl: youtubeViewerUrl,
    muted: refreshedYoutubeSource.muted,
    hidden: false,
    index: refreshedYoutubeSource.slot_index,
  });
  await setAutopilotConfig({ ...(await getAutopilotConfig()), enabled: false });
  const pauseCommand = await queueLiveBroadcastTransport('pause');
  if (!pauseCommand) await obs.pauseMedia().catch(() => undefined);
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
async function queueLiveBroadcastTransport(action: 'pause' | 'resume') {
  const [run, snapshot] = await Promise.all([activeBroadcastRun(), getPlaybackSnapshot()]);
  if (!run) return null;
  const transition = validateTransition(snapshot.status as any, action);
  if (!transition.accepted) return null;
  return createBroadcastCommand({
    broadcastRunId: run.id,
    playlistId: run.playlist_id,
    command: action,
    idempotencyKey: `live-regie:${action}:${run.id}:${snapshot.stateRevision}`,
  });
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
  const pauseCommand = await queueLiveBroadcastTransport('pause');
  if (!pauseCommand) await obs.pauseMedia().catch(() => undefined);
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
  const ready = existing?.last_portal_state?.ready === true;
  const saved = await upsertLiveStudioSource({
    sourceId: youtube.sourceId,
    inputName: liveStudioInputName(youtube.sourceId),
    displayName: body.name ?? existing?.display_name ?? 'YouTube Live',
    userName: 'YouTube',
    viewerUrl: youtube.viewerUrl,
    muted: existing?.muted ?? body.muted,
    hidden: ready ? (existing?.hidden ?? false) : true,
    slotIndex: existing?.slot_index ?? existingSources.length,
    inProgram: existing?.in_program ?? false,
    portalState: {
      kind: 'youtube',
      videoId: youtube.videoId,
      previewUrl: youtube.previewUrl,
      canonicalUrl: youtube.canonicalUrl,
      ready,
      authPreparing: false,
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
app.post('/api/live/sources/:sourceId/youtube-prepare', async (req, reply) => {
  requirePermission(req, reply, 'obs:write');
  const sourceId = String((req.params as { sourceId?: unknown }).sourceId ?? '');
  const source = (await listLiveStudioSources()).find((candidate) => candidate.source_id === sourceId);
  if (!source || source.last_portal_state?.kind !== 'youtube') {
    throw apiError(404, 'YouTube-Quelle wurde nicht gefunden.');
  }
  const videoId = youtubeVideoId(source);
  if (!videoId) throw apiError(409, 'Die YouTube-Quelle enthält keine gültige Video-ID.');
  const loginUrl = `https://www.youtube.com/watch?v=${encodeURIComponent(videoId)}`;
  const saved = await upsertLiveStudioSource({
    sourceId: source.source_id,
    inputName: source.input_name,
    displayName: source.display_name,
    userName: source.user_name,
    viewerUrl: loginUrl,
    muted: source.muted,
    hidden: true,
    slotIndex: source.slot_index,
    inProgram: false,
    portalState: { ...source.last_portal_state, ready: false, authPreparing: true },
  });
  await obs.ensureLiveSource({
    sourceId: saved.source_id,
    viewerUrl: loginUrl,
    muted: saved.muted,
    hidden: true,
    index: saved.slot_index,
  });
  await appendLiveStudioChange('youtube-source-auth-prepared', { sourceId: saved.source_id });
  return { ok: true, source: saved, ...(await liveStatusSnapshot()) };
});
app.post('/api/live/sources/:sourceId/youtube-ready', async (req, reply) => {
  requirePermission(req, reply, 'obs:write');
  const sourceId = String((req.params as { sourceId?: unknown }).sourceId ?? '');
  const body = z.object({ ready: z.boolean() }).parse(req.body ?? {});
  const source = (await listLiveStudioSources()).find((candidate) => candidate.source_id === sourceId);
  if (!source || source.last_portal_state?.kind !== 'youtube') {
    throw apiError(404, 'YouTube-Quelle wurde nicht gefunden.');
  }
  const videoId = youtubeVideoId(source);
  if (!videoId) throw apiError(409, 'Die YouTube-Quelle enthält keine gültige Video-ID.');
  const viewerUrl = youtubeObsViewerUrl(publicBaseUrl(), videoId);
  const saved = await upsertLiveStudioSource({
    sourceId: source.source_id,
    inputName: source.input_name,
    displayName: source.display_name,
    userName: source.user_name,
    viewerUrl,
    muted: source.muted,
    hidden: body.ready ? source.hidden : true,
    slotIndex: source.slot_index,
    inProgram: body.ready ? source.in_program : false,
    portalState: { ...source.last_portal_state, ready: body.ready, authPreparing: false },
  });
  await obs.ensureLiveSource({
    sourceId: saved.source_id,
    viewerUrl,
    muted: saved.muted,
    hidden: saved.hidden,
    index: saved.slot_index,
  });
  await appendLiveStudioChange(body.ready ? 'youtube-source-ready' : 'youtube-source-locked', {
    sourceId: saved.source_id,
  });
  return { ok: true, source: saved, ...(await liveStatusSnapshot()) };
});
app.post('/api/live/sources/:sourceId/add', async (req, reply) => {
  requirePermission(req, reply, 'obs:write');
  const sourceId = String((req.params as any).sourceId ?? '');
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
app.delete('/api/live/sources/:sourceId', async (req, reply) => {
  requirePermission(req, reply, 'obs:write');
  const sourceId = String((req.params as any).sourceId ?? '');
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
app.patch('/api/live/sources/:sourceId', async (req, reply) => {
  requirePermission(req, reply, 'obs:write');
  const sourceId = String((req.params as any).sourceId ?? '');
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
  if (body.target === 'main-news') {
    const resumeCommand = await queueLiveBroadcastTransport('resume');
    if (!resumeCommand) await obs.setProgramAudioMuted(false);
  }
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
  return setupObsStudio();
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
app.get('/overlay/youtube-video', async (req, reply) => {
  const query = new URLSearchParams();
  for (const [key, value] of Object.entries(req.query as Record<string, unknown>)) {
    if (typeof value === 'string') query.set(key, value);
  }
  const suffix = query.toString();
  return reply.type('text/html').send(rendererHtml(`/api/overlay/youtube-video${suffix ? `?${suffix}` : ''}`));
});

function isGenericYoutubeOverlayChannel(value: string | null | undefined) {
  const normalized = (value ?? '')
    .trim()
    .toLowerCase()
    .replace(/\s*@\s*youtube$/, '');
  return !normalized || normalized === 'youtube';
}

function youtubeOverlayChannelLabel(value: string | null | undefined) {
  const trimmed = (value ?? '').trim();
  if (!trimmed) return 'YouTube';
  if (/\s@\s*youtube$/i.test(trimmed)) return trimmed;
  if (trimmed.toLowerCase() === 'youtube') return 'YouTube';
  return `${trimmed} @ YouTube`;
}

function youtubeVideoIdFromOverlayUrl(value: string) {
  try {
    return resolveYoutubeLiveSource(value).videoId;
  } catch {
    return null;
  }
}

async function resolveYoutubeOverlayMetadata(input: { itemId?: string; title: string; channel: string; url: string }) {
  let title = input.title || 'YouTube Video';
  let channel = input.channel || 'YouTube';
  let url = input.url || 'https://www.youtube.com';
  let videoId = youtubeVideoIdFromOverlayUrl(url);

  if (input.itemId) {
    const row = (
      await query<{
        rules: Record<string, unknown> | null;
        video_title: string | null;
        video_url: string | null;
        video_id: string | null;
        channel_title: string | null;
      }>(
        `select bi.rules,
                yv.title video_title,
                yv.url video_url,
                yv.video_id,
                yv.channel_title
         from broadcast_items bi
         left join youtube_videos yv
           on yv.deleted_at is null
          and (
            yv.id = case
              when (bi.rules->>'youtubeLibraryId') ~* '^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$'
              then (bi.rules->>'youtubeLibraryId')::uuid
              else null
            end
            or yv.video_id = nullif(bi.rules->>'youtubeVideoId','')
          )
         where bi.id=$1
         limit 1`,
        [input.itemId],
      )
    ).rows[0];
    if (row) {
      const rules = row.rules ?? {};
      if (!title || title === 'YouTube Video') {
        title =
          (typeof rules.title === 'string' && rules.title.trim() ? rules.title : null) ?? row.video_title ?? title;
      }
      if (!url || url === 'https://www.youtube.com') {
        url = (typeof rules.url === 'string' && rules.url.trim() ? rules.url : null) ?? row.video_url ?? url;
      }
      videoId =
        row.video_id ??
        (typeof rules.youtubeVideoId === 'string' && rules.youtubeVideoId.trim() ? rules.youtubeVideoId : null) ??
        videoId;
      const rulesChannel =
        typeof rules.channelTitle === 'string' && rules.channelTitle.trim() ? rules.channelTitle : null;
      const bestStoredChannel = !isGenericYoutubeOverlayChannel(row.channel_title)
        ? row.channel_title
        : !isGenericYoutubeOverlayChannel(rulesChannel)
          ? rulesChannel
          : null;
      if (isGenericYoutubeOverlayChannel(channel) && bestStoredChannel) channel = bestStoredChannel;
    }
  }

  if (isGenericYoutubeOverlayChannel(channel) && videoId) {
    try {
      const oembed = await resolveYoutubeOEmbedMetadata(videoId);
      channel = oembed.channelTitle;
      if (!title || title === 'YouTube Video') title = oembed.title;
      await query(
        `update youtube_videos
         set channel_title=$2, title=case when title='' or title='YouTube Video' then $3 else title end, updated_at=now()
         where video_id=$1 and deleted_at is null and (channel_title='' or lower(channel_title)='youtube')`,
        [videoId, oembed.channelTitle, oembed.title],
      ).catch(() => undefined);
    } catch {
      // Keep the overlay renderable even when YouTube metadata cannot be refreshed.
    }
  }

  return {
    title,
    channel: youtubeOverlayChannelLabel(channel),
    url,
    itemId: input.itemId ?? null,
  };
}

async function resolveUpcomingYoutubeOverlayInfo(itemId: string | undefined) {
  const current = itemId
    ? (
        await query<{
          id: string;
          playlist_id: string;
          position: number;
          status: string;
          started_at: Date | string | null;
          duration_seconds: number | null;
          scheduled_at: Date | string | null;
        }>(
          `select bi.id,bi.playlist_id,bi.position,bi.status,bi.started_at,bi.duration_seconds,bp.scheduled_at
           from broadcast_items bi
           join broadcast_playlists bp on bp.id=bi.playlist_id
           where bi.id=$1
           limit 1`,
          [itemId],
        )
      ).rows[0]
    : null;
  const samePlaylistNext = current
    ? (
        await query<{
          id: string;
          title: string | null;
          channel_title: string | null;
          url: string | null;
          position: number;
        }>(
          `select bi.id,
                  coalesce(nullif(bi.rules->>'title',''),yv.title,'YouTube-Video') title,
                  coalesce(nullif(bi.rules->>'channelTitle',''),yv.channel_title,'YouTube') channel_title,
                  coalesce(nullif(bi.rules->>'url',''),yv.url) url,
                  bi.position
           from broadcast_items bi
           left join youtube_videos yv
             on yv.deleted_at is null
            and (
              yv.id = case
                when (bi.rules->>'youtubeLibraryId') ~* '^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$'
                then (bi.rules->>'youtubeLibraryId')::uuid
                else null
              end
              or yv.video_id = nullif(bi.rules->>'youtubeVideoId','')
            )
           where bi.playlist_id=$1
             and bi.position>$2
             and bi.status in ('planned','preparing')
             and bi.rules->>'kind' in ('youtube-video','youtube-news-sidebar')
             and coalesce(bi.rules->>'youtubeVideoId','') <> ''
           order by bi.position
           limit 1`,
          [current.playlist_id, current.position],
        )
      ).rows[0]
    : null;
  if (samePlaylistNext) {
    let target =
      current?.started_at && Number(current.duration_seconds ?? 0) > 0
        ? new Date(new Date(current.started_at).getTime() + Number(current.duration_seconds) * 1000)
        : null;
    if (!target && current?.scheduled_at) {
      const offset = (
        await query<{ seconds: number }>(
          `select coalesce(sum(duration_seconds),0)::int seconds
           from broadcast_items
           where playlist_id=$1
             and position<$2`,
          [current.playlist_id, samePlaylistNext.position],
        )
      ).rows[0]?.seconds;
      target = new Date(new Date(current.scheduled_at).getTime() + Number(offset ?? 0) * 1000);
    }
    return youtubeUpcomingPayload({
      title: samePlaylistNext.title ?? 'YouTube-Video',
      channel: samePlaylistNext.channel_title ?? 'YouTube',
      startsAt: target,
      label: target ? 'Nächstes Video' : 'Nächstes Video nach aktuellem Beitrag',
    });
  }
  const nextShow = (
    await query<{
      id: string;
      playlist_name: string;
      scheduled_at: Date | string;
      title: string | null;
      channel_title: string | null;
      url: string | null;
    }>(
      `select bp.id,
              bp.name playlist_name,
              bp.scheduled_at,
              coalesce(nullif(bi.rules->>'title',''),yv.title,'YouTube-Video') title,
              coalesce(nullif(bi.rules->>'channelTitle',''),yv.channel_title,'YouTube') channel_title,
              coalesce(nullif(bi.rules->>'url',''),yv.url) url
       from broadcast_playlists bp
       join lateral (
         select *
         from broadcast_items item
         where item.playlist_id=bp.id
           and item.rules->>'kind' in ('youtube-video','youtube-news-sidebar')
           and coalesce(item.rules->>'youtubeVideoId','') <> ''
         order by item.position
         limit 1
       ) bi on true
       left join youtube_videos yv
         on yv.deleted_at is null
        and (
          yv.id = case
            when (bi.rules->>'youtubeLibraryId') ~* '^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$'
            then (bi.rules->>'youtubeLibraryId')::uuid
            else null
          end
          or yv.video_id = nullif(bi.rules->>'youtubeVideoId','')
        )
       where bp.scheduled_at is not null
         and bp.scheduled_at > now()
         and bp.status in ('draft','scheduled')
       order by bp.scheduled_at asc
       limit 1`,
    )
  ).rows[0];
  if (!nextShow) {
    return youtubeUpcomingPayload({
      title: 'Keine weitere YouTube-Sendung geplant',
      channel: '',
      startsAt: null,
      label: 'Nächste Sendung',
    });
  }
  return youtubeUpcomingPayload({
    title: nextShow.title ?? nextShow.playlist_name,
    channel: nextShow.channel_title ?? 'YouTube',
    startsAt: new Date(nextShow.scheduled_at),
    label: 'Nächste Sendung',
  });
}

function youtubeUpcomingPayload(input: { title: string; channel: string; startsAt: Date | null; label: string }) {
  const target = input.startsAt && Number.isFinite(input.startsAt.getTime()) ? input.startsAt : null;
  const startsAtText = target
    ? `${input.label} · ${formatYoutubeOverlayDate(target)}${input.channel ? ` · ${youtubeOverlayChannelLabel(input.channel)}` : ''}`
    : `${input.label}${input.channel ? ` · ${youtubeOverlayChannelLabel(input.channel)}` : ''}`;
  return {
    nextTitle: input.title,
    nextChannel: input.channel ? youtubeOverlayChannelLabel(input.channel) : '',
    nextStartsAt: startsAtText,
    nextCountdown: formatCountdown(target),
    nextCountdownTarget: target?.toISOString() ?? null,
  };
}

function formatYoutubeOverlayDate(value: Date) {
  return new Intl.DateTimeFormat('de-DE', {
    weekday: 'short',
    day: '2-digit',
    month: '2-digit',
    hour: '2-digit',
    minute: '2-digit',
    timeZone: 'Europe/Berlin',
  }).format(value);
}

function formatCountdown(target: Date | null) {
  if (!target) return '--:--';
  const totalSeconds = Math.max(0, Math.ceil((target.getTime() - Date.now()) / 1000));
  const minutes = Math.floor(totalSeconds / 60);
  const seconds = totalSeconds % 60;
  return `${String(minutes).padStart(2, '0')}:${String(seconds).padStart(2, '0')}`;
}

app.get('/api/overlay/youtube-video', async (req) => {
  const query = z
    .object({
      itemId: z.string().uuid().optional(),
      title: z.string().trim().max(220).catch('YouTube Video'),
      channel: z.string().trim().max(160).catch('YouTube @ YouTube'),
      url: z.string().trim().max(500).catch('https://www.youtube.com'),
    })
    .parse(req.query ?? {});
  const configured = (await getConfiguredOverlay('youtube-video')) ?? (await getPublishedOverlay('youtube-video'));
  const youtube = {
    ...(await resolveYoutubeOverlayMetadata(query)),
    ...(await resolveUpcomingYoutubeOverlayInfo(query.itemId)),
  };
  const overlay = ensureYoutubeScheduleElements(
    configured?.snapshot ?? createTemplate('youtube-video', 1920, 1080, process.env.CHANNEL_NAME ?? 'Mein Kanal'),
    'youtube-video',
    process.env.CHANNEL_NAME ?? 'Mein Kanal',
  );
  return {
    article: null,
    channel: { name: process.env.CHANNEL_NAME ?? 'Mein Kanal' },
    playback: await getPlaybackState<any>(),
    youtube,
    host: await aiHostOverlayState(query.itemId),
    overlay,
    versionId: configured?.version_id ?? null,
    version: configured?.published_version ?? configured?.version ?? 1,
    eventVersion: Date.now(),
    serverTime: new Date().toISOString(),
  };
});
function decodeSidebarNews(value: string | undefined) {
  if (!value) return [];
  try {
    const decoded = JSON.parse(Buffer.from(value, 'base64url').toString('utf8'));
    if (!Array.isArray(decoded)) return [];
    return decoded
      .map((item) => {
        if (!item || typeof item !== 'object') return null;
        const row = item as Record<string, unknown>;
        return {
          title: typeof row.title === 'string' ? row.title.slice(0, 180) : '',
          text: typeof row.text === 'string' ? row.text.slice(0, 2200) : '',
          source: typeof row.source === 'string' ? row.source.slice(0, 120) : '',
        };
      })
      .filter((item): item is { title: string; text: string; source: string } => Boolean(item?.title || item?.text))
      .slice(0, 20);
  } catch {
    return [];
  }
}
async function sidebarNewsFromBroadcastItem(itemId: string | undefined) {
  if (!itemId) return [];
  const row = (
    await query<{ news: unknown }>(
      `select rules->'news' news
       from broadcast_items
       where id=$1
         and rules->>'kind'='youtube-news-sidebar'
       limit 1`,
      [itemId],
    )
  ).rows[0];
  if (!row) return [];
  if (!Array.isArray(row.news)) return [];
  return row.news
    .map((item) => {
      if (!item || typeof item !== 'object') return null;
      const entry = item as Record<string, unknown>;
      return {
        title: typeof entry.title === 'string' ? entry.title.slice(0, 180) : '',
        text: typeof entry.text === 'string' ? entry.text.slice(0, 2200) : '',
        source: typeof entry.source === 'string' ? entry.source.slice(0, 120) : '',
      };
    })
    .filter((item): item is { title: string; text: string; source: string } => Boolean(item?.title || item?.text))
    .slice(0, 20);
}
async function latestSidebarNews(limit = 20) {
  return (
    await query<{ id: string; title: string; text: string; source: string; published_at: string }>(
      `select a.id,
              left(a.title,180) title,
              left(coalesce(nullif(sc.screen_text,''),nullif(sm.summary,''),nullif(a.excerpt,''),nullif(a.main_text,''),a.title),2200) text,
              left(coalesce(nullif(s.name,''),'Redaktion'),120) source,
              coalesce(a.published_at,a.fetched_at) published_at
       from articles a
       left join sources s on s.id=a.source_id
       left join lateral (
         select screen_text from scripts where article_id=a.id order by created_at desc limit 1
       ) sc on true
       left join lateral (
         select summary from summaries where article_id=a.id order by created_at desc limit 1
       ) sm on true
       where a.deleted_at is null and a.status in ('approved','published')
       order by coalesce(a.published_at,a.fetched_at) desc,a.id desc
       limit $1`,
      [Math.max(1, Math.min(50, limit))],
    )
  ).rows.map((item) => ({ title: item.title, text: item.text, source: item.source }));
}
function youtubeNewsSidebarDocument(
  news: Array<{ title: string; text: string; source: string }>,
  channelName: string,
  rotationSeconds: number,
) {
  const doc = createTemplate('youtube-news-sidebar', 1920, 1080, channelName);
  return injectYoutubeSidebarNews(doc, news, rotationSeconds);
}

function ensureYoutubeScheduleElements(
  doc: any,
  template: 'youtube-video' | 'youtube-news-sidebar',
  channelName: string,
) {
  if (!doc || !Array.isArray(doc.elements)) return doc;
  const templateDoc = createTemplate(template, doc.width ?? 1920, doc.height ?? 1080, channelName);
  const scheduleNames = new Set([
    'Nächste Sendung Fläche',
    'Nächste Sendung Label',
    'Nächster Countdown',
    'Nächstes Video Titel',
    'Nächstes Video Meta',
  ]);
  const existing = new Set(doc.elements.map((element: any) => element?.name));
  const additions = templateDoc.elements.filter(
    (element) => scheduleNames.has(element.name) && !existing.has(element.name),
  );
  if (!additions.length) return doc;
  return { ...doc, elements: [...doc.elements, ...additions] };
}

function injectYoutubeSidebarNews(
  doc: any,
  news: Array<{ title: string; text: string; source: string }>,
  rotationSeconds: number,
) {
  if (!doc || !Array.isArray(doc.elements)) return doc;
  const selectedNews = news.length ? news[Math.floor(Date.now() / (rotationSeconds * 1000)) % news.length]! : null;
  const sidebarWidth = doc.width >= doc.height ? 1010 : Math.max(640, doc.width - 108);
  const cardWidth = doc.width >= doc.height ? 886 : doc.width - 184;
  const cardY = 220;
  const cardHeight = doc.width >= doc.height ? 650 : Math.max(440, Math.floor(doc.height * 0.42));
  return {
    ...doc,
    elements: doc.elements.map((element: any) => {
      if (element.name === 'Sidebar Fläche') {
        return { ...element, width: sidebarWidth, height: doc.height - 108 };
      }
      const titleMatch = /^News Titel (\d+)$/.exec(element.name);
      const textMatch = /^News Text (\d+)$/.exec(element.name);
      const sourceMatch = /^News Quelle (\d+)$/.exec(element.name);
      const cardMatch = /^News Karte (\d+)$/.exec(element.name);
      const index = Number(titleMatch?.[1] ?? textMatch?.[1] ?? sourceMatch?.[1] ?? cardMatch?.[1] ?? 0);
      if (index > 1) return { ...element, hidden: true };
      if (cardMatch) {
        return {
          ...element,
          x: 92,
          y: cardY,
          width: cardWidth,
          height: cardHeight,
          hidden: false,
          props: {
            ...element.props,
            background: 'rgba(15,23,42,0.88)',
            borderColor: 'rgba(251,113,133,0.76)',
            borderWidth: 2,
            borderRadius: 22,
          },
        };
      }
      const item = selectedNews;
      if (!item) return element;
      if (titleMatch)
        return {
          ...element,
          x: 122,
          y: cardY + 32,
          width: cardWidth - 60,
          height: 120,
          hidden: false,
          props: {
            ...element.props,
            text: item.title || 'Nachricht',
            fontSize: doc.width >= doc.height ? 39 : 31,
            fontWeight: '900',
          },
        };
      if (textMatch)
        return {
          ...element,
          x: 122,
          y: cardY + 170,
          width: cardWidth - 60,
          height: cardHeight - 250,
          hidden: false,
          props: {
            ...element.props,
            text: item.text || item.title,
            fontSize: doc.width >= doc.height ? 26 : 22,
            fontWeight: '700',
          },
        };
      if (sourceMatch)
        return {
          ...element,
          x: 122,
          y: cardY + cardHeight - 58,
          width: cardWidth - 60,
          height: 32,
          hidden: false,
          props: { ...element.props, text: item.source || 'Quelle', fontSize: 22, fontWeight: '900' },
        };
      return element;
    }),
  };
}
app.get('/overlay/youtube-news-sidebar', async (req, reply) => {
  const query = new URLSearchParams();
  for (const [key, value] of Object.entries(req.query as Record<string, unknown>)) {
    if (typeof value === 'string') query.set(key, value);
  }
  const suffix = query.toString();
  return reply.type('text/html').send(rendererHtml(`/api/overlay/youtube-news-sidebar${suffix ? `?${suffix}` : ''}`));
});
app.get('/api/overlay/youtube-news-sidebar', async (req) => {
  const query = z
    .object({
      itemId: z.string().max(120).optional(),
      title: z.string().trim().max(220).catch('YouTube Video'),
      channel: z.string().trim().max(160).catch('YouTube @ YouTube'),
      url: z.string().trim().max(500).catch('https://www.youtube.com'),
      news: z.string().max(30000).optional(),
      rotationSeconds: z.coerce.number().int().min(3).max(120).catch(12),
    })
    .parse(req.query ?? {});
  const identity = await currentChannelIdentity();
  const configured =
    (await getConfiguredOverlay('youtube-news-sidebar')) ?? (await getPublishedOverlay('youtube-news-sidebar'));
  const [latestNews, newsFromItem] = await Promise.all([
    latestSidebarNews(20),
    sidebarNewsFromBroadcastItem(query.itemId),
  ]);
  const news = latestNews.length ? latestNews : newsFromItem.length ? newsFromItem : decodeSidebarNews(query.news);
  const youtube = {
    ...(await resolveYoutubeOverlayMetadata(query)),
    ...(await resolveUpcomingYoutubeOverlayInfo(query.itemId)),
  };
  const baseOverlay =
    configured?.snapshot ?? youtubeNewsSidebarDocument(news, identity.channelName, query.rotationSeconds);
  return {
    article: null,
    channel: { name: identity.channelName },
    playback: await getPlaybackState<any>(),
    youtube,
    host: await aiHostOverlayState(query.itemId),
    overlay: injectYoutubeSidebarNews(
      ensureYoutubeScheduleElements(baseOverlay, 'youtube-news-sidebar', identity.channelName),
      news,
      query.rotationSeconds,
    ),
    versionId: configured?.version_id ?? null,
    version: configured?.published_version ?? configured?.version ?? 1,
    eventVersion: Date.now(),
    serverTime: new Date().toISOString(),
  };
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
    '.ai-host-layer{position:absolute;z-index:980;width:680px;display:grid;grid-template-columns:148px 1fr;gap:18px;align-items:end;color:#f8fafc;filter:drop-shadow(0 22px 35px rgba(0,0,0,.52));pointer-events:none}',
    '.ai-host-layer.has-video-avatar{width:850px;grid-template-columns:300px 1fr;gap:10px}',
    '.ai-host-layer.entering{animation:hostEnter .55s cubic-bezier(.16,1,.3,1)}',
    '.ai-host-layer.voice-sync{transition:opacity .18s ease}.ai-host-layer.voice-waiting,.ai-host-layer.voice-finished{visibility:hidden;opacity:0}',
    '.ai-host-layer.top-left{left:58px;top:58px;transform-origin:top left}.ai-host-layer.top-right{right:58px;top:58px;transform-origin:top right}.ai-host-layer.bottom-left{left:58px;bottom:58px;transform-origin:bottom left}.ai-host-layer.bottom-right{right:58px;bottom:58px;transform-origin:bottom right}',
    '.ai-host-avatar{position:relative;width:148px;height:190px;align-self:end;border:3px solid var(--host-accent,#fb7185);border-radius:74px 74px 24px 24px;background:radial-gradient(circle at 50% 32%,#f8d5bf 0 24%,transparent 25%),linear-gradient(155deg,color-mix(in srgb,var(--host-accent) 62%,#172033),#101827 68%);box-shadow:inset 0 0 0 5px rgba(255,255,255,.08),0 0 30px color-mix(in srgb,var(--host-accent) 40%,transparent);overflow:hidden}',
    '.ai-host-avatar.video{width:300px;height:360px;border:0;border-radius:0;background:transparent;box-shadow:none;overflow:hidden}',
    '.ai-host-avatar.video:before,.ai-host-avatar.video:after{display:none}',
    '.ai-host-avatar-video{position:absolute;inset:0;width:100%;height:100%;object-fit:cover;object-position:50% 50%;filter:drop-shadow(0 14px 18px rgba(0,0,0,.55));mask-image:linear-gradient(to bottom,#000 0 88%,transparent 100%)}',
    '.ai-host-avatar:before{content:"";position:absolute;left:44px;top:51px;width:60px;height:45px;border-radius:45% 45% 52% 52%;background:linear-gradient(90deg,transparent 0 16%,#18202e 17% 24%,transparent 25% 73%,#18202e 74% 81%,transparent 82%)}',
    '.ai-host-avatar:after{content:"";position:absolute;left:57px;top:88px;width:34px;height:8px;border-radius:0 0 18px 18px;background:#9f4552;transform-origin:center;animation:hostIdle 3.4s ease-in-out infinite}',
    '.ai-host-layer.speaking .ai-host-avatar:after{animation:hostTalk .22s ease-in-out infinite alternate}',
    '.ai-host-live-dot{position:absolute;right:10px;top:12px;width:16px;height:16px;border:3px solid #fff;border-radius:50%;background:#ef4444;box-shadow:0 0 16px #ef4444;animation:hostPulse 1.2s ease infinite}',
    '.ai-host-card{overflow:hidden;border:1px solid color-mix(in srgb,var(--host-accent) 48%,rgba(255,255,255,.18));border-left:8px solid var(--host-accent,#fb7185);border-radius:20px;background:linear-gradient(135deg,rgba(5,10,18,.96),rgba(15,23,42,.92));box-shadow:inset 0 1px rgba(255,255,255,.08)}',
    '.ai-host-head{display:flex;align-items:center;gap:12px;padding:14px 20px 10px;border-bottom:1px solid rgba(255,255,255,.1)}.ai-host-head strong{font-size:23px}.ai-host-head span{margin-left:auto;padding:5px 9px;border-radius:999px;background:color-mix(in srgb,var(--host-accent) 22%,transparent);color:var(--host-accent);font-size:13px;font-weight:950;letter-spacing:.08em}',
    '.ai-host-copy{padding:16px 20px 17px}.ai-host-copy small{display:block;margin-bottom:6px;color:var(--host-accent);font-size:15px;font-weight:900;letter-spacing:.08em;text-transform:uppercase}.ai-host-copy p{margin:0;font-size:25px;font-weight:760;line-height:1.22}.ai-host-chat{margin:0 20px 14px;padding:11px 14px;border-radius:12px;background:rgba(56,189,248,.1);color:#dbeafe;font-size:17px;font-weight:700}.ai-host-cta{padding:11px 20px 13px;background:var(--host-accent);color:#080b12;font-size:18px;font-weight:950}',
    '.ai-host-share{display:flex;gap:10px;align-items:center;padding:9px 20px 11px;border-top:1px solid rgba(255,255,255,.1);color:#dbeafe;font-size:14px;font-weight:800}.ai-host-share strong{color:#fff}',
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
    '@keyframes hostEnter{from{opacity:0;translate:0 70px;scale:.9}to{opacity:1;translate:0 0;scale:1}}',
    '@keyframes hostTalk{from{height:5px;translate:0 0}to{height:18px;translate:0 -2px}}@keyframes hostIdle{50%{transform:scaleX(.72)}}@keyframes hostPulse{50%{opacity:.45;scale:.8}}',
  ].join('');
  const script = [
    `const dataUrl=${JSON.stringify(dataUrl)};`,
    `const token=${JSON.stringify(overlayToken ?? '')};`,
    'const HOST_VISUAL_LEAD_MS=1100,HOST_LAYER_STABLE_MS=260;',
    'let currentVersion=-1,currentDoc=null,activeHostAudio=null,activeHostAudioTurn=null,pendingHostAudioTurn=null,aiHostLayer=null,aiHostTurnId=null;',
    'const playedHostTurns=new Set(),finishedHostAudioTurns=new Set(),revealedHostAudioTurns=new Set(),failedHostAvatarUrls=new Set();',
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
    "    'youtube.title':data.youtube?.title,",
    "    'youtube.channel':data.youtube?.channel,",
    "    'youtube.url':data.youtube?.url,",
    "    'youtube.nextTitle':data.youtube?.nextTitle,",
    "    'youtube.nextChannel':data.youtube?.nextChannel,",
    "    'youtube.nextStartsAt':data.youtube?.nextStartsAt,",
    "    'youtube.nextCountdown':data.youtube?.nextCountdown,",
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
    'function countdownText(target){',
    '  if(!target)return "--:--";',
    '  const ms=new Date(target).getTime()-Date.now();',
    '  if(!Number.isFinite(ms))return "--:--";',
    '  const total=Math.max(0,Math.ceil(ms/1000));',
    '  const minutes=Math.floor(total/60);',
    '  const seconds=total%60;',
    "  return String(minutes).padStart(2,'0')+':'+String(seconds).padStart(2,'0');",
    '}',
    'function updateCountdowns(){',
    "  root.querySelectorAll('[data-countdown-target]').forEach((node)=>{node.textContent=countdownText(node.dataset.countdownTarget)});",
    '}',
    'function fitCanvas(doc){',
    '  const scale=Math.min(window.innerWidth/doc.width,window.innerHeight/doc.height);',
    "  root.style.position='absolute';",
    "  root.style.left=Math.max(0,(window.innerWidth-doc.width*scale)/2)+'px';",
    "  root.style.top=Math.max(0,(window.innerHeight-doc.height*scale)/2)+'px';",
    "  root.style.transformOrigin='top left';",
    "  root.style.transform='scale('+scale+')';",
    '}',
    'function playHostAudio(host){',
    '  const turn=host?.turn;if(!host?.visible||!turn?.audioUrl||playedHostTurns.has(turn.id)||activeHostAudioTurn===turn.id||pendingHostAudioTurn===turn.id)return;',
    '  const voiceSync=host.avatarVoiceSync===true;if(activeHostAudio){activeHostAudio.pause();activeHostAudio.remove();activeHostAudio=null;activeHostAudioTurn=null}',
    '  const audio=document.createElement("audio");audio.src=turn.audioUrl;audio.autoplay=false;audio.preload="auto";audio.style.display="none";document.body.appendChild(audio);activeHostAudio=audio;pendingHostAudioTurn=turn.id;',
    '  let starting=false,settled=false;',
    '  const finish=(failed=false)=>{if(settled)return;settled=true;if(failed)finishedHostAudioTurns.add(turn.id);const layer=aiHostTurnId===turn.id?aiHostLayer:null;if(layer){layer.dataset.voicePhase="finished";layer.classList.remove("speaking","entering");if(voiceSync)layer.classList.add("voice-finished")}audio.remove();if(activeHostAudio===audio)activeHostAudio=null;if(activeHostAudioTurn===turn.id)activeHostAudioTurn=null;if(pendingHostAudioTurn===turn.id)pendingHostAudioTurn=null};',
    '  const revealAndPlay=()=>{if(starting||settled)return;starting=true;const layer=aiHostTurnId===turn.id?aiHostLayer:null;if(!layer){finish(true);return}const video=layer.querySelector(".ai-host-avatar-video");let visualReady=false;const startAudio=()=>{if(settled||aiHostTurnId!==turn.id||!layer.isConnected){finish(true);return}pendingHostAudioTurn=null;activeHostAudioTurn=turn.id;audio.play().catch(()=>finish(true))};const reveal=()=>{if(visualReady||settled)return;visualReady=true;revealedHostAudioTurns.add(turn.id);layer.dataset.voicePhase="visible";layer.classList.remove("voice-waiting","voice-finished");layer.classList.add("entering");void layer.offsetHeight;requestAnimationFrame(()=>requestAnimationFrame(()=>setTimeout(()=>setTimeout(startAudio,HOST_VISUAL_LEAD_MS),HOST_LAYER_STABLE_MS)))};if(!video){reveal();return}let frameHandled=false;const frameReady=()=>{if(frameHandled)return;frameHandled=true;reveal()};const playVideo=()=>{try{video.currentTime=0}catch{}const playback=video.play();if(typeof video.requestVideoFrameCallback==="function")video.requestVideoFrameCallback(()=>requestAnimationFrame(frameReady));else if(video.readyState>=2)requestAnimationFrame(()=>requestAnimationFrame(frameReady));else video.addEventListener("playing",()=>requestAnimationFrame(frameReady),{once:true});if(playback&&typeof playback.catch==="function")playback.catch(()=>requestAnimationFrame(frameReady))};if(video.readyState>=3)playVideo();else video.addEventListener("canplay",playVideo,{once:true});setTimeout(()=>{if(!frameHandled)frameReady()},2400)};',
    '  audio.addEventListener("canplay",revealAndPlay,{once:true});audio.addEventListener("error",()=>finish(true),{once:true});',
    '  audio.addEventListener("play",()=>{playedHostTurns.add(turn.id);activeHostAudioTurn=turn.id;const layer=aiHostTurnId===turn.id?aiHostLayer:null;if(layer)layer.dataset.voicePhase="speaking";layer?.classList.remove("voice-waiting","voice-finished","entering");layer?.classList.add("speaking");const video=layer?.querySelector(".ai-host-avatar-video");if(video)video.play().catch(()=>{})});',
    '  audio.addEventListener("ended",()=>{finishedHostAudioTurns.add(turn.id);finish()},{once:true});audio.load();if(audio.readyState>=3)queueMicrotask(revealAndPlay);setTimeout(()=>{if(!starting&&audio.readyState>=2)revealAndPlay()},2200);',
    '}',
    'function hostText(layer,role,value){const node=layer.querySelector("[data-host-role=\\""+role+"\\"]");if(node)node.textContent=value||""}',
    'function syncHostAvatarVideo(avatar,url){',
    '  let video=avatar.querySelector(".ai-host-avatar-video");',
    '  if(!url||failedHostAvatarUrls.has(url)){if(video)video.remove();avatar.classList.remove("video");return}',
    '  avatar.classList.add("video");',
    '  if(!video){video=document.createElement("video");video.className="ai-host-avatar-video";video.autoplay=true;video.loop=true;video.muted=true;video.playsInline=true;video.preload="auto";avatar.prepend(video)}',
    '  if(video.dataset.src!==url){video.dataset.src=url;video.src=url;video.load()}',
    '  video.onerror=()=>{failedHostAvatarUrls.add(url);video.remove();avatar.classList.remove("video")};',
    '  video.play().catch(()=>{});',
    '}',
    'function buildAiHostLayer(host){',
    '  const layer=document.createElement("div");layer.className="ai-host-layer";',
    '  const avatar=document.createElement("div");avatar.className="ai-host-avatar";avatar.dataset.hostRole="avatar";syncHostAvatarVideo(avatar,host?.moderator?.avatarVideoUrl);const dot=document.createElement("i");dot.className="ai-host-live-dot";avatar.appendChild(dot);layer.appendChild(avatar);',
    '  const card=document.createElement("div");card.className="ai-host-card";const head=document.createElement("div");head.className="ai-host-head";const name=document.createElement("strong");name.dataset.hostRole="name";const badge=document.createElement("span");badge.textContent="KI-MODERATION";head.append(name,badge);card.appendChild(head);',
    '  const copy=document.createElement("div");copy.className="ai-host-copy";const title=document.createElement("small");title.dataset.hostRole="headline";const body=document.createElement("p");body.dataset.hostRole="text";copy.append(title,body);card.appendChild(copy);',
    '  const chat=document.createElement("div");chat.className="ai-host-chat";chat.dataset.hostRole="chat";card.appendChild(chat);',
    '  const cta=document.createElement("div");cta.className="ai-host-cta";cta.dataset.hostRole="cta";card.appendChild(cta);',
    '  const share=document.createElement("div");share.className="ai-host-share";const prompt=document.createElement("span");prompt.dataset.hostRole="sharePrompt";const url=document.createElement("strong");url.dataset.hostRole="shareUrl";share.append(prompt,url);card.appendChild(share);',
    '  layer.appendChild(card);return layer;',
    '}',
    'function renderAiHost(host,doc){',
    '  if(!host?.visible||!host.turn){if(aiHostLayer)aiHostLayer.remove();aiHostLayer=null;aiHostTurnId=null;return;}',
    '  const isNewTurn=aiHostTurnId!==host.turn.id;if(!aiHostLayer||isNewTurn){if(aiHostLayer)aiHostLayer.remove();aiHostLayer=buildAiHostLayer(host);aiHostTurnId=host.turn.id;aiHostLayer.classList.add("entering");setTimeout(()=>aiHostLayer?.classList.remove("entering"),700)}',
    '  const accent=host.moderator?.accentColor||"#fb7185",position=host.position||"bottom-right",hasVideo=Boolean(host.moderator?.avatarVideoUrl),voiceSync=host.avatarVoiceSync===true,audioActive=activeHostAudioTurn===host.turn.id,audioFinished=finishedHostAudioTurns.has(host.turn.id),audioRevealed=revealedHostAudioTurns.has(host.turn.id),audioStarting=pendingHostAudioTurn===host.turn.id&&audioRevealed;aiHostLayer.className="ai-host-layer "+position+(hasVideo?" has-video-avatar":"")+(voiceSync?" voice-sync":"")+(audioActive?" speaking":"")+(audioStarting?" entering":"")+(voiceSync&&!audioActive&&!audioRevealed&&!audioFinished?" voice-waiting":"")+(voiceSync&&audioFinished?" voice-finished":"")+(isNewTurn&&!voiceSync?" entering":"");aiHostLayer.style.setProperty("--host-accent",accent);aiHostLayer.style.scale=String(Math.max(.65,Math.min(1.4,(host.scale||100)/100)));aiHostLayer.style.gridTemplateColumns=host.showAvatar===false?"1fr":hasVideo?"300px 1fr":"148px 1fr";',
    '  const avatar=aiHostLayer.querySelector("[data-host-role=\\"avatar\\"]");if(avatar){avatar.style.display=host.showAvatar===false?"none":"";syncHostAvatarVideo(avatar,host.moderator?.avatarVideoUrl)}',
    '  hostText(aiHostLayer,"name",(host.moderator?.name||"Ava")+" · "+(host.moderator?.jobTitle||"Avatar-Moderation"));hostText(aiHostLayer,"headline",host.turn.headline||"Live eingeordnet");hostText(aiHostLayer,"text",host.turn.text||"");',
    '  const chat=aiHostLayer.querySelector("[data-host-role=\\"chat\\"]");if(chat){chat.textContent=host.showChat!==false&&host.turn.chatExcerpt?(host.turn.chatTheme?host.turn.chatTheme+": ":"")+host.turn.chatExcerpt:"";chat.style.display=chat.textContent?"": "none"}',
    '  const cta=aiHostLayer.querySelector("[data-host-role=\\"cta\\"]");if(cta){cta.textContent=host.turn.cta||"";cta.style.display=cta.textContent?"":"none"}',
    '  const share=aiHostLayer.querySelector(".ai-host-share");if(share){const visible=Boolean(host.growth?.sharePrompt);share.style.display=visible?"flex":"none";hostText(aiHostLayer,"sharePrompt",host.growth?.sharePrompt||"");hostText(aiHostLayer,"shareUrl",host.growth?.shareUrl?host.growth.shareUrl.replace(/^https?:\\/\\//,""):"")}',
    '  if(aiHostLayer.parentNode!==root)root.appendChild(aiHostLayer);',
    '}',
    'function render(data){',
    '  if(data.eventVersion!==undefined&&data.eventVersion<currentVersion)return;',
    '  currentVersion=data.eventVersion??currentVersion;',
    '  const doc=data.overlay??data.draft?.snapshot??data.draft??null;',
    '  if(!doc)return;',
    '  currentDoc=doc;',
    '  for(const child of [...root.children]){if(child!==aiHostLayer)child.remove()}',
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
    "      textAlign:el.props.align,boxSizing:'border-box',lineHeight:'1.12',",
    '    });',
    "    if(node.tagName==='IMG') {",
    "      node.src=el.props.src||'';",
    "      node.alt='';",
    "      node.style.objectFit=el.props.objectFit||'contain';",
    "    } else if (el.type!=='shape') {",
    '      node.textContent=bind(el,data);',
    '    }',
    "    if(el.binding==='youtube.nextCountdown'&&data.youtube?.nextCountdownTarget){node.dataset.countdownTarget=data.youtube.nextCountdownTarget;node.textContent=countdownText(data.youtube.nextCountdownTarget)}",
    '    root.appendChild(node);',
    "    if(el.type==='text')fitText(node,el.name==='News Text 1'?12:18);",
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
    '  renderAiHost(data.host,doc);',
    '  playHostAudio(data.host);',
    '  updateCountdowns();',
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
    "  for(const eventName of ['overlay-published','overlay-version-changed','article-prepared','item-started','item-paused','item-resumed','item-ended','item-skipped','broadcast-stopped','live-studio-changed','ai-host-updated']){",
    "    events.addEventListener(eventName,(ev)=>{ if(ev.lastEventId) window.localStorage.setItem(\'overlay:\'+token+\':lastEventId\',ev.lastEventId); load(); });",
    '  }',
    '  events.onerror=()=>{events.close();setTimeout(connect,1500)};',
    '}',
    'load();',
    "window.addEventListener('resize',()=>{if(currentDoc)fitCanvas(currentDoc)});",
    'if(token)connect();',
    'setInterval(updateCountdowns,1000);',
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
aiTvTeam.start();

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
setTimeout(() => {
  void restoreYoutubeLiveSources().catch((error) =>
    app.log.warn({ error }, 'YouTube-Live-Quellen konnten beim Start noch nicht aktualisiert werden'),
  );
}, 2200).unref?.();
setTimeout(() => void superviseStream(), 2000).unref?.();
if (process.env.STREAM_AUTO_RESTART !== 'false') {
  setInterval(() => void superviseStream(), streamSupervisorIntervalMs).unref?.();
}
