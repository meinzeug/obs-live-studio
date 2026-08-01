import { readFile } from 'node:fs/promises';
import { describe, expect, it } from 'vitest';

describe('automatic editorial reconciliation', () => {
  it('uses the configured AI provider before the local continuity fallback', async () => {
    const worker = await readFile('apps/worker/src/index.ts', 'utf8');
    const reconciliation = worker.slice(
      worker.indexOf('export async function reconcileAutomaticEditorialPipeline'),
      worker.indexOf('export async function withSourceLock'),
    );
    const editorial = await readFile('apps/worker/src/ai-editorial.ts', 'utf8');

    expect(reconciliation).toContain('await prepareAndSaveAutomaticEditorial(');
    expect(reconciliation).not.toContain('await prepareAndSaveAutomaticEditorialFallback(');
    expect(editorial).toContain('await prepareAndSaveAiEditorial(');
    expect(editorial).toContain('catch (error)');
    expect(editorial).toContain('prepareAndSaveAutomaticEditorialFallback(article, sourceName, options)');
  });
});
