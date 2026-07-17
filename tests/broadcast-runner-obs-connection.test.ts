import { describe, expect, it, vi } from 'vitest';
import { ObsConnectionRecovery } from '../apps/broadcast-runner/src/obs-connection-recovery.js';

describe('broadcast runner OBS connection recovery', () => {
  it('backs off after authentication failure and resolves the notification after reconnecting', async () => {
    let now = 1000;
    let status = 'error';
    const ensureConnectedWithRetry = vi
      .fn<(attempts?: number) => Promise<void>>()
      .mockRejectedValueOnce(new Error('Authentication failed.'))
      .mockImplementationOnce(async () => {
        status = 'connected';
      });
    const onConnected = vi.fn(async () => undefined);
    const onFailure = vi.fn(async () => undefined);
    const recovery = new ObsConnectionRecovery(
      { getState: () => ({ status }), ensureConnectedWithRetry },
      { reconnectIntervalMs: 5000, now: () => now, onConnected, onFailure },
    );

    await expect(recovery.maintain()).resolves.toBe(false);
    expect(onFailure).toHaveBeenCalledOnce();
    now = 5999;
    await expect(recovery.maintain()).resolves.toBe(false);
    expect(ensureConnectedWithRetry).toHaveBeenCalledTimes(1);
    now = 6000;
    await expect(recovery.maintain()).resolves.toBe(true);
    expect(ensureConnectedWithRetry).toHaveBeenCalledTimes(2);
    expect(onConnected).toHaveBeenCalledOnce();
  });
});
