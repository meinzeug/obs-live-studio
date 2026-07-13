import { beforeAll, afterAll, beforeEach, describe, expect, it } from 'vitest';
import { cleanupBroadcastFixtures, createBroadcastFixture } from '../helpers/broadcast-fixtures.js';
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
import { BroadcastRunner } from '../../packages/broadcast-engine/src/index.js';

async function cleanup() {
  await cleanupBroadcastFixtures('broadcast-integration');
}

async function ensureUser(id: string) {
  await query(
    `insert into roles(id,name,permissions) values('00000000-0000-0000-0000-00000000feed','broadcast-test-role','[]'::jsonb) on conflict(id) do nothing`,
  );
  await query(
    `insert into users(id,email,password_hash,display_name,role_id) values($1,$2,'test','Broadcast Test','00000000-0000-0000-0000-00000000feed') on conflict(id) do nothing`,
    [id, `${id}@example.invalid`],
  );
}

async function fixture(
  opts: { audio?: boolean; overlay?: boolean; overlayConfigured?: boolean; duration?: number } = {},
) {
  const f = await createBroadcastFixture({
    scope: 'broadcast-integration',
    items: 1,
    audio: opts.audio,
    overlay: opts.overlay,
    overlayConfigured: opts.overlayConfigured,
    durationSeconds: opts.duration ?? 1,
  });
  return {
    playlistId: f.playlistId,
    articleId: f.articleIds[0],
    itemId: f.itemIds[0],
    overlayVersionId: f.overlayVersionId,
  };
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
    expect(started.playback.state.overlayVersionId).toBe(f.overlayVersionId);
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

  it('scopes broadcast start idempotency by user', async () => {
    const f = await fixture();
    const key = 'shared.key-1';
    await ensureUser('00000000-0000-0000-0000-000000000001');
    await ensureUser('00000000-0000-0000-0000-000000000002');
    const a = await requestBroadcastStart({
      playlistId: f.playlistId,
      requestedByUserId: '00000000-0000-0000-0000-000000000001',
      idempotencyKey: key,
    });
    await query(`update broadcast_runs set status='completed' where id=$1`, [a.run.id]);
    await query(`update broadcast_playlists set status='completed' where id=$1`, [f.playlistId]);
    await query(`update playback_state set state='{"status":"idle"}'::jsonb where id=true`);
    const b = await requestBroadcastStart({
      playlistId: f.playlistId,
      requestedByUserId: '00000000-0000-0000-0000-000000000002',
      idempotencyKey: key,
    });
    expect(b.run.id).not.toBe(a.run.id);
  });

  it('replays identical starts with the same run and stored snapshot', async () => {
    const { playlistId } = await fixture();
    await ensureUser('00000000-0000-0000-0000-000000000003');
    const input = {
      playlistId,
      requestedByUserId: '00000000-0000-0000-0000-000000000003',
      idempotencyKey: 'broadcast-integration:replay',
      config: { z: 1, a: { b: true } },
    };
    const a = await requestBroadcastStart(input);
    await query(`update playback_state set state=jsonb_set(state,'{runId}',to_jsonb('later-run'::text)) where id=true`);
    const b = await requestBroadcastStart(input);
    expect(b.run.id).toBe(a.run.id);
    expect(b.operation.id).toBe(a.operation.id);
    expect(b.playback).toEqual(a.playback);
  });

  it('rejects same scoped idempotency key with different config', async () => {
    const { playlistId } = await fixture();
    await ensureUser('00000000-0000-0000-0000-000000000004');
    const base = {
      playlistId,
      requestedByUserId: '00000000-0000-0000-0000-000000000004',
      idempotencyKey: 'broadcast-integration:conflict',
    };
    await requestBroadcastStart({ ...base, config: { a: 1 } });
    await expect(requestBroadcastStart({ ...base, config: { a: 2 } })).rejects.toThrow(/idempotency-key-conflict/);
  });

  it('canonicalizes differently sorted JSON keys into the same fingerprint', async () => {
    const { playlistId } = await fixture();
    await ensureUser('00000000-0000-0000-0000-000000000005');
    const base = {
      playlistId,
      requestedByUserId: '00000000-0000-0000-0000-000000000005',
      idempotencyKey: 'broadcast-integration:canonical',
    };
    const a = await requestBroadcastStart({ ...base, config: { b: 2, a: { d: 4, c: 3 } } });
    const b = await requestBroadcastStart({ ...base, config: { a: { c: 3, d: 4 }, b: 2 } });
    expect(b.operation.request_fingerprint).toBe(a.operation.request_fingerprint);
    expect(b.run.id).toBe(a.run.id);
  });

  it('rejects forged actor scopes and derives user scope from requested user', async () => {
    const { playlistId } = await fixture();
    await ensureUser('00000000-0000-0000-0000-000000000006');
    await ensureUser('00000000-0000-0000-0000-000000000007');
    const started = await requestBroadcastStart({
      playlistId,
      requestedByUserId: '00000000-0000-0000-0000-000000000006',
      idempotencyKey: 'broadcast-integration:derived-scope',
    });
    const stored = (
      await query(`select requested_by_user_id,idempotency_scope from broadcast_recovery_operations where id=$1`, [
        started.operation.id,
      ])
    ).rows[0];
    expect(stored.requested_by_user_id).toBe('00000000-0000-0000-0000-000000000006');
    expect(stored.idempotency_scope).toBe('user:00000000-0000-0000-0000-000000000006');
  });

  it('replay without a start snapshot returns the defined error', async () => {
    const { playlistId } = await fixture();
    const started = await requestBroadcastStart({
      playlistId,
      requestedBy: 'broadcast-integration',
      idempotencyKey: 'broadcast-integration:no-snapshot',
    });
    await query(`update broadcast_recovery_operations set start_snapshot=null where id=$1`, [started.operation.id]);
    await expect(
      requestBroadcastStart({
        playlistId,
        requestedBy: 'broadcast-integration',
        idempotencyKey: 'broadcast-integration:no-snapshot',
      }),
    ).rejects.toThrow(/idempotency-replay-unavailable/);
  });

  it('keeps playlist starting until start recovery readiness completes', async () => {
    const { playlistId } = await fixture();
    const started = await requestBroadcastStart({ playlistId, requestedBy: 'broadcast-integration' });
    expect((await query(`select status from broadcast_runs where id=$1`, [started.run.id])).rows[0].status).toBe(
      'starting',
    );
    expect((await query(`select status from broadcast_playlists where id=$1`, [playlistId])).rows[0].status).toBe(
      'starting',
    );
    const op = await claimBroadcastRecoveryOperation('broadcast-integration-readiness-runner');
    const lease = await acquireRunnerLease(started.run.id, 'broadcast-integration-readiness-runner');
    await completeBroadcastRecoveryOperation({
      id: op!.id,
      runnerId: 'broadcast-integration-readiness-runner',
      broadcastRunId: started.run.id,
      leaseGeneration: Number(lease?.lease_generation),
      recoveryMode: 'fresh',
    });
    expect((await query(`select status from broadcast_runs where id=$1`, [started.run.id])).rows[0].status).toBe(
      'running',
    );
    expect((await query(`select status from broadcast_playlists where id=$1`, [playlistId])).rows[0].status).toBe(
      'running',
    );
  });

  it('does not complete start readiness with an expired lease', async () => {
    const { playlistId } = await fixture();
    const started = await requestBroadcastStart({ playlistId, requestedBy: 'broadcast-integration' });
    const op = await claimBroadcastRecoveryOperation('broadcast-integration-expired-lease');
    const lease = await acquireRunnerLease(started.run.id, 'broadcast-integration-expired-lease');
    await query(
      `update broadcast_runner_leases set lease_expires_at=now()-interval '1 second' where broadcast_run_id=$1`,
      [started.run.id],
    );
    await expect(
      completeBroadcastRecoveryOperation({
        id: op!.id,
        runnerId: 'broadcast-integration-expired-lease',
        broadcastRunId: started.run.id,
        leaseGeneration: Number(lease?.lease_generation),
        recoveryMode: 'fresh',
      }),
    ).rejects.toThrow(/recovery-lease-expired/);
    expect((await query(`select status from broadcast_recovery_operations where id=$1`, [op!.id])).rows[0].status).toBe(
      'claimed',
    );
    expect((await query(`select status from broadcast_runs where id=$1`, [started.run.id])).rows[0].status).toBe(
      'starting',
    );
  });

  it('rejects wrong lease generation during start readiness', async () => {
    const { playlistId } = await fixture();
    const started = await requestBroadcastStart({ playlistId, requestedBy: 'broadcast-integration' });
    const op = await claimBroadcastRecoveryOperation('broadcast-integration-wrong-generation');
    const lease = await acquireRunnerLease(started.run.id, 'broadcast-integration-wrong-generation');
    await expect(
      completeBroadcastRecoveryOperation({
        id: op!.id,
        runnerId: 'broadcast-integration-wrong-generation',
        broadcastRunId: started.run.id,
        leaseGeneration: Number(lease?.lease_generation) + 1,
        recoveryMode: 'fresh',
      }),
    ).rejects.toThrow(/recovery-lease-expired/);
    expect((await query(`select status from broadcast_runs where id=$1`, [started.run.id])).rows[0].status).toBe(
      'starting',
    );
  });

  it('does not restart an already stopped run during start readiness', async () => {
    const { playlistId } = await fixture();
    const started = await requestBroadcastStart({ playlistId, requestedBy: 'broadcast-integration' });
    const op = await claimBroadcastRecoveryOperation('broadcast-integration-stopped-run');
    const lease = await acquireRunnerLease(started.run.id, 'broadcast-integration-stopped-run');
    await query(`update broadcast_runs set status='stopped' where id=$1`, [started.run.id]);
    await expect(
      completeBroadcastRecoveryOperation({
        id: op!.id,
        runnerId: 'broadcast-integration-stopped-run',
        broadcastRunId: started.run.id,
        leaseGeneration: Number(lease?.lease_generation),
        recoveryMode: 'fresh',
      }),
    ).rejects.toThrow(/recovery-state-mismatch/);
    expect((await query(`select status from broadcast_runs where id=$1`, [started.run.id])).rows[0].status).toBe(
      'stopped',
    );
  });

  it('atomically moves run, playlist, and playback to running', async () => {
    const { playlistId } = await fixture();
    const started = await requestBroadcastStart({ playlistId, requestedBy: 'broadcast-integration' });
    const op = await claimBroadcastRecoveryOperation('broadcast-integration-atomic-running');
    const lease = await acquireRunnerLease(started.run.id, 'broadcast-integration-atomic-running');
    const completed = await completeBroadcastRecoveryOperation({
      id: op!.id,
      runnerId: 'broadcast-integration-atomic-running',
      broadcastRunId: started.run.id,
      leaseGeneration: Number(lease?.lease_generation),
      recoveryMode: 'fresh',
    });
    expect(completed?.status).toBe('completed');
    const state = (
      await query(
        `select r.status run_status,p.status playlist_status,ps.state->>'status' playback_status,ps.state_revision from broadcast_runs r join broadcast_playlists p on p.id=r.playlist_id cross join playback_state ps where r.id=$1 and ps.id=true`,
        [started.run.id],
      )
    ).rows[0];
    expect(state).toMatchObject({ run_status: 'running', playlist_status: 'running', playback_status: 'running' });
    expect(Number(state.state_revision)).toBe(2);
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

  it('finalizes unexpected item errors exactly once', async () => {
    const f = await fixture();
    const started = await requestBroadcastStart({ playlistId: f.playlistId, requestedBy: 'broadcast-integration' });
    const obs = {
      ensureConnectedWithRetry: async () => undefined,
      ensureMainNewsScene: async () => undefined,
      pauseMedia: async () => undefined,
      stopMedia: async () => undefined,
      playTestContribution: async (opts: any) => {
        await opts.onState?.({ status: 'playing' });
        throw new Error('obs-test-failure');
      },
    };
    const runner = new BroadcastRunner({
      obs: obs as any,
      playlistId: f.playlistId,
      overlayUrl: 'http://overlay.test',
      runnerId: 'broadcast-integration-error-runner',
      pollMs: 10,
      maintenanceDelayMs: 0,
    });

    await expect(runner.start()).rejects.toThrow(/obs-test-failure/);

    expect((await query(`select status from broadcast_items where id=$1`, [f.itemId])).rows[0].status).toBe('error');
    expect((await query(`select status from broadcast_runs where id=$1`, [started.run.id])).rows[0].status).toBe(
      'error',
    );
    expect((await query(`select status from broadcast_playlists where id=$1`, [f.playlistId])).rows[0].status).toBe(
      'error',
    );
    expect((await getPlaybackSnapshot()).status).toBe('error');
    expect(
      (
        await query(
          `select count(*)::int count from live_events where broadcast_run_id=$1 and type='broadcast-error'`,
          [started.run.id],
        )
      ).rows[0].count,
    ).toBe(1);
    expect(
      (
        await query(
          `select count(*)::int count from live_events where broadcast_run_id=$1 and type='broadcast-stopped'`,
          [started.run.id],
        )
      ).rows[0].count,
    ).toBe(0);
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
    await query(
      `update broadcast_recovery_operations set operation_type='recover',previous_runner_id=$2,previous_lease_generation=$3 where id=$1`,
      [r.started.operation.id, r.runnerId, r.leaseGeneration],
    );
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

  it('recovers a running broadcast while preserving position and command sequence and emits exactly one event', async () => {
    const r = await startedRun();
    await query(`update broadcast_runs set status='running' where id=$1`, [r.started.run.id]);
    await query(`update broadcast_playlists set status='running',current_position=3 where id=$1`, [r.playlistId]);
    await query(
      `update playback_state set state=state || $1::jsonb,state_revision=5,command_sequence=9,media_position_ms=1234,obs_media_status='playing' where id=true`,
      [JSON.stringify({ status: 'running', position: 3, itemId: r.itemId, articleId: r.articleId, commandSeq: 9 })],
    );
    await query(
      `update broadcast_runner_leases set lease_expires_at=now()-interval '1 second' where broadcast_run_id=$1`,
      [r.started.run.id],
    );
    await query(
      `update broadcast_recovery_operations set operation_type='recover',previous_runner_id=$2,previous_lease_generation=$3 where id=$1`,
      [r.started.operation.id, r.runnerId, r.leaseGeneration],
    );
    const op = await claimBroadcastRecoveryOperation('broadcast-integration-runner-2');
    const lease = await acquireRunnerLease(r.started.run.id, 'broadcast-integration-runner-2');
    const completed = await completeBroadcastRecoveryOperation({
      id: op!.id,
      runnerId: 'broadcast-integration-runner-2',
      broadcastRunId: r.started.run.id,
      leaseGeneration: Number(lease?.lease_generation),
      recoveryMode: 'resumed',
    });
    expect(completed?.status).toBe('completed');
    const snap = await getPlaybackSnapshot();
    expect(snap).toMatchObject({
      status: 'running',
      position: 3,
      itemId: r.itemId,
      articleId: r.articleId,
      commandSeq: 9,
    });
    expect(snap.stateRevision).toBe(6);
    expect(snap.mediaPositionMs).toBe(1234);
    expect(
      (
        await query(
          `select count(*)::int count from live_events where broadcast_run_id=$1 and type='broadcast-recovered'`,
          [r.started.run.id],
        )
      ).rows[0].count,
    ).toBe(1);
    await expect(
      completeBroadcastRecoveryOperation({
        id: op!.id,
        runnerId: 'broadcast-integration-runner-2',
        broadcastRunId: r.started.run.id,
        leaseGeneration: Number(lease?.lease_generation),
        recoveryMode: 'resumed',
      }),
    ).rejects.toThrow(/recovery-operation-conflict/);
    expect(
      (
        await query(
          `select count(*)::int count from live_events where broadcast_run_id=$1 and type='broadcast-recovered'`,
          [r.started.run.id],
        )
      ).rows[0].count,
    ).toBe(1);
  });

  it('recovers a paused broadcast and remains paused', async () => {
    const r = await startedRun();
    await query(`update broadcast_runs set status='paused' where id=$1`, [r.started.run.id]);
    await query(`update broadcast_playlists set status='paused' where id=$1`, [r.playlistId]);
    await query(`update playback_state set state=state || '{"status":"paused"}'::jsonb where id=true`);
    await query(
      `update broadcast_runner_leases set lease_expires_at=now()-interval '1 second' where broadcast_run_id=$1`,
      [r.started.run.id],
    );
    await query(
      `update broadcast_recovery_operations set operation_type='recover',previous_runner_id=$2,previous_lease_generation=$3 where id=$1`,
      [r.started.operation.id, r.runnerId, r.leaseGeneration],
    );
    const op = await claimBroadcastRecoveryOperation('broadcast-integration-paused-runner-2');
    const lease = await acquireRunnerLease(r.started.run.id, 'broadcast-integration-paused-runner-2');
    await completeBroadcastRecoveryOperation({
      id: op!.id,
      runnerId: 'broadcast-integration-paused-runner-2',
      broadcastRunId: r.started.run.id,
      leaseGeneration: Number(lease?.lease_generation),
      recoveryMode: 'resumed',
    });
    expect((await getPlaybackSnapshot()).status).toBe('paused');
  });

  it('honors next_attempt_at and requeues orphaned claimed operations after expired lease', async () => {
    const r = await startedRun();
    await query(
      `update broadcast_recovery_operations set status='pending',next_attempt_at=now()+interval '1 hour' where id=$1`,
      [r.started.operation.id],
    );
    expect(await claimBroadcastRecoveryOperation('broadcast-integration-too-early')).toBeNull();
    await query(
      `update broadcast_recovery_operations set status='claimed',new_runner_id='orphan',claimed_at=now(),next_attempt_at=null where id=$1`,
      [r.started.operation.id],
    );
    await query(
      `update broadcast_runner_leases set lease_expires_at=now()-interval '1 second' where broadcast_run_id=$1`,
      [r.started.run.id],
    );
    const op = await claimBroadcastRecoveryOperation('broadcast-integration-reclaimer');
    expect(op?.id).toBe(r.started.operation.id);
    const stored = (
      await query(`select retry_count,new_runner_id,status from broadcast_recovery_operations where id=$1`, [op!.id])
    ).rows[0];
    expect(Number(stored.retry_count)).toBe(1);
    expect(stored.new_runner_id).toBe('broadcast-integration-reclaimer');
    expect(stored.status).toBe('claimed');
  });

  it('supports takeover after an expired lease', async () => {
    const r = await startedRun();
    await query(`update broadcast_recovery_operations set operation_type='takeover' where id=$1`, [
      r.started.operation.id,
    ]);
    await query(`update broadcast_runs set status='running' where id=$1`, [r.started.run.id]);
    await query(`update broadcast_playlists set status='running' where id=$1`, [r.playlistId]);
    await query(`update playback_state set state=state || '{"status":"running"}'::jsonb where id=true`);
    await query(
      `update broadcast_runner_leases set lease_expires_at=now()-interval '1 second' where broadcast_run_id=$1`,
      [r.started.run.id],
    );
    const op = await claimBroadcastRecoveryOperation('broadcast-integration-takeover');
    const lease = await acquireRunnerLease(r.started.run.id, 'broadcast-integration-takeover');
    const completed = await completeBroadcastRecoveryOperation({
      id: op!.id,
      runnerId: 'broadcast-integration-takeover',
      broadcastRunId: r.started.run.id,
      leaseGeneration: Number(lease?.lease_generation),
      recoveryMode: 'resumed',
    });
    expect(completed?.status).toBe('completed');
  });

  it('cleans a started fixture by concrete ids and can recreate/start again', async () => {
    const first = await createBroadcastFixture({
      scope: 'broadcast-integration',
      items: 1,
      audio: true,
      overlay: true,
    });
    const firstStart = await requestBroadcastStart({
      playlistId: first.playlistId,
      requestedBy: 'broadcast-integration',
    });
    expect(firstStart.run.playlist_id).toBe(first.playlistId);
    await cleanupBroadcastFixtures('broadcast-integration', first);

    const second = await createBroadcastFixture({
      scope: 'broadcast-integration',
      items: 1,
      audio: true,
      overlay: true,
    });
    const secondStart = await requestBroadcastStart({
      playlistId: second.playlistId,
      requestedBy: 'broadcast-integration',
    });
    expect(secondStart.run.playlist_id).toBe(second.playlistId);
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
