import type { FastifyInstance, FastifyReply, FastifyRequest } from 'fastify';
import type { WritePermission } from '@ans/security/auth';
import { readFile, rm } from 'node:fs/promises';
import { extname, relative, resolve, sep } from 'node:path';
import dotenv from 'dotenv';
import { z } from 'zod';
import { storeUploadedImage } from '@ans/media-engine';
import { resolveStudioProfile } from '../../../packages/streaming-platforms/index.mjs';
import { getSetting, setSetting } from '@ans/database';
import { updateEnvironmentDocument } from './stream-target-settings.js';
import { PROJECT_ROOT } from './project-root.js';
import {
  readOptionalEnvironmentFile,
  withEnvironmentFileLock,
  writePrivateEnvironmentFile,
} from './environment-file.js';

const identitySchema = z
  .object({
    channelName: z.string().trim().min(1).max(80),
    studioName: z.string().trim().min(1).max(120),
    logoEnabled: z.boolean(),
    logoVisibility: z.enum(['always', 'streaming', 'broadcast', 'streaming-or-broadcast']),
    logoPosition: z.enum(['top-left', 'top-right', 'bottom-left', 'bottom-right']),
    logoWidth: z.number().int().min(48).max(640),
    logoOpacity: z.number().int().min(10).max(100),
    logoMargin: z.number().int().min(0).max(240),
  })
  .strict();

type IdentityInput = z.infer<typeof identitySchema>;
type RuntimeState = { streamActive: boolean; broadcastActive: boolean };
type Dependencies = {
  env: NodeJS.ProcessEnv;
  readEnvironmentFile: () => Promise<string>;
  writeEnvironmentFile: (content: string) => Promise<void>;
  afterChange: () => Promise<void>;
  runtimeState: () => Promise<RuntimeState>;
  persistIdentity: (identity: {
    channelName: string;
    studioName: string;
    previousChannelName?: string;
  }) => Promise<void>;
};
type Options = Partial<Dependencies> & { envFile?: string; logoDirectory?: string };

function boolValue(value: string | undefined, fallback: boolean) {
  if (value === undefined || value === '') return fallback;
  return value.toLowerCase() === 'true';
}

function intValue(value: string | undefined, fallback: number, min: number, max: number) {
  const parsed = Number(value ?? fallback);
  return Number.isFinite(parsed) ? Math.max(min, Math.min(max, Math.round(parsed))) : fallback;
}

function publicSettings(env: NodeJS.ProcessEnv) {
  const logoPath = env.CHANNEL_LOGO_PATH?.trim() ?? '';
  const logoRevision = env.CHANNEL_LOGO_SHA256?.trim() ?? '';
  return {
    channelName: env.CHANNEL_NAME?.trim() || 'Mein Kanal',
    studioName: env.STUDIO_NAME?.trim() || `${env.CHANNEL_NAME?.trim() || 'Mein Kanal'} TV Studio`,
    logoConfigured: Boolean(logoPath),
    logoUrl: logoPath ? `/api/channel/logo${logoRevision ? `?v=${encodeURIComponent(logoRevision)}` : ''}` : '',
    logoWidthOriginal: intValue(env.CHANNEL_LOGO_ORIGINAL_WIDTH, 0, 0, 20_000),
    logoHeightOriginal: intValue(env.CHANNEL_LOGO_ORIGINAL_HEIGHT, 0, 0, 20_000),
    logoEnabled: boolValue(env.CHANNEL_LOGO_ENABLED, true),
    logoVisibility: ['always', 'streaming', 'broadcast', 'streaming-or-broadcast'].includes(
      env.CHANNEL_LOGO_VISIBILITY ?? '',
    )
      ? env.CHANNEL_LOGO_VISIBILITY
      : 'always',
    logoPosition: ['top-left', 'top-right', 'bottom-left', 'bottom-right'].includes(env.CHANNEL_LOGO_POSITION ?? '')
      ? env.CHANNEL_LOGO_POSITION
      : 'top-right',
    logoWidth: intValue(env.CHANNEL_LOGO_WIDTH, 180, 48, 640),
    logoOpacity: intValue(env.CHANNEL_LOGO_OPACITY, 92, 10, 100),
    logoMargin: intValue(env.CHANNEL_LOGO_MARGIN, 42, 0, 240),
  };
}

export class ChannelIdentitySettingsManager {
  private readonly dependencies: Dependencies;
  private readonly envFile: string;
  private readonly logoDirectory: string;
  private saving = false;

  constructor(options: Options = {}) {
    this.envFile = options.envFile ?? resolve(PROJECT_ROOT, '.env');
    this.logoDirectory = resolve(options.logoDirectory ?? resolve(PROJECT_ROOT, 'var/channel-branding'));
    this.dependencies = {
      env: options.env ?? process.env,
      readEnvironmentFile: options.readEnvironmentFile ?? (() => readOptionalEnvironmentFile(this.envFile)),
      writeEnvironmentFile:
        options.writeEnvironmentFile ?? ((content) => writePrivateEnvironmentFile(this.envFile, content)),
      afterChange: options.afterChange ?? (async () => undefined),
      runtimeState: options.runtimeState ?? (async () => ({ streamActive: false, broadcastActive: false })),
      persistIdentity:
        options.persistIdentity ??
        (async (identity) => {
          const existing = await getSetting<{ channelName?: string; channelAliases?: string[] }>(
            'studio.identity',
          ).catch(() => null);
          const channelAliases = [
            ...(Array.isArray(existing?.channelAliases) ? existing.channelAliases : []),
            existing?.channelName,
            identity.previousChannelName,
          ]
            .map((name) => name?.trim())
            .filter(
              (name): name is string =>
                Boolean(name) && name?.toLocaleLowerCase('de') !== identity.channelName.toLocaleLowerCase('de'),
            );
          await setSetting('studio.identity', {
            channelName: identity.channelName,
            studioName: identity.studioName,
            channelAliases: [...new Set(channelAliases)],
          });
        }),
    };
  }

  private async currentEnvironment() {
    const content = await this.dependencies.readEnvironmentFile();
    return { content, env: { ...this.dependencies.env, ...dotenv.parse(content) } };
  }

  private async applyUpdates(content: string, updates: Record<string, string>) {
    await this.dependencies.writeEnvironmentFile(updateEnvironmentDocument(content, updates));
    for (const [key, value] of Object.entries(updates)) this.dependencies.env[key] = value;
  }

  private async notifyChanged() {
    try {
      await this.dependencies.afterChange();
      return '';
    } catch (error) {
      return `Gespeichert, aber die OBS-Logoquelle konnte noch nicht aktualisiert werden: ${error instanceof Error ? error.message : String(error)}`;
    }
  }

  async get() {
    const { env } = await this.currentEnvironment();
    return publicSettings(env);
  }

  async save(rawInput: unknown) {
    if (this.saving) throw Object.assign(new Error('Senderidentität wird bereits gespeichert.'), { statusCode: 409 });
    this.saving = true;
    try {
      const result = await withEnvironmentFileLock(this.envFile, async () => {
        const { content, env } = await this.currentEnvironment();
        const input = identitySchema.parse(rawInput);
        const updates = {
          CHANNEL_NAME: input.channelName,
          STUDIO_NAME: input.studioName,
          CHANNEL_LOGO_ENABLED: String(input.logoEnabled),
          CHANNEL_LOGO_VISIBILITY: input.logoVisibility,
          CHANNEL_LOGO_POSITION: input.logoPosition,
          CHANNEL_LOGO_WIDTH: String(input.logoWidth),
          CHANNEL_LOGO_OPACITY: String(input.logoOpacity),
          CHANNEL_LOGO_MARGIN: String(input.logoMargin),
        };
        const next = { ...env, ...updates };
        await this.applyUpdates(content, updates);
        await this.dependencies.persistIdentity({
          channelName: input.channelName,
          studioName: input.studioName,
          previousChannelName: env.CHANNEL_NAME,
        });
        return { settings: publicSettings(next), studio: resolveStudioProfile(next) };
      });
      return { ...result, warning: await this.notifyChanged() };
    } finally {
      this.saving = false;
    }
  }

  private isManagedLogoPath(path: string) {
    const candidate = resolve(path);
    const rel = relative(this.logoDirectory, candidate);
    return rel !== '' && rel !== '..' && !rel.startsWith(`..${sep}`) && !rel.includes(sep);
  }

  private async removeStoredLogo(path: string, sha256: string) {
    if (path && this.isManagedLogoPath(path)) await rm(resolve(path), { force: true });
    if (/^[a-f0-9]{64}$/i.test(sha256)) {
      await Promise.all(
        ['thumb', 'preview'].map((label) =>
          rm(resolve(this.logoDirectory, `${sha256}.${label}.webp`), { force: true }),
        ),
      );
    }
  }

  async uploadLogo(file: { file: NodeJS.ReadableStream; filename: string; mimetype: string }) {
    const stored = await storeUploadedImage({
      stream: file.file,
      filename: file.filename,
      declaredMime: file.mimetype,
      directory: this.logoDirectory,
    });
    let previousPath = '';
    let previousHash = '';
    try {
      const result = await withEnvironmentFileLock(this.envFile, async () => {
        const { content, env } = await this.currentEnvironment();
        previousPath = env.CHANNEL_LOGO_PATH ?? '';
        previousHash = env.CHANNEL_LOGO_SHA256 ?? '';
        const updates = {
          CHANNEL_LOGO_PATH: stored.originalPath,
          CHANNEL_LOGO_MIME: stored.mime,
          CHANNEL_LOGO_SHA256: stored.sha256,
          CHANNEL_LOGO_ORIGINAL_WIDTH: String(stored.width),
          CHANNEL_LOGO_ORIGINAL_HEIGHT: String(stored.height),
          CHANNEL_LOGO_ENABLED: 'true',
        };
        const next = { ...env, ...updates };
        await this.applyUpdates(content, updates);
        return publicSettings(next);
      });
      if (previousHash !== stored.sha256) await this.removeStoredLogo(previousPath, previousHash);
      return { settings: result, warning: await this.notifyChanged() };
    } catch (error) {
      if (previousHash !== stored.sha256) await this.removeStoredLogo(stored.originalPath, stored.sha256);
      throw error;
    }
  }

  async deleteLogo() {
    let previousPath = '';
    let previousHash = '';
    const result = await withEnvironmentFileLock(this.envFile, async () => {
      const { content, env } = await this.currentEnvironment();
      previousPath = env.CHANNEL_LOGO_PATH ?? '';
      previousHash = env.CHANNEL_LOGO_SHA256 ?? '';
      const updates = {
        CHANNEL_LOGO_PATH: '',
        CHANNEL_LOGO_MIME: '',
        CHANNEL_LOGO_SHA256: '',
        CHANNEL_LOGO_ORIGINAL_WIDTH: '',
        CHANNEL_LOGO_ORIGINAL_HEIGHT: '',
        CHANNEL_LOGO_ENABLED: 'false',
      };
      await this.applyUpdates(content, updates);
      return publicSettings({ ...env, ...updates });
    });
    await this.removeStoredLogo(previousPath, previousHash);
    return { settings: result, warning: await this.notifyChanged() };
  }

  async logoFile() {
    const { env } = await this.currentEnvironment();
    const path = env.CHANNEL_LOGO_PATH?.trim() ?? '';
    if (!path || !this.isManagedLogoPath(path)) return null;
    try {
      return {
        buffer: await readFile(resolve(path)),
        mime: env.CHANNEL_LOGO_MIME || (extname(path).toLowerCase() === '.png' ? 'image/png' : 'image/webp'),
        revision: env.CHANNEL_LOGO_SHA256 ?? '',
      };
    } catch {
      return null;
    }
  }

  async publicRuntime() {
    const settings = await this.get();
    const runtime = await this.dependencies.runtimeState();
    const timingVisible =
      settings.logoVisibility === 'always' ||
      (settings.logoVisibility === 'streaming' && runtime.streamActive) ||
      (settings.logoVisibility === 'broadcast' && runtime.broadcastActive) ||
      (settings.logoVisibility === 'streaming-or-broadcast' && (runtime.streamActive || runtime.broadcastActive));
    return { ...settings, ...runtime, visible: settings.logoConfigured && settings.logoEnabled && timingVisible };
  }
}

type RequirePermission = (request: FastifyRequest, reply: FastifyReply, permission: WritePermission) => unknown;

function logoRendererHtml() {
  return `<!doctype html><html><head><meta charset="utf-8"><style>
html,body{margin:0;width:100%;height:100%;overflow:hidden;background:transparent}img{position:absolute;display:none;height:auto;transition:opacity .2s ease}</style></head>
<body><img id="logo" alt=""><script>
const logo=document.getElementById('logo');let revision='';
async function update(){try{const response=await fetch('/api/channel/identity/public',{cache:'no-store'});if(!response.ok)return;const state=await response.json();
logo.style.display=state.visible?'block':'none';logo.style.width=state.logoWidth+'px';logo.style.opacity=String(state.logoOpacity/100);
logo.style.top=state.logoPosition.startsWith('top')?state.logoMargin+'px':'auto';logo.style.bottom=state.logoPosition.startsWith('bottom')?state.logoMargin+'px':'auto';
logo.style.left=state.logoPosition.endsWith('left')?state.logoMargin+'px':'auto';logo.style.right=state.logoPosition.endsWith('right')?state.logoMargin+'px':'auto';
if(state.logoUrl&&state.logoUrl!==revision){revision=state.logoUrl;logo.src=state.logoUrl;}}catch{logo.style.display='none'}}
update();setInterval(update,2500);</script></body></html>`;
}

export function registerChannelIdentityRoutes(
  app: FastifyInstance,
  manager: ChannelIdentitySettingsManager,
  requirePermission: RequirePermission,
) {
  app.get('/api/channel/settings', async (request, reply) => {
    requirePermission(request, reply, 'users:write');
    return manager.get();
  });
  app.post('/api/channel/settings', async (request, reply) => {
    requirePermission(request, reply, 'users:write');
    return manager.save(request.body as IdentityInput);
  });
  app.post('/api/channel/logo', async (request, reply) => {
    requirePermission(request, reply, 'users:write');
    const file = await request.file();
    if (!file) return reply.code(400).send({ error: 'Logo-Datei fehlt' });
    return manager.uploadLogo(file);
  });
  app.delete('/api/channel/logo', async (request, reply) => {
    requirePermission(request, reply, 'users:write');
    return manager.deleteLogo();
  });
  app.get('/api/channel/logo', async (_request, reply) => {
    const file = await manager.logoFile();
    if (!file) return reply.code(404).send({ error: 'Kein Senderlogo gespeichert' });
    return reply
      .type(file.mime)
      .header('cache-control', 'public, max-age=31536000, immutable')
      .header('etag', `"${file.revision}"`)
      .send(file.buffer);
  });
  app.get('/api/channel/identity/public', async () => manager.publicRuntime());
  app.get('/channel-logo', async (_request, reply) => reply.type('text/html; charset=utf-8').send(logoRendererHtml()));
}
