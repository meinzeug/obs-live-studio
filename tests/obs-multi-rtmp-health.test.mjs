import { chmod, mkdir, mkdtemp, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';
import { inspectObsMultiRtmp } from '../scripts/obs-multi-rtmp-health.mjs';

const temporaryDirectories = [];

afterEach(async () => {
  await Promise.all(temporaryDirectories.splice(0).map((path) => rm(path, { recursive: true, force: true })));
});

async function fixture(overrides = {}) {
  const root = await mkdtemp(join(tmpdir(), 'obs-multi-rtmp-health-'));
  temporaryDirectories.push(root);
  const configRoot = join(root, 'config');
  const profileDirectory = join(configRoot, 'obs-studio', 'basic', 'profiles', 'Open_TV_Studio');
  const pluginPath = join(root, 'obs-multi-rtmp.so');
  const configFile = join(profileDirectory, 'obs-multi-rtmp.json');
  await mkdir(profileDirectory, { recursive: true });
  await writeFile(pluginPath, 'plugin', { mode: 0o755 });
  const key = 'live_123456789_example';
  const document = {
    targets: [
      {
        id: 'studio-target-rumble',
        name: 'Rumble',
        protocol: 'RTMP',
        'sync-start': true,
        'sync-stop': true,
        'service-param': {
          server: 'rtmps://rumble.example.invalid/live',
          key,
          use_auth: false,
        },
        'output-param': {},
      },
    ],
    video_configs: [],
    audio_configs: [],
  };
  await writeFile(configFile, `${JSON.stringify(document)}\n`, { mode: 0o600 });
  const env = {
    STREAM_TARGETS_JSON: JSON.stringify([
      { id: 'rumble', platform: 'rumble', serverEnv: 'RUMBLE_SERVER', keyEnv: 'RUMBLE_KEY' },
    ]),
    RUMBLE_SERVER: 'rtmps://rumble.example.invalid/live',
    RUMBLE_KEY: key,
    OBS_PROFILE_NAME: 'Open TV Studio',
    ...overrides,
  };
  return { root, configRoot, pluginPath, configFile, env, key };
}

describe('obs-multi-rtmp runtime health', () => {
  it('accepts a protected, synchronized target sharing the main encoders', async () => {
    const setup = await fixture();
    const report = await inspectObsMultiRtmp(setup.env, {
      homeDir: setup.root,
      configRoot: setup.configRoot,
      pluginCandidates: [setup.pluginPath],
    });

    expect(report.ready).toBe(true);
    expect(report.status).toBe('ready');
    expect(report.plugin.installed).toBe(true);
    expect(report.configuration).toMatchObject({ secure: true, exists: true });
    expect(report.targets).toEqual([
      expect.objectContaining({
        id: 'rumble',
        present: true,
        matchesEnvironment: true,
        syncStart: true,
        syncStop: true,
        sharesMainEncoders: true,
        ready: true,
      }),
    ]);
    expect(JSON.stringify(report)).not.toContain(setup.key);
  });

  it('rejects configuration files readable by other users', async () => {
    const setup = await fixture();
    await chmod(setup.configFile, 0o644);
    const report = await inspectObsMultiRtmp(setup.env, {
      configRoot: setup.configRoot,
      pluginCandidates: [setup.pluginPath],
    });

    expect(report.ready).toBe(false);
    expect(report.configuration.secure).toBe(false);
    expect(report.checks).toEqual(
      expect.arrayContaining([expect.objectContaining({ id: 'plugin-config-permissions', status: 'error' })]),
    );
  });

  it('detects stale credentials without exposing either key', async () => {
    const setup = await fixture({ RUMBLE_KEY: 'live_987654321_replaced' });
    const report = await inspectObsMultiRtmp(setup.env, {
      configRoot: setup.configRoot,
      pluginCandidates: [setup.pluginPath],
    });
    const serialized = JSON.stringify(report);

    expect(report.ready).toBe(false);
    expect(report.targets[0].matchesEnvironment).toBe(false);
    expect(serialized).not.toContain(setup.key);
    expect(serialized).not.toContain(setup.env.RUMBLE_KEY);
  });

  it('reports disabled multistream as healthy without requiring plugin files', async () => {
    const report = await inspectObsMultiRtmp(
      { STREAM_TARGETS_JSON: '[]', TWITCH_ENABLED: 'false' },
      { pluginCandidates: [] },
    );
    expect(report).toMatchObject({ enabled: false, ready: true, status: 'disabled' });
  });
});
