import { chmod, lstat, mkdir, mkdtemp, readFile, rm, utimes, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';
import {
  cleanupStaleObsArtifacts,
  clearPrivatePidFile,
  writePrivatePidFile,
} from '../apps/desktop-agent/src/obs-runtime-files.js';

const temporaryDirectories: string[] = [];

async function createConfigRoot() {
  const root = await mkdtemp(join(tmpdir(), 'obs-runtime-files-'));
  temporaryDirectories.push(root);
  const configRoot = join(root, 'obs-studio');
  await mkdir(join(configRoot, '.sentinel'), { recursive: true });
  await mkdir(join(configRoot, 'plugin_config', 'obs-browser'), { recursive: true });
  return { root, configRoot };
}

afterEach(async () => {
  await Promise.all(temporaryDirectories.splice(0).map((path) => rm(path, { recursive: true, force: true })));
});

describe('OBS runtime file safety', () => {
  it('removes only artifacts older than the configured minimum age', async () => {
    const { configRoot } = await createConfigRoot();
    const staleSentinel = join(configRoot, '.sentinel', 'run_stale');
    const freshSentinel = join(configRoot, '.sentinel', 'run_fresh');
    const staleLock = join(configRoot, 'plugin_config', 'obs-browser', 'SingletonLock');
    await writeFile(staleSentinel, 'stale');
    await writeFile(freshSentinel, 'fresh');
    await writeFile(staleLock, 'stale-lock');
    await utimes(staleSentinel, new Date(1_000), new Date(1_000));
    await utimes(staleLock, new Date(1_000), new Date(1_000));
    await utimes(freshSentinel, new Date(9_500), new Date(9_500));

    const result = cleanupStaleObsArtifacts({
      configRoot,
      nowMs: 10_000,
      minimumAgeMs: 1_000,
    });

    expect(result.removed).toEqual(expect.arrayContaining([staleSentinel, staleLock]));
    expect(result.skippedFresh).toEqual([freshSentinel]);
    await expect(lstat(staleSentinel)).rejects.toMatchObject({ code: 'ENOENT' });
    await expect(lstat(staleLock)).rejects.toMatchObject({ code: 'ENOENT' });
    expect((await lstat(freshSentinel)).isFile()).toBe(true);
  });

  it('never removes runtime artifacts while an OBS process is reported as running', async () => {
    const { configRoot } = await createConfigRoot();
    const sentinel = join(configRoot, '.sentinel', 'run_active');
    await writeFile(sentinel, 'active');
    await utimes(sentinel, new Date(1_000), new Date(1_000));

    const result = cleanupStaleObsArtifacts({
      configRoot,
      runningObsPids: [4242],
      nowMs: 10_000,
      minimumAgeMs: 1_000,
    });

    expect(result).toEqual({ removed: [], skippedFresh: [], skippedBecauseObsRuns: true });
    expect((await lstat(sentinel)).isFile()).toBe(true);
  });

  it('writes PID files and their parent directory with owner-only permissions', async () => {
    const { root } = await createConfigRoot();
    const pidFile = join(root, 'runtime', 'obs.pid');
    writePrivatePidFile(pidFile, 12345);

    expect(await readFile(pidFile, 'utf8')).toBe('12345');
    expect((await lstat(pidFile)).mode & 0o777).toBe(0o600);
    expect((await lstat(join(root, 'runtime'))).mode & 0o777).toBe(0o700);

    await chmod(pidFile, 0o644);
    writePrivatePidFile(pidFile, 67890);
    expect((await lstat(pidFile)).mode & 0o777).toBe(0o600);
    clearPrivatePidFile(pidFile);
    await expect(lstat(pidFile)).rejects.toMatchObject({ code: 'ENOENT' });
  });
});
