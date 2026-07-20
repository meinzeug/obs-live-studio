export type YoutubeLiveSource = {
  videoId: string;
  sourceId: string;
  viewerUrl: string;
  previewUrl: string;
  canonicalUrl: string;
};

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
  const videoId = candidate;
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
