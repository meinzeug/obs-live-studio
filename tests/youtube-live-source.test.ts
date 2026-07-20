import { describe, expect, it } from 'vitest';
import { resolveYoutubeLiveSource } from '../apps/api/src/youtube-live-source.js';

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
});
