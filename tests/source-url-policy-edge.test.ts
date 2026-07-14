import Fastify from 'fastify';
import { describe, expect, it, vi } from 'vitest';
import {
  installSourceUrlValidationHook,
  testSourceUrl,
  type SourceUrlPolicy,
} from '../apps/api/src/source-url-policy.js';

function policy(): SourceUrlPolicy {
  return {
    allowPrivate: false,
    allowPrivateUrl: (url) => url.pathname === '/test-feed.xml',
    validateStoredSourceUrl: async () => undefined,
  };
}

describe('source safety edge cases', () => {
  it('returns HTTP 400 for empty create and test requests without running legacy handlers', async () => {
    const app = Fastify();
    const createHandler = vi.fn();
    const testHandler = vi.fn();
    installSourceUrlValidationHook(app, {
      policy: policy(),
      canValidate: () => true,
      createSource: async () => ({ id: 'unexpected' }),
      testSource: async () => {
        throw new Error('unexpected');
      },
    });
    app.post('/api/sources', async () => {
      createHandler();
      return { legacy: true };
    });
    app.post('/api/sources/test', async () => {
      testHandler();
      return { legacy: true };
    });

    const createResponse = await app.inject({ method: 'POST', url: '/api/sources' });
    const testResponse = await app.inject({ method: 'POST', url: '/api/sources/test' });

    expect(createResponse.statusCode).toBe(400);
    expect(testResponse.statusCode).toBe(400);
    expect(createHandler).not.toHaveBeenCalled();
    expect(testHandler).not.toHaveBeenCalled();
    await app.close();
  });

  it('does not let a synchronous telemetry failure break a successful source test', async () => {
    const result = await testSourceUrl(
      { url: 'https://example.org/feed.xml' },
      policy(),
      {
        fetchText: async () => ({
          url: 'https://example.org/feed.xml',
          contentType: 'text/html',
          body: '<html><head><title>Test</title></head><body><article>Inhalt</article></body></html>',
          status: 200,
          notModified: false,
        }),
        recordCheck: () => {
          throw new Error('telemetry unavailable');
        },
        now: () => 100,
      },
    );

    expect(result).toMatchObject({
      detected: 'website',
      status: 200,
      durationMs: 0,
    });
  });
});
