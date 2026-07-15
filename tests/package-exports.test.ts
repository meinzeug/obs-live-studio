import { readFile } from 'node:fs/promises';
import { describe, expect, it } from 'vitest';

async function packageExports(path: string) {
  const document = JSON.parse(await readFile(path, 'utf8')) as { exports?: Record<string, string> };
  return document.exports ?? {};
}

describe('workspace runtime exports', () => {
  it('exports every database subpath used by the API', async () => {
    const exports = await packageExports('packages/database/package.json');
    expect(exports).toMatchObject({
      './article-media': './dist/article-media.js',
      './auth': './dist/auth.js',
      './notifications': './dist/notifications.js',
      './source-health': './dist/source-health-store.js',
      './source-updates': './dist/source-update-store.js',
    });
  });

  it('exports every media-engine subpath used by API and worker processes', async () => {
    const exports = await packageExports('packages/media-engine/package.json');
    expect(exports).toMatchObject({
      './discovery': './dist/discovery-v2.js',
      './video-upload': './dist/video-upload.js',
      './workflow': './dist/workflow.js',
    });
  });
});
