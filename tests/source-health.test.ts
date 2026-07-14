import { describe, expect, it } from 'vitest';
import {
  summarizeSourceHealth,
  summarizeSourceHealthOverview,
  type SourceCheckObservation,
  type SourceHealthSource,
} from '../packages/database/src/source-health.js';

const baseSource: SourceHealthSource = {
  id: 'source-1',
  name: 'Testquelle',
  url: 'https://example.invalid/feed.xml',
  active: true,
  fetch_interval_seconds: 900,
  last_success_at: '2026-07-14T11:50:00.000Z',
  last_error: null,
  consecutive_errors: 0,
};

function check(
  id: string,
  status: string,
  checkedAt: string,
  details: Record<string, unknown> = {},
): SourceCheckObservation {
  return {
    id,
    source_id: baseSource.id,
    status,
    checked_at: checkedAt,
    details,
  };
}

describe('source health aggregation', () => {
  it('calculates availability and response-time metrics for a stable source', () => {
    const summary = summarizeSourceHealth(
      baseSource,
      [
        check('check-1', 'ok', '2026-07-14T11:55:00.000Z', { durationMs: 200 }),
        check('check-2', 'ok', '2026-07-14T11:45:00.000Z', { durationMs: 400 }),
      ],
      24,
      new Date('2026-07-14T12:00:00.000Z'),
    );

    expect(summary.state).toBe('healthy');
    expect(summary.availabilityPercent).toBe(100);
    expect(summary.averageDurationMs).toBe(300);
    expect(summary.maximumDurationMs).toBe(400);
    expect(summary.consecutiveFailures).toBe(0);
    expect(summary.stale).toBe(false);
    expect(summary.nextExpectedCheckAt).toBe('2026-07-14T12:05:00.000Z');
  });

  it('marks repeated failures as down and exposes the latest error', () => {
    const source = { ...baseSource, consecutive_errors: 3, last_error: 'Verbindung fehlgeschlagen' };
    const summary = summarizeSourceHealth(
      source,
      [
        check('check-3', 'error', '2026-07-14T11:59:00.000Z', { error: 'HTTP 503', durationMs: 900 }),
        check('check-2', 'error', '2026-07-14T11:45:00.000Z', { error: 'Timeout' }),
        check('check-1', 'error', '2026-07-14T11:30:00.000Z', { error: 'DNS' }),
      ],
      24,
      new Date('2026-07-14T12:00:00.000Z'),
    );

    expect(summary.state).toBe('down');
    expect(summary.availabilityPercent).toBe(0);
    expect(summary.consecutiveFailures).toBe(3);
    expect(summary.lastError).toBe('HTTP 503');
  });

  it('detects overdue checks and summarizes the complete monitor', () => {
    const stale = summarizeSourceHealth(
      { ...baseSource, id: 'source-2', last_success_at: '2026-07-14T09:00:00.000Z' },
      [],
      24,
      new Date('2026-07-14T12:00:00.000Z'),
    );
    const inactive = summarizeSourceHealth(
      { ...baseSource, id: 'source-3', active: false },
      [],
      24,
      new Date('2026-07-14T12:00:00.000Z'),
    );
    const healthy = summarizeSourceHealth(
      baseSource,
      [check('check-1', 'ok', '2026-07-14T11:55:00.000Z', { durationMs: 250 })],
      24,
      new Date('2026-07-14T12:00:00.000Z'),
    );
    const overview = summarizeSourceHealthOverview([stale, inactive, healthy]);

    expect(stale.state).toBe('degraded');
    expect(stale.stale).toBe(true);
    expect(inactive.state).toBe('inactive');
    expect(overview).toMatchObject({
      totalSources: 3,
      healthy: 1,
      degraded: 1,
      down: 0,
      inactive: 1,
      unknown: 0,
      averageAvailabilityPercent: 100,
      averageDurationMs: 250,
    });
  });
});
