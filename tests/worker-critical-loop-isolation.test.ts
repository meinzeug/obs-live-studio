import { readFile } from 'node:fs/promises';
import { describe, expect, it } from 'vitest';

describe('worker critical loop isolation', () => {
  it('starts the editorial desk without blocking the rest of the worker', async () => {
    const source = await readFile('apps/worker/src/editorial-desk.ts', 'utf8');
    const start = source.slice(
      source.indexOf('async start()'),
      source.indexOf('\n  stop()', source.indexOf('async start()')),
    );
    expect(start).toContain("void this.run('startup')");
    expect(start).not.toContain("await this.run('startup')");
  });

  it('runs playout, source, media and editorial work on independent guards', async () => {
    const source = await readFile('apps/worker/src/index.ts', 'utf8');
    expect(source).toContain('const playoutTick = async () =>');
    expect(source).toContain("await workOnce('fetch-source')");
    expect(source).toContain("await workOnce('discover-article-media')");
    expect(source).toContain('await reconcileAutomaticEditorialPipeline()');
    expect(source).toContain("scheduleTick('playout', playoutTick)");
    expect(source).toContain('worker_job_lease_heartbeat_failed');
    expect(source).toContain('startWorkerHealthServer');
    expect(source).toContain("server.listen(port, '127.0.0.1'");
  });
});
