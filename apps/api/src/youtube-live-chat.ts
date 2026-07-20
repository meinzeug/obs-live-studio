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

export type YoutubeLiveChatPage = {
  liveChatId: string;
  nextPageToken: string | null;
  pollAfterMs: number;
  messages: YoutubeLiveChatMessage[];
};

function text(value: unknown, maximum: number) {
  return typeof value === 'string' ? value.replace(/[\u0000-\u001f\u007f]/g, ' ').replace(/\s+/g, ' ').trim().slice(0, maximum) : '';
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
  return detail || fallback;
}

export async function resolveYoutubeLiveChatId(input: {
  apiKey: string;
  liveStreamUrl?: string | null;
  explicitLiveChatId?: string | null;
  fetchImpl?: FetchImplementation;
}) {
  if (input.explicitLiveChatId?.trim()) return input.explicitLiveChatId.trim();
  const videoId = youtubeVideoId(input.liveStreamUrl);
  if (!videoId) throw Object.assign(new Error('Für die Chat-Interaktion fehlt die URL des eigenen laufenden YouTube-Livestreams.'), { statusCode: 409 });
  const endpoint = new URL('https://www.googleapis.com/youtube/v3/videos');
  endpoint.searchParams.set('part', 'liveStreamingDetails');
  endpoint.searchParams.set('id', videoId);
  endpoint.searchParams.set('key', input.apiKey);
  const response = await (input.fetchImpl ?? fetch)(endpoint, { headers: { Accept: 'application/json' } });
  const payload = (await response.json().catch(() => null)) as any;
  if (!response.ok) throw Object.assign(new Error(youtubeApiError(payload, 'YouTube-Livestream konnte nicht geprüft werden.')), { statusCode: 502 });
  const liveChatId = text(payload?.items?.[0]?.liveStreamingDetails?.activeLiveChatId, 300);
  if (!liveChatId) throw Object.assign(new Error('Für diesen YouTube-Stream ist derzeit kein aktiver Livechat verfügbar.'), { statusCode: 409 });
  return liveChatId;
}

export async function fetchYoutubeLiveChatPage(input: {
  apiKey: string;
  liveChatId: string;
  pageToken?: string | null;
  fetchImpl?: FetchImplementation;
}): Promise<YoutubeLiveChatPage> {
  const endpoint = new URL('https://www.googleapis.com/youtube/v3/liveChat/messages');
  endpoint.searchParams.set('part', 'id,snippet,authorDetails');
  endpoint.searchParams.set('liveChatId', input.liveChatId);
  endpoint.searchParams.set('maxResults', '200');
  endpoint.searchParams.set('key', input.apiKey);
  if (input.pageToken) endpoint.searchParams.set('pageToken', input.pageToken);
  const response = await (input.fetchImpl ?? fetch)(endpoint, { headers: { Accept: 'application/json' } });
  const payload = (await response.json().catch(() => null)) as any;
  if (!response.ok) throw Object.assign(new Error(youtubeApiError(payload, 'YouTube-Livechat konnte nicht abgerufen werden.')), { statusCode: 502 });
  const items = Array.isArray(payload?.items) ? payload.items : [];
  const messages = items.flatMap((item: any): YoutubeLiveChatMessage[] => {
    const messageType = text(item?.snippet?.type, 80);
    if (messageType !== 'textMessageEvent') return [];
    const message = text(item?.snippet?.displayMessage, 500);
    const moderation = moderatePublicChatMessage(message);
    return [{
      providerMessageId: text(item?.id, 300),
      authorName: text(item?.authorDetails?.displayName, 120) || 'Zuschauer',
      authorChannelId: text(item?.authorDetails?.channelId, 200) || null,
      message,
      messageType,
      safe: moderation.safe,
      moderationReason: moderation.reason,
      publishedAt: text(item?.snippet?.publishedAt, 80) || new Date().toISOString(),
    }];
  }).filter((message: YoutubeLiveChatMessage) => Boolean(message.providerMessageId && message.message));
  return {
    liveChatId: input.liveChatId,
    nextPageToken: text(payload?.nextPageToken, 1000) || null,
    pollAfterMs: Math.max(1000, Math.min(60_000, Number(payload?.pollingIntervalMillis) || 5000)),
    messages,
  };
}
