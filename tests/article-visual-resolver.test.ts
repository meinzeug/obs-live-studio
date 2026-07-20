import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { ARTICLE_VIDEO_INPUT, MAIN_NEWS_SCENE, ObsController } from '../packages/obs-controller/src/index.js';
import {
  ARTICLE_GRAPHIC_INPUT,
  installArticleVisualResolver,
} from '../packages/obs-controller/src/article-visual-resolver.js';
import { ObsWebSocketV5TestServer } from './helpers/obs-websocket-v5-server.js';

let server: ObsWebSocketV5TestServer;
let obs: ObsController;

beforeEach(async () => {
  server = new ObsWebSocketV5TestServer();
  await server.start();
  server.mediaState = 'ended';
  obs = new ObsController({ host: '127.0.0.1', port: server.port });
});

afterEach(async () => {
  await server.stop();
});

describe('article visual resolver', () => {
  it('injects a muted looping video and optional graphic into contribution playback', async () => {
    installArticleVisualResolver(async () => ({
      video: { storage_path: '/var/media/article.mp4' },
      graphic: { storage_path: '/var/media/statistic.png' },
    }));

    await obs.playTestContribution({
      articleId: 'article-1',
      audioPath: '/var/tts/article.wav',
      overlayUrl: 'http://127.0.0.1:12000/overlay/main',
      timeoutMs: 3000,
    });

    expect(server.requests).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          requestType: 'CreateInput',
          requestData: expect.objectContaining({
            inputName: ARTICLE_VIDEO_INPUT,
            inputKind: 'ffmpeg_source',
            inputSettings: expect.objectContaining({
              local_file: '/var/media/article.mp4',
              looping: true,
            }),
          }),
        }),
        expect.objectContaining({
          requestType: 'CreateInput',
          requestData: expect.objectContaining({
            inputName: ARTICLE_GRAPHIC_INPUT,
            inputKind: 'image_source',
            inputSettings: expect.objectContaining({ file: '/var/media/statistic.png' }),
          }),
        }),
        expect.objectContaining({
          requestType: 'SetInputMute',
          requestData: { inputName: ARTICLE_VIDEO_INPUT, inputMuted: true },
        }),
      ]),
    );
    expect(
      server.requests.some(
        (request) =>
          request.requestType === 'TriggerMediaInputAction' &&
          request.requestData?.inputName === ARTICLE_VIDEO_INPUT &&
          String(request.requestData?.mediaAction).endsWith('_RESTART'),
      ),
    ).toBe(true);
  });

  it('plays a contribution with an approved graphic even when no local video exists', async () => {
    installArticleVisualResolver(async () => ({
      video: null,
      graphic: { storage_path: '/var/media/statistic.png' },
      videoRequired: true,
    }));

    await obs.playTestContribution({
      articleId: 'article-with-graphic',
      audioPath: '/var/tts/article.wav',
      overlayUrl: 'http://127.0.0.1:12000/overlay/main',
      timeoutMs: 3000,
    });

    expect(server.requests).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          requestType: 'CreateInput',
          requestData: expect.objectContaining({
            inputName: ARTICLE_GRAPHIC_INPUT,
            inputKind: 'image_source',
            inputSettings: expect.objectContaining({ file: '/var/media/statistic.png' }),
          }),
        }),
        expect.objectContaining({
          requestType: 'SetCurrentProgramScene',
          requestData: { sceneName: MAIN_NEWS_SCENE },
        }),
      ]),
    );
    expect(
      server.requests.some(
        (request) => request.requestType === 'CreateInput' && request.requestData?.inputName === ARTICLE_VIDEO_INPUT,
      ),
    ).toBe(false);
  });

  it('fails before OBS scene playback when no approved local visual exists', async () => {
    installArticleVisualResolver(async () => ({ video: null, graphic: null }));

    await expect(
      obs.playTestContribution({
        articleId: 'article-without-visual',
        audioPath: '/var/tts/article.wav',
        overlayUrl: 'http://127.0.0.1:12000/overlay/main',
      }),
    ).rejects.toThrow(/Kein freigegebenes lokales Video oder Bild\/Grafik/);

    expect(server.requests.some((request) => request.requestType === 'SetCurrentProgramScene')).toBe(false);
  });
});
