import { mkdtemp, readFile, rm, truncate, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, describe, expect, it, vi } from 'vitest';
import {
  exchangeTikTokAuthorizationCode,
  fetchTikTokPublishStatus,
  initializeTikTokDirectPost,
  queryTikTokCreatorInfo,
  refreshTikTokAccessToken,
  tikTokAuthorizationUrl,
  uploadTikTokVideo,
} from '../apps/api/src/tiktok-api.js';
import { readTikTokOAuthProfile, TikTokOAuthManager } from '../apps/api/src/tiktok-oauth-manager.js';

const temporary: string[] = [];
afterEach(async () => {
  await Promise.all(temporary.splice(0).map((path) => rm(path, { recursive: true, force: true })));
});

function response(payload: unknown, status = 200, headers?: HeadersInit) {
  return new Response(payload === null ? null : JSON.stringify(payload), {
    status,
    headers: { 'content-type': 'application/json', ...headers },
  });
}

describe('TikTok Content Posting API', () => {
  it('uses the current OAuth v2 endpoints and required server-side scopes', async () => {
    const config = {
      clientKey: 'client-key',
      clientSecret: 'client-secret',
      redirectUri: 'https://studio.test/callback',
    };
    const url = new URL(tikTokAuthorizationUrl(config, 'state-123'));
    expect(`${url.origin}${url.pathname}`).toBe('https://www.tiktok.com/v2/auth/authorize/');
    expect(url.searchParams.get('scope')).toBe('user.info.basic,video.publish');
    expect(url.searchParams.get('state')).toBe('state-123');

    const fetchImpl = vi.fn(async (_url: string | URL | Request, init?: RequestInit) => {
      expect(String(_url)).toBe('https://open.tiktokapis.com/v2/oauth/token/');
      expect(init?.headers).toMatchObject({ 'content-type': 'application/x-www-form-urlencoded' });
      const body = new URLSearchParams(String(init?.body));
      expect(body.get('grant_type')).toBe('authorization_code');
      expect(body.get('client_secret')).toBe('client-secret');
      return response({
        access_token: 'access-token',
        expires_in: 86_400,
        open_id: 'open-id',
        refresh_expires_in: 31_536_000,
        refresh_token: 'refresh-token',
        scope: 'user.info.basic,video.publish',
      });
    });
    await expect(
      exchangeTikTokAuthorizationCode(config, 'auth-code', fetchImpl as typeof fetch),
    ).resolves.toMatchObject({
      accessToken: 'access-token',
      refreshToken: 'refresh-token',
      openId: 'open-id',
    });
  });

  it('returns and persists rotated refresh tokens', async () => {
    const config = { clientKey: 'key', clientSecret: 'secret', redirectUri: 'https://studio.test/callback' };
    const refreshed = await refreshTikTokAccessToken(
      config,
      'old-refresh',
      vi.fn(async () =>
        response({
          access_token: 'new-access',
          expires_in: 86_400,
          open_id: 'open-id',
          refresh_token: 'new-refresh',
          refresh_expires_in: 31_536_000,
          scope: 'video.publish',
        }),
      ) as typeof fetch,
    );
    expect(refreshed.refreshToken).toBe('new-refresh');

    const directory = await mkdtemp(join(tmpdir(), 'tiktok-oauth-test-'));
    temporary.push(directory);
    const envFile = join(directory, '.env');
    const profile = Buffer.from(
      JSON.stringify({
        openId: 'open-id',
        refreshToken: 'old-refresh',
        scope: 'video.publish',
        nickname: 'Creator',
        username: 'creator',
        avatarUrl: '',
        connectedAt: new Date(0).toISOString(),
      }),
    ).toString('base64url');
    await writeFile(
      envFile,
      `TIKTOK_CLIENT_KEY=key\nTIKTOK_CLIENT_SECRET=secret\nTIKTOK_OAUTH_PROFILE_B64=${profile}\n`,
      { mode: 0o600 },
    );
    const manager = new TikTokOAuthManager({ envFile, env: {} });
    await manager.accessToken(
      vi.fn(async () =>
        response({
          access_token: 'new-access',
          expires_in: 86_400,
          open_id: 'open-id',
          refresh_token: 'new-refresh',
          refresh_expires_in: 31_536_000,
          scope: 'video.publish',
        }),
      ) as typeof fetch,
    );
    const saved = Object.fromEntries(
      (await readFile(envFile, 'utf8'))
        .trim()
        .split('\n')
        .map((line) => line.split(/=(.*)/s).slice(0, 2)),
    );
    expect(readTikTokOAuthProfile(saved)?.refreshToken).toBe('new-refresh');
    const publicStatus = await manager.publicStatus();
    expect(publicStatus).not.toHaveProperty('refreshToken');
    expect(publicStatus.account).not.toHaveProperty('openId');
  });

  it('maps current creator choices and initializes an AIGC direct post', async () => {
    const creator = await queryTikTokCreatorInfo(
      'token',
      vi.fn(async (url: string | URL | Request) => {
        expect(String(url)).toContain('/v2/post/publish/creator_info/query/');
        return response({
          data: {
            creator_avatar_url: 'https://example.test/avatar.jpg',
            creator_username: 'zeitkante',
            creator_nickname: 'Zeitkante',
            privacy_level_options: ['PUBLIC_TO_EVERYONE', 'SELF_ONLY'],
            comment_disabled: false,
            duet_disabled: true,
            stitch_disabled: false,
            max_video_post_duration_sec: 180,
          },
          error: { code: 'ok', message: '', log_id: 'log' },
        });
      }) as typeof fetch,
    );
    expect(creator).toMatchObject({ nickname: 'Zeitkante', duetDisabled: true, maxVideoPostDurationSec: 180 });

    const fetchImpl = vi.fn(async (_url: string | URL | Request, init?: RequestInit) => {
      const body = JSON.parse(String(init?.body));
      expect(body.post_info).toMatchObject({
        privacy_level: 'SELF_ONLY',
        is_aigc: true,
        disable_comment: true,
      });
      expect(body.source_info).toMatchObject({
        source: 'FILE_UPLOAD',
        video_size: 70 * 1024 * 1024,
        total_chunk_count: 2,
      });
      return response({
        data: { publish_id: 'publish-id', upload_url: 'https://upload.test/video' },
        error: { code: 'ok' },
      });
    });
    await expect(
      initializeTikTokDirectPost(
        'token',
        70 * 1024 * 1024,
        {
          title: 'Einordnung',
          privacyLevel: 'SELF_ONLY',
          disableComment: true,
          disableDuet: true,
          disableStitch: true,
          brandContentToggle: false,
          brandOrganicToggle: false,
          isAigc: true,
        },
        fetchImpl as typeof fetch,
      ),
    ).resolves.toMatchObject({ publishId: 'publish-id', totalChunkCount: 2 });
  });

  it('rejects empty and oversized uploads before contacting TikTok', async () => {
    const fetchImpl = vi.fn();
    const post = {
      title: 'Einordnung',
      privacyLevel: 'SELF_ONLY',
      disableComment: true,
      disableDuet: true,
      disableStitch: true,
      brandContentToggle: false,
      brandOrganicToggle: false,
      isAigc: true,
    };
    await expect(initializeTikTokDirectPost('token', 0, post, fetchImpl)).rejects.toThrow('maximal 4 GB');
    await expect(initializeTikTokDirectPost('token', 4 * 1024 ** 3 + 1, post, fetchImpl)).rejects.toThrow(
      'maximal 4 GB',
    );
    expect(fetchImpl).not.toHaveBeenCalled();
  });

  it('uploads chunks sequentially with the status codes required by TikTok', async () => {
    const directory = await mkdtemp(join(tmpdir(), 'tiktok-upload-test-'));
    temporary.push(directory);
    const file = join(directory, 'clip.mp4');
    await writeFile(file, '');
    await truncate(file, 70 * 1024 * 1024);
    const calls: string[] = [];
    const fetchImpl = vi.fn(async (_url: string | URL | Request, init?: RequestInit) => {
      calls.push(new Headers(init?.headers).get('content-range') || '');
      (init?.body as { destroy?: () => void } | undefined)?.destroy?.();
      return response(null, calls.length === 1 ? 206 : 201);
    });
    await uploadTikTokVideo('https://upload.test/video', file, 35 * 1024 * 1024, fetchImpl as typeof fetch);
    expect(calls).toEqual([
      `bytes 0-${35 * 1024 * 1024 - 1}/${70 * 1024 * 1024}`,
      `bytes ${35 * 1024 * 1024}-${70 * 1024 * 1024 - 1}/${70 * 1024 * 1024}`,
    ]);
  });

  it('uses the official status endpoint and public post id field', async () => {
    const state = await fetchTikTokPublishStatus(
      'token',
      'publish-id',
      vi.fn(async (url: string | URL | Request) => {
        expect(String(url)).toContain('/v2/post/publish/status/fetch/');
        return response({
          data: { status: 'PUBLISH_COMPLETE', publicaly_available_post_id: ['post-id'], uploaded_bytes: 123 },
          error: { code: 'ok' },
        });
      }) as typeof fetch,
    );
    expect(state).toEqual({ status: 'PUBLISH_COMPLETE', failReason: '', uploadedBytes: 123, postIds: ['post-id'] });
  });
});
