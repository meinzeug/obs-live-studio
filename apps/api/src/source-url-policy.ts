import type { FastifyInstance, FastifyRequest } from 'fastify';
import { assertPublicHttpUrl } from '@ans/security';
import { isAllowedLocalStudioTestUrl } from '@ans/source-connectors';

export type SourceUrlValidator = (rawUrl: string, allowPrivate?: boolean) => Promise<unknown>;

export interface SourceUrlPolicy {
  allowPrivate: boolean;
  validateStoredSourceUrl(rawUrl: string): Promise<void>;
}

export interface SourceUrlHookOptions {
  policy?: SourceUrlPolicy;
}

export function createSourceUrlPolicy(
  env: NodeJS.ProcessEnv = process.env,
  validator: SourceUrlValidator = assertPublicHttpUrl,
): SourceUrlPolicy {
  const allowPrivate = env.ALLOW_PRIVATE_SOURCES === 'true';
  const appPort = env.APP_PORT ?? 12000;
  const allowLocalTestFeed = (url: string | URL) =>
    isAllowedLocalStudioTestUrl(url, {
      appPort,
      allowedPaths: ['/test-feed.xml'],
    });

  return {
    allowPrivate,
    async validateStoredSourceUrl(rawUrl: string) {
      await validator(rawUrl, allowPrivate || allowLocalTestFeed(rawUrl));
    },
  };
}

function sourceUpdateId(req: FastifyRequest) {
  if (req.method !== 'PUT') return null;
  const path = req.url.split('?', 1)[0];
  const match = /^\/api\/sources\/([^/]+)$/.exec(path);
  return match?.[1] ?? null;
}

export function installSourceUrlValidationHook(app: FastifyInstance, options: SourceUrlHookOptions = {}) {
  const policy = options.policy ?? createSourceUrlPolicy();

  app.addHook('preHandler', async (req, reply) => {
    if (!sourceUpdateId(req) || !req.body || typeof req.body !== 'object' || Array.isArray(req.body)) return;

    const body = req.body as Record<string, unknown>;
    if (Object.hasOwn(body, 'url') && typeof body.url === 'string') {
      try {
        await policy.validateStoredSourceUrl(body.url);
      } catch (error) {
        reply.code(400);
        throw error;
      }
    }
    if (Object.hasOwn(body, 'userAgent') && body.userAgent === null) {
      body.userAgent = '';
    }
  });
}
