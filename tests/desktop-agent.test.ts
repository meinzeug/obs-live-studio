import { chmodSync, mkdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { describe, it, expect, afterEach, beforeEach, vi } from 'vitest';
import {
  hasProtectedObsWebsocketConfiguration,
  installShutdownHandlers,
  obsLaunchArguments,
  obsRestartDelayMs,
  startObsProcessSupervisor,
  startObs,
  stopObs,
  stopObsGracefully,
  obsStatus,
} from '../apps/desktop-agent/src/index.js';
describe('desktop agent OBS process control', () => {
  const runtimeDir = join(tmpdir(), `obs-live-studio-desktop-agent-${process.pid}`);
  const pidFile = join(runtimeDir, 'obs.pid');
  const fakeObsExecutable = join(runtimeDir, 'obs-test-process');
  const obsConfigRoot = join(runtimeDir, 'obs-config');

  function writeProtectedWebsocketConfig(password: string, port = 4455, mode = 0o600) {
    const websocketDirectory = join(obsConfigRoot, 'plugin_config', 'obs-websocket');
    mkdirSync(websocketDirectory, { recursive: true, mode: 0o700 });
    chmodSync(obsConfigRoot, 0o700);
    chmodSync(join(obsConfigRoot, 'plugin_config'), 0o700);
    chmodSync(websocketDirectory, 0o700);
    const path = join(websocketDirectory, 'config.json');
    writeFileSync(
      path,
      JSON.stringify({
        server_enabled: true,
        auth_required: true,
        server_password: password,
        server_port: port,
      }),
      { mode },
    );
    chmodSync(path, mode);
    return path;
  }

  it('provides graceful systemd shutdown handling for OBS scene persistence', () => {
    expect(installShutdownHandlers).toBeTypeOf('function');
    expect(startObsProcessSupervisor).toBeTypeOf('function');
  });

  beforeEach(() => {
    mkdirSync(runtimeDir, { recursive: true, mode: 0o700 });
    writeFileSync(fakeObsExecutable, '#!/bin/sh\nexec /bin/sleep 30\n', { mode: 0o700 });
    chmodSync(fakeObsExecutable, 0o700);
    process.env.DESKTOP_AGENT_PID_FILE = pidFile;
    process.env.OBS_PASSWORD = 'desktop-agent-obs-password';
  });
  afterEach(() => {
    stopObs();
    rmSync(runtimeDir, { force: true, recursive: true });
    delete process.env.DESKTOP_AGENT_PID_FILE;
    delete process.env.OBS_EXECUTABLE;
    delete process.env.OBS_PASSWORD;
    delete process.env.OBS_ARGS_JSON;
    delete process.env.OBS_AUTO_RESTART;
    delete process.env.OBS_RESTART_DELAY_MS;
    delete process.env.OBS_RESTART_MAX_DELAY_MS;
    delete process.env.OBS_RESTART_STABLE_MS;
    delete process.env.OBS_CONFIG_ROOT;
  });

  it('uses the configured WebSocket password as a compatibility fallback without a protected config', () => {
    const args = obsLaunchArguments({
      OBS_PASSWORD: 'synchronized-secret',
      OBS_PORT: '4456',
      OBS_PROFILE_NAME: 'Studio',
      OBS_SCENE_COLLECTION: 'Studio',
    });

    expect(args).toContain('--websocket_password');
    expect(args[args.indexOf('--websocket_password') + 1]).toBe('synchronized-secret');
    expect(args[args.indexOf('--websocket_port') + 1]).toBe('4456');
  });

  it('keeps the WebSocket password out of process arguments when the protected config matches', () => {
    writeProtectedWebsocketConfig('current-secret', 4457);
    const environment = {
      OBS_PASSWORD: 'current-secret',
      OBS_PORT: '4457',
      OBS_CONFIG_ROOT: obsConfigRoot,
      OBS_ARGS_JSON: JSON.stringify([
        '--profile',
        'Studio',
        '--websocket_port=9999',
        '--websocket_password',
        'stale-secret',
      ]),
    };
    const args = obsLaunchArguments(environment);

    expect(hasProtectedObsWebsocketConfiguration(environment)).toBe(true);
    expect(args).not.toContain('--websocket_password');
    expect(args.filter((argument) => argument === '--websocket_port')).toHaveLength(1);
    expect(args[args.indexOf('--websocket_port') + 1]).toBe('4457');
    expect(args).not.toContain('--websocket_port=9999');
    expect(args).not.toContain('stale-secret');
    expect(args).not.toContain('current-secret');
  });

  it('falls back to the CLI password when the OBS config is not owner-only', () => {
    writeProtectedWebsocketConfig('current-secret', 4457, 0o644);
    const environment = {
      OBS_PASSWORD: 'current-secret',
      OBS_PORT: '4457',
      OBS_CONFIG_ROOT: obsConfigRoot,
    };
    const args = obsLaunchArguments(environment);

    expect(hasProtectedObsWebsocketConfiguration(environment)).toBe(false);
    expect(args).toContain('--websocket_password');
    expect(args.at(-1)).toBe('current-secret');
  });

  it('falls back to the default WebSocket port for invalid configuration', () => {
    const args = obsLaunchArguments({
      OBS_PASSWORD: 'current-secret',
      OBS_PORT: 'not-a-port',
      OBS_ARGS_JSON: JSON.stringify(['--websocket_port', '9999']),
    });

    expect(args[args.indexOf('--websocket_port') + 1]).toBe('4455');
  });
  it('starts once, prevents double start, stops and reports status', () => {
    process.env.OBS_EXECUTABLE = fakeObsExecutable;
    const first = startObs();
    const second = startObs();
    expect(first.pid).toBeTruthy();
    expect(readFileSync(pidFile, 'utf8')).toBe(String(first.pid));
    expect(second.pid).toBe(first.pid);
    expect(second.state).toBe('running');
    const stopped = stopObs();
    expect(stopped.state).toBe('stopped');
    expect(obsStatus().pid).toBeNull();
  });

  it('rejects a stale PID that now belongs to another executable', () => {
    process.env.OBS_EXECUTABLE = fakeObsExecutable;
    writeFileSync(pidFile, String(process.pid));

    const status = obsStatus();

    expect(status.pid).toBeNull();
    expect(() => readFileSync(pidFile, 'utf8')).toThrow();
  });

  it('uses a safe stop timeout when the configured value is invalid', async () => {
    process.env.OBS_EXECUTABLE = fakeObsExecutable;
    startObs();

    const stopped = await stopObsGracefully(Number.NaN);

    expect(stopped.state).toBe('stopped');
    expect(stopped.lastError).toBeNull();
  });

  it('cancels a pending automatic restart when OBS is explicitly stopped', async () => {
    process.env.OBS_EXECUTABLE = '/bin/false';
    process.env.OBS_ARGS_JSON = '[]';
    process.env.OBS_AUTO_RESTART = 'true';
    process.env.OBS_RESTART_DELAY_MS = '250';
    startObs();
    await vi.waitFor(() => expect(obsStatus().state).toBe('crashed'));

    expect(stopObs().state).toBe('stopped');
    await new Promise((resolve) => setTimeout(resolve, 350));

    expect(obsStatus()).toMatchObject({ state: 'stopped', pid: null });
  });

  it('bounds exponential restart delays', () => {
    const environment = {
      OBS_RESTART_DELAY_MS: '250',
      OBS_RESTART_MAX_DELAY_MS: '1000',
    };

    expect(obsRestartDelayMs(1, environment)).toBe(250);
    expect(obsRestartDelayMs(2, environment)).toBe(500);
    expect(obsRestartDelayMs(3, environment)).toBe(1000);
    expect(obsRestartDelayMs(99, environment)).toBe(1000);
  });

  it('keeps retrying after the first automatic restart attempt also fails', async () => {
    const invocationFile = join(runtimeDir, 'obs-start-count');
    writeFileSync(
      fakeObsExecutable,
      `#!/bin/sh
count=0
if [ -f "${invocationFile}" ]; then count="$(/bin/cat "${invocationFile}")"; fi
count=$((count + 1))
echo "$count" > "${invocationFile}"
if [ "$count" -lt 3 ]; then exit 1; fi
exec /bin/sleep 30
`,
      { mode: 0o700 },
    );
    chmodSync(fakeObsExecutable, 0o700);
    process.env.OBS_EXECUTABLE = fakeObsExecutable;
    process.env.OBS_ARGS_JSON = '[]';
    process.env.OBS_AUTO_RESTART = 'true';
    process.env.OBS_RESTART_DELAY_MS = '250';
    process.env.OBS_RESTART_MAX_DELAY_MS = '500';
    process.env.OBS_RESTART_STABLE_MS = '250';

    startObs();

    await vi.waitFor(() => expect(Number(readFileSync(invocationFile, 'utf8'))).toBeGreaterThanOrEqual(3), {
      timeout: 3000,
      interval: 25,
    });
    await vi.waitFor(() => expect(obsStatus()).toMatchObject({ state: 'running', pid: expect.any(Number) }), {
      timeout: 1000,
      interval: 25,
    });
    await vi.waitFor(() => expect(obsStatus().restart.attempts).toBe(0), { timeout: 1000, interval: 25 });
  });
});
