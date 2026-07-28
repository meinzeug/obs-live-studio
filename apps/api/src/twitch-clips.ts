import { resolveAdditionalStreamTargets, resolvePrimaryStreamTarget } from '../../../packages/streaming-platforms/index.mjs';
import { twitchChannelName } from './twitch-live-chat.js';

const TWITCH_API_BASE = 'https://api.twitch.tv/helix';

export type TwitchClipRuntime = {
  enabled: boolean;
  configured: boolean;
  lastClipId: string | null;
  lastClipUrl: string | null;
  lastClipAt: string | null;
  error: string | null;
};

let runtime: TwitchClipRuntime = {
  enabled: false,
  configured: false,
  lastClipId: null,
  lastClipUrl: null,
  lastClipAt: null,
  error: null,
};

function clean(value: unknown, maximum = 500) {
  return typeof value === 'string' ? value.replace(/\s+/g, ' ').trim().slice(0, maximum) : '';
}

function boundedNumber(value: unknown, fallback: number, minimum: number, maximum: number) {
  const parsed = Number(value);
  return Number.isFinite(parsed) ? Math.max(minimum, Math.min(maximum, Math.floor(parsed))) : fallback;
}

function twitchTargetEnabled(env: NodeJS.ProcessEnv) {
  const primary = resolvePrimaryStreamTarget(env);
  return (
    (primary.enabled && primary.configured && primary.platform === 'twitch') ||
    resolveAdditionalStreamTargets(env, { includeDisabled: true }).some(
      (target) => target.enabled && target.configured && target.platform === 'twitch',
    )
  );
}

function twitchApiHeaders(env: NodeJS.ProcessEnv) {
  const clientId = clean(env.TWITCH_CLIENT_ID, 200);
  const accessToken = clean(env.TWITCH_ACCESS_TOKEN, 4096).replace(/^oauth:/i, '');
  if (!clientId || !accessToken) {
    throw Object.assign(
      new Error('Für automatische Twitch-Clips fehlen TWITCH_CLIENT_ID oder TWITCH_ACCESS_TOKEN (Scope clips:edit).'),
      { statusCode: 409 },
    );
  }
  return { clientId, accessToken };
}

async function twitchApi<T>(
  path: string,
  env: NodeJS.ProcessEnv,
  fetchImpl: typeof fetch,
  init: RequestInit = {},
) {
  const { clientId, accessToken } = twitchApiHeaders(env);
  const response = await fetchImpl(`${TWITCH_API_BASE}/${path}`, {
    ...init,
    headers: {
      'Client-Id': clientId,
      Authorization: `Bearer ${accessToken}`,
      accept: 'application/json',
      ...init.headers,
    },
    signal: init.signal ?? AbortSignal.timeout(20_000),
  });
  const payload = (await response.json().catch(() => null)) as T | null;
  if (!response.ok || !payload) {
    const message = clean((payload as any)?.message, 600) || `Twitch API ist fehlgeschlagen (${response.status}).`;
    throw Object.assign(new Error(message), { statusCode: response.status >= 500 ? 502 : response.status });
  }
  return payload;
}

async function broadcasterId(env: NodeJS.ProcessEnv, fetchImpl: typeof fetch) {
  const configured = clean(env.TWITCH_BROADCASTER_ID, 200);
  if (configured) return configured;
  const login = twitchChannelName(env.TWITCH_CHANNEL_URL);
  if (!login) {
    throw Object.assign(
      new Error('TWITCH_BROADCASTER_ID oder eine gültige TWITCH_CHANNEL_URL wird für Clips benötigt.'),
      { statusCode: 409 },
    );
  }
  const payload = await twitchApi<{ data?: Array<{ id?: string }> }>(
    `users?login=${encodeURIComponent(login)}`,
    env,
    fetchImpl,
  );
  const id = clean(payload.data?.[0]?.id, 200);
  if (!id) throw Object.assign(new Error(`Twitch-Kanal „${login}“ wurde nicht gefunden.`), { statusCode: 404 });
  return id;
}

export function twitchClipRuntime(env: NodeJS.ProcessEnv = process.env) {
  const enabled = twitchTargetEnabled(env) && env.TWITCH_CLIPS_ENABLED !== 'false';
  const configured = Boolean(
    clean(env.TWITCH_CLIENT_ID) &&
      clean(env.TWITCH_ACCESS_TOKEN) &&
      (clean(env.TWITCH_BROADCASTER_ID) || twitchChannelName(env.TWITCH_CHANNEL_URL)),
  );
  runtime = { ...runtime, enabled, configured };
  return { ...runtime };
}

export async function createTwitchLiveClip(
  env: NodeJS.ProcessEnv = process.env,
  fetchImpl: typeof fetch = fetch,
  options: {
    confirmationAttempts?: number;
    confirmationIntervalMs?: number;
    sleep?: (milliseconds: number) => Promise<void>;
  } = {},
) {
  const status = twitchClipRuntime(env);
  if (!status.enabled) return status;
  if (!status.configured) {
    const message = 'Twitch-Clips sind aktiv, aber API-Zugang oder Sender-ID fehlen.';
    runtime = {
      ...status,
      error: message,
    };
    throw Object.assign(new Error(message), { statusCode: 409 });
  }
  try {
    const id = await broadcasterId(env, fetchImpl);
    const payload = await twitchApi<{ data?: Array<{ id?: string; edit_url?: string }> }>(
      `clips?broadcaster_id=${encodeURIComponent(id)}&has_delay=false`,
      env,
      fetchImpl,
      { method: 'POST' },
    );
    const clipId = clean(payload.data?.[0]?.id, 200);
    if (!clipId) throw Object.assign(new Error('Twitch hat keine Clip-ID zurückgegeben.'), { statusCode: 502 });
    const attempts = boundedNumber(
      options.confirmationAttempts ?? env.TWITCH_CLIP_CONFIRM_ATTEMPTS,
      12,
      1,
      30,
    );
    const intervalMs = boundedNumber(
      options.confirmationIntervalMs ?? env.TWITCH_CLIP_CONFIRM_INTERVAL_MS,
      5_000,
      0,
      30_000,
    );
    const sleep =
      options.sleep ?? ((milliseconds: number) => new Promise((resolve) => setTimeout(resolve, milliseconds)));
    let publishedUrl = '';
    for (let attempt = 0; attempt < attempts; attempt += 1) {
      const confirmation = await twitchApi<{ data?: Array<{ id?: string; url?: string }> }>(
        `clips?id=${encodeURIComponent(clipId)}`,
        env,
        fetchImpl,
      );
      publishedUrl = clean(confirmation.data?.find((clip) => clip.id === clipId)?.url, 1000);
      if (publishedUrl) break;
      if (attempt + 1 < attempts) await sleep(intervalMs);
    }
    if (!publishedUrl) {
      throw Object.assign(new Error('Twitch hat den angeforderten Clip nicht innerhalb von 60 Sekunden veröffentlicht.'), {
        statusCode: 504,
      });
    }
    runtime = {
      ...status,
      lastClipId: clipId,
      lastClipUrl: publishedUrl,
      lastClipAt: new Date().toISOString(),
      error: null,
    };
    return { ...runtime, editUrl: clean(payload.data?.[0]?.edit_url, 1000) || null };
  } catch (error) {
    runtime = { ...status, error: error instanceof Error ? error.message : String(error) };
    throw error;
  }
}
