import { chmod, mkdir, mkdtemp, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';
import { ObsController } from '@ans/obs-controller';
import { inspectTwitchRuntime, installTwitchStreamPreflight } from '../apps/api/src/twitch-preflight.js';

const temporaryDirectories: string[] = [];

async function createRuntime(overrides: Record<string, string> = {}) {
  const root = await mkdtemp(join(tmpdir(), 'twitch-api-preflight-'));
  temporaryDirectories.push(root);
  const configRoot = join(root, 'config');
  const plugin = join(root, 'obs-multi-rtmp.so');
  const profile = 'Automated_News_Studio';
  const profileDir = join(configRoot, 'obs-studio', 'basic', 'profiles', profile);
  const key = 'live_1234567890_secure';
  await mkdir(profileDir, { recursive: true });
  await writeFile(plugin, 'plugin');
  const configuration = {
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
  const configFile = join(profileDir, 'obs-multi-rtmp.json');
  await writeFile(configFile, `${JSON.stringify(configuration)}\n`, { mode: 0o600 });
  await chmod(configFile, 0o600);
  return {
    root,
    configRoot,
    plugin,
    configFile,
    env: {
      TWITCH_ENABLED: 'true',
      TWITCH_STREAM_SERVER: 'rtmps://live.twitch.tv:443/app',
      TWITCH_STREAM_KEY: key,
      OBS_PROFILE_NAME: 'Automated News Studio',
      XDG_CONFIG_HOME: configRoot,
      OBS_MULTI_RTMP_PLUGIN_PATH: plugin,
      ...overrides,
    },
  };
}

function createController(calls: string[]) {
  return new ObsController({
    host: '127.0.0.1',
    port: 4455,
    streamStartTimeoutMs: 0,
    client: {
      connect: async () => undefined,
      disconnect: async () => undefined,
      call: async (requestType: string) => {
        calls.push(requestType);
        if (requestType === 'GetStreamStatus') return { outputActive: calls.includes('StartStream') };
        return {};
      },
    },
  });
}

afterEach(async () => {
  await Promise.all(temporaryDirectories.splice(0).map((path) => rm(path, { recursive: true, force: true })));
});

describe('API Twitch runtime preflight', () => {
  it('accepts a synchronized target that shares the main encoders', async () => {
    const runtime = await createRuntime();
    const report = await inspectTwitchRuntime(runtime.env, {
      configRoot: runtime.configRoot,
      pluginCandidates: [runtime.plugin],
    });

    expect(report).toMatchObject({
      enabled: true,
      ready: true,
      status: 'ready',
      pluginInstalled: true,
      configurationSecure: true,
      configurationOwnedByProcess: true,
      targetPresent: true,
      targetMatchesEnvironment: true,
      syncStart: true,
      syncStop: true,
      sharesMainEncoders: true,
    });
    expect(JSON.stringify(report)).not.toContain(runtime.env.TWITCH_STREAM_KEY);
  });

  it('reports a changed stream key without exposing either key', async () => {
    const runtime = await createRuntime({ TWITCH_STREAM_KEY: 'live_different_123456' });
    const report = await inspectTwitchRuntime(runtime.env, {
      configRoot: runtime.configRoot,
      pluginCandidates: [runtime.plugin],
    });
    const serialized = JSON.stringify(report);

    expect(report.ready).toBe(false);
    expect(report.targetMatchesEnvironment).toBe(false);
    expect(serialized).not.toContain(runtime.env.TWITCH_STREAM_KEY);
    expect(serialized).not.toContain('live_1234567890_secure');
  });

  it('rejects a plugin configuration readable by other users', async () => {
    const runtime = await createRuntime();
    await chmod(runtime.configFile, 0o644);
    const report = await inspectTwitchRuntime(runtime.env, {
      configRoot: runtime.configRoot,
      pluginCandidates: [runtime.plugin],
    });

    expect(report.ready).toBe(false);
    expect(report.configurationSecure).toBe(false);
    expect(report.checks).toEqual(
      expect.arrayContaining([expect.objectContaining({ id: 'plugin-config-permissions', status: 'error' })]),
    );
  });

  it('blocks OBS before any websocket start call when Twitch is unhealthy', async () => {
    const runtime = await createRuntime({ TWITCH_STREAM_KEY: 'live_different_123456' });
    const calls: string[] = [];
    const restore = installTwitchStreamPreflight({
      environmentProvider: () => runtime.env,
      inspectOptionsProvider: () => ({
        configRoot: runtime.configRoot,
        pluginCandidates: [runtime.plugin],
      }),
    });
    const controller = createController(calls);

    try {
      await expect(controller.startStream()).rejects.toThrow('Twitch-Vorabprüfung fehlgeschlagen');
      expect(calls).toEqual([]);
    } finally {
      restore();
    }
  });

  it('keeps YouTube-only streaming unaffected when Twitch is disabled', async () => {
    const calls: string[] = [];
    const restore = installTwitchStreamPreflight({
      environmentProvider: () => ({ TWITCH_ENABLED: 'false' }),
      inspectOptionsProvider: () => ({ pluginCandidates: [] }),
    });
    const controller = createController(calls);

    try {
      const result = await controller.startStream();
      expect(result.outputActive).toBe(true);
      expect(calls).toEqual(['GetStreamStatus', 'StartStream', 'GetStreamStatus']);
    } finally {
      restore();
    }
  });
});
