import type { FastifyInstance, FastifyReply, FastifyRequest } from 'fastify';
import { z } from 'zod';
import { parseFeed, parseHtmlArticle } from '@ans/news-parser';
import { createSource, getAutopilotConfig, recordSourceCheck } from '@ans/database';
import { getApprovedArticleVisuals } from '@ans/database/article-media';
import { redactOperationalText } from '@ans/database/notifications';
import { updateSourceState } from '@ans/database/source-updates';
import { assertPublicHttpUrl } from '@ans/security';
import { fetchHttpText, isAllowedLocalStudioTestUrl } from '@ans/source-connectors';
import { installArticleVisualResolver } from '../../../packages/obs-controller/src/article-visual-resolver.js';
import { installApiCorsGuard, type ApiOriginPolicy } from './cors-policy.js';
import { installStudioProfileHooks } from './studio-profile-hooks.js';

export type SourceUrlValidator = (rawUrl: string, allowPrivate?: boolean) => Promise<unknown>;
export type SourceValidationAuthorizer = (req: FastifyRequest) => boolean;
export type SourceCheckRecorder = (sourceId: string | null, status: string, details: unknown) => Promise<unknown>;
export type SourceCreator = (input: Record<string, unknown>) => Promise<unknown>;
export type SourceUpdater = (id: string, input: Record<string, unknown>) => Promise<unknown>;

export interface SourceUrlPolicy {
  allowPrivate: boolean;
  allowPrivateUrl(url: URL): boolean;
  validateStoredSourceUrl(rawUrl: string): Promise<void>;
}

export interface SourceTestInput {
  url: string;
  maxFetchSeconds?: number;
}

export interface SourceTestResult {
  detected: 'feed' | 'website';
  status: number;
  finalUrl: string;
  preview: unknown[];
  etag?: string;
  lastModified?: string;
  paywallSuspected: boolean;
  javascriptLikely: boolean;
  durationMs: number;
}

export type SourceTester = (input: SourceTestInput) => Promise<SourceTestResult>;

export interface SourceTestDependencies {
  fetchText?: typeof fetchHttpText;
  recordCheck?: SourceCheckRecorder;
  now?: () => number;
  userAgent?: string;
}

export interface SourceUrlHookOptions {
  policy?: SourceUrlPolicy;
  canValidate?: SourceValidationAuthorizer;
  createSource?: SourceCreator;
  updateSource?: SourceUpdater;
  testSource?: SourceTester;
  corsPolicy?: ApiOriginPolicy;
}

export class SourceTestValidationError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'SourceTestValidationError';
  }
}

const sourceCreateSchema = z.object({
  name: z.string().min(1),
  url: z.string().url(),
  type: z.enum(['rss', 'atom', 'feed', 'website']).default('rss'),
  category: z.string().optional().nullable(),
  region: z.string().optional().nullable(),
  language: z.string().default('de'),
  description: z.string().optional().nullable(),
  priority: z.number().int().default(0),
  trustLevel: z.number().int().min(0).max(100).default(50),
  fetchIntervalSeconds: z.number().int().min(60).max(86400).default(900),
  maxArticles: z.number().int().min(1).max(100).default(20),
  maxFetchSeconds: z.number().int().min(1).max(60).default(20),
  active: z.boolean().default(true),
  userAgent: z.string().optional().nullable(),
});
// Keep update fields optional without inheriting the create-time defaults.
// Zod applies defaults nested inside `partial()`, which would otherwise reset
// every omitted setting whenever a source is edited.
const sourceUpdateSchema = z
  .object({
    name: z.string().min(1).optional(),
    url: z.string().url().optional(),
    type: z.enum(['rss', 'atom', 'feed', 'website']).optional(),
    category: z.string().optional().nullable(),
    region: z.string().optional().nullable(),
    language: z.string().optional(),
    description: z.string().optional().nullable(),
    priority: z.number().int().optional(),
    trustLevel: z.number().int().min(0).max(100).optional(),
    fetchIntervalSeconds: z.number().int().min(60).max(86400).optional(),
    maxArticles: z.number().int().min(1).max(100).optional(),
    maxFetchSeconds: z.number().int().min(1).max(60).optional(),
    active: z.boolean().optional(),
    userAgent: z.string().optional().nullable(),
  })
  .strict();

const sourceTestSchema = z.object({
  url: z.string().url(),
  maxFetchSeconds: z.coerce.number().int().min(1).max(60).optional(),
});

export function createSourceUrlPolicy(
  env: NodeJS.ProcessEnv = process.env,
  validator: SourceUrlValidator = assertPublicHttpUrl,
): SourceUrlPolicy {
  const allowPrivate = env.ALLOW_PRIVATE_SOURCES === 'true';
  const appPort = env.APP_PORT ?? 12000;
  const allowPrivateUrl = (url: URL) =>
    isAllowedLocalStudioTestUrl(url, {
      appPort,
      allowedPaths: ['/test-feed.xml'],
    });

  return {
    allowPrivate,
    allowPrivateUrl,
    async validateStoredSourceUrl(rawUrl: string) {
      const url = new URL(rawUrl);
      await validator(url.toString(), allowPrivate || allowPrivateUrl(url));
    },
  };
}

function safeOperationalText(value: unknown) {
  return redactOperationalText(value).slice(0, 1000);
}

async function bestEffortRecord(
  recordCheck: SourceCheckRecorder,
  status: 'ok' | 'error',
  details: Record<string, unknown>,
) {
  try {
    await recordCheck(null, status, details);
  } catch {}
}

export async function testSourceUrl(
  input: SourceTestInput,
  policy: SourceUrlPolicy,
  dependencies: SourceTestDependencies = {},
): Promise<SourceTestResult> {
  const fetchText = dependencies.fetchText ?? fetchHttpText;
  const recordCheck = dependencies.recordCheck ?? recordSourceCheck;
  const now = dependencies.now ?? Date.now;
  const startedAt = now();
  const safeUrl = safeOperationalText(input.url);

  try {
    try {
      await policy.validateStoredSourceUrl(input.url);
    } catch (error) {
      throw new SourceTestValidationError(safeOperationalText(error instanceof Error ? error.message : error));
    }

    const response = await fetchText(input.url, {
      timeoutMs: (input.maxFetchSeconds ?? 10) * 1000,
      maxBytes: 512 * 1024,
      allowPrivate: policy.allowPrivate,
      allowPrivateUrl: policy.allowPrivateUrl,
      userAgent: dependencies.userAgent ?? process.env.NEWS_USER_AGENT,
    });
    const detected =
      response.contentType.includes('xml') || /<(rss|feed)\b/i.test(response.body.slice(0, 300)) ? 'feed' : 'website';
    const preview =
      detected === 'feed'
        ? parseFeed(response.body, response.url).slice(0, 5)
        : [parseHtmlArticle(response.body, response.url)];
    const durationMs = Math.max(0, now() - startedAt);

    await bestEffortRecord(recordCheck, 'ok', {
      url: safeUrl,
      detected,
      status: response.status,
      finalUrl: safeOperationalText(response.url),
      durationMs,
      manual: true,
    });

    return {
      detected,
      status: response.status,
      finalUrl: response.url,
      preview,
      etag: response.etag,
      lastModified: response.lastModified,
      paywallSuspected: /paywall|subscribe|abo/i.test(response.body),
      javascriptLikely: /__NEXT_DATA__|window\.__|app-root/i.test(response.body),
      durationMs,
    };
  } catch (error) {
    const message = safeOperationalText(error instanceof Error ? error.message : error) || 'Quellentest fehlgeschlagen';
    await bestEffortRecord(recordCheck, 'error', {
      url: safeUrl,
      error: message,
      durationMs: Math.max(0, now() - startedAt),
      manual: true,
    });
    if (error instanceof SourceTestValidationError) throw error;
    throw new Error(message);
  }
}

function sourceRoute(req: FastifyRequest) {
  const path = req.url.split('?', 1)[0];
  if (req.method === 'POST' && path === '/api/sources') return 'create';
  if (req.method === 'POST' && path === '/api/sources/test') return 'test';
  if (req.method === 'PUT' && /^\/api\/sources\/[^/]+$/.test(path)) return 'update';
  return null;
}

function hasSourceWritePermission(req: FastifyRequest) {
  return Boolean(req.user && (req.user.role === 'administrator' || req.user.permissions.includes('sources:write')));
}

function invalidInputResponse(reply: FastifyReply, message: string, issues: unknown = []) {
  return reply.code(400).send({ error: message, issues });
}

function requestBody(req: FastifyRequest) {
  return req.body && typeof req.body === 'object' && !Array.isArray(req.body)
    ? (req.body as Record<string, unknown>)
    : null;
}

export function installSourceUrlValidationHook(app: FastifyInstance, options: SourceUrlHookOptions = {}) {
  const policy = options.policy ?? createSourceUrlPolicy();
  const canValidate = options.canValidate ?? hasSourceWritePermission;
  const persistSource = options.createSource ?? createSource;
  const persistUpdate = options.updateSource ?? updateSourceState;
  const testSource = options.testSource ?? ((input) => testSourceUrl(input, policy));

  installApiCorsGuard(app, options.corsPolicy);
  installStudioProfileHooks(app);
  installArticleVisualResolver(async (articleId) => ({
    ...(await getApprovedArticleVisuals(articleId)),
    videoRequired: (await getAutopilotConfig()).requireVideo,
  }));

  app.addHook('preHandler', async (req, reply) => {
    const route = sourceRoute(req);
    if (!canValidate(req) || !route) return;

    const body = requestBody(req);
    if (!body) {
      if (route === 'test') return invalidInputResponse(reply, 'Ungültige Angaben für den Quellentest');
      return invalidInputResponse(reply, 'Ungültige Angaben für die Quelle');
    }

    if (route === 'create') {
      const parsed = sourceCreateSchema.safeParse(body);
      if (!parsed.success) {
        return invalidInputResponse(reply, 'Ungültige Angaben für die Quelle', parsed.error.issues);
      }
      try {
        await policy.validateStoredSourceUrl(parsed.data.url);
      } catch (error) {
        reply.code(400);
        throw error;
      }
      return reply.send(await persistSource(parsed.data));
    }

    if (route === 'test') {
      const parsed = sourceTestSchema.safeParse(body);
      if (!parsed.success) {
        return invalidInputResponse(reply, 'Ungültige Angaben für den Quellentest', parsed.error.issues);
      }
      try {
        return reply.send(await testSource(parsed.data));
      } catch (error) {
        if (error instanceof SourceTestValidationError) reply.code(400);
        else if (/timeout/i.test(error instanceof Error ? error.message : String(error))) reply.code(504);
        else reply.code(502);
        throw error;
      }
    }

    const parsed = sourceUpdateSchema.safeParse(body);
    if (!parsed.success) {
      return invalidInputResponse(reply, 'Ungültige Angaben für die Quelle', parsed.error.issues);
    }
    if (parsed.data.url) {
      try {
        await policy.validateStoredSourceUrl(parsed.data.url);
      } catch (error) {
        reply.code(400);
        throw error;
      }
    }
    const id = z
      .string()
      .uuid()
      .safeParse((req.params as { id?: unknown }).id);
    if (!id.success) {
      // Keep legacy handlers usable in isolated route tests and let the concrete
      // route/database layer decide how to report malformed identifiers.
      if (Object.hasOwn(body, 'userAgent') && body.userAgent === null) body.userAgent = '';
      return;
    }
    try {
      return reply.send(await persistUpdate(id.data, parsed.data));
    } catch (error) {
      if (error instanceof Error && error.message === 'Quelle nicht gefunden') reply.code(404);
      throw error;
    }
  });
}
