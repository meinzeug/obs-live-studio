import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

describe('API desktop-agent client', () => {
  beforeEach(() => {
    process.env.DESKTOP_AGENT_TOKEN = 'test-desktop-agent-token-with-at-least-32-characters';
    vi.resetModules();
  });

  afterEach(() => {
    vi.unstubAllGlobals();
    vi.resetModules();
    delete process.env.DESKTOP_AGENT_TOKEN;
  });

  it('reports an unreachable agent as a service failure without breaking the status response', async () => {
    vi.stubGlobal('fetch', vi.fn().mockRejectedValue(new TypeError('connection refused')));
    const { agentRequest, obsProcessStatus } = await import('../apps/api/src/desktop-agent-client.js');

    await expect(agentRequest('/status')).rejects.toMatchObject({
      name: 'DesktopAgentRequestError',
      statusCode: 503,
      message: expect.stringContaining('obs-live-studio-desktop-agent.service'),
    });
    await expect(obsProcessStatus()).resolves.toMatchObject({
      state: 'unavailable',
      pid: null,
      lastError: expect.stringContaining('obs-live-studio-desktop-agent.service'),
    });
  });

  it('rejects malformed desktop-agent responses as a bad gateway', async () => {
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue(new Response('not-json', { status: 200 })));
    const { agentRequest } = await import('../apps/api/src/desktop-agent-client.js');

    await expect(agentRequest('/status')).rejects.toMatchObject({
      name: 'DesktopAgentRequestError',
      statusCode: 502,
    });
  });
});
