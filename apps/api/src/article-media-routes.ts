import type { FastifyInstance, FastifyRequest } from 'fastify';
import { z } from 'zod';
import {
  approveArticleMediaCandidate,
  getArticleMediaReadiness,
  listArticleMediaCandidates,
  markArticleMediaCandidate,
  queueArticleMediaDiscovery,
  setArticleMediaCandidateRights,
  upsertArticleMediaCandidates,
} from '@ans/database/article-media';
import { getAutopilotConfig, getPublishedMainArticle } from '@ans/database';
import { discoverAndImportArticleMedia, importArticleMediaCandidate } from '@ans/media-engine/workflow';
import { storeUploadedVideo } from '@ans/media-engine/video-upload';

function articleId(req: FastifyRequest) {
  return String((req.params as any)?.id ?? '');
}

function canEdit(req: FastifyRequest) {
  return Boolean(req.user && (req.user.role === 'administrator' || req.user.permissions.includes('articles:write')));
}

function safeHttpUrl(value: unknown) {
  if (typeof value !== 'string' || !value.trim()) return null;
  try {
    const url = new URL(value);
    if (url.protocol !== 'http:' && url.protocol !== 'https:') return null;
    if (url.username || url.password) return null;
    return url.toString();
  } catch {
    return null;
  }
}

function localArticleMediaUrl(id: string) {
  const base = safeHttpUrl(process.env.APP_URL) ?? 'http://127.0.0.1:12000/';
  return new URL(`/api/articles/${encodeURIComponent(id)}/media`, base).toString();
}

function publicCandidate(candidate: any) {
  const { metadata, ...rest } = candidate;
  delete rest.download_url;
  delete rest.storage_path;
  const safeMetadata = metadata && typeof metadata === 'object' ? { ...metadata } : {};
  delete safeMetadata.allowedDownloadHosts;
  return {
    ...rest,
    source_url: safeHttpUrl(rest.source_url) ?? localArticleMediaUrl(String(candidate.article_id ?? '')),
    preview_url: safeHttpUrl(rest.preview_url),
    embed_url: safeHttpUrl(rest.embed_url),
    license_url: safeHttpUrl(rest.license_url),
    metadata: safeMetadata,
  };
}

async function mediaState(id: string) {
  const [readiness, candidates] = await Promise.all([getArticleMediaReadiness(id), listArticleMediaCandidates(id)]);
  return { readiness, candidates: candidates.map(publicCandidate) };
}

function fieldValue(fields: Record<string, any>, name: string) {
  const value = fields[name]?.value;
  return typeof value === 'string' ? value.trim() : '';
}

function derivativeMap(
  derivatives: Array<{
    label: string;
    path: string;
    width: number;
    height: number;
    mime: string;
    sizeBytes: number;
  }>,
) {
  return Object.fromEntries(
    derivatives.map((derivative) => [
      derivative.label,
      {
        path: derivative.path,
        width: derivative.width,
        height: derivative.height,
        mime: derivative.mime,
        sizeBytes: derivative.sizeBytes,
      },
    ]),
  );
}

export function installArticleMediaRoutes(app: FastifyInstance) {
  app.addHook('preHandler', async (req, reply) => {
    const path = req.url.split('?', 1)[0];
    const approval = path.match(/^\/api\/articles\/([0-9a-f-]+)\/status$/i);
    if (req.method === 'POST' && approval && (req.body as any)?.status === 'approved') {
      if (!(await getAutopilotConfig()).requireVideo) return;
      const readiness = await getArticleMediaReadiness(approval[1]);
      if (!readiness.ready) {
        return reply.code(409).send({
          error: 'Der Beitrag benötigt vor der Freigabe mindestens ein geprüftes lokales Video.',
          mediaReadiness: readiness,
        });
      }
    }
    if (req.method === 'POST' && path === '/api/obs/test-contribution') {
      if (!(await getAutopilotConfig()).requireVideo) return;
      const requestedId = typeof (req.body as any)?.articleId === 'string' ? (req.body as any).articleId : null;
      const selected = requestedId ? { id: requestedId } : await getPublishedMainArticle();
      if (selected?.id) {
        const readiness = await getArticleMediaReadiness(selected.id);
        if (!readiness.ready) {
          return reply.code(409).send({
            error: 'Der Testbeitrag benötigt mindestens ein geprüftes lokales Video.',
            mediaReadiness: readiness,
          });
        }
      }
    }
  });

  app.addHook('onResponse', async (req, reply) => {
    const path = req.url.split('?', 1)[0];
    const processed = path.match(/^\/api\/articles\/([0-9a-f-]+)\/(?:process|ai)$/i);
    if (req.method === 'POST' && processed && reply.statusCode < 400) {
      await queueArticleMediaDiscovery(processed[1]).catch(() => undefined);
    }
  });

  app.get('/api/articles/:id/media', async (req) => mediaState(articleId(req)));

  app.post('/api/articles/:id/media/discover', async (req, reply) => {
    if (!canEdit(req)) return reply.code(403).send({ error: 'Keine Berechtigung für die Medienrecherche' });
    const body = z.object({ background: z.boolean().default(false) }).parse(req.body ?? {});
    const id = articleId(req);
    if (body.background) {
      const job = await queueArticleMediaDiscovery(id);
      return { queued: true, jobId: job?.id ?? null };
    }
    const result = await discoverAndImportArticleMedia(id, { userId: req.user!.id });
    return { ...result, candidates: result.candidates.map(publicCandidate) };
  });

  app.post('/api/articles/:id/media/upload', async (req, reply) => {
    if (!canEdit(req)) return reply.code(403).send({ error: 'Keine Berechtigung für den Video-Upload' });
    const file = await req.file();
    if (!file) return reply.code(400).send({ error: 'Videodatei fehlt' });
    const fields = file.fields as Record<string, any>;
    if (fieldValue(fields, 'rightsConfirmed') !== 'true') {
      file.file.resume();
      return reply.code(400).send({ error: 'Die Nutzungsrechte müssen vor dem Upload ausdrücklich bestätigt werden.' });
    }
    const stored = await storeUploadedVideo({
      stream: file.file,
      declaredMime: file.mimetype,
      directory: process.env.MEDIA_DIRECTORY ?? process.env.MEDIA_UPLOAD_DIR ?? './var/media',
      maxBytes: Number(process.env.MEDIA_MAX_VIDEO_BYTES ?? 250 * 1024 * 1024),
      maxDurationSeconds: Number(process.env.MEDIA_MAX_VIDEO_DURATION_SECONDS ?? 180),
      ffprobeExecutable: process.env.FFPROBE_EXECUTABLE,
      ffmpegExecutable: process.env.FFMPEG_EXECUTABLE,
    });
    const id = articleId(req);
    const source = safeHttpUrl(fieldValue(fields, 'source')) ?? localArticleMediaUrl(id);
    const licenseName = fieldValue(fields, 'license') || 'Eigene oder redaktionell freigegebene Aufnahme';
    const author = fieldValue(fields, 'author') || req.user!.display_name || req.user!.email;
    const [candidate] = await upsertArticleMediaCandidates(id, [
      {
        kind: 'video',
        provider: 'manual-upload',
        providerAssetId: stored.sha256,
        title: file.filename,
        searchQuery: 'manueller Upload',
        sourceUrl: source,
        mimeType: stored.mime,
        durationSeconds: stored.durationSeconds,
        width: stored.width,
        height: stored.height,
        author,
        licenseName,
        attribution: `${file.filename} – ${author} – ${licenseName}`,
        relevanceScore: 100,
        rightsStatus: 'approved',
        status: 'candidate',
        metadata: { manualUpload: true, originalFilename: file.filename },
      },
    ]);
    await approveArticleMediaCandidate({
      articleId: id,
      candidateId: candidate.id,
      userId: req.user!.id,
      filename: file.filename,
      mimeType: stored.mime,
      sizeBytes: stored.size,
      storagePath: stored.originalPath,
      sha256: stored.sha256,
      durationSeconds: stored.durationSeconds,
      width: stored.width,
      height: stored.height,
      derivativePaths: derivativeMap(stored.derivatives),
    });
    return mediaState(id);
  });

  app.post('/api/articles/:id/media/:candidateId/rights', async (req, reply) => {
    if (!canEdit(req)) return reply.code(403).send({ error: 'Keine Berechtigung für die Rechteprüfung' });
    const candidateId = z
      .string()
      .uuid()
      .parse((req.params as any).candidateId);
    const { rightsStatus } = z
      .object({ rightsStatus: z.enum(['approved', 'review', 'restricted', 'unknown']) })
      .parse(req.body);
    if (rightsStatus === 'restricted') {
      await markArticleMediaCandidate(
        articleId(req),
        candidateId,
        'rejected',
        'Nutzungsrechte redaktionell abgelehnt',
        req.user!.id,
      );
    } else {
      await setArticleMediaCandidateRights(articleId(req), candidateId, rightsStatus, req.user!.id);
    }
    return mediaState(articleId(req));
  });

  app.post('/api/articles/:id/media/:candidateId/import', async (req, reply) => {
    if (!canEdit(req)) return reply.code(403).send({ error: 'Keine Berechtigung für den Medienimport' });
    const candidateId = z
      .string()
      .uuid()
      .parse((req.params as any).candidateId);
    const { confirmRights } = z.object({ confirmRights: z.boolean().default(false) }).parse(req.body ?? {});
    if (confirmRights) {
      await setArticleMediaCandidateRights(articleId(req), candidateId, 'approved', req.user!.id);
    }
    await importArticleMediaCandidate(articleId(req), candidateId, { userId: req.user!.id });
    return mediaState(articleId(req));
  });

  app.post('/api/articles/:id/media/:candidateId/reject', async (req, reply) => {
    if (!canEdit(req)) return reply.code(403).send({ error: 'Keine Berechtigung für die Medienauswahl' });
    const candidateId = z
      .string()
      .uuid()
      .parse((req.params as any).candidateId);
    await markArticleMediaCandidate(articleId(req), candidateId, 'rejected', null, req.user!.id);
    return mediaState(articleId(req));
  });
}
