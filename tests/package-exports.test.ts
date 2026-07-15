import { readFile } from 'node:fs/promises';
import { describe, expect, it } from 'vitest';

async function jsonFile<T>(path: string) {
  return JSON.parse(await readFile(path, 'utf8')) as T;
}

async function packageExports(path: string) {
  const document = await jsonFile<{ exports?: Record<string, string> }>(path);
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

  it('builds and exports every media-engine subpath used by API and worker processes', async () => {
    const [exports, tsconfig] = await Promise.all([
      packageExports('packages/media-engine/package.json'),
      jsonFile<{ compilerOptions?: { rootDir?: string; outDir?: string } }>('packages/media-engine/tsconfig.json'),
    ]);
    expect(tsconfig.compilerOptions).toMatchObject({ rootDir: 'src', outDir: 'dist' });
    expect(exports).toMatchObject({
      './discovery': './dist/discovery-v2.js',
      './video-upload': './dist/video-upload.js',
      './workflow': './dist/workflow.js',
    });
  });
});
