import { readdir, readFile } from 'node:fs/promises';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import {
  articleDetailRoute,
  articlesRoute,
  broadcastRoute,
  isKnownRoute,
  mediaDetailRoute,
  notificationTarget,
  overlayEditorRoute,
  routes,
  sourceHealthRoute,
} from '../apps/web/src/navigation.js';
import { isResourceId } from '../apps/web/src/resource-id.js';

async function sourceFiles(directory: string): Promise<string[]> {
  const entries = await readdir(directory, { withFileTypes: true });
  const files = await Promise.all(
    entries.map(async (entry) => {
      const path = join(directory, entry.name);
      if (entry.isDirectory()) return sourceFiles(path);
      return entry.isFile() && /\.(?:ts|tsx)$/.test(entry.name) ? [path] : [];
    }),
  );
  return files.flat();
}

describe('web navigation', () => {
  it('recognizes every registered route and supported detail route', () => {
    for (const path of Object.values(routes)) expect(isKnownRoute(path), path).toBe(true);
    expect(isKnownRoute(articleDetailRoute('article-1'))).toBe(true);
    expect(isKnownRoute(overlayEditorRoute('overlay-1'))).toBe(true);
    expect(isKnownRoute(mediaDetailRoute('media-1'))).toBe(true);
    expect(isKnownRoute('/missing-module')).toBe(false);
  });

  it('validates database resource identifiers before issuing detail requests', () => {
    expect(isResourceId('550e8400-e29b-41d4-a716-446655440000')).toBe(true);
    expect(isResourceId('article-1')).toBe(false);
    expect(isResourceId(undefined)).toBe(false);
  });

  it('keeps URL filters on valid module routes', () => {
    expect(articlesRoute({ status: 'new', warnings: true })).toBe('/articles?status=new&warnings=true');
    expect(sourceHealthRoute({ source: 'source-1', state: 'problem' })).toBe(
      '/source-health?source=source-1&state=problem',
    );
    expect(broadcastRoute('planned')).toBe('/broadcast?view=planned');
    expect(isKnownRoute(articlesRoute({ status: 'new' }))).toBe(true);
    expect(isKnownRoute(sourceHealthRoute({ state: 'problem' }))).toBe(true);
  });

  it('maps operational notifications to an existing module and source detail', () => {
    for (const component of [
      'source-ingest',
      'broadcast-runner',
      'youtube-shorts',
      'ai-tv-team',
      'obs-controller',
      'stream-supervisor',
      'unknown',
    ]) {
      expect(isKnownRoute(notificationTarget(component)), component).toBe(true);
    }
    expect(notificationTarget('source-ingest', { sourceId: 'source-1' })).toContain('source=source-1');
    expect(notificationTarget('youtube-shorts')).toBe(routes.youtubeShorts);
    expect(notificationTarget('ai-tv-team')).toBe(routes.aiStudio);
  });

  it('keeps direct module navigation independent from server-side history fallbacks', async () => {
    const app = await readFile('apps/web/src/App.tsx', 'utf8');
    expect(app).toContain('HashRouter');
    expect(app).toContain('<Route path="*" element={<NotFoundPage />} />');
  });

  it('exposes the unified settings page through the avatar menu', async () => {
    const [app, shell, settings] = await Promise.all([
      readFile('apps/web/src/App.tsx', 'utf8'),
      readFile('apps/web/src/components/Shell.tsx', 'utf8'),
      readFile('apps/web/src/pages/SettingsPage.tsx', 'utf8'),
    ]);
    expect(routes.settings).toBe('/settings');
    expect(app).toContain('<SettingsPage user={user} studio={studio} onStudioChange={setStudio} />');
    expect(shell).toContain('aria-label="Profilmenü öffnen"');
    expect(shell).toContain('to={routes.settings}');
    expect(settings).toContain('Konfiguration und Verwaltung');
  });

  it('exposes editable primary and parallel streaming targets on the OBS page', async () => {
    const [app, apiIndex, obsPage] = await Promise.all([
      readFile('apps/web/src/App.tsx', 'utf8'),
      readFile('apps/api/src/index.ts', 'utf8'),
      readFile('apps/web/src/pages/ObsPage.tsx', 'utf8'),
    ]);
    expect(app).toContain('onStudioChange={setStudio}');
    expect(apiIndex).toContain('function streamProfile()');
    expect(apiIndex).toContain("app.get('/api/stream-profile', async () => streamProfile())");
    expect(obsPage).toContain("'/api/stream-targets'");
    expect(obsPage).toContain('Streaming-Ziele konfigurieren');
    expect(obsPage).toContain('Benutzerdefiniertes RTMP-Ziel');
    expect(obsPage).toContain('Zusätzliches Ziel');
    expect(obsPage).toContain('setObsError');
    expect(obsPage).toContain('OBS-Status kann derzeit nicht aktualisiert werden');
  });

  it('guards article and overlay detail pages against deleted resources', async () => {
    const [app, articleRoute, overlayRoute] = await Promise.all([
      readFile('apps/web/src/App.tsx', 'utf8'),
      readFile('apps/web/src/pages/ArticleDetailRoutePage.tsx', 'utf8'),
      readFile('apps/web/src/pages/OverlayEditorRoutePage.tsx', 'utf8'),
    ]);
    expect(app).toContain('ArticleDetailRoutePage');
    expect(app).toContain('OverlayEditorRoutePage');
    expect(articleRoute).toContain("'missing'");
    expect(articleRoute).toContain('Nachricht nicht gefunden');
    expect(overlayRoute).toContain("'missing'");
    expect(overlayRoute).toContain('Overlay nicht gefunden');
  });

  it('binds overlay selection to the route parameter', async () => {
    const editor = await readFile('apps/web/src/pages/OverlayEditorPage.tsx', 'utf8');
    expect(editor).toContain('useParams');
    expect(editor).toContain('const { id: routeId } = useParams()');
    expect(editor).toContain('project.id === routeId');
  });

  it('uses hash navigation and current labels in the browser test', async () => {
    const e2e = await readFile('e2e/broadcast-real.spec.ts', 'utf8');
    expect(e2e).toContain("page.goto('/#/broadcast')");
    expect(e2e).toContain("name: 'Administrator einrichten'");
    expect(e2e).toContain("name: 'Willkommen zurück'");
    expect(e2e).toContain("name: 'Starten'");
    expect(e2e).toContain("name: 'Stoppen'");
  });

  it('installs a non-network image fallback for failed previews', async () => {
    const [fallback, main] = await Promise.all([
      readFile('apps/web/src/image-fallback.ts', 'utf8'),
      readFile('apps/web/src/main.tsx', 'utf8'),
    ]);
    expect(fallback).toContain('data:image/svg+xml');
    expect(fallback).toContain("document.addEventListener(\n    'error'");
    expect(main).toContain('installImageFallback();');
  });

  it('keeps media and overlay loading failures local and ignores stale responses', async () => {
    const [media, overlays] = await Promise.all([
      readFile('apps/web/src/pages/MediaPage.tsx', 'utf8'),
      readFile('apps/web/src/pages/OverlaysPage.tsx', 'utf8'),
    ]);
    for (const source of [media, overlays]) {
      expect(source).toContain('loadRevision');
      expect(source).toContain('revision !== loadRevision.current');
      expect(source).toContain('status-message status-error');
    }
  });

  it('does not contain hard-coded links to unknown internal routes', async () => {
    const files = await sourceFiles('apps/web/src');
    const failures: string[] = [];

    for (const file of files) {
      const source = await readFile(file, 'utf8');
      for (const match of source.matchAll(/\bto=["'](\/[^"']*)["']/g)) {
        const target = match[1].split(/[?#]/, 1)[0];
        if (!isKnownRoute(target)) failures.push(`${file}: ${target}`);
      }
    }

    expect(failures).toEqual([]);
  });
});
