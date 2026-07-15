import type { FastifyInstance, FastifyReply, FastifyRequest } from 'fastify';
import { z } from 'zod';
import { auditLog } from '@ans/database/auth';
import {
  listOperationalNotifications,
  markAllOperationalNotificationsRead,
  markOperationalNotificationRead,
  queueSourceFetch,
  unreadOperationalNotificationCount,
} from '@ans/database/notifications';
import { getSourceHealth, listSourceHealth, summarizeSourceHealthOverview } from '@ans/database/source-health';
import type { WritePermission } from '@ans/security/auth';

function includeResolved(value: unknown) {
  return value === 'true' || value === true;
}

const healthQuerySchema = z.object({
  hours: z.coerce
    .number()
    .int()
    .min(1)
    .max(24 * 30)
    .optional(),
  limit: z.coerce.number().int().min(1).max(200).optional(),
});

export async function registerOperationsRoutes(
  app: FastifyInstance,
  requirePermission: (req: FastifyRequest, reply: FastifyReply, permission: WritePermission) => void,
) {
  app.get('/api/notifications', async (req) => {
    const query = z
      .object({
        limit: z.coerce.number().int().min(1).max(200).optional(),
        includeResolved: z.union([z.literal('true'), z.literal('false'), z.boolean()]).optional(),
      })
      .parse(req.query ?? {});
    const userId = req.user!.id;
    const [items, unreadCount] = await Promise.all([
      listOperationalNotifications(userId, {
        limit: query.limit ?? 100,
        includeResolved: includeResolved(query.includeResolved),
      }),
      unreadOperationalNotificationCount(userId),
    ]);
    return { items, unreadCount };
  });

  app.post('/api/notifications/read-all', async (req) => {
    const count = await markAllOperationalNotificationsRead(req.user!.id);
    await auditLog(req.user!.id, 'notification.read_all', 'notification', undefined, { count });
    return { ok: true, count };
  });

  app.post('/api/notifications/:id/read', async (req, reply) => {
    const id = z
      .string()
      .uuid()
      .parse((req.params as { id: string }).id);
    const result = await markOperationalNotificationRead(id, req.user!.id);
    if (!result) return reply.code(404).send({ ok: false, error: 'Benachrichtigung nicht gefunden' });
    await auditLog(req.user!.id, 'notification.read', 'notification', id);
    return { ok: true, id };
  });

  app.get('/api/sources/health', async (req) => {
    const query = healthQuerySchema.parse(req.query ?? {});
    const windowHours = query.hours ?? 24;
    const items = await listSourceHealth(windowHours);
    return {
      windowHours,
      overview: summarizeSourceHealthOverview(items),
      items,
    };
  });

  app.get('/api/sources/:id/health', async (req, reply) => {
    const sourceId = z
      .string()
      .uuid()
      .parse((req.params as { id: string }).id);
    const query = healthQuerySchema.parse(req.query ?? {});
    const detail = await getSourceHealth(sourceId, query.hours ?? 24, query.limit ?? 30);
    if (!detail) return reply.code(404).send({ ok: false, error: 'Quelle nicht gefunden' });
    return detail;
  });

  app.post('/api/sources/:id/refresh', async (req, reply) => {
    requirePermission(req, reply, 'sources:write');
    const sourceId = z
      .string()
      .uuid()
      .parse((req.params as { id: string }).id);
    const result = await queueSourceFetch(sourceId);
    if (!result.source) return reply.code(404).send({ ok: false, error: 'Quelle nicht gefunden' });
    await auditLog(req.user!.id, 'source.refresh_requested', 'source', sourceId, {
      queued: result.queued,
      alreadyQueued: result.alreadyQueued,
    });
    return {
      ok: true,
      source: result.source,
      queued: result.queued,
      alreadyQueued: result.alreadyQueued,
      message: result.queued ? 'Abruf wurde eingeplant.' : 'Für diese Quelle ist bereits ein Abruf eingeplant.',
    };
  });
}
