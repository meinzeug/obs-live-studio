import type { FastifyInstance, FastifyRequest } from 'fastify';

const CORS_RESPONSE_HEADERS = [
  'access-control-allow-origin',
  'access-control-allow-credentials',
  'access-control-allow-methods',
  'access-control-allow-headers',
  'access-control-expose-headers',
] as const;

export interface ApiOriginPolicy {
  allowedOrigins: ReadonlySet<string>;
  allows(origin: string | undefined): boolean;
}

function normalizedOrigin(value: string | undefined) {
  if (!value) return null;
  try {
    const url = new URL(value.trim());
    if (url.protocol !== 'http:' && url.protocol !== 'https:') return null;
    return url.origin;
  } catch {
    return null;
  }
}

function configuredOrigins(env: NodeJS.ProcessEnv) {
  return [env.APP_URL, env.PUBLIC_APP_URL, ...(env.CORS_ALLOWED_ORIGINS ?? '').split(',')]
    .map((value) => normalizedOrigin(value))
    .filter((value): value is string => Boolean(value));
}

export function createApiOriginPolicy(env: NodeJS.ProcessEnv = process.env): ApiOriginPolicy {
  const allowedOrigins = new Set(configuredOrigins(env));
  const appPort = String(env.APP_PORT ?? 12000);

  for (const host of ['127.0.0.1', 'localhost', '[::1]']) {
    allowedOrigins.add(`http://${host}:${appPort}`);
  }
  if (env.NODE_ENV !== 'production') {
    for (const host of ['127.0.0.1', 'localhost', '[::1]']) {
      allowedOrigins.add(`http://${host}:5173`);
    }
  }

  return {
    allowedOrigins,
    allows(origin) {
      const normalized = normalizedOrigin(origin);
      return normalized !== null && allowedOrigins.has(normalized);
    },
  };
}

function isApiRequest(req: FastifyRequest) {
  return req.url.split('?', 1)[0].startsWith('/api/');
}

export function installApiCorsGuard(app: FastifyInstance, policy: ApiOriginPolicy = createApiOriginPolicy()) {
  app.addHook('onSend', async (req, reply, payload) => {
    const origin = typeof req.headers.origin === 'string' ? req.headers.origin : undefined;
    if (!origin || !isApiRequest(req) || policy.allows(origin)) return payload;

    for (const header of CORS_RESPONSE_HEADERS) reply.removeHeader(header);
    return payload;
  });
}
