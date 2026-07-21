import { describe, expect, it, vi } from 'vitest';
import { fetchYoutubeLiveChatPage } from '../apps/api/src/youtube-live-chat.js';

describe('YouTube live chat ingestion', () => {
  it('keeps real viewer messages and excludes the channel owner from activity analysis', async () => {
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
      moderationReason: 'Sendernachricht',
    });
  });
});
