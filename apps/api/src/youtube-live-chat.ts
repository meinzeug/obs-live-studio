type FetchImplementation = typeof fetch;

export type YoutubeLiveChatMessage = {
  providerMessageId: string;
  authorName: string;
  authorChannelId: string | null;
  message: string;
  messageType: string;
  safe: boolean;
  moderationReason: string | null;
  publishedAt: string;
};

export type YoutubeAudienceEvent = {
  providerEventId: string;
  eventType: 'membership';
  authorName: string | null;
  authorChannelId: string | null;
  quantity: number;
  publishedAt: string;
  source: 'data-api' | 'public-web';
};

export type YoutubeLiveChatPage = {
  liveChatId: string;
  nextPageToken: string | null;
  pollAfterMs: number;
  messages: YoutubeLiveChatMessage[];
  engagements: YoutubeAudienceEvent[];
};

function text(value: unknown, maximum: number) {
  return typeof value === 'string'
    ? value
        .replace(/[\u0000-\u001f\u007f]/g, ' ')
        .replace(/\s+/g, ' ')
        .trim()
        .slice(0, maximum)
    : '';
}

export function youtubeVideoId(value: string | null | undefined) {
  const raw = value?.trim();
  if (!raw) return null;
  if (/^[A-Za-z0-9_-]{11}$/.test(raw)) return raw;
  try {
    const url = new URL(raw);
    if (url.hostname === 'youtu.be') return url.pathname.split('/').filter(Boolean)[0]?.slice(0, 11) || null;
    if (url.hostname.endsWith('youtube.com')) {
      const direct = url.searchParams.get('v');
      if (direct) return direct.slice(0, 11);
      const parts = url.pathname.split('/').filter(Boolean);
      const marker = parts.findIndex((part) => ['live', 'embed', 'shorts'].includes(part));
      if (marker >= 0) return parts[marker + 1]?.slice(0, 11) || null;
    }
  } catch {
    return null;
  }
  return null;
}

export function moderatePublicChatMessage(message: string) {
  const normalized = text(message, 500);
  if (!normalized) return { safe: false, reason: 'Leere Nachricht' };
  if (/https?:\/\/\S+/i.test(normalized) && (normalized.match(/https?:\/\/\S+/gi)?.length ?? 0) > 1)
    return { safe: false, reason: 'Link-Spam' };
  if (/(?:\+?\d[\s().-]*){8,}/.test(normalized) || /\b[\w.+-]+@[\w.-]+\.[A-Za-z]{2,}\b/.test(normalized))
    return { safe: false, reason: 'Mögliche personenbezogene Kontaktdaten' };
  if (/(?:https?:\/\/)?(?:www\.)?(?:t\.me|wa\.me|discord\.gg)\//i.test(normalized))
    return { safe: false, reason: 'Externer Einladungslink' };
  if (/(.)\1{12,}/u.test(normalized) || (normalized.length > 35 && normalized === normalized.toUpperCase()))
    return { safe: false, reason: 'Störender Spam' };
  return { safe: true, reason: null };
}

function youtubeApiError(payload: any, fallback: string) {
  const detail = text(payload?.error?.message, 240);
  const reason = text(payload?.error?.errors?.[0]?.reason, 120) || null;
  return Object.assign(new Error(detail || fallback), { reason });
}

function youtubeApiHeaders(accessToken?: string | null) {
  return {
    Accept: 'application/json',
    ...(accessToken?.trim() ? { Authorization: `Bearer ${accessToken.trim()}` } : {}),
  };
}

export function isAutomatedStudioPrompt(message: string) {
  return /(?:schreib(?:t)? (?:deine|eure) (?:meinung|frage)|was kommt als n(?:ä|ae)chstes|welche sendung kommt|abonniert|teilt (?:diesen|den) stream)/i.test(
    message,
  );
}

export async function resolveYoutubeLiveChatId(input: {
  apiKey?: string | null;
  accessToken?: string | null;
  liveStreamUrl?: string | null;
  explicitLiveChatId?: string | null;
  fetchImpl?: FetchImplementation;
}) {
  if (input.explicitLiveChatId?.trim()) return input.explicitLiveChatId.trim();
  const videoId = youtubeVideoId(input.liveStreamUrl);
  if (!videoId)
    throw Object.assign(
      new Error('Für die Chat-Interaktion fehlt die URL des eigenen laufenden YouTube-Livestreams.'),
      { statusCode: 409 },
    );
  const endpoint = new URL('https://www.googleapis.com/youtube/v3/videos');
  endpoint.searchParams.set('part', 'liveStreamingDetails');
  endpoint.searchParams.set('id', videoId);
  if (input.apiKey?.trim()) endpoint.searchParams.set('key', input.apiKey.trim());
  if (!input.apiKey?.trim() && !input.accessToken?.trim())
    throw Object.assign(new Error('YouTube API-Key oder OAuth-Verbindung fehlt.'), { statusCode: 409 });
  const response = await (input.fetchImpl ?? fetch)(endpoint, { headers: youtubeApiHeaders(input.accessToken) });
  const payload = (await response.json().catch(() => null)) as any;
  if (!response.ok)
    throw Object.assign(youtubeApiError(payload, 'YouTube-Livestream konnte nicht geprüft werden.'), {
      statusCode: 502,
    });
  const liveChatId = text(payload?.items?.[0]?.liveStreamingDetails?.activeLiveChatId, 300);
  if (!liveChatId)
    throw Object.assign(new Error('Für diesen YouTube-Stream ist derzeit kein aktiver Livechat verfügbar.'), {
      statusCode: 409,
    });
  return liveChatId;
}

export async function fetchYoutubeLiveChatPage(input: {
  apiKey?: string | null;
  accessToken?: string | null;
  liveChatId: string;
  pageToken?: string | null;
  fetchImpl?: FetchImplementation;
}): Promise<YoutubeLiveChatPage> {
  const endpoint = new URL('https://www.googleapis.com/youtube/v3/liveChat/messages');
  endpoint.searchParams.set('part', 'id,snippet,authorDetails');
  endpoint.searchParams.set('liveChatId', input.liveChatId);
  endpoint.searchParams.set('maxResults', '200');
  if (input.apiKey?.trim()) endpoint.searchParams.set('key', input.apiKey.trim());
  if (!input.apiKey?.trim() && !input.accessToken?.trim())
    throw Object.assign(new Error('YouTube API-Key oder OAuth-Verbindung fehlt.'), { statusCode: 409 });
  if (input.pageToken) endpoint.searchParams.set('pageToken', input.pageToken);
  const response = await (input.fetchImpl ?? fetch)(endpoint, { headers: youtubeApiHeaders(input.accessToken) });
  const payload = (await response.json().catch(() => null)) as any;
  if (!response.ok)
    throw Object.assign(youtubeApiError(payload, 'YouTube-Livechat konnte nicht abgerufen werden.'), {
      statusCode: 502,
    });
  const items = Array.isArray(payload?.items) ? payload.items : [];
  const messages = items
    .flatMap((item: any): YoutubeLiveChatMessage[] => {
      const messageType = text(item?.snippet?.type, 80);
      if (messageType !== 'textMessageEvent') return [];
      const message = text(item?.snippet?.displayMessage, 500);
      const moderation = moderatePublicChatMessage(message);
      const senderIsChannel = item?.authorDetails?.isChatOwner === true;
      const automatedSenderMessage = senderIsChannel && isAutomatedStudioPrompt(message);
      return [
        {
          providerMessageId: text(item?.id, 300),
          authorName: text(item?.authorDetails?.displayName, 120) || 'Zuschauer',
          authorChannelId: text(item?.authorDetails?.channelId, 200) || null,
          message,
          messageType,
          safe: moderation.safe && !automatedSenderMessage,
          moderationReason: automatedSenderMessage ? 'Automatisierte Sendernachricht' : moderation.reason,
          publishedAt: text(item?.snippet?.publishedAt, 80) || new Date().toISOString(),
        },
      ];
    })
    .filter((message: YoutubeLiveChatMessage) => Boolean(message.providerMessageId && message.message));
  const engagementTypes = new Set(['newSponsorEvent', 'membershipGiftingEvent', 'giftMembershipReceivedEvent']);
  const engagements = items.flatMap((item: any): YoutubeAudienceEvent[] => {
    const messageType = text(item?.snippet?.type, 80);
    if (!engagementTypes.has(messageType)) return [];
    const providerEventId = text(item?.id, 300);
    if (!providerEventId) return [];
    return [
      {
        providerEventId,
        eventType: 'membership',
        authorName: text(item?.authorDetails?.displayName, 120) || null,
        authorChannelId: text(item?.authorDetails?.channelId, 200) || null,
        quantity: Math.max(1, Math.min(1000, Number(item?.snippet?.membershipGiftingDetails?.giftMembershipsCount) || 1)),
        publishedAt: text(item?.snippet?.publishedAt, 80) || new Date().toISOString(),
        source: 'data-api',
      },
    ];
  });
  return {
    liveChatId: input.liveChatId,
    nextPageToken: text(payload?.nextPageToken, 1000) || null,
    pollAfterMs: Math.max(1000, Math.min(60_000, Number(payload?.pollingIntervalMillis) || 5000)),
    messages,
    engagements,
  };
}
