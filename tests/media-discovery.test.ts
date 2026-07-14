import { afterEach, describe, expect, it, vi } from 'vitest';
import { discoverArticleMedia } from '../packages/media-engine/src/discovery-v2.js';

afterEach(() => {
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
});

describe('article media discovery', () => {
  it('uses the current Pexels v1 video endpoint and preserves attribution', async () => {
    const requested: string[] = [];
    vi.stubGlobal(
      'fetch',
      vi.fn(async (input: string | URL) => {
        const url = String(input);
        requested.push(url);
        if (url.includes('/v1/videos/search')) {
          return new Response(
            JSON.stringify({
              videos: [
                {
                  id: 77,
                  url: 'https://www.pexels.com/video/77/',
                  image: 'https://images.pexels.com/videos/77/preview.jpg',
                  duration: 12,
                  user: { name: 'Max Muster' },
                  video_files: [
                    {
                      link: 'https://videos.pexels.com/video-files/77/77-hd.mp4',
                      file_type: 'video/mp4',
                      width: 1920,
                      height: 1080,
                    },
                  ],
                },
              ],
            }),
            { status: 200, headers: { 'content-type': 'application/json' } },
          );
        }
        if (url.includes('/v1/search')) {
          return new Response(JSON.stringify({ photos: [] }), {
            status: 200,
            headers: { 'content-type': 'application/json' },
          });
        }
        throw new Error(`Unerwarteter Abruf ${url}`);
      }),
    );

    const result = await discoverArticleMedia(
      {
        id: 'article-pexels',
        title: 'Solarstrom wächst deutlich',
        main_text: 'Der Anteil stieg binnen eines Jahres um 42 Prozent.',
      },
      {
        MEDIA_COMMONS_ENABLED: 'false',
        PEXELS_API_KEY: 'test-key',
        MEDIA_DISCOVERY_MAX_CANDIDATES: '30',
      },
    );

    expect(requested.some((url) => url.startsWith('https://api.pexels.com/v1/videos/search?'))).toBe(true);
    expect(requested.some((url) => url.includes('api.pexels.com/videos/search'))).toBe(false);
    expect(result.providers).toEqual(expect.arrayContaining([expect.objectContaining({ provider: 'pexels', status: 'ok' })]));
    expect(result.candidates).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          kind: 'video',
          provider: 'pexels',
          providerAssetId: '77',
          rightsStatus: 'approved',
          attribution: 'Video von Max Muster auf Pexels',
          licenseUrl: 'https://www.pexels.com/license/',
        }),
      ]),
    );
  });

  it('creates statistic candidates from numerical statements without an external provider', async () => {
    const result = await discoverArticleMedia(
      {
        id: 'article-statistic',
        title: 'Neue Statistik',
        main_text: 'Die Produktion stieg im Vergleich zum Vorjahr um 37,5 Prozent auf 1.250 Einheiten.',
      },
      { MEDIA_COMMONS_ENABLED: 'false', MEDIA_DISCOVERY_MAX_CANDIDATES: '30' },
    );

    const statistic = result.candidates.find((candidate) => candidate.kind === 'statistic');
    expect(statistic).toMatchObject({
      provider: 'article-source',
      rightsStatus: 'approved',
      status: 'candidate',
    });
    expect(String(statistic?.metadata?.statement)).toMatch(/37,5 Prozent|1\.250 Einheiten/);
  });
});
