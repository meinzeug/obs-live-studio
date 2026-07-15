import { afterEach, describe, expect, it, vi } from 'vitest';
import { ApiError, api, setCsrf } from '../apps/web/src/api/client.js';

afterEach(() => {
  vi.unstubAllGlobals();
  setCsrf(null);
});

describe('web API client', () => {
  it('preserves plain-text server errors instead of throwing a JSON parse error', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn().mockResolvedValue(
        new Response('Bad Gateway', {
          status: 502,
          headers: { 'content-type': 'text/html; charset=utf-8' },
        }),
      ),
    );

    await expect(api('/api/test')).rejects.toMatchObject({
      name: 'ApiError',
      message: 'Bad Gateway',
      status: 502,
      path: '/api/test',
    });
  });

  it('uses structured API error messages and exposes the HTTP status', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn().mockResolvedValue(
        new Response(JSON.stringify({ error: 'Artikel nicht gefunden' }), {
          status: 404,
          headers: { 'content-type': 'application/json' },
        }),
      ),
    );

    const request = api('/api/articles/missing');
    await expect(request).rejects.toBeInstanceOf(ApiError);
    await expect(request).rejects.toMatchObject({ message: 'Artikel nicht gefunden', status: 404 });
  });

  it('returns successful non-JSON responses without parsing failures', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn().mockResolvedValue(
        new Response('bereit', {
          status: 200,
          headers: { 'content-type': 'text/plain' },
        }),
      ),
    );

    await expect(api<string>('/health-text')).resolves.toBe('bereit');
  });

  it('reports an unreachable studio server with a stable error', async () => {
    vi.stubGlobal('fetch', vi.fn().mockRejectedValue(new TypeError('network failed')));

    await expect(api('/api/dashboard')).rejects.toMatchObject({
      message: 'Der Studio-Server ist nicht erreichbar.',
      status: 0,
    });
  });
});
