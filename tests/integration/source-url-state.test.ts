import { randomUUID } from 'node:crypto';
import { beforeEach, describe, expect, it } from 'vitest';
import { createSource, query } from '../../packages/database/src/index.js';

const integration = process.env.VITEST_INCLUDE_INTEGRATION === 'true' ? describe : describe.skip;

integration('source URL state', () => {
  beforeEach(async () => {
    await query("delete from sources where name like 'source-url-state-test-%'");
  });

  it('resets validators and health state atomically when a source URL changes', async () => {
    const source = await createSource({
      name: `source-url-state-test-${randomUUID()}`,
      url: 'https://example.org/old-feed.xml',
      type: 'rss',
      userAgent: 'ArgumentationsKette-Crawler/2.0',
    });
    await query(
      `update sources
       set etag='"old"',
           last_modified='Mon, 13 Jul 2026 12:00:00 GMT',
           last_success_at=now(),
           last_error='alter Fehler',
           consecutive_errors=4
       where id=$1`,
      [source.id],
    );

    await query('update sources set url=$2,domain=$3 where id=$1', [
      source.id,
      'https://example.net/new-feed.xml',
      'example.net',
    ]);

    const result = await query<{
      url: string;
      user_agent: string | null;
      etag: string | null;
      last_modified: string | null;
      last_success_at: string | null;
      last_error: string | null;
      consecutive_errors: number;
    }>(
      `select url,user_agent,etag,last_modified,last_success_at,last_error,consecutive_errors
       from sources where id=$1`,
      [source.id],
    );

    expect(result.rows[0]).toEqual({
      url: 'https://example.net/new-feed.xml',
      user_agent: 'ArgumentationsKette-Crawler/2.0',
      etag: null,
      last_modified: null,
      last_success_at: null,
      last_error: null,
      consecutive_errors: 0,
    });
  });
});
