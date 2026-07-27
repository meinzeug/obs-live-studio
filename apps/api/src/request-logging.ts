import type { FastifyInstance, FastifyRequest } from 'fastify';

export type ApiRequestLoggingMode = 'errors' | 'sampled' | 'all';

export type ApiRequestLoggingConfig = {
  mode: ApiRequestLoggingMode;
  sampleRate: number;
  slowRequestMs: number;
};

export type ApiRequestLogDecision = {
  level: 'info' | 'warn' | 'error';
  reason: 'request' | 'sampled-poll' | 'slow' | 'client-error' | 'server-error';
} | null;

const POLLING_GET_PATHS = new Set([
  '/health',
  '/api/dashboard',
  '/api/dashboard/program-preview',
  '/api/notifications',
  '/api/obs/status',
  '/api/live/status',
  '/api/sendebetrieb/status',
  '/api/advertising',
  '/api/growth',
  '/api/ai-host/status',
  '/api/admin/backups',
  '/api/tts/settings',
  '/api/public/channel',
  '/api/channel/identity/public',
  '/api/channel/logo',
]);

const POLLING_GET_PREFIXES = [
  '/api/live/youtube/control/',
  '/api/live/production-chat',
  '/api/broadcast/status',
  '/api/broadcast/playlists',
  '/api/broadcast/articles',
  '/api/broadcast/formats',
  '/api/broadcast/director-cues',
  '/api/youtube-videos',
  '/api/youtube-shorts',
  '/api/tiktok-shorts',
  '/api/source-health',
  '/api/agent-orchestrator',
  '/api/ai-team',
  '/api/ai-roundtable',
  '/api/autonomous-studio',
  '/api/overlays',
  '/api/overlay/',
  '/live/youtube/',
  '/live/player-assets/',
  '/overlay/live/',
];

function pathOf(rawUrl: string) {
  try {
    return new URL(rawUrl, 'http://studio.local').pathname;
  } catch {
    return '/';
  }
}

function numberInRange(value: unknown, fallback: number, minimum: number, maximum: number) {
  if (value == null || String(value).trim() === '') return fallback;
  const parsed = Number(value);
  return Number.isFinite(parsed) ? Math.max(minimum, Math.min(maximum, parsed)) : fallback;
}

export function resolveApiRequestLoggingConfig(
  env: NodeJS.ProcessEnv = process.env,
): ApiRequestLoggingConfig {
  const rawMode = String(env.API_REQUEST_LOGGING ?? 'sampled').trim().toLocaleLowerCase('en-US');
  const mode: ApiRequestLoggingMode =
    ['all', 'true', '1', 'on'].includes(rawMode)
      ? 'all'
      : ['off', 'false', '0', 'errors', 'error'].includes(rawMode)
        ? 'errors'
        : 'sampled';
  return {
    mode,
    sampleRate: numberInRange(env.API_REQUEST_LOG_SAMPLE_RATE, 0.01, 0, 1),
    slowRequestMs: numberInRange(env.API_SLOW_REQUEST_MS, 2_000, 100, 10 * 60_000),
  };
}

export function isPollingRequest(input: { method: string; url: string }) {
  const method = input.method.toUpperCase();
  const path = pathOf(input.url);
  if (method === 'POST') {
    return (
      path.startsWith('/api/live/youtube/progress/') ||
      path === '/api/live/sources/heartbeat' ||
      path === '/api/obs/status/heartbeat'
    );
  }
  if (!['GET', 'HEAD'].includes(method)) return false;
  return POLLING_GET_PATHS.has(path) || POLLING_GET_PREFIXES.some((prefix) => path.startsWith(prefix));
}

export function isStreamingRequest(input: { method: string; url: string }) {
  if (input.method.toUpperCase() !== 'GET') return false;
  const path = pathOf(input.url);
  return (
    path === '/api/dashboard/events' ||
    path === '/api/public/channel/events' ||
    path === '/overlay/events' ||
    path.startsWith('/api/events/') ||
    path.endsWith('/events')
  );
}

export function decideApiRequestLog(input: {
  method: string;
  url: string;
  statusCode: number;
  durationMs: number;
  config: ApiRequestLoggingConfig;
  random?: number;
}): ApiRequestLogDecision {
  if (input.statusCode >= 500) return { level: 'error', reason: 'server-error' };
  if (input.statusCode >= 400) return { level: 'warn', reason: 'client-error' };
  if (!isStreamingRequest(input) && input.durationMs >= input.config.slowRequestMs) {
    return { level: 'warn', reason: 'slow' };
  }
  if (input.config.mode === 'errors') return null;
  if (isPollingRequest(input) || isStreamingRequest(input)) {
    if (input.config.mode === 'all') return { level: 'info', reason: 'request' };
    return (input.random ?? Math.random()) < input.config.sampleRate
      ? { level: 'info', reason: 'sampled-poll' }
      : null;
  }
  return { level: 'info', reason: 'request' };
}

export function installApiRequestLogging(
  app: FastifyInstance,
  config = resolveApiRequestLoggingConfig(),
  random: () => number = Math.random,
) {
  const startedAt = new WeakMap<FastifyRequest, number>();
  app.addHook('onRequest', async (request) => {
    startedAt.set(request, Date.now());
  });
  app.addHook('onResponse', async (request, reply) => {
    const durationMs = Math.max(0, Date.now() - (startedAt.get(request) ?? Date.now()));
    const decision = decideApiRequestLog({
      method: request.method,
      url: request.url,
      statusCode: reply.statusCode,
      durationMs,
      config,
      random: random(),
    });
    if (!decision) return;
    const fields = {
      requestId: request.id,
      method: request.method,
      path: pathOf(request.url),
      statusCode: reply.statusCode,
      durationMs,
      reason: decision.reason,
    };
    if (decision.level === 'error') request.log.error(fields, 'API request completed with server error');
    else if (decision.level === 'warn') request.log.warn(fields, 'API request completed with warning');
    else request.log.info(fields, 'API request completed');
  });
}
