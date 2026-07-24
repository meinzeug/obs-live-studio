import {
  resolveAdditionalStreamTargets,
  resolvePrimaryStreamTarget,
} from '../../../packages/streaming-platforms/index.mjs';
import { youtubeAccessToken } from './youtube-oauth.js';

const YOUTUBE_API_BASE = 'https://www.googleapis.com/youtube/v3';
const DEFAULT_INPUT_ATTEMPTS = 15;
const DEFAULT_TRANSITION_ATTEMPTS = 20;

type YoutubeApiError = Error & { statusCode?: number; reason?: string | null };

type YoutubeLiveStream = {
  id: string;
  snippet?: { title?: string };
  cdn?: { ingestionInfo?: { streamName?: string } };
  status?: { streamStatus?: string; healthStatus?: { status?: string } };
};

type YoutubeLiveBroadcast = {
  id: string;
  snippet?: {
    title?: string;
    description?: string;
    scheduledStartTime?: string;
    actualStartTime?: string;
  };
  status?: {
    lifeCycleStatus?: string;
    privacyStatus?: 'private' | 'unlisted' | 'public';
  };
  contentDetails?: {
    boundStreamId?: string;
    monitorStream?: { enableMonitorStream?: boolean; broadcastStreamDelayMs?: number };
  };
};

export type YoutubeLiveOutputRuntime = {
  enabled: boolean;
  state: 'disabled' | 'idle' | 'waiting-input' | 'starting' | 'live' | 'error';
  broadcastId: string | null;
  watchUrl: string | null;
  streamStatus: string | null;
  streamHealth: string | null;
  checkedAt: string | null;
  error: string | null;
};

type EnsureOptions = {
  accessToken?: string;
  inputAttempts?: number;
  transitionAttempts?: number;
  pollIntervalMs?: number;
  now?: () => Date;
  sleep?: (milliseconds: number) => Promise<void>;
};

let runtime: YoutubeLiveOutputRuntime = {
  enabled: false,
  state: 'disabled',
  broadcastId: null,
  watchUrl: null,
  streamStatus: null,
  streamHealth: null,
  checkedAt: null,
  error: null,
};
let ensureInFlight: Promise<YoutubeLiveOutputRuntime> | null = null;
let lastEnsureStartedAt = 0;

function compact(value: unknown, maximum = 500) {
  return typeof value === 'string' ? value.replace(/\s+/g, ' ').trim().slice(0, maximum) : '';
}

function youtubeApiError(payload: any, response: Response, fallback: string): YoutubeApiError {
  const message = compact(payload?.error?.message, 600) || fallback;
  return Object.assign(new Error(message), {
    statusCode: response.status >= 500 ? 502 : response.status,
    reason: compact(payload?.error?.errors?.[0]?.reason, 100) || null,
  });
}

async function youtubeApi<T>(
  accessToken: string,
  path: string,
  params: Record<string, string>,
  fetchImpl: typeof fetch,
  init: RequestInit = {},
) {
  const endpoint = new URL(`${YOUTUBE_API_BASE}/${path}`);
  for (const [key, value] of Object.entries(params)) endpoint.searchParams.set(key, value);
  const response = await fetchImpl(endpoint, {
    ...init,
    headers: {
      Authorization: `Bearer ${accessToken}`,
      accept: 'application/json',
      ...(init.body ? { 'content-type': 'application/json; charset=UTF-8' } : {}),
      ...init.headers,
    },
    signal: init.signal ?? AbortSignal.timeout(25_000),
  });
  const payload = (await response.json().catch(() => null)) as T | null;
  if (!response.ok || !payload)
    throw youtubeApiError(payload, response, 'YouTube Live konnte nicht gesteuert werden.');
  return payload;
}

async function listOwnedStreams(accessToken: string, fetchImpl: typeof fetch) {
  const payload = await youtubeApi<{ items?: YoutubeLiveStream[] }>(
    accessToken,
    'liveStreams',
    { part: 'id,snippet,cdn,status', mine: 'true', maxResults: '50' },
    fetchImpl,
  );
  return Array.isArray(payload.items) ? payload.items : [];
}

async function listOwnedBroadcasts(accessToken: string, fetchImpl: typeof fetch) {
  // `mine` and `broadcastStatus` are mutually exclusive YouTube API filters.
  const payload = await youtubeApi<{ items?: YoutubeLiveBroadcast[] }>(
    accessToken,
    'liveBroadcasts',
    { part: 'id,snippet,status,contentDetails', mine: 'true', maxResults: '50' },
    fetchImpl,
  );
  return Array.isArray(payload.items) ? payload.items : [];
}

async function getBroadcast(accessToken: string, broadcastId: string, fetchImpl: typeof fetch) {
  const payload = await youtubeApi<{ items?: YoutubeLiveBroadcast[] }>(
    accessToken,
    'liveBroadcasts',
    { part: 'id,snippet,status,contentDetails', id: broadcastId },
    fetchImpl,
  );
  return Array.isArray(payload.items) ? payload.items[0] ?? null : null;
}

async function transitionBroadcast(
  accessToken: string,
  broadcastId: string,
  broadcastStatus: 'testing' | 'live',
  fetchImpl: typeof fetch,
) {
  return youtubeApi<YoutubeLiveBroadcast>(
    accessToken,
    'liveBroadcasts/transition',
    { part: 'id,snippet,status,contentDetails', id: broadcastId, broadcastStatus },
    fetchImpl,
    { method: 'POST' },
  );
}

function actualSchedule(value: string | undefined) {
  if (!value) return false;
  const timestamp = Date.parse(value);
  return Number.isFinite(timestamp) && timestamp > Date.UTC(2000, 0, 1);
}

function privacyStatus(value: unknown): 'private' | 'unlisted' | 'public' {
  return value === 'private' || value === 'unlisted' ? value : 'public';
}

async function createManagedBroadcast(
  accessToken: string,
  stream: YoutubeLiveStream,
  template: YoutubeLiveBroadcast | undefined,
  env: NodeJS.ProcessEnv,
  fetchImpl: typeof fetch,
  now: () => Date,
) {
  const channelName = compact(env.CHANNEL_NAME, 80) || 'Open TV Studio';
  const title =
    compact(env.YOUTUBE_LIVE_TITLE, 100) || compact(template?.snippet?.title, 100) || `${channelName} LIVE`;
  const description =
    compact(env.YOUTUBE_LIVE_DESCRIPTION, 5000) ||
    compact(template?.snippet?.description, 5000) ||
    `Liveprogramm von ${channelName}`;
  const created = await youtubeApi<YoutubeLiveBroadcast>(
    accessToken,
    'liveBroadcasts',
    { part: 'id,snippet,status,contentDetails' },
    fetchImpl,
    {
      method: 'POST',
      body: JSON.stringify({
        snippet: {
          title,
          description,
          scheduledStartTime: new Date(now().getTime() + 60_000).toISOString(),
        },
        status: {
          privacyStatus: privacyStatus(env.YOUTUBE_LIVE_PRIVACY_STATUS || template?.status?.privacyStatus),
          selfDeclaredMadeForKids: false,
        },
        contentDetails: {
          monitorStream: { enableMonitorStream: false, broadcastStreamDelayMs: 0 },
          enableAutoStart: false,
          enableAutoStop: true,
          enableDvr: true,
          recordFromStart: true,
          // Some channels reject embedding. Playback on youtube.com remains public.
          enableEmbed: false,
          latencyPreference: 'low',
        },
      }),
    },
  );
  await youtubeApi<YoutubeLiveBroadcast>(
    accessToken,
    'liveBroadcasts/bind',
    { part: 'id,snippet,status,contentDetails', id: created.id, streamId: stream.id },
    fetchImpl,
    { method: 'POST' },
  );
  return created;
}

async function deleteBroadcast(accessToken: string, broadcastId: string, fetchImpl: typeof fetch) {
  const endpoint = new URL(`${YOUTUBE_API_BASE}/liveBroadcasts`);
  endpoint.searchParams.set('id', broadcastId);
  await fetchImpl(endpoint, {
    method: 'DELETE',
    headers: { Authorization: `Bearer ${accessToken}`, accept: 'application/json' },
    signal: AbortSignal.timeout(20_000),
  }).catch(() => undefined);
}

function setRuntime(next: Partial<YoutubeLiveOutputRuntime>, now = new Date()) {
  runtime = {
    ...runtime,
    ...next,
    checkedAt: now.toISOString(),
  };
  return { ...runtime };
}

export function youtubeLiveOutputRuntime() {
  return { ...runtime };
}

export async function ensureYoutubeBroadcastLive(
  env: NodeJS.ProcessEnv = process.env,
  fetchImpl: typeof fetch = fetch,
  options: EnsureOptions = {},
): Promise<YoutubeLiveOutputRuntime> {
  const now = options.now ?? (() => new Date());
  const sleep = options.sleep ?? ((milliseconds: number) => new Promise((resolve) => setTimeout(resolve, milliseconds)));
  const pollIntervalMs = Math.max(0, options.pollIntervalMs ?? 2_000);
  const inputAttempts = Math.max(1, options.inputAttempts ?? DEFAULT_INPUT_ATTEMPTS);
  const transitionAttempts = Math.max(1, options.transitionAttempts ?? DEFAULT_TRANSITION_ATTEMPTS);
  const primaryTarget = resolvePrimaryStreamTarget(env);
  const target =
    (primaryTarget.enabled && primaryTarget.platform === 'youtube' ? primaryTarget : null) ??
    resolveAdditionalStreamTargets(env, { includeDisabled: true }).find(
      (candidate) => candidate.enabled && candidate.platform === 'youtube',
    );
  if (!target || env.YOUTUBE_LIVE_AUTO_PUBLISH === 'false') {
    return setRuntime(
      {
        enabled: false,
        state: 'disabled',
        broadcastId: null,
        watchUrl: null,
        streamStatus: null,
        streamHealth: null,
        error: null,
      },
      now(),
    );
  }

  setRuntime({ enabled: true, state: 'waiting-input', error: null }, now());
  let createdBroadcastId: string | null = null;
  try {
    const accessToken = options.accessToken ?? (await youtubeAccessToken(env, fetchImpl));
    let stream: YoutubeLiveStream | undefined;
    for (let attempt = 0; attempt < inputAttempts; attempt += 1) {
      const streams = await listOwnedStreams(accessToken, fetchImpl);
      stream = streams.find((candidate) => candidate.cdn?.ingestionInfo?.streamName === target.key);
      setRuntime(
        {
          streamStatus: compact(stream?.status?.streamStatus, 50) || null,
          streamHealth: compact(stream?.status?.healthStatus?.status, 50) || null,
        },
        now(),
      );
      if (stream?.status?.streamStatus === 'active') break;
      if (attempt + 1 < inputAttempts) await sleep(pollIntervalMs);
    }
    if (!stream)
      throw Object.assign(new Error('Der konfigurierte YouTube-Streamschlüssel gehört zu keinem autorisierten Eingang.'), {
        statusCode: 409,
      });
    if (stream.status?.streamStatus !== 'active')
      throw Object.assign(new Error('OBS sendet noch keine aktiven Bilddaten an den YouTube-Eingang.'), {
        statusCode: 503,
      });

    const broadcasts = await listOwnedBroadcasts(accessToken, fetchImpl);
    const bound = broadcasts.filter((candidate) => candidate.contentDetails?.boundStreamId === stream!.id);
    const alreadyLive = bound.find((candidate) =>
      ['live', 'liveStarting'].includes(candidate.status?.lifeCycleStatus ?? ''),
    );
    if (alreadyLive) {
      return setRuntime(
        {
          enabled: true,
          state: alreadyLive.status?.lifeCycleStatus === 'live' ? 'live' : 'starting',
          broadcastId: alreadyLive.id,
          watchUrl: `https://www.youtube.com/watch?v=${encodeURIComponent(alreadyLive.id)}`,
          streamStatus: 'active',
          streamHealth: compact(stream.status?.healthStatus?.status, 50) || null,
          error: null,
        },
        now(),
      );
    }

    // Creator Studio can create unscheduled "stream now" broadcasts. The API reports
    // them as ready, but rejects explicit transitions. Replace only that unusable state
    // with a managed, scheduled broadcast; do not delete the user's Studio entry.
    let broadcast = bound.find(
      (candidate) =>
        candidate.status?.lifeCycleStatus === 'ready' && actualSchedule(candidate.snippet?.scheduledStartTime),
    );
    const template = bound.find((candidate) => candidate.status?.lifeCycleStatus === 'ready') ?? broadcasts[0];
    if (!broadcast) {
      broadcast = await createManagedBroadcast(accessToken, stream, template, env, fetchImpl, now);
      createdBroadcastId = broadcast.id;
      for (let attempt = 0; attempt < transitionAttempts; attempt += 1) {
        const current = await getBroadcast(accessToken, broadcast.id, fetchImpl);
        if (current?.status?.lifeCycleStatus === 'ready') {
          broadcast = current;
          break;
        }
        if (attempt + 1 < transitionAttempts) await sleep(pollIntervalMs);
      }
    }
    if (broadcast.status?.lifeCycleStatus !== 'ready') {
      const current = await getBroadcast(accessToken, broadcast.id, fetchImpl);
      if (!current || current.status?.lifeCycleStatus !== 'ready')
        throw Object.assign(new Error('Der vorbereitete YouTube-Broadcast wurde nicht sendebereit.'), {
          statusCode: 502,
        });
      broadcast = current;
    }

    setRuntime(
      {
        state: 'starting',
        broadcastId: broadcast.id,
        watchUrl: `https://www.youtube.com/watch?v=${encodeURIComponent(broadcast.id)}`,
      },
      now(),
    );
    if (broadcast.contentDetails?.monitorStream?.enableMonitorStream) {
      await transitionBroadcast(accessToken, broadcast.id, 'testing', fetchImpl);
      for (let attempt = 0; attempt < transitionAttempts; attempt += 1) {
        const current = await getBroadcast(accessToken, broadcast.id, fetchImpl);
        if (current?.status?.lifeCycleStatus === 'testing') break;
        if (attempt + 1 < transitionAttempts) await sleep(pollIntervalMs);
      }
    }
    await transitionBroadcast(accessToken, broadcast.id, 'live', fetchImpl);
    for (let attempt = 0; attempt < transitionAttempts; attempt += 1) {
      const current = await getBroadcast(accessToken, broadcast.id, fetchImpl);
      const state = current?.status?.lifeCycleStatus;
      if (state === 'live') {
        createdBroadcastId = null;
        return setRuntime(
          {
            enabled: true,
            state: 'live',
            broadcastId: broadcast.id,
            watchUrl: `https://www.youtube.com/watch?v=${encodeURIComponent(broadcast.id)}`,
            streamStatus: 'active',
            streamHealth: compact(stream.status?.healthStatus?.status, 50) || null,
            error: null,
          },
          now(),
        );
      }
      if (state === 'complete' || state === 'revoked')
        throw Object.assign(new Error(`YouTube hat den Broadcast unerwartet auf ${state} gesetzt.`), {
          statusCode: 502,
        });
      if (attempt + 1 < transitionAttempts) await sleep(pollIntervalMs);
    }
    throw Object.assign(new Error('YouTube blieb länger als erwartet im Startzustand.'), { statusCode: 504 });
  } catch (error) {
    if (createdBroadcastId) {
      const accessToken = options.accessToken ?? (await youtubeAccessToken(env, fetchImpl).catch(() => null));
      if (accessToken) await deleteBroadcast(accessToken, createdBroadcastId, fetchImpl);
    }
    const message = compact(error instanceof Error ? error.message : String(error), 600) || 'YouTube Live ist fehlgeschlagen.';
    setRuntime({ enabled: true, state: 'error', error: message }, now());
    throw error;
  }
}

export function superviseYoutubeBroadcastLive(
  env: NodeJS.ProcessEnv = process.env,
  fetchImpl: typeof fetch = fetch,
  options: EnsureOptions & { force?: boolean; cooldownMs?: number } = {},
) {
  if (ensureInFlight) return ensureInFlight;
  const cooldownMs = Math.max(0, options.cooldownMs ?? (runtime.state === 'live' ? 300_000 : 30_000));
  if (!options.force && Date.now() - lastEnsureStartedAt < cooldownMs) return Promise.resolve(youtubeLiveOutputRuntime());
  lastEnsureStartedAt = Date.now();
  ensureInFlight = ensureYoutubeBroadcastLive(env, fetchImpl, options).finally(() => {
    ensureInFlight = null;
  });
  return ensureInFlight;
}
