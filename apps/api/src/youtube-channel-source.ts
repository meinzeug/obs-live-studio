import { parseFeed } from '@ans/news-parser';
import { fetchHttpText } from '@ans/source-connectors';
import {
  createYoutubeVideo,
  finishMissingYoutubeLiveStreams,
  markSourceSuccess,
  recordSourceCheck,
} from '@ans/database';
import {
  resolveYoutubeLiveSource,
  resolveYoutubeOEmbedMetadata,
  resolveYoutubeVideoMetadata,
} from './youtube-live-source.js';

type FetchLike = typeof fetch;

export type YoutubeChannelImportSource = {
  id?: string | null;
  name: string;
  url: string;
  max_fetch_seconds?: number | null;
  max_articles?: number | null;
  etag?: string | null;
  last_modified?: string | null;
};

export type YoutubeChannelImportResult = {
  feedUrl: string;
  status: number;
  finalUrl: string;
  notModified: boolean;
  scanned: number;
  imported: number;
  skipped: number;
  errors: string[];
  liveScanned: number;
  liveImported: number;
};

type YoutubeChannelVideoCandidate = {
  videoId: string;
  url: string;
  title?: string | null;
  excerpt?: string | null;
  text?: string | null;
  publishedAt?: string | null;
};

function channelIdFromText(value: string) {
  return (
    /channel\/(UC[a-zA-Z0-9_-]{20,})/.exec(value)?.[1] ??
    /"channelId"\s*:\s*"(UC[a-zA-Z0-9_-]{20,})"/.exec(value)?.[1] ??
    /"browseId"\s*:\s*"(UC[a-zA-Z0-9_-]{20,})"/.exec(value)?.[1] ??
    /"externalId"\s*:\s*"(UC[a-zA-Z0-9_-]{20,})"/.exec(value)?.[1] ??
    null
  );
}

function userFromYoutubeUrl(url: URL) {
  const parts = url.pathname.split('/').filter(Boolean);
  if (parts[0] === 'user' && parts[1]) return parts[1];
  if (parts[0]?.startsWith('@')) return parts[0].slice(1);
  return null;
}

async function feedExists(url: string, fetchImpl?: FetchLike) {
  const response = await (fetchImpl ?? fetch)(url, { method: 'HEAD', signal: AbortSignal.timeout(8_000) }).catch(
    () => null,
  );
  return Boolean(response?.ok);
}

export async function resolveYoutubeChannelFeedUrl(
  sourceUrl: string,
  options: { fetchImpl?: FetchLike; userAgent?: string; timeoutMs?: number; maxBytes?: number } = {},
) {
  const url = new URL(sourceUrl);
  if (!/(^|\.)youtube\.com$/i.test(url.hostname) && !/(^|\.)youtube-nocookie\.com$/i.test(url.hostname)) {
    throw new Error('YouTube-Kanalquellen müssen eine youtube.com-URL verwenden.');
  }
  const directChannelId = channelIdFromText(sourceUrl) ?? url.searchParams.get('channel_id');
  if (directChannelId)
    return `https://www.youtube.com/feeds/videos.xml?channel_id=${encodeURIComponent(directChannelId)}`;
  if (url.pathname === '/feeds/videos.xml' && url.searchParams.has('channel_id')) return url.toString();

  const user = userFromYoutubeUrl(url);
  if (user) {
    const userFeed = `https://www.youtube.com/feeds/videos.xml?user=${encodeURIComponent(user)}`;
    if (await feedExists(userFeed, options.fetchImpl)) return userFeed;
  }

  const page = await fetchHttpText(sourceUrl, {
    timeoutMs: options.timeoutMs ?? 15_000,
    maxBytes: options.maxBytes ?? 8 * 1024 * 1024,
    allowPrivate: false,
    userAgent: options.userAgent ?? process.env.NEWS_USER_AGENT ?? 'OpenTVStudio/1.0',
  });
  const resolved = channelIdFromText(page.body);
  if (!resolved) throw new Error('YouTube-Kanal konnte nicht auf eine Channel-ID aufgelöst werden.');
  return `https://www.youtube.com/feeds/videos.xml?channel_id=${encodeURIComponent(resolved)}`;
}

function youtubeVideoIdFromFeedItem(item: { url?: string; canonicalUrl?: string }) {
  for (const candidate of [item.url, item.canonicalUrl]) {
    if (!candidate) continue;
    try {
      return resolveYoutubeLiveSource(candidate).videoId;
    } catch {
      // Try next candidate.
    }
  }
  return null;
}

export function extractYoutubeChannelVideoCandidates(html: string, limit = 100): YoutubeChannelVideoCandidate[] {
  const candidates: YoutubeChannelVideoCandidate[] = [];
  const seen = new Set<string>();
  for (const match of html.matchAll(/"videoId"\s*:\s*"([a-zA-Z0-9_-]{11})"/g)) {
    const videoId = match[1];
    if (!videoId || seen.has(videoId)) continue;
    seen.add(videoId);
    candidates.push({
      videoId,
      url: `https://www.youtube.com/watch?v=${encodeURIComponent(videoId)}`,
    });
    if (candidates.length >= limit) break;
  }
  return candidates;
}

function youtubeChannelVideosPageUrl(sourceUrl: string) {
  const url = new URL(sourceUrl);
  if (url.pathname === '/feeds/videos.xml') return null;
  const parts = url.pathname.split('/').filter(Boolean);
  const channelPath = parts[0]?.startsWith('@') || ['channel', 'c', 'user'].includes(parts[0] ?? '') ? parts : [];
  if (!channelPath.length) return null;
  return new URL(`/${channelPath.join('/')}/videos`, url.origin).toString();
}

function youtubeChannelLivePageUrl(feedUrl: string) {
  const channelId = new URL(feedUrl).searchParams.get('channel_id');
  return channelId ? `https://www.youtube.com/channel/${encodeURIComponent(channelId)}/live` : null;
}

export function extractActiveYoutubeLiveVideoIds(html: string, finalUrl = '') {
  const ids = new Set<string>();
  try {
    const resolved = resolveYoutubeLiveSource(finalUrl);
    if (/"isLiveNow"\s*:\s*true|\"isLive\"\s*:\s*true/.test(html)) ids.add(resolved.videoId);
  } catch {
    // Ein Kanal ohne laufende Sendung bleibt eine normale Kanalseite.
  }
  const videoMatches = [...html.matchAll(/"videoId"\s*:\s*"([a-zA-Z0-9_-]{11})"/g)];
  for (const [position, match] of videoMatches.entries()) {
    const videoId = match[1];
    if (!videoId) continue;
    const start = match.index ?? 0;
    const nextStart = videoMatches[position + 1]?.index;
    const end = Math.min(html.length, nextStart ?? start + 3_500);
    const neighborhood = html.slice(start, end);
    if (
      /"isLiveNow"\s*:\s*true|\"isLive\"\s*:\s*true|\"style\"\s*:\s*\"LIVE\"|BADGE_STYLE_TYPE_LIVE_NOW/.test(
        neighborhood,
      )
    )
      ids.add(videoId);
  }
  return [...ids].slice(0, 10);
}

async function createYoutubeVideoFromCandidate(
  candidate: YoutubeChannelVideoCandidate,
  source: YoutubeChannelImportSource,
  apiKey: string | null | undefined,
) {
  try {
    const metadata = await resolveYoutubeVideoMetadata(candidate.videoId, {
      apiKey: apiKey ?? process.env.YOUTUBE_DATA_API_KEY,
    });
    await createYoutubeVideo({
      title: candidate.title || `YouTube Video ${candidate.videoId}`,
      url: candidate.url,
      videoId: candidate.videoId,
      channelTitle: metadata.channelTitle || source.name,
      categoryId: null,
      description: candidate.excerpt || candidate.text || null,
      durationSeconds: metadata.durationSeconds,
      publishedAt: metadata.publishedAt ?? candidate.publishedAt ?? null,
      enabled: true,
      sourceId: source.id ?? null,
      liveStatus: metadata.liveStatus,
      liveScheduledStart: metadata.liveScheduledStart,
      liveActualStart: metadata.liveActualStart,
      liveActualEnd: metadata.liveActualEnd,
    });
    return null;
  } catch (metadataError) {
    try {
      const oembed = await resolveYoutubeOEmbedMetadata(candidate.videoId);
      await createYoutubeVideo({
        title: oembed.title || candidate.title || `YouTube Video ${candidate.videoId}`,
        url: candidate.url,
        videoId: candidate.videoId,
        channelTitle: oembed.channelTitle || source.name,
        categoryId: null,
        description: candidate.excerpt || candidate.text || null,
        durationSeconds: null,
        publishedAt: candidate.publishedAt ?? null,
        enabled: true,
        sourceId: source.id ?? null,
        liveStatus: 'unknown',
      });
      return metadataError instanceof Error ? metadataError.message : String(metadataError);
    } catch (oembedError) {
      throw new Error(
        [
          metadataError instanceof Error ? metadataError.message : String(metadataError),
          oembedError instanceof Error ? oembedError.message : String(oembedError),
        ].join(' | '),
      );
    }
  }
}

async function discoverYoutubeChannelLiveStreams(
  source: YoutubeChannelImportSource,
  feedUrl: string,
  options: { userAgent?: string; apiKey?: string | null },
) {
  const pageUrl = youtubeChannelLivePageUrl(feedUrl);
  if (!pageUrl) return { scanned: 0, imported: 0, activeVideoIds: [] as string[], errors: [] as string[] };
  const errors: string[] = [];
  let ids: string[] = [];
  try {
    const page = await fetchHttpText(pageUrl, {
      timeoutMs: Math.max(8_000, Math.min(30_000, Number(source.max_fetch_seconds ?? 20) * 1000)),
      maxBytes: 8 * 1024 * 1024,
      allowPrivate: false,
      userAgent: options.userAgent ?? process.env.NEWS_USER_AGENT ?? 'OpenTVStudio/1.0',
    });
    ids = extractActiveYoutubeLiveVideoIds(page.body, page.url);
  } catch (error) {
    errors.push(error instanceof Error ? error.message : String(error));
  }

  const activeVideoIds: string[] = [];
  let imported = 0;
  for (const videoId of ids) {
    try {
      const metadata = await resolveYoutubeVideoMetadata(videoId, {
        apiKey: options.apiKey ?? process.env.YOUTUBE_DATA_API_KEY,
      });
      if (metadata.liveStatus !== 'active') continue;
      const oembed = await resolveYoutubeOEmbedMetadata(videoId).catch(() => null);
      await createYoutubeVideo({
        title: oembed?.title || `YouTube Live ${videoId}`,
        url: `https://www.youtube.com/watch?v=${encodeURIComponent(videoId)}`,
        videoId,
        channelTitle: metadata.channelTitle || oembed?.channelTitle || source.name,
        durationSeconds: Math.max(3600, metadata.durationSeconds),
        publishedAt: metadata.publishedAt,
        enabled: true,
        sourceId: source.id ?? null,
        liveStatus: 'active',
        liveScheduledStart: metadata.liveScheduledStart,
        liveActualStart: metadata.liveActualStart,
        liveActualEnd: null,
      });
      activeVideoIds.push(videoId);
      imported++;
    } catch (error) {
      const metadataError = error instanceof Error ? error.message : String(error);
      const oembed = await resolveYoutubeOEmbedMetadata(videoId).catch(() => null);
      await createYoutubeVideo({
        title: oembed?.title || `YouTube Live ${videoId}`,
        url: `https://www.youtube.com/watch?v=${encodeURIComponent(videoId)}`,
        videoId,
        channelTitle: oembed?.channelTitle || source.name,
        durationSeconds: 6 * 60 * 60,
        publishedAt: null,
        enabled: true,
        sourceId: source.id ?? null,
        liveStatus: 'active',
        liveActualStart: null,
        liveActualEnd: null,
      });
      activeVideoIds.push(videoId);
      imported++;
      errors.push(`Live-Stream ohne Data-API-Metadaten übernommen: ${metadataError}`);
    }
  }
  if (source.id) await finishMissingYoutubeLiveStreams(source.id, activeVideoIds);
  return { scanned: ids.length, imported, activeVideoIds, errors };
}

export async function previewYoutubeChannelSource(url: string, options: { limit?: number; userAgent?: string } = {}) {
  const feedUrl = await resolveYoutubeChannelFeedUrl(url, { userAgent: options.userAgent });
  const fetched = await fetchHttpText(feedUrl, {
    timeoutMs: 12_000,
    maxBytes: 1024 * 1024,
    allowPrivate: false,
    userAgent: options.userAgent ?? process.env.NEWS_USER_AGENT ?? 'OpenTVStudio/1.0',
  });
  return {
    feedUrl,
    fetched,
    preview: parseFeed(fetched.body, fetched.url).slice(0, Math.max(1, Math.min(50, options.limit ?? 5))),
  };
}

export async function importYoutubeChannelVideos(
  source: YoutubeChannelImportSource,
  options: { limit?: number; userAgent?: string; apiKey?: string | null } = {},
): Promise<YoutubeChannelImportResult> {
  const startedAt = Date.now();
  const feedUrl = await resolveYoutubeChannelFeedUrl(source.url, { userAgent: options.userAgent });
  const live = await discoverYoutubeChannelLiveStreams(source, feedUrl, options);
  let fetched;
  const errors: string[] = [...live.errors];
  try {
    fetched = await fetchHttpText(feedUrl, {
      timeoutMs: Math.max(1, Number(source.max_fetch_seconds ?? 20)) * 1000,
      maxBytes: 1024 * 1024,
      etag: source.etag,
      lastModified: source.last_modified,
      allowPrivate: false,
      userAgent: options.userAgent ?? process.env.NEWS_USER_AGENT ?? 'OpenTVStudio/1.0',
    });
  } catch (error) {
    const feedError = error instanceof Error ? error.message : String(error);
    errors.push(feedError);
    const pageUrl = youtubeChannelVideosPageUrl(source.url);
    if (!pageUrl) throw error;
    fetched = await fetchHttpText(pageUrl, {
      timeoutMs: Math.max(1, Number(source.max_fetch_seconds ?? 20)) * 1000,
      maxBytes: 4 * 1024 * 1024,
      allowPrivate: false,
      userAgent: options.userAgent ?? process.env.NEWS_USER_AGENT ?? 'OpenTVStudio/1.0',
    });
  }
  if (fetched.notModified) {
    if (source.id) {
      await markSourceSuccess(source.id, fetched.etag, fetched.lastModified);
      await recordSourceCheck(source.id, 'ok', {
        type: 'youtube-channel',
        finalUrl: fetched.url,
        notModified: true,
        durationMs: Date.now() - startedAt,
      });
    }
    return {
      feedUrl,
      status: fetched.status,
      finalUrl: fetched.url,
      notModified: true,
      scanned: 0,
      imported: 0,
      skipped: 0,
      errors,
      liveScanned: live.scanned,
      liveImported: live.imported,
    };
  }

  const limit = Math.max(1, Math.min(100, Math.floor(Number(options.limit ?? source.max_articles ?? 20))));
  const feedLike = fetched.url.includes('/feeds/videos.xml') || fetched.contentType.includes('xml');
  const parsed = feedLike
    ? parseFeed(fetched.body, fetched.url)
        .slice(0, limit)
        .flatMap((item): YoutubeChannelVideoCandidate[] => {
          const videoId = youtubeVideoIdFromFeedItem(item);
          if (!videoId) return [];
          return [
            {
              videoId,
              url: item.url ?? item.canonicalUrl ?? `https://www.youtube.com/watch?v=${encodeURIComponent(videoId)}`,
              title: item.title,
              excerpt: item.excerpt,
              text: item.text,
              publishedAt: item.publishedAt,
            },
          ];
        })
    : extractYoutubeChannelVideoCandidates(fetched.body, limit);
  let imported = 0;
  let skipped = 0;
  for (const item of parsed) {
    try {
      const warning = await createYoutubeVideoFromCandidate(item, source, options.apiKey);
      if (warning) errors.push(warning);
      imported++;
    } catch (error) {
      skipped++;
      errors.push(error instanceof Error ? error.message : String(error));
    }
  }

  if (source.id) {
    await markSourceSuccess(source.id, fetched.etag, fetched.lastModified);
    await recordSourceCheck(source.id, 'ok', {
      type: 'youtube-channel',
      status: fetched.status,
      finalUrl: fetched.url,
      items: parsed.length,
      imported,
      skipped,
      errors: errors.slice(0, 5),
      liveScanned: live.scanned,
      liveImported: live.imported,
      durationMs: Date.now() - startedAt,
    });
  }
  return {
    feedUrl,
    status: fetched.status,
    finalUrl: fetched.url,
    notModified: false,
    scanned: parsed.length,
    imported,
    skipped,
    errors,
    liveScanned: live.scanned,
    liveImported: live.imported,
  };
}
