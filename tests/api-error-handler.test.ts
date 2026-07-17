import Fastify from 'fastify';
import { describe, expect, it } from 'vitest';
import { z } from 'zod';
import { apiError, installApiErrorHandler } from '../apps/api/src/error-handler.js';

describe('API error handler', () => {
  it('creates typed operational errors without a custom error class', () => {
    expect(apiError(404, 'Nicht gefunden')).toMatchObject({ message: 'Nicht gefunden', statusCode: 404 });
  });
  it('maps invalid Zod input to HTTP 400 with structured issues', async () => {
    const app = Fastify();
    installApiErrorHandler(app);
    app.post('/settings', async (request) =>
      z.object({ minimumTrust: z.number().int().min(0).max(100) }).parse(request.body),
    );

    const response = await app.inject({ method: 'POST', url: '/settings', payload: { minimumTrust: 101 } });

    expect(response.statusCode).toBe(400);
    expect(response.json()).toMatchObject({
      error: 'Ungültige Anfrage',
      issues: [expect.objectContaining({ path: ['minimumTrust'] })],
    });
    await app.close();
  });

  it('preserves an HTTP status selected by a route', async () => {
    const app = Fastify();
    installApiErrorHandler(app);
    app.get('/conflict', async (_request, reply) => {
      reply.code(409);
      throw new Error('Konflikt');
    });

    const response = await app.inject({ method: 'GET', url: '/conflict' });

    expect(response.statusCode).toBe(409);
    expect(response.json()).toEqual({ error: 'Konflikt' });
    await app.close();
  });

  it('keeps explicit status codes attached to operational errors', async () => {
    const app = Fastify();
    installApiErrorHandler(app);
    app.get('/missing', async () => {
      throw Object.assign(new Error('Nicht gefunden'), { statusCode: 404 });
    });

    const response = await app.inject({ method: 'GET', url: '/missing' });

    expect(response.statusCode).toBe(404);
    expect(response.json()).toEqual({ error: 'Nicht gefunden' });
    await app.close();
  });
});
