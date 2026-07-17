import { execFile } from 'node:child_process';
import { lstat, mkdir, mkdtemp, readFile, readdir, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { promisify } from 'node:util';
import { afterEach, describe, expect, it } from 'vitest';

const execFileAsync = promisify(execFile);
const temporaryDirectories: string[] = [];

afterEach(async () => {
  await Promise.all(temporaryDirectories.splice(0).map((path) => rm(path, { recursive: true, force: true })));
});

describe('obs-multi-rtmp configuration command', () => {
  it('backs up and repairs a malformed plugin file while saving a target', async () => {
    const root = await mkdtemp(join(tmpdir(), 'obs-multi-rtmp-save-'));
    temporaryDirectories.push(root);
    const xdgConfigHome = join(root, 'config');
    const profileDirectory = join(xdgConfigHome, 'obs-studio', 'basic', 'profiles', 'Open_TV_Studio');
    const configFile = join(profileDirectory, 'obs-multi-rtmp.json');
    const malformed = '{"targets":[';
    await mkdir(profileDirectory, { recursive: true });
    await writeFile(configFile, malformed, { mode: 0o600 });
    await writeFile(join(root, '.env'), 'STREAM_SERVICE=youtube\n', { mode: 0o600 });

    const targetKey = 'twitch-secret-key-123';
    const { stderr } = await execFileAsync(process.execPath, ['scripts/configure-obs-multi-rtmp.mjs'], {
      cwd: resolve('.'),
      env: {
        ...process.env,
        HOME: root,
        XDG_CONFIG_HOME: xdgConfigHome,
        OBS_LIVE_STUDIO_ROOT: root,
        STREAM_PLATFORM: 'youtube',
        STREAM_SERVER: 'rtmps://a.rtmps.youtube.com:443/live2',
        STREAM_KEY: 'youtube-secret-key-123',
        STREAM_TARGETS_JSON: JSON.stringify([
          {
            id: 'twitch',
            name: 'Twitch',
            platform: 'twitch',
            server: 'rtmps://live.twitch.tv:443/app',
            key: targetKey,
            enabled: true,
            syncStart: true,
            syncStop: true,
          },
        ]),
      },
    });

    const repaired = JSON.parse(await readFile(configFile, 'utf8'));
    expect(repaired.targets[0]).toMatchObject({
      id: 'studio-target-twitch',
      name: 'Twitch',
      'sync-start': true,
      'sync-stop': true,
    });
    expect(repaired.targets[0]['service-param'].key).toBe(targetKey);
    expect(stderr).toContain('beschädigte obs-multi-rtmp-Konfiguration wurde gesichert und repariert');
    expect(await readFile(join(root, '.env'), 'utf8')).toContain('STREAM_SERVICE=youtube+multistream');
    expect((await lstat(configFile)).mode & 0o777).toBe(0o600);

    const backupDirectories = await readdir(join(root, 'var', 'backups'));
    expect(backupDirectories).toHaveLength(1);
    const backupFile = join(
      root,
      'var',
      'backups',
      backupDirectories[0],
      'files',
      'basic',
      'profiles',
      'Open_TV_Studio',
      'obs-multi-rtmp.json',
    );
    expect(await readFile(backupFile, 'utf8')).toBe(malformed);
  });
});
