import { describe, expect, it, vi } from 'vitest';
import {
  ensureYoutubeBroadcastLive,
  type YoutubeLiveOutputRuntime,
} from '../apps/api/src/youtube-live-broadcast.js';

function environment(): NodeJS.ProcessEnv {
  return {
    CHANNEL_NAME: 'Zeitkante',
    STREAM_TARGETS_JSON: JSON.stringify([
      {
        id: 'youtube',
        name: 'YouTube',
        platform: 'youtube',
        server: 'rtmps://a.rtmps.youtube.com:443/live2',
        key: 'configured-youtube-key',
        enabled: true,
        syncStart: true,
        syncStop: true,
      },
    ]),
  };
}

function json(payload: unknown, status = 200) {
  return new Response(JSON.stringify(payload), {
    status,
    headers: { 'content-type': 'application/json' },
  });
}

describe('YouTube live output supervisor', () => {
  it('recognizes an already public broadcast bound to the configured OBS input', async () => {
    const fetchImpl = vi.fn(async (input: string | URL | Request) => {
      const url = new URL(String(input));
      if (url.pathname.endsWith('/liveStreams'))
        return json({
          items: [
            {
              id: 'stream-1',
              cdn: { ingestionInfo: { streamName: 'configured-youtube-key' } },
              status: { streamStatus: 'active', healthStatus: { status: 'good' } },
            },
          ],
        });
      if (url.pathname.endsWith('/liveBroadcasts'))
        return json({
          items: [
            {
              id: 'broadcast-live',
              status: { lifeCycleStatus: 'live', privacyStatus: 'public' },
              contentDetails: { boundStreamId: 'stream-1' },
            },
          ],
        });
      throw new Error(`Unexpected request: ${url}`);
    });

    await expect(
      ensureYoutubeBroadcastLive(environment(), fetchImpl as unknown as typeof fetch, {
        accessToken: 'token',
        pollIntervalMs: 0,
      }),
    ).resolves.toMatchObject({
      enabled: true,
      state: 'live',
      broadcastId: 'broadcast-live',
      watchUrl: 'https://www.youtube.com/watch?v=broadcast-live',
      streamStatus: 'active',
      streamHealth: 'good',
      error: null,
    } satisfies Partial<YoutubeLiveOutputRuntime>);
    expect(fetchImpl).toHaveBeenCalledTimes(2);
  });

  it('replaces an untransitionable Studio instant broadcast with a managed public broadcast', async () => {
    let created = false;
    let bound = false;
    let transitioned = false;
    const requests: Array<{ method: string; path: string; search: string; body: any }> = [];
    const fetchImpl = vi.fn(async (input: string | URL | Request, init: RequestInit = {}) => {
      const url = new URL(String(input));
      const method = init.method ?? 'GET';
      const body = typeof init.body === 'string' ? JSON.parse(init.body) : null;
      requests.push({ method, path: url.pathname, search: url.search, body });
      if (url.pathname.endsWith('/liveStreams'))
        return json({
          items: [
            {
              id: 'stream-1',
              cdn: { ingestionInfo: { streamName: 'configured-youtube-key' } },
              status: { streamStatus: 'active', healthStatus: { status: 'good' } },
            },
          ],
        });
      if (url.pathname.endsWith('/liveBroadcasts/bind')) {
        bound = true;
        return json({ id: 'managed-broadcast', status: { lifeCycleStatus: 'ready' } });
      }
      if (url.pathname.endsWith('/liveBroadcasts/transition')) {
        transitioned = true;
        expect(url.searchParams.get('id')).toBe('managed-broadcast');
        expect(url.searchParams.get('broadcastStatus')).toBe('live');
        return json({ id: 'managed-broadcast', status: { lifeCycleStatus: 'liveStarting' } });
      }
      if (url.pathname.endsWith('/liveBroadcasts') && method === 'POST') {
        created = true;
        expect(body).toMatchObject({
          snippet: { title: 'Bestehender Titel' },
          status: { privacyStatus: 'public' },
          contentDetails: {
            monitorStream: { enableMonitorStream: false },
            enableAutoStart: false,
            enableAutoStop: true,
          },
        });
        return json({
          id: 'managed-broadcast',
          snippet: body.snippet,
          status: { lifeCycleStatus: 'created', privacyStatus: 'public' },
          contentDetails: body.contentDetails,
        });
      }
      if (url.pathname.endsWith('/liveBroadcasts') && url.searchParams.get('id') === 'managed-broadcast') {
        return json({
          items: [
            {
              id: 'managed-broadcast',
              status: { lifeCycleStatus: transitioned ? 'live' : 'ready', privacyStatus: 'public' },
              contentDetails: { boundStreamId: bound ? 'stream-1' : null, monitorStream: { enableMonitorStream: false } },
            },
          ],
        });
      }
      if (url.pathname.endsWith('/liveBroadcasts'))
        return json({
          items: [
            {
              id: 'studio-instant',
              snippet: { title: 'Bestehender Titel' },
              status: { lifeCycleStatus: 'ready', privacyStatus: 'public' },
              contentDetails: { boundStreamId: 'stream-1', monitorStream: { enableMonitorStream: true } },
            },
          ],
        });
      throw new Error(`Unexpected request: ${method} ${url}`);
    });

    await expect(
      ensureYoutubeBroadcastLive(environment(), fetchImpl as unknown as typeof fetch, {
        accessToken: 'token',
        inputAttempts: 1,
        transitionAttempts: 2,
        pollIntervalMs: 0,
        now: () => new Date('2026-07-24T12:00:00.000Z'),
        sleep: async () => undefined,
      }),
    ).resolves.toMatchObject({
      state: 'live',
      broadcastId: 'managed-broadcast',
      watchUrl: 'https://www.youtube.com/watch?v=managed-broadcast',
    });
    expect(created).toBe(true);
    expect(bound).toBe(true);
    expect(transitioned).toBe(true);
    expect(
      requests.some(
        (request) =>
          request.path.endsWith('/liveBroadcasts/transition') && request.search.includes('id=studio-instant'),
      ),
    ).toBe(false);
  });
});
