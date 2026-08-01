type ManualAiHostSession = {
  started_at?: string | null;
  direction_state?: unknown;
};

function manualReactionEnabled(value: unknown) {
  return Boolean(
    value &&
    typeof value === 'object' &&
    !Array.isArray(value) &&
    (value as Record<string, unknown>).manualReaction === true,
  );
}

export function manualAiHostSessionExpired(
  session: ManualAiHostSession | null | undefined,
  env: NodeJS.ProcessEnv = process.env,
  nowMs = Date.now(),
) {
  if (!manualReactionEnabled(session?.direction_state)) return false;
  const configuredHours = Number(env.AI_HOST_MANUAL_SESSION_MAX_HOURS ?? 6);
  const maximumHours = Number.isFinite(configuredHours) ? Math.max(1, Math.min(24, configuredHours)) : 6;
  const startedAtMs = session?.started_at ? Date.parse(session.started_at) : Number.NaN;
  return Number.isFinite(startedAtMs) && startedAtMs < nowMs - maximumHours * 60 * 60 * 1000;
}
