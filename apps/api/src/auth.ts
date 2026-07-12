import type { FastifyInstance, FastifyReply, FastifyRequest } from 'fastify';
import {
  createSecret,
  hashPassword,
  isWriteMethod,
  safeEqual,
  verifyPassword,
  type RoleName,
  type WritePermission,
} from '@ans/security/auth';
import {
  auditLog,
  createSession,
  createUser,
  deleteSession,
  ensureAuthDefaults,
  getAuthUser,
  getUserForLogin,
  listUsers,
  needsInitialAdmin,
  pruneSessions,
  recentLoginFailures,
  recordLoginFailure,
  resetUserPassword,
  revokeUserSessions,
  setUserActive,
  updateUserRole,
} from '@ans/database/auth';
import { createHash } from 'node:crypto';
import { z } from 'zod';

declare module 'fastify' {
  interface FastifyRequest {
    user?: Awaited<ReturnType<typeof getAuthUser>>;
    sessionId?: string;
    csrfToken?: string;
  }
}
const COOKIE = 'ans_session';
const ttl = 60 * 60 * 12;
function secureCookie() {
  return process.env.NODE_ENV === 'production' || process.env.COOKIE_SECURE === 'true';
}
function hashSessionId(id: string) {
  return createHash('sha256').update(id).digest('hex');
}
function setCookie(reply: FastifyReply, id: string) {
  reply.setCookie(COOKIE, id, { path: '/', httpOnly: true, sameSite: 'lax', secure: secureCookie(), maxAge: ttl });
}
function clearCookie(reply: FastifyReply) {
  reply.clearCookie(COOKIE, { path: '/', httpOnly: true, sameSite: 'lax', secure: secureCookie() });
}
async function issueSession(reply: FastifyReply, userId: string) {
  const raw = createSecret();
  const csrf = createSecret();
  const session = await createSession(userId, csrf, ttl);
  await import('@ans/database').then((db) =>
    db.query('update sessions set token_hash=$2 where id=$1', [session.id, hashSessionId(raw)]),
  );
  setCookie(reply, raw);
  return { csrf, sessionId: session.id };
}
async function lookupSession(raw: string) {
  const tokenHash = hashSessionId(raw);
  const byHash = (
    await import('@ans/database').then((db) =>
      db.query<any>('select * from sessions where token_hash=$1 and expires_at>now()', [tokenHash]),
    )
  ).rows[0];
  if (byHash) return byHash;
  return null;
}
export async function registerAuth(app: FastifyInstance) {
  await ensureAuthDefaults();
  await pruneSessions();
  app.addHook('preHandler', async (req, reply) => {
    const raw = req.cookies[COOKIE];
    if (raw) {
      const session = await lookupSession(raw);
      if (session) {
        const user = await getAuthUser(session.user_id);
        if (user?.active) {
          req.user = user;
          req.sessionId = session.id;
          req.csrfToken = session.csrf_token;
        }
      }
    }
    const authPublic =
      req.url.startsWith('/api/auth/session') ||
      req.url.startsWith('/api/auth/setup') ||
      req.url.startsWith('/api/auth/login') ||
      req.url.startsWith('/api/auth/setup-required');
    const publicRead =
      req.method === 'GET' &&
      (req.url === '/health' || req.url.startsWith('/api/overlay/') || req.url.startsWith('/overlay/'));
    if (req.url.startsWith('/api/') && !authPublic && !publicRead && !req.user) {
      reply.code(401);
      throw new Error('Anmeldung erforderlich');
    }
    if (
      isWriteMethod(req.method) &&
      req.url.startsWith('/api/') &&
      !req.url.startsWith('/api/auth/login') &&
      !req.url.startsWith('/api/auth/setup')
    ) {
      if (!req.user) {
        reply.code(401);
        throw new Error('Anmeldung erforderlich');
      }
      const token = req.headers['x-csrf-token'];
      if (typeof token !== 'string' || !req.csrfToken || !safeEqual(token, req.csrfToken)) {
        reply.code(403);
        throw new Error('CSRF-Token fehlt oder ist ungültig');
      }
    }
  });
  app.get('/api/auth/setup-required', async () => ({ required: await needsInitialAdmin() }));
  app.post('/api/auth/setup', async (req, reply) => {
    if (!(await needsInitialAdmin())) {
      reply.code(409);
      throw new Error('Erstadministrator existiert bereits');
    }
    const body = z
      .object({ email: z.string().email(), displayName: z.string().min(1), password: z.string().min(12) })
      .parse(req.body);
    const user = await createUser({
      email: body.email,
      displayName: body.displayName,
      passwordHash: await hashPassword(body.password),
      role: 'administrator',
    });
    const session = await issueSession(reply, user.id);
    await auditLog(user.id, 'auth.setup', 'user', user.id);
    return {
      user: {
        ...user,
        permissions: ['sources:write', 'articles:write', 'broadcast:write', 'obs:write', 'users:write'],
      },
      csrfToken: session.csrf,
    };
  });
  app.post('/api/auth/login', async (req, reply) => {
    const body = z.object({ email: z.string().email(), password: z.string().min(1) }).parse(req.body);
    const ip = req.ip;
    if ((await recentLoginFailures(body.email, ip)) > 8) {
      reply.code(429);
      throw new Error('Zu viele fehlgeschlagene Anmeldungen');
    }
    const user = await getUserForLogin(body.email);
    if (!user?.active || !(await verifyPassword(user.password_hash, body.password))) {
      await recordLoginFailure(body.email, ip, 'bad_credentials');
      reply.code(401);
      throw new Error('E-Mail oder Passwort ist falsch');
    }
    const session = await issueSession(reply, user.id);
    await auditLog(user.id, 'auth.login', 'user', user.id, { ip });
    return { user: await getAuthUser(user.id), csrfToken: session.csrf };
  });
  app.post('/api/auth/logout', async (req, reply) => {
    if (req.sessionId) await deleteSession(req.sessionId);
    await auditLog(req.user?.id ?? null, 'auth.logout', 'session', req.sessionId);
    clearCookie(reply);
    return { ok: true };
  });
  app.get('/api/auth/session', async (req) => ({
    authenticated: Boolean(req.user),
    user: req.user ?? null,
    csrfToken: req.csrfToken ?? null,
    setupRequired: await needsInitialAdmin(),
  }));
  app.get('/api/auth/users', async (req, reply) => {
    requirePermission(req, reply, 'users:write');
    return listUsers();
  });
  app.post('/api/auth/users', async (req, reply) => {
    requirePermission(req, reply, 'users:write');
    const b = z
      .object({
        email: z.string().email(),
        displayName: z.string().min(1),
        password: z.string().min(12),
        role: z.enum(['administrator', 'redaktion', 'nur_lesen']),
      })
      .parse(req.body);
    const u = await createUser({
      email: b.email,
      displayName: b.displayName,
      passwordHash: await hashPassword(b.password),
      role: b.role,
    });
    await auditLog(req.user!.id, 'user.create', 'user', u.id, { role: b.role });
    return u;
  });
  app.post('/api/auth/users/:id/role', async (req, reply) => {
    requirePermission(req, reply, 'users:write');
    const b = z.object({ role: z.enum(['administrator', 'redaktion', 'nur_lesen']) }).parse(req.body);
    const u = await updateUserRole((req.params as any).id, b.role);
    await auditLog(req.user!.id, 'user.role', 'user', u.id, { role: b.role });
    return u;
  });
  app.post('/api/auth/users/:id/active', async (req, reply) => {
    requirePermission(req, reply, 'users:write');
    const b = z.object({ active: z.boolean() }).parse(req.body);
    const u = await setUserActive((req.params as any).id, b.active);
    await auditLog(req.user!.id, 'user.active', 'user', u.id, { active: b.active });
    return u;
  });
  app.post('/api/auth/users/:id/password', async (req, reply) => {
    requirePermission(req, reply, 'users:write');
    const b = z.object({ password: z.string().min(12) }).parse(req.body);
    await resetUserPassword((req.params as any).id, await hashPassword(b.password));
    await auditLog(req.user!.id, 'user.password_reset', 'user', (req.params as any).id);
    return { ok: true };
  });
  app.post('/api/auth/users/:id/revoke-sessions', async (req, reply) => {
    requirePermission(req, reply, 'users:write');
    await revokeUserSessions((req.params as any).id);
    await auditLog(req.user!.id, 'user.sessions_revoked', 'user', (req.params as any).id);
    return { ok: true };
  });
}
export function requirePermission(req: FastifyRequest, reply: FastifyReply, permission: WritePermission) {
  if (!req.user) {
    reply.code(401);
    throw new Error('Anmeldung erforderlich');
  }
  if (req.user.role !== 'administrator' && !req.user.permissions.includes(permission)) {
    reply.code(403);
    throw new Error('Keine Berechtigung für diese Aktion');
  }
}
export function requireRole(req: FastifyRequest, reply: FastifyReply, roles: RoleName[]) {
  if (!req.user) {
    reply.code(401);
    throw new Error('Anmeldung erforderlich');
  }
  if (!roles.includes(req.user.role)) {
    reply.code(403);
    throw new Error('Rolle nicht berechtigt');
  }
}
