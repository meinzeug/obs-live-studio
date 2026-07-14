import { createServer, type IncomingMessage, type ServerResponse } from 'node:http';
import { afterEach, describe, expect, it } from 'vitest';
import { fetchHttpText, isAllowedLocalStudioTestUrl } from '../packages/source-connectors/src/index.js';
import { parseFeed } from '../packages/news-parser/src/index.js';

let server: ReturnType<typeof createServer> | undefined;

function listen(handler: (req: IncomingMessage, res: ServerResponse) => void) {
  server = createServer(handler);
  return new Promise<string>((resolve) =>
    server!.listen(0, '127.0.0.1', () => {
      const addr = server!.address();
      if (typeof addr === 'object' && addr) resolve(`http://127.0.0.1:${addr.port}`);
    }),
  );
}

afterEach(async () => {
  if (!server) return;
  await new Promise<void>((resolve) => server!.close(() => resolve()));
  server = undefined;
});

describe('source fetching', () => {
  it('recognizes only exact local studio test URLs', () => {
    const options = { appPort: 12000, allowedPaths: ['/test-feed.xml'] };
    expect(isAllowedLocalStudioTestUrl('http://127.0.0.1:12000/test-feed.xml', options)).toBe(true);
    expect(isAllowedLocalStudioTestUrl('http://localhost:12000/test-feed.xml', options)).toBe(true);
    expect(isAllowedLocalStudioTestUrl('http://[::1]:12000/test-feed.xml', options)).toBe(true);
    expect(isAllowedLocalStudioTestUrl('http://127.0.0.1:12000/test-feed.xml?next=/api', options)).toBe(false);
    expect(isAllowedLocalStudioTestUrl('http://127.0.0.1:12000/api/sources', options)).toBe(false);
    expect(isAllowedLocalStudioTestUrl('https://127.0.0.1:12000/test-feed.xml', options)).toBe(false);
  });

  it('fetches a local test feed with validators when private sources are explicitly allowed', async () => {
    const base = await listen((_req, res) => {
      res.setHeader('content-type', 'application/rss+xml');
      res.setHeader('etag', '"v1"');
      res.end(
        '<rss><channel><item><title>Lokal</title><link>/a</link><description>Text</description></item></channel></rss>',
      );
    });
    const result = await fetchHttpText(base + '/feed.xml', {
      allowPrivate: true,
      maxBytes: 4096,
      timeoutMs: 1000,
    });
    expect(result.etag).toBe('"v1"');
    expect(parseFeed(result.body, result.url)[0].url).toBe(base + '/a');
  });

  it('rechecks the private URL allowlist after every redirect', async () => {
    const base = await listen((req, res) => {
      if (req.url === '/test-feed.xml') {
        res.statusCode = 302;
        res.setHeader('location', '/api/private');
        res.end();
        return;
      }
      res.end('internal data');
    });
    const appPort = new URL(base).port;

    await expect(
      fetchHttpText(`${base}/test-feed.xml`, {
        maxBytes: 4096,
        timeoutMs: 1000,
        allowPrivateUrl: (url) =>
          isAllowedLocalStudioTestUrl(url, {
            appPort,
            allowedPaths: ['/test-feed.xml'],
          }),
      }),
    ).rejects.toThrow(/SSRF-Schutz|nicht öffentlich/);
  });

  it('enforces response size limits', async () => {
    const base = await listen((_req, res) => res.end('x'.repeat(128)));
    await expect(fetchHttpText(base, { allowPrivate: true, maxBytes: 8, timeoutMs: 1000 })).rejects.toThrow(
      /Größenlimit|groß/,
    );
  });
});
