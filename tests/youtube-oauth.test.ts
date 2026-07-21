import { mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { describe, expect, it, vi } from 'vitest';
import {
  deleteYoutubeVideo,
  discoverOwnActiveYoutubeLiveChat,
  encodeYoutubeOAuthChannels,
  listYoutubeVideoStates,
  readYoutubeOAuthChannels,
  updateYoutubeVideoMetadata,
  uploadYoutubeVideoResumable,
  youtubeAuthorizationUrl,
  youtubeOAuthPublicStatus,
  type YoutubeOAuthConfig,
} from '../apps/api/src/youtube-oauth.js';
import { YoutubeShortsSettingsManager } from '../apps/api/src/youtube-shorts.js';
import { buildMediaEnvironment } from '../apps/api/src/media-settings.js';

function oauthConfig(suffix: string): YoutubeOAuthConfig {
  return {
    clientId: `client-${suffix}.apps.googleusercontent.com`,
    clientSecret: `secret-${suffix}`,
    refreshToken: `refresh-${suffix}`,
    redirectUri: 'http://localhost:12001/api/youtube/oauth/callback',
  };
}

function oauthEnvironment(suffix: string): NodeJS.ProcessEnv {
  const config = oauthConfig(suffix);
  return {
    YOUTUBE_OAUTH_CLIENT_ID: config.clientId,
    YOUTUBE_OAUTH_CLIENT_SECRET: config.clientSecret,
    YOUTUBE_OAUTH_REFRESH_TOKEN: config.refreshToken,
    YOUTUBE_OAUTH_REDIRECT_URI: config.redirectUri,
  };
}

describe('YouTube OAuth and upload integration', () => {
  it('reuses the centrally stored Data API connection in the Shorts Creator without exposing the key', async () => {
    const directory = await mkdtemp(join(tmpdir(), 'open-tv-youtube-central-test-'));
    const envFile = join(directory, '.env');
    await writeFile(envFile, 'YOUTUBE_DATA_API_KEY=central-data-api-key\n');
    try {
      const status = await new YoutubeShortsSettingsManager({ envFile, env: {} }).publicOauth();
      expect(status).toMatchObject({
        dataApiConfigured: true,
        researchReady: true,
        uploadReady: false,
        connected: false,
      });
      expect(status.dataApiKeyHint).not.toContain('central-data-api-key');
    } finally {
      await rm(directory, { recursive: true, force: true });
    }
  });

  it('stores OAuth client details alongside the existing central YouTube Data API key', () => {
    const result = buildMediaEnvironment(
      { YOUTUBE_DATA_API_KEY: 'existing-data-key', YOUTUBE_OAUTH_REFRESH_TOKEN: 'old-client-token' },
      {
        commonsEnabled: true,
        wikimediaUserAgent: 'OpenTVStudio/1.0 (unit test)',
        youtubeOauthClientId: 'central-client.apps.googleusercontent.com',
        youtubeOauthClientSecret: 'central-client-secret',
        youtubeOauthRedirectUri: 'http://localhost:12001/api/youtube/oauth/callback',
        aiEnabled: false,
        autoImportVideo: true,
        autoImportGraphic: true,
        discoveryMaxCandidates: 20,
        maxVideoDurationSeconds: 180,
      },
    );
    expect(result.updates).toMatchObject({
      YOUTUBE_DATA_API_KEY: 'existing-data-key',
      YOUTUBE_OAUTH_CLIENT_ID: 'central-client.apps.googleusercontent.com',
      YOUTUBE_OAUTH_CLIENT_SECRET: 'central-client-secret',
      YOUTUBE_OAUTH_REFRESH_TOKEN: '',
      YOUTUBE_OAUTH_CHANNELS_B64: '',
      YOUTUBE_OAUTH_REDIRECT_URI: 'http://localhost:12001/api/youtube/oauth/callback',
    });
  });

  it('keeps channel-bound refresh tokens server-side and exposes only safe channel metadata', () => {
    const channels = [
      {
        id: 'UCzeitkante',
        title: 'Zeitkante',
        handle: '@zeitkante',
        connectedAt: '2026-07-21T16:00:00.000Z',
        refreshToken: 'private-refresh-token',
      },
    ];
    const env = {
      ...oauthEnvironment('profiles'),
      YOUTUBE_OAUTH_CHANNELS_B64: encodeYoutubeOAuthChannels(channels),
    };
    expect(readYoutubeOAuthChannels(env)).toEqual(channels);
    const status = youtubeOAuthPublicStatus(env);
    expect(status.channels).toEqual([
      {
        id: 'UCzeitkante',
        title: 'Zeitkante',
        handle: '@zeitkante',
        connectedAt: '2026-07-21T16:00:00.000Z',
      },
    ]);
    expect(JSON.stringify(status)).not.toContain('private-refresh-token');
  });

  it('discovers and persists the concrete channel during OAuth completion', async () => {
    const directory = await mkdtemp(join(tmpdir(), 'open-tv-youtube-profile-test-'));
    const envFile = join(directory, '.env');
    await writeFile(
      envFile,
      [
        'YOUTUBE_OAUTH_CLIENT_ID=profile-client.apps.googleusercontent.com',
        'YOUTUBE_OAUTH_CLIENT_SECRET=profile-secret',
        'YOUTUBE_OAUTH_REDIRECT_URI=http://localhost:12001/api/youtube/oauth/callback',
        '',
      ].join('\n'),
    );
    const fetchImpl = vi.fn(async (input: string | URL | Request) => {
      const url = String(input);
      if (url === 'https://oauth2.googleapis.com/token')
        return new Response(
          JSON.stringify({ access_token: 'profile-access', refresh_token: 'profile-refresh', expires_in: 3600 }),
          { status: 200 },
        );
      expect(url).toContain('https://www.googleapis.com/youtube/v3/channels');
      expect(url).toContain('mine=true');
      return new Response(
        JSON.stringify({
          items: [{ id: 'UCprofile', snippet: { title: 'Zeitkante Zwei', customUrl: '@zeitkante-zwei' } }],
        }),
        { status: 200 },
      );
    });
    vi.stubGlobal('fetch', fetchImpl);
    try {
      const manager = new YoutubeShortsSettingsManager({ envFile, env: {} });
      const authorization = new URL(await manager.beginOauth('user-1'));
      const completed = await manager.completeOauth(authorization.searchParams.get('state')!, 'authorization-code');
      expect(completed.oauth.channels).toEqual([
        expect.objectContaining({ id: 'UCprofile', title: 'Zeitkante Zwei', handle: '@zeitkante-zwei' }),
      ]);
      const encodedProfiles = (await readFile(envFile, 'utf8'))
        .split(/\r?\n/)
        .find((line) => line.startsWith('YOUTUBE_OAUTH_CHANNELS_B64='))
        ?.slice('YOUTUBE_OAUTH_CHANNELS_B64='.length);
      const stored = readYoutubeOAuthChannels({ YOUTUBE_OAUTH_CHANNELS_B64: encodedProfiles });
      expect(stored).toEqual([expect.objectContaining({ id: 'UCprofile', refreshToken: 'profile-refresh' })]);
    } finally {
      vi.unstubAllGlobals();
      await rm(directory, { recursive: true, force: true });
    }
  });

  it('uses the official authorization endpoint and only the required YouTube scopes', () => {
    const url = new URL(youtubeAuthorizationUrl(oauthConfig('authorization'), 'secure-state'));
    expect(url.origin + url.pathname).toBe('https://accounts.google.com/o/oauth2/v2/auth');
    expect(url.searchParams.get('access_type')).toBe('offline');
    expect(url.searchParams.get('scope')?.split(' ')).toEqual([
      'https://www.googleapis.com/auth/youtube.readonly',
      'https://www.googleapis.com/auth/youtube.upload',
      'https://www.googleapis.com/auth/youtube.force-ssl',
    ]);
  });

  it('marks remotely deleted videos as absent without failing the complete batch', async () => {
    const fetchImpl = vi.fn(async (input: string | URL | Request) => {
      const url = String(input);
      if (url === 'https://oauth2.googleapis.com/token')
        return new Response(JSON.stringify({ access_token: 'access-reconcile', expires_in: 3600 }), { status: 200 });
      expect(url).toContain('/youtube/v3/videos');
      expect(url).toContain('present-short%2Cdeleted-short');
      return new Response(
        JSON.stringify({
          items: [
            {
              id: 'present-short',
              snippet: { channelId: 'UCzeitkante', title: 'Vorhandener Short' },
              status: { privacyStatus: 'public' },
            },
          ],
        }),
        { status: 200 },
      );
    });
    const env = oauthEnvironment('reconcile');
    env.YOUTUBE_OAUTH_CHANNELS_B64 = encodeYoutubeOAuthChannels([
      {
        id: 'UCzeitkante',
        title: 'Zeitkante',
        handle: '@zeitkante',
        connectedAt: '2026-07-21T16:00:00.000Z',
        refreshToken: 'refresh-reconcile',
      },
    ]);

    await expect(
      listYoutubeVideoStates(['present-short', 'deleted-short'], {
        env,
        fetchImpl: fetchImpl as unknown as typeof fetch,
        channelId: 'UCzeitkante',
      }),
    ).resolves.toEqual([
      {
        id: 'present-short',
        channelId: 'UCzeitkante',
        title: 'Vorhandener Short',
        privacyStatus: 'public',
      },
    ]);
  });

  it('updates an owned Short while preserving required YouTube snippet fields', async () => {
    let updateBody: any = null;
    const fetchImpl = vi.fn(async (input: string | URL | Request, init?: RequestInit) => {
      const url = String(input);
      if (url === 'https://oauth2.googleapis.com/token')
        return new Response(JSON.stringify({ access_token: 'access-edit', expires_in: 3600 }), { status: 200 });
      if (init?.method === 'PUT') {
        updateBody = JSON.parse(String(init.body));
        return new Response(
          JSON.stringify({ snippet: { title: updateBody.snippet.title }, status: updateBody.status }),
          { status: 200 },
        );
      }
      return new Response(
        JSON.stringify({
          items: [
            {
              id: 'managed-short',
              snippet: {
                channelId: 'UCmanaged',
                title: 'Alter Titel',
                description: 'Alt',
                categoryId: '25',
                defaultLanguage: 'de',
              },
              status: { privacyStatus: 'private', embeddable: true, selfDeclaredMadeForKids: false },
            },
          ],
        }),
        { status: 200 },
      );
    });
    const env = oauthEnvironment('edit');
    env.YOUTUBE_OAUTH_CHANNELS_B64 = encodeYoutubeOAuthChannels([
      {
        id: 'UCmanaged',
        title: 'Verwalteter Kanal',
        handle: '@verwaltet',
        connectedAt: '2026-07-21T16:00:00.000Z',
        refreshToken: 'refresh-edit',
      },
    ]);

    await expect(
      updateYoutubeVideoMetadata(
        'managed-short',
        {
          title: 'Neuer Titel',
          description: 'Neue Beschreibung',
          tags: ['Einordnung'],
          privacyStatus: 'unlisted',
        },
        { env, fetchImpl: fetchImpl as unknown as typeof fetch, channelId: 'UCmanaged' },
      ),
    ).resolves.toMatchObject({ id: 'managed-short', title: 'Neuer Titel', privacyStatus: 'unlisted' });
    expect(updateBody).toMatchObject({
      id: 'managed-short',
      snippet: { title: 'Neuer Titel', categoryId: '25', defaultLanguage: 'de' },
      status: { privacyStatus: 'unlisted', embeddable: true, containsSyntheticMedia: true },
    });
  });

  it('deletes an owned Short with the official YouTube videos endpoint', async () => {
    const methods: string[] = [];
    const fetchImpl = vi.fn(async (input: string | URL | Request, init?: RequestInit) => {
      const url = String(input);
      if (url === 'https://oauth2.googleapis.com/token')
        return new Response(JSON.stringify({ access_token: 'access-delete', expires_in: 3600 }), { status: 200 });
      methods.push(init?.method || 'GET');
      if (init?.method === 'DELETE') return new Response(null, { status: 204 });
      return new Response(
        JSON.stringify({
          items: [
            {
              id: 'delete-short',
              snippet: { channelId: 'UCdelete', title: 'Short', categoryId: '25' },
              status: { privacyStatus: 'private' },
            },
          ],
        }),
        { status: 200 },
      );
    });
    const env = oauthEnvironment('delete');
    env.YOUTUBE_OAUTH_CHANNELS_B64 = encodeYoutubeOAuthChannels([
      {
        id: 'UCdelete',
        title: 'Löschkanal',
        handle: '@loeschkanal',
        connectedAt: '2026-07-21T16:00:00.000Z',
        refreshToken: 'refresh-delete',
      },
    ]);

    await expect(
      deleteYoutubeVideo('delete-short', {
        env,
        fetchImpl: fetchImpl as unknown as typeof fetch,
        channelId: 'UCdelete',
      }),
    ).resolves.toEqual({ id: 'delete-short', deleted: true });
    expect(methods).toEqual(['GET', 'DELETE']);
  });

  it('discovers the live chat of the authenticated sender instead of assuming the programme video chat', async () => {
    const fetchImpl = vi.fn(async (input: string | URL | Request) => {
      const url = String(input);
      if (url === 'https://oauth2.googleapis.com/token')
        return new Response(JSON.stringify({ access_token: 'access-discovery', expires_in: 3600 }), { status: 200 });
      expect(url).toContain('https://www.googleapis.com/youtube/v3/liveBroadcasts');
      expect(url).toContain('broadcastStatus=active');
      expect(url).toContain('mine=true');
      return new Response(
        JSON.stringify({
          items: [{ id: 'broadcast-1', snippet: { title: 'Zeitkante LIVE', liveChatId: 'chat-1' } }],
        }),
        { status: 200 },
      );
    });

    await expect(
      discoverOwnActiveYoutubeLiveChat(oauthEnvironment('discovery'), fetchImpl as unknown as typeof fetch),
    ).resolves.toEqual({ broadcastId: 'broadcast-1', liveChatId: 'chat-1', title: 'Zeitkante LIVE' });
  });

  it('uploads the rendered MP4 through the official resumable upload protocol', async () => {
    const directory = await mkdtemp(join(tmpdir(), 'open-tv-youtube-upload-test-'));
    const video = join(directory, 'short.mp4');
    await writeFile(video, Buffer.alloc(4096, 7));
    const fetchImpl = vi.fn(async (input: string | URL | Request, init?: RequestInit) => {
      const url = String(input);
      if (url === 'https://oauth2.googleapis.com/token')
        return new Response(JSON.stringify({ access_token: 'access-upload', expires_in: 3600 }), { status: 200 });
      if (init?.method === 'POST') {
        expect(url).toContain('https://www.googleapis.com/upload/youtube/v3/videos');
        expect(url).toContain('uploadType=resumable');
        return new Response(null, { status: 200, headers: { location: 'https://upload.youtube.test/session-1' } });
      }
      expect(url).toBe('https://upload.youtube.test/session-1');
      expect(init?.method).toBe('PUT');
      expect((init?.headers as Record<string, string>)['content-range']).toBe('bytes 0-4095/4096');
      (init?.body as { destroy?: () => void } | undefined)?.destroy?.();
      return new Response(JSON.stringify({ id: 'uploaded-short' }), { status: 200 });
    });

    try {
      await expect(
        uploadYoutubeVideoResumable(
          video,
          {
            title: 'AVA ordnet ein',
            description: 'Quellenbasierte Einordnung',
            tags: ['Shorts', 'Einordnung'],
            privacyStatus: 'private',
          },
          { env: oauthEnvironment('upload'), fetchImpl: fetchImpl as unknown as typeof fetch },
        ),
      ).resolves.toEqual({ id: 'uploaded-short', url: 'https://www.youtube.com/watch?v=uploaded-short' });
    } finally {
      await rm(directory, { recursive: true, force: true });
    }
  });

  it('verifies the selected OAuth channel before uploading to it', async () => {
    const directory = await mkdtemp(join(tmpdir(), 'open-tv-youtube-channel-upload-test-'));
    const video = join(directory, 'short.mp4');
    await writeFile(video, Buffer.alloc(2048, 5));
    const env = oauthEnvironment('selected-channel');
    env.YOUTUBE_OAUTH_CHANNELS_B64 = encodeYoutubeOAuthChannels([
      {
        id: 'UCselected',
        title: 'Ausgewählter Kanal',
        handle: '@ausgewaehlt',
        connectedAt: '2026-07-21T16:00:00.000Z',
        refreshToken: 'selected-channel-refresh',
      },
    ]);
    const fetchImpl = vi.fn(async (input: string | URL | Request, init?: RequestInit) => {
      const url = String(input);
      if (url === 'https://oauth2.googleapis.com/token')
        return new Response(JSON.stringify({ access_token: 'selected-access', expires_in: 3600 }), { status: 200 });
      if (url.includes('/youtube/v3/channels'))
        return new Response(
          JSON.stringify({ items: [{ id: 'UCselected', snippet: { title: 'Ausgewählter Kanal' } }] }),
          { status: 200 },
        );
      if (init?.method === 'POST')
        return new Response(null, { status: 200, headers: { location: 'https://upload.youtube.test/selected' } });
      (init?.body as { destroy?: () => void } | undefined)?.destroy?.();
      return new Response(JSON.stringify({ id: 'selected-short' }), { status: 200 });
    });

    try {
      await expect(
        uploadYoutubeVideoResumable(
          video,
          { title: 'Kanaltest', description: 'Kanalgebundener Upload', tags: [], privacyStatus: 'private' },
          { env, fetchImpl: fetchImpl as unknown as typeof fetch, channelId: 'UCselected' },
        ),
      ).resolves.toMatchObject({ id: 'selected-short' });
      expect(fetchImpl.mock.calls.some(([input]) => String(input).includes('/youtube/v3/channels'))).toBe(true);
    } finally {
      await rm(directory, { recursive: true, force: true });
    }
  });

  it('queries the resumable session and continues after a transient transport failure', async () => {
    const directory = await mkdtemp(join(tmpdir(), 'open-tv-youtube-resume-test-'));
    const video = join(directory, 'short.mp4');
    await writeFile(video, Buffer.alloc(4096, 9));
    let uploadAttempt = 0;
    const fetchImpl = vi.fn(async (input: string | URL | Request, init?: RequestInit) => {
      const url = String(input);
      if (url === 'https://oauth2.googleapis.com/token')
        return new Response(JSON.stringify({ access_token: 'access-resume', expires_in: 3600 }), { status: 200 });
      if (init?.method === 'POST')
        return new Response(null, { status: 200, headers: { location: 'https://upload.youtube.test/session-resume' } });
      const range = (init?.headers as Record<string, string>)['content-range'];
      if (range === 'bytes */4096') return new Response(null, { status: 308, headers: { range: 'bytes=0-2047' } });
      uploadAttempt += 1;
      (init?.body as { destroy?: () => void } | undefined)?.destroy?.();
      if (uploadAttempt === 1) throw new TypeError('connection reset');
      expect(range).toBe('bytes 2048-4095/4096');
      return new Response(JSON.stringify({ id: 'resumed-short' }), { status: 200 });
    });

    try {
      await expect(
        uploadYoutubeVideoResumable(
          video,
          { title: 'AVA', description: 'Einordnung', tags: [], privacyStatus: 'private' },
          { env: oauthEnvironment('resume'), fetchImpl: fetchImpl as unknown as typeof fetch },
        ),
      ).resolves.toMatchObject({ id: 'resumed-short' });
    } finally {
      await rm(directory, { recursive: true, force: true });
    }
  });
});
