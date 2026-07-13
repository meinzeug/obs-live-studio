import { beforeAll, afterAll, beforeEach, describe, expect, it } from 'vitest';
import { randomUUID } from 'node:crypto';
import {
  acquireRunnerLease,
  attachRunnerToPlaybackRun,
  getPlaybackSnapshot,
  initializePlaybackRun,
  pool,
  query,
  requestBroadcastStart,
} from '@ans/database';

const hasDb = Boolean(process.env.DATABASE_URL);
const suite = hasDb ? describe : describe.skip;

async function migrate() {
  await import('../../packages/database/src/migrate.js');
}

async function cleanup() {
  await query("delete from live_events where payload->>'testRun'='broadcast-integration'");
  await query("delete from broadcast_recovery_operations where requested_by='broadcast-integration'");
  await query("delete from broadcast_runner_leases where runner_id like 'broadcast-integration-%'");
  await query("delete from broadcast_commands where idempotency_key like 'broadcast-integration:%'");
  await query("delete from broadcast_runs where last_state->>'testRun'='broadcast-integration'");
  await query("delete from broadcast_playlists where name like 'broadcast-integration-%'");
  await query("delete from overlay_projects where name like 'broadcast-integration-%'");
  await query("delete from articles where title like 'broadcast-integration-%'");
}

async function fixture(opts: { audio?: boolean; overlay?: boolean } = {}) {
  const suffix = randomUUID();
  if (opts.overlay !== false) {
    const project = (
      await query(
        `insert into overlay_projects(name,width,height,template,status,public_live_id,public_token_hash,public_url)
       values($1,1920,1080,'main-news','active',$2,$3,$4) returning id`,
        [`broadcast-integration-${suffix}`, `live-${suffix}`, `hash-${suffix}`, `/overlays/live-${suffix}`],
      )
    ).rows[0];
    const version = (
      await query(
        `insert into overlay_versions(project_id,status,published,document) values($1,'published',true,'{}') returning id`,
        [project.id],
      )
    ).rows[0];
    await query(`update overlay_projects set obs_configured_version_id=$2 where id=$1`, [project.id, version.id]);
  }
  const playlist = (
    await query(`insert into broadcast_playlists(name,status,current_position) values($1,'draft',0) returning id`, [
      `broadcast-integration-${suffix}`,
    ])
  ).rows[0];
  const article = (
    await query(`insert into articles(title,url,source,status) values($1,$2,'integration','approved') returning id`, [
      `broadcast-integration-${suffix}`,
      `https://example.test/${suffix}`,
    ])
  ).rows[0];
  const script = (
    await query(`insert into scripts(article_id,content) values($1,'Integration script') returning id`, [article.id])
  ).rows[0];
  if (opts.audio !== false) {
    const media = (
      await query(
        `insert into media_assets(kind,filename,mime_type,size_bytes,metadata) values('audio',$1,'audio/wav',1,'{}') returning id`,
        [`/tmp/broadcast-integration-${suffix}.wav`],
      )
    ).rows[0];
    await query(`insert into audio_assets(script_id,media_id,duration_seconds) values($1,$2,1)`, [script.id, media.id]);
  }
  await query(`insert into broadcast_items(playlist_id,article_id,position,status) values($1,$2,0,'planned')`, [
    playlist.id,
    article.id,
  ]);
  return { playlistId: playlist.id };
}

suite('PostgreSQL broadcast integration', () => {
  beforeAll(migrate);
  beforeEach(cleanup);
  afterAll(async () => {
    await cleanup();
    await pool.end();
  });

  it('parallel start requests and idempotency create one run', async () => {
    const { playlistId } = await fixture();
    const [a, b] = await Promise.allSettled([
      requestBroadcastStart({
        playlistId,
        requestedBy: 'broadcast-integration',
        idempotencyKey: 'broadcast-integration:start',
      }),
      requestBroadcastStart({
        playlistId,
        requestedBy: 'broadcast-integration',
        idempotencyKey: 'broadcast-integration:start',
      }),
    ]);
    expect(a.status).toBe('fulfilled');
    expect(b.status).toBe('fulfilled');
    const runs = await query(`select count(*)::int count from broadcast_runs where playlist_id=$1`, [playlistId]);
    expect(runs.rows[0].count).toBe(1);
  });

  it('rejects start without broadcastable audio and without configured main overlay', async () => {
    await expect(requestBroadcastStart({ playlistId: (await fixture({ audio: false })).playlistId })).rejects.toThrow(
      /playlist-has-no-broadcastable-items/,
    );
    await cleanup();
    await expect(requestBroadcastStart({ playlistId: (await fixture({ overlay: false })).playlistId })).rejects.toThrow(
      /published-main-overlay-required/,
    );
  });

  it('runner attachment increments revision without resetting command sequence', async () => {
    const { playlistId } = await fixture();
    const started = await requestBroadcastStart({ playlistId, requestedBy: 'broadcast-integration' });
    await query(`update playback_state set command_sequence=7 where id=true`);
    const lease = await acquireRunnerLease(started.run.id, 'broadcast-integration-runner');
    const attached = await attachRunnerToPlaybackRun({
      broadcastRunId: started.run.id,
      playlistId,
      runnerId: 'broadcast-integration-runner',
      leaseGeneration: Number(lease?.lease_generation),
    });
    expect(attached.snapshot.commandSeq).toBe(7);
    expect(attached.snapshot.stateRevision).toBe(2);
  });

  it('keeps initialization fixtures reproducible for command, recovery, fencing, and final-event scenarios', async () => {
    const { playlistId } = await fixture();
    const started = await requestBroadcastStart({ playlistId, requestedBy: 'broadcast-integration' });
    await initializePlaybackRun({ broadcastRunId: started.run.id, playlistId, status: 'starting' });
    const snapshot = await getPlaybackSnapshot();
    expect(snapshot).toMatchObject({ runId: started.run.id, playlistId, status: 'starting' });
  });
});
