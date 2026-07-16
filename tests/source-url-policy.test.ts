import Fastify from 'fastify';
import { describe, expect, it, vi } from 'vitest';
import {
  createSourceUrlPolicy,
  installSourceUrlValidationHook,
  SourceTestValidationError,
  testSourceUrl,
  type SourceTestResult,
  type SourceUrlPolicy,
} from '../apps/api/src/source-url-policy.js';

function policy(
  validateStoredSourceUrl: SourceUrlPolicy['validateStoredSourceUrl'] = vi.fn(async () => undefined),
): SourceUrlPolicy {
  return {
    allowPrivate: false,
    allowPrivateUrl: (url) => url.pathname === '/test-feed.xml',
    validateStoredSourceUrl,
  };
}

function testResult(overrides: Partial<SourceTestResult> = {}): SourceTestResult {
  return {
    detected: 'feed',
    status: 200,
    finalUrl: 'https://example.org/feed.xml',
    preview: [],
    paywallSuspected: false,
    javascriptLikely: false,
    durationMs: 25,
    ...overrides,
  };
}

describe('source URL policy', () => {
  it('allows only the exact built-in local test feed when private sources are disabled', async () => {
    const calls: Array<{ rawUrl: string; allowPrivate: boolean | undefined }> = [];
    const sourcePolicy = createSourceUrlPolicy(
      { APP_PORT: '12000', ALLOW_PRIVATE_SOURCES: 'false' },
      async (rawUrl, allowPrivate) => {
        calls.push({ rawUrl, allowPrivate });
      },
    );

    await sourcePolicy.validateStoredSourceUrl('http://127.0.0.1:12000/test-feed.xml');
    await sourcePolicy.validateStoredSourceUrl('http://127.0.0.1:12000/api/sources');
    await sourcePolicy.validateStoredSourceUrl('https://example.org/feed.xml');

    expect(calls).toEqual([
      { rawUrl: 'http://127.0.0.1:12000/test-feed.xml', allowPrivate: true },
      { rawUrl: 'http://127.0.0.1:12000/api/sources', allowPrivate: false },
      { rawUrl: 'https://example.org/feed.xml', allowPrivate: false },
    ]);
  });

  it('creates sources with the shared schema and prevents the legacy route from running', async () => {
    const app = Fastify();
    const legacyHandler = vi.fn();
    const validateStoredSourceUrl = vi.fn(async () => undefined);
    const createSource = vi.fn(async (input) => ({ id: 'source-id', ...input }));
    installSourceUrlValidationHook(app, {
      policy: policy(validateStoredSourceUrl),
      canValidate: () => true,
      createSource,
    });
    app.post('/api/sources', async () => {
      legacyHandler();
      return { legacy: true };
    });

    const response = await app.inject({
      method: 'POST',
      url: '/api/sources',
      payload: { name: 'Neue Quelle', url: 'https://example.org/feed.xml' },
    });

    expect(response.statusCode).toBe(200);
    expect(response.json()).toMatchObject({
      id: 'source-id',
      name: 'Neue Quelle',
      url: 'https://example.org/feed.xml',
      type: 'rss',
      language: 'de',
      trustLevel: 50,
      fetchIntervalSeconds: 900,
      maxArticles: 20,
      maxFetchSeconds: 20,
      active: true,
    });
    expect(validateStoredSourceUrl).toHaveBeenCalledWith('https://example.org/feed.xml');
    expect(createSource).toHaveBeenCalledWith(
      expect.objectContaining({
        name: 'Neue Quelle',
        url: 'https://example.org/feed.xml',
        type: 'rss',
      }),
    );
    expect(legacyHandler).not.toHaveBeenCalled();
    await app.close();
  });

  it('validates changed source URLs without altering unrelated update fields', async () => {
    const app = Fastify();
    const validateStoredSourceUrl = vi.fn(async () => undefined);
    installSourceUrlValidationHook(app, {
      policy: policy(validateStoredSourceUrl),
      canValidate: () => true,
    });
    app.put('/api/sources/:id', async (req) => req.body);

    const response = await app.inject({
      method: 'PUT',
      url: '/api/sources/source-id',
      payload: { name: 'Neue Bezeichnung', url: 'https://example.org/new-feed.xml' },
    });

    expect(response.statusCode).toBe(200);
    expect(validateStoredSourceUrl).toHaveBeenCalledWith('https://example.org/new-feed.xml');
    expect(response.json()).toEqual({
      name: 'Neue Bezeichnung',
      url: 'https://example.org/new-feed.xml',
    });
    await app.close();
  });

  it('marks an explicit user-agent removal for atomic database normalization', async () => {
    const app = Fastify();
    const validateStoredSourceUrl = vi.fn(async () => undefined);
    installSourceUrlValidationHook(app, {
      policy: policy(validateStoredSourceUrl),
      canValidate: () => true,
    });
    app.put('/api/sources/:id', async (req) => req.body);

    const response = await app.inject({
      method: 'PUT',
      url: '/api/sources/source-id',
      payload: { name: 'Ohne User-Agent', userAgent: null },
    });

    expect(response.statusCode).toBe(200);
    expect(response.json()).toEqual({ name: 'Ohne User-Agent', userAgent: '' });
    expect(validateStoredSourceUrl).not.toHaveBeenCalled();
    await app.close();
  });

  it('skips DNS validation for callers without source write permission', async () => {
    const app = Fastify();
    const validateStoredSourceUrl = vi.fn(async () => undefined);
    installSourceUrlValidationHook(app, {
      policy: policy(validateStoredSourceUrl),
      canValidate: () => false,
    });
    app.put('/api/sources/:id', async () => ({ ok: true }));

    const response = await app.inject({
      method: 'PUT',
      url: '/api/sources/source-id',
      payload: { url: 'http://127.0.0.1:8080/internal' },
    });

    expect(response.statusCode).toBe(200);
    expect(validateStoredSourceUrl).not.toHaveBeenCalled();
    await app.close();
  });

  it('stops source creation and updates before persistence when validation fails', async () => {
    const app = Fastify();
    const legacyHandler = vi.fn();
    const createSource = vi.fn(async () => ({ id: 'source-id' }));
    installSourceUrlValidationHook(app, {
      policy: policy(async () => {
        throw new Error('SSRF-Schutz: private Quelle blockiert');
      }),
      canValidate: () => true,
      createSource,
    });
    app.post('/api/sources', async () => {
      legacyHandler();
      return { ok: true };
    });
    app.put('/api/sources/:id', async () => {
      legacyHandler();
      return { ok: true };
    });

    const created = await app.inject({
      method: 'POST',
      url: '/api/sources',
      payload: { name: 'Intern', url: 'http://127.0.0.1:8080/internal' },
    });
    const updated = await app.inject({
      method: 'PUT',
      url: '/api/sources/source-id',
      payload: { url: 'http://127.0.0.1:8080/internal' },
    });

    expect(created.statusCode).toBe(400);
    expect(updated.statusCode).toBe(400);
    expect(createSource).not.toHaveBeenCalled();
    expect(legacyHandler).not.toHaveBeenCalled();
    await app.close();
  });

  it('rejects malformed source creation before persistence', async () => {
    const app = Fastify();
    const createSource = vi.fn(async () => ({ id: 'source-id' }));
    installSourceUrlValidationHook(app, {
      policy: policy(),
      canValidate: () => true,
      createSource,
    });
    app.post('/api/sources', async () => ({ legacy: true }));

    const response = await app.inject({
      method: 'POST',
      url: '/api/sources',
      payload: { name: '', url: 'not-a-url', maxFetchSeconds: 0 },
    });

    expect(response.statusCode).toBe(400);
    expect(response.json().error).toBe('Ungültige Angaben für die Quelle');
    expect(createSource).not.toHaveBeenCalled();
    await app.close();
  });

  it('executes manual source tests securely and prevents the legacy route from running', async () => {
    const app = Fastify();
    const handler = vi.fn();
    const testSource = vi.fn(async () => testResult({ durationMs: 42 }));
    installSourceUrlValidationHook(app, {
      policy: policy(),
      canValidate: () => true,
      testSource,
    });
    app.post('/api/sources/test', async () => {
      handler();
      return { legacy: true };
    });

    const response = await app.inject({
      method: 'POST',
      url: '/api/sources/test',
      payload: { url: 'https://example.org/feed.xml', maxFetchSeconds: '12' },
    });

    expect(response.statusCode).toBe(200);
    expect(response.json()).toMatchObject({ status: 200, durationMs: 42 });
    expect(testSource).toHaveBeenCalledWith({
      url: 'https://example.org/feed.xml',
      maxFetchSeconds: 12,
    });
    expect(handler).not.toHaveBeenCalled();
    await app.close();
  });

  it('rejects invalid source test timeouts before any fetch or legacy handler', async () => {
    const app = Fastify();
    const handler = vi.fn();
    const testSource = vi.fn(async () => testResult());
    installSourceUrlValidationHook(app, {
      policy: policy(),
      canValidate: () => true,
      testSource,
    });
    app.post('/api/sources/test', async () => {
      handler();
      return { legacy: true };
    });

    const tooShort = await app.inject({
      method: 'POST',
      url: '/api/sources/test',
      payload: { url: 'https://example.org/feed.xml', maxFetchSeconds: 0 },
    });
    const tooLong = await app.inject({
      method: 'POST',
      url: '/api/sources/test',
      payload: { url: 'https://example.org/feed.xml', maxFetchSeconds: 61 },
    });

    expect(tooShort.statusCode).toBe(400);
    expect(tooLong.statusCode).toBe(400);
    expect(testSource).not.toHaveBeenCalled();
    expect(handler).not.toHaveBeenCalled();
    await app.close();
  });

  it('maps source test validation, timeout and upstream failures to useful status codes', async () => {
    const cases: Array<{ error: Error; status: number }> = [
      { error: new SourceTestValidationError('SSRF-Schutz'), status: 400 },
      { error: new Error('Timeout nach 1000 ms'), status: 504 },
      { error: new Error('HTTP 503'), status: 502 },
    ];

    for (const testCase of cases) {
      const app = Fastify();
      installSourceUrlValidationHook(app, {
        policy: policy(),
        canValidate: () => true,
        testSource: async () => {
          throw testCase.error;
        },
      });
      app.post('/api/sources/test', async () => ({ legacy: true }));

      const response = await app.inject({
        method: 'POST',
        url: '/api/sources/test',
        payload: { url: 'https://example.org/feed.xml' },
      });

      expect(response.statusCode).toBe(testCase.status);
      await app.close();
    }
  });
});

describe('manual source testing', () => {
  it('uses per-hop private URL policy, returns duration and records a redacted success', async () => {
    const allowPrivateUrl = vi.fn((url: URL) => url.pathname === '/test-feed.xml');
    const validateStoredSourceUrl = vi.fn(async () => undefined);
    const fetchText = vi.fn(async () => ({
      url: 'https://example.org/feed.xml?token=redirect-secret',
      contentType: 'application/rss+xml',
      body: '<rss><channel><item><title>Test</title><link>https://example.org/article</link></item></channel></rss>',
      status: 200,
      notModified: false,
      etag: '"v1"',
      lastModified: 'Tue, 14 Jul 2026 12:00:00 GMT',
    }));
    const recordCheck = vi.fn(async () => undefined);
    const times = [100, 145];

    const result = await testSourceUrl(
      { url: 'https://example.org/feed.xml?token=request-secret', maxFetchSeconds: 5 },
      { allowPrivate: false, allowPrivateUrl, validateStoredSourceUrl },
      {
        fetchText,
        recordCheck,
        now: () => times.shift() ?? 145,
        userAgent: 'Studio-Test/1.0',
      },
    );

    expect(validateStoredSourceUrl).toHaveBeenCalledWith('https://example.org/feed.xml?token=request-secret');
    expect(fetchText).toHaveBeenCalledWith(
      'https://example.org/feed.xml?token=request-secret',
      expect.objectContaining({
        timeoutMs: 5000,
        maxBytes: 512 * 1024,
        allowPrivate: false,
        allowPrivateUrl,
        userAgent: 'Studio-Test/1.0',
      }),
    );
    expect(result).toMatchObject({
      detected: 'feed',
      status: 200,
      durationMs: 45,
      etag: '"v1"',
    });
    expect(recordCheck).toHaveBeenCalledWith(
      null,
      'ok',
      expect.objectContaining({
        url: 'https://example.org/feed.xml?token=[redacted]',
        finalUrl: 'https://example.org/feed.xml?token=[redacted]',
        durationMs: 45,
        manual: true,
      }),
    );
  });

  it('records redacted failures without letting telemetry errors hide the fetch error', async () => {
    const recordCheck = vi.fn(async () => {
      throw new Error('database unavailable');
    });

    await expect(
      testSourceUrl({ url: 'https://example.org/feed.xml?api_key=request-secret' }, policy(), {
        fetchText: async () => {
          throw new Error('HTTP 503 for https://example.org/feed.xml?api_key=upstream-secret');
        },
        recordCheck,
        now: () => 100,
      }),
    ).rejects.toThrow('api_key=[redacted]');

    expect(recordCheck).toHaveBeenCalledWith(
      null,
      'error',
      expect.objectContaining({
        url: 'https://example.org/feed.xml?api_key=[redacted]',
        error: expect.stringContaining('api_key=[redacted]'),
        manual: true,
      }),
    );
  });
});
