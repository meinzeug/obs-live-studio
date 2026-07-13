import http from 'node:http';
import dotenv from 'dotenv';
import pino from 'pino';
import { BroadcastRunner } from '@ans/broadcast-engine';
import { ObsController } from '@ans/obs-controller';
import {
  activeBroadcastRun,
  claimBroadcastRecoveryOperation,
  closeDatabase,
  completeBroadcastRecoveryOperation,
  failBroadcastRecoveryOperation,
  getBroadcastRecoveryOperation,
  getBroadcastRun,
  publishedMainOverlayUrl,
  query,
  releaseOrRetryBroadcastRecoveryOperation,
} from '@ans/database';

dotenv.config();
const log = pino({ name: 'broadcast-runner', level: process.env.LOG_LEVEL ?? 'info' });
let stopping = false;
let active: BroadcastRunner | null = null;
const sleep = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms));
function publicBaseUrl() {
  return (
    process.env.PUBLIC_APP_URL ??
    `http://${process.env.APP_PUBLIC_HOST ?? '127.0.0.1'}:${process.env.APP_PORT ?? 12000}`
  );
}
async function overlayUrl() {
  const published = await publishedMainOverlayUrl();
  if (published) return published.startsWith('http') ? published : `${publicBaseUrl()}${published}`;
  throw new Error('Kein veröffentlichtes Hauptoverlay für den Broadcast-Runner gefunden');
}

async function readinessStatus() {
  const checks = { process: true, postgres: false, obs: false, recoveryClaimable: false };
  try {
    await query('select 1');
    checks.postgres = true;
  } catch {}
  const obs = makeObs();
  try {
    await obs.ensureConnectedWithRetry(1);
    checks.obs = obs.getState().status === 'connected';
  } catch {
    checks.obs = false;
  }
  try {
    await query(`select id from broadcast_recovery_operations where status='pending' order by created_at asc limit 1`);
    checks.recoveryClaimable = true;
  } catch {}
  const ready = Object.values(checks).every(Boolean);
  return { ready, checks, activeRun: active != null, stopping };
}

function startHealthServer() {
  const port = Number(process.env.BROADCAST_RUNNER_STATUS_PORT ?? 12100);
  const server = http.createServer((req, res) => {
    const url = new URL(req.url ?? '/', `http://${req.headers.host ?? '127.0.0.1'}`);
    if (url.pathname !== '/ready' && url.pathname !== '/health') {
      res.writeHead(404).end();
      return;
    }
    void readinessStatus()
      .then((status) => {
        res.writeHead(status.ready ? 200 : 503, { 'content-type': 'application/json' });
        res.end(JSON.stringify(status));
      })
      .catch((error) => {
        res.writeHead(503, { 'content-type': 'application/json' });
        res.end(JSON.stringify({ ready: false, error: error instanceof Error ? error.message : String(error) }));
      });
  });
  server.listen(port, '127.0.0.1', () => log.info({ port }, 'broadcast runner health server listening'));
  return server;
}
function makeObs() {
  return new ObsController({
    host: process.env.OBS_HOST ?? '127.0.0.1',
    port: Number(process.env.OBS_PORT ?? 4455),
    password: process.env.OBS_PASSWORD,
    overlayUrl: process.env.PUBLIC_OVERLAY_URL,
  });
}
async function runOnce() {
  const runnerId = process.env.BROADCAST_RUNNER_ID ?? `runner-${process.pid}`;
  const recovery = await claimBroadcastRecoveryOperation(runnerId).catch((e) => {
    log.warn({ err: e }, 'recovery claim failed');
    return null;
  });
  const claimedRecovery = recovery ? await getBroadcastRecoveryOperation(recovery.id) : null;
  const run = claimedRecovery ? await getBroadcastRun(claimedRecovery.broadcast_run_id) : await activeBroadcastRun();
  if (!run) {
    if (claimedRecovery) {
      await failBroadcastRecoveryOperation({
        id: claimedRecovery.id,
        runnerId,
        error: { message: 'recovery-run-not-found' },
      });
    }
    return false;
  }
  active = new BroadcastRunner({
    obs: makeObs(),
    playlistId: run.playlist_id,
    overlayUrl: await overlayUrl(),
    recoverRunId: run.id,
    runnerId,
  });
  log.info({ runId: run.id, recoveryOperationId: recovery?.id }, 'starting broadcast runner loop');
  try {
    const readiness = await active.initialize();
    if (claimedRecovery) {
      await completeBroadcastRecoveryOperation({
        id: claimedRecovery.id,
        runnerId,
        broadcastRunId: run.id,
        leaseGeneration: readiness.leaseGeneration,
        recoveryMode: claimedRecovery.operation_type === 'start' ? 'fresh' : 'resumed',
        result: readiness.result,
      });
    }
    await active.run();
  } catch (error) {
    if (claimedRecovery) {
      const transient = error instanceof Error && /lease|timeout|connect|ECONN/.test(error.message);
      if (transient)
        await releaseOrRetryBroadcastRecoveryOperation({
          id: claimedRecovery.id,
          runnerId,
          error: { message: error.message },
        });
      else
        await failBroadcastRecoveryOperation({
          id: claimedRecovery.id,
          runnerId,
          error: { message: error instanceof Error ? error.message : String(error) },
        });
    }
    throw error;
  } finally {
    active = null;
  }
  return true;
}
async function main() {
  const healthServer = startHealthServer();
  process.on('SIGTERM', () => {
    stopping = true;
    void active?.shutdown();
    log.info('sigterm received');
  });
  process.on('SIGINT', () => {
    stopping = true;
    void active?.shutdown();
    log.info('sigint received');
  });
  while (!stopping) {
    try {
      const worked = await runOnce();
      if (!worked) await sleep(Number(process.env.BROADCAST_RUNNER_IDLE_MS ?? 1000));
    } catch (e) {
      log.error({ err: e }, 'runner iteration failed');
      await sleep(Number(process.env.BROADCAST_RUNNER_RESTART_MS ?? 2000));
    }
  }
  await new Promise<void>((resolve) => healthServer.close(() => resolve())).catch(() => undefined);
  await closeDatabase().catch(() => undefined);
}
void main();
