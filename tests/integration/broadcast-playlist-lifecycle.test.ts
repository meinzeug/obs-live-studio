import { randomUUID } from 'node:crypto';
import { afterEach, describe, expect, it } from 'vitest';
import {
  createAutopilotBroadcastPlaylist,
  createBroadcastPlaylist,
  deleteBroadcastPlaylist,
  query,
} from '../../packages/database/src/index.js';

const integration = process.env.VITEST_INCLUDE_INTEGRATION === 'true' ? describe : describe.skip;

integration('broadcast playlist lifecycle', () => {
  const playlistIds: string[] = [];

  afterEach(async () => {
    if (!playlistIds.length) return;
    await query(`delete from broadcast_playlists where id=any($1::uuid[])`, [playlistIds]).catch(() => undefined);
    playlistIds.length = 0;
  });

  it('deletes an ended playlist together with its historical run', async () => {
    const playlist = await createBroadcastPlaylist(`delete-${randomUUID()}`);
    playlistIds.push(playlist.id);
    const run = (
      await query<{ id: string }>(
        `insert into broadcast_runs(playlist_id,started_at,ended_at,status)
         values($1,now()-interval '2 minutes',now()-interval '1 minute','ended')
         returning id`,
        [playlist.id],
      )
    ).rows[0];

    await deleteBroadcastPlaylist(playlist.id);

    expect((await query(`select 1 from broadcast_playlists where id=$1`, [playlist.id])).rowCount).toBe(0);
    expect((await query(`select 1 from broadcast_runs where id=$1`, [run.id])).rowCount).toBe(0);
    playlistIds.length = 0;
  });

  it('replaces a stale draft instead of creating two shows at the same timecode', async () => {
    const scheduledAt = new Date(Date.now() + 7 * 24 * 3600_000 + Math.floor(Math.random() * 10_000)).toISOString();
    const first = await createAutopilotBroadcastPlaylist(`slot-a-${randomUUID()}`, {
      scheduledAt,
      settings: {
        autopilot24h: true,
        autopilotFormatId: `format-a-${randomUUID()}`,
      },
    });
    playlistIds.push(first.playlist.id);
    expect(first.created).toBe(true);

    const second = await createAutopilotBroadcastPlaylist(`slot-b-${randomUUID()}`, {
      scheduledAt,
      settings: {
        autopilot24h: true,
        autopilotFormatId: `format-b-${randomUUID()}`,
      },
    });
    playlistIds.push(second.playlist.id);
    expect(second.created).toBe(true);

    const active = (
      await query<{ id: string }>(
        `select id from broadcast_playlists
         where scheduled_at=$1
           and coalesce((settings->>'autopilot24h')::boolean,false)=true
           and status in ('draft','starting','running','paused')`,
        [scheduledAt],
      )
    ).rows;
    expect(active).toEqual([{ id: second.playlist.id }]);
    const superseded = (
      await query<{ status: string; reconciliation: string }>(
        `select status,settings->>'scheduleReconciliation' reconciliation
         from broadcast_playlists where id=$1`,
        [first.playlist.id],
      )
    ).rows[0];
    expect(superseded).toEqual({
      status: 'interrupted',
      reconciliation: 'replaced-by-current-autopilot-format',
    });
  });
});
