import type { FastifyInstance, FastifyRequest } from 'fastify';
import { z } from 'zod';

const uuidParamNames = new Set(['id', 'itemId', 'candidateId']);
const uuidSchema = z.string().uuid();

export function validateUuidRouteParams(req: Pick<FastifyRequest, 'params'>) {
  if (!req.params || typeof req.params !== 'object') return;
  for (const [name, value] of Object.entries(req.params)) {
    if (uuidParamNames.has(name)) uuidSchema.parse(value);
  }
}

export function installUuidRouteParamValidation(app: FastifyInstance) {
  app.addHook('preValidation', async (req) => validateUuidRouteParams(req));
}
