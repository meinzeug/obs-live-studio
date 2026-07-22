import { randomBytes } from 'node:crypto';
import { spawn } from 'node:child_process';
import { createReadStream } from 'node:fs';
import { access, readFile, rm, stat } from 'node:fs/promises';
import { isAbsolute, relative, resolve, sep } from 'node:path';
import type { FastifyInstance, FastifyReply, FastifyRequest } from 'fastify';
import dotenv from 'dotenv';
import { z } from 'zod';
import { storeUploadedImage } from '@ans/media-engine';
import {
  cancelYoutubeShortJob,
  deleteYoutubeShortJob,
  enqueueYoutubeShortForCurrent,
  getYoutubeShortJob,
  getYoutubeShortsSettings,
  listYoutubeShortJobs,
  queueMissingYoutubeShortReupload,
  queueYoutubeShortUpload,
  reviseYoutubeShortJob,
  retryYoutubeShortJob,
  updateYoutubeShortJob,
  updateYoutubeShortsSettings,
  youtubeShortsSummary,
} from '@ans/database/youtube-shorts';
import { auditLog } from '@ans/database/auth';
import type { WritePermission } from '@ans/security/auth';
import { maskSecret } from '@ans/security';
import { updateEnvironmentDocument } from './stream-target-settings.js';
import {
  readOptionalEnvironmentFile,
  withEnvironmentFileLock,
  writePrivateEnvironmentFile,
} from './environment-file.js';
import { PROJECT_ROOT } from './project-root.js';
import { youtubeShortPublication } from './youtube-short-publication.js';
import { shortsLayoutSchema } from './shorts-layout-schema.js';
import {
  deleteYoutubeVideo,
  encodeYoutubeOAuthChannels,
  exchangeYoutubeAuthorizationCode,
  listYoutubeVideoStates,
  listOwnedYoutubeChannelsWithAccessToken,
  readYoutubeOAuthChannels,
  readYoutubeOAuthConfig,
  updateYoutubeVideoMetadata,
  youtubeAccessToken,
  youtubeAuthorizationUrl,
  youtubeOAuthPublicStatus,
} from './youtube-oauth.js';

type RequirePermission = (request: FastifyRequest, reply: FastifyReply, permission: WritePermission) => unknown;
type EmitUpdate = (reason: string, payload?: Record<string, unknown>) => Promise<void>;

const settingsSchema = z
  .object({
    enabled: z.boolean().optional(),
    autoCreate: z.boolean().optional(),
    autoUpload: z.boolean().optional(),
    dailyLimit: z.number().int().min(0).max(50).optional(),
    minimumIntervalHours: z.number().min(0).max(24).multipleOf(0.5).optional(),
    privacyStatus: z.enum(['private', 'unlisted', 'public']).optional(),
    rightsConfirmed: z.boolean().optional(),
    sourceVolumePercent: z.number().int().min(0).max(150).optional(),
    sourceDuckPercent: z.number().int().min(0).max(100).optional(),
    titleTemplate: z.string().trim().min(3).max(180).optional(),
    descriptionTemplate: z.string().trim().min(3).max(5000).optional(),
    tags: z.array(z.string().trim().min(1).max(60)).max(30).optional(),
    timeZone: z.string().trim().min(1).max(80).optional(),
    youtubeChannelId: z.string().trim().max(128).optional(),
    layoutConfig: shortsLayoutSchema.optional(),
  })
  .strict();

const oauthSchema = z
  .object({
    clientId: z.string().trim().max(500).optional(),
    clientSecret: z.string().trim().max(500).optional(),
    clearClientSecret: z.boolean().optional(),
    redirectUri: z.string().trim().url().max(1000).optional(),
  })
  .strict();

const publicationSchema = z
  .object({
    title: z
      .string()
      .trim()
      .min(1)
      .max(100)
      .refine((value) => !/[<>]/.test(value), 'Der YouTube-Titel darf < und > nicht enthalten.'),
    description: z.string().trim().max(5000),
    tags: z.array(z.string().trim().min(1).max(60)).max(30),
    privacyStatus: z.enum(['private', 'unlisted', 'public']),
  })
  .strict()
  .superRefine((value, context) => {
    if (value.tags.join(',').length > 450)
      context.addIssue({ code: 'custom', path: ['tags'], message: 'Die YouTube-Tags sind insgesamt zu lang.' });
  });

const shortEditSchema = z
  .object({
    commentaryHeadline: z.string().trim().min(3).max(180).optional(),
    commentaryText: z.string().trim().min(20).max(4000).optional(),
    publication: publicationSchema.optional(),
    rerender: z.boolean().optional(),
    syncYoutube: z.boolean().optional(),
    channelId: z.string().trim().max(128).optional(),
  })
  .strict()
  .refine(
    (value) => value.publication || value.commentaryHeadline || value.commentaryText || value.rerender,
    'Es wurden keine Änderungen übergeben.',
  );

const shortDeleteSchema = z
  .object({
    confirmation: z.literal('LÖSCHEN'),
    deleteFromYoutube: z.boolean().default(false),
    channelId: z.string().trim().max(128).optional(),
  })
  .strict();

function resolveStoredPath(path: string) {
  if (path.startsWith('~/')) return resolve(process.env.HOME || PROJECT_ROOT, path.slice(2));
  return isAbsolute(path) ? resolve(path) : resolve(PROJECT_ROOT, path);
}

function managedShortsPath(path: string) {
  const base = resolve(PROJECT_ROOT, 'var/media/shorts');
  const candidate = resolveStoredPath(path);
  const rel = relative(base, candidate);
  return rel === '' || (!rel.startsWith('..') && !rel.includes(`..${sep}`));
}

async function fileAvailable(path: string | null | undefined) {
  if (!path) return false;
  try {
    await access(resolveStoredPath(path));
    return true;
  } catch {
    return false;
  }
}

const executableAvailability = new Map<string, { expiresAt: number; available: boolean }>();

async function executableAvailable(command: string, args: string[] = ['-version']) {
  const key = `${command}\0${args.join('\0')}`;
  const cached = executableAvailability.get(key);
  if (cached && cached.expiresAt > Date.now()) return cached.available;
  const available = await new Promise<boolean>((resolvePromise) => {
    const child = spawn(command, args, { stdio: 'ignore' });
    const timeout = setTimeout(() => {
      child.kill('SIGKILL');
      resolvePromise(false);
    }, 4_000);
    child.once('error', () => {
      clearTimeout(timeout);
      resolvePromise(false);
    });
    child.once('close', (code) => {
      clearTimeout(timeout);
      resolvePromise(code === 0);
    });
  });
  executableAvailability.set(key, { expiresAt: Date.now() + 60_000, available });
  return available;
}

export class YoutubeShortsSettingsManager {
  private readonly envFile: string;
  private readonly env: NodeJS.ProcessEnv;
  private channelDiscovery: Promise<void> | null = null;
  private channelDiscoveryRetryAt = 0;
  private channelDiscoveryError = '';
  private readonly oauthStates = new Map<
    string,
    { userId: string; expiresAt: number; returnTo: '/settings/media' | '/youtube-shorts' }
  >();

  constructor(options: { envFile?: string; env?: NodeJS.ProcessEnv } = {}) {
    this.envFile = options.envFile ?? resolve(PROJECT_ROOT, '.env');
    this.env = options.env ?? process.env;
  }

  private async environment() {
    const content = await readOptionalEnvironmentFile(this.envFile);
    return { content, env: { ...this.env, ...dotenv.parse(content) } };
  }

  async serverEnvironment() {
    return (await this.environment()).env;
  }

  private applyEnvironment(updates: Record<string, string>) {
    for (const [key, value] of Object.entries(updates)) this.env[key] = value;
  }

  private async ensureChannelProfiles() {
    const { env } = await this.environment();
    const oauth = youtubeOAuthPublicStatus(env);
    if (!oauth.connected || oauth.channels.length) {
      this.channelDiscoveryError = '';
      return;
    }
    if (this.channelDiscoveryRetryAt > Date.now()) return;
    if (!this.channelDiscovery) {
      this.channelDiscovery = (async () => {
        const accessToken = await youtubeAccessToken(env);
        const discovered = await listOwnedYoutubeChannelsWithAccessToken(accessToken);
        if (!discovered.length)
          throw Object.assign(new Error('Google hat für diese Freigabe keinen eigenen YouTube-Kanal geliefert.'), {
            statusCode: 409,
          });
        await withEnvironmentFileLock(this.envFile, async () => {
          const { content, env: current } = await this.environment();
          if (readYoutubeOAuthChannels(current).length) return;
          const refreshToken = readYoutubeOAuthConfig(current).refreshToken;
          if (!refreshToken) return;
          const connectedAt = new Date().toISOString();
          const updates = {
            YOUTUBE_OAUTH_CHANNELS_B64: encodeYoutubeOAuthChannels(
              discovered.map((channel) => ({ ...channel, connectedAt, refreshToken })),
            ),
          };
          await writePrivateEnvironmentFile(this.envFile, updateEnvironmentDocument(content, updates));
          this.applyEnvironment(updates);
        });
        this.channelDiscoveryError = '';
        this.channelDiscoveryRetryAt = 0;
      })()
        .catch((error) => {
          this.channelDiscoveryError = (error instanceof Error ? error.message : String(error)).slice(0, 500);
          this.channelDiscoveryRetryAt = Date.now() + 60_000;
        })
        .finally(() => {
          this.channelDiscovery = null;
        });
    }
    await this.channelDiscovery;
  }

  async publicOauth(options: { waitForDiscovery?: boolean } = {}) {
    if (options.waitForDiscovery) await this.ensureChannelProfiles();
    else void this.ensureChannelProfiles().catch(() => undefined);
    const { env } = await this.environment();
    const config = readYoutubeOAuthConfig(env);
    const oauth = youtubeOAuthPublicStatus(env);
    const dataApiKey = env.YOUTUBE_DATA_API_KEY?.trim() || '';
    return {
      ...oauth,
      clientIdHint: config.clientId ? maskSecret(config.clientId) : '',
      clientSecretHint: config.clientSecret ? maskSecret(config.clientSecret) : '',
      dataApiConfigured: Boolean(dataApiKey),
      dataApiKeyHint: dataApiKey ? maskSecret(dataApiKey) : '',
      researchReady: Boolean(dataApiKey || oauth.connected),
      uploadReady: oauth.connected,
      channelDiscoveryInProgress: Boolean(this.channelDiscovery),
      channelDiscoveryError: this.channelDiscoveryError,
    };
  }

  async saveOauth(raw: unknown) {
    const input = oauthSchema.parse(raw ?? {});
    await withEnvironmentFileLock(this.envFile, async () => {
      const { content, env } = await this.environment();
      const clientId = input.clientId?.trim() || env.YOUTUBE_OAUTH_CLIENT_ID || '';
      const clientSecret = input.clearClientSecret
        ? ''
        : input.clientSecret?.trim() || env.YOUTUBE_OAUTH_CLIENT_SECRET || '';
      const identityChanged =
        clientId !== (env.YOUTUBE_OAUTH_CLIENT_ID || '') || clientSecret !== (env.YOUTUBE_OAUTH_CLIENT_SECRET || '');
      const updates = {
        YOUTUBE_OAUTH_CLIENT_ID: clientId,
        YOUTUBE_OAUTH_CLIENT_SECRET: clientSecret,
        YOUTUBE_OAUTH_REFRESH_TOKEN: identityChanged ? '' : env.YOUTUBE_OAUTH_REFRESH_TOKEN || '',
        YOUTUBE_OAUTH_CHANNELS_B64: identityChanged ? '' : env.YOUTUBE_OAUTH_CHANNELS_B64 || '',
        YOUTUBE_OAUTH_REDIRECT_URI:
          input.redirectUri?.trim() ||
          env.YOUTUBE_OAUTH_REDIRECT_URI ||
          'http://localhost:12001/api/youtube/oauth/callback',
      };
      await writePrivateEnvironmentFile(this.envFile, updateEnvironmentDocument(content, updates));
      this.applyEnvironment(updates);
    });
    this.channelDiscoveryRetryAt = 0;
    this.channelDiscoveryError = '';
    return this.publicOauth();
  }

  async beginOauth(userId: string, returnTo: '/settings/media' | '/youtube-shorts' = '/youtube-shorts') {
    const { env } = await this.environment();
    for (const [key, pending] of this.oauthStates) {
      if (pending.expiresAt < Date.now()) this.oauthStates.delete(key);
    }
    const state = randomBytes(32).toString('base64url');
    this.oauthStates.set(state, { userId, expiresAt: Date.now() + 10 * 60_000, returnTo });
    return youtubeAuthorizationUrl(readYoutubeOAuthConfig(env), state);
  }

  cancelOauth(state: string) {
    const pending = this.oauthStates.get(state);
    this.oauthStates.delete(state);
    return pending?.returnTo ?? '/settings/media';
  }

  async completeOauth(state: string, code: string) {
    const pending = this.oauthStates.get(state);
    if (!pending || pending.expiresAt < Date.now()) {
      this.oauthStates.delete(state);
      throw Object.assign(new Error('Die YouTube-OAuth-Anfrage ist abgelaufen oder ungültig.'), { statusCode: 400 });
    }
    const completed = await withEnvironmentFileLock(this.envFile, async () => {
      const { content, env } = await this.environment();
      const exchanged = await exchangeYoutubeAuthorizationCode(readYoutubeOAuthConfig(env), code);
      const existingProfiles = readYoutubeOAuthChannels(env);
      const refreshToken = exchanged.refreshToken || (!existingProfiles.length ? env.YOUTUBE_OAUTH_REFRESH_TOKEN : '');
      if (!refreshToken)
        throw Object.assign(
          new Error('Google hat kein widerrufbares Refresh-Token geliefert. Bitte die Verbindung erneut freigeben.'),
          { statusCode: 409 },
        );
      const discovered = await listOwnedYoutubeChannelsWithAccessToken(exchanged.accessToken);
      if (!discovered.length)
        throw Object.assign(new Error('Google hat für diese Freigabe keinen eigenen YouTube-Kanal geliefert.'), {
          statusCode: 409,
        });
      const connectedAt = new Date().toISOString();
      const profiles = new Map(existingProfiles.map((profile) => [profile.id, profile]));
      for (const channel of discovered) profiles.set(channel.id, { ...channel, connectedAt, refreshToken });
      const updates = {
        YOUTUBE_OAUTH_REFRESH_TOKEN: refreshToken,
        YOUTUBE_OAUTH_CHANNELS_B64: encodeYoutubeOAuthChannels([...profiles.values()]),
      };
      await writePrivateEnvironmentFile(this.envFile, updateEnvironmentDocument(content, updates));
      this.applyEnvironment(updates);
      return { userId: pending.userId, returnTo: pending.returnTo };
    });
    this.oauthStates.delete(state);
    this.channelDiscoveryRetryAt = 0;
    this.channelDiscoveryError = '';
    return { ...completed, oauth: await this.publicOauth() };
  }

  async disconnectOauth() {
    await withEnvironmentFileLock(this.envFile, async () => {
      const { content } = await this.environment();
      const updates = { YOUTUBE_OAUTH_REFRESH_TOKEN: '', YOUTUBE_OAUTH_CHANNELS_B64: '' };
      await writePrivateEnvironmentFile(this.envFile, updateEnvironmentDocument(content, updates));
      this.applyEnvironment(updates);
    });
    this.channelDiscoveryRetryAt = 0;
    this.channelDiscoveryError = '';
    return this.publicOauth();
  }

  async testOauth(channelId?: string) {
    await this.ensureChannelProfiles();
    const { env } = await this.environment();
    const profiles = readYoutubeOAuthChannels(env);
    const selectedId = channelId?.trim() || (profiles.length === 1 ? profiles[0]!.id : '');
    if (!selectedId && profiles.length > 1)
      throw Object.assign(new Error('Bitte zuerst den YouTube-Zielkanal auswählen.'), { statusCode: 400 });
    const accessToken = await youtubeAccessToken(env, undefined, selectedId || null);
    const channels = await listOwnedYoutubeChannelsWithAccessToken(accessToken);
    const selected = selectedId ? channels.find((channel) => channel.id === selectedId) : channels[0];
    if (selectedId && !selected)
      throw Object.assign(new Error('Der ausgewählte YouTube-Kanal gehört nicht mehr zu dieser Freigabe.'), {
        statusCode: 409,
      });
    return {
      ok: true as const,
      channel: selected ?? null,
      message: selected
        ? `YouTube OAuth ist gültig; Uploads gehen an „${selected.title}“.`
        : 'YouTube OAuth ist gültig; Upload und Senderchat sind freigegeben.',
    };
  }
}

async function sendShortVideo(reply: FastifyReply, request: FastifyRequest, path: string) {
  if (!managedShortsPath(path)) return reply.code(403).send({ error: 'Ungültiger Short-Dateipfad' });
  const filePath = resolveStoredPath(path);
  const info = await stat(filePath).catch(() => null);
  if (!info?.isFile()) return reply.code(404).send({ error: 'Short-Datei nicht gefunden' });
  const range = request.headers.range?.match(/^bytes=(\d*)-(\d*)$/);
  if (!range) {
    return reply
      .header('accept-ranges', 'bytes')
      .header('content-length', info.size)
      .type('video/mp4')
      .send(createReadStream(filePath));
  }
  const suffixLength = !range[1] && range[2] ? Number(range[2]) : null;
  const start = suffixLength !== null ? Math.max(0, info.size - suffixLength) : range[1] ? Number(range[1]) : 0;
  const end =
    suffixLength !== null ? info.size - 1 : range[2] ? Math.min(info.size - 1, Number(range[2])) : info.size - 1;
  if (!Number.isFinite(start) || !Number.isFinite(end) || start > end)
    return reply.code(416).header('content-range', `bytes */${info.size}`).send();
  if (start < 0 || start >= info.size || (suffixLength !== null && suffixLength <= 0))
    return reply.code(416).header('content-range', `bytes */${info.size}`).send();
  return reply
    .code(206)
    .header('accept-ranges', 'bytes')
    .header('content-range', `bytes ${start}-${end}/${info.size}`)
    .header('content-length', end - start + 1)
    .type('video/mp4')
    .send(createReadStream(filePath, { start, end }));
}

async function removeManagedShortFiles(paths: Array<string | null | undefined>) {
  await Promise.all(
    [...new Set(paths.filter((path): path is string => Boolean(path && managedShortsPath(path))))].map((path) =>
      rm(resolveStoredPath(path), { force: true }),
    ),
  );
}

function jobYoutubeChannelId(
  job: Awaited<ReturnType<typeof getYoutubeShortJob>>,
  requested: string | undefined,
  configured: string,
  channels: Array<{ id: string }>,
) {
  const stored = typeof job?.metadata?.uploadedChannelId === 'string' ? job.metadata.uploadedChannelId.trim() : '';
  return requested?.trim() || stored || configured.trim() || (channels.length === 1 ? channels[0]!.id : '');
}

export function registerYoutubeShortsRoutes(
  app: FastifyInstance,
  requirePermission: RequirePermission,
  manager: YoutubeShortsSettingsManager,
  emitUpdate: EmitUpdate,
) {
  app.get('/api/youtube-shorts', async () => {
    const [settings, summary, jobs, oauth] = await Promise.all([
      getYoutubeShortsSettings(),
      youtubeShortsSummary(),
      listYoutubeShortJobs(120),
      manager.publicOauth(),
    ]);
    const ytDlp = process.env.YTDLP_EXECUTABLE?.trim() || resolve(PROJECT_ROOT, 'var/youtube-tools-venv/bin/yt-dlp');
    const ffmpeg = process.env.FFMPEG_EXECUTABLE?.trim() || 'ffmpeg';
    const [overlayAvailable, ffmpegAvailable, ytDlpAvailable] = await Promise.all([
      settings.layout_config.brandingOverlayVisible ? fileAvailable(settings.overlay_path) : Promise.resolve(true),
      executableAvailable(ffmpeg),
      executableAvailable(ytDlp, ['--version']),
    ]);
    const channelReady = Boolean(
      oauth.connected &&
      (settings.youtube_channel_id
        ? oauth.channels.some((channel) => channel.id === settings.youtube_channel_id)
        : oauth.channels.length === 1),
    );
    return {
      settings,
      summary,
      jobs: jobs.map((job) => ({ ...job, publication: youtubeShortPublication(job, settings) })),
      oauth,
      overlayUrl: '/api/youtube-shorts/overlay',
      prerequisites: {
        overlay: overlayAvailable,
        ffmpeg: ffmpegAvailable,
        ytDlp: ytDlpAvailable,
        oauth: oauth.connected,
        channel: channelReady,
        rights: settings.rights_confirmed,
      },
    };
  });

  app.patch('/api/youtube-shorts/settings', async (request, reply) => {
    requirePermission(request, reply, 'broadcast:write');
    const input = settingsSchema.parse(request.body ?? {});
    if (input.timeZone) {
      try {
        new Intl.DateTimeFormat('de-DE', { timeZone: input.timeZone }).format(new Date());
      } catch {
        return reply.code(400).send({ error: 'Ungültige IANA-Zeitzone.' });
      }
    }
    const [current, oauth] = await Promise.all([getYoutubeShortsSettings(), manager.publicOauth()]);
    const selectedChannelId = input.youtubeChannelId ?? current.youtube_channel_id;
    if (selectedChannelId && !oauth.channels.some((channel) => channel.id === selectedChannelId))
      return reply.code(400).send({ error: 'Der ausgewählte YouTube-Zielkanal ist nicht autorisiert.' });
    if ((input.autoUpload ?? current.auto_upload) && oauth.channels.length > 1 && !selectedChannelId)
      return reply.code(400).send({ error: 'Bitte einen YouTube-Zielkanal für automatische Uploads auswählen.' });
    const settings = await updateYoutubeShortsSettings(input);
    await auditLog(request.user?.id ?? null, 'youtube_shorts.settings.update', 'youtube_shorts_settings', undefined, {
      fields: Object.keys(input),
    });
    await emitUpdate('youtube-shorts-settings-updated');
    return settings;
  });

  const saveOauthHandler = async (request: FastifyRequest, reply: FastifyReply) => {
    requirePermission(request, reply, 'users:write');
    const result = await manager.saveOauth(request.body);
    await auditLog(request.user?.id ?? null, 'youtube.oauth.settings', 'youtube_oauth');
    return result;
  };

  const startOauthHandler = async (request: FastifyRequest, reply: FastifyReply) => {
    requirePermission(request, reply, 'users:write');
    const body = z
      .object({ returnTo: z.enum(['/settings/media', '/youtube-shorts']).optional() })
      .strict()
      .parse(request.body ?? {});
    return { url: await manager.beginOauth(request.user!.id, body.returnTo) };
  };

  const callbackOauthHandler = async (request: FastifyRequest, reply: FastifyReply) => {
    const query = z
      .object({ state: z.string().min(20), code: z.string().min(4).optional(), error: z.string().optional() })
      .parse(request.query);
    if (query.error || !query.code) {
      const returnTo = manager.cancelOauth(query.state);
      return reply.redirect(`/#${returnTo}?oauth=denied`);
    }
    try {
      const result = await manager.completeOauth(query.state, query.code);
      return reply.redirect(`/#${result.returnTo}?oauth=connected`);
    } catch (error) {
      request.log.warn({ error }, 'YouTube OAuth callback failed');
      const returnTo = manager.cancelOauth(query.state);
      return reply.redirect(`/#${returnTo}?oauth=failed`);
    }
  };

  const testOauthHandler = async (request: FastifyRequest, reply: FastifyReply) => {
    requirePermission(request, reply, 'users:write');
    const body = z
      .object({ channelId: z.string().trim().max(128).optional() })
      .strict()
      .parse(request.body ?? {});
    return manager.testOauth(body.channelId);
  };

  const disconnectOauthHandler = async (request: FastifyRequest, reply: FastifyReply) => {
    requirePermission(request, reply, 'users:write');
    const result = await manager.disconnectOauth();
    await auditLog(request.user?.id ?? null, 'youtube.oauth.disconnect', 'youtube_oauth');
    return result;
  };

  for (const prefix of ['/api/youtube/oauth', '/api/youtube-shorts/oauth'] as const) {
    app.post(`${prefix}/settings`, saveOauthHandler);
    app.post(`${prefix}/start`, startOauthHandler);
    app.get(`${prefix}/callback`, callbackOauthHandler);
    app.post(`${prefix}/test`, testOauthHandler);
    app.delete(prefix, disconnectOauthHandler);
  }

  app.post('/api/youtube-shorts/overlay', async (request, reply) => {
    requirePermission(request, reply, 'broadcast:write');
    const file = await request.file();
    if (!file) return reply.code(400).send({ error: 'PNG-Overlay fehlt.' });
    const stored = await storeUploadedImage({
      stream: file.file,
      filename: file.filename,
      declaredMime: file.mimetype,
      directory: resolve(PROJECT_ROOT, 'var/media/shorts/overlays'),
      maxBytes: 15 * 1024 * 1024,
    });
    if (stored.mime !== 'image/png') {
      await Promise.all(
        [stored.originalPath, ...stored.derivatives.map((entry) => entry.path)].map((path) =>
          rm(path, { force: true }),
        ),
      );
      return reply.code(400).send({ error: 'Das Shorts-Overlay muss eine PNG-Datei mit Transparenz sein.' });
    }
    if (Math.abs(stored.width / stored.height - 9 / 16) > 0.08) {
      await Promise.all(
        [stored.originalPath, ...stored.derivatives.map((entry) => entry.path)].map((path) =>
          rm(path, { force: true }),
        ),
      );
      return reply.code(400).send({ error: 'Das Shorts-Overlay muss ungefähr das Seitenverhältnis 9:16 besitzen.' });
    }
    const settings = await updateYoutubeShortsSettings({ overlayPath: stored.originalPath });
    await emitUpdate('youtube-shorts-overlay-updated');
    return { settings, overlayUrl: `/api/youtube-shorts/overlay?v=${encodeURIComponent(stored.sha256)}` };
  });

  app.get('/api/youtube-shorts/overlay', async (_request, reply) => {
    const settings = await getYoutubeShortsSettings();
    try {
      return reply
        .header('cache-control', 'private, max-age=60')
        .type('image/png')
        .send(await readFile(resolveStoredPath(settings.overlay_path)));
    } catch {
      return reply.code(404).send({ error: 'Shorts-Overlay nicht gefunden' });
    }
  });

  app.post('/api/youtube-shorts/create-current', async (request, reply) => {
    requirePermission(request, reply, 'broadcast:write');
    const result = await enqueueYoutubeShortForCurrent();
    // Missing readiness or an existing job is an expected production state, not
    // a malformed HTTP request. The UI can show the precise domain reason.
    if (!result.queued) return reply.code(200).send(result);
    await emitUpdate('youtube-short-queued', { jobId: result.job.id });
    return reply.code(202).send(result);
  });

  app.post('/api/youtube-shorts/reconcile', async (request, reply) => {
    requirePermission(request, reply, 'broadcast:write');
    const [settings, oauth, jobs, env] = await Promise.all([
      getYoutubeShortsSettings(),
      manager.publicOauth(),
      listYoutubeShortJobs(300),
      manager.serverEnvironment(),
    ]);
    const uploaded = jobs.filter((job) => job.status === 'uploaded' && Boolean(job.youtube_upload_id));
    const grouped = new Map<string, typeof uploaded>();
    let skipped = 0;
    for (const job of uploaded) {
      const channelId = jobYoutubeChannelId(job, undefined, settings.youtube_channel_id, oauth.channels);
      if (!channelId) {
        skipped += 1;
        continue;
      }
      const group = grouped.get(channelId) ?? [];
      group.push(job);
      grouped.set(channelId, group);
    }
    const checkedAt = new Date().toISOString();
    let checked = 0;
    let missing = 0;
    const warnings: string[] = [];
    for (const [channelId, channelJobs] of grouped) {
      for (let offset = 0; offset < channelJobs.length; offset += 50) {
        const batch = channelJobs.slice(offset, offset + 50);
        try {
          const states = await listYoutubeVideoStates(
            batch.map((job) => job.youtube_upload_id!),
            { env, channelId },
          );
          const byId = new Map(states.map((state) => [state.id, state]));
          await Promise.all(
            batch.map(async (job) => {
              const state = byId.get(job.youtube_upload_id!);
              checked += 1;
              if (!state) missing += 1;
              await updateYoutubeShortJob(job.id, {
                metadata: {
                  youtubeRemoteState: state ? 'available' : 'missing',
                  youtubeCheckedAt: checkedAt,
                  youtubeRemoteTitle: state?.title ?? null,
                },
              });
            }),
          );
        } catch (error) {
          warnings.push((error instanceof Error ? error.message : String(error)).slice(0, 500));
        }
      }
    }
    await emitUpdate('youtube-shorts-reconciled', { checked, missing, skipped });
    return { checked, missing, skipped, warnings };
  });

  app.patch('/api/youtube-shorts/jobs/:id', async (request, reply) => {
    requirePermission(request, reply, 'broadcast:write');
    const id = z
      .string()
      .uuid()
      .parse((request.params as { id: string }).id);
    const input = shortEditSchema.parse(request.body ?? {});
    const [current, settings, oauth] = await Promise.all([
      getYoutubeShortJob(id),
      getYoutubeShortsSettings(),
      manager.publicOauth(),
    ]);
    if (!current) return reply.code(404).send({ error: 'Short-Auftrag nicht gefunden.' });
    if (['downloading', 'rendering', 'uploading'].includes(current.status))
      return reply
        .code(409)
        .send({ error: 'Der Short wird gerade verarbeitet und kann noch nicht bearbeitet werden.' });
    const contentChanged =
      (input.commentaryHeadline !== undefined && input.commentaryHeadline !== current.commentary_headline) ||
      (input.commentaryText !== undefined && input.commentaryText !== current.commentary_text);
    if (current.status === 'uploaded' && contentChanged)
      return reply.code(409).send({
        error:
          'Der gesprochene Inhalt eines bereits veröffentlichten Shorts kann nicht ersetzt werden. Lösche ihn oder erstelle eine neue Fassung.',
      });
    const rerender = input.rerender === true || (contentChanged && Boolean(current.output_path));
    const publication = input.publication ?? youtubeShortPublication(current, settings);
    const channelId = jobYoutubeChannelId(current, input.channelId, settings.youtube_channel_id, oauth.channels);
    let youtubeMissing = false;
    if (input.syncYoutube) {
      if (!current.youtube_upload_id)
        return reply.code(409).send({ error: 'Dieser Short wurde noch nicht auf YouTube veröffentlicht.' });
      if (!channelId)
        return reply.code(409).send({ error: 'Für diesen Short ist kein autorisierter YouTube-Kanal bekannt.' });
      try {
        await updateYoutubeVideoMetadata(
          current.youtube_upload_id,
          { ...publication, containsSyntheticMedia: true },
          {
            env: await manager.serverEnvironment(),
            channelId,
          },
        );
      } catch (error) {
        if ((error as { statusCode?: number }).statusCode !== 404) throw error;
        youtubeMissing = true;
      }
    }
    const revision = await reviseYoutubeShortJob(id, {
      commentaryHeadline: input.commentaryHeadline,
      commentaryText: input.commentaryText,
      publication,
      rerender,
    });
    if (!revision.job)
      return reply.code(revision.reason === 'not-found' ? 404 : 409).send({
        error:
          revision.reason === 'active'
            ? 'Der Short wird gerade verarbeitet.'
            : 'Ein bereits veröffentlichter Short kann nicht neu gerendert werden.',
      });
    await removeManagedShortFiles(revision.removedPaths);
    const job =
      input.syncYoutube && !youtubeMissing
        ? await updateYoutubeShortJob(revision.job.id, {
            uploadPrivacy: publication.privacyStatus,
            metadata: { youtubeRemoteState: 'available', youtubeCheckedAt: new Date().toISOString() },
          })
        : youtubeMissing
          ? await updateYoutubeShortJob(revision.job.id, {
              metadata: { youtubeRemoteState: 'missing', youtubeCheckedAt: new Date().toISOString() },
            })
          : revision.job;
    await auditLog(request.user?.id ?? null, 'youtube_shorts.job.update', 'youtube_short_jobs', id, {
      rerender,
      youtubeSynchronized: input.syncYoutube === true && !youtubeMissing,
      youtubeMissing,
    });
    await emitUpdate('youtube-short-updated', { jobId: id, rerender });
    const finalJob = job ?? revision.job;
    return {
      ...finalJob,
      publication: youtubeShortPublication(finalJob, settings),
      warning: youtubeMissing
        ? 'Der Short existiert auf YouTube nicht mehr. Die lokalen Änderungen wurden trotzdem gespeichert.'
        : null,
    };
  });

  app.delete('/api/youtube-shorts/jobs/:id', async (request, reply) => {
    requirePermission(request, reply, 'broadcast:write');
    const id = z
      .string()
      .uuid()
      .parse((request.params as { id: string }).id);
    const input = shortDeleteSchema.parse(request.body ?? {});
    const [current, settings, oauth] = await Promise.all([
      getYoutubeShortJob(id),
      getYoutubeShortsSettings(),
      manager.publicOauth(),
    ]);
    if (!current) return reply.code(404).send({ error: 'Short-Auftrag nicht gefunden.' });
    if (['downloading', 'rendering', 'uploading'].includes(current.status))
      return reply.code(409).send({ error: 'Der Short wird gerade verarbeitet. Stoppe ihn vor dem Löschen.' });
    let youtubeDeleted = false;
    if (input.deleteFromYoutube) {
      if (!current.youtube_upload_id)
        return reply.code(409).send({ error: 'Zu diesem Auftrag existiert kein veröffentlichter YouTube-Short.' });
      const channelId = jobYoutubeChannelId(current, input.channelId, settings.youtube_channel_id, oauth.channels);
      if (!channelId)
        return reply.code(409).send({ error: 'Für diesen Short ist kein autorisierter YouTube-Kanal bekannt.' });
      try {
        await deleteYoutubeVideo(current.youtube_upload_id, {
          env: await manager.serverEnvironment(),
          channelId,
        });
        youtubeDeleted = true;
      } catch (error) {
        if ((error as { statusCode?: number }).statusCode !== 404) throw error;
        youtubeDeleted = true;
      }
    }
    const deleted = await deleteYoutubeShortJob(id);
    if (!deleted.job)
      return reply.code(deleted.reason === 'not-found' ? 404 : 409).send({
        error:
          deleted.reason === 'tiktok-dependent'
            ? 'Dieser AVA-Moment wird auch vom TikTok Clips Creator verwendet. Lösche zuerst die lokale TikTok-Fassung.'
            : 'Der Short kann noch nicht gelöscht werden.',
      });
    await removeManagedShortFiles([deleted.job.output_path, deleted.job.thumbnail_path]);
    await auditLog(request.user?.id ?? null, 'youtube_shorts.job.delete', 'youtube_short_jobs', id, {
      youtubeDeleted,
      youtubeVideoId: deleted.job.youtube_upload_id,
    });
    await emitUpdate('youtube-short-deleted', { jobId: id, youtubeDeleted });
    return { deleted: true, youtubeDeleted };
  });

  app.post('/api/youtube-shorts/jobs/:id/:action', async (request, reply) => {
    requirePermission(request, reply, 'broadcast:write');
    const params = z
      .object({ id: z.string().uuid(), action: z.enum(['retry', 'upload', 'reupload', 'cancel']) })
      .parse(request.params);
    const job =
      params.action === 'retry'
        ? await retryYoutubeShortJob(params.id)
        : params.action === 'upload'
          ? await queueYoutubeShortUpload(params.id)
          : params.action === 'reupload'
            ? await queueMissingYoutubeShortReupload(params.id)
            : await cancelYoutubeShortJob(params.id);
    if (!job) return reply.code(409).send({ error: 'Diese Aktion ist im aktuellen Short-Status nicht möglich.' });
    await emitUpdate(`youtube-short-${params.action}`, { jobId: params.id });
    return job;
  });

  app.get('/api/youtube-shorts/jobs/:id/video', async (request, reply) => {
    const id = z
      .string()
      .uuid()
      .parse((request.params as { id: string }).id);
    const job = await getYoutubeShortJob(id);
    if (!job?.output_path) return reply.code(404).send({ error: 'Das Short-Video ist noch nicht verfügbar.' });
    return sendShortVideo(reply, request, job.output_path);
  });
}
