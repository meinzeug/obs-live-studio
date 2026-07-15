import { randomUUID } from 'node:crypto';
import { beforeEach, describe, expect, it } from 'vitest';
import { createSource, query } from '../../packages/database/src/index.js';
import { updateSourceState as updateSource } from '../../packages/database/src/source-update-store.js';

const integration = process.env.VITEST_INCLUDE_INTEGRATION === 'true' ? describe : describe.skip;

integration('source URL state', () => {
  beforeEach(async () => {
    await query("delete from sources where name like 'source-url-state-test-%'");
  });

  async function preparedSource() {
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
    return source;
  }

  it('preserves the stored user agent and fetch state on unrelated partial updates', async () => {
    const source = await preparedSource();

    await updateSource(source.id, { name: `${source.name}-renamed` });

    const result = await query<{
      user_agent: string | null;
      etag: string | null;
      last_success_at: Date | null;
      last_error: string | null;
      consecutive_errors: number;
    }>('select user_agent,etag,last_success_at,last_error,consecutive_errors from sources where id=$1', [source.id]);

    expect(result.rows[0]).toMatchObject({
      user_agent: 'ArgumentationsKette-Crawler/2.0',
      etag: '"old"',
      last_error: 'alter Fehler',
      consecutive_errors: 4,
    });
    expect(result.rows[0].last_success_at).not.toBeNull();
  });

  it('serializes concurrent partial updates so unrelated fields are not lost', async () => {
    const source = await preparedSource();

    await Promise.all([
      updateSource(source.id, { name: `${source.name}-parallel` }),
      updateSource(source.id, { category: 'Politik' }),
    ]);

    const result = await query<{ name: string; category: string | null }>(
      'select name,category from sources where id=$1',
      [source.id],
    );
    expect(result.rows[0]).toEqual({ name: `${source.name}-parallel`, category: 'Politik' });
  });

  it('resets validators and health state when the URL changes and supports explicit user-agent removal', async () => {
    const source = await preparedSource();

    await updateSource(source.id, { url: 'https://example.net/new-feed.xml' });

    const changed = await query<{
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

    expect(changed.rows[0]).toEqual({
      url: 'https://example.net/new-feed.xml',
      user_agent: 'ArgumentationsKette-Crawler/2.0',
      etag: null,
      last_modified: null,
      last_success_at: null,
      last_error: null,
      consecutive_errors: 0,
    });

    await updateSource(source.id, { userAgent: '' });
    const cleared = await query<{ user_agent: string | null }>('select user_agent from sources where id=$1', [source.id]);
    expect(cleared.rows[0].user_agent).toBeNull();
  });
});
