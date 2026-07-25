import { readFile } from 'node:fs/promises';
import { describe, expect, it } from 'vitest';
import { isPublicReadPath } from '../apps/api/src/auth.js';

describe('öffentliche Senderwebsite', () => {
  it('exposes only the dedicated read-only channel endpoints without authentication', () => {
    expect(isPublicReadPath('GET', '/api/public/channel')).toBe(true);
    expect(isPublicReadPath('GET', '/api/public/channel/events')).toBe(true);
    expect(isPublicReadPath('POST', '/api/public/channel')).toBe(false);
    expect(isPublicReadPath('GET', '/api/dashboard')).toBe(false);
  });

  it('publishes only released articles and uses a separate SSE snapshot', async () => {
    const api = await readFile('apps/api/src/index.ts', 'utf8');
    expect(api).toContain("a.status='published'");
    expect(api).toContain("app.get('/api/public/channel'");
    expect(api).toContain("app.get('/api/public/channel/events'");
    expect(api).toContain('event: channel-snapshot');
    expect(api).not.toContain("app.get('/api/public/channel', async () => dashboardSnapshot");
  });

  it('keeps the public page outside the authenticated studio shell', async () => {
    const [app, page] = await Promise.all([
      readFile('apps/web/src/App.tsx', 'utf8'),
      readFile('apps/web/src/pages/PublicChannelPage.tsx', 'utf8'),
    ]);
    expect(app).toContain("window.location.pathname === '/public'");
    expect(app).toContain('return publicPath ? <PublicChannelPage /> : <StudioApp />');
    expect(page).toContain("new EventSource('/api/public/channel/events')");
    expect(page).toContain('Freiheit ist kein Zuschauerplatz.');
    expect(page).toContain('Originalquelle');
  });
});
