import type { FastifyInstance, FastifyReply, FastifyRequest } from 'fastify';
import type { WritePermission } from '@ans/security/auth';
import { spawn } from 'node:child_process';
import { readFile } from 'node:fs/promises';
import { resolve } from 'node:path';
import dotenv from 'dotenv';
import { z } from 'zod';
import { withEnvironmentFileLock, writePrivateEnvironmentFile } from './environment-file.js';
import {
  STREAMING_PLATFORMS,
  resolveAdditionalStreamTargets,
  resolvePrimaryStreamTarget,
  resolveStudioProfile,
  type StreamingPlatformDefinition,
  type StudioProfile,
  type StreamTarget,
} from '../../../packages/streaming-platforms/index.mjs';

const platformSchema = z.enum(['youtube', 'twitch', 'x', 'rumble', 'kick', 'facebook', 'linkedin', 'custom']);
const streamKeySchema = z
  .string()
  .min(8)
  .max(1024)
  .refine((key) => !/[\s;\0]/.test(key), 'Streamschlüssel enthält unzulässige Zeichen.');
const targetSchema = z
  .object({
    id: z
      .string()
      .min(1)
      .max(48)
      .regex(/^[a-z0-9][a-z0-9_-]*$/),
    name: z
      .string()
      .trim()
      .min(1)
      .max(100)
      .refine((name) => !/[\r\n\0`]/.test(name), 'Name enthält unzulässige Zeichen.'),
    platform: platformSchema,
    server: z.string().trim().max(2048),
    channelUrl: z.string().trim().max(2048),
    enabled: z.boolean(),
    syncStart: z.boolean(),
    syncStop: z.boolean(),
    key: z.union([z.literal(''), streamKeySchema]).optional(),
  })
  .strict();

export const streamTargetSettingsSchema = z
  .object({
    primary: targetSchema.omit({ id: true, enabled: true, syncStart: true, syncStop: true }),
    additionalTargets: z.array(targetSchema).max(8),
  })
  .strict();

export type StreamTargetSettingsInput = z.infer<typeof streamTargetSettingsSchema>;
export type EditableStreamTarget = Omit<StreamTarget, 'key' | 'managedId' | 'obsServiceName'> & {
  keyConfigured: boolean;
  key: '';
};
export type StreamTargetSettings = {
  primary: EditableStreamTarget;
  additionalTargets: EditableStreamTarget[];
  supportedPlatforms: StreamingPlatformDefinition[];
};

type StreamTargetManagerDependencies = {
  env: NodeJS.ProcessEnv;
  readEnvironmentFile: () => Promise<string>;
  writeEnvironmentFile: (content: string) => Promise<void>;
  applyConfiguration: (env: NodeJS.ProcessEnv) => Promise<void>;
  beforeApply: () => Promise<unknown>;
  afterApply: (context: unknown) => Promise<void>;
};

type StreamTargetManagerOptions = Partial<StreamTargetManagerDependencies> & { envFile?: string };
type StreamTargetSaveResult = {
  settings: StreamTargetSettings;
  studio: StudioProfile;
  warning?: string;
};

class ObsConfigurationCommandError extends Error {
  constructor(script: string, detail: string) {
    super(`OBS-Konfigurationsschritt ${script} ist fehlgeschlagen (${detail}).`);
    this.name = 'ObsConfigurationCommandError';
  }
}

function editableTarget(target: StreamTarget): EditableStreamTarget {
  return {
    id: target.id,
    name: target.name,
    platform: target.platform,
    server: target.server,
    channelUrl: target.channelUrl,
    enabled: target.enabled,
    configured: target.configured,
    secure: target.secure,
    syncStart: target.syncStart,
    syncStop: target.syncStop,
    keyConfigured: Boolean(target.key),
    key: '',
  };
}

function serializedEnvironmentValue(value: string) {
  if (/^[A-Za-z0-9_./:@+{}\[\],"-]*$/.test(value)) return value;
  if (!value.includes("'")) return `'${value}'`;
  if (!value.includes('`')) return `\`${value}\``;
  if (!value.includes('"')) return `"${value}"`;
  throw Object.assign(new Error('Einstellungswert kann nicht sicher in .env gespeichert werden.'), { statusCode: 400 });
}

export function updateEnvironmentDocument(content: string, updates: Record<string, string>) {
  const entries = Object.entries(updates);
  const knownKeys = new Set(entries.map(([key]) => key));
  const updatedKeys = new Set<string>();
  const lines = content.split(/\r?\n/).map((line) => {
    const match = line.match(/^(\s*(?:export\s+)?)([A-Z][A-Z0-9_]*)\s*=/);
    if (!match || !knownKeys.has(match[2])) return line;
    updatedKeys.add(match[2]);
    return `${match[1]}${match[2]}=${serializedEnvironmentValue(updates[match[2]])}`;
  });
  while (lines.length && lines.at(-1) === '') lines.pop();
  for (const [key, value] of entries) {
    if (!updatedKeys.has(key)) lines.push(`${key}=${serializedEnvironmentValue(value)}`);
  }
  return `${lines.join('\n')}\n`;
}

function runNodeScript(script: string, env: NodeJS.ProcessEnv) {
  return new Promise<void>((resolvePromise, reject) => {
    const child = spawn(process.execPath, [script], {
      cwd: process.cwd(),
      env,
      stdio: ['ignore', 'ignore', 'inherit'],
      shell: false,
    });
    child.once('error', (error) =>
      reject(new ObsConfigurationCommandError(script, (error as NodeJS.ErrnoException).code ?? 'Startfehler')),
    );
    child.once('exit', (code, signal) => {
      if (code === 0) resolvePromise();
      else reject(new ObsConfigurationCommandError(script, String(code ?? signal ?? 'unbekannt')));
    });
  });
}

async function applyObsConfiguration(env: NodeJS.ProcessEnv) {
  await runNodeScript('scripts/configure-obs.mjs', env);
  await runNodeScript('scripts/configure-obs-multi-rtmp.mjs', env);
}

function settingsFromEnvironment(env: NodeJS.ProcessEnv): StreamTargetSettings {
  return {
    primary: editableTarget(resolvePrimaryStreamTarget(env)),
    additionalTargets: resolveAdditionalStreamTargets(env, { includeDisabled: true }).map(editableTarget),
    supportedPlatforms: STREAMING_PLATFORMS.map((platform) => ({ ...platform })),
  };
}

function keyForInput(input: { key?: string }, previous: StreamTarget | undefined, samePlatform: boolean) {
  const supplied = input.key?.trim();
  if (supplied) return supplied;
  return samePlatform ? (previous?.key ?? '') : '';
}

export function buildStreamTargetEnvironment(current: NodeJS.ProcessEnv, rawInput: unknown) {
  const input = streamTargetSettingsSchema.parse(rawInput);
  try {
    const previousPrimary = resolvePrimaryStreamTarget(current);
    const previousAdditional = new Map(
      resolveAdditionalStreamTargets(current, { includeDisabled: true }).map((target) => [target.id, target]),
    );
    const primaryKey = keyForInput(input.primary, previousPrimary, previousPrimary.platform === input.primary.platform);
    const additionalDocuments = input.additionalTargets.map((target) => {
      const previous = previousAdditional.get(target.id);
      return {
        id: target.id,
        name: target.name,
        platform: target.platform,
        server: target.server,
        key: keyForInput(target, previous, previous?.platform === target.platform),
        channelUrl: target.channelUrl,
        enabled: target.enabled,
        syncStart: target.syncStart,
        syncStop: target.syncStop,
      };
    });
    if (new Set(additionalDocuments.map((target) => target.id)).size !== additionalDocuments.length) {
      throw new Error('Streaming-Ziel-IDs müssen eindeutig sein.');
    }
    const updates = {
      STREAM_PLATFORM: input.primary.platform,
      STREAM_TARGET_NAME: input.primary.name,
      STREAM_SERVER: input.primary.server,
      STREAM_KEY: primaryKey,
      CHANNEL_URL: input.primary.channelUrl,
      STREAM_TARGETS_JSON: JSON.stringify(additionalDocuments),
      STREAM_SERVICE: additionalDocuments.some((target) => target.enabled)
        ? `${input.primary.platform}+multistream`
        : input.primary.platform,
      TWITCH_ENABLED: 'false',
    };
    const next = { ...current, ...updates };
    resolvePrimaryStreamTarget(next, { requireConfigured: true });
    resolveAdditionalStreamTargets(next, { includeDisabled: true, requireConfigured: true });
    return { next, updates };
  } catch (error) {
    if (error instanceof z.ZodError) throw error;
    throw Object.assign(new Error(error instanceof Error ? error.message : 'Streaming-Ziele sind ungültig.'), {
      statusCode: 400,
    });
  }
}

export class StreamTargetSettingsManager {
  private saving = false;
  private readonly dependencies: StreamTargetManagerDependencies;
  private readonly envFile: string;

  constructor(dependencies: StreamTargetManagerOptions = {}) {
    const envFile = dependencies.envFile ?? resolve(process.cwd(), '.env');
    this.envFile = envFile;
    this.dependencies = {
      env: dependencies.env ?? process.env,
      readEnvironmentFile: dependencies.readEnvironmentFile ?? (() => readFile(envFile, 'utf8')),
      writeEnvironmentFile:
        dependencies.writeEnvironmentFile ?? ((content) => writePrivateEnvironmentFile(envFile, content)),
      applyConfiguration: dependencies.applyConfiguration ?? applyObsConfiguration,
      beforeApply: dependencies.beforeApply ?? (async () => undefined),
      afterApply: dependencies.afterApply ?? (async () => undefined),
    };
  }

  async get(): Promise<StreamTargetSettings> {
    const content = await this.dependencies.readEnvironmentFile();
    return settingsFromEnvironment({ ...this.dependencies.env, ...dotenv.parse(content) });
  }

  async save(rawInput: unknown): Promise<StreamTargetSaveResult> {
    if (this.saving) throw Object.assign(new Error('Streaming-Ziele werden bereits gespeichert.'), { statusCode: 409 });
    this.saving = true;
    let context: unknown;
    let result: StreamTargetSaveResult | undefined;
    let operationError: unknown;
    try {
      result = await withEnvironmentFileLock(this.envFile, async () => {
        const originalContent = await this.dependencies.readEnvironmentFile();
        const current = { ...this.dependencies.env, ...dotenv.parse(originalContent) };
        const { next, updates } = buildStreamTargetEnvironment(current, rawInput);
        context = await this.dependencies.beforeApply();
        const updatedContent = updateEnvironmentDocument(originalContent, updates);
        await this.dependencies.writeEnvironmentFile(updatedContent);
        for (const [key, value] of Object.entries(updates)) this.dependencies.env[key] = value;
        try {
          await this.dependencies.applyConfiguration(next);
        } catch (error) {
          await this.dependencies.writeEnvironmentFile(originalContent);
          for (const key of Object.keys(updates)) {
            if (current[key] === undefined) delete this.dependencies.env[key];
            else this.dependencies.env[key] = current[key];
          }
          await this.dependencies.applyConfiguration(current).catch(() => undefined);
          const detail = error instanceof ObsConfigurationCommandError ? ` ${error.message}` : '';
          throw Object.assign(new Error(`Streaming-Konfiguration konnte nicht sicher angewendet werden.${detail}`), {
            statusCode: 500,
          });
        }
        return { settings: settingsFromEnvironment(next), studio: resolveStudioProfile(next) };
      });
    } catch (error) {
      operationError = error;
      throw error;
    } finally {
      try {
        if (context !== undefined) {
          try {
            await this.dependencies.afterApply(context);
          } catch (error) {
            if (!operationError && result) {
              const declaredStatus =
                error && typeof error === 'object' && 'statusCode' in error ? Number(error.statusCode) : Number.NaN;
              const detail =
                Number.isInteger(declaredStatus) && error instanceof Error
                  ? `: ${error.message}`
                  : '. Bitte den OBS-Desktop-Agent prüfen.';
              result.warning = `Streaming-Ziele wurden gespeichert, OBS konnte aber nicht automatisch neu gestartet werden${detail}`;
            }
          }
        }
      } finally {
        this.saving = false;
      }
    }
    return result;
  }
}

export function registerStreamTargetSettingsRoutes(
  app: FastifyInstance,
  manager: StreamTargetSettingsManager,
  requirePermission: (req: FastifyRequest, reply: FastifyReply, permission: WritePermission) => void,
) {
  app.get('/api/stream-targets', async (req, reply) => {
    requirePermission(req, reply, 'obs:write');
    return manager.get();
  });
  app.post('/api/stream-targets', async (req, reply) => {
    requirePermission(req, reply, 'obs:write');
    return manager.save(req.body);
  });
}
