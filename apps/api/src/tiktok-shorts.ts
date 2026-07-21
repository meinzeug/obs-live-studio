import { spawn } from 'node:child_process';
import { createReadStream } from 'node:fs';
import { access, rm, stat } from 'node:fs/promises';
import { isAbsolute, relative, resolve, sep } from 'node:path';
import type { FastifyInstance, FastifyReply, FastifyRequest } from 'fastify';
import { z } from 'zod';
import {
  cancelTikTokShortJob,
  deleteTikTokShortJob,
  enqueueTikTokShortForCurrent,
  getTikTokShortJob,
  getTikTokShortsSettings,
  listTikTokShortJobs,
  queueTikTokShortPublish,
  retryTikTokShortJob,
  reviseTikTokShortJob,
  tikTokShortsSummary,
  updateTikTokShortJob,
  updateTikTokShortsSettings,
} from '@ans/database/tiktok-shorts';
import { auditLog } from '@ans/database/auth';
import type { WritePermission } from '@ans/security/auth';
import { fetchTikTokPublishStatus } from './tiktok-api.js';
import { TikTokOAuthManager } from './tiktok-oauth-manager.js';
import { PROJECT_ROOT } from './project-root.js';

type RequirePermission = (request: FastifyRequest, reply: FastifyReply, permission: WritePermission) => unknown;
type EmitUpdate = (reason: string, payload?: Record<string, unknown>) => Promise<void>;

const settingsSchema = z
  .object({
    enabled: z.boolean().optional(),
    autoCreate: z.boolean().optional(),
    dailyLimit: z.number().int().min(0).max(50).optional(),
    captionTemplate: z.string().trim().min(3).max(2_200).optional(),
    timeZone: z.string().trim().min(1).max(80).optional(),
    sourceVolumePercent: z.number().int().min(0).max(150).optional(),
    sourceDuckPercent: z.number().int().min(0).max(100).optional(),
    appAudited: z.boolean().optional(),
  })
  .strict();

const oauthSettingsSchema = z
  .object({
    clientKey: z.string().trim().max(500).optional(),
    clientSecret: z.string().trim().max(500).optional(),
    clearClientSecret: z.boolean().optional(),
    redirectUri: z.string().trim().url().max(1_000).optional(),
  })
  .strict();

const publishSchema = z
  .object({
    caption: z.string().trim().min(1).max(2_200),
    privacyLevel: z.string().trim().min(1).max(80),
    allowComment: z.boolean().default(false),
    allowDuet: z.boolean().default(false),
    allowStitch: z.boolean().default(false),
    brandContentToggle: z.boolean().default(false),
    brandOrganicToggle: z.boolean().default(false),
    rightsConfirmed: z.literal(true),
    musicUsageConfirmed: z.literal(true),
    publishConsent: z.literal(true),
  })
  .strict();

function storedPath(value: string) {
  if (value.startsWith('~/')) return resolve(process.env.HOME || PROJECT_ROOT, value.slice(2));
  return isAbsolute(value) ? resolve(value) : resolve(PROJECT_ROOT, value);
}

function managedTikTokPath(value: string) {
  const base = resolve(PROJECT_ROOT, 'var/media/shorts/tiktok');
  const candidate = storedPath(value);
  const rel = relative(base, candidate);
  return rel === '' || (!rel.startsWith('..') && !rel.includes(`..${sep}`));
}

async function fileAvailable(value: string | null | undefined) {
  if (!value) return false;
  try {
    await access(storedPath(value));
    return true;
  } catch {
    return false;
  }
}

async function executableAvailable(command: string, args = ['-version']) {
  return new Promise<boolean>((resolvePromise) => {
    const child = spawn(command, args, { stdio: 'ignore' });
    const timer = setTimeout(() => {
      child.kill('SIGKILL');
      resolvePromise(false);
    }, 4_000);
    child.once('error', () => {
      clearTimeout(timer);
      resolvePromise(false);
    });
    child.once('close', (code) => {
      clearTimeout(timer);
      resolvePromise(code === 0);
    });
  });
}

async function sendVideo(reply: FastifyReply, request: FastifyRequest, value: string) {
  if (!managedTikTokPath(value)) return reply.code(403).send({ error: 'Ungültiger TikTok-Dateipfad.' });
  const path = storedPath(value);
  const info = await stat(path).catch(() => null);
  if (!info?.isFile()) return reply.code(404).send({ error: 'TikTok-Clip nicht gefunden.' });
  const range = request.headers.range?.match(/^bytes=(\d*)-(\d*)$/);
  if (!range)
    return reply
      .header('accept-ranges', 'bytes')
      .header('content-length', info.size)
      .type('video/mp4')
      .send(createReadStream(path));
  const suffix = !range[1] && range[2] ? Number(range[2]) : null;
  const start = suffix !== null ? Math.max(0, info.size - suffix) : range[1] ? Number(range[1]) : 0;
  const end = suffix !== null ? info.size - 1 : range[2] ? Math.min(info.size - 1, Number(range[2])) : info.size - 1;
  if (!Number.isFinite(start) || !Number.isFinite(end) || start < 0 || start >= info.size || start > end)
    return reply.code(416).header('content-range', `bytes */${info.size}`).send();
  return reply
    .code(206)
    .header('accept-ranges', 'bytes')
    .header('content-range', `bytes ${start}-${end}/${info.size}`)
    .header('content-length', end - start + 1)
    .type('video/mp4')
    .send(createReadStream(path, { start, end }));
}

export function registerTikTokShortsRoutes(
  app: FastifyInstance,
  requirePermission: RequirePermission,
  manager: TikTokOAuthManager,
  emitUpdate: EmitUpdate,
) {
  app.get('/api/tiktok-shorts', async () => {
    const [settings, summary, jobs, oauth] = await Promise.all([
      getTikTokShortsSettings(),
      tikTokShortsSummary(),
      listTikTokShortJobs(),
      manager.publicStatus(),
    ]);
    const ffmpeg = process.env.FFMPEG_EXECUTABLE?.trim() || 'ffmpeg';
    const ytDlp = process.env.YTDLP_EXECUTABLE?.trim() || resolve(PROJECT_ROOT, 'var/youtube-tools-venv/bin/yt-dlp');
    const [ffmpegReady, ytDlpReady] = await Promise.all([
      executableAvailable(ffmpeg),
      executableAvailable(ytDlp, ['--version']),
    ]);
    return {
      settings,
      summary,
      jobs,
      oauth,
      prerequisites: { ffmpeg: ffmpegReady, ytDlp: ytDlpReady, oauth: oauth.connected },
      compliance: {
        automaticPublishing: false,
        unauditedPrivacy: 'SELF_ONLY',
        publishingRequiresApproval: true,
        docsUrl: 'https://developers.tiktok.com/doc/content-posting-api-get-started-upload-content/',
      },
    };
  });

  app.patch('/api/tiktok-shorts/settings', async (request, reply) => {
    requirePermission(request, reply, 'broadcast:write');
    const input = settingsSchema.parse(request.body ?? {});
    if (input.timeZone) {
      try {
        new Intl.DateTimeFormat('de-DE', { timeZone: input.timeZone }).format(new Date());
      } catch {
        return reply.code(400).send({ error: 'Ungültige IANA-Zeitzone.' });
      }
    }
    const settings = await updateTikTokShortsSettings(input);
    await auditLog(request.user?.id ?? null, 'tiktok_shorts.settings.update', 'tiktok_shorts_settings', undefined, {
      fields: Object.keys(input),
    });
    await emitUpdate('tiktok-shorts-settings-updated');
    return settings;
  });

  app.post('/api/tiktok/oauth/settings', async (request, reply) => {
    requirePermission(request, reply, 'users:write');
    const result = await manager.saveSettings(oauthSettingsSchema.parse(request.body ?? {}));
    await auditLog(request.user?.id ?? null, 'tiktok.oauth.settings', 'tiktok_oauth');
    return result;
  });

  app.post('/api/tiktok/oauth/start', async (request, reply) => {
    requirePermission(request, reply, 'users:write');
    return { url: await manager.begin(request.user!.id) };
  });

  app.get('/api/tiktok/oauth/callback', async (request, reply) => {
    const query = z
      .object({ state: z.string().min(20), code: z.string().min(4).optional(), error: z.string().optional() })
      .parse(request.query);
    if (query.error || !query.code) {
      manager.cancel(query.state);
      return reply.redirect('/#/tiktok-shorts?oauth=denied');
    }
    try {
      await manager.complete(query.state, query.code);
      return reply.redirect('/#/tiktok-shorts?oauth=connected');
    } catch (error) {
      request.log.warn({ error }, 'TikTok OAuth callback failed');
      manager.cancel(query.state);
      return reply.redirect('/#/tiktok-shorts?oauth=failed');
    }
  });

  app.post('/api/tiktok/oauth/test', async (request, reply) => {
    requirePermission(request, reply, 'users:write');
    return manager.test();
  });

  app.delete('/api/tiktok/oauth', async (request, reply) => {
    requirePermission(request, reply, 'users:write');
    const result = await manager.disconnect();
    await auditLog(request.user?.id ?? null, 'tiktok.oauth.disconnect', 'tiktok_oauth');
    return result;
  });

  app.get('/api/tiktok-shorts/creator-info', async (request, reply) => {
    requirePermission(request, reply, 'broadcast:write');
    return manager.creatorInfo();
  });

  app.post('/api/tiktok-shorts/create-current', async (request, reply) => {
    requirePermission(request, reply, 'broadcast:write');
    const result = await enqueueTikTokShortForCurrent();
    if (!result.queued) return reply.code(result.job ? 409 : 422).send(result);
    await emitUpdate('tiktok-short-queued', { jobId: result.job.id });
    return reply.code(202).send(result);
  });

  app.patch('/api/tiktok-shorts/jobs/:id', async (request, reply) => {
    requirePermission(request, reply, 'broadcast:write');
    const id = z
      .string()
      .uuid()
      .parse((request.params as { id: string }).id);
    const input = z
      .object({ caption: z.string().trim().min(1).max(2_200) })
      .strict()
      .parse(request.body ?? {});
    const job = await reviseTikTokShortJob(id, input.caption);
    if (!job) return reply.code(409).send({ error: 'Dieser TikTok-Clip kann gerade nicht bearbeitet werden.' });
    await auditLog(request.user?.id ?? null, 'tiktok_shorts.job.update', 'tiktok_short_jobs', id);
    await emitUpdate('tiktok-short-updated', { jobId: id });
    return job;
  });

  app.post('/api/tiktok-shorts/jobs/:id/publish', async (request, reply) => {
    requirePermission(request, reply, 'broadcast:write');
    const id = z
      .string()
      .uuid()
      .parse((request.params as { id: string }).id);
    const input = publishSchema.parse(request.body ?? {});
    const [job, settings, creator] = await Promise.all([
      getTikTokShortJob(id),
      getTikTokShortsSettings(),
      manager.creatorInfo(),
    ]);
    if (!job || job.status !== 'ready')
      return reply.code(409).send({ error: 'Der TikTok-Clip ist noch nicht zur Veröffentlichung bereit.' });
    if (!(await fileAvailable(job.output_path)))
      return reply.code(409).send({ error: 'Die lokale TikTok-Videodatei fehlt. Bitte den Auftrag wiederholen.' });
    if (!creator.privacyLevelOptions.includes(input.privacyLevel))
      return reply.code(400).send({ error: 'Diese Sichtbarkeit wird vom verbundenen TikTok-Konto nicht angeboten.' });
    if (!settings.app_audited && input.privacyLevel !== 'SELF_ONLY')
      return reply.code(400).send({ error: 'Bis zur TikTok-App-Prüfung ist ausschließlich „Nur ich“ erlaubt.' });
    if (creator.maxVideoPostDurationSec < job.clip_duration_seconds)
      return reply.code(400).send({
        error: `Das TikTok-Konto erlaubt höchstens ${creator.maxVideoPostDurationSec} Sekunden; der Clip hat 90 Sekunden.`,
      });
    if (input.brandContentToggle && input.privacyLevel === 'SELF_ONLY')
      return reply
        .code(400)
        .send({ error: 'Branded Content kann bei TikTok nicht als „Nur ich“ veröffentlicht werden.' });
    const queued = await queueTikTokShortPublish(id, {
      caption: input.caption,
      privacyLevel: input.privacyLevel,
      disableComment: creator.commentDisabled || !input.allowComment,
      disableDuet: creator.duetDisabled || !input.allowDuet,
      disableStitch: creator.stitchDisabled || !input.allowStitch,
      brandContentToggle: input.brandContentToggle,
      brandOrganicToggle: input.brandOrganicToggle,
    });
    if (!queued) return reply.code(409).send({ error: 'Der TikTok-Upload konnte nicht vorgemerkt werden.' });
    await auditLog(request.user?.id ?? null, 'tiktok_shorts.job.publish', 'tiktok_short_jobs', id, {
      privacyLevel: input.privacyLevel,
      syntheticMedia: true,
    });
    await emitUpdate('tiktok-short-publish-queued', { jobId: id });
    return reply.code(202).send(queued);
  });

  app.post('/api/tiktok-shorts/reconcile', async (request, reply) => {
    requirePermission(request, reply, 'broadcast:write');
    const processing = (await listTikTokShortJobs(100)).filter(
      (job) => job.status === 'processing' && Boolean(job.publish_id),
    );
    if (!processing.length) return { checked: 0, completed: 0, failed: 0 };
    const accessToken = await manager.accessToken();
    const account = (await manager.publicStatus()).account;
    let completed = 0;
    let failed = 0;
    for (const job of processing.slice(0, 20)) {
      const state = await fetchTikTokPublishStatus(accessToken, job.publish_id!);
      if (state.status === 'PUBLISH_COMPLETE') {
        const postId = state.postIds[0] || null;
        const username = account?.username?.replace(/^@/, '') || '';
        await updateTikTokShortJob(job.id, {
          status: 'published',
          progress: 100,
          postId,
          postUrl: postId && username ? `https://www.tiktok.com/@${username}/video/${postId}` : null,
          remoteStatus: state.status,
          error: null,
          published: true,
        });
        completed += 1;
      } else if (state.status === 'FAILED') {
        await updateTikTokShortJob(job.id, { status: 'failed', remoteStatus: state.status, error: state.failReason });
        failed += 1;
      } else {
        await updateTikTokShortJob(job.id, {
          remoteStatus: state.status,
          nextAttemptAt: new Date(Date.now() + 20_000).toISOString(),
        });
      }
    }
    await emitUpdate('tiktok-shorts-reconciled', { checked: processing.length, completed, failed });
    return { checked: processing.length, completed, failed };
  });

  app.post('/api/tiktok-shorts/jobs/:id/:action', async (request, reply) => {
    requirePermission(request, reply, 'broadcast:write');
    const params = z.object({ id: z.string().uuid(), action: z.enum(['retry', 'cancel']) }).parse(request.params);
    const job =
      params.action === 'retry' ? await retryTikTokShortJob(params.id) : await cancelTikTokShortJob(params.id);
    if (!job) return reply.code(409).send({ error: 'Diese Aktion ist im aktuellen TikTok-Status nicht möglich.' });
    await emitUpdate(`tiktok-short-${params.action}`, { jobId: params.id });
    return job;
  });

  app.delete('/api/tiktok-shorts/jobs/:id', async (request, reply) => {
    requirePermission(request, reply, 'broadcast:write');
    const id = z
      .string()
      .uuid()
      .parse((request.params as { id: string }).id);
    const input = z
      .object({ confirmation: z.literal('LÖSCHEN') })
      .strict()
      .parse(request.body ?? {});
    void input;
    const deleted = await deleteTikTokShortJob(id);
    if (!deleted.job)
      return reply
        .code(deleted.reason === 'not-found' ? 404 : 409)
        .send({ error: 'Der TikTok-Clip wird gerade verarbeitet und kann noch nicht gelöscht werden.' });
    await Promise.all(
      [deleted.job.output_path, deleted.job.thumbnail_path]
        .filter((path): path is string => Boolean(path && managedTikTokPath(path)))
        .map((path) => rm(storedPath(path), { force: true })),
    );
    await auditLog(request.user?.id ?? null, 'tiktok_shorts.job.delete', 'tiktok_short_jobs', id, {
      remotePostRemains: Boolean(deleted.job.post_id),
    });
    await emitUpdate('tiktok-short-deleted', { jobId: id });
    return {
      deleted: true,
      warning: deleted.job.post_id
        ? 'Der lokale Auftrag wurde gelöscht. Einen veröffentlichten TikTok-Post entfernst du weiterhin in TikTok.'
        : null,
    };
  });

  app.get('/api/tiktok-shorts/jobs/:id/video', async (request, reply) => {
    const id = z
      .string()
      .uuid()
      .parse((request.params as { id: string }).id);
    const job = await getTikTokShortJob(id);
    if (!job?.output_path) return reply.code(404).send({ error: 'Der TikTok-Clip ist noch nicht verfügbar.' });
    return sendVideo(reply, request, job.output_path);
  });
}
