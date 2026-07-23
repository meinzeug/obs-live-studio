type FetchImplementation = typeof fetch;

export type YoutubeRecentSubscriber = {
  id: string;
  name: string;
  subscribedAt: string;
};

export type TwitchAudienceIdentity = {
  id: string;
  name: string;
  occurredAt: string;
};

function clean(value: unknown, maximum: number) {
  return typeof value === 'string'
    ? value
        .replace(/[\u0000-\u001f\u007f]/g, ' ')
        .replace(/\s+/g, ' ')
        .trim()
        .slice(0, maximum)
    : '';
}

async function providerPayload(response: Response) {
  return (await response.json().catch(() => null)) as any;
}

function providerError(response: Response, payload: any, fallback: string) {
  const reason = clean(payload?.error?.errors?.[0]?.reason, 100) || clean(payload?.error?.status, 100) || null;
  const detail = clean(payload?.error?.message, 500) || clean(payload?.message, 500) || fallback;
  const rateLimitReset = Number(response.headers.get('ratelimit-reset'));
  return Object.assign(new Error(detail), {
    statusCode: response.status,
    reason,
    retryAt:
      response.status === 429 && Number.isFinite(rateLimitReset)
        ? new Date(Math.max(Date.now() + 30_000, rateLimitReset * 1000)).toISOString()
        : null,
  });
}

export async function fetchYoutubeVideoLikeCount(input: {
  videoId: string;
  apiKey?: string | null;
  accessToken?: string | null;
  fetchImpl?: FetchImplementation;
}) {
  const endpoint = new URL('https://www.googleapis.com/youtube/v3/videos');
  endpoint.searchParams.set('part', 'statistics');
  endpoint.searchParams.set('id', clean(input.videoId, 30));
  if (input.apiKey?.trim()) endpoint.searchParams.set('key', input.apiKey.trim());
  if (!input.apiKey?.trim() && !input.accessToken?.trim()) throw new Error('YouTube API-Key oder OAuth fehlt.');
  const response = await (input.fetchImpl ?? fetch)(endpoint, {
    headers: {
      accept: 'application/json',
      ...(input.accessToken?.trim() ? { Authorization: `Bearer ${input.accessToken.trim()}` } : {}),
    },
    signal: AbortSignal.timeout(20_000),
  });
  const payload = await providerPayload(response);
  if (!response.ok) throw providerError(response, payload, 'YouTube-Likes konnten nicht gelesen werden.');
  const count = Number(payload?.items?.[0]?.statistics?.likeCount);
  return Number.isFinite(count) && count >= 0 ? Math.floor(count) : null;
}

export async function fetchYoutubeRecentSubscribers(input: {
  accessToken: string;
  fetchImpl?: FetchImplementation;
}) {
  const endpoint = new URL('https://www.googleapis.com/youtube/v3/subscriptions');
  endpoint.searchParams.set('part', 'snippet,subscriberSnippet');
  endpoint.searchParams.set('myRecentSubscribers', 'true');
  endpoint.searchParams.set('maxResults', '50');
  const response = await (input.fetchImpl ?? fetch)(endpoint, {
    headers: { accept: 'application/json', Authorization: `Bearer ${input.accessToken.trim()}` },
    signal: AbortSignal.timeout(20_000),
  });
  const payload = await providerPayload(response);
  if (!response.ok) throw providerError(response, payload, 'Öffentliche YouTube-Abonnenten konnten nicht gelesen werden.');
  const items = Array.isArray(payload?.items) ? payload.items : [];
  return items
    .map((item: any): YoutubeRecentSubscriber | null => {
      const id =
        clean(item?.subscriberSnippet?.channelId, 200) || clean(item?.snippet?.resourceId?.channelId, 200) || '';
      if (!id) return null;
      return {
        id,
        name:
          clean(item?.subscriberSnippet?.title, 120) || clean(item?.snippet?.title, 120) || 'Neues Kanalmitglied',
        subscribedAt: clean(item?.snippet?.publishedAt, 80) || new Date().toISOString(),
      };
    })
    .filter((entry: YoutubeRecentSubscriber | null): entry is YoutubeRecentSubscriber => Boolean(entry));
}

function twitchHeaders(clientId: string, accessToken: string) {
  return { accept: 'application/json', 'Client-Id': clientId.trim(), Authorization: `Bearer ${accessToken.trim()}` };
}

export async function resolveTwitchBroadcasterId(input: {
  clientId: string;
  accessToken: string;
  login: string;
  fetchImpl?: FetchImplementation;
}) {
  const endpoint = new URL('https://api.twitch.tv/helix/users');
  endpoint.searchParams.set('login', clean(input.login, 40));
  const response = await (input.fetchImpl ?? fetch)(endpoint, {
    headers: twitchHeaders(input.clientId, input.accessToken),
    signal: AbortSignal.timeout(20_000),
  });
  const payload = await providerPayload(response);
  if (!response.ok) throw providerError(response, payload, 'Der Twitch-Kanal konnte nicht aufgelöst werden.');
  return clean(payload?.data?.[0]?.id, 100) || null;
}

export async function fetchTwitchFollowers(input: {
  clientId: string;
  accessToken: string;
  broadcasterId: string;
  fetchImpl?: FetchImplementation;
}) {
  const endpoint = new URL('https://api.twitch.tv/helix/channels/followers');
  endpoint.searchParams.set('broadcaster_id', clean(input.broadcasterId, 100));
  endpoint.searchParams.set('first', '100');
  const response = await (input.fetchImpl ?? fetch)(endpoint, {
    headers: twitchHeaders(input.clientId, input.accessToken),
    signal: AbortSignal.timeout(20_000),
  });
  const payload = await providerPayload(response);
  if (!response.ok) throw providerError(response, payload, 'Twitch-Follows konnten nicht gelesen werden.');
  return (Array.isArray(payload?.data) ? payload.data : [])
    .map((entry: any): TwitchAudienceIdentity | null => {
      const id = clean(entry?.user_id, 100);
      if (!id) return null;
      return {
        id,
        name: clean(entry?.user_name, 120) || clean(entry?.user_login, 120) || 'Neuer Twitch-Follower',
        occurredAt: clean(entry?.followed_at, 80) || new Date().toISOString(),
      };
    })
    .filter((entry: TwitchAudienceIdentity | null): entry is TwitchAudienceIdentity => Boolean(entry));
}

export async function fetchTwitchSubscriptions(input: {
  clientId: string;
  accessToken: string;
  broadcasterId: string;
  fetchImpl?: FetchImplementation;
}) {
  const endpoint = new URL('https://api.twitch.tv/helix/subscriptions');
  endpoint.searchParams.set('broadcaster_id', clean(input.broadcasterId, 100));
  endpoint.searchParams.set('first', '100');
  const response = await (input.fetchImpl ?? fetch)(endpoint, {
    headers: twitchHeaders(input.clientId, input.accessToken),
    signal: AbortSignal.timeout(20_000),
  });
  const payload = await providerPayload(response);
  if (!response.ok) throw providerError(response, payload, 'Twitch-Abonnements konnten nicht gelesen werden.');
  return (Array.isArray(payload?.data) ? payload.data : [])
    .map((entry: any): TwitchAudienceIdentity | null => {
      const id = clean(entry?.user_id, 100);
      if (!id) return null;
      return {
        id,
        name: clean(entry?.user_name, 120) || clean(entry?.user_login, 120) || 'Neuer Twitch-Abonnent',
        occurredAt: new Date().toISOString(),
      };
    })
    .filter((entry: TwitchAudienceIdentity | null): entry is TwitchAudienceIdentity => Boolean(entry));
}

