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
    if (url.username || url.password) return null;
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

function requestOrigin(req: FastifyRequest) {
  const value = req.headers.origin;
  if (typeof value === 'string') return { present: true, value };
  if (Array.isArray(value) && value.length === 1) return { present: true, value: value[0] };
  return { present: value !== undefined, value: undefined };
}

function removeCorsResponseHeaders(reply: Parameters<Parameters<FastifyInstance['addHook']>[1]>[1]) {
  for (const header of CORS_RESPONSE_HEADERS) reply.removeHeader(header);
}

export function installApiCorsGuard(app: FastifyInstance, policy: ApiOriginPolicy = createApiOriginPolicy()) {
  app.addHook('onRequest', async (req, reply) => {
    if (!isApiRequest(req)) return;
    const origin = requestOrigin(req);
    if (!origin.present || policy.allows(origin.value)) return;
    return reply.code(403).send({ error: 'Browser-Origin ist für API-Zugriffe nicht freigegeben' });
  });

  app.addHook('onSend', async (req, reply, payload) => {
    if (!isApiRequest(req)) return payload;
    const origin = requestOrigin(req);
    if (!origin.present || policy.allows(origin.value)) return payload;
    removeCorsResponseHeaders(reply);
    return payload;
  });
}
