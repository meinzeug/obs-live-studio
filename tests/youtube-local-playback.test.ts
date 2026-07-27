import { describe, expect, it } from 'vitest';
import {
  getYoutubePlaybackProxyTarget,
  parseYoutubeLocalPlaybackOutput,
  readYoutubeHlsManifest,
  registerYoutubePlaybackProxyTarget,
  rewriteYoutubeHlsManifest,
  youtubeLocalPlaybackArguments,
} from '../apps/api/src/youtube-local-playback.js';

describe('local YouTube playback resolver', () => {
  it('combines the local browser session and PO-token provider', () => {
    const args = youtubeLocalPlaybackArguments('abcDEF_1234', {
      projectRoot: '/studio',
      nodeExecutable: '/usr/bin/node',
      providerAvailable: true,
      environment: {
        YTDLP_COOKIES_FROM_BROWSER: 'chrome:Default',
        YTDLP_POT_PROVIDER_HOME: 'var/provider',
      },
    });

    expect(args).toContain('--cookies-from-browser');
    expect(args).toContain('chrome:Default');
    expect(args).toContain('youtubepot-bgutilscript:server_home=/studio/var/provider');
    expect(args).toContain('youtube:fetch_pot=always');
    expect(args).toContain('best[height<=1080]/best');
    expect(args.at(-1)).toBe('https://www.youtube.com/watch?v=abcDEF_1234');
  });

  it('accepts only signed YouTube media hosts and limits cache lifetime', () => {
    const now = Date.parse('2026-07-24T12:00:00.000Z');
    const output = JSON.stringify({
      protocol: 'm3u8_native',
      isLive: true,
      title: 'Live Test',
      url: 'https://manifest.googlevideo.com/api/manifest/hls_playlist/expire/1999999999/playlist/index.m3u8',
    });
    const result = parseYoutubeLocalPlaybackOutput('abcDEF_1234', output, now);

    expect(result).toMatchObject({
      videoId: 'abcDEF_1234',
      protocol: 'm3u8_native',
      isLive: true,
      title: 'Live Test',
    });
    expect(new Date(result.expiresAt).getTime()).toBe(now + 10 * 60_000);
  });

  it('rejects unexpected media redirects', () => {
    expect(() =>
      parseYoutubeLocalPlaybackOutput(
        'abcDEF_1234',
        JSON.stringify({
          protocol: 'https',
          isLive: false,
          title: 'Unsafe',
          url: 'https://example.com/video.mp4',
        }),
      ),
    ).toThrow(/unerwartete Medienadresse/);
  });

  it('rewrites HLS variants and segments to opaque local proxy tokens', () => {
    const manifestUrl =
      'https://manifest.googlevideo.com/api/manifest/hls_playlist/expire/1999999999/playlist/index.m3u8';
    const manifest = [
      '#EXTM3U',
      '#EXT-X-MEDIA:TYPE=AUDIO,URI="audio/index.m3u8"',
      '#EXTINF:2.0,',
      'https://rr1---sn-test.googlevideo.com/videoplayback?expire=1999999999&id=segment',
    ].join('\n');
    const rewritten = rewriteYoutubeHlsManifest('abcDEF_1234', manifest, manifestUrl);
    const targets = [...rewritten.matchAll(/\/proxy\/([a-zA-Z0-9_-]+)/g)].map((match) =>
      getYoutubePlaybackProxyTarget('abcDEF_1234', match[1]),
    );

    expect(rewritten).not.toContain('googlevideo.com');
    expect(targets).toHaveLength(2);
    expect(targets[0]).toContain('/audio/index.m3u8');
    expect(targets[1]).toContain('id=segment');
  });

  it('does not allow a playback token to be reused for another video', () => {
    const path = registerYoutubePlaybackProxyTarget(
      'abcDEF_1234',
      'https://rr1---sn-test.googlevideo.com/videoplayback?expire=1999999999&id=segment',
    );
    const token = path.split('/').at(-1)!;

    expect(() => getYoutubePlaybackProxyTarget('different12', token)).toThrow(/abgelaufen/);
  });

  it('accepts large live manifests within the configured bound and stops before exceeding it', async () => {
    const validManifest = `#EXTM3U\n${'#EXTINF:2.0,\nsegment.ts\n'.repeat(190_000)}`;
    const response = new Response(validManifest, {
      headers: { 'content-type': 'application/vnd.apple.mpegurl' },
    });
    await expect(readYoutubeHlsManifest(response, 16 * 1024 * 1024)).resolves.toBe(validManifest);

    const oversized = new Response(validManifest, {
      headers: { 'content-type': 'application/vnd.apple.mpegurl' },
    });
    await expect(readYoutubeHlsManifest(oversized, 1024 * 1024)).rejects.toThrow(/Größenlimit/);
  });
});
