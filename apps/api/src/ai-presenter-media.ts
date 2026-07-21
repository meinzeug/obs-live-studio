import type { FastifyInstance, FastifyReply, FastifyRequest } from 'fastify';
import type { WritePermission } from '@ans/security/auth';
import {
  deleteAiPresenterMedia,
  getAiPresenterMedia,
  getAiPresenterProfile,
  listAiPresenterProfiles,
  replaceAiPresenterMedia,
  setAiPresenterVoice,
  type AiPresenterMedia,
  type AiPresenterMediaState,
} from '@ans/database/ai-presenters';
import { recordAiStaffActivity } from '@ans/database/ai-staff';
import { storeUploadedVideo } from '@ans/media-engine/video-upload';
import { execFile } from 'node:child_process';
import { readFile, rm } from 'node:fs/promises';
import { isAbsolute, relative, resolve, sep } from 'node:path';
import { promisify } from 'node:util';
import { z } from 'zod';
import { generateTtsAudio, ttsEnvironmentForAiPresenter } from './tts-generation.js';
import { PROJECT_ROOT } from './project-root.js';

const execFileAsync = promisify(execFile);
const mediaStateSchema = z.enum(['idle', 'speaking']);
const memberIdSchema = z
  .string()
  .trim()
  .min(1)
  .max(80)
  .regex(/^[a-z0-9_-]+$/i);

type UploadedFile = { file: NodeJS.ReadableStream; filename: string; mimetype: string };
type RequirePermission = (request: FastifyRequest, reply: FastifyReply, permission: WritePermission) => unknown;

function resolvedStoredPath(path: string) {
  return isAbsolute(path) ? resolve(path) : resolve(PROJECT_ROOT, path);
}

function voiceOptions(provider: string) {
  if (provider === 'pocket-tts') {
    return [
      { id: 'lola', label: 'Lola · weiblich · German 24L' },
      { id: 'anna', label: 'Anna · weiblich · German 24L HQ' },
      { id: 'alba', label: 'Alba · männlich/tief · German 24L' },
      { id: 'juergen', label: 'Jürgen · männlich · deutscher Original-Prompt' },
    ];
  }
  if (provider === 'piper') {
    return [
      { id: 'de_DE-dii-high', label: 'Dii High · weiblich' },
      { id: 'de_DE-thorsten-high', label: 'Thorsten High · männlich' },
      { id: 'de_DE-thorsten-medium', label: 'Thorsten Medium · männlich' },
      { id: 'de_DE-eva_k-x_low', label: 'Eva K · weiblich, kompakt' },
    ];
  }
  if (provider === 'qwen3-tts') {
    return [
      { id: 'Vivian', label: 'Vivian · weiblich' },
      { id: 'Serena', label: 'Serena · weiblich' },
      { id: 'Ryan', label: 'Ryan · männlich' },
    ];
  }
  return [
    { id: 'de', label: 'Deutsch' },
    { id: 'de+f3', label: 'Deutsch · weiblich' },
  ];
}

export class AiPresenterMediaManager {
  private readonly mediaRoot: string;

  constructor(mediaRoot = resolve(PROJECT_ROOT, 'var/media/ai-presenters')) {
    this.mediaRoot = resolve(mediaRoot);
  }

  async list() {
    const provider = String(process.env.TTS_ENGINE ?? 'pocket-tts')
      .trim()
      .toLowerCase();
    const presenters = await listAiPresenterProfiles();
    return {
      provider,
      voiceOptions: voiceOptions(provider),
      presenters: presenters.map((presenter) => ({
        ...presenter,
        media: Object.fromEntries(
          Object.entries(presenter.media).map(([state, media]) => [
            state,
            media
              ? {
                  ...media,
                  original_path: undefined,
                  rendered_path: undefined,
                  thumbnail_path: undefined,
                  videoUrl: this.videoUrl(presenter.staff_member_id, state as AiPresenterMediaState, media.sha256),
                }
              : null,
          ]),
        ),
      })),
    };
  }

  private videoUrl(memberId: string, state: AiPresenterMediaState, revision: string) {
    return `/api/overlay/ai-presenters/${encodeURIComponent(memberId)}/${state}?v=${encodeURIComponent(revision)}`;
  }

  async saveVoice(memberId: string, voice: string, actorUserId?: string | null) {
    const profile = await getAiPresenterProfile(memberId);
    if (!profile) throw Object.assign(new Error('On-Air-Agent nicht gefunden.'), { statusCode: 404 });
    const saved = await setAiPresenterVoice(memberId, voice);
    if (!saved) throw Object.assign(new Error('Stimme konnte nicht gespeichert werden.'), { statusCode: 409 });
    await recordAiStaffActivity({
      staffMemberId: memberId,
      eventType: 'presenter_voice_updated',
      title: `Sendungsweite TTS-Stimme auf „${voice}“ gesetzt`,
      status: 'ready',
      actorUserId,
      metadata: { voice, provider: process.env.TTS_ENGINE ?? 'pocket-tts' },
    }).catch(() => null);
    return this.list();
  }

  private isManagedPath(path: string) {
    const candidate = resolvedStoredPath(path);
    const rel = relative(this.mediaRoot, candidate);
    return rel !== '' && rel !== '..' && !rel.startsWith(`..${sep}`);
  }

  private async removeManagedMedia(media: AiPresenterMedia | null | undefined) {
    if (!media?.managed) return;
    const candidates = [media.original_path, media.rendered_path, media.thumbnail_path].filter(
      (path): path is string => Boolean(path) && this.isManagedPath(path!),
    );
    await Promise.all([...new Set(candidates.map(resolvedStoredPath))].map((path) => rm(path, { force: true })));
  }

  async upload(
    memberId: string,
    state: AiPresenterMediaState,
    file: UploadedFile,
    greenScreen: boolean,
    actorUserId?: string | null,
  ) {
    const profile = await getAiPresenterProfile(memberId);
    if (!profile) throw Object.assign(new Error('On-Air-Agent nicht gefunden.'), { statusCode: 404 });
    const directory = resolve(this.mediaRoot, memberId);
    const stored = await storeUploadedVideo({
      stream: file.file,
      declaredMime: file.mimetype,
      directory,
      maxDurationSeconds: 10 * 60,
      ffprobeExecutable: process.env.FFPROBE_EXECUTABLE,
      ffmpegExecutable: process.env.FFMPEG_EXECUTABLE,
    });
    const renderedPath = resolve(directory, `${stored.sha256}.${state}.avatar.webm`);
    const filter = greenScreen
      ? 'chromakey=0x32ad4c:0.10:0.04,despill=type=green:mix=0.35:expand=0.05,format=yuva420p'
      : 'format=yuv420p';
    let persisted = false;
    try {
      await execFileAsync(
        process.env.FFMPEG_EXECUTABLE ?? 'ffmpeg',
        [
          '-hide_banner',
          '-loglevel',
          'error',
          '-y',
          '-i',
          stored.originalPath,
          '-vf',
          filter,
          '-an',
          '-c:v',
          'libvpx-vp9',
          '-deadline',
          'good',
          '-cpu-used',
          '4',
          '-crf',
          '28',
          '-b:v',
          '0',
          renderedPath,
        ],
        { timeout: 10 * 60_000, maxBuffer: 4 * 1024 * 1024 },
      );
      const result = await replaceAiPresenterMedia({
        staffMemberId: memberId,
        state,
        originalFilename: file.filename,
        originalPath: stored.originalPath,
        renderedPath,
        thumbnailPath: stored.derivatives.find((item) => item.label === 'thumb')?.path ?? null,
        mimeType: 'video/webm',
        sha256: stored.sha256,
        width: stored.width,
        height: stored.height,
        durationSeconds: stored.durationSeconds,
        greenScreen,
      });
      if (!result)
        throw Object.assign(new Error('Avatar-Medium konnte nicht dem Agenten zugeordnet werden.'), {
          statusCode: 409,
        });
      persisted = true;
      await this.removeManagedMedia(result.previous).catch(() => undefined);
      await recordAiStaffActivity({
        staffMemberId: memberId,
        eventType: 'presenter_media_updated',
        title: `${state === 'idle' ? 'Ruhevideo' : 'Sprechvideo'} aktualisiert`,
        detail: file.filename,
        status: 'ready',
        actorUserId,
        metadata: {
          state,
          sha256: stored.sha256,
          durationSeconds: stored.durationSeconds,
          greenScreen,
          renderedFormat: 'VP9 WebM',
        },
      }).catch(() => null);
      return this.list();
    } catch (error) {
      if (!persisted) {
        await Promise.all([
          rm(stored.originalPath, { force: true }),
          rm(renderedPath, { force: true }),
          ...stored.derivatives.map((item) => rm(item.path, { force: true })),
        ]);
      }
      throw error;
    }
  }

  async remove(memberId: string, state: AiPresenterMediaState, actorUserId?: string | null) {
    const removed = await deleteAiPresenterMedia(memberId, state);
    if (!removed)
      throw Object.assign(new Error('Für diesen Zustand ist kein Avatar-Video gespeichert.'), { statusCode: 404 });
    await this.removeManagedMedia(removed);
    await recordAiStaffActivity({
      staffMemberId: memberId,
      eventType: 'presenter_media_removed',
      title: `${state === 'idle' ? 'Ruhevideo' : 'Sprechvideo'} entfernt`,
      status: 'ready',
      actorUserId,
      metadata: { state },
    }).catch(() => null);
    return this.list();
  }

  async mediaFile(memberId: string, state: AiPresenterMediaState) {
    const media = await getAiPresenterMedia(memberId, state);
    if (!media) return null;
    return {
      buffer: await readFile(resolvedStoredPath(media.rendered_path)),
      revision: media.sha256,
    };
  }

  async testVoice(memberId: string, text: string) {
    const profile = await getAiPresenterProfile(memberId);
    if (!profile) throw Object.assign(new Error('On-Air-Agent nicht gefunden.'), { statusCode: 404 });
    const audio = await generateTtsAudio(
      text,
      ttsEnvironmentForAiPresenter(memberId, process.env, profile.tts_voice || undefined),
    );
    return {
      ok: true,
      engine: audio.engine,
      configuredEngine: audio.configuredEngine,
      voice: audio.voice,
      durationSeconds: audio.durationSeconds,
      audioUrl: `/api/tts/test/audio?file=${encodeURIComponent(audio.file)}`,
    };
  }
}

export function registerAiPresenterMediaRoutes(
  app: FastifyInstance,
  manager: AiPresenterMediaManager,
  requirePermission: RequirePermission,
) {
  app.get('/api/ai-presenters', async (request, reply) => {
    requirePermission(request, reply, 'users:write');
    return manager.list();
  });
  app.patch('/api/ai-presenters/:memberId', async (request, reply) => {
    requirePermission(request, reply, 'users:write');
    const memberId = memberIdSchema.parse((request.params as { memberId?: unknown }).memberId);
    const body = z
      .object({ voice: z.string().trim().min(1).max(500) })
      .strict()
      .parse(request.body ?? {});
    return manager.saveVoice(memberId, body.voice, request.user?.id);
  });
  app.post('/api/ai-presenters/:memberId/media/:state', async (request, reply) => {
    requirePermission(request, reply, 'users:write');
    const params = z.object({ memberId: memberIdSchema, state: mediaStateSchema }).parse(request.params);
    const query = z.object({ greenScreen: z.enum(['true', 'false']).default('true') }).parse(request.query ?? {});
    const file = await request.file();
    if (!file) return reply.code(400).send({ error: 'Bitte eine MP4-, MOV- oder WebM-Datei auswählen.' });
    return manager.upload(params.memberId, params.state, file, query.greenScreen === 'true', request.user?.id);
  });
  app.delete('/api/ai-presenters/:memberId/media/:state', async (request, reply) => {
    requirePermission(request, reply, 'users:write');
    const params = z.object({ memberId: memberIdSchema, state: mediaStateSchema }).parse(request.params);
    return manager.remove(params.memberId, params.state, request.user?.id);
  });
  app.post('/api/ai-presenters/:memberId/test-voice', async (request, reply) => {
    requirePermission(request, reply, 'users:write');
    const memberId = memberIdSchema.parse((request.params as { memberId?: unknown }).memberId);
    const body = z
      .object({ text: z.string().trim().min(1).max(600) })
      .strict()
      .parse(request.body ?? {});
    return manager.testVoice(memberId, body.text);
  });
  app.get('/api/overlay/ai-presenters/:memberId/:state', async (request, reply) => {
    const params = z.object({ memberId: memberIdSchema, state: mediaStateSchema }).parse(request.params);
    const media = await manager.mediaFile(params.memberId, params.state).catch(() => null);
    if (!media) return reply.code(404).send({ error: 'Avatar-Video nicht verfügbar' });
    return reply
      .header('Cache-Control', 'public, max-age=31536000, immutable')
      .header('ETag', `"${media.revision}"`)
      .type('video/webm')
      .send(media.buffer);
  });
}
