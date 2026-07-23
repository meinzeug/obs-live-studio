import { describe, it, expect, vi } from 'vitest';
vi.mock('@ans/database', () => ({
  claimWorkerJob: vi.fn(),
  completeWorkerJob: vi.fn(),
  failWorkerJob: vi.fn(),
  getSource: vi.fn(),
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
  activeBroadcastRun: vi.fn(),
  addBroadcastItem: vi.fn(),
  createBroadcastPlaylist: vi.fn(),
  getArticleDetail: vi.fn(),
  listArticles: vi.fn(),
  query: vi.fn(),
  requestBroadcastRecoveryOperation: vi.fn(),
  saveArticlePackage: vi.fn(),
  saveAudioAsset: vi.fn(),
  setArticleStatus: vi.fn(),
  tryStartBroadcastRun: vi.fn(),
}));
vi.mock('@ans/database/notifications', () => ({
  redactOperationalText: vi.fn((value: unknown) => String(value ?? '')),
  resolveOperationalNotification: vi.fn(),
  upsertOperationalNotification: vi.fn(),
}));
vi.mock('@ans/database/source-health', () => ({
  dueSourcesWithBackoff: vi.fn(async () => []),
  scheduleSourceFetchJobsWithBackoff: vi.fn(),
  sourceRetryDelaySeconds: vi.fn(() => 120),
}));
vi.mock('@ans/source-connectors', () => ({ fetchHttpText: vi.fn() }));
describe('worker queue source payload isolation', () => {
  it('uses a session advisory lock without keeping a database transaction open during network work', async () => {
    const db = (await import('@ans/database')) as any;
    const query = vi.fn(async (sql: string) =>
      sql.includes('pg_try_advisory_lock') ? { rows: [{ locked: true }] } : { rows: [] },
    );
    const release = vi.fn();
    db.pool.connect.mockResolvedValueOnce({ query, release });
    const { withSourceLock } = await import('../apps/worker/src/index.js');

    await expect(withSourceLock('00000000-0000-4000-8000-00000000000b', async () => 'ok')).resolves.toBe('ok');
    const statements = query.mock.calls.map(([sql]) => sql);
    expect(statements.some((sql) => /^begin|^commit|^rollback/.test(sql))).toBe(false);
    expect(statements.some((sql) => sql.includes('pg_advisory_unlock'))).toBe(true);
    expect(release).toHaveBeenCalledOnce();
  }, 10_000);

  it('fetch-source jobs only load their payload source', async () => {
    const db = (await import('@ans/database')) as any;
    const sourceHealth = (await import('@ans/database/source-health')) as any;
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
    sc.fetchHttpText.mockResolvedValue({
      notModified: true,
      etag: 'e',
      lastModified: 'm',
      status: 304,
      url: 'http://127.0.0.1:12000/feed',
    });
    const { workOnce } = await import('../apps/worker/src/index.js');
    await workOnce();
    expect(sourceHealth.scheduleSourceFetchJobsWithBackoff).toHaveBeenCalledOnce();
    expect(db.getSource).toHaveBeenCalledWith('00000000-0000-4000-8000-00000000000b');
    expect(sourceHealth.dueSourcesWithBackoff).not.toHaveBeenCalled();
    expect(db.completeWorkerJob).toHaveBeenCalledWith('j1');
  });

  it('fails unknown job types instead of silently marking them complete', async () => {
    const db = (await import('@ans/database')) as any;
    db.claimWorkerJob.mockResolvedValueOnce({
      id: 'unknown-job',
      kind: 'unsupported-job-kind',
      attempts: 1,
      payload: {},
    });
    const { workOnce } = await import('../apps/worker/src/index.js');

    await expect(workOnce()).rejects.toThrow('Unbekannter Worker-Auftrag');
    expect(db.completeWorkerJob).not.toHaveBeenCalledWith('unknown-job');
    expect(db.failWorkerJob).toHaveBeenCalledWith('unknown-job', expect.stringContaining('Unbekannter'), 120);
  });
});
