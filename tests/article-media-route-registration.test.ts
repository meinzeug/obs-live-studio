import Fastify from 'fastify';
import { readFile } from 'node:fs/promises';
import { describe, expect, it } from 'vitest';
import { installArticleMediaRoutes } from '../apps/api/src/article-media-routes.js';

describe('article media route registration', () => {
  it('registers the manual media discovery endpoint', async () => {
    const app = Fastify();
    installArticleMediaRoutes(app);
    await app.ready();

    expect(
      app.hasRoute({
        method: 'POST',
        url: '/api/articles/:id/media/discover',
      }),
    ).toBe(true);

    await app.close();
  });

  it('queues visual discovery after rule-based and AI preparation', async () => {
    const source = await readFile('apps/api/src/article-media-routes.ts', 'utf8');
    expect(source).toContain('(?:process|ai)');
    expect(source).toContain('queueArticleMediaDiscovery(processed[1])');
  });
});
