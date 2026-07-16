import { afterEach, describe, expect, it, vi } from 'vitest';
import { createBroadcastPlaylistWithArticles, pool } from '@ans/database';

const articleA = '00000000-0000-4000-8000-0000000000a1';
const articleB = '00000000-0000-4000-8000-0000000000b2';
const playlistId = '00000000-0000-4000-8000-0000000000c3';

afterEach(() => vi.restoreAllMocks());

describe('AI broadcast playlist transaction', () => {
  it('creates the playlist and every item in one committed transaction', async () => {
    const query = vi.fn(async (sql: string, params?: unknown[]) => {
      if (sql.includes('from articles a')) {
        return {
          rows: [
            { id: articleA, status: 'approved', media_ready: true },
            { id: articleB, status: 'published', media_ready: true },
          ],
        };
      }
      if (sql.includes('insert into broadcast_playlists')) return { rows: [{ id: playlistId, name: params?.[0] }] };
      if (sql.includes('insert into broadcast_items')) {
        return { rows: [{ id: `item-${params?.[2]}`, playlist_id: playlistId, article_id: params?.[1] }] };
      }
      return { rows: [] };
    });
    const release = vi.fn();
    vi.spyOn(pool, 'connect').mockResolvedValue({ query, release } as any);

    const result = await createBroadcastPlaylistWithArticles('KI Morgenmagazin', [articleA, articleB]);

    expect(result.playlist).toMatchObject({ id: playlistId, name: 'KI Morgenmagazin' });
    expect(result.items.map((item) => item.article_id)).toEqual([articleA, articleB]);
    expect(query.mock.calls.map(([sql]) => sql)).toContain('begin');
    expect(query.mock.calls.map(([sql]) => sql)).toContain('commit');
    expect(query.mock.calls.filter(([sql]) => sql.includes('insert into broadcast_items'))).toHaveLength(2);
    expect(release).toHaveBeenCalledOnce();
  });

  it('rolls back before creating a partial playlist when a candidate became invalid', async () => {
    const query = vi.fn(async (sql: string) => {
      if (sql.includes('from articles a')) {
        return { rows: [{ id: articleA, status: 'review', media_ready: true }] };
      }
      return { rows: [] };
    });
    vi.spyOn(pool, 'connect').mockResolvedValue({ query, release: vi.fn() } as any);

    await expect(createBroadcastPlaylistWithArticles('Ungültig', [articleA])).rejects.toMatchObject({
      statusCode: 409,
    });
    expect(query.mock.calls.map(([sql]) => sql)).toContain('rollback');
    expect(query.mock.calls.some(([sql]) => sql.includes('insert into broadcast_playlists'))).toBe(false);
  });
});
