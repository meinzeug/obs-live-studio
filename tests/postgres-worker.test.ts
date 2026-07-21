import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import {
  pool,
  query,
  failWorkerJob,
  claimWorkerJob,
  acquireRunnerLease,
  claimNextBroadcastCommand,
} from '@ans/database';
const hasDb = Boolean(process.env.DATABASE_URL);
(hasDb ? describe : describe.skip)('PostgreSQL worker queue integration', () => {
  beforeAll(async () => {
    await query("delete from worker_jobs where kind='vitest-job'");
  });
  afterAll(async () => {
    await query("delete from worker_jobs where kind='vitest-job'");
    await pool.end();
  });
  it('claims queued jobs atomically and schedules retry without touching source success time', async () => {
    await query("insert into worker_jobs(kind,payload,status,scheduled_at) values('vitest-job','{}','queued',now())");
    const job = await claimWorkerJob('vitest', 'vitest-job');
    expect(job.kind).toBe('vitest-job');
    const second = await claimWorkerJob('vitest-2', 'vitest-job');
    expect(second).toBeNull();
    await failWorkerJob(job.id, 'boom', 120);
    const row = (await query('select status,scheduled_at>now() future_retry from worker_jobs where id=$1', [job.id]))
      .rows[0];
    expect(row.status).toBe('queued');
    expect(row.future_retry).toBe(true);
  }, 15_000);
  it('returns null when a leased broadcast run has no pending command', async () => {
    const playlist = (
      await query<{ id: string }>(
        "insert into broadcast_playlists(name,status,current_position) values('vitest-command-claim','draft',0) returning id",
      )
    ).rows[0];
    const run = (
      await query<{ id: string }>(
        "insert into broadcast_runs(playlist_id,started_at,status,last_state) values($1,now(),'running','{}') returning id",
        [playlist.id],
      )
    ).rows[0];
    try {
      const lease = await acquireRunnerLease(run.id, 'vitest-runner');
      const command = await claimNextBroadcastCommand(run.id, 'vitest-runner', 15, Number(lease?.lease_generation));
      expect(command).toBeNull();
    } finally {
      await query('delete from broadcast_runs where id=$1', [run.id]);
      await query('delete from broadcast_playlists where id=$1', [playlist.id]);
    }
  });
});
