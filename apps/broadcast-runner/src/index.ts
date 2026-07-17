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
  getAutopilotConfig,
  publishedMainOverlayUrl,
  query,
  releaseOrRetryBroadcastRecoveryOperation,
  releaseRunnerLease,
} from '@ans/database';
import { getApprovedArticleVisuals } from '@ans/database/article-media';
import { resolveOperationalNotification, upsertOperationalNotification } from '@ans/database/notifications';
import { installArticleVisualResolver } from '../../../packages/obs-controller/src/article-visual-resolver.js';
import { boundedRunnerNumber } from './runtime-values.js';
import { ObsConnectionRecovery } from './obs-connection-recovery.js';

dotenv.config();
installArticleVisualResolver(async (articleId) => ({
  ...(await getApprovedArticleVisuals(articleId)),
  videoRequired: (await getAutopilotConfig()).requireVideo,
}));
const log = pino({ name: 'broadcast-runner', level: process.env.LOG_LEVEL ?? 'info' });
let stopping = false;
let active: BroadcastRunner | null = null;
let loopActive = false;
let lastSuccessfulOperationPollAt: string | null = null;
const sharedObs = makeObs();
const sleep = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms));
const RUNNER_FAILURE_KEY = 'broadcast-runner:iteration';
const RUNNER_OBS_KEY = 'broadcast-runner:obs-connection';
const obsConnectionRecovery = new ObsConnectionRecovery(sharedObs, {
  reconnectIntervalMs: boundedRunnerNumber(process.env.BROADCAST_RUNNER_OBS_RECONNECT_MS, 5000, 1000, 60_000),
  onConnected: async () => {
    await resolveOperationalNotification(RUNNER_OBS_KEY).catch((error) =>
      log.warn({ err: error }, 'unable to resolve OBS connection notification'),
    );
  },
  onFailure: async (error) => {
    const message = error instanceof Error ? error.message : String(error);
    await upsertOperationalNotification({
      level: 'error',
      component: 'broadcast-runner',
      dedupeKey: RUNNER_OBS_KEY,
      message: 'Der Broadcast-Runner konnte keine Verbindung zu OBS herstellen.',
      details: { error: message.slice(0, 1000) },
    }).catch((notificationError) =>
      log.warn({ err: notificationError }, 'unable to persist OBS connection notification'),
    );
    log.warn({ err: error }, 'OBS connection attempt failed');
  },
});
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
  const checks = { process: !stopping, postgres: false, runnerLoop: loopActive, operationPoll: false, obs: false };
  try {
    await query('select 1');
    checks.postgres = true;
  } catch {}
  checks.obs = sharedObs.getState().status === 'connected';
  checks.operationPoll =
    lastSuccessfulOperationPollAt != null &&
    Date.now() - Date.parse(lastSuccessfulOperationPollAt) <
      boundedRunnerNumber(process.env.BROADCAST_RUNNER_OPERATION_POLL_STALE_MS, 10_000, 1000, 300_000);
  const ready = Object.values(checks).every(Boolean);
  return { ready, checks, activeRun: active != null, stopping };
}

function startHealthServer() {
  const port = boundedRunnerNumber(process.env.BROADCAST_RUNNER_STATUS_PORT, 12_100, 1, 65_535);
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
    port: boundedRunnerNumber(process.env.OBS_PORT, 4455, 1, 65_535),
    password: process.env.OBS_PASSWORD,
    overlayUrl: process.env.PUBLIC_OVERLAY_URL,
  });
}
async function runOnce() {
  const runnerId = process.env.BROADCAST_RUNNER_ID ?? `runner-${process.pid}`;
  const recovery = await claimBroadcastRecoveryOperation(runnerId)
    .then((operation) => {
      lastSuccessfulOperationPollAt = new Date().toISOString();
      return operation;
    })
    .catch((e) => {
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
    obs: sharedObs,
    playlistId: run.playlist_id,
    overlayUrl: await overlayUrl(),
    recoverRunId: run.id,
    runnerId,
  });
  log.info({ runId: run.id, recoveryOperationId: recovery?.id }, 'starting broadcast runner loop');
  let initializedLeaseGeneration: number | null = null;
  let recoveryCompleted = false;
  try {
    const readiness = await active.initialize();
    initializedLeaseGeneration = Number(readiness.leaseGeneration);
    if (claimedRecovery) {
      const completed = await completeBroadcastRecoveryOperation({
        id: claimedRecovery.id,
        runnerId,
        broadcastRunId: run.id,
        leaseGeneration: readiness.leaseGeneration,
        recoveryMode: claimedRecovery.operation_type === 'start' ? 'fresh' : 'resumed',
        result: readiness.result,
      });
      if (!completed || completed.status !== 'completed') {
        throw new Error('recovery-operation-conflict');
      }
      recoveryCompleted = true;
    }
    await active.run();
  } catch (error) {
    if (claimedRecovery && !recoveryCompleted) {
      if (initializedLeaseGeneration != null) {
        await active
          .shutdown()
          .catch((shutdownError) =>
            log.warn({ err: shutdownError }, 'runner shutdown after recovery completion failure failed'),
          );
        await releaseRunnerLease(run.id, runnerId, initializedLeaseGeneration);
      }
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
async function resolveRunnerNotification(key: string, description: string) {
  await resolveOperationalNotification(key).catch((error) => log.warn({ err: error }, description));
}
async function main() {
  const healthServer = startHealthServer();
  await obsConnectionRecovery.maintain();
  loopActive = true;
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
      await obsConnectionRecovery.maintain();
      const worked = await runOnce();
      await resolveRunnerNotification(RUNNER_FAILURE_KEY, 'unable to resolve runner failure notification');
      if (!worked) await sleep(boundedRunnerNumber(process.env.BROADCAST_RUNNER_IDLE_MS, 1000, 100, 60_000));
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      await upsertOperationalNotification({
        level: 'error',
        component: 'broadcast-runner',
        dedupeKey: RUNNER_FAILURE_KEY,
        message: 'Der Broadcast-Runner ist bei der Verarbeitung einer Sendung fehlgeschlagen.',
        details: { error: message.slice(0, 1000) },
      }).catch((notificationError) =>
        log.warn({ err: notificationError }, 'unable to persist runner failure notification'),
      );
      log.error({ err: error }, 'runner iteration failed');
      await sleep(boundedRunnerNumber(process.env.BROADCAST_RUNNER_RESTART_MS, 2000, 250, 300_000));
    }
  }
  loopActive = false;
  await active?.shutdown().catch(() => undefined);
  await sharedObs.disconnect().catch(() => undefined);
  await new Promise<void>((resolve) => healthServer.close(() => resolve())).catch(() => undefined);
  await closeDatabase().catch(() => undefined);
}
void main();
