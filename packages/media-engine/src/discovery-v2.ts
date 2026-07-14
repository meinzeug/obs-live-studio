import type { ArticleMediaCandidateInput } from '@ans/database/article-media';
import {
  buildMediaSearchQuery,
  discoverArticleMedia as discoverBaseMedia,
  type MediaDiscoveryArticle,
  type MediaDiscoveryResult,
} from './discovery.js';

function cleanText(value: unknown) {
  return String(value ?? '')
    .replace(/<[^>]*>/g, ' ')
    .replace(/&amp;/g, '&')
    .replace(/&quot;/g, '"')
    .replace(/&#39;/g, "'")
    .replace(/\s+/g, ' ')
    .trim();
}

function relevance(title: string, query: string, bonus = 0) {
  const tokens = query.toLowerCase().split(/\s+/).filter(Boolean);
  const haystack = title.toLowerCase();
  return Math.min(100, bonus + tokens.reduce((score, token) => score + (haystack.includes(token) ? 8 : 0), 0));
}

async function fetchJson(url: URL, key: string, timeoutMs = 12_000) {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);
  try {
    const response = await fetch(url, {
      signal: controller.signal,
      headers: {
        Authorization: key,
        'user-agent': process.env.NEWS_USER_AGENT ?? 'OpenTVStudio/1.0',
      },
    });
    if (!response.ok) throw new Error(`HTTP ${response.status} von ${url.hostname}`);
    const text = await response.text();
    if (text.length > 3 * 1024 * 1024) throw new Error(`Antwort von ${url.hostname} ist zu groß`);
    return JSON.parse(text);
  } finally {
    clearTimeout(timer);
  }
}

async function searchPexelsV1(query: string, key: string): Promise<ArticleMediaCandidateInput[]> {
  const videoUrl = new URL('https://api.pexels.com/v1/videos/search');
  videoUrl.search = new URLSearchParams({
    query,
    per_page: '8',
    orientation: 'landscape',
    size: 'medium',
    locale: 'de-DE',
  }).toString();
  const photoUrl = new URL('https://api.pexels.com/v1/search');
  photoUrl.search = new URLSearchParams({
    query,
    per_page: '6',
    orientation: 'landscape',
    size: 'large',
    locale: 'de-DE',
  }).toString();
  const [videos, photos]: any[] = await Promise.all([fetchJson(videoUrl, key), fetchJson(photoUrl, key)]);
  const results: ArticleMediaCandidateInput[] = [];
  for (const video of videos?.videos ?? []) {
    const files = [...(video.video_files ?? [])]
      .filter((file: any) => file.link && file.file_type === 'video/mp4')
      .sort((a: any, b: any) => Math.abs((a.width ?? 0) - 1920) - Math.abs((b.width ?? 0) - 1920));
    const file = files[0];
    if (!file) continue;
    results.push({
      kind: 'video',
      provider: 'pexels',
      providerAssetId: String(video.id),
      title: cleanText(video.user?.name ? `${query} – ${video.user.name}` : query),
      searchQuery: query,
      sourceUrl: String(video.url),
      downloadUrl: String(file.link),
      previewUrl: String(video.image ?? ''),
      mimeType: 'video/mp4',
      durationSeconds: Number(video.duration) || null,
      width: Number(file.width) || null,
      height: Number(file.height) || null,
      author: cleanText(video.user?.name) || null,
      licenseName: 'Pexels License',
      licenseUrl: 'https://www.pexels.com/license/',
      attribution: video.user?.name ? `Video von ${video.user.name} auf Pexels` : 'Video von Pexels',
      relevanceScore: relevance(query, query, 35),
      rightsStatus: 'approved',
      metadata: { allowedDownloadHosts: ['videos.pexels.com'], providerPage: video.url },
    });
  }
  for (const photo of photos?.photos ?? []) {
    results.push({
      kind: 'image',
      provider: 'pexels',
      providerAssetId: String(photo.id),
      title: cleanText(photo.alt || query),
      searchQuery: query,
      sourceUrl: String(photo.url),
      downloadUrl: String(photo.src?.large2x ?? photo.src?.large ?? ''),
      previewUrl: String(photo.src?.medium ?? ''),
      mimeType: 'image/jpeg',
      width: Number(photo.width) || null,
      height: Number(photo.height) || null,
      author: cleanText(photo.photographer) || null,
      licenseName: 'Pexels License',
      licenseUrl: 'https://www.pexels.com/license/',
      attribution: photo.photographer ? `Foto von ${photo.photographer} auf Pexels` : 'Foto von Pexels',
      relevanceScore: relevance(photo.alt || query, query, 20),
      rightsStatus: 'approved',
      metadata: { allowedDownloadHosts: ['images.pexels.com'], providerPage: photo.url },
    });
  }
  return results;
}

export async function discoverArticleMedia(
  article: MediaDiscoveryArticle,
  env: NodeJS.ProcessEnv = process.env,
): Promise<MediaDiscoveryResult> {
  const query = buildMediaSearchQuery(article);
  const base = await discoverBaseMedia(article, { ...env, PEXELS_API_KEY: '' });
  const providers = base.providers.filter((provider) => provider.provider !== 'pexels');
  const candidates = [...base.candidates];
  if (!env.PEXELS_API_KEY) {
    providers.push({ provider: 'pexels', status: 'disabled', count: 0 });
  } else {
    try {
      const pexels = await searchPexelsV1(query, env.PEXELS_API_KEY);
      candidates.push(...pexels);
      providers.push({ provider: 'pexels', status: 'ok', count: pexels.length });
    } catch (error) {
      providers.push({
        provider: 'pexels',
        status: 'error',
        count: 0,
        error: error instanceof Error ? error.message.slice(0, 500) : String(error).slice(0, 500),
      });
    }
  }
  return {
    query,
    providers,
    candidates: candidates
      .filter((candidate) => candidate.sourceUrl && candidate.providerAssetId)
      .sort((a, b) => (b.relevanceScore ?? 0) - (a.relevanceScore ?? 0))
      .slice(0, Number(env.MEDIA_DISCOVERY_MAX_CANDIDATES ?? 30)),
  };
}

export function bestDownloadableVideo(candidates: ArticleMediaCandidateInput[], env: NodeJS.ProcessEnv = process.env) {
  const maximumDuration = Number(env.MEDIA_MAX_VIDEO_DURATION_SECONDS ?? 180);
  return (
    candidates
      .filter(
        (candidate) =>
          candidate.kind === 'video' &&
          candidate.rightsStatus === 'approved' &&
          Boolean(candidate.downloadUrl) &&
          (!candidate.durationSeconds || candidate.durationSeconds <= maximumDuration),
      )
      .sort((a, b) => (b.relevanceScore ?? 0) - (a.relevanceScore ?? 0))[0] ?? null
  );
}
