import { describe, expect, it } from 'vitest';
import {
  buildStudioSourceIndex,
  routesForSourceFile,
  searchStudioSourceDocuments,
  type StudioSourceDocument,
} from '../apps/api/src/studio-source-search.js';

describe('global Studio source search', () => {
  it('maps source modules to the WebUI workspace where the function can be used', () => {
    expect(routesForSourceFile('apps/web/src/pages/YoutubeShortsPage.tsx')).toEqual(['/youtube-shorts']);
    expect(routesForSourceFile('apps/web/src/components/ShortsPremiumSettings.tsx')).toEqual([
      '/youtube-shorts',
      '/tiktok-shorts',
    ]);
    expect(routesForSourceFile('apps/api/src/multistream-preflight.ts')).toEqual(['/obs']);
    expect(routesForSourceFile('packages/ai-provider/src/index.ts')).toEqual(['/ai-studio']);
  });

  it('returns route aggregates rather than leaking source text', () => {
    const documents: StudioSourceDocument[] = [
      {
        routes: ['/obs'],
        searchable: 'obs multiple rtmp outputs plugin installieren und streaming ziele synchronisieren',
        sourceKind: 'Backend',
        weight: 5,
      },
      {
        routes: ['/system'],
        searchable: 'allgemeine obs diagnose und system wartung',
        sourceKind: 'Dokumentation',
        weight: 3,
      },
    ];
    const [result] = searchStudioSourceDocuments(documents, 'Multiple RTMP Outputs');
    expect(result).toMatchObject({ to: '/obs', label: 'Stream & OBS', sourceKinds: ['Backend'] });
    expect(result).not.toHaveProperty('searchable');
    expect(result).not.toHaveProperty('source');
  });

  it('indexes tracked and new repository source so any UI term can locate its page', async () => {
    const index = await buildStudioSourceIndex();
    expect(index.indexedFiles).toBeGreaterThan(300);
    const momentRoutes = searchStudioSourceDocuments(index.documents, 'Aktuellen Moment erstellen', 10).map(
      (entry) => entry.to,
    );
    expect(momentRoutes).toEqual(expect.arrayContaining(['/youtube-shorts', '/tiktok-shorts']));
    const premiumRoutes = searchStudioSourceDocuments(index.documents, 'ElevenLabs', 10).map((entry) => entry.to);
    expect(premiumRoutes).toEqual(expect.arrayContaining(['/youtube-shorts', '/tiktok-shorts']));
  });
});
