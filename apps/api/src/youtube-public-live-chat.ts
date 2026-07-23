import {
  isAutomatedStudioPrompt,
  moderatePublicChatMessage,
  youtubeVideoId,
  type YoutubeAudienceEvent,
  type YoutubeLiveChatMessage,
  type YoutubeLiveChatPage,
} from './youtube-live-chat.js';

type FetchImplementation = typeof fetch;

const PUBLIC_CHAT_HEADERS = {
  accept: 'text/html,application/xhtml+xml,application/json;q=0.9,*/*;q=0.8',
  'accept-language': 'de-DE,de;q=0.9,en;q=0.7',
  cookie: 'SOCS=CAI',
  'user-agent':
    'Mozilla/5.0 (X11; Linux x86_64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/126 Safari/537.36 OpenTVStudio/1.0',
};

export type YoutubePublicChatCursor = {
  videoId: string;
  apiKey: string;
  context: Record<string, unknown>;
  continuation: string;
};

export type YoutubePublicLiveChatPage = YoutubeLiveChatPage & {
  transport: 'public-web';
  cursor: YoutubePublicChatCursor;
};

export type YoutubePublicLiveChatDiscovery = {
  channelId: string;
  channelTitle: string;
  videoId: string;
  videoTitle: string;
  page: YoutubePublicLiveChatPage;
};

function cleanText(value: unknown, maximum: number) {
  return typeof value === 'string'
    ? value
        .replace(/[\u0000-\u001f\u007f]/g, ' ')
        .replace(/\s+/g, ' ')
        .trim()
        .slice(0, maximum)
    : '';
}

function publicChatError(message: string, reason: string, statusCode = 502) {
  return Object.assign(new Error(message), { reason, statusCode });
}

function jsonObjectAt(source: string, openingBrace: number) {
  if (openingBrace < 0 || source[openingBrace] !== '{') return null;
  let depth = 0;
  let inString = false;
  let escaped = false;
  for (let index = openingBrace; index < source.length; index += 1) {
    const character = source[index];
    if (inString) {
      if (escaped) escaped = false;
      else if (character === '\\') escaped = true;
      else if (character === '"') inString = false;
      continue;
    }
    if (character === '"') {
      inString = true;
      continue;
    }
    if (character === '{') depth += 1;
    else if (character === '}' && --depth === 0) {
      try {
        return JSON.parse(source.slice(openingBrace, index + 1)) as Record<string, any>;
      } catch {
        return null;
      }
    }
  }
  return null;
}

function assignedObject(source: string, markers: string[]) {
  for (const marker of markers) {
    const markerIndex = source.indexOf(marker);
    if (markerIndex < 0) continue;
    const value = jsonObjectAt(source, source.indexOf('{', markerIndex + marker.length));
    if (value) return value;
  }
  return null;
}

function youtubePageConfiguration(html: string) {
  const configuration: Record<string, any> = {};
  let offset = 0;
  while (offset < html.length) {
    const marker = html.indexOf('ytcfg.set(', offset);
    if (marker < 0) break;
    const value = jsonObjectAt(html, html.indexOf('{', marker + 10));
    if (value) Object.assign(configuration, value);
    offset = marker + 10;
  }
  const apiKey = cleanText(configuration.INNERTUBE_API_KEY, 300);
  const context = configuration.INNERTUBE_CONTEXT;
  if (!apiKey || !context || typeof context !== 'object') {
    throw publicChatError(
      'Der öffentliche YouTube-Livechat enthält keine verwendbare Client-Konfiguration.',
      'publicChatConfigurationMissing',
    );
  }
  return { apiKey, context: context as Record<string, unknown> };
}

function runsText(value: any) {
  const runs = Array.isArray(value?.runs) ? value.runs : [];
  return cleanText(
    runs
      .map((run: any) => {
        if (typeof run?.text === 'string') return run.text;
        const shortcut = Array.isArray(run?.emoji?.shortcuts) ? run.emoji.shortcuts[0] : null;
        return shortcut || run?.emoji?.image?.accessibility?.accessibilityData?.label || '';
      })
      .join(''),
    500,
  );
}

function publishedAtFromRenderer(renderer: any) {
  const raw = cleanText(renderer?.timestampUsec, 40);
  if (!/^\d{10,20}$/.test(raw)) return new Date().toISOString();
  try {
    return new Date(Number(BigInt(raw) / 1000n)).toISOString();
  } catch {
    return new Date().toISOString();
  }
}

function ownerBadge(renderer: any) {
  return (Array.isArray(renderer?.authorBadges) ? renderer.authorBadges : []).some(
    (badge: any) => badge?.liveChatAuthorBadgeRenderer?.icon?.iconType === 'OWNER',
  );
}

function messageFromRenderer(renderer: any, messageType = 'textMessageEvent'): YoutubeLiveChatMessage | null {
  const providerMessageId = cleanText(renderer?.id, 300);
  const message = runsText(renderer?.message) || runsText(renderer?.headerSubtext);
  if (!providerMessageId || !message) return null;
  const moderation = moderatePublicChatMessage(message);
  const automatedSenderMessage = ownerBadge(renderer) && isAutomatedStudioPrompt(message);
  return {
    providerMessageId,
    authorName: cleanText(renderer?.authorName?.simpleText, 120) || 'Zuschauer',
    authorChannelId: cleanText(renderer?.authorExternalChannelId, 200) || null,
    message,
    messageType,
    safe: moderation.safe && !automatedSenderMessage,
    moderationReason: automatedSenderMessage ? 'Automatisierte Sendernachricht' : moderation.reason,
    publishedAt: publishedAtFromRenderer(renderer),
  };
}

function contentFromActions(actions: unknown) {
  if (!Array.isArray(actions)) return { messages: [], engagements: [] };
  const messages: YoutubeLiveChatMessage[] = [];
  const engagements: YoutubeAudienceEvent[] = [];
  const visit = (action: any) => {
    const item = action?.addChatItemAction?.item;
    const candidates: Array<[any, string]> = [
      [item?.liveChatTextMessageRenderer, 'textMessageEvent'],
      [item?.liveChatPaidMessageRenderer, 'superChatEvent'],
      [item?.liveChatMembershipItemRenderer, 'membershipEvent'],
    ];
    for (const [renderer, type] of candidates) {
      if (!renderer) continue;
      const message = messageFromRenderer(renderer, type);
      if (!message) continue;
      if (type === 'membershipEvent') {
        engagements.push({
          providerEventId: message.providerMessageId,
          eventType: 'membership',
          authorName: message.authorName,
          authorChannelId: message.authorChannelId,
          quantity: 1,
          publishedAt: message.publishedAt,
          source: 'public-web',
        });
      } else {
        messages.push(message);
      }
    }
    const replayActions = action?.replayChatItemAction?.actions;
    if (Array.isArray(replayActions)) replayActions.forEach(visit);
  };
  actions.forEach(visit);
  return {
    messages: [...new Map(messages.map((message) => [message.providerMessageId, message])).values()],
    engagements: [...new Map(engagements.map((event) => [event.providerEventId, event])).values()],
  };
}

function continuationFrom(value: any) {
  const continuations = Array.isArray(value) ? value : [];
  for (const entry of continuations) {
    for (const key of ['invalidationContinuationData', 'timedContinuationData', 'reloadContinuationData']) {
      const data = entry?.[key];
      const continuation = cleanText(data?.continuation, 4000);
      if (!continuation) continue;
      return {
        continuation,
        pollAfterMs: Math.max(1500, Math.min(60_000, Number(data?.timeoutMs) || 5000)),
      };
    }
  }
  return null;
}

function pageFromPayload(
  payload: any,
  configuration: { apiKey: string; context: Record<string, unknown> },
  videoId: string,
): YoutubePublicLiveChatPage {
  const renderer = payload?.contents?.liveChatRenderer ?? payload?.continuationContents?.liveChatContinuation;
  if (!renderer) {
    const message = cleanText(payload?.contents?.messageRenderer?.text?.runs?.[0]?.text, 300);
    throw publicChatError(
      message || 'Für diesen YouTube-Stream ist kein öffentlicher Livechat aktiv.',
      message ? 'liveChatDisabled' : 'publicLiveChatNotFound',
      409,
    );
  }
  const continuation = continuationFrom(renderer.continuations);
  if (!continuation) {
    throw publicChatError('Der öffentliche YouTube-Livechat ist nicht mehr aktiv.', 'publicLiveChatEnded', 409);
  }
  const content = contentFromActions(renderer.actions);
  return {
    liveChatId: `public:${videoId}`,
    nextPageToken: continuation.continuation,
    pollAfterMs: continuation.pollAfterMs,
    messages: content.messages,
    engagements: content.engagements,
    transport: 'public-web',
    cursor: {
      videoId,
      apiKey: configuration.apiKey,
      context: configuration.context,
      continuation: continuation.continuation,
    },
  };
}

export async function fetchYoutubePublicLiveChatPage(input: {
  videoId?: string | null;
  liveStreamUrl?: string | null;
  cursor?: YoutubePublicChatCursor | null;
  fetchImpl?: FetchImplementation;
}): Promise<YoutubePublicLiveChatPage> {
  const fetchImpl = input.fetchImpl ?? fetch;
  const videoId = input.cursor?.videoId || youtubeVideoId(input.videoId) || youtubeVideoId(input.liveStreamUrl);
  if (!videoId)
    throw publicChatError('Die öffentliche YouTube-Chatquelle hat keine gültige Video-ID.', 'videoIdMissing', 400);
  if (!input.cursor) {
    const chatUrl = `https://www.youtube.com/live_chat?is_popout=1&v=${encodeURIComponent(videoId)}&hl=de`;
    const response = await fetchImpl(chatUrl, {
      headers: PUBLIC_CHAT_HEADERS,
      signal: AbortSignal.timeout(20_000),
    });
    const html = await response.text();
    if (!response.ok) {
      throw publicChatError(
        `Der öffentliche YouTube-Livechat antwortet mit HTTP ${response.status}.`,
        'publicChatHttpError',
      );
    }
    const payload = assignedObject(html, [
      'window["ytInitialData"] =',
      "window['ytInitialData'] =",
      'ytInitialData"] =',
      'var ytInitialData =',
      'ytInitialData =',
    ]);
    if (!payload) {
      throw publicChatError(
        'Der öffentliche YouTube-Livechat konnte nicht gelesen werden.',
        'publicChatPayloadMissing',
      );
    }
    return pageFromPayload(payload, youtubePageConfiguration(html), videoId);
  }
  const endpoint = new URL('https://www.youtube.com/youtubei/v1/live_chat/get_live_chat');
  endpoint.searchParams.set('key', input.cursor.apiKey);
  endpoint.searchParams.set('prettyPrint', 'false');
  const response = await fetchImpl(endpoint, {
    method: 'POST',
    headers: {
      ...PUBLIC_CHAT_HEADERS,
      accept: 'application/json',
      'content-type': 'application/json',
      origin: 'https://www.youtube.com',
      referer: `https://www.youtube.com/live_chat?is_popout=1&v=${encodeURIComponent(videoId)}`,
    },
    body: JSON.stringify({ context: input.cursor.context, continuation: input.cursor.continuation }),
    signal: AbortSignal.timeout(20_000),
  });
  const payload = (await response.json().catch(() => null)) as any;
  if (!response.ok || !payload) {
    throw publicChatError(
      `Der öffentliche YouTube-Livechat antwortet mit HTTP ${response.status}.`,
      'publicChatContinuationFailed',
    );
  }
  return pageFromPayload(payload, input.cursor, videoId);
}

function decodeXmlText(value: string) {
  return value
    .replace(/&quot;/g, '"')
    .replace(/&apos;/g, "'")
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>')
    .replace(/&amp;/g, '&');
}

function feedVideos(xml: string) {
  return [...xml.matchAll(/<entry>([\s\S]*?)<\/entry>/g)]
    .map((match) => {
      const entry = match[1];
      return {
        videoId: cleanText(entry.match(/<yt:videoId>([^<]+)<\/yt:videoId>/)?.[1], 20),
        title: cleanText(decodeXmlText(entry.match(/<title>([\s\S]*?)<\/title>/)?.[1] ?? ''), 240),
        publishedAt: cleanText(entry.match(/<published>([^<]+)<\/published>/)?.[1], 80),
      };
    })
    .filter((entry) => Boolean(youtubeVideoId(entry.videoId)));
}

export async function discoverYoutubePublicLiveChat(input: {
  channels: Array<{ id: string; title: string }>;
  fetchImpl?: FetchImplementation;
  maxCandidates?: number;
}): Promise<YoutubePublicLiveChatDiscovery | null> {
  const fetchImpl = input.fetchImpl ?? fetch;
  const maxCandidates = Math.max(1, Math.min(15, input.maxCandidates ?? 10));
  for (const channel of input.channels) {
    const channelId = cleanText(channel.id, 128);
    if (!channelId) continue;
    const feedResponse = await fetchImpl(
      `https://www.youtube.com/feeds/videos.xml?channel_id=${encodeURIComponent(channelId)}`,
      { headers: PUBLIC_CHAT_HEADERS, signal: AbortSignal.timeout(20_000) },
    ).catch(() => null);
    if (!feedResponse?.ok) continue;
    const videos = feedVideos(await feedResponse.text())
      .sort((left, right) => {
        const liveDifference =
          Number(/(?:^|\b)(?:live|livestream|24\s*\/\s*7)(?:\b|:)/i.test(right.title)) -
          Number(/(?:^|\b)(?:live|livestream|24\s*\/\s*7)(?:\b|:)/i.test(left.title));
        return liveDifference || Date.parse(right.publishedAt) - Date.parse(left.publishedAt);
      })
      .slice(0, maxCandidates);
    for (const video of videos) {
      try {
        const page = await fetchYoutubePublicLiveChatPage({ videoId: video.videoId, fetchImpl });
        return {
          channelId,
          channelTitle: cleanText(channel.title, 180) || channelId,
          videoId: video.videoId,
          videoTitle: video.title || 'YouTube-Livestream',
          page,
        };
      } catch {
        // Beendete Uploads und Streams ohne Chat sind normale Feed-Einträge.
      }
    }
  }
  return null;
}
