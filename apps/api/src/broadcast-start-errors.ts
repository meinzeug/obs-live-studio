const BROADCAST_START_CONFLICTS = [
  'active-broadcast-run-exists',
  'manual-show-switch-pending',
  'show-switch-not-ready',
  'idempotency-key-conflict',
  'idempotency-replay-unavailable',
  'playlist-has-no-broadcastable-items',
  'published-main-overlay-required',
  'broadcast-item-not-playable',
] as const;

export function broadcastStartErrorStatus(error: unknown) {
  const message = error instanceof Error ? error.message : String(error);
  if (message.includes('playlist-not-found')) return 404;
  if (message.includes('broadcast-item-not-found')) return 404;
  if (BROADCAST_START_CONFLICTS.some((code) => message.includes(code))) return 409;
  return null;
}
