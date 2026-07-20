import type { FastifyInstance, FastifyReply, FastifyRequest } from 'fastify';
import type { WritePermission } from '@ans/security/auth';
import { resolve } from 'node:path';
import dotenv from 'dotenv';
import { z } from 'zod';
import { maskSecret } from '@ans/security';
import { updateEnvironmentDocument } from './stream-target-settings.js';
import { PROJECT_ROOT } from './project-root.js';
import {
  readOptionalEnvironmentFile,
  withEnvironmentFileLock,
  writePrivateEnvironmentFile,
} from './environment-file.js';

const mediaSettingsInputSchema = z
  .object({
    commonsEnabled: z.boolean(),
    wikimediaUserAgent: z.string().trim().min(8).max(240),
    pexelsApiKey: z.string().trim().max(512).optional(),
    clearPexelsApiKey: z.boolean().optional(),
    pixabayApiKey: z.string().trim().max(512).optional(),
    clearPixabayApiKey: z.boolean().optional(),
    youtubeDataApiKey: z.string().trim().max(512).optional(),
    clearYoutubeDataApiKey: z.boolean().optional(),
    aiEnabled: z.boolean(),
    autoImportVideo: z.boolean(),
    autoImportGraphic: z.boolean(),
    discoveryMaxCandidates: z.number().int().min(1).max(100),
    maxVideoDurationSeconds: z
      .number()
      .int()
      .min(5)
      .max(6 * 60 * 60),
  })
  .strict();

type MediaSettingsInput = z.infer<typeof mediaSettingsInputSchema>;
type MediaSettingsDependencies = {
  env: NodeJS.ProcessEnv;
  readEnvironmentFile: () => Promise<string>;
  writeEnvironmentFile: (content: string) => Promise<void>;
};
type MediaSettingsOptions = Partial<MediaSettingsDependencies> & { envFile?: string };

function boolSetting(value: string | undefined, fallback: boolean) {
  if (value === undefined || value === '') return fallback;
  return value.toLowerCase() === 'true';
}

function intSetting(value: string | undefined, fallback: number, minimum: number, maximum: number) {
  const parsed = Number(value ?? fallback);
  return Number.isFinite(parsed) ? Math.max(minimum, Math.min(maximum, Math.floor(parsed))) : fallback;
}

function publicSettings(env: NodeJS.ProcessEnv) {
  const pexelsKey = env.PEXELS_API_KEY?.trim() ?? '';
  const pixabayKey = env.PIXABAY_API_KEY?.trim() ?? '';
  const youtubeKey = env.YOUTUBE_DATA_API_KEY?.trim() ?? '';
  return {
    commonsEnabled: boolSetting(env.MEDIA_COMMONS_ENABLED, true),
    wikimediaUserAgent: env.WIKIMEDIA_USER_AGENT?.trim() || 'OpenTVStudio/1.0 (lokales Nachrichtenstudio)',
    pexelsConfigured: Boolean(pexelsKey),
    pexelsApiKeyHint: pexelsKey ? maskSecret(pexelsKey) : '',
    pixabayConfigured: Boolean(pixabayKey),
    pixabayApiKeyHint: pixabayKey ? maskSecret(pixabayKey) : '',
    youtubeConfigured: Boolean(youtubeKey),
    youtubeDataApiKeyHint: youtubeKey ? maskSecret(youtubeKey) : '',
    aiEnabled: boolSetting(env.MEDIA_AI_ENABLED, false),
    autoImportVideo: boolSetting(env.MEDIA_AUTO_IMPORT_VIDEO, true),
    autoImportGraphic: boolSetting(env.MEDIA_AUTO_IMPORT_GRAPHIC, true),
    discoveryMaxCandidates: intSetting(env.MEDIA_DISCOVERY_MAX_CANDIDATES, 30, 1, 100),
    maxVideoDurationSeconds: intSetting(env.MEDIA_MAX_VIDEO_DURATION_SECONDS, 180, 5, 6 * 60 * 60),
  };
}

export function buildMediaEnvironment(current: NodeJS.ProcessEnv, rawInput: unknown) {
  const input = mediaSettingsInputSchema.parse(rawInput);
  const updates = {
    MEDIA_COMMONS_ENABLED: String(input.commonsEnabled),
    WIKIMEDIA_USER_AGENT: input.wikimediaUserAgent,
    PEXELS_API_KEY: input.clearPexelsApiKey ? '' : input.pexelsApiKey?.trim() || current.PEXELS_API_KEY || '',
    PIXABAY_API_KEY: input.clearPixabayApiKey ? '' : input.pixabayApiKey?.trim() || current.PIXABAY_API_KEY || '',
    YOUTUBE_DATA_API_KEY: input.clearYoutubeDataApiKey
      ? ''
      : input.youtubeDataApiKey?.trim() || current.YOUTUBE_DATA_API_KEY || '',
    MEDIA_AI_ENABLED: String(input.aiEnabled),
    MEDIA_AUTO_IMPORT_VIDEO: String(input.autoImportVideo),
    MEDIA_AUTO_IMPORT_GRAPHIC: String(input.autoImportGraphic),
    MEDIA_DISCOVERY_MAX_CANDIDATES: String(input.discoveryMaxCandidates),
    MEDIA_MAX_VIDEO_DURATION_SECONDS: String(input.maxVideoDurationSeconds),
  };
  return { input, updates, next: { ...current, ...updates } };
}

export class MediaSettingsManager {
  private saving = false;
  private readonly dependencies: MediaSettingsDependencies;
  private readonly envFile: string;

  constructor(options: MediaSettingsOptions = {}) {
    const envFile = options.envFile ?? resolve(PROJECT_ROOT, '.env');
    this.envFile = envFile;
    this.dependencies = {
      env: options.env ?? process.env,
      readEnvironmentFile: options.readEnvironmentFile ?? (() => readOptionalEnvironmentFile(envFile)),
      writeEnvironmentFile:
        options.writeEnvironmentFile ?? ((content) => writePrivateEnvironmentFile(envFile, content)),
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
      throw Object.assign(new Error('Medien-Einstellungen werden bereits gespeichert.'), { statusCode: 409 });
    this.saving = true;
    try {
      return await withEnvironmentFileLock(this.envFile, async () => {
        const { content, env } = await this.currentEnvironment();
        const { updates, next } = buildMediaEnvironment(env, rawInput);
        await this.dependencies.writeEnvironmentFile(updateEnvironmentDocument(content, updates));
        for (const [key, value] of Object.entries(updates)) this.dependencies.env[key] = value;
        return publicSettings(next);
      });
    } finally {
      this.saving = false;
    }
  }

  async test(rawProvider: unknown) {
    const provider = z.enum(['wikimedia', 'pexels', 'pixabay', 'youtube']).parse(rawProvider);
    const { env } = await this.currentEnvironment();
    let url: URL;
    let headers: Record<string, string> = {};
    if (provider === 'wikimedia') {
      url = new URL('https://commons.wikimedia.org/w/api.php');
      url.search = new URLSearchParams({ action: 'query', meta: 'siteinfo', format: 'json', origin: '*' }).toString();
      headers = { 'user-agent': env.WIKIMEDIA_USER_AGENT || 'OpenTVStudio/1.0 (lokales Nachrichtenstudio)' };
    } else if (provider === 'pexels') {
      if (!env.PEXELS_API_KEY) throw Object.assign(new Error('Pexels API-Key fehlt.'), { statusCode: 409 });
      url = new URL('https://api.pexels.com/v1/search?query=Nachrichten&per_page=1');
      headers = { Authorization: env.PEXELS_API_KEY };
    } else if (provider === 'pixabay') {
      if (!env.PIXABAY_API_KEY) throw Object.assign(new Error('Pixabay API-Key fehlt.'), { statusCode: 409 });
      url = new URL('https://pixabay.com/api/');
      url.search = new URLSearchParams({
        key: env.PIXABAY_API_KEY,
        q: 'Nachrichten',
        per_page: '3',
        safesearch: 'true',
      }).toString();
    } else {
      if (!env.YOUTUBE_DATA_API_KEY) throw Object.assign(new Error('YouTube Data API-Key fehlt.'), { statusCode: 409 });
      url = new URL('https://www.googleapis.com/youtube/v3/search');
      url.search = new URLSearchParams({
        key: env.YOUTUBE_DATA_API_KEY,
        part: 'id',
        type: 'video',
        q: 'Nachrichten',
        maxResults: '1',
        safeSearch: 'strict',
      }).toString();
    }
    const response = await fetch(url, { headers, signal: AbortSignal.timeout(12_000) });
    if (!response.ok) {
      const detail = (await response.text()).slice(0, 300);
      throw Object.assign(new Error(`${provider}: HTTP ${response.status}${detail ? ` – ${detail}` : ''}`), {
        statusCode: 502,
      });
    }
    await response.body?.cancel();
    return {
      ok: true,
      provider,
      checkedAt: new Date().toISOString(),
      message: provider === 'youtube' ? 'YouTube-Suche ist erreichbar.' : `${provider} ist erreichbar.`,
    };
  }
}

type RequirePermission = (request: FastifyRequest, reply: FastifyReply, permission: WritePermission) => unknown;

export function registerMediaSettingsRoutes(
  app: FastifyInstance,
  manager: MediaSettingsManager,
  requirePermission: RequirePermission,
) {
  app.get('/api/media/settings', async (request, reply) => {
    requirePermission(request, reply, 'users:write');
    return manager.get();
  });
  app.post('/api/media/settings', async (request, reply) => {
    requirePermission(request, reply, 'users:write');
    return manager.save(request.body as MediaSettingsInput);
  });
  app.post('/api/media/settings/test', async (request, reply) => {
    requirePermission(request, reply, 'users:write');
    const body = z
      .object({ provider: z.enum(['wikimedia', 'pexels', 'pixabay', 'youtube']) })
      .strict()
      .parse(request.body);
    return manager.test(body.provider);
  });
}
