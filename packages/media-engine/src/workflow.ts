import { basename } from 'node:path';
import {
  approveArticleMediaCandidate,
  getArticleMediaCandidate,
  getArticleMediaReadiness,
  listArticleMediaCandidates,
  markArticleMediaCandidate,
  upsertArticleMediaCandidates,
} from '@ans/database/article-media';
import { getArticleDetail } from '@ans/database';
import { downloadRemoteImage, downloadRemoteVideo } from './index.js';
import { bestDownloadableVideo, discoverArticleMedia } from './discovery.js';

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

export async function importArticleMediaCandidate(
  articleId: string,
  candidateId: string,
  options: { env?: NodeJS.ProcessEnv; userId?: string | null } = {},
) {
  const env = options.env ?? process.env;
  const candidate = await getArticleMediaCandidate(articleId, candidateId);
  if (!candidate) throw new Error('Medienkandidat nicht gefunden');
  if (!candidate.download_url) throw new Error('Dieser Treffer besitzt keine herunterladbare Mediendatei');
  if (candidate.rights_status !== 'approved') {
    throw new Error('Nutzungsrechte müssen vor dem Import redaktionell bestätigt werden');
  }
  const hosts = allowedHosts(candidate.metadata ?? {});
  if (!hosts.length) throw new Error('Der Medienanbieter hat keine freigegebenen Download-Hosts hinterlegt');
  await markArticleMediaCandidate(articleId, candidateId, 'importing', null, options.userId);
  try {
    if (candidate.kind === 'video') {
      const stored = await downloadRemoteVideo({
        url: candidate.download_url,
        allowedHosts: hosts,
        directory: mediaDirectory(env),
        filename: safeFilename(candidate.title, `${candidate.provider_asset_id}.mp4`),
        declaredMime: candidate.mime_type ?? undefined,
        maxBytes: Number(env.MEDIA_MAX_VIDEO_BYTES ?? 250 * 1024 * 1024),
        maxDurationSeconds: Number(env.MEDIA_MAX_VIDEO_DURATION_SECONDS ?? 180),
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
      });
    }
    if (candidate.kind === 'image' || candidate.kind === 'graphic') {
      const stored = await downloadRemoteImage({
        url: candidate.download_url,
        allowedHosts: hosts,
        directory: mediaDirectory(env),
        filename: safeFilename(candidate.title, `${candidate.provider_asset_id}.jpg`),
        declaredMime: candidate.mime_type ?? undefined,
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
      });
    }
    throw new Error('Dieser Kandidat ist keine importierbare Video- oder Bilddatei');
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
  let imported = null;
  if (!readiness.ready && (options.autoImport ?? env.MEDIA_AUTO_IMPORT_VIDEO !== 'false')) {
    const best = bestDownloadableVideo(discovery.candidates);
    if (best) {
      const stored = storedCandidates.find(
        (candidate) =>
          candidate.provider === best.provider &&
          candidate.provider_asset_id === best.providerAssetId &&
          candidate.kind === best.kind,
      );
      if (stored) {
        imported = await importArticleMediaCandidate(articleId, stored.id, { env, userId: options.userId });
        readiness = await getArticleMediaReadiness(articleId);
      }
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
