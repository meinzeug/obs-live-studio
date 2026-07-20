export type YoutubeLiveSource = {
  videoId: string;
  sourceId: string;
  viewerUrl: string;
  previewUrl: string;
  canonicalUrl: string;
};

function validVideoId(value: string) {
  if (!/^[a-zA-Z0-9_-]{6,20}$/.test(value)) {
    throw new Error('Ungültige YouTube-Video-ID.');
  }
  return value;
}

export function youtubeObsViewerUrl(baseUrl: string, videoId: string) {
  return new URL(`/live/youtube/${encodeURIComponent(validVideoId(videoId))}`, baseUrl).toString();
}

export function youtubeObsPlayerHtml(baseUrl: string, videoId: string) {
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
