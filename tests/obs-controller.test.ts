import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import {
  ObsController,
  ARTICLE_VIDEO_INPUT,
  MAIN_NEWS_SCENE,
  MAINTENANCE_SCENE,
  MAIN_BROWSER_INPUT,
  VOICE_INPUT,
  CHANNEL_LOGO_INPUT,
  LIVE_STUDIO_SCENE,
  LIVE_OVERLAY_INPUT,
  liveStudioInputName,
  isObsAuthenticationError,
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
          c.requestData?.inputKind === 'browser_source' &&
          String((c.requestData?.inputSettings as any)?.url ?? '').includes('articleId=a') &&
          String((c.requestData?.inputSettings as any)?.url ?? '').includes('overlayRefresh='),
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
    expect(server.countActions('_PAUSE', VOICE_INPUT)).toBe(1);
    expect(server.countActions('_PAUSE', ARTICLE_VIDEO_INPUT)).toBe(1);
    expect(server.countActions('_PLAY', VOICE_INPUT)).toBe(1);
    expect(server.countActions('_PLAY', ARTICLE_VIDEO_INPUT)).toBe(1);
    expect(server.countActions('_STOP', VOICE_INPUT)).toBe(2);
    expect(server.countActions('_STOP', ARTICLE_VIDEO_INPUT)).toBe(2);
  });

  it('handles delayed acknowledgements', async () => {
    server.mode = 'delayed';
    await expect(obs.pauseMedia()).resolves.toEqual({});
    expect(server.countActions('_PAUSE', VOICE_INPUT)).toBe(1);
    expect(server.countActions('_PAUSE', ARTICLE_VIDEO_INPUT)).toBe(1);
  });

  it('surfaces timeout and disconnect failures', async () => {
    server.mode = 'timeout';
    await expectTimeout(obs.pauseMedia());
    const port = server.port;
    await server.stop();
    const disconnected = new ObsController({ host: '127.0.0.1', port });
    await expect(disconnected.pauseMedia()).rejects.toThrow();
  });

  it('confirms that the stream is active before reporting a successful start', async () => {
    await expect(obs.startStream()).resolves.toMatchObject({ outputActive: true });
    expect(server.requests.filter((request) => request.requestType === 'StartStream')).toHaveLength(1);
    await expect(obs.startStream()).resolves.toMatchObject({ outputActive: true });
    expect(server.requests.filter((request) => request.requestType === 'StartStream')).toHaveLength(1);
  });

  it('adds one shared sender-logo browser source to every studio scene', async () => {
    const result = await obs.ensureChannelLogo('http://127.0.0.1:12000/channel-logo');
    expect(result.inputName).toBe(CHANNEL_LOGO_INPUT);
    expect(result.scenes).toContain(MAIN_NEWS_SCENE);
    expect(result.scenes).toContain(MAINTENANCE_SCENE);
    expect(
      server.requests.some(
        (request) =>
          request.requestType === 'CreateInput' &&
          request.requestData?.inputName === CHANNEL_LOGO_INPUT &&
          (request.requestData?.inputSettings as any)?.url === 'http://127.0.0.1:12000/channel-logo',
      ),
    ).toBe(true);
    const addedScenes = server.requests
      .filter((request) => request.requestType === 'CreateSceneItem')
      .map((request) => request.requestData?.sceneName);
    expect(addedScenes).toContain(MAIN_NEWS_SCENE);
  });

  it('creates live studio browser sources with separate audio control and layouts', async () => {
    await obs.ensureLiveStudioScene('http://127.0.0.1:12000/overlay/live');
    const result = await obs.ensureLiveSource({
      sourceId: 'phone dennis/1',
      viewerUrl: 'https://obs.meinzeug.cloud/viewer/token',
      muted: true,
      layout: 'pip',
      sources: [{ sourceId: 'phone dennis/1', index: 0 }],
    });

    expect(result.sceneName).toBe(LIVE_STUDIO_SCENE);
    expect(result.inputName).toBe(liveStudioInputName('phone dennis/1'));
    expect(
      server.requests.some(
        (request) =>
          request.requestType === 'CreateInput' &&
          request.requestData?.inputName === LIVE_OVERLAY_INPUT &&
          request.requestData?.sceneName === LIVE_STUDIO_SCENE,
      ),
    ).toBe(true);
    expect(
      server.requests.some(
        (request) =>
          request.requestType === 'CreateInput' &&
          request.requestData?.inputName === liveStudioInputName('phone dennis/1') &&
          (request.requestData?.inputSettings as any)?.reroute_audio === true,
      ),
    ).toBe(true);
    expect(
      server.requests.some(
        (request) =>
          request.requestType === 'SetInputMute' &&
          request.requestData?.inputName === liveStudioInputName('phone dennis/1') &&
          request.requestData?.inputMuted === true,
      ),
    ).toBe(true);
    expect(server.requests.some((request) => request.requestType === 'SetSceneItemTransform')).toBe(true);

    await obs.removeLiveSource('phone dennis/1');
    const removeSceneItemIndex = server.requests.findIndex(
      (request) => request.requestType === 'RemoveSceneItem' && request.requestData?.sceneName === LIVE_STUDIO_SCENE,
    );
    const removeInputIndex = server.requests.findIndex(
      (request) =>
        request.requestType === 'RemoveInput' &&
        request.requestData?.inputName === liveStudioInputName('phone dennis/1'),
    );
    expect(removeSceneItemIndex).toBeGreaterThan(-1);
    expect(removeInputIndex).toBeGreaterThan(-1);
    expect(removeSceneItemIndex).toBeLessThan(removeInputIndex);
  });

  it('rejects a stream start that OBS acknowledges without activating the output', async () => {
    server.streamStartSucceeds = false;
    obs = new ObsController({
      host: '127.0.0.1',
      port: server.port,
      streamStartTimeoutMs: 30,
      streamStatusPollMs: 10,
    });
    await expect(obs.startStream()).rejects.toThrow(/did not become active/);
  });
});

describe('OBS authentication errors', () => {
  it('recognizes the official close code and localized authentication messages', () => {
    expect(isObsAuthenticationError(Object.assign(new Error('closed'), { code: 4009 }))).toBe(true);
    expect(isObsAuthenticationError(new Error('Authentication failed.'))).toBe(true);
    expect(isObsAuthenticationError(new Error('connection refused'))).toBe(false);
  });

  it('resets a failed client before reconnecting with the corrected password', async () => {
    const client = {
      connect: vi.fn().mockRejectedValueOnce(new Error('Authentication failed.')).mockResolvedValueOnce(undefined),
      disconnect: vi.fn(async () => undefined),
      call: vi.fn(async () => ({})),
    };
    const controller = new ObsController({
      host: '127.0.0.1',
      port: 4455,
      password: 'corrected-password',
      client,
    });

    await expect(controller.connect()).rejects.toThrow('Authentication failed.');
    await expect(controller.connect()).resolves.toBeUndefined();
    expect(client.disconnect).toHaveBeenCalledOnce();
    expect(client.connect).toHaveBeenLastCalledWith('ws://127.0.0.1:4455', 'corrected-password');
  });
});
