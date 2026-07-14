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
  getSessionByTokenHash,
  getUserForLogin,
  listUsers,
  listActiveSessions,
  listAuditLogs,
  needsInitialAdmin,
  pruneSessions,
  recentLoginFailures,
  recordLoginFailure,
  resetUserPassword,
  revokeUserSessions,
  revokeAllOtherSessions,
  revokeOtherUserSessions,
  setUserActive,
  updateUserRole,
} from '@ans/database/auth';
import { createHash } from 'node:crypto';
import { z } from 'zod';
import { registerOperationsRoutes } from './operations-routes.js';

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
async function issueSession(req: FastifyRequest, reply: FastifyReply, userId: string) {
  const raw = createSecret();
  const csrf = createSecret();
  const session = await createSession({
    userId,
    csrfToken: csrf,
    tokenHash: hashSessionId(raw),
    ttlSeconds: ttl,
    userAgent: req.headers['user-agent'],
    ipAddress: req.ip,
  });
  setCookie(reply, raw);
  return { csrf, sessionId: session.id };
}
async function lookupSession(raw: string) {
  return getSessionByTokenHash(hashSessionId(raw));
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
    const session = await issueSession(req, reply, user.id);
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
    const session = await issueSession(req, reply, user.id);
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
  app.get('/api/auth/audit', async (req, reply) => {
    requirePermission(req, reply, 'users:write');
    const query = z.object({ q: z.string().optional(), limit: z.coerce.number().int().optional() }).parse(req.query);
    return listAuditLogs(query.q ?? '', query.limit ?? 200);
  });
  app.get('/api/auth/sessions', async (req, reply) => {
    requirePermission(req, reply, 'users:write');
    const sessions = await listActiveSessions();
    return sessions.map((session) => ({
      id: session.id,
      user_id: session.user_id,
      email: session.email,
      display_name: session.display_name,
      user_agent: session.user_agent,
      ip_address: session.ip_address,
      expires_at: session.expires_at,
      created_at: session.created_at,
      current: session.id === req.sessionId,
    }));
  });
  app.delete('/api/auth/sessions/mine', async (req, reply) => {
    if (!req.sessionId || !req.user) return reply.code(409).send({ ok: false, error: 'Aktuelle Sitzung fehlt' });
    const result = await revokeOtherUserSessions(req.user.id, req.sessionId);
    await auditLog(req.user.id, 'session.revoke_own_others', 'session', req.sessionId, { count: result.rowCount });
    return { ok: true, count: result.rowCount };
  });
  app.delete('/api/auth/sessions/:id', async (req, reply) => {
    requirePermission(req, reply, 'users:write');
    const id = z
      .string()
      .uuid()
      .parse((req.params as any).id);
    const result = await deleteSession(id);
    if (!result.rowCount) return reply.code(404).send({ ok: false, error: 'Sitzung nicht gefunden' });
    await auditLog(req.user!.id, 'session.revoke', 'session', id);
    if (id === req.sessionId) clearCookie(reply);
    return { ok: true };
  });
  app.delete('/api/auth/sessions', async (req, reply) => {
    requirePermission(req, reply, 'users:write');
    if (!req.sessionId) return reply.code(409).send({ ok: false, error: 'Aktuelle Sitzung fehlt' });
    const result = await revokeAllOtherSessions(req.sessionId);
    await auditLog(req.user!.id, 'session.revoke_all_others', 'session', req.sessionId, { count: result.rowCount });
    return { ok: true, count: result.rowCount };
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
    let u;
    try {
      u = await updateUserRole((req.params as any).id, b.role);
    } catch (error) {
      if (error instanceof Error && error.message.startsWith('Der letzte aktive Administrator')) {
        return reply.code(409).send({ ok: false, error: error.message });
      }
      throw error;
    }
    await auditLog(req.user!.id, 'user.role', 'user', u.id, { role: b.role });
    return u;
  });
  app.post('/api/auth/users/:id/active', async (req, reply) => {
    requirePermission(req, reply, 'users:write');
    const b = z.object({ active: z.boolean() }).parse(req.body);
    let u;
    try {
      u = await setUserActive((req.params as any).id, b.active);
    } catch (error) {
      if (error instanceof Error && error.message.startsWith('Der letzte aktive Administrator')) {
        return reply.code(409).send({ ok: false, error: error.message });
      }
      throw error;
    }
    await auditLog(req.user!.id, 'user.active', 'user', u.id, { active: b.active });
    return u;
  });
  app.post('/api/auth/users/:id/password', async (req, reply) => {
    requirePermission(req, reply, 'users:write');
    const b = z.object({ password: z.string().min(12) }).parse(req.body);
    await resetUserPassword((req.params as any).id, await hashPassword(b.password));
    await revokeUserSessions((req.params as any).id);
    await auditLog(req.user!.id, 'user.password_reset', 'user', (req.params as any).id);
    return { ok: true };
  });
  app.post('/api/auth/users/:id/revoke-sessions', async (req, reply) => {
    requirePermission(req, reply, 'users:write');
    await revokeUserSessions((req.params as any).id);
    await auditLog(req.user!.id, 'user.sessions_revoked', 'user', (req.params as any).id);
    return { ok: true };
  });
  await registerOperationsRoutes(app, requirePermission);
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
