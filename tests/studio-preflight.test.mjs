import { chmod, mkdir, mkdtemp, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';
import { runStudioPreflight } from '../scripts/studio-preflight-lib.mjs';

const temporaryDirectories = [];

const secureEnvironment = {
  SESSION_SECRET: 'a'.repeat(64),
  ENCRYPTION_KEY: 'b'.repeat(64),
  DESKTOP_AGENT_TOKEN: 'c'.repeat(64),
  OBS_PASSWORD: 'd'.repeat(32),
  APP_HOST: '127.0.0.1',
  DESKTOP_AGENT_URL: 'http://127.0.0.1:12090',
};

async function createRoot(mode = 0o600) {
  const root = await mkdtemp(join(tmpdir(), 'studio-preflight-'));
  temporaryDirectories.push(root);
  await writeFile(join(root, '.env'), 'SESSION_SECRET=redacted\n', { mode });
  await chmod(join(root, '.env'), mode);
  return root;
}

async function createObsConfiguration(root, mode = 0o600) {
  const configBase = join(root, 'xdg');
  const obsRoot = join(configBase, 'obs-studio');
  const profileDir = join(obsRoot, 'basic', 'profiles', 'Automated_News_Studio');
  const scenesDir = join(obsRoot, 'basic', 'scenes');
  const websocketDir = join(obsRoot, 'plugin_config', 'obs-websocket');
  for (const directory of [profileDir, scenesDir, websocketDir]) await mkdir(directory, { recursive: true });
  const files = [
    [join(obsRoot, 'global.ini'), '[OBSWebSocket]\nServerEnabled=true\n'],
    [join(obsRoot, 'user.ini'), '[Basic]\nProfile=Automated News Studio\n'],
    [join(profileDir, 'basic.ini'), '[General]\nName=Automated News Studio\n'],
    [join(profileDir, 'service.json'), '{"settings":{"service":"YouTube - RTMPS","key":"test-key-123"}}\n'],
    [join(websocketDir, 'config.json'), '{"server_enabled":true}\n'],
    [join(scenesDir, 'Automated_News_Studio.json'), '{"sources":[{"name":"10_MAINTENANCE"}]}\n'],
  ];
  for (const [path, content] of files) {
    await writeFile(path, content, { mode });
    await chmod(path, mode);
  }
  return { configBase, files };
}

afterEach(async () => {
  await Promise.all(temporaryDirectories.splice(0).map((path) => rm(path, { recursive: true, force: true })));
});

describe('studio preflight', () => {
  it('accepts a protected local-only configuration', async () => {
    const root = await createRoot();
    const report = await runStudioPreflight({
      root,
      scope: 'configuration',
      env: secureEnvironment,
      checkDatabase: false,
    });

    expect(report.ok).toBe(true);
    expect(report.summary.errors).toBe(0);
  });

  it('accepts every protected managed OBS configuration file', async () => {
    const root = await createRoot();
    const { configBase } = await createObsConfiguration(root);
    const report = await runStudioPreflight({
      root,
      homeDir: root,
      scope: 'obs',
      env: {
        ...secureEnvironment,
        XDG_CONFIG_HOME: configBase,
        OBS_EXECUTABLE: '/bin/true',
        TWITCH_ENABLED: 'false',
      },
      pluginCandidates: [],
      checkDatabase: false,
    });

    expect(report.ok).toBe(true);
    for (const id of [
      'obs-profile',
      'obs-stream-service',
      'obs-global-config',
      'obs-user-config',
      'obs-websocket-config',
      'obs-scene-collection',
    ]) {
      expect(report.checks).toEqual(expect.arrayContaining([expect.objectContaining({ id, status: 'ok' })]));
    }
  });

  it('rejects unsafe permissions on any managed OBS configuration file', async () => {
    const root = await createRoot();
    const { configBase } = await createObsConfiguration(root);
    const websocket = join(configBase, 'obs-studio', 'plugin_config', 'obs-websocket', 'config.json');
    await chmod(websocket, 0o644);
    const report = await runStudioPreflight({
      root,
      homeDir: root,
      scope: 'obs',
      env: {
        ...secureEnvironment,
        XDG_CONFIG_HOME: configBase,
        OBS_EXECUTABLE: '/bin/true',
        TWITCH_ENABLED: 'false',
      },
      pluginCandidates: [],
      checkDatabase: false,
    });

    expect(report.ok).toBe(false);
    expect(report.checks).toEqual(
      expect.arrayContaining([expect.objectContaining({ id: 'obs-websocket-config', status: 'error' })]),
    );
  });

  it('rejects external API binding unless explicitly allowed', async () => {
    const root = await createRoot();
    const report = await runStudioPreflight({
      root,
      scope: 'configuration',
      env: { ...secureEnvironment, APP_HOST: '0.0.0.0' },
      checkDatabase: false,
    });

    expect(report.ok).toBe(false);
    expect(report.checks).toEqual(
      expect.arrayContaining([expect.objectContaining({ id: 'app-bind', status: 'error' })]),
    );
  });

  it('rejects environment files readable by other users', async () => {
    const root = await createRoot(0o644);
    const report = await runStudioPreflight({
      root,
      scope: 'configuration',
      env: secureEnvironment,
      checkDatabase: false,
    });

    expect(report.ok).toBe(false);
    expect(report.checks).toEqual(
      expect.arrayContaining([expect.objectContaining({ id: 'env-file', status: 'error' })]),
    );
  });

  it('redacts database connection error messages', async () => {
    const root = await createRoot();
    const databaseUrl = 'postgresql://secret-user:secret-password@localhost:5432/newsstudio';
    const report = await runStudioPreflight({
      root,
      scope: 'api',
      env: { ...secureEnvironment, DATABASE_URL: databaseUrl },
      databaseChecker: async () => {
        const error = new Error(`connection failed for ${databaseUrl}`);
        error.code = 'ECONNREFUSED';
        throw error;
      },
    });
    const serialized = JSON.stringify(report);

    expect(report.ok).toBe(false);
    expect(serialized).toContain('ECONNREFUSED');
    expect(serialized).not.toContain('secret-user');
    expect(serialized).not.toContain('secret-password');
  });

  it('never serializes secret values into the report', async () => {
    const root = await createRoot();
    const report = await runStudioPreflight({
      root,
      scope: 'configuration',
      env: secureEnvironment,
      checkDatabase: false,
    });
    const serialized = JSON.stringify(report);

    for (const secret of [
      secureEnvironment.SESSION_SECRET,
      secureEnvironment.ENCRYPTION_KEY,
      secureEnvironment.DESKTOP_AGENT_TOKEN,
    ]) {
      expect(serialized).not.toContain(secret);
    }
  });
});
