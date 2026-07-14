import Fastify from 'fastify';
import cors from '@fastify/cors';
import { describe, expect, it } from 'vitest';
import { createApiOriginPolicy, installApiCorsGuard } from '../apps/api/src/cors-policy.js';

describe('API origin policy', () => {
  it('normalizes configured origins and keeps production defaults narrow', () => {
    const policy = createApiOriginPolicy({
      NODE_ENV: 'production',
      APP_PORT: '12000',
      APP_URL: 'http://127.0.0.1:12000/app',
      PUBLIC_APP_URL: 'https://studio.example.org/path',
      CORS_ALLOWED_ORIGINS: ' https://control.example.org/path ,invalid,ftp://files.example.org ',
    });

    expect(policy.allowedOrigins).toEqual(
      new Set([
        'http://127.0.0.1:12000',
        'https://studio.example.org',
        'https://control.example.org',
        'http://localhost:12000',
        'http://[::1]:12000',
      ]),
    );
    expect(policy.allows('https://studio.example.org')).toBe(true);
    expect(policy.allows('https://studio.example.org.evil.test')).toBe(false);
    expect(policy.allows('null')).toBe(false);
    expect(policy.allows(undefined)).toBe(false);
  });

  it('allows Vite loopback origins only outside production', () => {
    expect(createApiOriginPolicy({ NODE_ENV: 'development' }).allows('http://localhost:5173')).toBe(true);
    expect(createApiOriginPolicy({ NODE_ENV: 'production' }).allows('http://localhost:5173')).toBe(false);
  });

  it('strips credentialed CORS headers from disallowed API responses and preflights', async () => {
    const app = Fastify();
    await app.register(cors, { origin: true, credentials: true });
    installApiCorsGuard(
      app,
      createApiOriginPolicy({
        NODE_ENV: 'production',
        APP_URL: 'http://127.0.0.1:12000',
        PUBLIC_APP_URL: 'https://studio.example.org',
      }),
    );
    app.get('/api/private', async () => ({ ok: true }));
    app.get('/overlay/live', async () => ({ ok: true }));

    const allowed = await app.inject({
      method: 'GET',
      url: '/api/private',
      headers: { origin: 'https://studio.example.org' },
    });
    expect(allowed.headers['access-control-allow-origin']).toBe('https://studio.example.org');
    expect(allowed.headers['access-control-allow-credentials']).toBe('true');

    const blocked = await app.inject({
      method: 'GET',
      url: '/api/private',
      headers: { origin: 'https://evil.example' },
    });
    expect(blocked.statusCode).toBe(200);
    expect(blocked.headers['access-control-allow-origin']).toBeUndefined();
    expect(blocked.headers['access-control-allow-credentials']).toBeUndefined();

    const blockedPreflight = await app.inject({
      method: 'OPTIONS',
      url: '/api/private',
      headers: {
        origin: 'https://evil.example',
        'access-control-request-method': 'GET',
      },
    });
    expect(blockedPreflight.headers['access-control-allow-origin']).toBeUndefined();
    expect(blockedPreflight.headers['access-control-allow-credentials']).toBeUndefined();

    const publicOverlay = await app.inject({
      method: 'GET',
      url: '/overlay/live',
      headers: { origin: 'https://evil.example' },
    });
    expect(publicOverlay.headers['access-control-allow-origin']).toBe('https://evil.example');

    await app.close();
  });
});
