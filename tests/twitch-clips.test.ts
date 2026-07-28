import { describe, expect, it, vi } from 'vitest';
import { createTwitchLiveClip, twitchClipRuntime } from '../apps/api/src/twitch-clips.js';

function environment(overrides: NodeJS.ProcessEnv = {}): NodeJS.ProcessEnv {
  return {
    STREAM_PLATFORM: 'twitch',
    STREAM_SERVER: 'rtmps://live.twitch.tv:443/app',
    STREAM_KEY: 'live_1234567890',
    TWITCH_CHANNEL_URL: 'https://www.twitch.tv/zeitkante',
    TWITCH_CLIENT_ID: 'client-id',
    TWITCH_ACCESS_TOKEN: 'user-token-with-clips-scope',
    TWITCH_BROADCASTER_ID: '12345',
    ...overrides,
  };
}

describe('Twitch live clips', () => {
  it('creates and exposes a hosted Twitch clip for an active configured target', async () => {
    const fetchImpl = vi.fn(async (input: string | URL | Request, init: RequestInit = {}) => {
      const url = new URL(String(input));
      expect(url.pathname).toBe('/helix/clips');
      expect(new Headers(init.headers).get('Authorization')).toBe('Bearer user-token-with-clips-scope');
      if (init.method === 'POST') {
        expect(url.searchParams.get('broadcaster_id')).toBe('12345');
        return new Response(
          JSON.stringify({ data: [{ id: 'ClipAbc', edit_url: 'https://clips.twitch.tv/edit' }] }),
          {
            status: 202,
            headers: { 'content-type': 'application/json' },
          },
        );
      }
      expect(url.searchParams.get('id')).toBe('ClipAbc');
      return new Response(JSON.stringify({ data: [{ id: 'ClipAbc', url: 'https://clips.twitch.tv/ClipAbc' }] }), {
        status: 200,
        headers: { 'content-type': 'application/json' },
      });
    });

    await expect(
      createTwitchLiveClip(environment(), fetchImpl as unknown as typeof fetch, {
        confirmationAttempts: 1,
        confirmationIntervalMs: 0,
      }),
    ).resolves.toMatchObject({
      enabled: true,
      configured: true,
      lastClipId: 'ClipAbc',
      lastClipUrl: 'https://clips.twitch.tv/ClipAbc',
      error: null,
    });
    expect(fetchImpl).toHaveBeenCalledTimes(2);
  });

  it('reports missing Helix credentials without exposing stream keys', () => {
    const env = environment({ TWITCH_ACCESS_TOKEN: '' });
    const runtime = twitchClipRuntime(env);
    expect(runtime).toMatchObject({ enabled: true, configured: false });
    expect(JSON.stringify(runtime)).not.toContain(env.STREAM_KEY);
  });
});
