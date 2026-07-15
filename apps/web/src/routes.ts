export const routes = {
  dashboard: '/dashboard',
  sources: '/sources',
  sourceHealth: '/source-health',
  articles: '/articles',
  broadcast: '/broadcast',
  overlays: '/overlays',
  media: '/media',
  obs: '/obs',
  notifications: '/notifications',
  adminUsers: '/admin/users',
  adminAudit: '/admin/audit',
  adminSessions: '/admin/sessions',
} as const;

type QueryValue = string | number | boolean | null | undefined;

export function withQuery(path: string, values: Record<string, QueryValue>) {
  const query = new URLSearchParams();
  for (const [key, value] of Object.entries(values)) {
    if (value === undefined || value === null || value === '' || value === false) continue;
    query.set(key, String(value));
  }
  const serialized = query.toString();
  return serialized ? `${path}?${serialized}` : path;
}

export function articlePath(id: string) {
  return `${routes.articles}/${encodeURIComponent(id)}`;
}

export function articlesPath(filters: { status?: string; warnings?: boolean; q?: string } = {}) {
  return withQuery(routes.articles, filters);
}

export function sourceHealthPath(filters: { state?: string; hours?: number } = {}) {
  return withQuery(routes.sourceHealth, filters);
}

export function sourceHealthDetailPath(id: string, filters: { state?: string; hours?: number } = {}) {
  return withQuery(`${routes.sourceHealth}/${encodeURIComponent(id)}`, filters);
}

export function broadcastPlaylistPath(id: string) {
  return `${routes.broadcast}/playlists/${encodeURIComponent(id)}`;
}

export function overlayEditorPath(id: string) {
  return `${routes.overlays}/${encodeURIComponent(id)}/edit`;
}

export function mediaDetailPath(id: string) {
  return `${routes.media}/${encodeURIComponent(id)}`;
}

export function notificationsPath(filters: { unread?: boolean; component?: string } = {}) {
  return withQuery(routes.notifications, filters);
}

export const legacyRedirects: Record<string, string> = {
  '/': routes.dashboard,
  '/studio': routes.dashboard,
  '/news': routes.articles,
  '/playlists': routes.broadcast,
  '/assets': routes.media,
  '/alerts': routes.notifications,
  '/source-monitor': routes.sourceHealth,
  '/obs/system': routes.obs,
  '/settings/obs': routes.obs,
};
