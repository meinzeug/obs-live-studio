import { describe, expect, it } from 'vitest';
import {
  extractActiveYoutubeLiveVideoIds,
  extractYoutubeChannelVideoCandidates,
} from '../apps/api/src/youtube-channel-source.js';

describe('YouTube channel source importer', () => {
  it('extracts unique video candidates from a channel videos page when the RSS feed is unavailable', () => {
    const html = [
      '{"videoId":"01Y8_9HusY4","title":{"runs":[{"text":"Erstes Video"}]}}',
      '{"videoId":"01Y8_9HusY4","thumbnail":{"url":"duplicate"}}',
      '{"videoId":"sIRjWp6A2DE","title":{"runs":[{"text":"Zweites Video"}]}}',
    ].join('');

    expect(extractYoutubeChannelVideoCandidates(html, 10)).toEqual([
      {
        videoId: '01Y8_9HusY4',
        url: 'https://www.youtube.com/watch?v=01Y8_9HusY4',
      },
      {
        videoId: 'sIRjWp6A2DE',
        url: 'https://www.youtube.com/watch?v=sIRjWp6A2DE',
      },
    ]);
  });

  it('honors the candidate limit', () => {
    const html = '{"videoId":"01Y8_9HusY4"}{"videoId":"sIRjWp6A2DE"}';

    expect(extractYoutubeChannelVideoCandidates(html, 1)).toHaveLength(1);
  });

  it('detects only currently live channel entries for automatic programming', () => {
    const html = [
      '{"videoId":"01Y8_9HusY4","badges":[{"metadataBadgeRenderer":{"style":"BADGE_STYLE_TYPE_LIVE_NOW"}}]}',
      '{"videoId":"sIRjWp6A2DE","title":{"simpleText":"Normales Video"}}',
    ].join('');

    expect(extractActiveYoutubeLiveVideoIds(html)).toEqual(['01Y8_9HusY4']);
  });
});
