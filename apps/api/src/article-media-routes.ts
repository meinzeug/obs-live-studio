import type { FastifyInstance, FastifyRequest } from 'fastify';
import { z } from 'zod';
import {
  getArticleMediaReadiness,
  listArticleMediaCandidates,
  markArticleMediaCandidate,
  queueArticleMediaDiscovery,
} from '@ans/database/article-media';
import { discoverAndImportArticleMedia, importArticleMediaCandidate } from '@ans/media-engine/workflow';

function articleId(req: FastifyRequest) {
  return String((req.params as any)?.id ?? '');
}

function publicCandidate(candidate: any) {
  const { download_url: _downloadUrl, metadata, ...rest } = candidate;
  const safeMetadata = metadata && typeof metadata === 'object' ? { ...metadata } : {};
  delete safeMetadata.allowedDownloadHosts;
  return { ...rest, metadata: safeMetadata };
}

export function installArticleMediaRoutes(app: FastifyInstance) {
  app.addHook('preHandler', async (req, reply) => {
    const path = req.url.split('?', 1)[0];
    const approval = path.match(/^\/api\/articles\/([0-9a-f-]+)\/status$/i);
    if (req.method === 'POST' && approval && (req.body as any)?.status === 'approved') {
      const readiness = await getArticleMediaReadiness(approval[1]);
      if (!readiness.ready) {
        return reply.code(409).send({
          error: 'Der Beitrag benötigt vor der Freigabe mindestens ein geprüftes lokales Video.',
          mediaReadiness: readiness,
        });
      }
    }
  });

  app.addHook('onResponse', async (req, reply) => {
    const path = req.url.split('?', 1)[0];
    const processed = path.match(/^\/api\/articles\/([0-9a-f-]+)\/process$/i);
    if (req.method === 'POST' && processed && reply.statusCode < 400) {
      await queueArticleMediaDiscovery(processed[1]).catch(() => undefined);
    }
  });

  app.get('/api/articles/:id/media', async (req) => {
    const id = articleId(req);
    const [readiness, candidates] = await Promise.all([
      getArticleMediaReadiness(id),
      listArticleMediaCandidates(id),
    ]);
    return { readiness, candidates: candidates.map(publicCandidate) };
  });

  app.post('/api/articles/:id/media/discover', async (req, reply) => {
    if (!req.user || (req.user.role !== 'administrator' && !req.user.permissions.includes('articles:write'))) {
      return reply.code(403).send({ error: 'Keine Berechtigung für die Medienrecherche' });
    }
    const body = z.object({ background: z.boolean().default(false) }).parse(req.body ?? {});
    const id = articleId(req);
    if (body.background) {
      const job = await queueArticleMediaDiscovery(id);
      return { queued: true, jobId: job?.id ?? null };
    }
    const result = await discoverAndImportArticleMedia(id, { userId: req.user.id });
    return { ...result, candidates: result.candidates.map(publicCandidate) };
  });

  app.post('/api/articles/:id/media/:candidateId/import', async (req, reply) => {
    if (!req.user || (req.user.role !== 'administrator' && !req.user.permissions.includes('articles:write'))) {
      return reply.code(403).send({ error: 'Keine Berechtigung für den Medienimport' });
    }
    const candidateId = z.string().uuid().parse((req.params as any).candidateId);
    await importArticleMediaCandidate(articleId(req), candidateId, { userId: req.user.id });
    const [readiness, candidates] = await Promise.all([
      getArticleMediaReadiness(articleId(req)),
      listArticleMediaCandidates(articleId(req)),
    ]);
    return { readiness, candidates: candidates.map(publicCandidate) };
  });

  app.post('/api/articles/:id/media/:candidateId/reject', async (req, reply) => {
    if (!req.user || (req.user.role !== 'administrator' && !req.user.permissions.includes('articles:write'))) {
      return reply.code(403).send({ error: 'Keine Berechtigung für die Medienauswahl' });
    }
    const candidateId = z.string().uuid().parse((req.params as any).candidateId);
    return markArticleMediaCandidate(articleId(req), candidateId, 'rejected', null, req.user.id);
  });
}
