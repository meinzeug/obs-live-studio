import { readdir, readFile } from 'node:fs/promises';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { isKnownRoute, notificationTarget, routes } from '../apps/web/src/navigation.js';

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
    expect(isKnownRoute('/articles/article-1')).toBe(true);
    expect(isKnownRoute('/overlays/overlay-1/edit')).toBe(true);
    expect(isKnownRoute('/missing-module')).toBe(false);
  });

  it('maps operational notifications to an existing module', () => {
    for (const component of ['source-ingest', 'broadcast-runner', 'obs-controller', 'stream-supervisor', 'unknown']) {
      expect(isKnownRoute(notificationTarget(component)), component).toBe(true);
    }
  });

  it('keeps direct module navigation independent from server-side history fallbacks', async () => {
    const app = await readFile('apps/web/src/App.tsx', 'utf8');
    expect(app).toContain('HashRouter');
    expect(app).toContain('<Route path="*" element={<NotFoundPage />} />');
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
