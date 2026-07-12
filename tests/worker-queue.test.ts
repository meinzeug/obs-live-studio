import { describe, it, expect, vi } from 'vitest';
vi.mock('@ans/database', () => ({
  scheduleSourceFetchJobs: vi.fn(),
  claimWorkerJob: vi.fn(),
  completeWorkerJob: vi.fn(),
  failWorkerJob: vi.fn(),
  getSource: vi.fn(),
  dueSources: vi.fn(async () => []),
  pool: {
    connect: vi.fn(async () => ({
      query: vi.fn(async (sql: string) => (sql.includes('pg_try') ? { rows: [{ locked: true }] } : { rows: [] })),
      release: vi.fn(),
    })),
  },
  markSourceError: vi.fn(),
  markSourceSuccess: vi.fn(),
  recordSourceCheck: vi.fn(),
  upsertArticle: vi.fn(),
}));
vi.mock('@ans/source-connectors', () => ({ fetchHttpText: vi.fn() }));
describe('worker queue source payload isolation', () => {
  it('fetch-source jobs only load their payload source', async () => {
    const db = (await import('@ans/database')) as any;
    db.claimWorkerJob.mockResolvedValue({
      id: 'j1',
      kind: 'fetch-source',
      attempts: 1,
      payload: { sourceId: '00000000-0000-4000-8000-00000000000b' },
    });
    db.getSource.mockResolvedValue({
      id: '00000000-0000-4000-8000-00000000000b',
      url: 'http://127.0.0.1:12000/feed',
      max_fetch_seconds: 1,
      max_articles: 0,
      etag: null,
      last_modified: null,
      category: null,
      region: null,
      trust_level: 50,
      consecutive_errors: 0,
    });
    const sc = (await import('@ans/source-connectors')) as any;
    sc.fetchHttpText.mockResolvedValue({ notModified: true, etag: 'e', lastModified: 'm' });
    const { workOnce } = await import('../apps/worker/src/index.js');
    await workOnce();
    expect(db.getSource).toHaveBeenCalledWith('00000000-0000-4000-8000-00000000000b');
    expect(db.dueSources).not.toHaveBeenCalled();
    expect(db.completeWorkerJob).toHaveBeenCalledWith('j1');
  });
});
