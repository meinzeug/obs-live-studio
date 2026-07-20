import { describe, expect, it } from 'vitest';
import {
  resolveYoutubeLiveSource,
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
});
