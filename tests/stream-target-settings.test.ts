import Fastify from 'fastify';
import dotenv from 'dotenv';
import { describe, expect, it, vi } from 'vitest';
import {
  StreamTargetSettingsManager,
  buildStreamTargetEnvironment,
  registerStreamTargetSettingsRoutes,
  updateEnvironmentDocument,
} from '../apps/api/src/stream-target-settings.js';
import { installApiErrorHandler } from '../apps/api/src/error-handler.js';

const primaryKey = 'youtube-key-secret-123';
const twitchKey = 'twitch-key-secret-456';
const initialEnvironment = [
  '# Studio-Konfiguration',
  'PGPASSWORD=database-secret',
  'STREAM_PLATFORM=youtube',
  'STREAM_TARGET_NAME=YouTube',
  'STREAM_SERVER=rtmps://a.rtmps.youtube.com:443/live2',
  `STREAM_KEY=${primaryKey}`,
  'CHANNEL_URL=https://youtube.example/channel',
  `STREAM_TARGETS_JSON=${JSON.stringify([
    {
      id: 'twitch',
      name: 'Twitch',
      platform: 'twitch',
      server: 'rtmps://live.twitch.tv:443/app',
      key: twitchKey,
      channelUrl: 'https://twitch.example/channel',
      enabled: true,
      syncStart: true,
      syncStop: true,
    },
  ])}`,
  '',
].join('\n');

function settingsInput() {
  return {
    primary: {
      name: 'YouTube Hauptkanal',
      platform: 'youtube',
      server: 'rtmps://a.rtmps.youtube.com:443/live2',
      channelUrl: 'https://youtube.example/channel',
      key: '',
    },
    additionalTargets: [
      {
        id: 'twitch',
        name: 'Twitch parallel',
        platform: 'twitch',
        server: 'rtmps://live.twitch.tv:443/app',
        channelUrl: 'https://twitch.example/channel',
        enabled: true,
        syncStart: true,
        syncStop: true,
        key: '',
      },
    ],
  };
}

describe('stream target settings', () => {
  it('preserves unrelated environment values and safely round-trips JSON', () => {
    const updated = updateEnvironmentDocument(`${initialEnvironment}export STREAM_TARGET_NAME=veraltet\n`, {
      STREAM_TARGET_NAME: 'Hauptziel #1',
      STREAM_TARGETS_JSON: JSON.stringify([{ id: 'custom', name: 'Ziel #1', key: 'abc12345' }]),
    });
    const parsed = dotenv.parse(updated);

    expect(updated).toContain('# Studio-Konfiguration');
    expect(parsed.PGPASSWORD).toBe('database-secret');
    expect(parsed.STREAM_TARGET_NAME).toBe('Hauptziel #1');
    expect(updated.match(/STREAM_TARGET_NAME=/g)).toHaveLength(2);
    expect(updated).not.toContain('veraltet');
    expect(JSON.parse(parsed.STREAM_TARGETS_JSON)).toEqual([{ id: 'custom', name: 'Ziel #1', key: 'abc12345' }]);
  });

  it('keeps existing keys when password fields stay empty and never returns them', async () => {
    let content = initialEnvironment;
    const runtimeEnvironment: NodeJS.ProcessEnv = {};
    const applyConfiguration = vi.fn(async () => undefined);
    const beforeApply = vi.fn(async () => ({ wasRunning: false }));
    const afterApply = vi.fn(async () => undefined);
    const manager = new StreamTargetSettingsManager({
      env: runtimeEnvironment,
      readEnvironmentFile: async () => content,
      writeEnvironmentFile: async (next) => {
        content = next;
      },
      applyConfiguration,
      beforeApply,
      afterApply,
    });

    const before = await manager.get();
    const result = await manager.save(settingsInput());
    const parsed = dotenv.parse(content);
    const additional = JSON.parse(parsed.STREAM_TARGETS_JSON);

    expect(before.primary).toMatchObject({ key: '', keyConfigured: true });
    expect(before.additionalTargets[0]).toMatchObject({ key: '', keyConfigured: true });
    expect(parsed.PGPASSWORD).toBe('database-secret');
    expect(parsed.STREAM_KEY).toBe(primaryKey);
    expect(additional[0].key).toBe(twitchKey);
    expect(applyConfiguration).toHaveBeenCalledWith(expect.objectContaining({ STREAM_KEY: primaryKey }));
    expect(beforeApply).toHaveBeenCalledOnce();
    expect(afterApply).toHaveBeenCalledWith({ wasRunning: false });
    expect(JSON.stringify(result)).not.toContain(primaryKey);
    expect(JSON.stringify(result)).not.toContain(twitchKey);
  });

  it('requires a new key when the platform changes', () => {
    const current = dotenv.parse(initialEnvironment);
    const input = settingsInput();
    input.primary.platform = 'twitch';
    input.primary.server = 'rtmps://live.twitch.tv:443/app';

    expect(() => buildStreamTargetEnvironment(current, input)).toThrow('benötigt Streamserver und Streamschlüssel');
  });

  it('rolls the private environment back if OBS configuration fails', async () => {
    let content = initialEnvironment;
    const runtimeEnvironment: NodeJS.ProcessEnv = dotenv.parse(initialEnvironment);
    const applyConfiguration = vi
      .fn<(environment: NodeJS.ProcessEnv) => Promise<void>>()
      .mockRejectedValueOnce(new Error('secret implementation detail'))
      .mockResolvedValueOnce(undefined);
    const afterApply = vi.fn(async () => undefined);
    const manager = new StreamTargetSettingsManager({
      env: runtimeEnvironment,
      readEnvironmentFile: async () => content,
      writeEnvironmentFile: async (next) => {
        content = next;
      },
      applyConfiguration,
      beforeApply: async () => ({ wasRunning: true }),
      afterApply,
    });

    await expect(manager.save(settingsInput())).rejects.toThrow(
      'Streaming-Konfiguration konnte nicht sicher angewendet werden.',
    );
    expect(content).toBe(initialEnvironment);
    expect(runtimeEnvironment.STREAM_TARGET_NAME).toBe('YouTube');
    expect(applyConfiguration).toHaveBeenCalledTimes(2);
    expect(afterApply).toHaveBeenCalledWith({ wasRunning: true });
  });

  it('rejects overlapping save operations', async () => {
    let content = initialEnvironment;
    let release!: () => void;
    const applying = new Promise<void>((resolve) => {
      release = resolve;
    });
    const manager = new StreamTargetSettingsManager({
      env: {},
      readEnvironmentFile: async () => content,
      writeEnvironmentFile: async (next) => {
        content = next;
      },
      applyConfiguration: () => applying,
    });

    const first = manager.save(settingsInput());
    await vi.waitFor(() => expect(content).toContain('YouTube Hauptkanal'));
    await expect(manager.save(settingsInput())).rejects.toMatchObject({ statusCode: 409 });
    release();
    await first;
  });

  it('registers protected read and write routes', async () => {
    const app = Fastify();
    installApiErrorHandler(app);
    const manager = new StreamTargetSettingsManager({
      env: {},
      readEnvironmentFile: async () => initialEnvironment,
      writeEnvironmentFile: async () => undefined,
      applyConfiguration: async () => undefined,
    });
    const requirePermission = vi.fn();
    registerStreamTargetSettingsRoutes(app, manager, requirePermission);

    const read = await app.inject({ method: 'GET', url: '/api/stream-targets' });
    const write = await app.inject({ method: 'POST', url: '/api/stream-targets', payload: settingsInput() });

    expect(read.statusCode).toBe(200);
    expect(write.statusCode).toBe(200);
    expect(requirePermission).toHaveBeenCalledTimes(2);
    expect(requirePermission).toHaveBeenNthCalledWith(1, expect.anything(), expect.anything(), 'obs:write');
    expect(read.body).not.toContain(primaryKey);
    expect(write.body).not.toContain(twitchKey);
    await app.close();
  });
});
