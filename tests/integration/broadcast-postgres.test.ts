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
