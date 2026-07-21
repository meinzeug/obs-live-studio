import { createReadStream } from 'node:fs';
import { stat } from 'node:fs/promises';

const TIKTOK_AUTH_ENDPOINT = 'https://www.tiktok.com/v2/auth/authorize/';
const TIKTOK_TOKEN_ENDPOINT = 'https://open.tiktokapis.com/v2/oauth/token/';
const TIKTOK_REVOKE_ENDPOINT = 'https://open.tiktokapis.com/v2/oauth/revoke/';
const TIKTOK_API_BASE = 'https://open.tiktokapis.com/v2';

export const TIKTOK_OAUTH_SCOPES = ['user.info.basic', 'video.publish'] as const;

export type TikTokOAuthConfig = {
  clientKey: string;
  clientSecret: string;
  redirectUri: string;
};

export type TikTokToken = {
  accessToken: string;
  expiresIn: number;
  openId: string;
  refreshExpiresIn: number;
  refreshToken: string;
  scope: string;
};

export type TikTokCreatorInfo = {
  avatarUrl: string;
  username: string;
  nickname: string;
  privacyLevelOptions: string[];
  commentDisabled: boolean;
  duetDisabled: boolean;
  stitchDisabled: boolean;
  maxVideoPostDurationSec: number;
};

export type TikTokDirectPostInput = {
  title: string;
  privacyLevel: string;
  disableComment: boolean;
  disableDuet: boolean;
  disableStitch: boolean;
  brandContentToggle: boolean;
  brandOrganicToggle: boolean;
  isAigc: boolean;
  coverTimestampMs?: number;
};

function clean(value: unknown, maximum = 2_200) {
  return typeof value === 'string' ? value.replace(/\s+/g, ' ').trim().slice(0, maximum) : '';
}

function apiError(payload: any, fallback: string, statusCode = 502) {
  const code = clean(payload?.error?.code, 120);
  const message = clean(payload?.error?.message || payload?.message || payload?.error_description, 700);
  return Object.assign(new Error(message || fallback), {
    statusCode,
    code: code || null,
    logId: clean(payload?.error?.log_id, 180) || null,
  });
}

function ensureTikTokPayload(response: Response, payload: any, fallback: string) {
  const apiCode = clean(payload?.error?.code, 120);
  if (!response.ok || (apiCode && apiCode !== 'ok')) {
    throw apiError(payload, fallback, response.status === 429 ? 429 : 502);
  }
  return payload;
}

export function tikTokAuthorizationUrl(config: TikTokOAuthConfig, state: string) {
  if (!config.clientKey || !config.clientSecret)
    throw Object.assign(new Error('TikTok Client-Key und Client-Secret fehlen.'), { statusCode: 409 });
  const url = new URL(TIKTOK_AUTH_ENDPOINT);
  url.searchParams.set('client_key', config.clientKey);
  url.searchParams.set('scope', TIKTOK_OAUTH_SCOPES.join(','));
  url.searchParams.set('response_type', 'code');
  url.searchParams.set('redirect_uri', config.redirectUri);
  url.searchParams.set('state', state);
  return url.toString();
}

function tokenPayload(payload: any, fallbackRefreshToken = ''): TikTokToken {
  if (typeof payload?.access_token !== 'string') throw apiError(payload, 'TikTok hat kein Zugriffstoken geliefert.');
  return {
    accessToken: payload.access_token,
    expiresIn: Math.max(300, Number(payload.expires_in) || 86_400),
    openId: clean(payload.open_id, 256),
    refreshExpiresIn: Math.max(300, Number(payload.refresh_expires_in) || 31_536_000),
    refreshToken: clean(payload.refresh_token, 2_048) || fallbackRefreshToken,
    scope: clean(payload.scope, 1_000),
  };
}

export async function exchangeTikTokAuthorizationCode(
  config: TikTokOAuthConfig,
  code: string,
  fetchImpl: typeof fetch = fetch,
) {
  const response = await fetchImpl(TIKTOK_TOKEN_ENDPOINT, {
    method: 'POST',
    headers: { 'content-type': 'application/x-www-form-urlencoded', accept: 'application/json' },
    body: new URLSearchParams({
      client_key: config.clientKey,
      client_secret: config.clientSecret,
      code,
      grant_type: 'authorization_code',
      redirect_uri: config.redirectUri,
    }),
    signal: AbortSignal.timeout(25_000),
  });
  const payload = await response.json().catch(() => null);
  if (!response.ok) throw apiError(payload, 'Die TikTok-Anmeldung ist fehlgeschlagen.', 502);
  return tokenPayload(payload);
}

export async function refreshTikTokAccessToken(
  config: TikTokOAuthConfig,
  refreshToken: string,
  fetchImpl: typeof fetch = fetch,
) {
  const response = await fetchImpl(TIKTOK_TOKEN_ENDPOINT, {
    method: 'POST',
    headers: { 'content-type': 'application/x-www-form-urlencoded', accept: 'application/json' },
    body: new URLSearchParams({
      client_key: config.clientKey,
      client_secret: config.clientSecret,
      grant_type: 'refresh_token',
      refresh_token: refreshToken,
    }),
    signal: AbortSignal.timeout(25_000),
  });
  const payload = await response.json().catch(() => null);
  if (!response.ok) throw apiError(payload, 'TikTok OAuth konnte nicht erneuert werden.', 502);
  return tokenPayload(payload, refreshToken);
}

export async function revokeTikTokToken(
  config: TikTokOAuthConfig,
  accessToken: string,
  fetchImpl: typeof fetch = fetch,
) {
  if (!accessToken) return;
  const response = await fetchImpl(TIKTOK_REVOKE_ENDPOINT, {
    method: 'POST',
    headers: { 'content-type': 'application/x-www-form-urlencoded', accept: 'application/json' },
    body: new URLSearchParams({ client_key: config.clientKey, client_secret: config.clientSecret, token: accessToken }),
    signal: AbortSignal.timeout(20_000),
  });
  if (!response.ok) throw new Error('TikTok konnte die Freigabe nicht widerrufen.');
}

export async function queryTikTokCreatorInfo(accessToken: string, fetchImpl: typeof fetch = fetch) {
  const response = await fetchImpl(`${TIKTOK_API_BASE}/post/publish/creator_info/query/`, {
    method: 'POST',
    headers: { Authorization: `Bearer ${accessToken}`, 'content-type': 'application/json', accept: 'application/json' },
    body: '{}',
    signal: AbortSignal.timeout(20_000),
  });
  const payload = ensureTikTokPayload(
    response,
    await response.json().catch(() => null),
    'Die TikTok-Creator-Informationen konnten nicht geladen werden.',
  );
  const data = payload?.data ?? {};
  return {
    avatarUrl: clean(data.creator_avatar_url, 2_000),
    username: clean(data.creator_username, 180),
    nickname: clean(data.creator_nickname, 180),
    privacyLevelOptions: Array.isArray(data.privacy_level_options)
      ? data.privacy_level_options.map((entry: unknown) => clean(entry, 80)).filter(Boolean)
      : [],
    commentDisabled: data.comment_disabled === true,
    duetDisabled: data.duet_disabled === true,
    stitchDisabled: data.stitch_disabled === true,
    maxVideoPostDurationSec: Math.max(0, Number(data.max_video_post_duration_sec) || 0),
  } satisfies TikTokCreatorInfo;
}

function uploadGeometry(size: number) {
  const maximumChunk = 64 * 1024 * 1024;
  if (size <= maximumChunk) return { chunkSize: size, totalChunkCount: 1 };
  const totalChunkCount = Math.ceil(size / maximumChunk);
  const chunkSize = Math.floor(size / totalChunkCount);
  return { chunkSize, totalChunkCount };
}

export async function initializeTikTokDirectPost(
  accessToken: string,
  fileSize: number,
  post: TikTokDirectPostInput,
  fetchImpl: typeof fetch = fetch,
) {
  const maximumUploadSize = 4 * 1024 * 1024 * 1024;
  if (!Number.isSafeInteger(fileSize) || fileSize <= 0 || fileSize > maximumUploadSize) {
    throw new Error('TikTok erwartet eine nicht leere Videodatei mit maximal 4 GB.');
  }
  const geometry = uploadGeometry(fileSize);
  const response = await fetchImpl(`${TIKTOK_API_BASE}/post/publish/video/init/`, {
    method: 'POST',
    headers: { Authorization: `Bearer ${accessToken}`, 'content-type': 'application/json', accept: 'application/json' },
    body: JSON.stringify({
      post_info: {
        title: post.title.slice(0, 2_200),
        privacy_level: post.privacyLevel,
        disable_duet: post.disableDuet,
        disable_stitch: post.disableStitch,
        disable_comment: post.disableComment,
        video_cover_timestamp_ms: Math.max(0, Math.floor(post.coverTimestampMs ?? 1_000)),
        brand_content_toggle: post.brandContentToggle,
        brand_organic_toggle: post.brandOrganicToggle,
        is_aigc: post.isAigc,
      },
      source_info: {
        source: 'FILE_UPLOAD',
        video_size: fileSize,
        chunk_size: geometry.chunkSize,
        total_chunk_count: geometry.totalChunkCount,
      },
    }),
    signal: AbortSignal.timeout(30_000),
  });
  const payload = ensureTikTokPayload(
    response,
    await response.json().catch(() => null),
    'TikTok hat die Veröffentlichung nicht initialisiert.',
  );
  const publishId = clean(payload?.data?.publish_id, 256);
  const uploadUrl = clean(payload?.data?.upload_url, 4_096);
  if (!publishId || !uploadUrl) throw new Error('TikTok hat keine vollständigen Upload-Daten geliefert.');
  return { publishId, uploadUrl, ...geometry };
}

export async function uploadTikTokVideo(
  uploadUrl: string,
  filePath: string,
  chunkSize: number,
  fetchImpl: typeof fetch = fetch,
) {
  const file = await stat(filePath);
  const totalChunkCount = file.size <= 64 * 1024 * 1024 ? 1 : Math.max(2, Math.floor(file.size / chunkSize));
  let start = 0;
  for (let chunk = 0; chunk < totalChunkCount; chunk += 1) {
    const finalChunk = chunk === totalChunkCount - 1;
    const end = finalChunk ? file.size - 1 : Math.min(file.size - 1, start + chunkSize - 1);
    const length = end - start + 1;
    const response = await fetchImpl(uploadUrl, {
      method: 'PUT',
      headers: {
        'content-type': 'video/mp4',
        'content-length': String(length),
        'content-range': `bytes ${start}-${end}/${file.size}`,
      },
      body: createReadStream(filePath, { start, end }) as any,
      duplex: 'half',
      signal: AbortSignal.timeout(30 * 60_000),
    } as RequestInit & { duplex: 'half' });
    const expectedStatus = finalChunk ? 201 : 206;
    if (response.status !== expectedStatus) {
      const payload = await response.json().catch(() => null);
      throw apiError(payload, 'TikTok hat einen Video-Block nicht angenommen.', response.status === 429 ? 429 : 502);
    }
    start = end + 1;
  }
}

export async function fetchTikTokPublishStatus(
  accessToken: string,
  publishId: string,
  fetchImpl: typeof fetch = fetch,
) {
  const response = await fetchImpl(`${TIKTOK_API_BASE}/post/publish/status/fetch/`, {
    method: 'POST',
    headers: { Authorization: `Bearer ${accessToken}`, 'content-type': 'application/json', accept: 'application/json' },
    body: JSON.stringify({ publish_id: publishId }),
    signal: AbortSignal.timeout(20_000),
  });
  const payload = ensureTikTokPayload(
    response,
    await response.json().catch(() => null),
    'Der TikTok-Veröffentlichungsstatus konnte nicht geladen werden.',
  );
  const data = payload?.data ?? {};
  const postIds = Array.isArray(data.publicaly_available_post_id)
    ? data.publicaly_available_post_id.map((entry: unknown) => clean(String(entry), 256)).filter(Boolean)
    : [];
  return {
    status: clean(data.status, 120),
    failReason: clean(data.fail_reason, 500),
    uploadedBytes: Math.max(0, Number(data.uploaded_bytes) || 0),
    postIds,
  };
}
