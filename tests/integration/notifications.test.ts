import { randomUUID } from 'node:crypto';
import { beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { createSource, query } from '../../packages/database/src/index.js';
import { createUser, ensureAuthDefaults } from '../../packages/database/src/auth.js';
import {
  listOperationalNotifications,
  markOperationalNotificationRead,
  queueSourceFetch,
  resolveOperationalNotification,
  unreadOperationalNotificationCount,
  upsertOperationalNotification,
} from '../../packages/database/src/notifications.js';

const integration = process.env.VITEST_INCLUDE_INTEGRATION === 'true' ? describe : describe.skip;

integration('operational notifications', () => {
  beforeAll(async () => {
    await ensureAuthDefaults();
  });

  beforeEach(async () => {
    await query('delete from notification_reads');
    await query('delete from notifications');
    await query("delete from worker_jobs where kind='fetch-source'");
    await query("delete from sources where name like 'Notification test %'");
    await query("delete from users where email like 'notification-test-%@example.invalid'");
  });

  it('deduplicates incidents and keeps read state user scoped', async () => {
    const suffix = randomUUID();
    const firstUser = await createUser({
      email: `notification-test-a-${suffix}@example.invalid`,
      displayName: 'Notification A',
      passwordHash: 'unused',
      role: 'redaktion',
    });
    const secondUser = await createUser({
      email: `notification-test-b-${suffix}@example.invalid`,
      displayName: 'Notification B',
      passwordHash: 'unused',
      role: 'nur_lesen',
    });

    const first = await upsertOperationalNotification({
      level: 'warning',
      component: 'source-ingest',
      dedupeKey: 'source:test:fetch',
      message: 'Quelle konnte nicht abgerufen werden.',
      details: { consecutiveErrors: 1 },
    });
    const repeated = await upsertOperationalNotification({
      level: 'error',
      component: 'source-ingest',
      dedupeKey: 'source:test:fetch',
      message: 'Quelle ist weiterhin nicht erreichbar.',
      details: { consecutiveErrors: 2 },
    });

    expect(repeated.id).toBe(first.id);
    expect(repeated.occurrences).toBe(2);
    expect(repeated.level).toBe('error');
    expect(await unreadOperationalNotificationCount(firstUser.id)).toBe(1);
    expect(await unreadOperationalNotificationCount(secondUser.id)).toBe(1);

    await markOperationalNotificationRead(first.id, firstUser.id);
    expect(await unreadOperationalNotificationCount(firstUser.id)).toBe(0);
    expect(await unreadOperationalNotificationCount(secondUser.id)).toBe(1);

    const firstUserItems = await listOperationalNotifications(firstUser.id);
    const secondUserItems = await listOperationalNotifications(secondUser.id);
    expect(firstUserItems[0].user_read_at).toBeTruthy();
    expect(secondUserItems[0].user_read_at).toBeNull();

    const recurrence = await upsertOperationalNotification({
      level: 'error',
      component: 'source-ingest',
      dedupeKey: 'source:test:fetch',
      message: 'Quelle ist erneut ausgefallen.',
      details: { consecutiveErrors: 3 },
    });
    expect(recurrence.id).toBe(first.id);
    expect(recurrence.occurrences).toBe(3);
    expect(await unreadOperationalNotificationCount(firstUser.id)).toBe(1);
    expect(await unreadOperationalNotificationCount(secondUser.id)).toBe(1);

    await resolveOperationalNotification('source:test:fetch');
    expect(await listOperationalNotifications(firstUser.id)).toEqual([]);
    const history = await listOperationalNotifications(firstUser.id, { includeResolved: true });
    expect(history).toHaveLength(1);
    expect(history[0].resolved_at).toBeTruthy();
  });

  it('queues a manual source refresh only once while a job is open', async () => {
    const source = await createSource({
      name: `Notification test ${randomUUID()}`,
      url: `https://example.invalid/${randomUUID()}.xml`,
      type: 'rss',
      active: true,
    });

    const first = await queueSourceFetch(source.id);
    const repeated = await queueSourceFetch(source.id);

    expect(first.queued).toBe(true);
    expect(first.alreadyQueued).toBe(false);
    expect(repeated.queued).toBe(false);
    expect(repeated.alreadyQueued).toBe(true);
    const jobs = await query<{ count: string }>(
      "select count(*)::text count from worker_jobs where kind='fetch-source' and payload->>'sourceId'=$1 and status in ('queued','running')",
      [source.id],
    );
    expect(Number(jobs.rows[0].count)).toBe(1);
  });
});
