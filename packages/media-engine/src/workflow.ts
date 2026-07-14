import { basename } from 'node:path';
import {
  approveArticleMediaCandidate,
  getArticleMediaCandidate,
  getArticleMediaReadiness,
  listArticleMediaCandidates,
  markArticleMediaCandidate,
  upsertArticleMediaCandidates,
  type ArticleMediaCandidateInput,
  type ArticleMediaCandidateRecord,
} from '@ans/database/article-media';
import { getArticleDetail } from '@ans/database';
import { bestDownloadableVideo, discoverArticleMedia } from './discovery-v2.js';
import {
  createStatisticGraphic,
  downloadRemoteImageSecure,
  downloadRemoteVideoSecure,
} from './secure-download.js';

function mediaDirectory(env: NodeJS.ProcessEnv) {
  return env.MEDIA_DIRECTORY ?? env.MEDIA_UPLOAD_DIR ?? './var/media';
}

function safeFilename(title: string, fallback: string) {
  const value = basename(title)
    .replace(/[^\p{L}\p{N}._-]+/gu, '_')
    .replace(/^_+|_+$/g, '')
    .slice(0, 100);
  return value || fallback;
}

function allowedHosts(metadata: Record<string, unknown>) {
  return Array.isArray(metadata.allowedDownloadHosts)
    ? metadata.allowedDownloadHosts.map((host) => String(host)).filter(Boolean)
    : [];
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

function storedCandidate(
  storedCandidates: ArticleMediaCandidateRecord[],
  candidate: ArticleMediaCandidateInput | null | undefined,
) {
  if (!candidate) return null;
  return (
    storedCandidates.find(
      (stored) =>
        stored.provider === candidate.provider &&
        stored.provider_asset_id === candidate.providerAssetId &&
        stored.kind === candidate.kind,
    ) ?? null
  );
}

export async function importArticleMediaCandidate(
  articleId: string,
  candidateId: string,
  options: { env?: NodeJS.ProcessEnv; userId?: string | null } = {},
) {
  const env = options.env ?? process.env;
  const candidate = await getArticleMediaCandidate(articleId, candidateId);
  if (!candidate) throw new Error('Medienkandidat nicht gefunden');
  if (candidate.rights_status !== 'approved') {
    throw new Error('Nutzungsrechte müssen vor dem Import redaktionell bestätigt werden');
  }
  await markArticleMediaCandidate(articleId, candidateId, 'importing', null, options.userId);
  try {
    if (candidate.kind === 'statistic') {
      const statement = String(candidate.metadata?.statement ?? '').trim();
      if (!statement) throw new Error('Der Statistik-Kandidat enthält keine auswertbare Aussage');
      const stored = await createStatisticGraphic({
        statement,
        title: candidate.title,
        sourceLabel: candidate.attribution ?? 'Quelle: redaktionell geprüfter Beitrag',
        directory: mediaDirectory(env),
        filename: `${safeFilename(candidate.title, candidate.provider_asset_id)}.png`,
      });
      return approveArticleMediaCandidate({
        articleId,
        candidateId,
        userId: options.userId,
        filename: `${safeFilename(candidate.title, candidate.provider_asset_id)}.${stored.extension}`,
        mimeType: stored.mime,
        sizeBytes: stored.size,
        storagePath: stored.originalPath,
        sha256: stored.sha256,
        width: stored.width,
        height: stored.height,
        derivativePaths: derivativeMap(stored.derivatives),
      });
    }

    if (!candidate.download_url) throw new Error('Dieser Treffer besitzt keine herunterladbare Mediendatei');
    const hosts = allowedHosts(candidate.metadata ?? {});
    if (!hosts.length) throw new Error('Der Medienanbieter hat keine freigegebenen Download-Hosts hinterlegt');

    if (candidate.kind === 'video') {
      const stored = await downloadRemoteVideoSecure({
        url: candidate.download_url,
        allowedHosts: hosts,
        directory: mediaDirectory(env),
        filename: safeFilename(candidate.title, `${candidate.provider_asset_id}.mp4`),
        declaredMime: candidate.mime_type ?? undefined,
        maxBytes: Number(env.MEDIA_MAX_VIDEO_BYTES ?? 250 * 1024 * 1024),
        maxDurationSeconds: Number(env.MEDIA_MAX_VIDEO_DURATION_SECONDS ?? 180),
        timeoutMs: Number(env.MEDIA_DOWNLOAD_TIMEOUT_MS ?? 120_000),
        ffprobeExecutable: env.FFPROBE_EXECUTABLE,
        ffmpegExecutable: env.FFMPEG_EXECUTABLE,
      });
      return approveArticleMediaCandidate({
        articleId,
        candidateId,
        userId: options.userId,
        filename: `${safeFilename(candidate.title, candidate.provider_asset_id)}.${stored.extension}`,
        mimeType: stored.mime,
        sizeBytes: stored.size,
        storagePath: stored.originalPath,
        sha256: stored.sha256,
        durationSeconds: stored.durationSeconds,
        width: stored.width,
        height: stored.height,
        derivativePaths: derivativeMap(stored.derivatives),
      });
    }

    if (candidate.kind === 'image' || candidate.kind === 'graphic') {
      const stored = await downloadRemoteImageSecure({
        url: candidate.download_url,
        allowedHosts: hosts,
        directory: mediaDirectory(env),
        filename: safeFilename(candidate.title, `${candidate.provider_asset_id}.jpg`),
        declaredMime: candidate.mime_type ?? undefined,
        maxBytes: Number(env.MEDIA_MAX_IMAGE_BYTES ?? 15 * 1024 * 1024),
        timeoutMs: Number(env.MEDIA_DOWNLOAD_TIMEOUT_MS ?? 60_000),
      });
      return approveArticleMediaCandidate({
        articleId,
        candidateId,
        userId: options.userId,
        filename: safeFilename(candidate.title, `${candidate.provider_asset_id}.${stored.extension}`),
        mimeType: stored.mime,
        sizeBytes: stored.size,
        storagePath: stored.originalPath,
        sha256: stored.sha256,
        width: stored.width,
        height: stored.height,
        derivativePaths: derivativeMap(stored.derivatives),
      });
    }
    throw new Error('Dieser Kandidat ist keine importierbare Video-, Bild- oder Statistikdatei');
  } catch (error) {
    await markArticleMediaCandidate(
      articleId,
      candidateId,
      'failed',
      error instanceof Error ? error.message : String(error),
      options.userId,
    );
    throw error;
  }
}

function bestGraphicCandidate(candidates: ArticleMediaCandidateInput[]) {
  return (
    candidates
      .filter((candidate) => candidate.kind === 'statistic' && candidate.rightsStatus === 'approved')
      .sort((a, b) => (b.relevanceScore ?? 0) - (a.relevanceScore ?? 0))[0] ??
    candidates
      .filter(
        (candidate) =>
          (candidate.kind === 'image' || candidate.kind === 'graphic') &&
          candidate.rightsStatus === 'approved' &&
          Boolean(candidate.downloadUrl),
      )
      .sort((a, b) => (b.relevanceScore ?? 0) - (a.relevanceScore ?? 0))[0] ??
    null
  );
}

export async function discoverAndImportArticleMedia(
  articleId: string,
  options: { env?: NodeJS.ProcessEnv; userId?: string | null; autoImport?: boolean } = {},
) {
  const env = options.env ?? process.env;
  const article = await getArticleDetail(articleId);
  if (!article) throw new Error('Artikel nicht gefunden');
  const discovery = await discoverArticleMedia(article, env);
  const storedCandidates = await upsertArticleMediaCandidates(articleId, discovery.candidates);
  let readiness = await getArticleMediaReadiness(articleId);
  const imported: Array<unknown> = [];
  const autoImport = options.autoImport ?? env.MEDIA_AUTO_IMPORT_VIDEO !== 'false';

  if (!readiness.ready && autoImport) {
    const best = bestDownloadableVideo(discovery.candidates, env);
    const stored = storedCandidate(storedCandidates, best);
    if (stored) {
      imported.push(await importArticleMediaCandidate(articleId, stored.id, { env, userId: options.userId }));
      readiness = await getArticleMediaReadiness(articleId);
    }
  }

  if (Number(readiness.approved_graphics) < 1 && env.MEDIA_AUTO_IMPORT_GRAPHIC !== 'false') {
    const graphic = storedCandidate(storedCandidates, bestGraphicCandidate(discovery.candidates));
    if (graphic) {
      imported.push(await importArticleMediaCandidate(articleId, graphic.id, { env, userId: options.userId }));
      readiness = await getArticleMediaReadiness(articleId);
    }
  }

  return {
    query: discovery.query,
    providers: discovery.providers,
    candidates: await listArticleMediaCandidates(articleId),
    readiness,
    imported,
  };
}
