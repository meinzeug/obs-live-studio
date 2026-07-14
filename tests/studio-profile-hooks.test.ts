import Fastify from 'fastify';
import { afterEach, describe, expect, it } from 'vitest';
import { installStudioProfileHooks } from '../apps/api/src/studio-profile-hooks.js';

const originalEnvironment = { ...process.env };

afterEach(() => {
  for (const key of Object.keys(process.env)) {
    if (!(key in originalEnvironment)) delete process.env[key];
  }
  Object.assign(process.env, originalEnvironment);
});

function configureRumble() {
  Object.assign(process.env, {
    STUDIO_NAME: 'Nord TV Studio',
    CHANNEL_NAME: 'Nordkanal',
    CHANNEL_URL: 'https://rumble.com/c/nordkanal',
    STREAM_PLATFORM: 'rumble',
    STREAM_TARGET_NAME: 'Rumble',
    STREAM_SERVER: 'rtmps://rumble.example.invalid/live',
    STREAM_KEY: 'rumble_key_123456',
    STREAM_TARGETS_JSON: '[]',
    APP_PORT: '12000',
  });
}

describe('generic studio profile hooks', () => {
  it('serves a sanitized channel profile without stream keys', async () => {
    configureRumble();
    const app = Fastify();
    installStudioProfileHooks(app);
    app.get('/api/stream-profile', async () => ({ legacy: true }));

    const response = await app.inject({ method: 'GET', url: '/api/stream-profile' });
    const serialized = response.body;

    expect(response.statusCode).toBe(200);
    expect(response.json()).toMatchObject({
      studioName: 'Nord TV Studio',
      channelName: 'Nordkanal',
      primary: { platform: 'rumble', name: 'Rumble', configured: true },
    });
    expect(serialized).not.toContain('rumble_key_123456');
    expect(serialized).not.toContain('legacy');
    await app.close();
  });

  it('generates a channel-neutral local feed and article', async () => {
    configureRumble();
    const app = Fastify();
    installStudioProfileHooks(app);
    app.get('/test-feed.xml', async () => 'legacy feed');
    app.get('/test/articles/on-air', async () => 'legacy article');

    const feed = await app.inject({ method: 'GET', url: '/test-feed.xml' });
    const article = await app.inject({ method: 'GET', url: '/test/articles/on-air' });

    expect(feed.headers['content-type']).toContain('application/rss+xml');
    expect(feed.body).toContain('Nordkanal ist auf Sendung');
    expect(feed.body).not.toContain('ArgumentationsKette');
    expect(article.body).toContain('Das konfigurierte Hauptziel ist Rumble');
    expect(article.body).not.toContain('ArgumentationsKette');
    await app.close();
  });

  it('blocks the YouTube account action for a non-YouTube primary target', async () => {
    configureRumble();
    const app = Fastify();
    installStudioProfileHooks(app);
    app.post('/api/obs/youtube/reset', async () => ({ legacy: true }));

    const response = await app.inject({ method: 'POST', url: '/api/obs/youtube/reset' });

    expect(response.statusCode).toBe(409);
    expect(response.json().error).toContain('Rumble');
    expect(response.body).not.toContain('legacy');
    await app.close();
  });

  it('replaces the legacy OBS stream profile in status responses', async () => {
    configureRumble();
    const app = Fastify();
    installStudioProfileHooks(app);
    app.get('/api/obs/status', async () => ({ status: 'connected', streamProfile: { platform: 'youtube' } }));

    const response = await app.inject({ method: 'GET', url: '/api/obs/status' });

    expect(response.json()).toMatchObject({
      status: 'connected',
      streamProfile: { channelName: 'Nordkanal', primary: { platform: 'rumble' } },
    });
    await app.close();
  });
});
