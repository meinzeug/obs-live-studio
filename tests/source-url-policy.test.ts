import Fastify from 'fastify';
import { describe, expect, it, vi } from 'vitest';
import {
  createSourceUrlPolicy,
  installSourceUrlValidationHook,
  type SourceUrlPolicy,
} from '../apps/api/src/source-url-policy.js';

describe('source URL policy', () => {
  it('allows only the exact built-in local test feed when private sources are disabled', async () => {
    const calls: Array<{ rawUrl: string; allowPrivate: boolean | undefined }> = [];
    const policy = createSourceUrlPolicy(
      { APP_PORT: '12000', ALLOW_PRIVATE_SOURCES: 'false' },
      async (rawUrl, allowPrivate) => {
        calls.push({ rawUrl, allowPrivate });
      },
    );

    await policy.validateStoredSourceUrl('http://127.0.0.1:12000/test-feed.xml');
    await policy.validateStoredSourceUrl('http://127.0.0.1:12000/api/sources');
    await policy.validateStoredSourceUrl('https://example.org/feed.xml');

    expect(calls).toEqual([
      { rawUrl: 'http://127.0.0.1:12000/test-feed.xml', allowPrivate: true },
      { rawUrl: 'http://127.0.0.1:12000/api/sources', allowPrivate: false },
      { rawUrl: 'https://example.org/feed.xml', allowPrivate: false },
    ]);
  });

  it('validates changed URLs and preserves a stored user agent on partial updates', async () => {
    const app = Fastify();
    const validateStoredSourceUrl = vi.fn(async () => undefined);
    const policy: SourceUrlPolicy = { allowPrivate: false, validateStoredSourceUrl };
    installSourceUrlValidationHook(app, {
      policy,
      loadSource: async () => ({ user_agent: 'ArgumentationsKette-Crawler/2.0' }),
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
      userAgent: 'ArgumentationsKette-Crawler/2.0',
    });
    await app.close();
  });

  it('keeps an explicit user-agent removal and skips URL validation when the URL is unchanged', async () => {
    const app = Fastify();
    const validateStoredSourceUrl = vi.fn(async () => undefined);
    const loadSource = vi.fn(async () => ({ user_agent: 'existing' }));
    installSourceUrlValidationHook(app, {
      policy: { allowPrivate: false, validateStoredSourceUrl },
      loadSource,
    });
    app.put('/api/sources/:id', async (req) => req.body);

    const response = await app.inject({
      method: 'PUT',
      url: '/api/sources/source-id',
      payload: { name: 'Ohne User-Agent', userAgent: null },
    });

    expect(response.statusCode).toBe(200);
    expect(response.json()).toEqual({ name: 'Ohne User-Agent', userAgent: null });
    expect(validateStoredSourceUrl).not.toHaveBeenCalled();
    expect(loadSource).not.toHaveBeenCalled();
    await app.close();
  });

  it('stops a source update before the route handler when URL validation fails', async () => {
    const app = Fastify();
    const handler = vi.fn(async () => ({ ok: true }));
    installSourceUrlValidationHook(app, {
      policy: {
        allowPrivate: false,
        validateStoredSourceUrl: async () => {
          throw new Error('SSRF-Schutz: private Quelle blockiert');
        },
      },
      loadSource: async () => ({ user_agent: null }),
    });
    app.put('/api/sources/:id', handler);

    const response = await app.inject({
      method: 'PUT',
      url: '/api/sources/source-id',
      payload: { url: 'http://127.0.0.1:8080/internal' },
    });

    expect(response.statusCode).toBe(500);
    expect(response.json().message).toContain('SSRF-Schutz');
    expect(handler).not.toHaveBeenCalled();
    await app.close();
  });
});
