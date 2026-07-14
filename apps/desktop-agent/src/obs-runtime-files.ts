import { chmodSync, lstatSync, mkdirSync, readdirSync, rmSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';

const PRIVATE_FILE_MODE = 0o600;
const PRIVATE_DIRECTORY_MODE = 0o700;

export function writePrivatePidFile(path: string, pid: number) {
  mkdirSync(dirname(path), { recursive: true, mode: PRIVATE_DIRECTORY_MODE });
  chmodSync(dirname(path), PRIVATE_DIRECTORY_MODE);
  writeFileSync(path, String(pid), { mode: PRIVATE_FILE_MODE });
  chmodSync(path, PRIVATE_FILE_MODE);
}

export function clearPrivatePidFile(path: string) {
  try {
    rmSync(path, { force: true });
  } catch {}
}

function positiveAge(value: number) {
  return Number.isFinite(value) && value >= 0 ? value : 1000;
}

export function cleanupStaleObsArtifacts(options: {
  configRoot: string;
  runningObsPids?: number[];
  minimumAgeMs?: number;
  nowMs?: number;
}) {
  const runningObsPids = (options.runningObsPids ?? []).filter((pid) => Number.isInteger(pid) && pid > 0);
  if (runningObsPids.length) {
    return { removed: [] as string[], skippedFresh: [] as string[], skippedBecauseObsRuns: true };
  }

  const minimumAgeMs = positiveAge(options.minimumAgeMs ?? 1000);
  const nowMs = options.nowMs ?? Date.now();
  const candidates: string[] = [];
  const sentinelDirectory = join(options.configRoot, '.sentinel');
  try {
    for (const entry of readdirSync(sentinelDirectory)) {
      if (entry.startsWith('run_')) candidates.push(join(sentinelDirectory, entry));
    }
  } catch {}
  for (const entry of ['SingletonCookie', 'SingletonLock', 'SingletonSocket']) {
    candidates.push(join(options.configRoot, 'plugin_config', 'obs-browser', entry));
  }

  const removed: string[] = [];
  const skippedFresh: string[] = [];
  for (const path of candidates) {
    try {
      const metadata = lstatSync(path);
      if (Math.max(0, nowMs - metadata.mtimeMs) < minimumAgeMs) {
        skippedFresh.push(path);
        continue;
      }
      rmSync(path, { force: true, recursive: metadata.isDirectory() && !metadata.isSymbolicLink() });
      removed.push(path);
    } catch {}
  }
  return { removed, skippedFresh, skippedBecauseObsRuns: false };
}

export { PRIVATE_DIRECTORY_MODE, PRIVATE_FILE_MODE };
