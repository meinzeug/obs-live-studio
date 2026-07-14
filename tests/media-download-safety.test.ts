import { mkdtemp, readFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, describe, expect, it, vi } from 'vitest';
import sharp from 'sharp';
import { createStatisticGraphic, downloadRemoteImageSecure } from '../packages/media-engine/src/secure-download.js';

const temporaryDirectories: string[] = [];

afterEach(async () => {
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
  await Promise.all(temporaryDirectories.splice(0).map((directory) => rm(directory, { recursive: true, force: true })));
});

async function tempDirectory() {
  const directory = await mkdtemp(join(tmpdir(), 'open-tv-media-'));
  temporaryDirectories.push(directory);
  return directory;
}

describe('secure media downloads', () => {
  it('rechecks the provider allowlist before following redirects', async () => {
    const fetchMock = vi.fn(
      async () =>
        new Response(null, {
          status: 302,
          headers: { location: 'https://internal.example/private.png' },
        }),
    );
    vi.stubGlobal('fetch', fetchMock);

    await expect(
      downloadRemoteImageSecure({
        url: 'https://images.pexels.com/photo.jpg',
        allowedHosts: ['images.pexels.com'],
        directory: await tempDirectory(),
        filename: 'photo.jpg',
        timeoutMs: 500,
      }),
    ).rejects.toThrow(/Nicht freigegebener Medienhost/);
    expect(fetchMock).toHaveBeenCalledTimes(1);
  });

  it('keeps the timeout active while the response body is downloaded', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn(async (_input: string | URL, init?: RequestInit) => {
        const signal = init?.signal;
        const body = new ReadableStream<Uint8Array>({
          start(controller) {
            signal?.addEventListener('abort', () => controller.error(new Error('body aborted')), { once: true });
          },
        });
        return new Response(body, { status: 200, headers: { 'content-type': 'image/png' } });
      }),
    );

    await expect(
      downloadRemoteImageSecure({
        url: 'https://images.pexels.com/slow.png',
        allowedHosts: ['images.pexels.com'],
        directory: await tempDirectory(),
        filename: 'slow.png',
        timeoutMs: 20,
      }),
    ).rejects.toThrow(/abgebrochen|abort/i);
  });
});

describe('generated statistic graphics', () => {
  it('creates a local 16:9 graphic and image derivatives without remote content', async () => {
    const result = await createStatisticGraphic({
      statement: 'Die Produktion stieg um 37,5 Prozent auf 1.250 Einheiten.',
      title: 'Zahlen & Fakten',
      sourceLabel: 'Quelle: Statistisches Amt',
      directory: await tempDirectory(),
    });

    expect(result.mime).toBe('image/png');
    expect(result.width).toBe(1280);
    expect(result.height).toBe(720);
    expect(result.derivatives.map((derivative) => derivative.label)).toEqual(['thumb', 'preview']);
    const metadata = await sharp(await readFile(result.originalPath)).metadata();
    expect(metadata).toMatchObject({ width: 1280, height: 720, format: 'png' });
  });
});
