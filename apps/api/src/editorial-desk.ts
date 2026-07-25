import type { FastifyInstance, FastifyReply, FastifyRequest } from 'fastify';
import type { WritePermission } from '@ans/security/auth';
import {
  editorialDeskStatus,
  requestEditorialDeskCycle,
  updateEditorialDeskSettings,
} from '@ans/database/editorial-desk';
import { z } from 'zod';

type RequirePermission = (request: FastifyRequest, reply: FastifyReply, permission: WritePermission) => unknown;

const inputSchema = z
  .object({
    enabled: z.boolean().optional(),
    cycleIntervalMinutes: z.number().int().min(5).max(180).optional(),
    regionFocus: z.string().trim().min(2).max(120).optional(),
    maxStoriesPerCycle: z.number().int().min(3).max(50).optional(),
    minimumDistinctSources: z.number().int().min(1).max(20).optional(),
    createStaffAssignments: z.boolean().optional(),
    localFallbackEnabled: z.boolean().optional(),
  })
  .strict();

export function registerEditorialDeskRoutes(app: FastifyInstance, requirePermission: RequirePermission) {
  app.get('/api/editorial-desk', async (request, reply) => {
    requirePermission(request, reply, 'articles:write');
    return editorialDeskStatus();
  });
  app.patch('/api/editorial-desk', async (request, reply) => {
    requirePermission(request, reply, 'articles:write');
    await updateEditorialDeskSettings(inputSchema.parse(request.body ?? {}));
    return editorialDeskStatus();
  });
  app.post('/api/editorial-desk/run', async (request, reply) => {
    requirePermission(request, reply, 'articles:write');
    await requestEditorialDeskCycle();
    return { ok: true, message: 'Die nächste Redaktionsschicht wurde sofort angefordert.' };
  });
}
