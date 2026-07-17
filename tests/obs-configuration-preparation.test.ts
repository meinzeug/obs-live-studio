import { describe, expect, it, vi } from 'vitest';
import { prepareRunningObsForConfiguration } from '../apps/api/src/obs-configuration-preparation.js';

function dependencies(getStreamStatus: () => Promise<{ outputActive?: boolean }>) {
  return {
    getStreamStatus,
    reconnect: vi.fn(async () => undefined),
    disconnect: vi.fn(async () => undefined),
    stopProcess: vi.fn(async () => undefined),
  };
}

describe('OBS preparation for streaming-target changes', () => {
  it('stops and repairs a running OBS instance with a mismatched WebSocket password', async () => {
    const runtime = dependencies(async () => {
      throw Object.assign(new Error('Authentication failed.'), { code: 4009 });
    });

    await expect(prepareRunningObsForConfiguration(runtime)).resolves.toEqual({ authenticationRecovered: true });
    expect(runtime.reconnect).not.toHaveBeenCalled();
    expect(runtime.disconnect).toHaveBeenCalledOnce();
    expect(runtime.stopProcess).toHaveBeenCalledOnce();
  });

  it('still blocks target changes while a verified livestream is active', async () => {
    const runtime = dependencies(async () => ({ outputActive: true }));

    await expect(prepareRunningObsForConfiguration(runtime)).rejects.toMatchObject({ statusCode: 409 });
    expect(runtime.stopProcess).not.toHaveBeenCalled();
  });

  it('returns an actionable service error for non-authentication connection failures', async () => {
    const runtime = dependencies(async () => {
      throw new Error('connection refused');
    });
    runtime.reconnect.mockRejectedValueOnce(new Error('connection refused'));

    await expect(prepareRunningObsForConfiguration(runtime)).rejects.toMatchObject({ statusCode: 503 });
    expect(runtime.stopProcess).not.toHaveBeenCalled();
  });
});
