import { chmod, lstat, mkdir, mkdtemp, readFile, rm, symlink, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';
import { commitPrivateObsConfiguration } from '../scripts/obs-config-files.mjs';

const temporaryDirectories = [];

async function createFixture() {
  const root = await mkdtemp(join(tmpdir(), 'obs-config-files-'));
  temporaryDirectories.push(root);
  const configRoot = join(root, 'config', 'obs-studio');
  await mkdir(configRoot, { recursive: true, mode: 0o700 });
  await chmod(configRoot, 0o700);
  return { root, configRoot };
}

afterEach(async () => {
  await Promise.all(temporaryDirectories.splice(0).map((path) => rm(path, { recursive: true, force: true })));
});

describe('secure OBS configuration transactions', () => {
  it('backs up changed files before atomically replacing them', async () => {
    const { root, configRoot } = await createFixture();
    const target = join(configRoot, 'basic', 'profiles', 'Studio', 'service.json');
    await mkdir(join(configRoot, 'basic', 'profiles', 'Studio'), { recursive: true });
    await writeFile(target, '{"key":"old-secret"}\n', { mode: 0o644 });
    await chmod(target, 0o644);

    const result = await commitPrivateObsConfiguration({
      root,
      configRoot,
      entries: [{ path: target, content: '{"key":"new-secret"}\n' }],
      now: new Date('2026-07-14T12:00:00.000Z'),
    });

    expect(result.changed).toEqual(['basic/profiles/Studio/service.json']);
    expect(result.backupDirectory).toBeTruthy();
    expect(await readFile(target, 'utf8')).toBe('{"key":"new-secret"}\n');
    expect((await lstat(target)).mode & 0o777).toBe(0o600);
    const backupFile = join(result.backupDirectory, 'files', 'basic', 'profiles', 'Studio', 'service.json');
    expect(await readFile(backupFile, 'utf8')).toBe('{"key":"old-secret"}\n');
    expect((await lstat(backupFile)).mode & 0o777).toBe(0o600);
    expect((await lstat(join(result.backupDirectory, 'manifest.json'))).mode & 0o777).toBe(0o600);
  });

  it('backs up and repairs an unchanged file with unsafe permissions', async () => {
    const { root, configRoot } = await createFixture();
    const target = join(configRoot, 'global.ini');
    await writeFile(target, 'FirstRun=false\n', { mode: 0o644 });
    await chmod(target, 0o644);

    const result = await commitPrivateObsConfiguration({
      root,
      configRoot,
      entries: [{ path: target, content: 'FirstRun=false\n' }],
    });

    expect(result.changed).toEqual(['global.ini']);
    expect(result.backupDirectory).toBeTruthy();
    expect((await lstat(target)).mode & 0o777).toBe(0o600);
  });

  it('does not create a backup when a secure file is unchanged', async () => {
    const { root, configRoot } = await createFixture();
    const target = join(configRoot, 'user.ini');
    await writeFile(target, 'Profile=Studio\n', { mode: 0o600 });
    await chmod(target, 0o600);

    const result = await commitPrivateObsConfiguration({
      root,
      configRoot,
      entries: [{ path: target, content: 'Profile=Studio\n' }],
    });

    expect(result).toEqual({ changed: [], backupDirectory: null });
  });

  it('rejects symbolic links instead of overwriting their targets', async () => {
    const { root, configRoot } = await createFixture();
    const outside = join(root, 'outside-secret');
    const target = join(configRoot, 'service.json');
    await writeFile(outside, 'do not overwrite\n', { mode: 0o600 });
    await symlink(outside, target);

    await expect(
      commitPrivateObsConfiguration({
        root,
        configRoot,
        entries: [{ path: target, content: 'replacement\n' }],
      }),
    ).rejects.toThrow('keine reguläre Datei');
    expect(await readFile(outside, 'utf8')).toBe('do not overwrite\n');
  });
});
