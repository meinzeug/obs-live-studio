import { rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { startIpcServer } from '../apps/desktop-agent/src/index.js';
describe('desktop agent IPC', () => {
  let server: any;
  const pidFile = join(tmpdir(), `obs-live-studio-desktop-agent-ipc-${process.pid}.pid`);
  beforeEach(() => {
    process.env.DESKTOP_AGENT_PID_FILE = pidFile;
    process.env.OBS_AUTO_START = 'false';
  });
  afterEach(() => {
    server?.close();
    rmSync(pidFile, { force: true });
    delete process.env.DESKTOP_AGENT_PID_FILE;
    delete process.env.DESKTOP_AGENT_TOKEN;
    delete process.env.OBS_AUTO_START;
  });
  it('requires bearer authentication', async () => {
    process.env.DESKTOP_AGENT_TOKEN = 'test-secret-token-with-at-least-32-chars';
    server = startIpcServer(0, '127.0.0.1');
    await new Promise((r) => server.once('listening', r));
    const addr = server.address();
    const r = await fetch(`http://127.0.0.1:${addr.port}/status`);
    expect(r.status).toBe(401);
    const ok = await fetch(`http://127.0.0.1:${addr.port}/status`, {
      headers: { authorization: 'Bearer test-secret-token-with-at-least-32-chars' },
    });
    expect(ok.status).toBe(200);
  });
});
