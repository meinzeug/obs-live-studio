import { registerYoutubePlaybackProxyTarget, type YoutubeLocalPlaybackResolution } from './youtube-local-playback.js';

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
  publishedAt: string | null;
  liveStatus: 'vod' | 'upcoming' | 'active' | 'ended' | 'unknown';
  liveScheduledStart: string | null;
  liveActualStart: string | null;
  liveActualEnd: string | null;
};
export type YoutubeOEmbedMetadata = {
  title: string;
  channelTitle: string;
  channelUrl: string | null;
};
type FetchLike = typeof fetch;

function normalizedYoutubePublishedAt(value: unknown) {
  const candidate = String(value ?? '').trim();
  if (!candidate) return null;
  const timestamp = Date.parse(candidate);
  return Number.isFinite(timestamp) ? new Date(timestamp).toISOString() : null;
}

export function youtubePlaybackEndTarget(
  input: {
    startedAt?: Date | string | null;
    durationSeconds?: number | string | null;
    mediaPositionMs?: number | string | null;
    mediaDurationMs?: number | string | null;
    playerState?: number | string | null;
    lastProgressAt?: Date | string | null;
    accumulatedPauseMs?: number | string | null;
    paused?: boolean | null;
    pauseStartedAt?: Date | string | null;
  },
  now = Date.now(),
) {
  const progressAt = input.lastProgressAt ? new Date(input.lastProgressAt).getTime() : 0;
  const progressFresh = Number.isFinite(progressAt) && progressAt >= now - 8_000;
  const mediaDurationMs = Math.max(0, Number(input.mediaDurationMs ?? 0) || 0);
  const mediaPositionMs = Math.max(0, Number(input.mediaPositionMs ?? 0) || 0);
  if (progressFresh && mediaDurationMs > 0) {
    return new Date(now + Math.max(0, mediaDurationMs - mediaPositionMs));
  }
  if (progressFresh && mediaDurationMs === 0 && Number(input.playerState) === -1) return null;
  const startedAt = input.startedAt ? new Date(input.startedAt).getTime() : Number.NaN;
  const durationSeconds = Math.max(0, Number(input.durationSeconds ?? 0) || 0);
  if (!Number.isFinite(startedAt) || durationSeconds <= 0) return null;
  const currentPauseMs =
    input.paused && input.pauseStartedAt ? Math.max(0, now - new Date(input.pauseStartedAt).getTime()) : 0;
  return new Date(
    startedAt + durationSeconds * 1000 + Math.max(0, Number(input.accumulatedPauseMs ?? 0) || 0) + currentPauseMs,
  );
}

function validVideoId(value: string) {
  if (!/^[a-zA-Z0-9_-]{6,20}$/.test(value)) {
    throw new Error('Ungültige YouTube-Video-ID.');
  }
  return value;
}

export function youtubeObsViewerUrl(baseUrl: string, videoId: string) {
  return new URL(`/live/youtube/${encodeURIComponent(validVideoId(videoId))}`, baseUrl).toString();
}

export function youtubeObsPlayerHtml(
  baseUrl: string,
  videoId: string,
  startSeconds = 0,
  broadcastItemId?: string | null,
) {
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
    `<iframe id="youtube-player" src="${embedUrl}" title="YouTube Live" allow="autoplay; encrypted-media; picture-in-picture" referrerpolicy="strict-origin-when-cross-origin" allowfullscreen></iframe>`,
    broadcastItemId
      ? `<script>(function(){const itemId=${JSON.stringify(broadcastItemId)};const frame=document.getElementById('youtube-player');let paused=null,position=${normalizedStart},duration=null,playerState=-1,lastReport=0,reportInFlight=false,forcedReportPending=false;function post(message){try{frame.contentWindow.postMessage(JSON.stringify(message),'https://www.youtube.com')}catch{}}function command(func){post({event:'command',func,args:[]})}function listen(){post({event:'listening',id:'youtube-player',channel:'open-tv-studio'})}window.addEventListener('message',event=>{if(event.origin!=='https://www.youtube.com'&&event.origin!=='https://www.youtube-nocookie.com')return;let data=event.data;try{if(typeof data==='string')data=JSON.parse(data)}catch{return}if(!data)return;if(data.event==='onError'){playerState=-1;void report(true);return}if(data.event==='onStateChange'){const state=Number(data.info??data.data);if(Number.isFinite(state)){playerState=state;if(state===0)void report(true)}return}if(data.event!=='infoDelivery'||!data.info)return;const info=data.info;if(Number.isFinite(Number(info.currentTime)))position=Math.max(0,Number(info.currentTime));if(Number.isFinite(Number(info.duration))&&Number(info.duration)>0)duration=Number(info.duration);if(Number.isFinite(Number(info.playerState))){playerState=Number(info.playerState);if(playerState===0)void report(true)}});async function report(force=false){if(reportInFlight){if(force)forcedReportPending=true;return}if(!force&&Date.now()-lastReport<1500)return;lastReport=Date.now();reportInFlight=true;try{await fetch('/api/live/youtube/progress/'+encodeURIComponent(itemId),{method:'POST',headers:{'content-type':'application/json'},body:JSON.stringify({positionSeconds:position,durationSeconds:duration,playerState}),keepalive:true})}catch{}finally{reportInFlight=false;if(forcedReportPending){forcedReportPending=false;void report(true)}}}async function sync(){try{const response=await fetch('/api/live/youtube/control/'+encodeURIComponent(itemId),{cache:'no-store'});if(response.ok){const state=await response.json();const next=Boolean(state.paused);if(next!==paused){paused=next;command(next?'pauseVideo':'playVideo')}}}catch{}finally{listen();void report()}}setInterval(sync,500);setTimeout(()=>{listen();void sync()},250)})();</script>`
      : '',
    '</body>',
    '</html>',
  ].join('');
}

function safeScriptValue(value: unknown) {
  return JSON.stringify(value).replaceAll('<', '\\u003c').replaceAll('>', '\\u003e').replaceAll('&', '\\u0026');
}

export function youtubeLocalObsPlayerHtml(
  baseUrl: string,
  resolution: YoutubeLocalPlaybackResolution,
  startSeconds = 0,
  broadcastItemId?: string | null,
) {
  validVideoId(resolution.videoId);
  const hlsAssetUrl = new URL('/live/player-assets/hls.min.js', baseUrl).pathname;
  const normalizedStart = Math.max(0, Math.min(86_400, Math.floor(Number(startSeconds) || 0)));
  const hls = /m3u8/i.test(resolution.protocol) || /\.m3u8(?:$|\?)/i.test(resolution.url);
  const playbackUrl = hls ? registerYoutubePlaybackProxyTarget(resolution.videoId, resolution.url) : resolution.url;
  return [
    '<!doctype html>',
    '<html lang="de">',
    '<head>',
    '<meta charset="utf-8">',
    '<meta name="viewport" content="width=device-width,initial-scale=1">',
    '<title>YouTube · Lokale Wiedergabe</title>',
    '<style>',
    'html,body,video{width:100%;height:100%;margin:0;border:0;overflow:hidden;background:#000}',
    'body{position:fixed;inset:0}',
    'video{display:block;object-fit:contain}',
    '#standby{position:absolute;inset:0;display:none;place-items:center;background:#05070b;color:#dbeafe;font:600 24px system-ui;text-align:center}',
    '#standby.visible{display:grid}',
    '</style>',
    '</head>',
    '<body>',
    '<video id="youtube-player" autoplay playsinline preload="auto"></video>',
    '<div id="standby"><span>Video wird vorbereitet …</span></div>',
    hls ? `<script src="${hlsAssetUrl}"></script>` : '',
    '<script>',
    '(function(){',
    `const itemId=${safeScriptValue(broadcastItemId ?? null)};`,
    `const mediaUrl=${safeScriptValue(playbackUrl)};`,
    `const isLive=${safeScriptValue(resolution.isLive)};`,
    `const isHls=${safeScriptValue(hls)};`,
    `const initialPosition=${normalizedStart};`,
    'const video=document.getElementById("youtube-player");',
    'const standby=document.getElementById("standby");',
    'let hls=null,paused=null,lastReport=0,reportInFlight=false,forcedReportPending=false,playerState=-1,recoveryCount=0;',
    'function showStandby(){standby.classList.add("visible")}',
    'function hideStandby(){standby.classList.remove("visible")}',
    'function reloadFresh(){showStandby();setTimeout(()=>{const next=new URL(window.location.href);next.searchParams.set("refresh",String(Date.now()));window.location.replace(next.toString())},1500)}',
    'function play(){video.muted=false;video.volume=1;const result=video.play();if(result&&typeof result.catch==="function")result.catch(()=>setTimeout(()=>void video.play().catch(()=>{}),700))}',
    'function attach(){',
    'if(isHls&&window.Hls&&window.Hls.isSupported()){',
    'hls=new window.Hls({lowLatencyMode:true,liveSyncDurationCount:3,maxBufferLength:30,backBufferLength:30,enableWorker:true});',
    'hls.on(window.Hls.Events.MANIFEST_PARSED,()=>{hideStandby();play()});',
    'hls.on(window.Hls.Events.ERROR,(_event,data)=>{if(!data||!data.fatal)return;recoveryCount+=1;if(data.type===window.Hls.ErrorTypes.NETWORK_ERROR&&recoveryCount<=3){hls.startLoad();return}if(data.type===window.Hls.ErrorTypes.MEDIA_ERROR&&recoveryCount<=2){hls.recoverMediaError();return}reloadFresh()});',
    'hls.loadSource(mediaUrl);hls.attachMedia(video);',
    '}else{video.src=mediaUrl;video.addEventListener("loadedmetadata",()=>{hideStandby();if(!isLive&&initialPosition>0&&Number.isFinite(video.duration))video.currentTime=Math.min(initialPosition,Math.max(0,video.duration-1));play()},{once:true});}',
    '}',
    'function state(){if(video.ended)return 0;if(video.readyState<3&&!video.paused)return 3;if(video.paused)return 2;return 1}',
    'async function report(force=false){if(!itemId)return;if(reportInFlight){if(force)forcedReportPending=true;return}if(!force&&Date.now()-lastReport<1500)return;lastReport=Date.now();reportInFlight=true;playerState=state();try{await fetch("/api/live/youtube/progress/"+encodeURIComponent(itemId),{method:"POST",headers:{"content-type":"application/json"},body:JSON.stringify({positionSeconds:Number.isFinite(video.currentTime)?Math.max(0,video.currentTime):0,durationSeconds:Number.isFinite(video.duration)&&video.duration>0?video.duration:null,playerState}),keepalive:true})}catch{}finally{reportInFlight=false;if(forcedReportPending){forcedReportPending=false;void report(true)}}}',
    'async function sync(){if(!itemId)return;try{const response=await fetch("/api/live/youtube/control/"+encodeURIComponent(itemId),{cache:"no-store"});if(response.ok){const control=await response.json();const next=Boolean(control.paused);if(next!==paused){paused=next;if(next)video.pause();else play()}}}catch{}finally{void report()}}',
    'video.addEventListener("playing",()=>{hideStandby();recoveryCount=0;void report(true)});',
    'video.addEventListener("pause",()=>void report(true));',
    'video.addEventListener("ended",()=>void report(true));',
    'video.addEventListener("waiting",()=>void report(true));',
    'video.addEventListener("error",()=>reloadFresh());',
    'window.__openTvStudioYoutubePlayer={video,get hls(){return hls}};',
    'attach();',
    'if(itemId){setInterval(sync,500);setTimeout(()=>void sync(),250)}',
    '})();',
    '</script>',
    '</body>',
    '</html>',
  ].join('');
}

export function youtubeLocalPlaybackStandbyHtml(videoIdValue: string) {
  const videoId = validVideoId(videoIdValue);
  return [
    '<!doctype html>',
    '<html lang="de">',
    '<head>',
    '<meta charset="utf-8">',
    '<meta name="viewport" content="width=device-width,initial-scale=1">',
    '<title>YouTube · Wiedergabe wird vorbereitet</title>',
    '<style>',
    'html,body{width:100%;height:100%;margin:0;overflow:hidden;background:#05070b;color:#dbeafe}',
    'body{display:grid;place-items:center;font:600 24px system-ui;text-align:center}',
    'span::before{content:"";display:block;width:42px;height:42px;margin:0 auto 18px;border:4px solid #17324d;border-top-color:#22d3ee;border-radius:50%;animation:spin 1s linear infinite}',
    '@keyframes spin{to{transform:rotate(360deg)}}',
    '</style>',
    '</head>',
    '<body>',
    '<span>Video wird vorbereitet …</span>',
    '<script>',
    `setTimeout(()=>{const next=new URL(${safeScriptValue(youtubeObsViewerUrl('http://127.0.0.1', videoId))},window.location.href);next.protocol=window.location.protocol;next.host=window.location.host;next.searchParams.set("refresh",String(Date.now()));window.location.replace(next.toString())},20000);`,
    '</script>',
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

export function youtubePublishedAtFromFeedXml(xml: string, videoIdValue: string) {
  const videoId = validVideoId(videoIdValue);
  for (const match of xml.matchAll(/<entry\b[\s\S]*?<\/entry>/giu)) {
    const entry = match[0];
    const entryVideoId = /<yt:videoId>\s*([^<\s]+)\s*<\/yt:videoId>/iu.exec(entry)?.[1];
    if (entryVideoId !== videoId) continue;
    return normalizedYoutubePublishedAt(/<published>\s*([^<]+)\s*<\/published>/iu.exec(entry)?.[1]);
  }
  return null;
}

async function metadataFromYoutubeDataApi(videoId: string, apiKey: string, fetchImpl: FetchLike) {
  const url = new URL('https://www.googleapis.com/youtube/v3/videos');
  url.search = new URLSearchParams({
    key: apiKey,
    part: 'contentDetails,snippet,liveStreamingDetails',
    id: videoId,
    maxResults: '1',
  }).toString();
  const response = await fetchImpl(url, { signal: AbortSignal.timeout(12_000) });
  if (!response.ok) throw new Error(`YouTube Data API HTTP ${response.status}`);
  const payload = (await response.json()) as {
    items?: Array<{
      contentDetails?: { duration?: string };
      snippet?: { channelTitle?: string; publishedAt?: string; liveBroadcastContent?: string };
      liveStreamingDetails?: {
        scheduledStartTime?: string;
        actualStartTime?: string;
        actualEndTime?: string;
      };
    }>;
  };
  const item = payload.items?.[0];
  const live = item?.liveStreamingDetails;
  const liveStatus: YoutubeVideoMetadata['liveStatus'] = live?.actualEndTime
    ? 'ended'
    : live?.actualStartTime || item?.snippet?.liveBroadcastContent === 'live'
      ? 'active'
      : live?.scheduledStartTime || item?.snippet?.liveBroadcastContent === 'upcoming'
        ? 'upcoming'
        : 'vod';
  const duration =
    (item?.contentDetails?.duration ? parseIso8601YoutubeDuration(item.contentDetails.duration) : null) ??
    (liveStatus === 'active' || liveStatus === 'upcoming' ? 3600 : null);
  if (!duration) return null;
  return {
    durationSeconds: duration,
    channelTitle: item?.snippet?.channelTitle?.trim() || 'YouTube',
    publishedAt: normalizedYoutubePublishedAt(item?.snippet?.publishedAt),
    liveStatus,
    liveScheduledStart: normalizedYoutubePublishedAt(live?.scheduledStartTime),
    liveActualStart: normalizedYoutubePublishedAt(live?.actualStartTime),
    liveActualEnd: normalizedYoutubePublishedAt(live?.actualEndTime),
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
  const isLiveNow = /"isLiveNow"\s*:\s*true/.test(html) || /"isLive"\s*:\s*true/.test(html);
  if ((!Number.isFinite(parsed) || parsed <= 0) && !isLiveNow) return null;
  const channelTitle =
    /"ownerChannelName"\s*:\s*"([^"]+)"/.exec(html)?.[1] ?? /"author"\s*:\s*"([^"]+)"/.exec(html)?.[1] ?? 'YouTube';
  const publishedAt = normalizedYoutubePublishedAt(
    /"publishDate"\s*:\s*"([^"]+)"/.exec(html)?.[1] ??
      /"uploadDate"\s*:\s*"([^"]+)"/.exec(html)?.[1] ??
      /itemprop=["']datePublished["'][^>]*content=["']([^"']+)["']/i.exec(html)?.[1],
  );
  return {
    durationSeconds: Number.isFinite(parsed) && parsed > 0 ? parsed : 3600,
    channelTitle: channelTitle.replace(/\\u0026/g, '&').trim() || 'YouTube',
    publishedAt,
    liveStatus: isLiveNow ? ('active' as const) : ('vod' as const),
    liveScheduledStart: null,
    liveActualStart: isLiveNow ? new Date().toISOString() : null,
    liveActualEnd: null,
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
