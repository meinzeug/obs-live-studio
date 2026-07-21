import type { FastifyInstance, FastifyReply, FastifyRequest } from 'fastify';
import type { WritePermission } from '@ans/security/auth';
import {
  archiveBroadcastFormat,
  createBroadcastFormat,
  duplicateBroadcastFormat,
  getBroadcastFormat,
  listBroadcastFormats,
  updateBroadcastFormat,
  type BroadcastFormatRecord,
} from '@ans/database/broadcast-formats';
import { z } from 'zod';

const contentModeSchema = z.enum(['news', 'youtube', 'mixed', 'youtube-news-sidebar', 'youtube-context']);
const layoutSchema = z.enum(['main-news', 'youtube-video', 'youtube-news-sidebar', 'youtube-context', 'custom']);
const formatSettingsSchema = z
  .object({
    pauseSeconds: z.number().int().min(0).max(600).default(5),
    transition: z.enum(['clean', 'fade', 'headline', 'bumper']).default('fade'),
    repeatPolicy: z.enum(['none', 'recent-published', 'loop']).default('none'),
    sidebarRotationSeconds: z.number().int().min(3).max(120).default(12),
  })
  .partial()
  .default({});

export const broadcastFormatInputSchema = z
  .object({
    name: z.string().trim().min(2).max(160),
    description: z.string().trim().max(2000).optional().nullable(),
    contentMode: contentModeSchema.default('news'),
    layout: layoutSchema.default('main-news'),
    overlayProjectId: z.string().uuid().optional().nullable(),
    defaultDurationMinutes: z
      .number()
      .int()
      .min(1)
      .max(24 * 60)
      .default(30),
    defaultItemCount: z.number().int().min(1).max(100).default(8),
    color: z
      .string()
      .regex(/^#[0-9a-f]{6}$/i)
      .default('#5690ff'),
    icon: z.string().trim().min(1).max(40).default('clapperboard'),
    settings: formatSettingsSchema,
    active: z.boolean().default(true),
  })
  .strict();

type RequirePermission = (request: FastifyRequest, reply: FastifyReply, permission: WritePermission) => unknown;

function formatError(error: unknown): never {
  if (typeof error === 'object' && error && 'code' in error) {
    const code = String((error as { code?: unknown }).code ?? '');
    if (code === '23505')
      throw Object.assign(new Error('Ein aktives Sendeformat mit diesem Namen existiert bereits.'), {
        statusCode: 409,
      });
    if (code === '23503')
      throw Object.assign(new Error('Das gewählte Overlay-Projekt existiert nicht mehr.'), { statusCode: 409 });
  }
  throw error;
}

export function formatPlacementDefaults(
  format: BroadcastFormatRecord,
  input: {
    overlayProjectId?: string | null;
    settings?: Record<string, unknown>;
  },
) {
  const mode = format.content_mode;
  const settings = {
    ...(format.settings ?? {}),
    targetRuntimeMinutes: format.default_duration_minutes,
    defaultItemCount: format.default_item_count,
    ...(input.settings ?? {}),
    contentMode: mode,
    youtubeNewsSidebar: mode === 'youtube-news-sidebar',
    youtubeContext: mode === 'youtube-context',
  };
  return {
    formatId: format.id,
    overlayProjectId: input.overlayProjectId || format.overlay_project_id || null,
    settings,
  };
}

export async function resolveFormatPlacement(
  formatId: string | null | undefined,
  input: { overlayProjectId?: string | null; settings?: Record<string, unknown> },
) {
  if (!formatId) return { format: null, formatId: null, ...input };
  const format = await getBroadcastFormat(formatId);
  if (!format || !format.active)
    throw Object.assign(new Error('Das gewählte Sendeformat ist nicht verfügbar.'), { statusCode: 409 });
  return { format, ...formatPlacementDefaults(format, input) };
}

export function registerBroadcastFormatRoutes(app: FastifyInstance, requirePermission: RequirePermission) {
  app.get('/api/broadcast/formats', async (request) => {
    const query = z.object({ includeInactive: z.coerce.boolean().default(true) }).parse(request.query ?? {});
    return listBroadcastFormats(query);
  });

  app.get('/api/broadcast/formats/:id', async (request) => {
    const { id } = z.object({ id: z.string().uuid() }).parse(request.params);
    const format = await getBroadcastFormat(id);
    if (!format) throw Object.assign(new Error('Sendeformat nicht gefunden.'), { statusCode: 404 });
    return format;
  });

  app.post('/api/broadcast/formats', async (request, reply) => {
    requirePermission(request, reply, 'broadcast:write');
    try {
      return await createBroadcastFormat(broadcastFormatInputSchema.parse(request.body ?? {}));
    } catch (error) {
      return formatError(error);
    }
  });

  app.put('/api/broadcast/formats/:id', async (request, reply) => {
    requirePermission(request, reply, 'broadcast:write');
    const { id } = z.object({ id: z.string().uuid() }).parse(request.params);
    try {
      return await updateBroadcastFormat(id, broadcastFormatInputSchema.parse(request.body ?? {}));
    } catch (error) {
      return formatError(error);
    }
  });

  app.post('/api/broadcast/formats/:id/duplicate', async (request, reply) => {
    requirePermission(request, reply, 'broadcast:write');
    const { id } = z.object({ id: z.string().uuid() }).parse(request.params);
    const body = z.object({ name: z.string().trim().min(2).max(160).optional() }).parse(request.body ?? {});
    try {
      return await duplicateBroadcastFormat(id, body.name);
    } catch (error) {
      return formatError(error);
    }
  });

  app.delete('/api/broadcast/formats/:id', async (request, reply) => {
    requirePermission(request, reply, 'broadcast:write');
    const { id } = z.object({ id: z.string().uuid() }).parse(request.params);
    await archiveBroadcastFormat(id);
    return { ok: true };
  });
}
