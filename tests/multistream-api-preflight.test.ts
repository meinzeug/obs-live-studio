import { chmod, mkdir, mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';
import { ObsController } from '@ans/obs-controller';
import { inspectMultistreamRuntime, installMultistreamPreflight } from '../apps/api/src/multistream-preflight.js';

const temporaryDirectories: string[] = [];

async function createRuntime(overrides: Record<string, string> = {}) {
  const root = await mkdtemp(join(tmpdir(), 'multistream-api-preflight-'));
  temporaryDirectories.push(root);
  const configRoot = join(root, 'config');
  const plugin = join(root, 'obs-multi-rtmp.so');
  const profile = 'Open_TV_Studio';
  const profileDir = join(configRoot, 'obs-studio', 'basic', 'profiles', profile);
  const rumbleKey = 'rumble_key_123456';
  const xKey = 'x_key_123456';
  await mkdir(profileDir, { recursive: true });
  await writeFile(plugin, 'plugin');
  const configuration = {
    targets: [
      {
        id: 'studio-target-rumble',
        name: 'Rumble',
        protocol: 'RTMP',
        'sync-start': true,
        'sync-stop': true,
        'service-param': {
          server: 'rtmps://rumble.example.invalid/live',
          key: rumbleKey,
          use_auth: false,
        },
        'output-param': {},
      },
      {
        id: 'studio-target-x-live',
        name: 'X Live',
        protocol: 'RTMP',
        'sync-start': true,
        'sync-stop': true,
        'service-param': {
          server: 'rtmps://x.example.invalid/live',
          key: xKey,
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
  const env = {
    STREAM_PLATFORM: 'youtube',
    STREAM_KEY: 'youtube_key_123456',
    OBS_PROFILE_NAME: 'Open TV Studio',
    XDG_CONFIG_HOME: configRoot,
    OBS_MULTI_RTMP_PLUGIN_PATH: plugin,
    RUMBLE_SERVER: 'rtmps://rumble.example.invalid/live',
    RUMBLE_KEY: rumbleKey,
    X_SERVER: 'rtmps://x.example.invalid/live',
    X_KEY: xKey,
    STREAM_TARGETS_JSON: JSON.stringify([
      { id: 'rumble', platform: 'rumble', serverEnv: 'RUMBLE_SERVER', keyEnv: 'RUMBLE_KEY' },
      { id: 'x-live', platform: 'x', name: 'X Live', serverEnv: 'X_SERVER', keyEnv: 'X_KEY' },
    ]),
    ...overrides,
  };
  return { root, configRoot, plugin, configFile, env };
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

describe('generic API multistream preflight', () => {
  it('accepts multiple synchronized targets sharing the main encoders', async () => {
    const runtime = await createRuntime();
    const report = await inspectMultistreamRuntime(runtime.env, {
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
    });
    expect(report.targets).toHaveLength(2);
    expect(report.targets.every((target) => target.ready)).toBe(true);
    const serialized = JSON.stringify(report);
    expect(serialized).not.toContain(runtime.env.RUMBLE_KEY);
    expect(serialized).not.toContain(runtime.env.X_KEY);
  });

  it('accepts the UTF-8 BOM written by OBS on plugin shutdown', async () => {
    const runtime = await createRuntime();
    const content = await readFile(runtime.configFile, 'utf8');
    await writeFile(runtime.configFile, `\uFEFF${content}`, { mode: 0o600 });

    const report = await inspectMultistreamRuntime(runtime.env, {
      configRoot: runtime.configRoot,
      pluginCandidates: [runtime.plugin],
    });

    expect(report.ready).toBe(true);
    expect(report.configurationPresent).toBe(true);
  });

  it('reports a changed key without exposing either secret', async () => {
    const runtime = await createRuntime({ RUMBLE_KEY: 'different_rumble_key' });
    const report = await inspectMultistreamRuntime(runtime.env, {
      configRoot: runtime.configRoot,
      pluginCandidates: [runtime.plugin],
    });
    const rumble = report.targets.find((target) => target.id === 'rumble');
    const serialized = JSON.stringify(report);

    expect(report.ready).toBe(false);
    expect(rumble?.matchesEnvironment).toBe(false);
    expect(serialized).not.toContain(runtime.env.RUMBLE_KEY);
    expect(serialized).not.toContain('rumble_key_123456');
  });

  it('blocks OBS before websocket calls when any additional target is unhealthy', async () => {
    const runtime = await createRuntime({ X_KEY: 'different_x_key' });
    const calls: string[] = [];
    const restore = installMultistreamPreflight({
      environmentProvider: () => runtime.env,
      inspectOptionsProvider: () => ({
        configRoot: runtime.configRoot,
        pluginCandidates: [runtime.plugin],
      }),
    });
    const controller = createController(calls);

    try {
      await expect(controller.startStream()).rejects.toThrow('Multistream-Vorabprüfung fehlgeschlagen');
      expect(calls).toEqual([]);
    } finally {
      restore();
    }
  });

  it('blocks direct API streaming when the primary target is not configured', async () => {
    const calls: string[] = [];
    const restore = installMultistreamPreflight({
      environmentProvider: () => ({
        STREAM_PLATFORM: 'custom',
        STREAM_TARGETS_JSON: '[]',
        TWITCH_ENABLED: 'false',
      }),
      inspectOptionsProvider: () => ({ pluginCandidates: [] }),
    });
    const controller = createController(calls);

    try {
      await expect(controller.startStream()).rejects.toThrow(/Streamserver und Streamschlüssel/);
      expect(calls).toEqual([]);
    } finally {
      restore();
    }
  });

  it('leaves a configured single-platform stream unaffected when no additional target exists', async () => {
    const calls: string[] = [];
    const restore = installMultistreamPreflight({
      environmentProvider: () => ({
        STREAM_PLATFORM: 'youtube',
        STREAM_KEY: 'youtube_key_123456',
        STREAM_TARGETS_JSON: '[]',
        TWITCH_ENABLED: 'false',
      }),
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
