import { randomUUID } from 'node:crypto';
import { beforeEach, describe, expect, it } from 'vitest';
import { createSource, query, recordSourceCheck } from '../../packages/database/src/index.js';
import { getSourceHealth, listSourceHealth } from '../../packages/database/src/source-health-store.js';

const integration = process.env.VITEST_INCLUDE_INTEGRATION === 'true' ? describe : describe.skip;

integration('source health database queries', () => {
  beforeEach(async () => {
    await query("delete from source_checks where details->>'testSuite'='source-health'");
    await query("delete from sources where name like 'Source health test %'");
  });

  it('returns source summaries and a bounded recent check history', async () => {
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
      error: 'HTTP 503',
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

    const detail = await getSourceHealth(source.id, 24, 1);
    expect(detail?.recentChecks).toHaveLength(1);
    expect(detail?.summary.sourceId).toBe(source.id);
  });
});
