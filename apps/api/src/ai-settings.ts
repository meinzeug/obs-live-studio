import type { FastifyInstance, FastifyReply, FastifyRequest } from 'fastify';
import type { WritePermission } from '@ans/security/auth';
import { chmod, readFile, rename, writeFile } from 'node:fs/promises';
import { randomUUID } from 'node:crypto';
import { resolve } from 'node:path';
import dotenv from 'dotenv';
import { z } from 'zod';
import { AI_TASK_POLICIES, inspectOpenRouterKey, resolveOpenRouterConfig } from '@ans/ai-provider';
import { maskSecret } from '@ans/security';
import { updateEnvironmentDocument } from './stream-target-settings.js';

const aiSettingsInputSchema = z
  .object({
    apiKey: z.string().trim().max(512).optional(),
    clearApiKey: z.boolean().optional(),
    paidFallback: z.boolean(),
    autoProcessIngest: z.boolean(),
    dataCollection: z.enum(['allow', 'deny']),
  })
  .strict();

type AiSettingsInput = z.infer<typeof aiSettingsInputSchema>;

type AiSettingsDependencies = {
  env: NodeJS.ProcessEnv;
  readEnvironmentFile: () => Promise<string>;
  writeEnvironmentFile: (content: string) => Promise<void>;
  inspectKey: typeof inspectOpenRouterKey;
};

type AiSettingsOptions = Partial<AiSettingsDependencies> & { envFile?: string };

async function writePrivateEnvironmentFile(path: string, content: string) {
  const temporary = `${path}.tmp-${process.pid}-${randomUUID()}`;
  await writeFile(temporary, content, { mode: 0o600 });
  await chmod(temporary, 0o600);
  await rename(temporary, path);
  await chmod(path, 0o600);
}

function publicSettings(env: NodeJS.ProcessEnv) {
  const config = resolveOpenRouterConfig(env);
  return {
    provider: 'openrouter' as const,
    configured: Boolean(config.apiKey),
    apiKeyHint: config.apiKey ? maskSecret(config.apiKey) : '',
    freeFirst: true as const,
    freeModel: 'openrouter/free',
    paidFallback: config.paidFallback,
    autoProcessIngest: config.autoProcessIngest,
    dataCollection: config.dataCollection,
    taskPolicies: Object.values(AI_TASK_POLICIES).map((policy) => ({
      id: policy.id,
      label: policy.label,
      purpose: policy.purpose,
      paidModels: [...policy.paidModels],
      maxPromptPrice: policy.maxPromptPrice,
      maxCompletionPrice: policy.maxCompletionPrice,
    })),
  };
}

export function buildAiEnvironment(current: NodeJS.ProcessEnv, rawInput: unknown) {
  const input = aiSettingsInputSchema.parse(rawInput);
  const suppliedKey = input.apiKey?.trim();
  const apiKey = input.clearApiKey ? '' : suppliedKey || current.OPENROUTER_API_KEY || '';
  const updates = {
    OPENROUTER_API_KEY: apiKey,
    OPENROUTER_PAID_FALLBACK: String(input.paidFallback),
    OPENROUTER_AUTO_PROCESS_INGEST: String(input.autoProcessIngest),
    OPENROUTER_DATA_COLLECTION: input.dataCollection,
  };
  return { input, updates, next: { ...current, ...updates } };
}

export class AiSettingsManager {
  private saving = false;
  private readonly dependencies: AiSettingsDependencies;

  constructor(options: AiSettingsOptions = {}) {
    const envFile = options.envFile ?? resolve(process.cwd(), '.env');
    this.dependencies = {
      env: options.env ?? process.env,
      readEnvironmentFile: options.readEnvironmentFile ?? (async () => readFile(envFile, 'utf8').catch(() => '')),
      writeEnvironmentFile:
        options.writeEnvironmentFile ?? ((content) => writePrivateEnvironmentFile(envFile, content)),
      inspectKey: options.inspectKey ?? inspectOpenRouterKey,
    };
  }

  private async currentEnvironment() {
    const content = await this.dependencies.readEnvironmentFile();
    return { content, env: { ...this.dependencies.env, ...dotenv.parse(content) } };
  }

  async get() {
    const { env } = await this.currentEnvironment();
    return publicSettings(env);
  }

  async save(rawInput: unknown) {
    if (this.saving)
      throw Object.assign(new Error('KI-Einstellungen werden bereits gespeichert.'), { statusCode: 409 });
    this.saving = true;
    try {
      const { content, env } = await this.currentEnvironment();
      const { input, updates, next } = buildAiEnvironment(env, rawInput);
      if (input.apiKey?.trim()) await this.dependencies.inspectKey(input.apiKey.trim());
      await this.dependencies.writeEnvironmentFile(updateEnvironmentDocument(content, updates));
      for (const [key, value] of Object.entries(updates)) this.dependencies.env[key] = value;
      return publicSettings(next);
    } finally {
      this.saving = false;
    }
  }

  async test() {
    const { env } = await this.currentEnvironment();
    const key = resolveOpenRouterConfig(env).apiKey;
    if (!key) throw Object.assign(new Error('OpenRouter-API-Key fehlt.'), { statusCode: 409 });
    return { ok: true as const, key: await this.dependencies.inspectKey(key) };
  }
}

type RequirePermission = (request: FastifyRequest, reply: FastifyReply, permission: WritePermission) => unknown;

export function registerAiSettingsRoutes(
  app: FastifyInstance,
  manager: AiSettingsManager,
  requirePermission: RequirePermission,
) {
  app.get('/api/ai/settings', async (request, reply) => {
    requirePermission(request, reply, 'users:write');
    return manager.get();
  });
  app.post('/api/ai/settings', async (request, reply) => {
    requirePermission(request, reply, 'users:write');
    return manager.save(request.body as AiSettingsInput);
  });
  app.post('/api/ai/settings/test', async (request, reply) => {
    requirePermission(request, reply, 'users:write');
    return manager.test();
  });
}
