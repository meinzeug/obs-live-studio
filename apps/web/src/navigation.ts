export const routes = {
  root: '/',
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

const routePatterns = [
  /^\/$/,
  /^\/dashboard$/,
  /^\/sources$/,
  /^\/source-health$/,
  /^\/articles$/,
  /^\/articles\/[^/]+$/,
  /^\/broadcast$/,
  /^\/overlays$/,
  /^\/overlays\/[^/]+\/edit$/,
  /^\/media$/,
  /^\/obs$/,
  /^\/notifications$/,
  /^\/admin\/users$/,
  /^\/admin\/audit$/,
  /^\/admin\/sessions$/,
];

export function isKnownRoute(pathname: string) {
  return routePatterns.some((pattern) => pattern.test(pathname));
}

export function notificationTarget(component: string) {
  if (component === 'source-ingest') return routes.sourceHealth;
  if (component === 'broadcast-runner') return routes.broadcast;
  if (component.startsWith('obs') || component.startsWith('stream')) return routes.obs;
  return routes.dashboard;
}
