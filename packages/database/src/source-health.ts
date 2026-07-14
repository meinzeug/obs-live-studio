export interface SourceHealthSource {
  id: string;
  name: string;
  url: string;
  active: boolean;
  fetch_interval_seconds: number;
  last_success_at: string | null;
  last_error: string | null;
  consecutive_errors: number;
}

export interface SourceCheckObservation {
  id: string;
  source_id: string;
  status: string;
  details: Record<string, unknown>;
  checked_at: string;
}

export type SourceHealthState = 'healthy' | 'degraded' | 'down' | 'inactive' | 'unknown';

export interface SourceHealthSummary {
  sourceId: string;
  name: string;
  url: string;
  active: boolean;
  state: SourceHealthState;
  windowHours: number;
  totalChecks: number;
  successfulChecks: number;
  failedChecks: number;
  availabilityPercent: number | null;
  averageDurationMs: number | null;
  maximumDurationMs: number | null;
  lastCheckAt: string | null;
  lastStatus: string | null;
  lastError: string | null;
  consecutiveFailures: number;
  nextExpectedCheckAt: string | null;
  stale: boolean;
}

export interface SourceHealthOverview {
  totalSources: number;
  healthy: number;
  degraded: number;
  down: number;
  inactive: number;
  unknown: number;
  averageAvailabilityPercent: number | null;
  averageDurationMs: number | null;
}

function finiteDuration(details: Record<string, unknown>) {
  const value = Number(details.durationMs);
  return Number.isFinite(value) && value >= 0 ? value : null;
}

function rounded(value: number, digits = 1) {
  const multiplier = 10 ** digits;
  return Math.round(value * multiplier) / multiplier;
}

export function summarizeSourceHealth(
  source: SourceHealthSource,
  observations: SourceCheckObservation[],
  windowHours: number,
  now = new Date(),
): SourceHealthSummary {
  const checks = [...observations].sort(
    (left, right) => new Date(right.checked_at).getTime() - new Date(left.checked_at).getTime(),
  );
  const successfulChecks = checks.filter((check) => check.status === 'ok').length;
  const failedChecks = checks.length - successfulChecks;
  const durations = checks
    .map((check) => finiteDuration(check.details ?? {}))
    .filter((duration): duration is number => duration !== null);
  const lastCheck = checks[0] ?? null;
  let consecutiveFailures = 0;
  for (const check of checks) {
    if (check.status === 'ok') break;
    consecutiveFailures += 1;
  }

  const nextExpectedCheckAt = source.last_success_at
    ? new Date(new Date(source.last_success_at).getTime() + source.fetch_interval_seconds * 1000).toISOString()
    : null;
  const staleGraceMs = Math.max(source.fetch_interval_seconds * 1000, 5 * 60 * 1000);
  const stale = Boolean(
    source.active &&
      nextExpectedCheckAt &&
      now.getTime() > new Date(nextExpectedCheckAt).getTime() + staleGraceMs,
  );
  const availabilityPercent = checks.length > 0 ? rounded((successfulChecks / checks.length) * 100) : null;
  const errorFromCheck = checks.find((check) => check.status !== 'ok')?.details?.error;
  const lastError = typeof errorFromCheck === 'string' ? errorFromCheck : source.last_error;

  let state: SourceHealthState = 'unknown';
  if (!source.active) state = 'inactive';
  else if (source.consecutive_errors >= 3 || consecutiveFailures >= 3) state = 'down';
  else if (failedChecks > 0 || stale || (availabilityPercent !== null && availabilityPercent < 95)) state = 'degraded';
  else if (checks.length > 0 && lastCheck?.status === 'ok') state = 'healthy';

  return {
    sourceId: source.id,
    name: source.name,
    url: source.url,
    active: source.active,
    state,
    windowHours,
    totalChecks: checks.length,
    successfulChecks,
    failedChecks,
    availabilityPercent,
    averageDurationMs:
      durations.length > 0 ? Math.round(durations.reduce((sum, value) => sum + value, 0) / durations.length) : null,
    maximumDurationMs: durations.length > 0 ? Math.max(...durations) : null,
    lastCheckAt: lastCheck?.checked_at ?? null,
    lastStatus: lastCheck?.status ?? null,
    lastError,
    consecutiveFailures: Math.max(consecutiveFailures, source.consecutive_errors),
    nextExpectedCheckAt,
    stale,
  };
}

export function summarizeSourceHealthOverview(items: SourceHealthSummary[]): SourceHealthOverview {
  const availabilities = items
    .map((item) => item.availabilityPercent)
    .filter((value): value is number => value !== null);
  const durations = items.map((item) => item.averageDurationMs).filter((value): value is number => value !== null);
  return {
    totalSources: items.length,
    healthy: items.filter((item) => item.state === 'healthy').length,
    degraded: items.filter((item) => item.state === 'degraded').length,
    down: items.filter((item) => item.state === 'down').length,
    inactive: items.filter((item) => item.state === 'inactive').length,
    unknown: items.filter((item) => item.state === 'unknown').length,
    averageAvailabilityPercent:
      availabilities.length > 0
        ? rounded(availabilities.reduce((sum, value) => sum + value, 0) / availabilities.length)
        : null,
    averageDurationMs:
      durations.length > 0 ? Math.round(durations.reduce((sum, value) => sum + value, 0) / durations.length) : null,
  };
}
