import { randomUUID } from 'node:crypto';
import { beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { query } from '../../packages/database/src/index.js';
import {
  createSession,
  createUser,
  ensureAuthDefaults,
  getSessionByTokenHash,
  listActiveSessions,
  revokeAllOtherSessions,
  revokeOtherUserSessions,
} from '../../packages/database/src/auth.js';

const integration = process.env.VITEST_INCLUDE_INTEGRATION === 'true' ? describe : describe.skip;

function tokenHash() {
  return randomUUID().replaceAll('-', '').padEnd(64, '0');
}

integration('authentication sessions', () => {
  beforeAll(async () => {
    await ensureAuthDefaults();
  });

  beforeEach(async () => {
    await query(
      `delete from sessions where user_id in (
        select id from users where email like 'session-test-%@example.invalid'
      )`,
    );
    await query("delete from users where email like 'session-test-%@example.invalid'");
  });

  it('creates a complete token-bearing session atomically and exposes only safe administration fields', async () => {
    const suffix = randomUUID();
    const user = await createUser({
      email: `session-test-atomic-${suffix}@example.invalid`,
      displayName: 'Atomic Session',
      passwordHash: 'unused',
      role: 'administrator',
    });
    const hash = tokenHash();
    const session = await createSession({
      userId: user.id,
      csrfToken: 'csrf-token',
      tokenHash: hash,
      ttlSeconds: 3600,
      userAgent: `Test Browser ${'x'.repeat(600)}`,
      ipAddress: '127.0.0.1',
    });

    expect(session.token_hash).toBe(hash);
    expect(session.user_agent).toHaveLength(500);
    expect(session.ip_address).toBe('127.0.0.1');
    expect((await getSessionByTokenHash(hash))?.id).toBe(session.id);

    const visible = (await listActiveSessions()).find((item) => item.id === session.id);
    expect(visible).toMatchObject({
      id: session.id,
      user_id: user.id,
      user_agent: session.user_agent,
      ip_address: '127.0.0.1',
    });
    expect(visible).not.toHaveProperty('csrf_token');
    expect(visible).not.toHaveProperty('token_hash');
  });

  it('revokes only the current user’s other devices without affecting other users', async () => {
    const suffix = randomUUID();
    const firstUser = await createUser({
      email: `session-test-first-${suffix}@example.invalid`,
      displayName: 'First User',
      passwordHash: 'unused',
      role: 'administrator',
    });
    const secondUser = await createUser({
      email: `session-test-second-${suffix}@example.invalid`,
      displayName: 'Second User',
      passwordHash: 'unused',
      role: 'redaktion',
    });
    const current = await createSession({
      userId: firstUser.id,
      csrfToken: 'csrf-current',
      tokenHash: tokenHash(),
      ttlSeconds: 3600,
    });
    const firstOther = await createSession({
      userId: firstUser.id,
      csrfToken: 'csrf-other',
      tokenHash: tokenHash(),
      ttlSeconds: 3600,
    });
    const unrelated = await createSession({
      userId: secondUser.id,
      csrfToken: 'csrf-unrelated',
      tokenHash: tokenHash(),
      ttlSeconds: 3600,
    });

    const result = await revokeOtherUserSessions(firstUser.id, current.id);
    expect(result.rowCount).toBe(1);

    const remaining = await query<{ id: string }>(
      'select id from sessions where id=any($1::uuid[]) order by id',
      [[current.id, firstOther.id, unrelated.id]],
    );
    expect(remaining.rows.map((row) => row.id).sort()).toEqual([current.id, unrelated.id].sort());
  });

  it('keeps the explicit administrator emergency action global', async () => {
    const suffix = randomUUID();
    const firstUser = await createUser({
      email: `session-test-global-a-${suffix}@example.invalid`,
      displayName: 'Global A',
      passwordHash: 'unused',
      role: 'administrator',
    });
    const secondUser = await createUser({
      email: `session-test-global-b-${suffix}@example.invalid`,
      displayName: 'Global B',
      passwordHash: 'unused',
      role: 'redaktion',
    });
    const current = await createSession({
      userId: firstUser.id,
      csrfToken: 'csrf-current',
      tokenHash: tokenHash(),
      ttlSeconds: 3600,
    });
    await createSession({
      userId: firstUser.id,
      csrfToken: 'csrf-first-other',
      tokenHash: tokenHash(),
      ttlSeconds: 3600,
    });
    await createSession({
      userId: secondUser.id,
      csrfToken: 'csrf-second',
      tokenHash: tokenHash(),
      ttlSeconds: 3600,
    });

    const result = await revokeAllOtherSessions(current.id);
    expect(result.rowCount).toBe(2);
    const remaining = await query<{ id: string }>(
      'select id from sessions where user_id=any($1::uuid[]) order by id',
      [[firstUser.id, secondUser.id]],
    );
    expect(remaining.rows).toEqual([{ id: current.id }]);
  });
});
