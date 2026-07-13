import { beforeAll, afterAll, beforeEach, describe, expect, it } from 'vitest';
import { randomUUID } from 'node:crypto';
import {
  acquireRunnerLease,
  applyRuntimeTransition,
  attachRunnerToPlaybackRun,
  claimBroadcastRecoveryOperation,
  completeBroadcastRecoveryOperation,
  createBroadcastCommand,
  finalizePlaybackRun,
  getPlaybackSnapshot,
  initializePlaybackRun,
  pool,
  query,
  requestBroadcastRecoveryOperation,
  requestBroadcastStart,
} from '@ans/database';
import { runMigrations } from '../../packages/database/src/migrate.js';

async function cleanup() {
  await query(
    "delete from live_events where payload->>'testRun'='broadcast-integration' or dedupe_key like 'broadcast-integration:%'",
  );
  await query("delete from broadcast_recovery_operations where requested_by='broadcast-integration'");
  await query("delete from broadcast_runner_leases where runner_id like 'broadcast-integration-%'");
  await query("delete from broadcast_commands where idempotency_key like 'broadcast-integration:%'");
  await query("delete from broadcast_runs where last_state->>'testRun'='broadcast-integration'");
  await query("delete from broadcast_playlists where name like 'broadcast-integration-%'");
  await query("delete from overlay_projects where name like 'broadcast-integration-%'");
  await query("delete from articles where title like 'broadcast-integration-%'");
}

async function fixture(
  opts: { audio?: boolean; overlay?: boolean; overlayConfigured?: boolean; duration?: number } = {},
) {
  const suffix = randomUUID();
  let versionId: string | null = null;
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
    versionId = version.id;
    if (opts.overlayConfigured !== false)
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
    await query(`insert into audio_assets(script_id,media_id,duration_seconds) values($1,$2,$3)`, [
      script.id,
      media.id,
      opts.duration ?? 1,
    ]);
  }
  const item = (
    await query(
      `insert into broadcast_items(playlist_id,article_id,position,status) values($1,$2,0,'planned') returning id`,
      [playlist.id, article.id],
    )
  ).rows[0];
  return { playlistId: playlist.id, articleId: article.id, itemId: item.id, overlayVersionId: versionId };
}

async function startedRun() {
  const f = await fixture();
  const started = await requestBroadcastStart({
    playlistId: f.playlistId,
    requestedBy: 'broadcast-integration',
    config: { testRun: 'broadcast-integration' },
  });
  const lease = await acquireRunnerLease(started.run.id, 'broadcast-integration-runner');
  return { ...f, started, leaseGeneration: Number(lease?.lease_generation), runnerId: 'broadcast-integration-runner' };
}

describe('PostgreSQL broadcast integration', () => {
  beforeAll(runMigrations);
  beforeEach(cleanup);
  afterAll(async () => {
    await cleanup();
    await pool.end();
  });

  it('starts with audio and records the configured main overlay', async () => {
    const f = await fixture();
    const started = await requestBroadcastStart({ playlistId: f.playlistId, requestedBy: 'broadcast-integration' });
    expect(started.playback.overlayVersionId).toBe(f.overlayVersionId);
  });

  it('rejects start without audio or without exact configured main overlay', async () => {
    await expect(requestBroadcastStart({ playlistId: (await fixture({ audio: false })).playlistId })).rejects.toThrow(
      /playlist-has-no-broadcastable-items/,
    );
    await cleanup();
    await expect(
      requestBroadcastStart({ playlistId: (await fixture({ overlayConfigured: false })).playlistId }),
    ).rejects.toThrow(/published-main-overlay-required/);
  });

  it('parallel start requests and idempotency create one run', async () => {
    const { playlistId } = await fixture();
    const [a, b] = await Promise.all([
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
    expect(a.run.id).toBe(b.run.id);
    const runs = await query(`select count(*)::int count from broadcast_runs where playlist_id=$1`, [playlistId]);
    expect(runs.rows[0].count).toBe(1);
  });

  it('runner attachment does not reset command sequence', async () => {
    const r = await startedRun();
    await query(`update playback_state set command_sequence=7 where id=true`);
    const attached = await attachRunnerToPlaybackRun({
      broadcastRunId: r.started.run.id,
      playlistId: r.playlistId,
      runnerId: r.runnerId,
      leaseGeneration: r.leaseGeneration,
    });
    expect(attached.snapshot.commandSeq).toBe(7);
  });

  it('skip advances playlist position', async () => {
    const r = await startedRun();
    await applyRuntimeTransition({
      broadcastRunId: r.started.run.id,
      playlistId: r.playlistId,
      runnerId: r.runnerId,
      leaseGeneration: r.leaseGeneration,
      expectedRevision: 1,
      status: 'skipping',
      runStatus: 'running',
      playlistStatus: 'running',
      itemStatus: 'skipped',
      itemId: r.itemId,
      articleId: r.articleId,
      position: 1,
      eventType: 'item-skipped',
      dedupeKey: `broadcast-integration:${r.itemId}:skipped`,
      payload: { testRun: 'broadcast-integration' },
    });
    expect(
      (await query(`select current_position from broadcast_playlists where id=$1`, [r.playlistId])).rows[0]
        .current_position,
    ).toBe(1);
  });

  it('stop marks run, playlist, and playback interrupted with one final event', async () => {
    const r = await startedRun();
    await finalizePlaybackRun({
      broadcastRunId: r.started.run.id,
      playlistId: r.playlistId,
      runnerId: r.runnerId,
      leaseGeneration: r.leaseGeneration,
      expectedRevision: 1,
      status: 'interrupted',
      reason: 'test',
    });
    expect((await query(`select status from broadcast_runs where id=$1`, [r.started.run.id])).rows[0].status).toBe(
      'interrupted',
    );
    expect((await query(`select status from broadcast_playlists where id=$1`, [r.playlistId])).rows[0].status).toBe(
      'interrupted',
    );
    expect((await getPlaybackSnapshot()).status).toBe('interrupted');
    expect(
      (
        await query(
          `select count(*)::int count from live_events where broadcast_run_id=$1 and type='broadcast-stopped'`,
          [r.started.run.id],
        )
      ).rows[0].count,
    ).toBe(1);
  });

  it('rejects stale lease generations', async () => {
    const r = await startedRun();
    await expect(
      applyRuntimeTransition({
        broadcastRunId: r.started.run.id,
        playlistId: r.playlistId,
        runnerId: r.runnerId,
        leaseGeneration: r.leaseGeneration + 1,
        expectedRevision: 1,
        status: 'playing',
        eventType: 'item-started',
      }),
    ).rejects.toThrow(/lease-fencing-conflict/);
  });

  it('completes recovery operation after readiness', async () => {
    const r = await startedRun();
    await query(
      `update broadcast_runner_leases set lease_expires_at=now()-interval '1 second' where broadcast_run_id=$1`,
      [r.started.run.id],
    );
    await requestBroadcastRecoveryOperation({
      broadcastRunId: r.started.run.id,
      requestedBy: 'broadcast-integration',
      reason: 'test',
    });
    const op = await claimBroadcastRecoveryOperation('broadcast-integration-runner-2');
    expect(op).toBeTruthy();
    const lease = await acquireRunnerLease(r.started.run.id, 'broadcast-integration-runner-2');
    const completed = await completeBroadcastRecoveryOperation({
      id: op!.id,
      runnerId: 'broadcast-integration-runner-2',
      broadcastRunId: r.started.run.id,
      leaseGeneration: Number(lease?.lease_generation),
      recoveryMode: 'resumed',
    });
    expect(completed?.status).toBe('completed');
  });

  it('keeps initialization fixtures reproducible', async () => {
    const { playlistId } = await fixture();
    const started = await requestBroadcastStart({ playlistId, requestedBy: 'broadcast-integration' });
    await initializePlaybackRun({ broadcastRunId: started.run.id, playlistId, status: 'starting' });
    expect(await getPlaybackSnapshot()).toMatchObject({ runId: started.run.id, playlistId, status: 'starting' });
    await createBroadcastCommand({
      broadcastRunId: started.run.id,
      playlistId,
      command: 'pause',
      idempotencyKey: 'broadcast-integration:pause',
    });
  });
});
