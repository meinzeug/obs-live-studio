import { createReadStream } from 'node:fs';
import { access, rm, stat } from 'node:fs/promises';
import { basename, extname, isAbsolute, relative, resolve, sep } from 'node:path';
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import type { FastifyInstance, FastifyReply, FastifyRequest } from 'fastify';
import { z } from 'zod';
import { storeUploadedAudio } from '@ans/media-engine/audio-upload';
import { storeUploadedVideo } from '@ans/media-engine/video-upload';
import { storeUploadedImage } from '@ans/media-engine';
import { auditLog } from '@ans/database/auth';
import { getMediaAsset, getYoutubeVideo, listYoutubeVideos } from '@ans/database';
import {
  addVideoEditorSource,
  cancelVideoEditorRender,
  createVideoEditorMediaAsset,
  createVideoEditorProject,
  defaultVideoEditorDocument,
  deleteVideoEditorSource,
  duplicateVideoEditorProject,
  getVideoEditorProject,
  getVideoEditorRender,
  getVideoEditorSource,
  listVideoEditorMediaAssets,
  listVideoEditorProjects,
  markVideoEditorSourceRemote,
  normalizeVideoEditorDocument,
  queueVideoEditorSourceDownload,
  queueVideoEditorRenders,
  retryVideoEditorRender,
  softDeleteVideoEditorProject,
  updateVideoEditorProject,
  videoEditorDuration,
  type VideoEditorDocument,
  type VideoEditorSource,
} from '@ans/database/video-editor';
import type { WritePermission } from '@ans/security/auth';
import {
  resolveYoutubeLiveSource,
  resolveYoutubeOEmbedMetadata,
  resolveYoutubeVideoMetadata,
} from './youtube-live-source.js';
import { PROJECT_ROOT } from './project-root.js';

type RequirePermission = (request: FastifyRequest, reply: FastifyReply, permission: WritePermission) => unknown;
type EmitUpdate = (reason: string, payload?: Record<string, unknown>) => Promise<void>;

const execFileAsync = promisify(execFile);
const editorRoot = resolve(PROJECT_ROOT, 'var/media/video-editor');
const uploadRoot = resolve(editorRoot, 'uploads');
const renderRoot = resolve(editorRoot, 'renders');
const downloadRoot = resolve(PROJECT_ROOT, 'downloads/youtube-video-editor');
const youtubeDownloadQualitySchema = z.enum(['best', '720p', '1080p', '1440p']);

const colorSchema = z.string().regex(/^#[0-9a-f]{6}$/i);
const timelineIdSchema = z
  .string()
  .trim()
  .min(1)
  .max(100)
  .regex(/^[a-zA-Z0-9_-]+$/);
const clipSchema = z
  .object({
    id: timelineIdSchema,
    sourceId: z.string().uuid(),
    name: z.string().trim().min(1).max(160),
    sourceStart: z.number().min(0).max(21_600),
    duration: z.number().min(0.25).max(21_600),
    volume: z.number().min(0).max(2),
    fit: z.enum(['contain', 'cover']),
    transition: z.enum([
      'cut',
      'fade',
      'dissolve',
      'fadeblack',
      'wipeleft',
      'wiperight',
      'slideleft',
      'slideright',
      'smoothleft',
      'smoothright',
      'circleopen',
      'pixelize',
    ]),
    transitionDuration: z.number().min(0.1).max(3),
    effect: z.enum(['none', 'cinematic', 'warm', 'cool', 'monochrome', 'high-contrast', 'soft', 'sharpen']),
    effectIntensity: z.number().min(0).max(1),
    motion: z.enum(['none', 'zoom-in', 'zoom-out', 'pan-left', 'pan-right']),
  })
  .strict();
const audioTrackSchema = z
  .object({
    id: timelineIdSchema,
    sourceId: z.string().uuid(),
    name: z.string().trim().min(1).max(160),
    startAt: z.number().min(0).max(21_600),
    sourceStart: z.number().min(0).max(21_600),
    duration: z.number().min(0.25).max(21_600),
    volume: z.number().min(0).max(2),
    fadeIn: z.number().min(0).max(10),
    fadeOut: z.number().min(0).max(10),
    muted: z.boolean(),
  })
  .strict();
const textTrackSchema = z
  .object({
    id: timelineIdSchema,
    text: z.string().trim().min(1).max(2_000),
    startAt: z.number().min(0).max(21_600),
    duration: z.number().min(0.25).max(21_600),
    x: z.number().min(0).max(1_000),
    y: z.number().min(0).max(1_000),
    width: z.number().min(80).max(1_000),
    fontFamily: z.enum(['dejavu-sans', 'ibm-plex-sans', 'ibm-plex-condensed', 'liberation-sans']),
    fontSize: z.number().int().min(16).max(180),
    fontWeight: z.enum(['regular', 'semibold', 'bold']),
    color: colorSchema,
    backgroundColor: colorSchema,
    backgroundOpacity: z.number().min(0).max(1),
    opacity: z.number().min(0).max(1),
    outlineColor: colorSchema,
    outlineWidth: z.number().int().min(0).max(12),
    shadowColor: colorSchema,
    shadowX: z.number().int().min(-30).max(30),
    shadowY: z.number().int().min(-30).max(30),
    align: z.enum(['left', 'center', 'right']),
    animation: z.enum(['none', 'fade', 'rise', 'slide-left', 'slide-right']),
  })
  .strict();
const imageTrackSchema = z
  .object({
    id: timelineIdSchema,
    sourceId: z.string().uuid(),
    name: z.string().trim().min(1).max(160),
    startAt: z.number().min(0).max(21_600),
    duration: z.number().min(0.25).max(21_600),
    x: z.number().min(0).max(1_000),
    y: z.number().min(0).max(1_000),
    width: z.number().min(20).max(1_000),
    height: z.number().min(20).max(1_000),
    opacity: z.number().min(0).max(1),
    rotation: z.number().min(-180).max(180),
    fit: z.enum(['contain', 'cover']),
    animation: z.enum(['none', 'fade', 'rise', 'slide-left', 'slide-right']),
  })
  .strict();
const documentSchema = z
  .object({
    version: z.literal(1),
    canvas: z
      .object({
        aspectRatio: z.enum(['16:9', '9:16', '1:1']),
        backgroundColor: colorSchema,
        fps: z.union([z.literal(25), z.literal(30), z.literal(50), z.literal(60)]),
      })
      .strict(),
    clips: z.array(clipSchema).max(100),
    audioTracks: z.array(audioTrackSchema).max(30),
    textTracks: z.array(textTrackSchema).max(50),
    imageTracks: z.array(imageTrackSchema).max(30),
  })
  .strict();

const projectCreateSchema = z
  .object({
    name: z.string().trim().min(2).max(180),
    description: z.string().trim().max(2_000).nullable().optional(),
    aspectRatio: z.enum(['16:9', '9:16', '1:1']).default('16:9'),
  })
  .strict();
const projectUpdateSchema = z
  .object({
    name: z.string().trim().min(2).max(180).optional(),
    description: z.string().trim().max(2_000).nullable().optional(),
    document: documentSchema.optional(),
    expectedRevision: z.number().int().min(1),
  })
  .strict();

function httpError(statusCode: number, message: string) {
  return Object.assign(new Error(message), { statusCode });
}

function managedPath(path: string, root: string) {
  const absolute = resolve(path);
  const relativePath = relative(root, absolute);
  return (
    relativePath !== '' && relativePath !== '..' && !relativePath.startsWith(`..${sep}`) && !isAbsolute(relativePath)
  );
}

function resolvedStoredPath(path: string) {
  return isAbsolute(path) ? resolve(path) : resolve(PROJECT_ROOT, path);
}

async function sendFile(
  reply: FastifyReply,
  request: FastifyRequest,
  path: string,
  mimeType: string,
  downloadName?: string,
) {
  const filePath = resolvedStoredPath(path);
  const info = await stat(filePath).catch(() => null);
  if (!info?.isFile()) return reply.code(404).send({ error: 'Mediendatei nicht gefunden.' });
  const safeName = downloadName?.replace(/[^a-zA-Z0-9äöüÄÖÜß._ -]+/gu, '_').slice(0, 180);
  if (safeName) reply.header('content-disposition', `attachment; filename*=UTF-8''${encodeURIComponent(safeName)}`);
  const range = request.headers.range?.match(/^bytes=(\d*)-(\d*)$/);
  if (!range) {
    return reply
      .header('accept-ranges', 'bytes')
      .header('content-length', info.size)
      .type(mimeType)
      .send(createReadStream(filePath));
  }
  const suffixLength = !range[1] && range[2] ? Number(range[2]) : null;
  const start = suffixLength !== null ? Math.max(0, info.size - suffixLength) : range[1] ? Number(range[1]) : 0;
  const end =
    suffixLength !== null ? info.size - 1 : range[2] ? Math.min(info.size - 1, Number(range[2])) : info.size - 1;
  if (!Number.isFinite(start) || !Number.isFinite(end) || start < 0 || start >= info.size || start > end)
    return reply.code(416).header('content-range', `bytes */${info.size}`).send();
  return reply
    .code(206)
    .header('accept-ranges', 'bytes')
    .header('content-range', `bytes ${start}-${end}/${info.size}`)
    .header('content-length', end - start + 1)
    .type(mimeType)
    .send(createReadStream(filePath, { start, end }));
}

function publicSource(source: VideoEditorSource) {
  const safe = Object.fromEntries(Object.entries(source).filter(([key]) => key !== 'local_path'));
  return {
    ...safe,
    fileUrl:
      source.local_path && source.status === 'ready' ? `/api/youtube-video-editor/sources/${source.id}/file` : null,
    thumbnailUrl:
      source.source_kind === 'media' && (source.media_type === 'video' || source.media_type === 'image')
        ? `/api/youtube-video-editor/sources/${source.id}/thumbnail`
        : source.preview_url,
    embedUrl: source.youtube_video_id
      ? `https://www.youtube-nocookie.com/embed/${encodeURIComponent(source.youtube_video_id)}?controls=1&rel=0&playsinline=1`
      : null,
  };
}

function publicRender(render: Awaited<ReturnType<typeof getVideoEditorRender>>) {
  if (!render) return null;
  const safe = Object.fromEntries(
    Object.entries(render).filter(
      ([key]) => key !== 'output_path' && key !== 'thumbnail_path' && key !== 'document_snapshot',
    ),
  );
  return {
    ...safe,
    videoUrl: render.output_path ? `/api/youtube-video-editor/renders/${render.id}/video` : null,
    downloadUrl: render.output_path ? `/api/youtube-video-editor/renders/${render.id}/video?download=1` : null,
    thumbnailUrl: render.thumbnail_path ? `/api/youtube-video-editor/renders/${render.id}/thumbnail` : null,
  };
}

function publicDetail(detail: NonNullable<Awaited<ReturnType<typeof getVideoEditorProject>>>) {
  return {
    project: detail.project,
    sources: detail.sources.map(publicSource),
    renders: detail.renders.map((render) => publicRender(render)!),
  };
}

async function validateDocument(projectId: string, document: VideoEditorDocument) {
  const detail = await getVideoEditorProject(projectId);
  if (!detail) throw httpError(404, 'Video-Projekt nicht gefunden.');
  const sources = new Map(detail.sources.map((source) => [source.id, source]));
  for (const clip of document.clips) {
    const source = sources.get(clip.sourceId);
    if (!source || source.media_type !== 'video') throw httpError(422, `Videoquelle für „${clip.name}“ fehlt.`);
    if (clip.sourceStart + clip.duration > Number(source.duration_seconds) + 0.5)
      throw httpError(422, `„${clip.name}“ reicht über das Ende der Quelle hinaus.`);
  }
  const duration = videoEditorDuration(document);
  if (!document.clips.length) return detail;
  if (duration > 21_600) throw httpError(422, 'Das Projekt darf höchstens sechs Stunden lang sein.');
  for (const track of document.audioTracks) {
    const source = sources.get(track.sourceId);
    if (!source) throw httpError(422, `Audioquelle für „${track.name}“ fehlt.`);
    if (track.sourceStart + track.duration > Number(source.duration_seconds) + 0.5)
      throw httpError(422, `„${track.name}“ reicht über das Ende der Audioquelle hinaus.`);
    if (track.startAt + track.duration > duration + 0.5)
      throw httpError(422, `„${track.name}“ reicht über das Ende der Timeline hinaus.`);
  }
  for (const track of document.textTracks) {
    if (track.startAt + track.duration > duration + 0.5)
      throw httpError(422, `Die Textspur „${track.text.slice(0, 40)}“ reicht über die Timeline hinaus.`);
  }
  for (const track of document.imageTracks) {
    const source = sources.get(track.sourceId);
    if (!source || source.media_type !== 'image') throw httpError(422, `Bildquelle für „${track.name}“ fehlt.`);
    if (track.startAt + track.duration > duration + 0.5)
      throw httpError(422, `Die Grafik „${track.name}“ reicht über die Timeline hinaus.`);
  }
  return detail;
}

async function mediaDuration(asset: any) {
  const stored = Number(asset.duration_seconds ?? asset.metadata?.durationSeconds);
  if (Number.isFinite(stored) && stored > 0) return stored;
  const { stdout } = await execFileAsync(
    process.env.FFPROBE_EXECUTABLE || 'ffprobe',
    [
      '-v',
      'error',
      '-show_entries',
      'format=duration',
      '-of',
      'default=nw=1:nk=1',
      resolvedStoredPath(asset.storage_path),
    ],
    { timeout: 20_000, maxBuffer: 1024 * 1024 },
  );
  const duration = Number(stdout.trim());
  if (!Number.isFinite(duration) || duration <= 0) throw httpError(422, `Laufzeit von „${asset.filename}“ fehlt.`);
  return duration;
}

async function importYoutubeDownloadSource(input: {
  projectId: string;
  rawUrl: string;
  quality: z.infer<typeof youtubeDownloadQualitySchema>;
  mode: 'video' | 'audio';
  library?: Awaited<ReturnType<typeof listYoutubeVideos>>;
}) {
  const youtube = resolveYoutubeLiveSource(input.rawUrl);
  const library = input.library ?? (await listYoutubeVideos());
  const existing = library.find((video) => video.video_id === youtube.videoId);
  const [metadata, oembed] = await Promise.all([
    existing
      ? Promise.resolve({
          durationSeconds: Number(existing.duration_seconds),
          channelTitle: existing.channel_title,
          publishedAt: existing.published_at,
        })
      : resolveYoutubeVideoMetadata(youtube.videoId, { apiKey: process.env.YOUTUBE_DATA_API_KEY }).catch(() => ({
          durationSeconds: 0.25,
          channelTitle: 'YouTube',
          publishedAt: null,
        })),
    existing
      ? Promise.resolve({ title: existing.title, channelTitle: existing.channel_title, channelUrl: null })
      : resolveYoutubeOEmbedMetadata(youtube.videoId).catch(() => ({
          title: `YouTube Video ${youtube.videoId}`,
          channelTitle: 'YouTube',
          channelUrl: null,
        })),
  ]);
  const quality = input.mode === 'audio' ? 'audio' : input.quality;
  const added = await addVideoEditorSource({
    project_id: input.projectId,
    source_kind: existing ? 'youtube-library' : 'youtube-url',
    youtube_library_id: existing?.id ?? null,
    media_asset_id: null,
    youtube_video_id: youtube.videoId,
    source_url: youtube.canonicalUrl,
    title: existing?.title || oembed.title,
    channel_title: existing?.channel_title || metadata.channelTitle || oembed.channelTitle,
    media_type: input.mode === 'audio' ? 'audio' : 'video',
    duration_seconds: metadata.durationSeconds,
    preview_url: youtube.previewUrl,
    local_path: null,
    status: 'queued',
    sort_order: 0,
    downloadQuality: quality,
    downloadMode: input.mode,
  });
  if (
    added.created ||
    added.source.status !== 'ready' ||
    added.source.download_quality !== quality ||
    added.source.download_mode !== input.mode
  ) {
    return (await queueVideoEditorSourceDownload(added.source.id, { quality, mode: input.mode })) ?? added.source;
  }
  return added.source;
}

function sourceMime(source: VideoEditorSource, mediaMime?: string | null) {
  if (mediaMime) return mediaMime;
  const extension = extname(source.local_path || '').toLowerCase();
  if (source.media_type === 'image')
    return extension === '.webp'
      ? 'image/webp'
      : extension === '.jpg' || extension === '.jpeg'
        ? 'image/jpeg'
        : 'image/png';
  if (source.media_type === 'audio')
    return extension === '.mp3' ? 'audio/mpeg' : extension === '.wav' ? 'audio/wav' : 'audio/mp4';
  return extension === '.webm' ? 'video/webm' : 'video/mp4';
}

export function registerYoutubeVideoEditorRoutes(
  app: FastifyInstance,
  requirePermission: RequirePermission,
  emitUpdate: EmitUpdate,
) {
  app.get('/api/youtube-video-editor', async () => {
    const [projects, youtubeVideos, mediaAssets] = await Promise.all([
      listVideoEditorProjects(),
      listYoutubeVideos(),
      listVideoEditorMediaAssets(),
    ]);
    return {
      projects,
      library: {
        youtube: youtubeVideos.map((video) => ({
          id: video.id,
          title: video.title,
          channelTitle: video.channel_title,
          durationSeconds: Number(video.duration_seconds),
          url: video.url,
          videoId: video.video_id,
          thumbnailUrl: `https://i.ytimg.com/vi/${encodeURIComponent(video.video_id)}/hqdefault.jpg`,
          categoryName: video.category_name ?? null,
        })),
        media: mediaAssets.map((asset) => ({
          ...Object.fromEntries(
            Object.entries(asset).filter(([key]) => key !== 'storage_path' && key !== 'derivative_paths'),
          ),
          duration_seconds: Number(asset.duration_seconds ?? 0),
          kind: asset.mime_type.startsWith('audio/')
            ? 'audio'
            : asset.mime_type.startsWith('image/')
              ? 'image'
              : 'video',
          fileUrl: `/api/youtube-video-editor/assets/${asset.id}/file`,
          thumbnailUrl:
            asset.mime_type.startsWith('video/') || asset.mime_type.startsWith('image/')
              ? `/api/youtube-video-editor/assets/${asset.id}/thumbnail`
              : null,
        })),
      },
      capabilities: {
        qualities: ['720p', '1080p', '1440p'],
        downloadQualities: ['best', '720p', '1080p', '1440p'],
        downloadModes: ['video', 'audio'],
        formats: ['16:9', '9:16', '1:1'],
        maxProjectSeconds: 21_600,
        maxDownloadBytes: Math.max(
          10 * 1024 * 1024,
          Math.min(20 * 1024 * 1024 * 1024, Number(process.env.VIDEO_EDITOR_MAX_DOWNLOAD_BYTES) || 4 * 1024 ** 3),
        ),
        ytDlp: true,
        ffmpeg: true,
      },
    };
  });

  app.post('/api/download', async (request, reply) => {
    requirePermission(request, reply, 'broadcast:write');
    const input = z
      .object({
        url: z.string().trim().url().max(1_000),
        projectId: z.string().uuid().optional(),
        quality: youtubeDownloadQualitySchema.default('best'),
        audioOnly: z.boolean().default(false),
      })
      .strict()
      .parse(request.body ?? {});
    let projectId = input.projectId;
    let createdProject = false;
    if (projectId) {
      if (!(await getVideoEditorProject(projectId)))
        return reply.code(404).send({ error: 'Video-Projekt nicht gefunden.' });
    } else {
      const project = await createVideoEditorProject({
        name: `YouTube-Import ${new Date().toLocaleDateString('de-DE')}`,
        createdBy: request.user?.id,
      });
      projectId = project.id;
      createdProject = true;
    }
    try {
      const source = await importYoutubeDownloadSource({
        projectId,
        rawUrl: input.url,
        quality: input.quality,
        mode: input.audioOnly ? 'audio' : 'video',
      });
      if (createdProject) {
        const detail = await getVideoEditorProject(projectId);
        if (detail)
          await updateVideoEditorProject(projectId, {
            name: source.title,
            expectedRevision: detail.project.revision,
          });
      }
      await auditLog(
        request.user?.id ?? null,
        'video_editor.download.queue',
        'youtube_video_editor_sources',
        source.id,
        {
          projectId,
          quality: input.quality,
          mode: input.audioOnly ? 'audio' : 'video',
        },
      );
      await emitUpdate('download-queued', { projectId, sourceId: source.id });
      const publicValue = publicSource(source);
      return reply.code(source.status === 'ready' ? 200 : 202).send({
        projectId,
        source: publicValue,
        statusUrl: `/api/download/${source.id}`,
        path: publicValue.fileUrl,
      });
    } catch (error) {
      if (createdProject) await softDeleteVideoEditorProject(projectId).catch(() => null);
      throw error;
    }
  });

  app.get('/api/download/:id', async (request, reply) => {
    const id = z
      .string()
      .uuid()
      .parse((request.params as { id: string }).id);
    const source = await getVideoEditorSource(id);
    if (!source || source.source_kind === 'media')
      return reply.code(404).send({ error: 'YouTube-Download nicht gefunden.' });
    const publicValue = publicSource(source);
    return {
      projectId: source.project_id,
      status: source.status,
      progress: source.download_progress,
      error: source.error,
      metadata: source.download_metadata,
      path: publicValue.fileUrl,
      source: publicValue,
    };
  });

  app.post('/api/youtube-video-editor/projects', async (request, reply) => {
    requirePermission(request, reply, 'broadcast:write');
    const input = projectCreateSchema.parse(request.body ?? {});
    const document = defaultVideoEditorDocument();
    document.canvas.aspectRatio = input.aspectRatio;
    const project = await createVideoEditorProject({
      name: input.name,
      description: input.description,
      createdBy: request.user?.id,
      document,
    });
    await auditLog(
      request.user?.id ?? null,
      'video_editor.project.create',
      'youtube_video_editor_projects',
      project.id,
    );
    await emitUpdate('project-created', { projectId: project.id });
    return reply.code(201).send(project);
  });

  app.get('/api/youtube-video-editor/projects/:id', async (request, reply) => {
    const id = z
      .string()
      .uuid()
      .parse((request.params as { id: string }).id);
    const detail = await getVideoEditorProject(id);
    if (!detail) return reply.code(404).send({ error: 'Video-Projekt nicht gefunden.' });
    return publicDetail(detail);
  });

  app.patch('/api/youtube-video-editor/projects/:id', async (request, reply) => {
    requirePermission(request, reply, 'broadcast:write');
    const id = z
      .string()
      .uuid()
      .parse((request.params as { id: string }).id);
    const input = projectUpdateSchema.parse(request.body ?? {});
    const document = input.document ? normalizeVideoEditorDocument(input.document) : undefined;
    if (document) await validateDocument(id, document);
    const saved = await updateVideoEditorProject(id, { ...input, document });
    if (saved.reason === 'not-found') return reply.code(404).send({ error: 'Video-Projekt nicht gefunden.' });
    if (saved.reason === 'conflict')
      return reply
        .code(409)
        .send({ error: 'Das Projekt wurde zwischenzeitlich geändert. Bitte neu laden.', project: saved.project });
    await auditLog(request.user?.id ?? null, 'video_editor.project.update', 'youtube_video_editor_projects', id, {
      revision: saved.project?.revision,
    });
    await emitUpdate('project-updated', { projectId: id });
    return saved.project;
  });

  app.post('/api/youtube-video-editor/projects/:id/duplicate', async (request, reply) => {
    requirePermission(request, reply, 'broadcast:write');
    const id = z
      .string()
      .uuid()
      .parse((request.params as { id: string }).id);
    const project = await duplicateVideoEditorProject(id, request.user?.id);
    if (!project) return reply.code(404).send({ error: 'Video-Projekt nicht gefunden.' });
    await auditLog(
      request.user?.id ?? null,
      'video_editor.project.duplicate',
      'youtube_video_editor_projects',
      project.id,
      {
        sourceProjectId: id,
      },
    );
    await emitUpdate('project-duplicated', { projectId: project.id, sourceProjectId: id });
    return reply.code(201).send(project);
  });

  app.delete('/api/youtube-video-editor/projects/:id', async (request, reply) => {
    requirePermission(request, reply, 'broadcast:write');
    const id = z
      .string()
      .uuid()
      .parse((request.params as { id: string }).id);
    const detail = await getVideoEditorProject(id);
    if (!detail) return reply.code(404).send({ error: 'Video-Projekt nicht gefunden.' });
    if (detail.renders.some((render) => render.status === 'rendering'))
      return reply.code(409).send({ error: 'Das Projekt wird gerade gerendert und kann noch nicht gelöscht werden.' });
    if (detail.sources.some((source) => source.status === 'downloading'))
      return reply.code(409).send({ error: 'Das Projekt lädt gerade eine YouTube-Quelle. Bitte kurz warten.' });
    const removed = await softDeleteVideoEditorProject(id);
    const paths = [...(removed?.output_paths ?? []), ...(removed?.thumbnail_paths ?? [])];
    await Promise.all(
      paths.map(async (path) => {
        const absolute = resolvedStoredPath(path);
        if (managedPath(absolute, renderRoot)) await rm(absolute, { force: true });
      }),
    );
    const projectDownloadDirectory = resolve(downloadRoot, id);
    if (managedPath(projectDownloadDirectory, downloadRoot))
      await rm(projectDownloadDirectory, { recursive: true, force: true });
    await auditLog(request.user?.id ?? null, 'video_editor.project.delete', 'youtube_video_editor_projects', id);
    await emitUpdate('project-deleted', { projectId: id });
    return { deleted: true };
  });

  app.post('/api/youtube-video-editor/projects/:id/sources/youtube', async (request, reply) => {
    requirePermission(request, reply, 'broadcast:write');
    const projectId = z
      .string()
      .uuid()
      .parse((request.params as { id: string }).id);
    if (!(await getVideoEditorProject(projectId)))
      return reply.code(404).send({ error: 'Video-Projekt nicht gefunden.' });
    const input = z
      .object({
        urls: z.array(z.string().trim().url().max(1_000)).min(1).max(20),
        quality: youtubeDownloadQualitySchema.default('best'),
        audioOnly: z.boolean().default(false),
      })
      .strict()
      .parse(request.body ?? {});
    const library = await listYoutubeVideos();
    const results: Array<{ url: string; source?: ReturnType<typeof publicSource>; error?: string }> = [];
    for (const rawUrl of [...new Set(input.urls)]) {
      try {
        const source = await importYoutubeDownloadSource({
          projectId,
          rawUrl,
          quality: input.quality,
          mode: input.audioOnly ? 'audio' : 'video',
          library,
        });
        results.push({ url: rawUrl, source: publicSource(source) });
      } catch (error) {
        results.push({ url: rawUrl, error: error instanceof Error ? error.message : String(error) });
      }
    }
    const imported = results.filter((result) => result.source).length;
    if (!imported) return reply.code(422).send({ error: 'Keine der YouTube-URLs konnte übernommen werden.', results });
    await auditLog(
      request.user?.id ?? null,
      'video_editor.sources.youtube',
      'youtube_video_editor_projects',
      projectId,
      {
        requested: input.urls.length,
        imported,
        quality: input.quality,
        mode: input.audioOnly ? 'audio' : 'video',
      },
    );
    await emitUpdate('sources-added', { projectId, imported });
    return { imported, failed: results.length - imported, results };
  });

  app.post('/api/youtube-video-editor/projects/:id/sources/library', async (request, reply) => {
    requirePermission(request, reply, 'broadcast:write');
    const projectId = z
      .string()
      .uuid()
      .parse((request.params as { id: string }).id);
    if (!(await getVideoEditorProject(projectId)))
      return reply.code(404).send({ error: 'Video-Projekt nicht gefunden.' });
    const input = z
      .object({
        youtubeVideoIds: z.array(z.string().uuid()).max(50).default([]),
        mediaAssetIds: z.array(z.string().uuid()).max(50).default([]),
        quality: youtubeDownloadQualitySchema.default('best'),
        audioOnly: z.boolean().default(false),
      })
      .strict()
      .parse(request.body ?? {});
    const sources: VideoEditorSource[] = [];
    for (const id of [...new Set(input.youtubeVideoIds)]) {
      const video = await getYoutubeVideo(id);
      if (!video) continue;
      const added = await addVideoEditorSource({
        project_id: projectId,
        source_kind: 'youtube-library',
        youtube_library_id: video.id,
        media_asset_id: null,
        youtube_video_id: video.video_id,
        source_url: video.url,
        title: video.title,
        channel_title: video.channel_title,
        media_type: input.audioOnly ? 'audio' : 'video',
        duration_seconds: Number(video.duration_seconds),
        preview_url: `https://i.ytimg.com/vi/${encodeURIComponent(video.video_id)}/hqdefault.jpg`,
        local_path: null,
        status: 'queued',
        sort_order: 0,
        downloadQuality: input.audioOnly ? 'audio' : input.quality,
        downloadMode: input.audioOnly ? 'audio' : 'video',
      });
      const source =
        added.created ||
        added.source.status !== 'ready' ||
        added.source.download_quality !== (input.audioOnly ? 'audio' : input.quality) ||
        added.source.download_mode !== (input.audioOnly ? 'audio' : 'video')
          ? await queueVideoEditorSourceDownload(added.source.id, {
              quality: input.audioOnly ? 'audio' : input.quality,
              mode: input.audioOnly ? 'audio' : 'video',
            })
          : added.source;
      if (source) sources.push(source);
    }
    for (const id of [...new Set(input.mediaAssetIds)]) {
      const asset = await getMediaAsset(id);
      if (
        !asset?.storage_path ||
        (!asset.mime_type?.startsWith('video/') &&
          !asset.mime_type?.startsWith('audio/') &&
          !asset.mime_type?.startsWith('image/'))
      )
        continue;
      await access(resolvedStoredPath(asset.storage_path)).catch(() => {
        throw httpError(422, `Die Mediendatei „${asset.filename}“ fehlt lokal.`);
      });
      const added = await addVideoEditorSource({
        project_id: projectId,
        source_kind: 'media',
        youtube_library_id: null,
        media_asset_id: asset.id,
        youtube_video_id: null,
        source_url: null,
        title: asset.filename,
        channel_title: asset.source || 'Mediathek',
        media_type: asset.mime_type.startsWith('audio/')
          ? 'audio'
          : asset.mime_type.startsWith('image/')
            ? 'image'
            : 'video',
        duration_seconds: asset.mime_type.startsWith('image/') ? 21_600 : await mediaDuration(asset),
        preview_url: null,
        local_path: asset.storage_path,
        status: 'ready',
        sort_order: 0,
      });
      sources.push(added.source);
    }
    await auditLog(
      request.user?.id ?? null,
      'video_editor.sources.library',
      'youtube_video_editor_projects',
      projectId,
      {
        imported: sources.length,
      },
    );
    await emitUpdate('sources-added', { projectId, imported: sources.length });
    return { imported: sources.length, sources: sources.map(publicSource) };
  });

  app.post('/api/youtube-video-editor/projects/:id/sources/upload', async (request, reply) => {
    requirePermission(request, reply, 'broadcast:write');
    const projectId = z
      .string()
      .uuid()
      .parse((request.params as { id: string }).id);
    if (!(await getVideoEditorProject(projectId)))
      return reply.code(404).send({ error: 'Video-Projekt nicht gefunden.' });
    const file = await request.file();
    if (!file) throw httpError(400, 'Mediendatei fehlt.');
    let asset: Awaited<ReturnType<typeof createVideoEditorMediaAsset>>;
    if (file.mimetype.startsWith('video/')) {
      const stored = await storeUploadedVideo({
        stream: file.file,
        declaredMime: file.mimetype,
        directory: uploadRoot,
        maxDurationSeconds: 21_600,
      });
      asset = await createVideoEditorMediaAsset({
        filename: file.filename,
        mimeType: stored.mime,
        sizeBytes: stored.size,
        storagePath: stored.originalPath,
        sha256: stored.sha256,
        durationSeconds: stored.durationSeconds,
        resolution: `${stored.width}x${stored.height}`,
        metadata: { width: stored.width, height: stored.height },
        derivativePaths: Object.fromEntries(
          stored.derivatives.map((derivative) => [
            derivative.label,
            {
              path: derivative.path,
              width: derivative.width,
              height: derivative.height,
              mime: derivative.mime,
              sizeBytes: derivative.sizeBytes,
            },
          ]),
        ),
        usage: 'video-editor-source',
      });
    } else if (file.mimetype.startsWith('audio/')) {
      const stored = await storeUploadedAudio({
        stream: file.file,
        declaredMime: file.mimetype,
        directory: uploadRoot,
      });
      asset = await createVideoEditorMediaAsset({
        filename: file.filename,
        mimeType: stored.mime,
        sizeBytes: stored.size,
        storagePath: stored.originalPath,
        sha256: stored.sha256,
        durationSeconds: stored.durationSeconds,
        metadata: { codec: stored.codec, sampleRate: stored.sampleRate, channels: stored.channels },
        usage: 'video-editor-audio',
      });
    } else if (file.mimetype.startsWith('image/')) {
      const stored = await storeUploadedImage({
        stream: file.file,
        filename: file.filename,
        declaredMime: file.mimetype,
        directory: uploadRoot,
      });
      asset = await createVideoEditorMediaAsset({
        filename: file.filename,
        mimeType: stored.mime,
        sizeBytes: stored.size,
        storagePath: stored.originalPath,
        sha256: stored.sha256,
        durationSeconds: 0,
        resolution: `${stored.width}x${stored.height}`,
        metadata: { width: stored.width, height: stored.height },
        derivativePaths: Object.fromEntries(
          stored.derivatives.map((derivative) => [
            derivative.label,
            {
              path: derivative.path,
              width: derivative.width,
              height: derivative.height,
              mime: derivative.mime,
              sizeBytes: derivative.sizeBytes,
            },
          ]),
        ),
        usage: 'video-editor-image',
      });
    } else {
      throw httpError(415, 'Bitte eine Video-, Audio- oder Bilddatei auswählen.');
    }
    const added = await addVideoEditorSource({
      project_id: projectId,
      source_kind: 'media',
      youtube_library_id: null,
      media_asset_id: asset.id,
      youtube_video_id: null,
      source_url: null,
      title: asset.filename,
      channel_title: 'Eigene Mediathek',
      media_type: asset.mime_type.startsWith('audio/')
        ? 'audio'
        : asset.mime_type.startsWith('image/')
          ? 'image'
          : 'video',
      duration_seconds: asset.mime_type.startsWith('image/') ? 21_600 : Number(asset.duration_seconds),
      preview_url: null,
      local_path: asset.storage_path,
      status: 'ready',
      sort_order: 0,
    });
    await auditLog(request.user?.id ?? null, 'video_editor.source.upload', 'youtube_video_editor_projects', projectId, {
      mediaAssetId: asset.id,
      mediaType: added.source.media_type,
    });
    await emitUpdate('source-uploaded', { projectId, sourceId: added.source.id });
    return reply.code(201).send(publicSource(added.source));
  });

  app.delete('/api/youtube-video-editor/projects/:projectId/sources/:sourceId', async (request, reply) => {
    requirePermission(request, reply, 'broadcast:write');
    const params = z.object({ projectId: z.string().uuid(), sourceId: z.string().uuid() }).parse(request.params);
    const source = await getVideoEditorSource(params.sourceId);
    if (source?.status === 'downloading')
      return reply.code(409).send({ error: 'Der laufende Download muss zuerst abgeschlossen werden.' });
    const result = await deleteVideoEditorSource(params.projectId, params.sourceId);
    if (!result.rowCount)
      return reply.code(409).send({ error: 'Quelle wird noch in einer Video- oder Audiospur verwendet.' });
    if (source?.local_path && source.source_kind !== 'media') {
      const absolute = resolvedStoredPath(source.local_path);
      if (managedPath(absolute, downloadRoot)) await rm(absolute, { force: true });
    }
    await emitUpdate('source-deleted', { projectId: params.projectId, sourceId: params.sourceId });
    return { deleted: true };
  });

  app.post('/api/youtube-video-editor/sources/:id/download', async (request, reply) => {
    requirePermission(request, reply, 'broadcast:write');
    const id = z
      .string()
      .uuid()
      .parse((request.params as { id: string }).id);
    const input = z
      .object({ quality: youtubeDownloadQualitySchema.default('best'), audioOnly: z.boolean().default(false) })
      .strict()
      .parse(request.body ?? {});
    const source = await getVideoEditorSource(id);
    if (!source || source.source_kind === 'media')
      return reply.code(404).send({ error: 'YouTube-Quelle nicht gefunden.' });
    if (source.status === 'downloading')
      return reply.code(409).send({ error: 'Der Download dieser Quelle läuft bereits.' });
    const queued = await queueVideoEditorSourceDownload(id, {
      quality: input.audioOnly ? 'audio' : input.quality,
      mode: input.audioOnly ? 'audio' : 'video',
    });
    if (!queued) return reply.code(409).send({ error: 'Die Quelle konnte nicht eingeplant werden.' });
    await auditLog(request.user?.id ?? null, 'video_editor.download.retry', 'youtube_video_editor_sources', id, {
      quality: input.quality,
      mode: input.audioOnly ? 'audio' : 'video',
    });
    await emitUpdate('download-queued', { projectId: source.project_id, sourceId: id });
    return reply.code(202).send(publicSource(queued));
  });

  app.delete('/api/youtube-video-editor/sources/:id/local-file', async (request, reply) => {
    requirePermission(request, reply, 'broadcast:write');
    const id = z
      .string()
      .uuid()
      .parse((request.params as { id: string }).id);
    const source = await getVideoEditorSource(id);
    if (!source || source.source_kind === 'media')
      return reply.code(404).send({ error: 'Heruntergeladene YouTube-Quelle nicht gefunden.' });
    if (source.status === 'downloading')
      return reply.code(409).send({ error: 'Ein laufender Download kann nicht gelöscht werden.' });
    if (source.local_path) {
      const absolute = resolvedStoredPath(source.local_path);
      if (!managedPath(absolute, downloadRoot)) return reply.code(403).send({ error: 'Ungültiger Downloadpfad.' });
      await rm(absolute, { force: true });
    }
    const updated = await markVideoEditorSourceRemote(id);
    await auditLog(request.user?.id ?? null, 'video_editor.download.delete', 'youtube_video_editor_sources', id);
    await emitUpdate('download-deleted', { projectId: source.project_id, sourceId: id });
    return { deleted: true, source: updated ? publicSource(updated) : null };
  });

  app.post('/api/youtube-video-editor/projects/:id/render', async (request, reply) => {
    requirePermission(request, reply, 'broadcast:write');
    const projectId = z
      .string()
      .uuid()
      .parse((request.params as { id: string }).id);
    const input = z
      .object({
        qualities: z
          .array(z.enum(['720p', '1080p', '1440p']))
          .min(1)
          .max(3),
      })
      .strict()
      .parse(request.body ?? {});
    const detail = await getVideoEditorProject(projectId);
    if (!detail) return reply.code(404).send({ error: 'Video-Projekt nicht gefunden.' });
    const document = normalizeVideoEditorDocument(detail.project.document);
    if (!document.clips.length) return reply.code(422).send({ error: 'Lege mindestens einen Clip in die Timeline.' });
    await validateDocument(projectId, document);
    const usedSourceIds = new Set([
      ...document.clips.map((clip) => clip.sourceId),
      ...document.audioTracks.map((track) => track.sourceId),
      ...document.imageTracks.map((track) => track.sourceId),
    ]);
    const unavailable = detail.sources.filter(
      (source) => usedSourceIds.has(source.id) && source.source_kind !== 'media' && source.status !== 'ready',
    );
    if (unavailable.length)
      return reply.code(409).send({
        error: 'Der Export wartet noch auf lokal heruntergeladene YouTube-Quellen.',
        sources: unavailable.map((source) => ({ id: source.id, title: source.title, status: source.status })),
      });
    const renders = await queueVideoEditorRenders(projectId, input.qualities);
    if (!renders) return reply.code(404).send({ error: 'Video-Projekt nicht gefunden.' });
    await auditLog(request.user?.id ?? null, 'video_editor.render.queue', 'youtube_video_editor_projects', projectId, {
      qualities: input.qualities,
      revision: detail.project.revision,
    });
    await emitUpdate('render-queued', { projectId, renderIds: renders.map((render) => render.id) });
    return reply.code(202).send({ renders: renders.map((render) => publicRender(render)!) });
  });

  app.post('/api/youtube-video-editor/renders/:id/:action', async (request, reply) => {
    requirePermission(request, reply, 'broadcast:write');
    const params = z.object({ id: z.string().uuid(), action: z.enum(['retry', 'cancel']) }).parse(request.params);
    const render =
      params.action === 'retry' ? await retryVideoEditorRender(params.id) : await cancelVideoEditorRender(params.id);
    if (!render) return reply.code(409).send({ error: 'Aktion ist im aktuellen Renderstatus nicht möglich.' });
    await emitUpdate(`render-${params.action}`, { projectId: render.project_id, renderId: render.id });
    return publicRender(render);
  });

  app.get('/api/youtube-video-editor/renders/:id/video', async (request, reply) => {
    const id = z
      .string()
      .uuid()
      .parse((request.params as { id: string }).id);
    const render = await getVideoEditorRender(id);
    if (!render?.output_path) return reply.code(404).send({ error: 'Renderdatei ist noch nicht verfügbar.' });
    if (!managedPath(resolvedStoredPath(render.output_path), renderRoot))
      return reply.code(403).send({ error: 'Ungültiger Renderpfad.' });
    const download = String((request.query as { download?: unknown }).download ?? '') === '1';
    const project = await getVideoEditorProject(render.project_id);
    const name = `${project?.project.name || 'youtube-video'}-${render.quality}.mp4`;
    return sendFile(reply, request, render.output_path, 'video/mp4', download ? name : undefined);
  });

  app.get('/api/youtube-video-editor/renders/:id/thumbnail', async (request, reply) => {
    const id = z
      .string()
      .uuid()
      .parse((request.params as { id: string }).id);
    const render = await getVideoEditorRender(id);
    if (!render?.thumbnail_path) return reply.code(404).send({ error: 'Vorschaubild ist noch nicht verfügbar.' });
    if (!managedPath(resolvedStoredPath(render.thumbnail_path), renderRoot))
      return reply.code(403).send({ error: 'Ungültiger Renderpfad.' });
    return sendFile(reply, request, render.thumbnail_path, 'image/jpeg');
  });

  app.get('/api/youtube-video-editor/sources/:id/file', async (request, reply) => {
    const id = z
      .string()
      .uuid()
      .parse((request.params as { id: string }).id);
    const source = await getVideoEditorSource(id);
    if (!source?.local_path || source.status !== 'ready')
      return reply.code(404).send({ error: 'Lokale Quelle nicht gefunden.' });
    const absolute = resolvedStoredPath(source.local_path);
    if (source.source_kind === 'media') {
      if (!source.media_asset_id) return reply.code(403).send({ error: 'Ungültige lokale Quelle.' });
    } else if (!managedPath(absolute, downloadRoot)) {
      return reply.code(403).send({ error: 'Ungültiger Downloadpfad.' });
    }
    const media = source.media_asset_id ? await getMediaAsset(source.media_asset_id) : null;
    return sendFile(reply, request, source.local_path, sourceMime(source, media?.mime_type));
  });

  app.get('/api/youtube-video-editor/sources/:id/thumbnail', async (request, reply) => {
    const id = z
      .string()
      .uuid()
      .parse((request.params as { id: string }).id);
    const source = await getVideoEditorSource(id);
    const media = source?.media_asset_id ? await getMediaAsset(source.media_asset_id) : null;
    const thumb = media?.derivative_paths?.thumb;
    if (!thumb?.path) return reply.code(404).send({ error: 'Vorschaubild nicht verfügbar.' });
    return sendFile(reply, request, thumb.path, thumb.mime || 'image/webp');
  });

  app.get('/api/youtube-video-editor/assets/:id/file', async (request, reply) => {
    const id = z
      .string()
      .uuid()
      .parse((request.params as { id: string }).id);
    const media = await getMediaAsset(id);
    if (
      !media?.storage_path ||
      (!media.mime_type?.startsWith('video/') &&
        !media.mime_type?.startsWith('audio/') &&
        !media.mime_type?.startsWith('image/'))
    )
      return reply.code(404).send({ error: 'Mediathek-Datei nicht gefunden.' });
    return sendFile(
      reply,
      request,
      media.storage_path,
      media.mime_type,
      String((request.query as any).download ?? '') === '1' ? basename(media.filename) : undefined,
    );
  });

  app.get('/api/youtube-video-editor/assets/:id/thumbnail', async (request, reply) => {
    const id = z
      .string()
      .uuid()
      .parse((request.params as { id: string }).id);
    const media = await getMediaAsset(id);
    const thumb = media?.derivative_paths?.thumb;
    if (!thumb?.path) return reply.code(404).send({ error: 'Vorschaubild nicht verfügbar.' });
    return sendFile(reply, request, thumb.path, thumb.mime || 'image/webp');
  });
}
