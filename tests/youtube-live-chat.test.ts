import { describe, expect, it, vi } from 'vitest';
import { fetchYoutubeLiveChatPage } from '../apps/api/src/youtube-live-chat.js';
import {
  discoverYoutubePublicLiveChat,
  fetchYoutubePublicLiveChatPage,
  type YoutubePublicChatCursor,
} from '../apps/api/src/youtube-public-live-chat.js';

function publicChatHtml(actions: unknown[], continuation = 'public-next') {
  return `<script>ytcfg.set(${JSON.stringify({
    INNERTUBE_API_KEY: 'public-client-key',
    INNERTUBE_CONTEXT: { client: { clientName: 'WEB', clientVersion: 'test' } },
  })});window["ytInitialData"] = ${JSON.stringify({
    contents: {
      liveChatRenderer: {
        actions,
        continuations: [{ invalidationContinuationData: { continuation, timeoutMs: 8000 } }],
      },
    },
  })};</script>`;
}

function publicTextAction(input: { id: string; text: string; owner?: boolean; timestampUsec?: string }) {
  return {
    addChatItemAction: {
      item: {
        liveChatTextMessageRenderer: {
          id: input.id,
          message: { runs: [{ text: input.text }] },
          authorName: { simpleText: input.owner ? '@zeitkante' : 'Zuschauer' },
          authorExternalChannelId: input.owner ? 'studio-channel' : 'viewer-channel',
          timestampUsec: input.timestampUsec ?? '1784690890470070',
          authorBadges: input.owner ? [{ liveChatAuthorBadgeRenderer: { icon: { iconType: 'OWNER' } } }] : [],
        },
      },
    },
  };
}

describe('YouTube live chat ingestion', () => {
  it('keeps real questions including owner questions but excludes automatic studio prompts', async () => {
    const fetchImpl = vi.fn().mockResolvedValue(
      new Response(
        JSON.stringify({
          pollingIntervalMillis: 2000,
          nextPageToken: 'next',
          items: [
            {
              id: 'viewer-message',
              snippet: {
                type: 'textMessageEvent',
                displayMessage: 'Beim Netzausbau fehlen konkrete Zahlen.',
                publishedAt: '2026-07-21T12:00:00.000Z',
              },
              authorDetails: { displayName: 'Zuschauer', channelId: 'viewer', isChatOwner: false },
            },
            {
              id: 'studio-message',
              snippet: {
                type: 'textMessageEvent',
                displayMessage: 'Schreibt eure Meinung in den Chat.',
                publishedAt: '2026-07-21T12:00:01.000Z',
              },
              authorDetails: { displayName: 'Zeitkante', channelId: 'studio', isChatOwner: true },
            },
            {
              id: 'owner-question',
              snippet: {
                type: 'textMessageEvent',
                displayMessage: 'Welche Primärquelle belegt diese Zahl?',
                publishedAt: '2026-07-21T12:00:02.000Z',
              },
              authorDetails: { displayName: 'Zeitkante', channelId: 'studio', isChatOwner: true },
            },
          ],
        }),
        { status: 200, headers: { 'content-type': 'application/json' } },
      ),
    );

    const page = await fetchYoutubeLiveChatPage({
      apiKey: 'test-key',
      liveChatId: 'live-chat',
      fetchImpl: fetchImpl as unknown as typeof fetch,
    });

    expect(page.messages[0]).toMatchObject({ providerMessageId: 'viewer-message', safe: true });
    expect(page.messages[1]).toMatchObject({
      providerMessageId: 'studio-message',
      safe: false,
      moderationReason: 'Automatisierte Sendernachricht',
    });
    expect(page.messages[2]).toMatchObject({ providerMessageId: 'owner-question', safe: true });
  });

  it('reads owner questions from the public livechat when the Data API quota is unavailable', async () => {
    const fetchImpl = vi
      .fn()
      .mockResolvedValue(
        new Response(
          publicChatHtml([
            publicTextAction({ id: 'public-question', text: 'Woher kommt Daniele Ganser?', owner: true }),
            publicTextAction({ id: 'public-prompt', text: 'Schreibt eure Meinung in den Chat.', owner: true }),
          ]),
          { status: 200, headers: { 'content-type': 'text/html' } },
        ),
      );

    const page = await fetchYoutubePublicLiveChatPage({
      videoId: '2juC63bMtEc',
      fetchImpl: fetchImpl as unknown as typeof fetch,
    });

    expect(page).toMatchObject({
      liveChatId: 'public:2juC63bMtEc',
      nextPageToken: 'public-next',
      pollAfterMs: 8000,
      transport: 'public-web',
    });
    expect(page.messages).toEqual([
      expect.objectContaining({
        providerMessageId: 'public-question',
        message: 'Woher kommt Daniele Ganser?',
        safe: true,
      }),
      expect.objectContaining({
        providerMessageId: 'public-prompt',
        safe: false,
        moderationReason: 'Automatisierte Sendernachricht',
      }),
    ]);
    expect(String(fetchImpl.mock.calls[0]?.[0])).toContain('/live_chat?');
  });

  it('continues the public livechat cursor and receives newly posted messages', async () => {
    const cursor: YoutubePublicChatCursor = {
      videoId: '2juC63bMtEc',
      apiKey: 'public-client-key',
      context: { client: { clientName: 'WEB', clientVersion: 'test' } },
      continuation: 'previous-page',
    };
    const fetchImpl = vi.fn().mockResolvedValue(
      new Response(
        JSON.stringify({
          continuationContents: {
            liveChatContinuation: {
              actions: [publicTextAction({ id: 'new-question', text: 'Welche Quelle belegt das?' })],
              continuations: [{ timedContinuationData: { continuation: 'next-page', timeoutMs: 3000 } }],
            },
          },
        }),
        { status: 200, headers: { 'content-type': 'application/json' } },
      ),
    );

    const page = await fetchYoutubePublicLiveChatPage({ cursor, fetchImpl: fetchImpl as unknown as typeof fetch });

    expect(page.nextPageToken).toBe('next-page');
    expect(page.messages[0]).toMatchObject({ providerMessageId: 'new-question', safe: true });
    expect(String(fetchImpl.mock.calls[0]?.[0])).toContain('/youtubei/v1/live_chat/get_live_chat');
    expect(fetchImpl.mock.calls[0]?.[1]).toMatchObject({ method: 'POST' });
  });

  it('finds the active sender chat from recent channel feed entries without the Data API', async () => {
    const feed = `<?xml version="1.0"?><feed>
      <entry><yt:videoId>endedLive01</yt:videoId><title>LIVE gestern</title><published>2026-07-21T20:00:00Z</published></entry>
      <entry><yt:videoId>activeLive1</yt:videoId><title>LIVE: Zeitkante TV</title><published>2026-07-21T19:00:00Z</published></entry>
    </feed>`;
    const fetchImpl = vi.fn(async (input: string | URL | Request) => {
      const url = String(input);
      if (url.includes('/feeds/videos.xml')) return new Response(feed, { status: 200 });
      if (url.includes('endedLive01')) {
        return new Response(
          `<script>ytcfg.set(${JSON.stringify({
            INNERTUBE_API_KEY: 'public-client-key',
            INNERTUBE_CONTEXT: { client: { clientName: 'WEB' } },
          })});window["ytInitialData"] = ${JSON.stringify({
            contents: { messageRenderer: { text: { runs: [{ text: 'Die Chatfunktion ist deaktiviert.' }] } } },
          })};</script>`,
          { status: 200 },
        );
      }
      return new Response(publicChatHtml([publicTextAction({ id: 'sender-question', text: 'Was denkt ihr dazu?' })]), {
        status: 200,
      });
    });

    const discovery = await discoverYoutubePublicLiveChat({
      channels: [{ id: 'UCzeitkante', title: 'Zeitkante' }],
      fetchImpl: fetchImpl as unknown as typeof fetch,
    });

    expect(discovery).toMatchObject({
      channelId: 'UCzeitkante',
      videoId: 'activeLive1',
      videoTitle: 'LIVE: Zeitkante TV',
      page: { transport: 'public-web' },
    });
  });
});
