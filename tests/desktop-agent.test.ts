import { readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { describe, it, expect, afterEach, beforeEach } from 'vitest';
import {
  obsLaunchArguments,
  startObs,
  stopObs,
  stopObsGracefully,
  obsStatus,
} from '../apps/desktop-agent/src/index.js';
describe('desktop agent OBS process control', () => {
  const pidFile = join(tmpdir(), `obs-live-studio-desktop-agent-${process.pid}.pid`);
  beforeEach(() => {
    process.env.DESKTOP_AGENT_PID_FILE = pidFile;
    process.env.OBS_PASSWORD = 'desktop-agent-obs-password';
  });
  afterEach(() => {
    stopObs();
    rmSync(pidFile, { force: true });
    delete process.env.DESKTOP_AGENT_PID_FILE;
    delete process.env.OBS_EXECUTABLE;
    delete process.env.OBS_PASSWORD;
  });

  it('forces the configured WebSocket password for managed OBS starts', () => {
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

  it('replaces a stale password from custom OBS arguments', () => {
    const args = obsLaunchArguments({
      OBS_PASSWORD: 'current-secret',
      OBS_ARGS_JSON: JSON.stringify(['--profile', 'Studio', '--websocket_password', 'stale-secret']),
    });

    expect(args.filter((argument) => argument === '--websocket_password')).toHaveLength(1);
    expect(args).not.toContain('stale-secret');
    expect(args.at(-1)).toBe('current-secret');
  });
  it('starts once, prevents double start, stops and reports status', () => {
    process.env.OBS_EXECUTABLE = '/bin/sleep';
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
    process.env.OBS_EXECUTABLE = '/bin/sleep';
    writeFileSync(pidFile, String(process.pid));

    const status = obsStatus();

    expect(status.pid).toBeNull();
    expect(() => readFileSync(pidFile, 'utf8')).toThrow();
  });

  it('uses a safe stop timeout when the configured value is invalid', async () => {
    process.env.OBS_EXECUTABLE = '/bin/sleep';
    startObs();

    const stopped = await stopObsGracefully(Number.NaN);

    expect(stopped.state).toBe('stopped');
    expect(stopped.lastError).toBeNull();
  });
});
