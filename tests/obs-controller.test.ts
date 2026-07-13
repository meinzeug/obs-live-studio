import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import {
  ObsController,
  MAIN_NEWS_SCENE,
  MAINTENANCE_SCENE,
  MAIN_BROWSER_INPUT,
  VOICE_INPUT,
} from '@ans/obs-controller';
import { ObsWebSocketV5TestServer } from './helpers/obs-websocket-v5-server.js';

let server: ObsWebSocketV5TestServer;
let obs: ObsController;

async function expectTimeout(promise: Promise<unknown>) {
  await expect(
    Promise.race([promise, new Promise((_, reject) => setTimeout(() => reject(new Error('timeout')), 50))]),
  ).rejects.toThrow(/timeout/);
}

describe('OBS controller v5 workflow', () => {
  beforeEach(async () => {
    server = new ObsWebSocketV5TestServer();
    await server.start();
    obs = new ObsController({ host: '127.0.0.1', port: server.port });
  });
  afterEach(async () => {
    await server.stop();
  });

  it('connects to a local OBS WebSocket v5 server and creates documented scenes', async () => {
    server.mediaState = 'ended';
    const states: string[] = [];
    await obs.playTestContribution({
      articleId: 'a',
      audioPath: '/tmp/voice.wav',
      overlayUrl: 'http://127.0.0.1:12000/overlay/main',
      timeoutMs: 3000,
      onState: (s) => {
        states.push(s.status);
      },
    });
    expect(
      server.requests.some((c) => c.requestType === 'CreateScene' && c.requestData?.sceneName === MAIN_NEWS_SCENE),
    ).toBe(true);
    expect(
      server.requests.some((c) => c.requestType === 'CreateScene' && c.requestData?.sceneName === MAINTENANCE_SCENE),
    ).toBe(true);
    expect(
      server.requests.some(
        (c) =>
          c.requestType === 'CreateInput' &&
          c.requestData?.inputName === MAIN_BROWSER_INPUT &&
          c.requestData?.inputKind === 'browser_source',
      ),
    ).toBe(true);
    expect(
      server.requests.some(
        (c) =>
          c.requestType === 'CreateInput' &&
          c.requestData?.inputName === VOICE_INPUT &&
          c.requestData?.inputKind === 'ffmpeg_source',
      ),
    ).toBe(true);
    expect(states).toEqual(['preparing', 'playing', 'ended']);
  });

  it('sends exactly one OBS request for pause, resume, skip, and stop', async () => {
    await obs.pauseMedia();
    await obs.playMedia();
    await obs.stopMedia();
    await obs.stopMedia();
    expect(server.countActions('_PAUSE')).toBe(1);
    expect(server.countActions('_PLAY')).toBe(1);
    expect(server.countActions('_STOP')).toBe(2);
  });

  it('handles delayed acknowledgements', async () => {
    server.mode = 'delayed';
    await expect(obs.pauseMedia()).resolves.toEqual({});
    expect(server.countActions('_PAUSE')).toBe(1);
  });

  it('surfaces timeout and disconnect failures', async () => {
    server.mode = 'timeout';
    await expectTimeout(obs.pauseMedia());
    const port = server.port;
    await server.stop();
    const disconnected = new ObsController({ host: '127.0.0.1', port });
    await expect(disconnected.pauseMedia()).rejects.toThrow();
  });
});
