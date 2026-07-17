import { createHash } from 'node:crypto';
import type { ArticleMediaCandidateInput } from '@ans/database/article-media';
import { boundedMediaNumber } from './runtime-values.js';

export interface MediaDiscoveryArticle {
  id: string;
  title: string;
  excerpt?: string | null;
  main_text?: string | null;
  category?: string | null;
  region?: string | null;
}

export interface MediaDiscoveryResult {
  query: string;
  candidates: ArticleMediaCandidateInput[];
  providers: Array<{ provider: string; status: 'ok' | 'disabled' | 'error'; count: number; error?: string }>;
}

const STOP_WORDS = new Set([
  'der',
  'die',
  'das',
  'den',
  'dem',
  'des',
  'ein',
  'eine',
  'einer',
  'eines',
  'und',
  'oder',
  'aber',
  'mit',
  'für',
  'von',
  'aus',
  'auf',
  'bei',
  'ist',
  'sind',
  'wird',
  'werden',
  'nach',
  'über',
  'gegen',
  'durch',
  'zum',
  'zur',
  'im',
  'in',
  'am',
]);

function cleanText(value: unknown) {
  return String(value ?? '')
    .replace(/<[^>]*>/g, ' ')
    .replace(/&amp;/g, '&')
    .replace(/&quot;/g, '"')
    .replace(/&#39;/g, "'")
    .replace(/\s+/g, ' ')
    .trim();
}

export function buildMediaSearchQuery(article: MediaDiscoveryArticle) {
  const words = cleanText(`${article.title} ${article.category ?? ''} ${article.region ?? ''}`)
    .toLowerCase()
    .replace(/[^\p{L}\p{N}-]+/gu, ' ')
    .split(/\s+/)
    .filter((word) => word.length >= 3 && !STOP_WORDS.has(word));
  return [...new Set(words)].slice(0, 10).join(' ') || cleanText(article.title).slice(0, 120);
}

function relevance(title: string, query: string, bonus = 0) {
  const tokens = query.toLowerCase().split(/\s+/).filter(Boolean);
  const haystack = title.toLowerCase();
  return Math.min(100, bonus + tokens.reduce((score, token) => score + (haystack.includes(token) ? 8 : 0), 0));
}

async function fetchJson(url: URL, init: RequestInit = {}, timeoutMs = 12_000) {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);
  try {
    const response = await fetch(url, {
      ...init,
      signal: controller.signal,
      headers: { 'user-agent': process.env.NEWS_USER_AGENT ?? 'OpenTVStudio/1.0', ...(init.headers ?? {}) },
    });
    if (!response.ok) throw new Error(`HTTP ${response.status} von ${url.hostname}`);
    const text = await response.text();
    if (text.length > 3 * 1024 * 1024) throw new Error(`Antwort von ${url.hostname} ist zu groß`);
    return JSON.parse(text);
  } finally {
    clearTimeout(timer);
  }
}

function commonsMetadata(value: unknown) {
  if (!value || typeof value !== 'object') return '';
  const object = value as Record<string, any>;
  return cleanText(object.value ?? object);
}

async function searchCommons(query: string): Promise<ArticleMediaCandidateInput[]> {
  const results: ArticleMediaCandidateInput[] = [];
  for (const kind of ['video', 'image'] as const) {
    const url = new URL('https://commons.wikimedia.org/w/api.php');
    url.search = new URLSearchParams({
      action: 'query',
      generator: 'search',
      gsrsearch: `${query} filetype:${kind === 'video' ? 'video' : 'bitmap'}`,
      gsrnamespace: '6',
      gsrlimit: kind === 'video' ? '8' : '6',
      prop: 'imageinfo',
      iiprop: 'url|mime|size|extmetadata',
      format: 'json',
      formatversion: '2',
      origin: '*',
    }).toString();
    const document: any = await fetchJson(url);
    for (const page of document?.query?.pages ?? []) {
      const info = page.imageinfo?.[0];
      const mime = String(info?.mime ?? '');
      const isVideo = mime.startsWith('video/');
      const isImage = mime.startsWith('image/');
      if ((kind === 'video' && !isVideo) || (kind === 'image' && !isImage)) continue;
      const licenseName = commonsMetadata(info.extmetadata?.LicenseShortName) || 'Wikimedia Commons';
      const licenseUrl = commonsMetadata(info.extmetadata?.LicenseUrl) || null;
      const author = commonsMetadata(info.extmetadata?.Artist) || null;
      const title = cleanText(page.title).replace(/^File:/i, '');
      results.push({
        kind,
        provider: 'wikimedia-commons',
        providerAssetId: String(page.pageid),
        title,
        searchQuery: query,
        sourceUrl: String(
          info.descriptionurl ?? `https://commons.wikimedia.org/wiki/${encodeURIComponent(page.title)}`,
        ),
        downloadUrl: String(info.url ?? ''),
        previewUrl: String(info.thumburl ?? info.url ?? ''),
        mimeType: mime,
        width: Number(info.width) || null,
        height: Number(info.height) || null,
        author,
        licenseName,
        licenseUrl,
        attribution: author ? `${title} – ${author} – ${licenseName}` : `${title} – ${licenseName}`,
        relevanceScore: relevance(title, query, isVideo ? 25 : 10),
        rightsStatus: /cc|public domain|gemeinfrei/i.test(`${licenseName} ${licenseUrl ?? ''}`) ? 'approved' : 'review',
        metadata: { allowedDownloadHosts: ['upload.wikimedia.org'], descriptionUrl: info.descriptionurl },
      });
    }
  }
  return results;
}

async function searchPexels(query: string, key: string): Promise<ArticleMediaCandidateInput[]> {
  const headers = { Authorization: key };
  const videoUrl = new URL('https://api.pexels.com/videos/search');
  videoUrl.search = new URLSearchParams({ query, per_page: '8', orientation: 'landscape', size: 'medium' }).toString();
  const photoUrl = new URL('https://api.pexels.com/v1/search');
  photoUrl.search = new URLSearchParams({ query, per_page: '6', orientation: 'landscape', size: 'large' }).toString();
  const [videos, photos]: any[] = await Promise.all([
    fetchJson(videoUrl, { headers }),
    fetchJson(photoUrl, { headers }),
  ]);
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

async function searchPixabay(query: string, key: string): Promise<ArticleMediaCandidateInput[]> {
  const videosUrl = new URL('https://pixabay.com/api/videos/');
  videosUrl.search = new URLSearchParams({ key, q: query, per_page: '8', safesearch: 'true' }).toString();
  const imagesUrl = new URL('https://pixabay.com/api/');
  imagesUrl.search = new URLSearchParams({
    key,
    q: query,
    per_page: '6',
    safesearch: 'true',
    image_type: 'photo',
  }).toString();
  const [videos, images]: any[] = await Promise.all([fetchJson(videosUrl), fetchJson(imagesUrl)]);
  const results: ArticleMediaCandidateInput[] = [];
  for (const video of videos?.hits ?? []) {
    const file = video.videos?.large ?? video.videos?.medium ?? video.videos?.small;
    if (!file?.url) continue;
    results.push({
      kind: 'video',
      provider: 'pixabay',
      providerAssetId: String(video.id),
      title: cleanText(video.tags || query),
      searchQuery: query,
      sourceUrl: String(video.pageURL),
      downloadUrl: String(file.url),
      previewUrl: String(video.picture_id ? `https://i.vimeocdn.com/video/${video.picture_id}_640x360.jpg` : ''),
      mimeType: 'video/mp4',
      durationSeconds: Number(video.duration) || null,
      width: Number(file.width) || null,
      height: Number(file.height) || null,
      author: cleanText(video.user) || null,
      licenseName: 'Pixabay Content License',
      licenseUrl: 'https://pixabay.com/service/license-summary/',
      attribution: video.user ? `Video von ${video.user} auf Pixabay` : 'Video von Pixabay',
      relevanceScore: relevance(video.tags || query, query, 30),
      rightsStatus: 'approved',
      metadata: { allowedDownloadHosts: ['cdn.pixabay.com', 'player.vimeo.com'], providerPage: video.pageURL },
    });
  }
  for (const image of images?.hits ?? []) {
    results.push({
      kind: 'image',
      provider: 'pixabay',
      providerAssetId: String(image.id),
      title: cleanText(image.tags || query),
      searchQuery: query,
      sourceUrl: String(image.pageURL),
      downloadUrl: String(image.largeImageURL ?? image.webformatURL ?? ''),
      previewUrl: String(image.webformatURL ?? ''),
      mimeType: 'image/jpeg',
      width: Number(image.imageWidth) || null,
      height: Number(image.imageHeight) || null,
      author: cleanText(image.user) || null,
      licenseName: 'Pixabay Content License',
      licenseUrl: 'https://pixabay.com/service/license-summary/',
      attribution: image.user ? `Bild von ${image.user} auf Pixabay` : 'Bild von Pixabay',
      relevanceScore: relevance(image.tags || query, query, 18),
      rightsStatus: 'approved',
      metadata: { allowedDownloadHosts: ['cdn.pixabay.com'], providerPage: image.pageURL },
    });
  }
  return results;
}

async function searchYouTubeReferences(query: string, key: string): Promise<ArticleMediaCandidateInput[]> {
  const url = new URL('https://www.googleapis.com/youtube/v3/search');
  url.search = new URLSearchParams({
    key,
    part: 'snippet',
    type: 'video',
    q: query,
    maxResults: '8',
    order: 'relevance',
    safeSearch: 'strict',
    videoEmbeddable: 'true',
    videoSyndicated: 'true',
    videoLicense: 'creativeCommon',
    videoDefinition: 'high',
    videoDuration: 'short',
    relevanceLanguage: 'de',
    regionCode: 'DE',
  }).toString();
  const document: any = await fetchJson(url);
  return (document?.items ?? []).map((item: any) => {
    const videoId = String(item.id?.videoId ?? '');
    const title = cleanText(item.snippet?.title || query);
    return {
      kind: 'reference' as const,
      provider: 'youtube',
      providerAssetId: videoId,
      title,
      searchQuery: query,
      sourceUrl: `https://www.youtube.com/watch?v=${encodeURIComponent(videoId)}`,
      previewUrl: String(item.snippet?.thumbnails?.high?.url ?? item.snippet?.thumbnails?.medium?.url ?? ''),
      embedUrl: `https://www.youtube-nocookie.com/embed/${encodeURIComponent(videoId)}`,
      mimeType: 'text/html',
      author: cleanText(item.snippet?.channelTitle) || null,
      licenseName: 'YouTube Creative Commons – redaktionell prüfen',
      licenseUrl: 'https://support.google.com/youtube/answer/2797468',
      attribution: item.snippet?.channelTitle
        ? `${title} – ${item.snippet.channelTitle} – YouTube`
        : `${title} – YouTube`,
      relevanceScore: relevance(title, query, 22),
      rightsStatus: 'review' as const,
      status: 'reference' as const,
      metadata: { publishedAt: item.snippet?.publishedAt, requiresManualRightsReview: true },
    };
  });
}

function statisticCandidates(article: MediaDiscoveryArticle, query: string): ArticleMediaCandidateInput[] {
  const text = cleanText(`${article.excerpt ?? ''} ${article.main_text ?? ''}`);
  const sentences = text
    .split(/(?<=[.!?])\s+/)
    .filter((sentence) =>
      /\b\d[\d.,]*\s*(?:%|Prozent|Million|Milliard|Euro|Jahre?|Tage?|Menschen|Stück)?\b/i.test(sentence),
    );
  return sentences.slice(0, 4).map((sentence, index) => ({
    kind: 'statistic',
    provider: 'article-source',
    providerAssetId: createHash('sha256').update(`${article.id}:${sentence}`).digest('hex').slice(0, 24),
    title: `Zahlenkarte ${index + 1}`,
    searchQuery: query,
    sourceUrl: `article://${article.id}`,
    relevanceScore: 40 - index,
    rightsStatus: 'approved',
    status: 'candidate',
    metadata: { statement: sentence.slice(0, 500), generatedFromArticle: true },
  }));
}

export async function discoverArticleMedia(
  article: MediaDiscoveryArticle,
  env: NodeJS.ProcessEnv = process.env,
  options: { query?: string } = {},
): Promise<MediaDiscoveryResult> {
  const query = options.query?.trim() || buildMediaSearchQuery(article);
  const providers: MediaDiscoveryResult['providers'] = [];
  const candidates: ArticleMediaCandidateInput[] = [...statisticCandidates(article, query)];
  const jobs: Array<{ provider: string; enabled: boolean; run: () => Promise<ArticleMediaCandidateInput[]> }> = [
    { provider: 'wikimedia-commons', enabled: env.MEDIA_COMMONS_ENABLED !== 'false', run: () => searchCommons(query) },
    { provider: 'pexels', enabled: Boolean(env.PEXELS_API_KEY), run: () => searchPexels(query, env.PEXELS_API_KEY!) },
    {
      provider: 'pixabay',
      enabled: Boolean(env.PIXABAY_API_KEY),
      run: () => searchPixabay(query, env.PIXABAY_API_KEY!),
    },
    {
      provider: 'youtube',
      enabled: Boolean(env.YOUTUBE_DATA_API_KEY),
      run: () => searchYouTubeReferences(query, env.YOUTUBE_DATA_API_KEY!),
    },
  ];
  for (const job of jobs) {
    if (!job.enabled) {
      providers.push({ provider: job.provider, status: 'disabled', count: 0 });
      continue;
    }
    try {
      const result = await job.run();
      candidates.push(...result);
      providers.push({ provider: job.provider, status: 'ok', count: result.length });
    } catch (error) {
      providers.push({
        provider: job.provider,
        status: 'error',
        count: 0,
        error: error instanceof Error ? error.message.slice(0, 500) : String(error).slice(0, 500),
      });
    }
  }
  return {
    query,
    candidates: candidates
      .filter((candidate) => candidate.sourceUrl && candidate.providerAssetId)
      .sort((a, b) => (b.relevanceScore ?? 0) - (a.relevanceScore ?? 0))
      .slice(0, boundedMediaNumber(env.MEDIA_DISCOVERY_MAX_CANDIDATES, 30, 1, 100)),
    providers,
  };
}

export function bestDownloadableVideo(candidates: ArticleMediaCandidateInput[]) {
  const maximumDuration = boundedMediaNumber(process.env.MEDIA_MAX_VIDEO_DURATION_SECONDS, 180, 1, 6 * 60 * 60, {
    integer: false,
  });
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
