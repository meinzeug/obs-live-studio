export function boundedRunnerNumber(value: unknown, fallback: number, minimum: number, maximum: number) {
  const parsed = Number(value);
  if (!Number.isFinite(parsed)) return fallback;
  return Math.round(Math.max(minimum, Math.min(maximum, parsed)));
}

export function runnerOperationPollHealthy(
  activeRun: boolean,
  lastSuccessfulPollAt: string | null,
  staleAfterMs: number,
  now = Date.now(),
) {
  if (activeRun) return true;
  if (!lastSuccessfulPollAt) return false;
  const lastPollAt = Date.parse(lastSuccessfulPollAt);
  return Number.isFinite(lastPollAt) && now - lastPollAt < staleAfterMs;
}
