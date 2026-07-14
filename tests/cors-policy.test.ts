import Fastify from 'fastify';
import cors from '@fastify/cors';
import { describe, expect, it, vi } from 'vitest';
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
    expect(policy.allows('https://user:password@studio.example.org')).toBe(false);
    expect(policy.allows('null')).toBe(false);
    expect(policy.allows(undefined)).toBe(false);
  });

  it('allows Vite loopback origins only outside production', () => {
    expect(createApiOriginPolicy({ NODE_ENV: 'development' }).allows('http://localhost:5173')).toBe(true);
    expect(createApiOriginPolicy({ NODE_ENV: 'production' }).allows('http://localhost:5173')).toBe(false);
  });

  it('rejects disallowed API origins before route execution', async () => {
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
    const privateHandler = vi.fn(async () => ({ ok: true }));
    app.get('/api/private', privateHandler);
    app.get('/overlay/live', async () => ({ ok: true }));

    const allowed = await app.inject({
      method: 'GET',
      url: '/api/private',
      headers: { origin: 'https://studio.example.org' },
    });
    expect(allowed.headers['access-control-allow-origin']).toBe('https://studio.example.org');
    expect(allowed.headers['access-control-allow-credentials']).toBe('true');
    expect(privateHandler).toHaveBeenCalledTimes(1);

    const blocked = await app.inject({
      method: 'GET',
      url: '/api/private',
      headers: { origin: 'https://evil.example' },
    });
    expect(blocked.statusCode).toBe(403);
    expect(blocked.json().error).toContain('Origin');
    expect(blocked.headers['access-control-allow-origin']).toBeUndefined();
    expect(blocked.headers['access-control-allow-credentials']).toBeUndefined();
    expect(privateHandler).toHaveBeenCalledTimes(1);

    const combined = await app.inject({
      method: 'GET',
      url: '/api/private',
      headers: { origin: 'https://studio.example.org, https://evil.example' },
    });
    expect(combined.statusCode).toBe(403);
    expect(combined.headers['access-control-allow-origin']).toBeUndefined();
    expect(privateHandler).toHaveBeenCalledTimes(1);

    const publicOverlay = await app.inject({
      method: 'GET',
      url: '/overlay/live',
      headers: { origin: 'https://evil.example' },
    });
    expect(publicOverlay.headers['access-control-allow-origin']).toBe('https://evil.example');

    await app.close();
  });
});
