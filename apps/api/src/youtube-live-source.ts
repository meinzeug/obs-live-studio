export type YoutubeLiveSource = {
  videoId: string;
  sourceId: string;
  viewerUrl: string;
  previewUrl: string;
  canonicalUrl: string;
};
export type YoutubeVideoMetadata = {
  durationSeconds: number;
  channelTitle: string;
};
export type YoutubeOEmbedMetadata = {
  title: string;
  channelTitle: string;
  channelUrl: string | null;
};
type FetchLike = typeof fetch;

function validVideoId(value: string) {
  if (!/^[a-zA-Z0-9_-]{6,20}$/.test(value)) {
    throw new Error('Ungültige YouTube-Video-ID.');
  }
  return value;
}

export function youtubeObsViewerUrl(baseUrl: string, videoId: string) {
  return new URL(`/live/youtube/${encodeURIComponent(validVideoId(videoId))}`, baseUrl).toString();
}

export function youtubeObsPlayerHtml(baseUrl: string, videoId: string, startSeconds = 0) {
  const id = validVideoId(videoId);
  const viewerUrl = youtubeObsViewerUrl(baseUrl, id);
  const origin = new URL(viewerUrl).origin;
  const query = new URLSearchParams({
    autoplay: '1',
    controls: '1',
    enablejsapi: '1',
    playsinline: '1',
    rel: '0',
    origin,
    widget_referrer: viewerUrl,
  });
  const normalizedStart = Math.max(0, Math.min(86_400, Math.floor(Number(startSeconds) || 0)));
  if (normalizedStart > 0) query.set('start', String(normalizedStart));
  const embedUrl = `https://www.youtube.com/embed/${encodeURIComponent(id)}?${query}`;
  return [
    '<!doctype html>',
    '<html lang="de">',
    '<head>',
    '<meta charset="utf-8">',
    '<meta name="viewport" content="width=device-width,initial-scale=1">',
    '<meta name="referrer" content="strict-origin-when-cross-origin">',
    '<title>YouTube Live</title>',
    '<style>html,body,iframe{width:100%;height:100%;margin:0;border:0;overflow:hidden;background:#000}body{position:fixed;inset:0}</style>',
    '</head>',
    '<body>',
    `<iframe src="${embedUrl}" title="YouTube Live" allow="autoplay; encrypted-media; picture-in-picture" referrerpolicy="strict-origin-when-cross-origin" allowfullscreen></iframe>`,
    '</body>',
    '</html>',
  ].join('');
}

export function parseIso8601YoutubeDuration(value: string) {
  const match = /^P(?:(\d+)D)?(?:T(?:(\d+)H)?(?:(\d+)M)?(?:(\d+)S)?)?$/.exec(value);
  if (!match) return null;
  const days = Number(match[1] ?? 0);
  const hours = Number(match[2] ?? 0);
  const minutes = Number(match[3] ?? 0);
  const seconds = Number(match[4] ?? 0);
  const total = days * 86400 + hours * 3600 + minutes * 60 + seconds;
  return Number.isFinite(total) && total > 0 ? total : null;
}

async function metadataFromYoutubeDataApi(videoId: string, apiKey: string, fetchImpl: FetchLike) {
  const url = new URL('https://www.googleapis.com/youtube/v3/videos');
  url.search = new URLSearchParams({
    key: apiKey,
    part: 'contentDetails,snippet',
    id: videoId,
    maxResults: '1',
  }).toString();
  const response = await fetchImpl(url, { signal: AbortSignal.timeout(12_000) });
  if (!response.ok) throw new Error(`YouTube Data API HTTP ${response.status}`);
  const payload = (await response.json()) as {
    items?: Array<{ contentDetails?: { duration?: string }; snippet?: { channelTitle?: string } }>;
  };
  const item = payload.items?.[0];
  const duration = item?.contentDetails?.duration ? parseIso8601YoutubeDuration(item.contentDetails.duration) : null;
  if (!duration) return null;
  return {
    durationSeconds: duration,
    channelTitle: item?.snippet?.channelTitle?.trim() || 'YouTube',
  };
}

async function metadataFromYoutubeWatchPage(videoId: string, fetchImpl: FetchLike) {
  const response = await fetchImpl(`https://www.youtube.com/watch?v=${encodeURIComponent(videoId)}`, {
    headers: {
      'user-agent':
        process.env.NEWS_USER_AGENT ||
        process.env.WIKIMEDIA_USER_AGENT ||
        'OpenTVStudio/1.0 (lokales Nachrichtenstudio)',
      accept: 'text/html,application/xhtml+xml',
      'accept-language': 'de-DE,de;q=0.9,en;q=0.7',
    },
    signal: AbortSignal.timeout(12_000),
  });
  if (!response.ok) throw new Error(`YouTube Watch HTTP ${response.status}`);
  const html = await response.text();
  const quoted = /"lengthSeconds"\s*:\s*"(\d+)"/.exec(html)?.[1];
  const numeric = /"lengthSeconds"\s*:\s*(\d+)/.exec(html)?.[1];
  const parsed = Number(quoted ?? numeric);
  if (!Number.isFinite(parsed) || parsed <= 0) return null;
  const channelTitle =
    /"ownerChannelName"\s*:\s*"([^"]+)"/.exec(html)?.[1] ?? /"author"\s*:\s*"([^"]+)"/.exec(html)?.[1] ?? 'YouTube';
  return {
    durationSeconds: parsed,
    channelTitle: channelTitle.replace(/\\u0026/g, '&').trim() || 'YouTube',
  };
}

export async function resolveYoutubeOEmbedMetadata(videoIdValue: string, options: { fetchImpl?: FetchLike } = {}) {
  const videoId = validVideoId(videoIdValue);
  const fetchImpl = options.fetchImpl ?? fetch;
  const url = new URL('https://www.youtube.com/oembed');
  url.search = new URLSearchParams({
    url: `https://www.youtube.com/watch?v=${encodeURIComponent(videoId)}`,
    format: 'json',
  }).toString();
  const response = await fetchImpl(url, { signal: AbortSignal.timeout(10_000) });
  if (!response.ok) throw new Error(`YouTube oEmbed HTTP ${response.status}`);
  const payload = (await response.json()) as {
    title?: string;
    author_name?: string;
    author_url?: string;
  };
  const channelTitle = payload.author_name?.trim();
  if (!channelTitle) throw new Error('YouTube oEmbed enthält keinen Kanalnamen.');
  return {
    title: payload.title?.trim() || `YouTube Video ${videoId}`,
    channelTitle,
    channelUrl: payload.author_url?.trim() || null,
  } satisfies YoutubeOEmbedMetadata;
}

function isGenericYoutubeChannelTitle(value: string | null | undefined) {
  const normalized = (value ?? '')
    .trim()
    .toLowerCase()
    .replace(/\s*@\s*youtube$/, '');
  return !normalized || normalized === 'youtube';
}

export async function resolveYoutubeVideoMetadata(
  videoIdValue: string,
  options: { apiKey?: string | null; fetchImpl?: FetchLike } = {},
): Promise<YoutubeVideoMetadata> {
  const videoId = validVideoId(videoIdValue);
  const fetchImpl = options.fetchImpl ?? fetch;
  const apiKey = options.apiKey?.trim();
  const errors: string[] = [];
  if (apiKey) {
    try {
      const metadata = await metadataFromYoutubeDataApi(videoId, apiKey, fetchImpl);
      if (metadata) return metadata;
    } catch (error) {
      errors.push(error instanceof Error ? error.message : String(error));
    }
  }
  try {
    const metadata = await metadataFromYoutubeWatchPage(videoId, fetchImpl);
    if (metadata) {
      if (!isGenericYoutubeChannelTitle(metadata.channelTitle)) return metadata;
      try {
        const oembed = await resolveYoutubeOEmbedMetadata(videoId, { fetchImpl });
        return { ...metadata, channelTitle: oembed.channelTitle };
      } catch (error) {
        errors.push(error instanceof Error ? error.message : String(error));
      }
      return metadata;
    }
  } catch (error) {
    errors.push(error instanceof Error ? error.message : String(error));
  }
  const suffix = errors.length ? ` Details: ${errors.join(' | ')}` : '';
  throw new Error(`Die Laufzeit des YouTube-Videos konnte nicht automatisch ermittelt werden.${suffix}`);
}

export async function resolveYoutubeVideoDuration(
  videoIdValue: string,
  options: { apiKey?: string | null; fetchImpl?: FetchLike } = {},
) {
  return (await resolveYoutubeVideoMetadata(videoIdValue, options)).durationSeconds;
}

export function resolveYoutubeLiveSource(urlValue: string): YoutubeLiveSource {
  let url: URL;
  try {
    url = new URL(urlValue);
  } catch {
    throw new Error('Bitte eine gültige YouTube-URL angeben.');
  }
  const host = url.hostname.toLowerCase().replace(/^www\./, '');
  if (!['youtube.com', 'm.youtube.com', 'youtu.be', 'youtube-nocookie.com'].includes(host)) {
    throw new Error('Als YouTube-Quelle sind nur URLs von youtube.com oder youtu.be erlaubt.');
  }
  const parts = url.pathname.split('/').filter(Boolean);
  const candidate =
    host === 'youtu.be'
      ? parts[0]
      : (url.searchParams.get('v') ?? (['live', 'embed', 'shorts'].includes(parts[0] ?? '') ? parts[1] : undefined));
  if (!candidate || !/^[a-zA-Z0-9_-]{6,20}$/.test(candidate)) {
    throw new Error(
      'Die URL enthält keine konkrete Video-ID. Öffne den laufenden oder geplanten Stream und kopiere dessen Teilen-/Watch-URL.',
    );
  }
  const videoId = validVideoId(candidate);
  const query = new URLSearchParams({
    autoplay: '1',
    mute: '0',
    controls: '0',
    rel: '0',
    playsinline: '1',
    modestbranding: '1',
  });
  return {
    videoId,
    sourceId: `youtube:${videoId}`,
    viewerUrl: `https://www.youtube-nocookie.com/embed/${encodeURIComponent(videoId)}?${query}`,
    previewUrl: `https://i.ytimg.com/vi/${encodeURIComponent(videoId)}/hqdefault.jpg`,
    canonicalUrl: `https://www.youtube.com/watch?v=${encodeURIComponent(videoId)}`,
  };
}
