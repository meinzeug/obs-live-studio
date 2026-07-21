export const routes = {
  root: '/',
  overview: '/overview',
  dashboard: '/dashboard',
  newsroom: '/newsroom',
  sources: '/sources',
  sourceHealth: '/source-health',
  articles: '/articles',
  youtubeVideos: '/youtube-videos',
  youtubeShorts: '/youtube-shorts',
  broadcast: '/broadcast',
  live: '/live',
  overlays: '/overlays',
  media: '/media',
  obs: '/obs',
  aiStudio: '/ai-studio',
  automation: '/automation',
  analytics: '/analytics',
  notifications: '/notifications',
  settings: '/settings',
  system: '/system',
  mediaSettings: '/settings/media',
  adminUsers: '/admin/users',
  adminAudit: '/admin/audit',
  adminSessions: '/admin/sessions',
} as const;

const routePatterns = [
  /^\/$/,
  /^\/overview$/,
  /^\/dashboard$/,
  /^\/newsroom$/,
  /^\/sources$/,
  /^\/source-health$/,
  /^\/articles$/,
  /^\/articles\/[^/]+$/,
  /^\/youtube-videos$/,
  /^\/youtube-shorts$/,
  /^\/broadcast$/,
  /^\/live$/,
  /^\/overlays$/,
  /^\/overlays\/[^/]+\/edit$/,
  /^\/media$/,
  /^\/media\/[^/]+$/,
  /^\/obs$/,
  /^\/ai-studio$/,
  /^\/automation$/,
  /^\/analytics$/,
  /^\/notifications$/,
  /^\/settings$/,
  /^\/system$/,
  /^\/settings\/media$/,
  /^\/admin\/users$/,
  /^\/admin\/audit$/,
  /^\/admin\/sessions$/,
];

type QueryValue = string | number | boolean | null | undefined;

export function routeWithQuery(path: string, values: Record<string, QueryValue>) {
  const search = new URLSearchParams();
  for (const [key, value] of Object.entries(values)) {
    if (value === null || value === undefined || value === '' || value === false) continue;
    search.set(key, String(value));
  }
  const query = search.toString();
  return query ? `${path}?${query}` : path;
}

export function articleDetailRoute(id: string) {
  return `${routes.articles}/${encodeURIComponent(id)}`;
}

export function articlesRoute(filters: { status?: string; warnings?: boolean; q?: string } = {}) {
  return routeWithQuery(routes.articles, filters);
}

export function overlayEditorRoute(id: string) {
  return `${routes.overlays}/${encodeURIComponent(id)}/edit`;
}

export function mediaDetailRoute(id: string) {
  return `${routes.media}/${encodeURIComponent(id)}`;
}

export function sourceHealthRoute(filters: { source?: string; state?: string } = {}) {
  return routeWithQuery(routes.sourceHealth, filters);
}

export function broadcastRoute(view?: string) {
  return routeWithQuery(routes.broadcast, { view });
}

export function isKnownRoute(location: string) {
  const pathname = location.split(/[?#]/, 1)[0];
  return routePatterns.some((pattern) => pattern.test(pathname));
}

export function notificationTarget(component: string, details: Record<string, unknown> = {}) {
  if (component === 'source-ingest') {
    return sourceHealthRoute({
      source: typeof details.sourceId === 'string' ? details.sourceId : undefined,
      state: 'problem',
    });
  }
  if (component === 'broadcast-runner') return broadcastRoute('active');
  if (component === 'youtube-shorts') return routes.youtubeShorts;
  if (component === 'ai-tv-team') return routes.aiStudio;
  if (component.startsWith('obs') || component.startsWith('stream')) return routes.obs;
  return routes.overview;
}
