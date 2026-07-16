import { readFile } from 'node:fs/promises';
import { describe, expect, it } from 'vitest';

function routeBody(source: string, start: string, end: string) {
  const from = source.indexOf(start);
  const to = source.indexOf(end, from + start.length);
  expect(from).toBeGreaterThanOrEqual(0);
  expect(to).toBeGreaterThan(from);
  return source.slice(from, to);
}

describe('overlay live event emission', () => {
  it('emits one complete event for publication and token rotation', async () => {
    const source = await readFile('apps/api/src/index.ts', 'utf8');
    const publication = routeBody(
      source,
      "app.post('/api/overlays/:id/publish'",
      "app.post('/api/overlays/:id/rotate-token'",
    );
    const rotation = routeBody(
      source,
      "app.post('/api/overlays/:id/rotate-token'",
      "app.post('/api/overlays/:id/reset-template'",
    );

    expect(publication.match(/type: 'overlay-published'/g)).toHaveLength(1);
    expect(publication).toContain('payload: { projectId, versionId: v.id, publicUrl, template: project.template }');
    expect(rotation.match(/type: 'overlay-version-changed'/g)).toHaveLength(1);
  });
});
