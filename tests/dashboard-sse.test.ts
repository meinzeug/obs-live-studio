import { readFile } from 'node:fs/promises';
import { describe, expect, it } from 'vitest';

describe('Master-Control-Dashboard', () => {
  it('delivers the complete dashboard over one authenticated SSE stream', async () => {
    const [api, provider] = await Promise.all([
      readFile('apps/api/src/index.ts', 'utf8'),
      readFile('apps/web/src/studio-status.tsx', 'utf8'),
    ]);
    expect(api).toContain("app.get('/api/dashboard/events'");
    expect(api).toContain("app.get('/api/dashboard/program-preview'");
    expect(api).toContain("send('studio-snapshot'");
    expect(api).toContain('liveEventBus.subscribe');
    expect(api).toContain('listOperationalNotifications');
    expect(api).toContain('editorialDeskStatus');
    expect(provider).toContain("new EventSource('/api/dashboard/events'");
    expect(provider).toContain("source.addEventListener('studio-snapshot'");
    expect(provider).not.toContain('window.setInterval');
  });

  it('presents one coherent control center instead of unrelated status widgets', async () => {
    const [page, widgets] = await Promise.all([
      readFile('apps/web/src/pages/DashboardPage.tsx', 'utf8'),
      readFile('apps/web/src/components/dashboard/StudioDashboardWidgets.tsx', 'utf8'),
    ]);
    expect(page).toContain('Open TV Studio · Master Control');
    expect(page).toContain('Programmfluss');
    expect(page).toContain('Störungscenter');
    expect(page).toContain('Live-Telemetrie');
    expect(page).toContain('Newsroom-Puls');
    expect(page).toContain('Aktuelles Programmbild aus OBS');
    expect(widgets).toContain('ControlMetric');
    expect(widgets).toContain('ResourceDial');
    expect(widgets).toContain('Sparkline');
  });
});
