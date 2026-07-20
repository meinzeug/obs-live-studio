import { readFile } from 'node:fs/promises';
import { describe, expect, it } from 'vitest';

describe('stream autostart with autopilot', () => {
  it('starts the stream supervisor when autopilot is enabled, not only through STREAM_AUTO_START', async () => {
    const api = await readFile('apps/api/src/index.ts', 'utf8');

    expect(api).toContain('async function automaticStreamStartEnabled()');
    expect(api).toContain("process.env.STREAM_AUTO_START === 'true'");
    expect(api).toContain('Boolean((await getAutopilotConfig()).enabled)');
    expect(api).toContain("scheduleStreamSupervisor('autopilot-enabled')");
    expect(api).toContain("scheduleStreamSupervisor('obs-process-restarted')");
    expect(api).toContain('setInterval(() => void superviseStream(), streamSupervisorIntervalMs).unref?.()');
  });
});
