import type { QueryResultRow } from 'pg';
import { getSource, listSources, query, type SourceRecord } from './index.js';
import {
  nextSourceCheckAt,
  summarizeSourceHealth,
  type SourceCheckObservation,
  type SourceHealthSource,
  type SourceHealthSummary,
} from './source-health.js';

export { summarizeSourceHealthOverview } from './source-health.js';
export type { SourceCheckObservation, SourceHealthOverview, SourceHealthSummary } from './source-health.js';

interface SourceCheckRow extends QueryResultRow {
  id: string;
  source_id: string;
  status: string;
  details: Record<string, unknown> | null;
  checked_at: string | Date;
}

interface SchedulableSourceRow extends SourceRecord, QueryResultRow {
  latest_check_at: string | Date | null;
}

export interface SourceHealthDetail {
  source: SourceRecord;
  summary: SourceHealthSummary;
  recentChecks: SourceCheckObservation[];
}

function normalizedHours(value: number) {
  return Math.max(1, Math.min(24 * 30, Math.floor(Number(value) || 24)));
}

function normalizedLimit(value: number) {
  return Math.max(1, Math.min(200, Math.floor(Number(value) || 30)));
}

function timestamp(value: string | Date | null | undefined) {
  if (!value) return null;
  const date = value instanceof Date ? value : new Date(value);
  return Number.isFinite(date.getTime()) ? date.toISOString() : null;
}

function observation(row: SourceCheckRow): SourceCheckObservation {
  return {
    id: row.id,
    source_id: row.source_id,
    status: row.status,
    details: row.details ?? {},
    checked_at: timestamp(row.checked_at) ?? new Date(0).toISOString(),
  };
}

function healthSource(source: SourceRecord): SourceHealthSource {
  return {
    id: source.id,
    name: source.name,
    url: source.url,
    active: source.active,
    fetch_interval_seconds: source.fetch_interval_seconds,
    last_success_at: timestamp(source.last_success_at),
    last_error: source.last_error,
    consecutive_errors: source.consecutive_errors,
  };
}

async function sourceChecks(sourceIds: string[], hours: number, maximumRows = 50_000) {
  if (sourceIds.length === 0) return [];
  const rows = (
    await query<SourceCheckRow>(
      `select id,source_id,status,details,checked_at
       from source_checks
       where source_id=any($1::uuid[])
         and checked_at>=now()-make_interval(hours => $2::int)
       order by checked_at desc
       limit $3`,
      [sourceIds, normalizedHours(hours), maximumRows],
    )
  ).rows;
  return rows.map(observation);
}

export async function dueSourcesWithBackoff(now = new Date()) {
  const rows = (
    await query<SchedulableSourceRow>(
      `select s.*,last_check.checked_at latest_check_at
       from sources s
       left join lateral (
         select checked_at
         from source_checks
         where source_id=s.id
         order by checked_at desc
         limit 1
       ) last_check on true
       where s.active=true and s.deleted_at is null
       order by s.priority desc,s.created_at asc`,
    )
  ).rows;

  return rows.filter((source) => {
    const latestCheckAt = timestamp(source.latest_check_at);
    if (!latestCheckAt) return true;
    const nextCheckAt = nextSourceCheckAt({
      fetchIntervalSeconds: source.fetch_interval_seconds,
      consecutiveErrors: source.consecutive_errors,
      lastSuccessAt: timestamp(source.last_success_at),
      lastCheckAt: latestCheckAt,
      createdAt: timestamp(source.created_at),
    });
    return !nextCheckAt || new Date(nextCheckAt).getTime() <= now.getTime();
  });
}

export async function listSourceHealth(hours = 24) {
  const windowHours = normalizedHours(hours);
  const sources = await listSources();
  const checks = await sourceChecks(
    sources.map((source) => source.id),
    windowHours,
  );
  const bySource = new Map<string, SourceCheckObservation[]>();
  for (const check of checks) {
    const current = bySource.get(check.source_id) ?? [];
    current.push(check);
    bySource.set(check.source_id, current);
  }
  return sources
    .map((source) => summarizeSourceHealth(healthSource(source), bySource.get(source.id) ?? [], windowHours))
    .sort((left, right) => {
      const severity = { down: 4, degraded: 3, unknown: 2, inactive: 1, healthy: 0 };
      return severity[right.state] - severity[left.state] || left.name.localeCompare(right.name, 'de');
    });
}

export async function getSourceHealth(sourceId: string, hours = 24, limit = 30): Promise<SourceHealthDetail | null> {
  const source = await getSource(sourceId);
  if (!source) return null;
  const windowHours = normalizedHours(hours);
  const checks = await sourceChecks([sourceId], windowHours, 5_000);
  return {
    source,
    summary: summarizeSourceHealth(healthSource(source), checks, windowHours),
    recentChecks: checks.slice(0, normalizedLimit(limit)),
  };
}
