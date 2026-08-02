type RateLimitRequest = {
  method?: string;
  url?: string;
  ip?: string;
};

const YOUTUBE_PROGRESS_PATH =
  /^\/api\/live\/youtube\/progress\/[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

function requestPath(rawUrl?: string) {
  try {
    return new URL(rawUrl ?? '/', 'http://studio.local').pathname;
  } catch {
    return '/';
  }
}

function isLoopbackAddress(rawIp?: string) {
  const ip = rawIp?.trim().toLowerCase();
  return Boolean(ip && (ip === '::1' || ip === '::ffff:127.0.0.1' || /^127(?:\.\d{1,3}){3}$/.test(ip)));
}

export function isRealtimeReadRoute(req: RateLimitRequest) {
  if (req.method !== 'GET' && req.method !== 'HEAD') return false;
  const path = requestPath(req.url);
  return (
    path === '/health' ||
    path === '/api/dashboard' ||
    path === '/api/dashboard/events' ||
    path === '/api/dashboard/program-preview' ||
    path === '/api/notifications' ||
    path === '/api/public/channel' ||
    path === '/api/public/channel/events' ||
    path === '/api/channel/identity/public' ||
    path === '/api/channel/logo' ||
    path === '/api/obs/status' ||
    path === '/api/live/status' ||
    path.startsWith('/live/player-assets/') ||
    path.startsWith('/live/youtube/') ||
    path.startsWith('/api/live/youtube/control/') ||
    path === '/api/overlay/main' ||
    path === '/overlay/events' ||
    path.startsWith('/overlay/live/') ||
    path.startsWith('/api/overlay/live/')
  );
}

export function isInternalPlayoutRoute(req: RateLimitRequest) {
  if (!isLoopbackAddress(req.ip)) return false;
  const path = requestPath(req.url);
  if (req.method === 'GET' || req.method === 'HEAD') {
    return path === '/api/overlay/ai-roundtable' || path === '/api/overlay/advertising/active';
  }
  return req.method === 'POST' && YOUTUBE_PROGRESS_PATH.test(path);
}

export function isGlobalRateLimitExemptRoute(req: RateLimitRequest) {
  return isRealtimeReadRoute(req) || isInternalPlayoutRoute(req);
}
