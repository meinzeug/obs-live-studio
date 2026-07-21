import { readFile } from 'node:fs/promises';
import { describe, expect, it, vi } from 'vitest';
import {
  fetchYoutubeTranscript,
  parseYoutubeJson3Transcript,
  youtubeTranscriptProjectRoot,
  youtubeCaptionTracksFromWatchPage,
} from '../apps/api/src/youtube-transcript.js';
import { youtubeObsPlayerHtml } from '../apps/api/src/youtube-live-source.js';

describe('YouTube-Einordnung transcript pipeline', () => {
  it('resolves local yt-dlp tooling from the repository even when a workspace changes cwd', () => {
    expect(youtubeTranscriptProjectRoot()).toBe(process.cwd());
  });

  it('extracts real caption track URLs and parses JSON3 without inventing an endpoint', async () => {
    const captionUrl = 'https://www.youtube.com/api/timedtext?v=abcDEF12345&lang=de&signature=signed';
    const watchPage = `<script>window.ytInitialPlayerResponse={"captions":{"playerCaptionsTracklistRenderer":{"captionTracks":[{"baseUrl":"${captionUrl.replaceAll('&', '\\u0026')}","languageCode":"de","name":{"simpleText":"Deutsch"}}]}}};</script>`;
    const words = Array.from({ length: 30 }, (_, index) => `Einordnung-${index}`).join(' ');
    const fetchImpl = vi.fn(async (input: string | URL | Request) => {
      const url = String(input);
      if (url.includes('/watch?')) return new Response(watchPage, { status: 200 });
      expect(url).toContain('/api/timedtext');
      expect(url).toContain('fmt=json3');
      return new Response(JSON.stringify({ events: [{ tStartMs: 0, dDurationMs: 5000, segs: [{ utf8: words }] }] }), {
        status: 200,
      });
    }) as typeof fetch;

    expect(youtubeCaptionTracksFromWatchPage(watchPage)).toHaveLength(1);
    const transcript = await fetchYoutubeTranscript('abcDEF12345', { fetchImpl });
    expect(transcript).toMatchObject({ language: 'de', source: 'youtube-captions' });
    expect(transcript.text.length).toBeGreaterThan(120);
    expect(fetchImpl).toHaveBeenCalledTimes(2);
  });

  it('removes empty, duplicate, music and applause segments', () => {
    expect(
      parseYoutubeJson3Transcript({
        events: [
          { tStartMs: 0, dDurationMs: 500, segs: [{ utf8: '[Musik]' }] },
          { tStartMs: 500, dDurationMs: 500, segs: [{ utf8: 'Erste Aussage' }] },
          { tStartMs: 1000, dDurationMs: 500, segs: [{ utf8: 'Erste Aussage' }] },
          { tStartMs: 1500, dDurationMs: 500, segs: [{ utf8: 'Zweite Aussage' }] },
        ],
      }),
    ).toEqual([
      { startMs: 500, durationMs: 500, text: 'Erste Aussage' },
      { startMs: 1500, durationMs: 500, text: 'Zweite Aussage' },
    ]);
  });

  it('adds only the local, item-bound control channel to the OBS player', () => {
    const itemId = '11111111-1111-4111-8111-111111111111';
    const html = youtubeObsPlayerHtml('http://127.0.0.1:12000', 'abcDEF12345', 42, itemId);
    expect(html).toContain(`/api/live/youtube/control/`);
    expect(html).toContain(`/api/live/youtube/progress/`);
    expect(html).toContain(itemId);
    expect(html).toContain("next?'pauseVideo':'playVideo'");
    expect(html).toContain("data.event!=='infoDelivery'");
    expect(html).toContain('start=42');
  });

  it('installs the current yt-dlp EJS stack and supports an opt-in local browser session', async () => {
    const [installer, transcript] = await Promise.all([
      readFile('scripts/install-youtube-transcript-tools.sh', 'utf8'),
      readFile('apps/api/src/youtube-transcript.ts', 'utf8'),
    ]);
    expect(installer).toContain("'yt-dlp[default]'");
    expect(installer).toContain("'bgutil-ytdlp-pot-provider==1.3.1'");
    expect(transcript).toContain("'--js-runtimes'");
    expect(transcript).toContain('YTDLP_COOKIES_FROM_BROWSER');
    expect(transcript).toContain('youtubepot-bgutilscript:server_home=');
  });

  it('promotes a completed transcript analysis into the live overlay and host session', async () => {
    const [api, staffStore, runtime, broadcastEngine] = await Promise.all([
      readFile('apps/api/src/index.ts', 'utf8'),
      readFile('packages/database/src/ai-staff.ts', 'utf8'),
      readFile('apps/api/src/ai-tv-team.ts', 'utf8'),
      readFile('packages/broadcast-engine/src/index.ts', 'utf8'),
    ]);
    expect(api).toContain("yv.editorial_analysis_status='ready'");
    expect(api).toContain('row?.latest_analysis');
    expect(staffStore).toContain("case when yv.editorial_analysis_status='ready' then yv.editorial_analysis end");
    expect(runtime).toContain("eventType: 'youtube_context_live_refresh'");
    expect(runtime).toContain('getYoutubeContextPlaybackControl(session.broadcast_item_id)');
    expect(runtime).toContain('media_position_ms');
    expect(broadcastEngine).toContain('shouldEndPlayback');
    expect(broadcastEngine).toContain('youtubePlayerReachedEnd');
    expect(broadcastEngine).toContain('playerState === 0');
  });
});
