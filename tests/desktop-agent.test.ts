import { describe, it, expect, afterEach } from 'vitest';
import { startObs, stopObs, obsStatus } from '../apps/desktop-agent/src/index.js';
describe('desktop agent OBS process control', () => {
  afterEach(() => stopObs());
  it('starts once, prevents double start, stops and reports status', () => {
    process.env.OBS_EXECUTABLE = '/bin/sleep';
    const first = startObs();
    const second = startObs();
    expect(first.pid).toBeTruthy();
    expect(second.pid).toBe(first.pid);
    expect(second.state).toBe('running');
    const stopped = stopObs();
    expect(stopped.state).toBe('stopped');
    expect(obsStatus().pid).toBeNull();
  });
});
