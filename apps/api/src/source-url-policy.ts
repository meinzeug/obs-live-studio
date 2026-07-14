import type { FastifyInstance, FastifyRequest } from 'fastify';
import { getSource } from '@ans/database';
import { assertPublicHttpUrl } from '@ans/security';
import { isAllowedLocalStudioTestUrl } from '@ans/source-connectors';

export type SourceUrlValidator = (rawUrl: string, allowPrivate?: boolean) => Promise<unknown>;
export type SourceLoader = (id: string) => Promise<{ user_agent?: string | null } | null>;

export interface SourceUrlPolicy {
  allowPrivate: boolean;
  validateStoredSourceUrl(rawUrl: string): Promise<void>;
}

export interface SourceUrlHookOptions {
  policy?: SourceUrlPolicy;
  loadSource?: SourceLoader;
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
  return match ? decodeURIComponent(match[1]) : null;
}

export function installSourceUrlValidationHook(app: FastifyInstance, options: SourceUrlHookOptions = {}) {
  const policy = options.policy ?? createSourceUrlPolicy();
  const loadSource = options.loadSource ?? getSource;

  app.addHook('preHandler', async (req) => {
    const sourceId = sourceUpdateId(req);
    if (!sourceId || !req.body || typeof req.body !== 'object' || Array.isArray(req.body)) return;

    const body = req.body as Record<string, unknown>;
    if (Object.hasOwn(body, 'url') && typeof body.url === 'string') {
      await policy.validateStoredSourceUrl(body.url);
    }

    if (!Object.hasOwn(body, 'userAgent')) {
      const current = await loadSource(sourceId);
      if (current) body.userAgent = current.user_agent ?? null;
    }
  });
}
