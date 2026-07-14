import { randomUUID } from 'node:crypto';
import { beforeEach, describe, expect, it } from 'vitest';
import { createSource, markSourceError, query, recordSourceCheck } from '../../packages/database/src/index.js';
import {
  dueSourcesWithBackoff,
  getSourceHealth,
  listSourceHealth,
  scheduleSourceFetchJobsWithBackoff,
} from '../../packages/database/src/source-health-store.js';

const integration = process.env.VITEST_INCLUDE_INTEGRATION === 'true' ? describe : describe.skip;

integration('source health database queries', () => {
  beforeEach(async () => {
    await query(
      `delete from worker_jobs
       where payload->>'sourceId' in (
         select id::text from sources where name like 'Source health test %'
       )`,
    );
    await query("delete from source_checks where details->>'testSuite'='source-health'");
    await query("delete from sources where name like 'Source health test %'");
  });

  it('returns source summaries and a bounded redacted check history', async () => {
    const source = await createSource({
      name: `Source health test ${randomUUID()}`,
      url: `https://example.invalid/${randomUUID()}.xml`,
      type: 'rss',
      active: true,
      fetchIntervalSeconds: 900,
    });
    await recordSourceCheck(source.id, 'ok', {
      testSuite: 'source-health',
      durationMs: 120,
      status: 200,
      items: 4,
      inserted: 2,
    });
    await recordSourceCheck(source.id, 'error', {
      testSuite: 'source-health',
      durationMs: 450,
      error: 'Abruf von https://user:password@example.invalid/feed fehlgeschlagen',
    });

    const summaries = await listSourceHealth(24);
    const summary = summaries.find((item) => item.sourceId === source.id);
    expect(summary).toMatchObject({
      totalChecks: 2,
      successfulChecks: 1,
      failedChecks: 1,
      availabilityPercent: 50,
      averageDurationMs: 285,
      state: 'degraded',
    });
    expect(summary?.lastError).not.toContain('password');

    const detail = await getSourceHealth(source.id, 24, 1);
    expect(detail?.recentChecks).toHaveLength(1);
    expect(detail?.summary.sourceId).toBe(source.id);
    expect(JSON.stringify(detail?.recentChecks)).not.toContain('password');
    expect(JSON.stringify(detail?.recentChecks)).toContain('[redacted]');
  });

  it('holds failed sources until their retry window and then queues one job', async () => {
    const source = await createSource({
      name: `Source health test ${randomUUID()}`,
      url: `https://example.invalid/${randomUUID()}.xml`,
      type: 'rss',
      active: true,
      fetchIntervalSeconds: 900,
    });
    await markSourceError(source.id, 'HTTP 503');
    await recordSourceCheck(source.id, 'error', {
      testSuite: 'source-health',
      durationMs: 200,
      error: 'HTTP 503',
      retryInSeconds: 120,
    });

    const immediately = new Date();
    expect((await dueSourcesWithBackoff(immediately, [source.id])).some((item) => item.id === source.id)).toBe(false);
    await scheduleSourceFetchJobsWithBackoff(immediately, [source.id]);
    const beforeRetry = await query<{ count: string }>(
      "select count(*)::text count from worker_jobs where kind='fetch-source' and payload->>'sourceId'=$1",
      [source.id],
    );
    expect(Number(beforeRetry.rows[0].count)).toBe(0);

    const afterRetry = new Date(immediately.getTime() + 130_000);
    expect((await dueSourcesWithBackoff(afterRetry, [source.id])).some((item) => item.id === source.id)).toBe(true);
    await scheduleSourceFetchJobsWithBackoff(afterRetry, [source.id]);
    await scheduleSourceFetchJobsWithBackoff(afterRetry, [source.id]);
    const afterQueue = await query<{ count: string }>(
      "select count(*)::text count from worker_jobs where kind='fetch-source' and payload->>'sourceId'=$1 and status in ('queued','running')",
      [source.id],
    );
    expect(Number(afterQueue.rows[0].count)).toBe(1);
  });
});
