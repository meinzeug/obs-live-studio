import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import {
  ObsController,
  ARTICLE_VIDEO_INPUT,
  PROGRAM_INTRO_SCENE,
  MAIN_NEWS_SCENE,
  MAINTENANCE_SCENE,
  MAIN_BROWSER_INPUT,
  VOICE_INPUT,
  CHANNEL_LOGO_INPUT,
  STUDIO_BRAND_VIDEO_INPUT,
  LIVE_STUDIO_SCENE,
  LIVE_OVERLAY_INPUT,
  LIVE_CHAT_INPUT,
  LIVE_SWITCH_INPUT,
  YOUTUBE_NEWS_SIDEBAR_SCENE,
  YOUTUBE_NEWS_SIDEBAR_OVERLAY_INPUT,
  YOUTUBE_OVERLAY_INPUT,
  YOUTUBE_VIDEO_INPUT,
  YOUTUBE_VIDEO_SCENE,
  YOUTUBE_CONTEXT_SCENE,
  YOUTUBE_CONTEXT_OVERLAY_INPUT,
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
          (c.requestData?.inputSettings as any)?.reroute_audio === true &&
          String((c.requestData?.inputSettings as any)?.url ?? '').includes('articleId=a') &&
          String((c.requestData?.inputSettings as any)?.url ?? '').includes('overlayRefresh='),
      ),
    ).toBe(true);
    expect(
      server.requests.some(
        (c) =>
          c.requestType === 'SetInputAudioMonitorType' &&
          c.requestData?.inputName === MAIN_BROWSER_INPUT &&
          c.requestData?.monitorType === 'OBS_MONITORING_TYPE_MONITOR_AND_OUTPUT',
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

  it('uses the station film as a muted maintenance background and a one-shot intro with stream audio', async () => {
    server.mediaState = 'ended';
    const videoPath = '/tmp/zeitkante-intro-outro.mp4';
    await obs.ensureStudioBrandVideo(videoPath);

    expect(
      server.requests.some(
        (request) =>
          request.requestType === 'CreateInput' &&
          request.requestData?.sceneName === PROGRAM_INTRO_SCENE &&
          request.requestData?.inputName === STUDIO_BRAND_VIDEO_INPUT &&
          request.requestData?.inputKind === 'ffmpeg_source' &&
          (request.requestData?.inputSettings as any)?.looping === true,
      ),
    ).toBe(true);
    expect(
      server.requests.some(
        (request) =>
          request.requestType === 'CreateSceneItem' &&
          request.requestData?.sceneName === MAINTENANCE_SCENE &&
          request.requestData?.sourceName === STUDIO_BRAND_VIDEO_INPUT,
      ),
    ).toBe(true);

    await obs.playProgramIntro(videoPath, 1000);
    expect(
      server.requests.some(
        (request) =>
          request.requestType === 'SetCurrentProgramScene' && request.requestData?.sceneName === PROGRAM_INTRO_SCENE,
      ),
    ).toBe(true);
    expect(
      server.requests.some(
        (request) =>
          request.requestType === 'SetInputAudioMonitorType' &&
          request.requestData?.inputName === STUDIO_BRAND_VIDEO_INPUT &&
          request.requestData?.monitorType === 'OBS_MONITORING_TYPE_MONITOR_AND_OUTPUT',
      ),
    ).toBe(true);
    const muteValues = server.requests
      .filter(
        (request) =>
          request.requestType === 'SetInputMute' && request.requestData?.inputName === STUDIO_BRAND_VIDEO_INPUT,
      )
      .map((request) => request.requestData?.inputMuted);
    expect(muteValues).toContain(false);
    expect(muteValues.at(-1)).toBe(true);
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
          request.requestData?.sceneName === LIVE_STUDIO_SCENE &&
          (request.requestData?.inputSettings as any)?.reroute_audio === true,
      ),
    ).toBe(true);
    expect(
      server.requests.some(
        (request) =>
          request.requestType === 'SetInputAudioMonitorType' &&
          request.requestData?.inputName === LIVE_OVERLAY_INPUT &&
          request.requestData?.monitorType === 'OBS_MONITORING_TYPE_MONITOR_AND_OUTPUT',
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

    await obs.beginLiveSourceTransition('http://127.0.0.1:12000/overlay/live-studio/source-switch?kind=add');
    await obs.endLiveSourceTransition();
    await obs.setLiveOverlayVisible(false);
    expect(
      server.requests.some(
        (request) =>
          request.requestType === 'CreateInput' &&
          request.requestData?.inputName === LIVE_SWITCH_INPUT &&
          String((request.requestData?.inputSettings as any)?.url ?? '').includes('source-switch'),
      ),
    ).toBe(true);
    expect(
      server.requests.some(
        (request) => request.requestType === 'SetSceneItemEnabled' && request.requestData?.sceneItemEnabled === false,
      ),
    ).toBe(true);

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

  it('creates dedicated OBS scenes for all YouTube formats', async () => {
    await obs.ensureYoutubeVideoSource(YOUTUBE_VIDEO_SCENE, 'http://127.0.0.1:12000/live/youtube/video');
    await obs.ensureYoutubeVideoOverlay('http://127.0.0.1:12000/overlay/youtube-video');
    await obs.ensureYoutubeVideoSource(
      YOUTUBE_NEWS_SIDEBAR_SCENE,
      'http://127.0.0.1:12000/live/youtube/sidebar',
      'news-sidebar',
    );
    await obs.ensureYoutubeNewsSidebarOverlay('http://127.0.0.1:12000/overlay/youtube-news-sidebar');
    await obs.ensureYoutubeVideoSource(
      YOUTUBE_CONTEXT_SCENE,
      'http://127.0.0.1:12000/live/youtube/context',
      'news-sidebar',
    );
    await obs.ensureYoutubeContextOverlay('http://127.0.0.1:12000/overlay/youtube-context');

    expect(
      server.requests.some(
        (request) => request.requestType === 'CreateScene' && request.requestData?.sceneName === YOUTUBE_VIDEO_SCENE,
      ),
    ).toBe(true);
    expect(
      server.requests.some(
        (request) =>
          request.requestType === 'CreateScene' && request.requestData?.sceneName === YOUTUBE_NEWS_SIDEBAR_SCENE,
      ),
    ).toBe(true);
    expect(
      server.requests.some(
        (request) => request.requestType === 'CreateScene' && request.requestData?.sceneName === YOUTUBE_CONTEXT_SCENE,
      ),
    ).toBe(true);
    expect(
      server.requests.some(
        (request) =>
          request.requestType === 'CreateInput' &&
          request.requestData?.sceneName === YOUTUBE_VIDEO_SCENE &&
          request.requestData?.inputName === YOUTUBE_OVERLAY_INPUT &&
          (request.requestData?.inputSettings as any)?.reroute_audio === true,
      ),
    ).toBe(true);
    expect(
      server.requests.some(
        (request) =>
          request.requestType === 'CreateInput' &&
          request.requestData?.sceneName === YOUTUBE_CONTEXT_SCENE &&
          request.requestData?.inputName === YOUTUBE_CONTEXT_OVERLAY_INPUT &&
          (request.requestData?.inputSettings as any)?.reroute_audio === true,
      ),
    ).toBe(true);
    expect(
      server.requests.some(
        (request) =>
          request.requestType === 'CreateInput' &&
          request.requestData?.sceneName === YOUTUBE_NEWS_SIDEBAR_SCENE &&
          request.requestData?.inputName === YOUTUBE_NEWS_SIDEBAR_OVERLAY_INPUT &&
          (request.requestData?.inputSettings as any)?.reroute_audio === true,
      ),
    ).toBe(true);
    expect(
      server.requests.some(
        (request) =>
          request.requestType === 'SetInputAudioMonitorType' &&
          request.requestData?.inputName === YOUTUBE_VIDEO_INPUT &&
          request.requestData?.monitorType === 'OBS_MONITORING_TYPE_MONITOR_AND_OUTPUT',
      ),
    ).toBe(true);
    expect(
      server.requests.some(
        (request) =>
          request.requestType === 'CreateSceneItem' &&
          request.requestData?.sceneName === YOUTUBE_NEWS_SIDEBAR_SCENE &&
          request.requestData?.sourceName === YOUTUBE_VIDEO_INPUT,
      ),
    ).toBe(true);
  });

  it('manages live chat and preview/program transitions without exposing UI clients to OBS internals', async () => {
    await obs.ensureLiveChatSource({ url: 'https://example.test/chat', visible: true });
    await obs.setPreviewScene(LIVE_STUDIO_SCENE);
    await obs.takePreviewToProgram('fade', 600);
    await obs.setLiveChatVisible(false);

    expect(
      server.requests.some(
        (request) =>
          request.requestType === 'CreateInput' &&
          request.requestData?.inputName === LIVE_CHAT_INPUT &&
          (request.requestData?.inputSettings as any)?.url === 'https://example.test/chat',
      ),
    ).toBe(true);
    expect(server.requests.some((request) => request.requestType === 'SetCurrentPreviewScene')).toBe(true);
    expect(
      server.requests.some(
        (request) =>
          request.requestType === 'SetCurrentSceneTransition' && request.requestData?.transitionName === 'Fade',
      ),
    ).toBe(true);
    expect(
      server.requests.some(
        (request) =>
          request.requestType === 'SetCurrentSceneTransitionDuration' &&
          request.requestData?.transitionDuration === 600,
      ),
    ).toBe(true);
    expect(server.requests.some((request) => request.requestType === 'TriggerStudioModeTransition')).toBe(true);
  });

  it('builds a reaction layout with a full-size video and camera rail', async () => {
    await obs.ensureLiveSource({
      sourceId: 'youtube:abcDEF_1234',
      viewerUrl: 'https://www.youtube-nocookie.com/embed/abcDEF_1234?autoplay=1',
    });
    await obs.ensureLiveSource({ sourceId: 'camera-one', viewerUrl: 'https://obs.example.test/viewer/camera-one' });
    await obs.applyLiveStudioLayout(
      'reaction',
      [
        { sourceId: 'youtube:abcDEF_1234', index: 0 },
        { sourceId: 'camera-one', index: 1 },
      ],
      { position: 'right', sizePercent: 28, gap: 24 },
    );

    const transforms = server.requests
      .filter((request) => request.requestType === 'SetSceneItemTransform')
      .map((request) => request.requestData?.sceneItemTransform as Record<string, number>);
    expect(transforms.some((transform) => transform.boundsWidth === 1920 && transform.boundsHeight === 1080)).toBe(
      true,
    );
    expect(
      transforms.some(
        (transform) => transform.boundsWidth < 700 && transform.boundsHeight < 500 && transform.positionX > 1000,
      ),
    ).toBe(true);
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
