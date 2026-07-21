import Fastify from 'fastify';
import { describe, expect, it } from 'vitest';
import { installApiErrorHandler } from '../apps/api/src/error-handler.js';
import { installUuidRouteParamValidation } from '../apps/api/src/route-params.js';

describe('UUID route parameters', () => {
  function appWithRoute(path: string) {
    const app = Fastify();
    installApiErrorHandler(app);
    installUuidRouteParamValidation(app);
    app.get(path, async (req) => req.params);
    return app;
  }

  it.each(['/api/articles/not-a-uuid', '/api/overlays/---', '/api/media/123'])(
    'returns HTTP 400 for an invalid resource id in %s',
    async (url) => {
      const route = url.replace(/\/[^/]+$/, '/:id');
      const app = appWithRoute(route);
      const response = await app.inject({ method: 'GET', url });

      expect(response.statusCode).toBe(400);
      expect(response.json()).toMatchObject({ error: 'Ungültige Anfrage' });
      await app.close();
    },
  );

  it('validates nested UUID parameters while leaving labels untouched', async () => {
    const app = appWithRoute('/api/playlists/:id/items/:itemId/:label');
    const response = await app.inject({
      method: 'GET',
      url: '/api/playlists/11111111-1111-4111-8111-111111111111/items/invalid/thumb',
    });

    expect(response.statusCode).toBe(400);
    await app.close();
  });

  it('accepts valid UUIDs', async () => {
    const app = appWithRoute('/api/articles/:id');
    const response = await app.inject({
      method: 'GET',
      url: '/api/articles/11111111-1111-4111-8111-111111111111',
    });

    expect(response.statusCode).toBe(200);
    await app.close();
  });

  it('leaves stable external source identifiers to their route-specific validator', async () => {
    const app = appWithRoute('/api/live/sources/:sourceId');
    const response = await app.inject({ method: 'GET', url: '/api/live/sources/youtube%3AabcDEF_1234' });

    expect(response.statusCode).toBe(200);
    expect(response.json()).toEqual({ sourceId: 'youtube:abcDEF_1234' });
    await app.close();
  });

  it('leaves stable AI staff member identifiers to their route-specific validator', async () => {
    const app = appWithRoute('/api/ai-team/members/:memberId');
    const response = await app.inject({ method: 'GET', url: '/api/ai-team/members/chat-analyst' });

    expect(response.statusCode).toBe(200);
    expect(response.json()).toEqual({ memberId: 'chat-analyst' });
    await app.close();
  });
});
