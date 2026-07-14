import type { QueryResultRow } from 'pg';
import { getSource, listSources, query, type SourceRecord } from './index.js';
import {
  summarizeSourceHealth,
  summarizeSourceHealthOverview,
  type SourceCheckObservation,
  type SourceHealthSource,
  type SourceHealthSummary,
} from './source-health.js';

export { summarizeSourceHealthOverview } from './source-health.js';
export type { SourceCheckObservation, SourceHealthOverview, SourceHealthSummary } from './source-health.js';

interface SourceCheckRow extends QueryResultRow, SourceCheckObservation {}

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

function healthSource(source: SourceRecord): SourceHealthSource {
  return {
    id: source.id,
    name: source.name,
    url: source.url,
    active: source.active,
    fetch_interval_seconds: source.fetch_interval_seconds,
    last_success_at: source.last_success_at,
    last_error: source.last_error,
    consecutive_errors: source.consecutive_errors,
  };
}

async function sourceChecks(sourceIds: string[], hours: number, maximumRows = 50_000) {
  if (sourceIds.length === 0) return [];
  return (
    await query<SourceCheckRow>(
      `select id,source_id,status,details,checked_at
       from source_checks
       where source_id=any($1::uuid[])
         and checked_at>=now()-make_interval(hours=>$2::int)
       order by checked_at desc
       limit $3`,
      [sourceIds, normalizedHours(hours), maximumRows],
    )
  ).rows;
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
