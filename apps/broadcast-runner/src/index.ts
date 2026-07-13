import dotenv from 'dotenv';
import pino from 'pino';
import { BroadcastRunner } from '@ans/broadcast-engine';
import { ObsController } from '@ans/obs-controller';
import {
  activeBroadcastRun,
  claimBroadcastRecoveryOperation,
  closeDatabase,
  findRecoverableBroadcastRun,
  publishedMainOverlayUrl,
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
  const run = recovery
    ? { id: recovery.broadcast_run_id, playlist_id: (await findRecoverableBroadcastRun())?.playlist_id }
    : ((await activeBroadcastRun()) ?? (await findRecoverableBroadcastRun()));
  if (!run) return false;
  active = new BroadcastRunner({
    obs: makeObs(),
    playlistId: run.playlist_id,
    overlayUrl: await overlayUrl(),
    recoverRunId: run.id,
    runnerId,
  });
  log.info({ runId: run.id, recoveryOperationId: recovery?.id }, 'starting broadcast runner loop');
  try {
    await active.start();
  } finally {
    active = null;
  }
  return true;
}
async function main() {
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
  await closeDatabase().catch(() => undefined);
}
void main();
