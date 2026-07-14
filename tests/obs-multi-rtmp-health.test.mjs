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
  const profileDirectory = join(
    configRoot,
    'obs-studio',
    'basic',
    'profiles',
    'Automated_News_Studio',
  );
  const pluginPath = join(root, 'obs-multi-rtmp.so');
  const configFile = join(profileDirectory, 'obs-multi-rtmp.json');
  await mkdir(profileDirectory, { recursive: true });
  await writeFile(pluginPath, 'plugin', { mode: 0o755 });
  const key = 'live_123456789_example';
  const document = {
    targets: [
      {
        id: 'argumentationskette-twitch',
        name: 'Twitch',
        protocol: 'RTMP',
        'sync-start': true,
        'sync-stop': true,
        'service-param': {
          server: 'rtmps://live.twitch.tv:443/app',
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
    TWITCH_ENABLED: 'true',
    TWITCH_STREAM_SERVER: 'rtmps://live.twitch.tv:443/app',
    TWITCH_STREAM_KEY: key,
    OBS_PROFILE_NAME: 'Automated News Studio',
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
    expect(report.configuration).toMatchObject({
      secure: true,
      targetPresent: true,
      targetMatchesEnvironment: true,
      syncStart: true,
      syncStop: true,
      sharesMainEncoders: true,
    });
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
      expect.arrayContaining([
        expect.objectContaining({ id: 'plugin-config-permissions', status: 'error' }),
      ]),
    );
  });

  it('detects stale Twitch credentials without exposing either key', async () => {
    const setup = await fixture({ TWITCH_STREAM_KEY: 'live_987654321_replaced' });
    const report = await inspectObsMultiRtmp(setup.env, {
      configRoot: setup.configRoot,
      pluginCandidates: [setup.pluginPath],
    });
    const serialized = JSON.stringify(report);

    expect(report.ready).toBe(false);
    expect(report.configuration.targetMatchesEnvironment).toBe(false);
    expect(serialized).not.toContain(setup.key);
    expect(serialized).not.toContain(setup.env.TWITCH_STREAM_KEY);
  });

  it('reports disabled Twitch as healthy without requiring plugin files', async () => {
    const report = await inspectObsMultiRtmp({ TWITCH_ENABLED: 'false' }, { pluginCandidates: [] });
    expect(report).toMatchObject({ enabled: false, ready: true, status: 'disabled' });
  });
});
