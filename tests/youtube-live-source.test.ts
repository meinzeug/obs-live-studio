import { describe, expect, it } from 'vitest';
import {
  parseIso8601YoutubeDuration,
  resolveYoutubeLiveSource,
  resolveYoutubeVideoDuration,
  resolveYoutubeVideoMetadata,
  youtubeObsPlayerHtml,
  youtubeObsViewerUrl,
} from '../apps/api/src/youtube-live-source.js';

describe('YouTube live sources', () => {
  it.each([
    'https://www.youtube.com/watch?v=abcDEF_1234',
    'https://youtu.be/abcDEF_1234',
    'https://www.youtube.com/live/abcDEF_1234?feature=share',
    'https://www.youtube-nocookie.com/embed/abcDEF_1234',
  ])('converts %s into a safe autoplay viewer URL', (url) => {
    const source = resolveYoutubeLiveSource(url);
    expect(source.sourceId).toBe('youtube:abcDEF_1234');
    expect(source.viewerUrl).toContain('youtube-nocookie.com/embed/abcDEF_1234');
    expect(source.viewerUrl).toContain('autoplay=1');
    expect(source.viewerUrl).toContain('mute=0');
    expect(source.previewUrl).toContain('abcDEF_1234');
  });

  it('rejects foreign hosts and channel-only URLs', () => {
    expect(() => resolveYoutubeLiveSource('https://example.com/watch?v=abcDEF_1234')).toThrow(/YouTube-Quelle/);
    expect(() => resolveYoutubeLiveSource('https://www.youtube.com/@example/live')).toThrow(/keine konkrete Video-ID/);
  });

  it('renders an OBS wrapper that identifies the embedded player through its referrer', () => {
    const viewerUrl = youtubeObsViewerUrl('http://127.0.0.1:12000', 'abcDEF_1234');
    const html = youtubeObsPlayerHtml('http://127.0.0.1:12000', 'abcDEF_1234');

    expect(viewerUrl).toBe('http://127.0.0.1:12000/live/youtube/abcDEF_1234');
    expect(html).toContain('referrerpolicy="strict-origin-when-cross-origin"');
    expect(html).toContain('origin=http%3A%2F%2F127.0.0.1%3A12000');
    expect(html).toContain('widget_referrer=http%3A%2F%2F127.0.0.1%3A12000%2Flive%2Fyoutube%2FabcDEF_1234');
    expect(html).toContain('controls=1');
  });

  it('starts a recovered OBS player at the requested safe playback position', () => {
    const html = youtubeObsPlayerHtml('http://127.0.0.1:12000', 'abcDEF_1234', 742.9);

    expect(html).toContain('start=742');
    expect(youtubeObsPlayerHtml('http://127.0.0.1:12000', 'abcDEF_1234')).not.toContain('start=');
  });

  it('parses YouTube Data API ISO-8601 durations', () => {
    expect(parseIso8601YoutubeDuration('PT1H2M3S')).toBe(3723);
    expect(parseIso8601YoutubeDuration('PT45M')).toBe(2700);
    expect(parseIso8601YoutubeDuration('P1DT2S')).toBe(86402);
    expect(parseIso8601YoutubeDuration('PT0S')).toBeNull();
  });

  it('resolves duration from YouTube Data API before using the watch-page fallback', async () => {
    const calls: string[] = [];
    const metadata = await resolveYoutubeVideoMetadata('abcDEF_1234', {
      apiKey: 'key',
      fetchImpl: (async (input: RequestInfo | URL) => {
        calls.push(String(input));
        return new Response(
          JSON.stringify({
            items: [{ contentDetails: { duration: 'PT12M34S' }, snippet: { channelTitle: 'Kanal Eins' } }],
          }),
          {
            status: 200,
            headers: { 'content-type': 'application/json' },
          },
        );
      }) as typeof fetch,
    });

    expect(metadata).toEqual({ durationSeconds: 754, channelTitle: 'Kanal Eins' });
    expect(calls).toHaveLength(1);
    expect(calls[0]).toContain('youtube/v3/videos');
  });

  it('falls back to the watch page lengthSeconds value', async () => {
    const duration = await resolveYoutubeVideoDuration('abcDEF_1234', {
      apiKey: 'key',
      fetchImpl: (async (input: RequestInfo | URL) => {
        if (String(input).includes('youtube/v3/videos')) {
          return new Response(JSON.stringify({ items: [] }), { status: 200 });
        }
        return new Response('<script>var ytInitialPlayerResponse={"videoDetails":{"lengthSeconds":"98"}}</script>', {
          status: 200,
        });
      }) as typeof fetch,
    });

    expect(duration).toBe(98);
  });

  it('keeps the duration-only helper compatible with existing callers', async () => {
    const duration = await resolveYoutubeVideoDuration('abcDEF_1234', {
      fetchImpl: (async () =>
        new Response(
          '<script>var ytInitialPlayerResponse={"videoDetails":{"lengthSeconds":"123","ownerChannelName":"Fallback Kanal"}}</script>',
          { status: 200 },
        )) as typeof fetch,
    });

    expect(duration).toBe(123);
  });
});
