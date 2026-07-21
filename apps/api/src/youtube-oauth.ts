import { createHash } from 'node:crypto';
import { createReadStream } from 'node:fs';
import { stat } from 'node:fs/promises';

const YOUTUBE_TOKEN_ENDPOINT = 'https://oauth2.googleapis.com/token';
const YOUTUBE_AUTH_ENDPOINT = 'https://accounts.google.com/o/oauth2/v2/auth';
const YOUTUBE_API_BASE = 'https://www.googleapis.com/youtube/v3';
const YOUTUBE_UPLOAD_BASE = 'https://www.googleapis.com/upload/youtube/v3';

export const YOUTUBE_OAUTH_SCOPES = [
  'https://www.googleapis.com/auth/youtube.readonly',
  'https://www.googleapis.com/auth/youtube.upload',
  'https://www.googleapis.com/auth/youtube.force-ssl',
] as const;

export type YoutubeOAuthChannel = {
  id: string;
  title: string;
  handle: string;
  connectedAt: string;
};

export type StoredYoutubeOAuthChannel = YoutubeOAuthChannel & { refreshToken: string };

function compact(value: unknown, maximum: number) {
  return typeof value === 'string' ? value.replace(/\s+/g, ' ').trim().slice(0, maximum) : '';
}

export function readYoutubeOAuthChannels(env: NodeJS.ProcessEnv = process.env): StoredYoutubeOAuthChannel[] {
  const encoded = clean(env.YOUTUBE_OAUTH_CHANNELS_B64);
  if (!encoded) return [];
  try {
    const parsed = JSON.parse(Buffer.from(encoded, 'base64url').toString('utf8'));
    if (!Array.isArray(parsed)) return [];
    const channels = parsed
      .map((entry): StoredYoutubeOAuthChannel | null => {
        const id = compact(entry?.id, 128);
        const refreshToken = compact(entry?.refreshToken, 2048);
        if (!id || !refreshToken) return null;
        return {
          id,
          title: compact(entry?.title, 180) || id,
          handle: compact(entry?.handle, 180),
          connectedAt: compact(entry?.connectedAt, 64) || new Date(0).toISOString(),
          refreshToken,
        };
      })
      .filter((entry): entry is StoredYoutubeOAuthChannel => Boolean(entry));
    return [...new Map(channels.map((channel) => [channel.id, channel])).values()].slice(0, 25);
  } catch {
    return [];
  }
}

export function encodeYoutubeOAuthChannels(channels: StoredYoutubeOAuthChannel[]) {
  return Buffer.from(JSON.stringify(channels.slice(0, 25)), 'utf8').toString('base64url');
}

export type YoutubeOAuthConfig = {
  clientId: string;
  clientSecret: string;
  refreshToken: string;
  redirectUri: string;
};

function clean(value: string | undefined) {
  return value?.trim() ?? '';
}

export function readYoutubeOAuthConfig(
  env: NodeJS.ProcessEnv = process.env,
  channelId?: string | null,
): YoutubeOAuthConfig {
  const channels = readYoutubeOAuthChannels(env);
  const channel = channelId ? channels.find((entry) => entry.id === channelId) : null;
  const legacyRefreshToken = clean(env.YOUTUBE_OAUTH_REFRESH_TOKEN);
  return {
    clientId: clean(env.YOUTUBE_OAUTH_CLIENT_ID),
    clientSecret: clean(env.YOUTUBE_OAUTH_CLIENT_SECRET),
    refreshToken: channelId
      ? channel?.refreshToken || (!channels.length ? legacyRefreshToken : '')
      : legacyRefreshToken || channels.at(-1)?.refreshToken || '',
    redirectUri: clean(env.YOUTUBE_OAUTH_REDIRECT_URI) || 'http://localhost:12001/api/youtube/oauth/callback',
  };
}

export function youtubeOAuthPublicStatus(env: NodeJS.ProcessEnv = process.env) {
  const config = readYoutubeOAuthConfig(env);
  const channels = readYoutubeOAuthChannels(env).map(({ id, title, handle, connectedAt }) => ({
    id,
    title,
    handle,
    connectedAt,
  }));
  return {
    clientConfigured: Boolean(config.clientId && config.clientSecret),
    connected: Boolean(config.clientId && config.clientSecret && config.refreshToken),
    clientIdHint: config.clientId ? `${config.clientId.slice(0, 8)}…${config.clientId.slice(-8)}` : '',
    redirectUri: config.redirectUri,
    scopes: [...YOUTUBE_OAUTH_SCOPES],
    channels,
  };
}

function apiError(payload: any, fallback: string) {
  const reason = payload?.error?.errors?.[0]?.reason;
  const message = payload?.error?.message || payload?.error_description || payload?.error;
  const detail = typeof message === 'string' && message.trim() ? message.trim() : fallback;
  return Object.assign(new Error(detail.slice(0, 600)), {
    reason: typeof reason === 'string' ? reason : null,
  });
}

let tokenCache: { fingerprint: string; accessToken: string; expiresAt: number } | null = null;

export async function youtubeAccessToken(
  env: NodeJS.ProcessEnv = process.env,
  fetchImpl: typeof fetch = fetch,
  channelId?: string | null,
) {
  const config = readYoutubeOAuthConfig(env, channelId);
  if (!config.clientId || !config.clientSecret || !config.refreshToken)
    throw Object.assign(
      new Error(
        channelId
          ? 'Der ausgewählte YouTube-Kanal ist nicht mehr autorisiert. Bitte den Kanal erneut verbinden.'
          : 'YouTube OAuth ist noch nicht vollständig verbunden.',
      ),
      { statusCode: 409 },
    );
  const fingerprint = createHash('sha256').update(`${config.clientId}\0${config.refreshToken}`).digest('hex');
  if (tokenCache?.fingerprint === fingerprint && tokenCache.expiresAt > Date.now() + 60_000)
    return tokenCache.accessToken;
  const response = await fetchImpl(YOUTUBE_TOKEN_ENDPOINT, {
    method: 'POST',
    headers: { 'content-type': 'application/x-www-form-urlencoded', accept: 'application/json' },
    body: new URLSearchParams({
      client_id: config.clientId,
      client_secret: config.clientSecret,
      refresh_token: config.refreshToken,
      grant_type: 'refresh_token',
    }),
    signal: AbortSignal.timeout(20_000),
  });
  const payload = (await response.json().catch(() => null)) as any;
  if (!response.ok || typeof payload?.access_token !== 'string') {
    throw Object.assign(apiError(payload, 'YouTube OAuth konnte nicht erneuert werden.'), { statusCode: 502 });
  }
  tokenCache = {
    fingerprint,
    accessToken: payload.access_token,
    expiresAt: Date.now() + Math.max(300, Number(payload.expires_in) || 3600) * 1000,
  };
  return tokenCache.accessToken;
}

export async function listOwnedYoutubeChannelsWithAccessToken(
  accessToken: string,
  fetchImpl: typeof fetch = fetch,
): Promise<Array<Omit<YoutubeOAuthChannel, 'connectedAt'>>> {
  const endpoint = new URL(`${YOUTUBE_API_BASE}/channels`);
  endpoint.searchParams.set('part', 'id,snippet');
  endpoint.searchParams.set('mine', 'true');
  endpoint.searchParams.set('maxResults', '50');
  const response = await fetchImpl(endpoint, {
    headers: { Authorization: `Bearer ${accessToken}`, accept: 'application/json' },
    signal: AbortSignal.timeout(20_000),
  });
  const payload = (await response.json().catch(() => null)) as any;
  if (!response.ok)
    throw Object.assign(apiError(payload, 'Die autorisierten YouTube-Kanäle konnten nicht geladen werden.'), {
      statusCode: 502,
    });
  return (Array.isArray(payload?.items) ? payload.items : [])
    .map((item: any) => ({
      id: compact(item?.id, 128),
      title: compact(item?.snippet?.title, 180),
      handle: compact(item?.snippet?.customUrl, 180),
    }))
    .filter((item: { id: string; title: string }) => Boolean(item.id && item.title));
}

export function youtubeAuthorizationUrl(config: YoutubeOAuthConfig, state: string) {
  if (!config.clientId || !config.clientSecret)
    throw Object.assign(new Error('YouTube OAuth Client-ID und Client-Secret fehlen.'), { statusCode: 409 });
  const url = new URL(YOUTUBE_AUTH_ENDPOINT);
  url.searchParams.set('client_id', config.clientId);
  url.searchParams.set('redirect_uri', config.redirectUri);
  url.searchParams.set('response_type', 'code');
  url.searchParams.set('scope', YOUTUBE_OAUTH_SCOPES.join(' '));
  url.searchParams.set('access_type', 'offline');
  url.searchParams.set('include_granted_scopes', 'true');
  url.searchParams.set('prompt', 'consent');
  url.searchParams.set('state', state);
  return url.toString();
}

export async function exchangeYoutubeAuthorizationCode(
  config: YoutubeOAuthConfig,
  code: string,
  fetchImpl: typeof fetch = fetch,
) {
  const response = await fetchImpl(YOUTUBE_TOKEN_ENDPOINT, {
    method: 'POST',
    headers: { 'content-type': 'application/x-www-form-urlencoded', accept: 'application/json' },
    body: new URLSearchParams({
      client_id: config.clientId,
      client_secret: config.clientSecret,
      code,
      grant_type: 'authorization_code',
      redirect_uri: config.redirectUri,
    }),
    signal: AbortSignal.timeout(25_000),
  });
  const payload = (await response.json().catch(() => null)) as any;
  if (!response.ok || typeof payload?.access_token !== 'string')
    throw Object.assign(apiError(payload, 'YouTube OAuth-Anmeldung ist fehlgeschlagen.'), { statusCode: 502 });
  tokenCache = null;
  return {
    accessToken: payload.access_token as string,
    refreshToken: typeof payload.refresh_token === 'string' ? payload.refresh_token : '',
    expiresIn: Number(payload.expires_in) || 3600,
    scope: typeof payload.scope === 'string' ? payload.scope : '',
  };
}

export async function discoverOwnActiveYoutubeLiveChat(
  env: NodeJS.ProcessEnv = process.env,
  fetchImpl: typeof fetch = fetch,
) {
  const accessToken = await youtubeAccessToken(env, fetchImpl);
  const endpoint = new URL(`${YOUTUBE_API_BASE}/liveBroadcasts`);
  endpoint.searchParams.set('part', 'id,snippet,status');
  endpoint.searchParams.set('broadcastStatus', 'active');
  endpoint.searchParams.set('mine', 'true');
  endpoint.searchParams.set('maxResults', '10');
  const response = await fetchImpl(endpoint, {
    headers: { Authorization: `Bearer ${accessToken}`, accept: 'application/json' },
    signal: AbortSignal.timeout(20_000),
  });
  const payload = (await response.json().catch(() => null)) as any;
  if (!response.ok)
    throw Object.assign(apiError(payload, 'Der aktive YouTube-Senderchat konnte nicht ermittelt werden.'), {
      statusCode: 502,
    });
  const items = Array.isArray(payload?.items) ? payload.items : [];
  const item = items.find((candidate: any) => typeof candidate?.snippet?.liveChatId === 'string');
  if (!item) return null;
  return {
    broadcastId: String(item.id),
    liveChatId: String(item.snippet.liveChatId),
    title: String(item.snippet.title ?? 'Eigener YouTube-Livestream'),
  };
}

export type YoutubeUploadMetadata = {
  title: string;
  description: string;
  tags: string[];
  privacyStatus: 'private' | 'unlisted' | 'public';
  containsSyntheticMedia?: boolean;
};

type YoutubeManagedVideo = {
  id: string;
  channelId: string;
  categoryId: string;
  title: string;
  description: string;
  tags: string[];
  privacyStatus: YoutubeUploadMetadata['privacyStatus'];
  rawSnippet: Record<string, unknown>;
  rawStatus: Record<string, unknown>;
};

export type YoutubeVideoState = {
  id: string;
  channelId: string;
  title: string;
  privacyStatus: YoutubeUploadMetadata['privacyStatus'];
};

export async function listYoutubeVideoStates(
  videoIds: string[],
  options: { env?: NodeJS.ProcessEnv; fetchImpl?: typeof fetch; channelId?: string | null } = {},
): Promise<YoutubeVideoState[]> {
  const ids = [...new Set(videoIds.map((id) => compact(id, 128)).filter(Boolean))].slice(0, 50);
  if (!ids.length) return [];
  const env = options.env ?? process.env;
  const fetchImpl = options.fetchImpl ?? fetch;
  const accessToken = await youtubeAccessToken(env, fetchImpl, options.channelId);
  const endpoint = new URL(`${YOUTUBE_API_BASE}/videos`);
  endpoint.searchParams.set('part', 'id,snippet,status');
  endpoint.searchParams.set('id', ids.join(','));
  const response = await fetchImpl(endpoint, {
    headers: { Authorization: `Bearer ${accessToken}`, accept: 'application/json' },
    signal: AbortSignal.timeout(20_000),
  });
  const payload = (await response.json().catch(() => null)) as any;
  if (!response.ok)
    throw Object.assign(apiError(payload, 'Die veröffentlichten YouTube-Shorts konnten nicht abgeglichen werden.'), {
      statusCode: 502,
    });
  return (Array.isArray(payload?.items) ? payload.items : [])
    .map((item: any) => ({
      id: compact(item?.id, 128),
      channelId: compact(item?.snippet?.channelId, 128),
      title: compact(item?.snippet?.title, 100),
      privacyStatus: ['private', 'unlisted', 'public'].includes(item?.status?.privacyStatus)
        ? item.status.privacyStatus
        : 'private',
    }))
    .filter(
      (item: YoutubeVideoState) => Boolean(item.id) && (!options.channelId || item.channelId === options.channelId),
    );
}

async function ownedYoutubeVideo(
  videoId: string,
  accessToken: string,
  channelId: string | null | undefined,
  fetchImpl: typeof fetch,
): Promise<YoutubeManagedVideo> {
  const endpoint = new URL(`${YOUTUBE_API_BASE}/videos`);
  endpoint.searchParams.set('part', 'snippet,status');
  endpoint.searchParams.set('id', videoId);
  const response = await fetchImpl(endpoint, {
    headers: { Authorization: `Bearer ${accessToken}`, accept: 'application/json' },
    signal: AbortSignal.timeout(20_000),
  });
  const payload = (await response.json().catch(() => null)) as any;
  if (!response.ok)
    throw Object.assign(apiError(payload, 'Das veröffentlichte YouTube-Video konnte nicht geladen werden.'), {
      statusCode: 502,
    });
  const item = Array.isArray(payload?.items) ? payload.items[0] : null;
  if (!item)
    throw Object.assign(new Error('Das veröffentlichte YouTube-Video existiert nicht mehr.'), { statusCode: 404 });
  const ownerChannelId = compact(item?.snippet?.channelId, 128);
  if (channelId && ownerChannelId !== channelId)
    throw Object.assign(new Error('Das YouTube-Video gehört nicht zum ausgewählten Zielkanal.'), { statusCode: 409 });
  return {
    id: compact(item.id, 128),
    channelId: ownerChannelId,
    categoryId: compact(item?.snippet?.categoryId, 32) || '25',
    title: compact(item?.snippet?.title, 100),
    description: typeof item?.snippet?.description === 'string' ? item.snippet.description.slice(0, 5000) : '',
    tags: Array.isArray(item?.snippet?.tags)
      ? item.snippet.tags
          .map((tag: unknown) => compact(tag, 60))
          .filter(Boolean)
          .slice(0, 30)
      : [],
    privacyStatus: ['private', 'unlisted', 'public'].includes(item?.status?.privacyStatus)
      ? item.status.privacyStatus
      : 'private',
    rawSnippet: item?.snippet && typeof item.snippet === 'object' ? item.snippet : {},
    rawStatus: item?.status && typeof item.status === 'object' ? item.status : {},
  };
}

function youtubeManagementError(payload: unknown, fallback: string, status: number) {
  const error = apiError(payload, fallback);
  if (status === 403)
    return Object.assign(
      new Error(
        'Die YouTube-Verwaltungsfreigabe fehlt oder ist veraltet. Verbinde diesen Kanal erneut und bestätige die Berechtigung zum Bearbeiten und Löschen.',
      ),
      { statusCode: 409, reason: error.reason },
    );
  return Object.assign(error, { statusCode: 502 });
}

export async function updateYoutubeVideoMetadata(
  videoId: string,
  metadata: YoutubeUploadMetadata,
  options: { env?: NodeJS.ProcessEnv; fetchImpl?: typeof fetch; channelId?: string | null } = {},
) {
  const env = options.env ?? process.env;
  const fetchImpl = options.fetchImpl ?? fetch;
  const accessToken = await youtubeAccessToken(env, fetchImpl, options.channelId);
  const current = await ownedYoutubeVideo(videoId, accessToken, options.channelId, fetchImpl);
  const endpoint = new URL(`${YOUTUBE_API_BASE}/videos`);
  endpoint.searchParams.set('part', 'snippet,status');
  const snippet: Record<string, unknown> = {
    title: metadata.title.slice(0, 100),
    description: metadata.description.slice(0, 5000),
    tags: metadata.tags
      .map((tag) => tag.trim())
      .filter(Boolean)
      .slice(0, 30),
    categoryId: current.categoryId,
  };
  if (typeof current.rawSnippet.defaultLanguage === 'string')
    snippet.defaultLanguage = current.rawSnippet.defaultLanguage;
  const status: Record<string, unknown> = {
    privacyStatus: metadata.privacyStatus,
    selfDeclaredMadeForKids: current.rawStatus.selfDeclaredMadeForKids === true,
    containsSyntheticMedia: metadata.containsSyntheticMedia !== false,
  };
  for (const key of ['embeddable', 'license', 'publicStatsViewable'] as const) {
    if (current.rawStatus[key] !== undefined) status[key] = current.rawStatus[key];
  }
  const response = await fetchImpl(endpoint, {
    method: 'PUT',
    headers: {
      Authorization: `Bearer ${accessToken}`,
      'content-type': 'application/json; charset=UTF-8',
      accept: 'application/json',
    },
    body: JSON.stringify({ id: current.id, snippet, status }),
    signal: AbortSignal.timeout(30_000),
  });
  const payload = (await response.json().catch(() => null)) as any;
  if (!response.ok)
    throw youtubeManagementError(payload, 'YouTube hat die Änderungen am Short nicht angenommen.', response.status);
  return {
    id: current.id,
    url: `https://www.youtube.com/watch?v=${encodeURIComponent(current.id)}`,
    title: compact(payload?.snippet?.title, 100) || metadata.title.slice(0, 100),
    privacyStatus: payload?.status?.privacyStatus || metadata.privacyStatus,
  };
}

export async function deleteYoutubeVideo(
  videoId: string,
  options: { env?: NodeJS.ProcessEnv; fetchImpl?: typeof fetch; channelId?: string | null } = {},
) {
  const env = options.env ?? process.env;
  const fetchImpl = options.fetchImpl ?? fetch;
  const accessToken = await youtubeAccessToken(env, fetchImpl, options.channelId);
  const current = await ownedYoutubeVideo(videoId, accessToken, options.channelId, fetchImpl);
  const endpoint = new URL(`${YOUTUBE_API_BASE}/videos`);
  endpoint.searchParams.set('id', current.id);
  const response = await fetchImpl(endpoint, {
    method: 'DELETE',
    headers: { Authorization: `Bearer ${accessToken}`, accept: 'application/json' },
    signal: AbortSignal.timeout(30_000),
  });
  if (!response.ok) {
    const payload = await response.json().catch(() => null);
    throw youtubeManagementError(payload, 'YouTube hat das Löschen des Shorts nicht angenommen.', response.status);
  }
  return { id: current.id, deleted: true as const };
}

async function uploadChunk(uploadUrl: string, filePath: string, size: number, start: number, fetchImpl: typeof fetch) {
  const response = await fetchImpl(uploadUrl, {
    method: 'PUT',
    headers: {
      'content-type': 'video/mp4',
      'content-length': String(size - start),
      'content-range': `bytes ${start}-${size - 1}/${size}`,
    },
    body: createReadStream(filePath, { start }) as any,
    duplex: 'half',
    signal: AbortSignal.timeout(30 * 60_000),
  } as RequestInit & { duplex: 'half' });
  return response;
}

async function resumableUploadState(
  uploadUrl: string,
  size: number,
  fetchImpl: typeof fetch,
): Promise<{ complete: true; id: string } | { complete: false; nextByte: number }> {
  const response = await fetchImpl(uploadUrl, {
    method: 'PUT',
    headers: {
      'content-length': '0',
      'content-range': `bytes */${size}`,
    },
    signal: AbortSignal.timeout(30_000),
  });
  if (response.ok) {
    const payload = (await response.json().catch(() => null)) as any;
    if (!payload?.id) throw new Error('YouTube meldet einen abgeschlossenen Upload ohne Video-ID.');
    return { complete: true, id: String(payload.id) };
  }
  if (response.status === 308) {
    const range = response.headers.get('range')?.match(/bytes=0-(\d+)/i);
    return { complete: false, nextByte: range ? Number(range[1]) + 1 : 0 };
  }
  const payload = await response.json().catch(() => null);
  throw apiError(payload, 'Der Stand des fortsetzbaren YouTube-Uploads konnte nicht ermittelt werden.');
}

export async function uploadYoutubeVideoResumable(
  filePath: string,
  metadata: YoutubeUploadMetadata,
  options: { env?: NodeJS.ProcessEnv; fetchImpl?: typeof fetch; channelId?: string | null } = {},
) {
  const env = options.env ?? process.env;
  const fetchImpl = options.fetchImpl ?? fetch;
  const accessToken = await youtubeAccessToken(env, fetchImpl, options.channelId);
  if (options.channelId) {
    const channels = await listOwnedYoutubeChannelsWithAccessToken(accessToken, fetchImpl);
    if (!channels.some((channel) => channel.id === options.channelId)) {
      throw Object.assign(new Error('Google hat den ausgewählten YouTube-Kanal für diesen Zugang nicht bestätigt.'), {
        statusCode: 409,
      });
    }
  }
  const file = await stat(filePath);
  if (!file.isFile() || file.size <= 0) throw new Error('Die fertige Short-Datei ist leer oder nicht lesbar.');
  const endpoint = new URL(`${YOUTUBE_UPLOAD_BASE}/videos`);
  endpoint.searchParams.set('uploadType', 'resumable');
  endpoint.searchParams.set('part', 'snippet,status');
  endpoint.searchParams.set('notifySubscribers', 'false');
  const initiation = await fetchImpl(endpoint, {
    method: 'POST',
    headers: {
      Authorization: `Bearer ${accessToken}`,
      'content-type': 'application/json; charset=UTF-8',
      'x-upload-content-length': String(file.size),
      'x-upload-content-type': 'video/mp4',
      accept: 'application/json',
    },
    body: JSON.stringify({
      snippet: {
        title: metadata.title.slice(0, 100),
        description: metadata.description.slice(0, 5000),
        tags: metadata.tags
          .map((tag) => tag.trim())
          .filter(Boolean)
          .slice(0, 30),
        categoryId: '25',
      },
      status: {
        privacyStatus: metadata.privacyStatus,
        selfDeclaredMadeForKids: false,
        containsSyntheticMedia: metadata.containsSyntheticMedia !== false,
      },
    }),
    signal: AbortSignal.timeout(30_000),
  });
  const failurePayload = initiation.ok ? null : await initiation.json().catch(() => null);
  if (!initiation.ok)
    throw Object.assign(apiError(failurePayload, 'YouTube hat den Upload nicht angenommen.'), { statusCode: 502 });
  const uploadUrl = initiation.headers.get('location');
  if (!uploadUrl) throw new Error('YouTube hat keine URL für den fortsetzbaren Upload geliefert.');

  let start = 0;
  for (let attempt = 0; attempt < 4; attempt += 1) {
    let response: Response;
    try {
      response = await uploadChunk(uploadUrl, filePath, file.size, start, fetchImpl);
    } catch (error) {
      if (attempt === 3) throw error;
      await new Promise((resolvePromise) => setTimeout(resolvePromise, 750 * 2 ** attempt));
      const state = await resumableUploadState(uploadUrl, file.size, fetchImpl);
      if (state.complete)
        return { id: state.id, url: `https://www.youtube.com/watch?v=${encodeURIComponent(state.id)}` };
      start = state.nextByte;
      continue;
    }
    if (response.ok) {
      const payload = (await response.json().catch(() => null)) as any;
      if (!payload?.id) throw new Error('YouTube hat den Upload bestätigt, aber keine Video-ID geliefert.');
      return { id: String(payload.id), url: `https://www.youtube.com/watch?v=${encodeURIComponent(payload.id)}` };
    }
    if (response.status === 308) {
      const range = response.headers.get('range')?.match(/bytes=0-(\d+)/i);
      start = range ? Number(range[1]) + 1 : start;
      continue;
    }
    const payload = await response.json().catch(() => null);
    const retryable = response.status >= 500 || response.status === 429;
    if (!retryable || attempt === 3)
      throw Object.assign(apiError(payload, 'Der YouTube-Upload ist fehlgeschlagen.'), {
        statusCode: response.status === 429 ? 429 : 502,
      });
    await new Promise((resolvePromise) => setTimeout(resolvePromise, 750 * 2 ** attempt));
    const state = await resumableUploadState(uploadUrl, file.size, fetchImpl);
    if (state.complete) return { id: state.id, url: `https://www.youtube.com/watch?v=${encodeURIComponent(state.id)}` };
    start = state.nextByte;
  }
  throw new Error('Der YouTube-Upload konnte nicht abgeschlossen werden.');
}
