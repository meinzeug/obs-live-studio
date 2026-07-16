import { readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { describe, it, expect, afterEach, beforeEach } from 'vitest';
import { startObs, stopObs, obsStatus } from '../apps/desktop-agent/src/index.js';
describe('desktop agent OBS process control', () => {
  const pidFile = join(tmpdir(), `obs-live-studio-desktop-agent-${process.pid}.pid`);
  beforeEach(() => {
    process.env.DESKTOP_AGENT_PID_FILE = pidFile;
  });
  afterEach(() => {
    stopObs();
    rmSync(pidFile, { force: true });
    delete process.env.DESKTOP_AGENT_PID_FILE;
    delete process.env.OBS_EXECUTABLE;
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
});
