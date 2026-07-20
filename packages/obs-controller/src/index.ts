import OBSWebSocket from 'obs-websocket-js/json';

type ObsClient = {
  connect: (url: string, password?: string) => Promise<unknown>;
  disconnect: () => Promise<void> | void;
  call: (requestType: string, requestData?: Record<string, unknown>) => Promise<any>;
  on?: (event: string, listener: (data?: any) => void) => void;
};
export type ObsStatus = 'disconnected' | 'connecting' | 'connected' | 'error';

export function isObsAuthenticationError(error: unknown) {
  const code =
    error && typeof error === 'object' && 'code' in error ? Number((error as { code?: unknown }).code) : Number.NaN;
  const message = error instanceof Error ? error.message : String(error ?? '');
  return (
    code === 4009 || /authentication\s+failed|authentifizierung\s+fehlgeschlagen|invalid\s+password/i.test(message)
  );
}

export type NormalizedObsMediaStatus =
  'playing' | 'paused' | 'stopped' | 'ended' | 'none' | 'opening' | 'buffering' | 'error';
export interface NormalizedObsMediaSnapshot {
  status: NormalizedObsMediaStatus;
  rawStatus: string | null;
  mediaPositionMs: number | null;
  mediaDurationMs: number | null;
  inputName: string;
  audioPath: string | null;
  observedAt: string;
  connectionStatus: ObsStatus;
}
export class ObsMediaInputNotFoundError extends Error {
  public readonly code = 'OBS_MEDIA_INPUT_NOT_FOUND';
  constructor(public readonly inputName: string) {
    super(`OBS media input not found: ${inputName}`);
  }
}
export class ObsStreamStartError extends Error {
  public readonly code = 'OBS_STREAM_START_TIMEOUT';
  constructor(public readonly timeoutMs: number) {
    super(`OBS stream did not become active within ${timeoutMs}ms`);
  }
}
const OBS_MEDIA_STATUS_MAP: Record<string, NormalizedObsMediaStatus> = {
  OBS_MEDIA_STATE_PLAYING: 'playing',
  OBS_MEDIA_STATE_PAUSED: 'paused',
  OBS_MEDIA_STATE_STOPPED: 'stopped',
  OBS_MEDIA_STATE_ENDED: 'ended',
  OBS_MEDIA_STATE_NONE: 'none',
  OBS_MEDIA_STATE_OPENING: 'opening',
  OBS_MEDIA_STATE_BUFFERING: 'buffering',
  OBS_MEDIA_STATE_ERROR: 'error',
};

export type PlaybackControlSignal = 'pause' | 'skip' | 'stop';
export type PauseCallbackResult = 'resume' | 'skip' | 'stop' | 'lease_lost' | 'error' | void;
export interface ObsControllerConfig {
  host: string;
  port: number;
  password?: string;
  reconnectMs?: number;
  client?: ObsClient;
  mediaDirectory?: string;
  overlayUrl?: string;
  streamStartTimeoutMs?: number;
  streamStatusPollMs?: number;
}
export interface PlaybackState {
  status: 'idle' | 'preparing' | 'playing' | 'ended' | 'paused' | 'error';
  mediaPositionMs?: number | null;
  mediaDurationMs?: number | null;
  obsMediaStatus?: string | null;
  lastObsSyncAt?: string;
  articleId?: string;
  scene?: string;
  audioPath?: string;
  videoPath?: string;
  startedAt?: string;
  endedAt?: string;
  error?: string;
}
export const MAIN_NEWS_SCENE = '03_MAIN_NEWS';
export const LIVE_STINGER_SCENE = '02_LIVE_STINGER';
export const LIVE_STUDIO_SCENE = '08_LIVE_STUDIO';
export const MAINTENANCE_SCENE = '10_MAINTENANCE';
export const MAIN_BROWSER_INPUT = 'ANS_MAIN_OVERLAY';
export const LIVE_OVERLAY_INPUT = 'ANS_LIVE_OVERLAY';
export const LIVE_CHAT_INPUT = 'ANS_LIVE_CHAT';
export const LIVE_STINGER_INPUT = 'ANS_LIVE_STINGER';
export const LIVE_SWITCH_INPUT = 'ANS_LIVE_SWITCH_OVERLAY';
export const OVERLAY_INPUTS: Record<string, { sceneName: string; inputName: string }> = {
  'main-news': { sceneName: MAIN_NEWS_SCENE, inputName: MAIN_BROWSER_INPUT },
  'breaking-news': { sceneName: '04_BREAKING_NEWS', inputName: 'ANS_BREAKING_OVERLAY' },
  'lower-third': { sceneName: '05_LOWER_THIRD', inputName: 'ANS_LOWER_THIRD_OVERLAY' },
  ticker: { sceneName: '06_TICKER', inputName: 'ANS_TICKER_OVERLAY' },
  maintenance: { sceneName: MAINTENANCE_SCENE, inputName: 'ANS_MAINTENANCE_OVERLAY' },
  'fullscreen-graphic': { sceneName: '07_FULLSCREEN_GRAPHIC', inputName: 'ANS_FULLSCREEN_OVERLAY' },
  'live-studio': { sceneName: LIVE_STUDIO_SCENE, inputName: LIVE_OVERLAY_INPUT },
};
export const VOICE_INPUT = 'ANS_SPRECHER_AUDIO';
export const ARTICLE_VIDEO_INPUT = 'ANS_ARTICLE_VIDEO';
export const CHANNEL_LOGO_INPUT = 'ANS_CHANNEL_LOGO';

export type LiveStudioLayout = 'fullscreen' | 'split' | 'grid' | 'pip' | 'reaction';
export type LiveStudioTransition = 'cut' | 'fade' | 'swipe' | 'slide' | 'luma_wipe';

export interface LiveStudioSourceLayout {
  sourceId: string;
  index: number;
  hidden?: boolean;
}
export interface LiveStudioReactionLayout {
  position: 'left' | 'right' | 'top' | 'bottom';
  sizePercent: number;
  gap: number;
}

function obsTransitionName(transition: LiveStudioTransition) {
  if (transition === 'cut') return 'Cut';
  if (transition === 'swipe') return 'Swipe';
  if (transition === 'slide') return 'Slide';
  if (transition === 'luma_wipe') return 'Luma Wipe';
  return 'Fade';
}

function withCacheBust(url: string) {
  const separator = url.includes('?') ? '&' : '?';
  return `${url}${separator}stingerRun=${Date.now()}_${Math.random().toString(36).slice(2)}`;
}

export function liveStudioInputName(sourceId: string) {
  const normalized = sourceId
    .normalize('NFKD')
    .replace(/[\u0300-\u036f]/g, '')
    .replace(/[^a-zA-Z0-9]+/g, '_')
    .replace(/^_+|_+$/g, '')
    .toUpperCase()
    .slice(0, 60);
  return `ANS_LIVE_${normalized || 'SOURCE'}`;
}

function liveStudioTransform(
  layout: LiveStudioLayout,
  index: number,
  count: number,
  reaction?: LiveStudioReactionLayout,
) {
  const canvasWidth = 1920;
  const canvasHeight = 1080;
  if (layout === 'reaction') {
    if (index === 0) {
      return {
        positionX: 0,
        positionY: 0,
        scaleX: 1,
        scaleY: 1,
        boundsType: 'OBS_BOUNDS_SCALE_INNER',
        boundsWidth: canvasWidth,
        boundsHeight: canvasHeight,
      };
    }
    const position = reaction?.position ?? 'right';
    const gap = Math.max(0, Math.min(80, reaction?.gap ?? 24));
    const sizePercent = Math.max(15, Math.min(45, reaction?.sizePercent ?? 28));
    const cameraIndex = index - 1;
    const cameraCount = Math.max(1, count - 1);
    if (position === 'left' || position === 'right') {
      const desiredWidth = Math.round((canvasWidth * sizePercent) / 100);
      const maxHeight = Math.floor((canvasHeight - gap * (cameraCount + 1)) / cameraCount);
      const height = Math.max(120, Math.min(Math.round((desiredWidth * 9) / 16), maxHeight));
      const width = Math.round((height * 16) / 9);
      return {
        positionX: position === 'left' ? gap : canvasWidth - width - gap,
        positionY: gap + cameraIndex * (height + gap),
        scaleX: width / 1920,
        scaleY: height / 1080,
        boundsType: 'OBS_BOUNDS_SCALE_INNER',
        boundsWidth: width,
        boundsHeight: height,
      };
    }
    const desiredHeight = Math.round((canvasHeight * sizePercent) / 100);
    const maxWidth = Math.floor((canvasWidth - gap * (cameraCount + 1)) / cameraCount);
    const width = Math.max(210, Math.min(Math.round((desiredHeight * 16) / 9), maxWidth));
    const height = Math.round((width * 9) / 16);
    return {
      positionX: gap + cameraIndex * (width + gap),
      positionY: position === 'top' ? gap : canvasHeight - height - gap,
      scaleX: width / 1920,
      scaleY: height / 1080,
      boundsType: 'OBS_BOUNDS_SCALE_INNER',
      boundsWidth: width,
      boundsHeight: height,
    };
  }
  if (layout === 'pip' && count > 1) {
    if (index === 0) {
      return {
        positionX: 0,
        positionY: 0,
        scaleX: canvasWidth / 1920,
        scaleY: canvasHeight / 1080,
        boundsType: 'OBS_BOUNDS_SCALE_INNER',
        boundsWidth: canvasWidth,
        boundsHeight: canvasHeight,
      };
    }
    const pipWidth = count > 2 ? 420 : 520;
    const pipHeight = Math.round((pipWidth / 16) * 9);
    const gap = 28;
    return {
      positionX: canvasWidth - pipWidth - gap,
      positionY: gap + (index - 1) * (pipHeight + gap),
      scaleX: pipWidth / 1920,
      scaleY: pipHeight / 1080,
      boundsType: 'OBS_BOUNDS_SCALE_INNER',
      boundsWidth: pipWidth,
      boundsHeight: pipHeight,
    };
  }
  if (layout === 'split' && count > 1) {
    const width = canvasWidth / Math.min(count, 2);
    return {
      positionX: Math.min(index, 1) * width,
      positionY: 0,
      scaleX: width / 1920,
      scaleY: canvasHeight / 1080,
      boundsType: 'OBS_BOUNDS_SCALE_INNER',
      boundsWidth: width,
      boundsHeight: canvasHeight,
    };
  }
  if (layout === 'grid' && count > 1) {
    const columns = count <= 2 ? count : Math.ceil(Math.sqrt(count));
    const rows = Math.ceil(count / columns);
    const width = canvasWidth / columns;
    const height = canvasHeight / rows;
    return {
      positionX: (index % columns) * width,
      positionY: Math.floor(index / columns) * height,
      scaleX: width / 1920,
      scaleY: height / 1080,
      boundsType: 'OBS_BOUNDS_SCALE_INNER',
      boundsWidth: width,
      boundsHeight: height,
    };
  }
  return {
    positionX: 0,
    positionY: 0,
    scaleX: canvasWidth / 1920,
    scaleY: canvasHeight / 1080,
    boundsType: 'OBS_BOUNDS_SCALE_INNER',
    boundsWidth: canvasWidth,
    boundsHeight: canvasHeight,
  };
}

export function liveOverlayUrlForArticle(overlayUrl: string, articleId: string) {
  try {
    const url = new URL(overlayUrl);
    url.searchParams.set('articleId', articleId);
    url.searchParams.set('overlayRefresh', String(Date.now()));
    return url.toString();
  } catch {
    const separator = overlayUrl.includes('?') ? '&' : '?';
    return `${overlayUrl}${separator}articleId=${encodeURIComponent(articleId)}&overlayRefresh=${Date.now()}`;
  }
}

export class ObsController {
  private obs: ObsClient;
  private status: ObsStatus = 'disconnected';
  private lastError: string | null = null;
  private connecting: Promise<void> | null = null;
  constructor(private cfg: ObsControllerConfig) {
    this.obs = cfg.client ?? (new OBSWebSocket() as unknown as ObsClient);
    this.obs.on?.('ConnectionClosed', () => {
      this.status = 'disconnected';
    });
    this.obs.on?.('ConnectionError', (e: any) => {
      this.status = 'error';
      this.lastError = String(e?.message ?? e);
    });
  }
  getState() {
    return { status: this.status, lastError: this.lastError, endpoint: `ws://${this.cfg.host}:${this.cfg.port}` };
  }
  async connect() {
    if (this.status === 'connected') return;
    if (this.connecting) return this.connecting;
    if (this.status === 'error') {
      await Promise.resolve()
        .then(() => this.obs.disconnect())
        .catch(() => undefined);
    }
    this.status = 'connecting';
    this.connecting = (async () => {
      try {
        await this.obs.connect(`ws://${this.cfg.host}:${this.cfg.port}`, this.cfg.password);
        this.status = 'connected';
        this.lastError = null;
      } catch (e) {
        this.status = 'error';
        this.lastError = e instanceof Error ? e.message : String(e);
        throw e;
      } finally {
        this.connecting = null;
      }
    })();
    return this.connecting;
  }
  async call<T = any>(requestType: string, requestData?: Record<string, unknown>) {
    try {
      await this.connect();
      return (await this.obs.call(requestType, requestData)) as T;
    } catch (e) {
      this.status = 'error';
      this.lastError = e instanceof Error ? e.message : String(e);
      throw e;
    }
  }
  async ensureConnectedWithRetry(attempts = 3) {
    let last: unknown;
    for (let i = 0; i < attempts; i++) {
      try {
        await this.connect();
        return;
      } catch (e) {
        last = e;
        if (i + 1 < attempts) {
          await new Promise((r) => setTimeout(r, Math.min(this.cfg.reconnectMs ?? 1000, 250 * (i + 1))));
        }
      }
    }
    throw last;
  }
  async getScene() {
    return this.call('GetCurrentProgramScene');
  }
  async setScene(sceneName: string) {
    return this.call('SetCurrentProgramScene', { sceneName });
  }
  async setPreviewScene(sceneName: string) {
    await this.ensureScene(sceneName);
    return this.call('SetCurrentPreviewScene', { sceneName });
  }
  async setCurrentTransition(transition: LiveStudioTransition, durationMs?: number) {
    await this.call('SetCurrentSceneTransition', { transitionName: obsTransitionName(transition) }).catch(
      () => undefined,
    );
    if (durationMs !== undefined) {
      await this.call('SetCurrentSceneTransitionDuration', {
        transitionDuration: Math.max(0, Math.min(5000, durationMs)),
      }).catch(() => undefined);
    }
  }
  async takePreviewToProgram(transition: LiveStudioTransition = 'fade', durationMs = 450) {
    await this.setCurrentTransition(transition, durationMs);
    return this.call('TriggerStudioModeTransition').catch(() => this.setScene(LIVE_STUDIO_SCENE));
  }
  async getStreamStatus() {
    return this.call<{
      outputActive: boolean;
      outputReconnecting: boolean;
      outputTimecode: string;
      outputDuration: number;
      outputCongestion: number;
      outputBytes: number;
      outputSkippedFrames: number;
      outputTotalFrames: number;
    }>('GetStreamStatus');
  }
  async startStream() {
    let status = await this.getStreamStatus();
    if (status.outputActive) return status;
    await this.call('StartStream');
    const timeoutMs = Math.max(0, this.cfg.streamStartTimeoutMs ?? 15_000);
    const pollMs = Math.max(10, this.cfg.streamStatusPollMs ?? 500);
    const deadline = Date.now() + timeoutMs;
    do {
      status = await this.getStreamStatus();
      if (status.outputActive) return status;
      if (Date.now() >= deadline) break;
      await new Promise((resolve) => setTimeout(resolve, Math.min(pollMs, Math.max(0, deadline - Date.now()))));
    } while (Date.now() <= deadline);
    throw new ObsStreamStartError(timeoutMs);
  }
  async stopStream() {
    const status = await this.getStreamStatus();
    if (status.outputActive) await this.call('StopStream');
    return this.getStreamStatus();
  }
  async ensureScene(sceneName: string) {
    const scenes = await this.call<{ scenes: { sceneName: string }[] }>('GetSceneList');
    if (!scenes.scenes?.some((s) => s.sceneName === sceneName)) await this.call('CreateScene', { sceneName });
  }
  async ensureInput(sceneName: string, inputName: string, inputKind: string, inputSettings: Record<string, unknown>) {
    await this.ensureScene(sceneName);
    const inputs = await this.call<{ inputs: { inputName: string }[] }>('GetInputList');
    if (inputs.inputs?.some((i) => i.inputName === inputName)) {
      await this.call('SetInputSettings', { inputName, inputSettings, overlay: true });
      return;
    }
    await this.call('CreateInput', { sceneName, inputName, inputKind, inputSettings, sceneItemEnabled: true });
  }
  private async ensureInputInScene(sceneName: string, inputName: string) {
    await this.ensureScene(sceneName);
    const items = await this.call<{ sceneItems: Array<{ sourceName: string; sceneItemId?: number }> }>(
      'GetSceneItemList',
      { sceneName },
    );
    const existing = items.sceneItems?.find((item) => item.sourceName === inputName);
    const created = existing
      ? null
      : await this.call<{ sceneItemId?: number }>('CreateSceneItem', {
          sceneName,
          sourceName: inputName,
          sceneItemEnabled: true,
        });
    const sceneItemId = existing?.sceneItemId ?? created?.sceneItemId;
    if (sceneItemId === undefined) return;
    await this.call('SetSceneItemEnabled', { sceneName, sceneItemId, sceneItemEnabled: true });
    await this.call('SetSceneItemIndex', {
      sceneName,
      sceneItemId,
      sceneItemIndex: existing ? Math.max(0, items.sceneItems.length - 1) : items.sceneItems.length,
    });
  }
  async ensureChannelLogo(url: string) {
    await this.ensureInput(MAINTENANCE_SCENE, CHANNEL_LOGO_INPUT, 'browser_source', {
      url,
      width: 1920,
      height: 1080,
      reroute_audio: false,
      restart_when_active: false,
      shutdown: false,
    });
    const existing = await this.call<{ scenes: Array<{ sceneName: string }> }>('GetSceneList');
    const sceneNames = new Set([
      ...Object.values(OVERLAY_INPUTS).map((target) => target.sceneName),
      ...(existing.scenes ?? []).map((scene) => scene.sceneName),
    ]);
    for (const sceneName of sceneNames) await this.ensureInputInScene(sceneName, CHANNEL_LOGO_INPUT);
    return { inputName: CHANNEL_LOGO_INPUT, scenes: [...sceneNames] };
  }
  async ensureBrowserOverlay(opts: { template: string; url: string; width: number; height: number }) {
    const target = OVERLAY_INPUTS[opts.template] ?? OVERLAY_INPUTS['main-news'];
    await this.ensureScene(MAINTENANCE_SCENE);
    await this.ensureInput(target.sceneName, target.inputName, 'browser_source', {
      url: opts.url,
      width: opts.width,
      height: opts.height,
      reroute_audio: false,
      restart_when_active: false,
      shutdown: false,
    });
    return target;
  }
  async ensureLiveStudioScene(overlayUrl?: string) {
    await this.ensureScene(LIVE_STUDIO_SCENE);
    if (overlayUrl) {
      await this.ensureBrowserOverlay({
        template: 'live-studio',
        url: overlayUrl,
        width: 1920,
        height: 1080,
      });
    }
    return { sceneName: LIVE_STUDIO_SCENE, overlayInputName: LIVE_OVERLAY_INPUT };
  }
  async setLiveOverlayVisible(visible: boolean) {
    const sceneItemId = await this.sceneItemId(LIVE_STUDIO_SCENE, LIVE_OVERLAY_INPUT).catch(() => null);
    if (sceneItemId != null) {
      await this.call('SetSceneItemEnabled', {
        sceneName: LIVE_STUDIO_SCENE,
        sceneItemId,
        sceneItemEnabled: visible,
      }).catch(() => undefined);
    }
    return { sceneName: LIVE_STUDIO_SCENE, inputName: LIVE_OVERLAY_INPUT, sceneItemId, visible };
  }
  async ensureLiveChatSource(opts: { url: string; visible?: boolean }) {
    await this.ensureLiveStudioScene();
    await this.ensureInput(LIVE_STUDIO_SCENE, LIVE_CHAT_INPUT, 'browser_source', {
      url: opts.url,
      width: 520,
      height: 820,
      reroute_audio: false,
      restart_when_active: false,
      shutdown: false,
      css: 'body{background:transparent!important;overflow:hidden!important}::-webkit-scrollbar{display:none!important}',
    });
    const sceneItemId = await this.sceneItemId(LIVE_STUDIO_SCENE, LIVE_CHAT_INPUT);
    if (sceneItemId != null) {
      await this.call('SetSceneItemEnabled', {
        sceneName: LIVE_STUDIO_SCENE,
        sceneItemId,
        sceneItemEnabled: opts.visible !== false,
      }).catch(() => undefined);
      await this.call('SetSceneItemTransform', {
        sceneName: LIVE_STUDIO_SCENE,
        sceneItemId,
        sceneItemTransform: {
          positionX: 1360,
          positionY: 120,
          boundsType: 'OBS_BOUNDS_SCALE_INNER',
          boundsWidth: 520,
          boundsHeight: 820,
          cropLeft: 0,
          cropRight: 0,
          cropTop: 0,
          cropBottom: 0,
        },
      }).catch(() => undefined);
      await this.call('SetSceneItemIndex', {
        sceneName: LIVE_STUDIO_SCENE,
        sceneItemId,
        sceneItemIndex: 50,
      }).catch(() => undefined);
    }
    return { sceneName: LIVE_STUDIO_SCENE, inputName: LIVE_CHAT_INPUT, sceneItemId };
  }
  async setLiveChatVisible(visible: boolean) {
    const sceneItemId = await this.sceneItemId(LIVE_STUDIO_SCENE, LIVE_CHAT_INPUT).catch(() => null);
    if (sceneItemId != null) {
      await this.call('SetSceneItemEnabled', {
        sceneName: LIVE_STUDIO_SCENE,
        sceneItemId,
        sceneItemEnabled: visible,
      }).catch(() => undefined);
    }
    return { sceneName: LIVE_STUDIO_SCENE, inputName: LIVE_CHAT_INPUT, sceneItemId };
  }
  async removeLiveChatSource() {
    const sceneItemId = await this.sceneItemId(LIVE_STUDIO_SCENE, LIVE_CHAT_INPUT).catch(() => null);
    if (sceneItemId != null) {
      await this.call('RemoveSceneItem', { sceneName: LIVE_STUDIO_SCENE, sceneItemId }).catch(() => undefined);
    }
    await this.call('RemoveInput', { inputName: LIVE_CHAT_INPUT }).catch(() => undefined);
    return { sceneName: LIVE_STUDIO_SCENE, inputName: LIVE_CHAT_INPUT };
  }
  async showLiveStinger(opts: { url: string; durationMs?: number }) {
    await this.ensureLiveStudioScene();
    const url = withCacheBust(opts.url);
    await this.ensureInput(LIVE_STUDIO_SCENE, LIVE_STINGER_INPUT, 'browser_source', {
      url,
      width: 1920,
      height: 1080,
      reroute_audio: true,
      restart_when_active: true,
      shutdown: false,
    });
    await this.call('SetInputMute', { inputName: LIVE_STINGER_INPUT, inputMuted: false }).catch(() => undefined);
    const sceneItemId = await this.sceneItemId(LIVE_STUDIO_SCENE, LIVE_STINGER_INPUT);
    if (sceneItemId != null) {
      await this.call('SetSceneItemEnabled', {
        sceneName: LIVE_STUDIO_SCENE,
        sceneItemId,
        sceneItemEnabled: true,
      }).catch(() => undefined);
      await this.call('SetSceneItemIndex', {
        sceneName: LIVE_STUDIO_SCENE,
        sceneItemId,
        sceneItemIndex: 100,
      }).catch(() => undefined);
    }
    const durationMs = Math.max(250, Math.min(10_000, opts.durationMs ?? 2800));
    await new Promise((resolve) => setTimeout(resolve, durationMs));
    if (sceneItemId != null) {
      await this.call('SetSceneItemEnabled', {
        sceneName: LIVE_STUDIO_SCENE,
        sceneItemId,
        sceneItemEnabled: false,
      }).catch(() => undefined);
    }
    return { sceneName: LIVE_STUDIO_SCENE, inputName: LIVE_STINGER_INPUT, sceneItemId };
  }
  async playLiveStingerScene(opts: { url: string; durationMs?: number; nextSceneName?: string }) {
    await this.ensureScene(LIVE_STINGER_SCENE);
    const url = withCacheBust(opts.url);
    await this.ensureInput(LIVE_STINGER_SCENE, LIVE_STINGER_INPUT, 'browser_source', {
      url,
      width: 1920,
      height: 1080,
      reroute_audio: true,
      restart_when_active: true,
      shutdown: false,
    });
    await this.ensureInputInScene(LIVE_STINGER_SCENE, LIVE_STINGER_INPUT);
    await this.call('SetInputMute', { inputName: LIVE_STINGER_INPUT, inputMuted: false }).catch(() => undefined);
    const sceneItemId = await this.sceneItemId(LIVE_STINGER_SCENE, LIVE_STINGER_INPUT);
    if (sceneItemId != null) {
      await this.call('SetSceneItemEnabled', {
        sceneName: LIVE_STINGER_SCENE,
        sceneItemId,
        sceneItemEnabled: true,
      }).catch(() => undefined);
      await this.call('SetSceneItemIndex', {
        sceneName: LIVE_STINGER_SCENE,
        sceneItemId,
        sceneItemIndex: 100,
      }).catch(() => undefined);
    }
    await this.setScene(LIVE_STINGER_SCENE);
    const durationMs = Math.max(250, Math.min(10_000, opts.durationMs ?? 2800));
    await new Promise((resolve) => setTimeout(resolve, durationMs));
    if (opts.nextSceneName) await this.setScene(opts.nextSceneName);
    return { sceneName: LIVE_STINGER_SCENE, inputName: LIVE_STINGER_INPUT, sceneItemId };
  }
  async beginLiveSourceTransition(url: string) {
    await this.ensureLiveStudioScene();
    await this.ensureInput(LIVE_STUDIO_SCENE, LIVE_SWITCH_INPUT, 'browser_source', {
      url: withCacheBust(url),
      width: 1920,
      height: 1080,
      reroute_audio: false,
      restart_when_active: true,
      shutdown: false,
    });
    const sceneItemId = await this.sceneItemId(LIVE_STUDIO_SCENE, LIVE_SWITCH_INPUT);
    if (sceneItemId != null) {
      await this.call('SetSceneItemEnabled', {
        sceneName: LIVE_STUDIO_SCENE,
        sceneItemId,
        sceneItemEnabled: true,
      }).catch(() => undefined);
      await this.call('SetSceneItemIndex', {
        sceneName: LIVE_STUDIO_SCENE,
        sceneItemId,
        sceneItemIndex: 120,
      }).catch(() => undefined);
    }
    return { sceneName: LIVE_STUDIO_SCENE, inputName: LIVE_SWITCH_INPUT, sceneItemId };
  }
  async endLiveSourceTransition() {
    const sceneItemId = await this.sceneItemId(LIVE_STUDIO_SCENE, LIVE_SWITCH_INPUT).catch(() => null);
    if (sceneItemId != null) {
      await this.call('SetSceneItemEnabled', {
        sceneName: LIVE_STUDIO_SCENE,
        sceneItemId,
        sceneItemEnabled: false,
      }).catch(() => undefined);
    }
    return { sceneName: LIVE_STUDIO_SCENE, inputName: LIVE_SWITCH_INPUT, sceneItemId };
  }
  async setProgramAudioMuted(inputMuted: boolean) {
    await this.call('SetInputMute', { inputName: VOICE_INPUT, inputMuted }).catch(() => undefined);
    return { inputName: VOICE_INPUT, inputMuted };
  }
  async resumeProgramAudio(options: { restart?: boolean } = {}) {
    await this.setProgramAudioMuted(false);
    if (options.restart) await this.playMedia(VOICE_INPUT).catch(() => undefined);
    return { inputName: VOICE_INPUT };
  }
  async ensureLiveSource(opts: {
    sourceId: string;
    viewerUrl: string;
    muted?: boolean;
    hidden?: boolean;
    index?: number;
    layout?: LiveStudioLayout;
    sources?: LiveStudioSourceLayout[];
  }) {
    await this.ensureLiveStudioScene();
    const inputName = liveStudioInputName(opts.sourceId);
    await this.ensureInput(LIVE_STUDIO_SCENE, inputName, 'browser_source', {
      url: opts.viewerUrl,
      width: 1920,
      height: 1080,
      reroute_audio: true,
      restart_when_active: false,
      shutdown: false,
    });
    await this.call('SetInputMute', { inputName, inputMuted: Boolean(opts.muted) }).catch(() => undefined);
    const sceneItemId = await this.sceneItemId(LIVE_STUDIO_SCENE, inputName);
    if (sceneItemId != null) {
      await this.call('SetSceneItemEnabled', {
        sceneName: LIVE_STUDIO_SCENE,
        sceneItemId,
        sceneItemEnabled: !opts.hidden,
      }).catch(() => undefined);
      await this.call('SetSceneItemIndex', {
        sceneName: LIVE_STUDIO_SCENE,
        sceneItemId,
        sceneItemIndex: Math.max(0, opts.index ?? 0),
      }).catch(() => undefined);
    }
    if (opts.layout && opts.sources) await this.applyLiveStudioLayout(opts.layout, opts.sources);
    return { sceneName: LIVE_STUDIO_SCENE, inputName, sceneItemId };
  }
  async removeLiveSource(sourceId: string) {
    const inputName = liveStudioInputName(sourceId);
    const sceneItemId = await this.sceneItemId(LIVE_STUDIO_SCENE, inputName).catch(() => null);
    if (sceneItemId != null) {
      await this.call('RemoveSceneItem', { sceneName: LIVE_STUDIO_SCENE, sceneItemId }).catch(() => undefined);
    }
    await this.call('RemoveInput', { inputName }).catch(() => undefined);
    return { sceneName: LIVE_STUDIO_SCENE, inputName };
  }
  async setLiveSourceState(sourceId: string, opts: { muted?: boolean; hidden?: boolean; index?: number }) {
    const inputName = liveStudioInputName(sourceId);
    if (opts.muted !== undefined) await this.call('SetInputMute', { inputName, inputMuted: opts.muted });
    const sceneItemId = await this.sceneItemId(LIVE_STUDIO_SCENE, inputName);
    if (sceneItemId != null && opts.hidden !== undefined) {
      await this.call('SetSceneItemEnabled', {
        sceneName: LIVE_STUDIO_SCENE,
        sceneItemId,
        sceneItemEnabled: !opts.hidden,
      });
    }
    if (sceneItemId != null && opts.index !== undefined) {
      await this.call('SetSceneItemIndex', {
        sceneName: LIVE_STUDIO_SCENE,
        sceneItemId,
        sceneItemIndex: Math.max(0, opts.index),
      });
    }
    return { sceneName: LIVE_STUDIO_SCENE, inputName, sceneItemId };
  }
  async applyLiveStudioLayout(
    layout: LiveStudioLayout,
    sources: LiveStudioSourceLayout[],
    reaction?: LiveStudioReactionLayout,
  ) {
    await this.ensureLiveStudioScene();
    for (const source of sources) {
      const sceneItemId = await this.sceneItemId(LIVE_STUDIO_SCENE, liveStudioInputName(source.sourceId)).catch(
        () => null,
      );
      if (sceneItemId != null) {
        await this.call('SetSceneItemEnabled', {
          sceneName: LIVE_STUDIO_SCENE,
          sceneItemId,
          sceneItemEnabled: !source.hidden,
        }).catch(() => undefined);
      }
    }
    const visible = [...sources].filter((source) => !source.hidden).sort((a, b) => a.index - b.index);
    for (let i = 0; i < visible.length; i++) {
      const source = visible[i];
      const inputName = liveStudioInputName(source.sourceId);
      const sceneItemId = await this.sceneItemId(LIVE_STUDIO_SCENE, inputName).catch(() => null);
      if (sceneItemId == null) continue;
      await this.call('SetSceneItemTransform', {
        sceneName: LIVE_STUDIO_SCENE,
        sceneItemId,
        sceneItemTransform: liveStudioTransform(layout, i, visible.length, reaction),
      });
      await this.call('SetSceneItemIndex', {
        sceneName: LIVE_STUDIO_SCENE,
        sceneItemId,
        sceneItemIndex: i,
      }).catch(() => undefined);
    }
    const overlayItemId = await this.sceneItemId(LIVE_STUDIO_SCENE, LIVE_OVERLAY_INPUT).catch(() => null);
    if (overlayItemId != null) {
      await this.call('SetSceneItemIndex', {
        sceneName: LIVE_STUDIO_SCENE,
        sceneItemId: overlayItemId,
        sceneItemIndex: visible.length + 1,
      }).catch(() => undefined);
    }
    const chatItemId = await this.sceneItemId(LIVE_STUDIO_SCENE, LIVE_CHAT_INPUT).catch(() => null);
    if (chatItemId != null) {
      await this.call('SetSceneItemIndex', {
        sceneName: LIVE_STUDIO_SCENE,
        sceneItemId: chatItemId,
        sceneItemIndex: visible.length + 2,
      }).catch(() => undefined);
    }
    const switchItemId = await this.sceneItemId(LIVE_STUDIO_SCENE, LIVE_SWITCH_INPUT).catch(() => null);
    if (switchItemId != null) {
      await this.call('SetSceneItemIndex', {
        sceneName: LIVE_STUDIO_SCENE,
        sceneItemId: switchItemId,
        sceneItemIndex: visible.length + 3,
      }).catch(() => undefined);
    }
  }
  private async sceneItemId(sceneName: string, sourceName: string) {
    const item = await this.call<{ sceneItemId?: number }>('GetSceneItemId', { sceneName, sourceName }).catch(
      async () => {
        const items = await this.call<{ sceneItems: Array<{ sourceName: string; sceneItemId?: number }> }>(
          'GetSceneItemList',
          { sceneName },
        );
        return items.sceneItems?.find((candidate) => candidate.sourceName === sourceName) ?? null;
      },
    );
    return item?.sceneItemId ?? null;
  }
  async ensureMainNewsScene(overlayUrl: string) {
    await this.ensureBrowserOverlay({ template: 'main-news', url: overlayUrl, width: 1920, height: 1080 });
  }
  async ensureVoiceSource(sceneName: string, audioPath: string) {
    await this.ensureInput(sceneName, VOICE_INPUT, 'ffmpeg_source', {
      local_file: audioPath,
      is_local_file: true,
      restart_on_activate: false,
    });
  }
  async ensureArticleVideoSource(sceneName: string, videoPath: string) {
    await this.ensureInput(sceneName, ARTICLE_VIDEO_INPUT, 'ffmpeg_source', {
      local_file: videoPath,
      is_local_file: true,
      looping: true,
      restart_on_activate: false,
      clear_on_media_end: false,
    });
    await this.call('SetInputMute', { inputName: ARTICLE_VIDEO_INPUT, inputMuted: true });
    const item = await this.call<{ sceneItemId: number }>('GetSceneItemId', {
      sceneName,
      sourceName: ARTICLE_VIDEO_INPUT,
    }).catch(() => null);
    if (item?.sceneItemId != null) {
      await this.call('SetSceneItemIndex', {
        sceneName,
        sceneItemId: item.sceneItemId,
        sceneItemIndex: 0,
      }).catch(() => undefined);
    }
  }

  async getMediaInputStatus(inputName = VOICE_INPUT) {
    const status = await this.call<any>('GetMediaInputStatus', { inputName });
    return {
      inputName,
      mediaState: status.mediaState ?? status.state ?? null,
      mediaCursor: status.mediaCursor ?? status.mediaCursorMs ?? null,
      mediaDuration: status.mediaDuration ?? status.mediaDurationMs ?? null,
      raw: status,
    };
  }
  async getMediaSnapshot(inputName = VOICE_INPUT): Promise<NormalizedObsMediaSnapshot> {
    let status: Awaited<ReturnType<ObsController['getMediaInputStatus']>>;
    try {
      status = await this.getMediaInputStatus(inputName);
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      if (/not found|missing|does not exist|unknown input/i.test(message))
        throw new ObsMediaInputNotFoundError(inputName);
      throw error;
    }
    const settings = await this.call<{ inputSettings?: Record<string, unknown> }>('GetInputSettings', {
      inputName,
    }).catch((error) => {
      const message = error instanceof Error ? error.message : String(error);
      if (/not found|missing|does not exist|unknown input/i.test(message))
        throw new ObsMediaInputNotFoundError(inputName);
      throw error;
    });
    const rawStatus = status.mediaState == null ? null : String(status.mediaState);
    return {
      status: rawStatus ? (OBS_MEDIA_STATUS_MAP[rawStatus] ?? 'error') : 'none',
      rawStatus,
      mediaPositionMs: status.mediaCursor == null ? null : Number(status.mediaCursor),
      mediaDurationMs: status.mediaDuration == null ? null : Number(status.mediaDuration),
      inputName,
      audioPath: typeof settings.inputSettings?.local_file === 'string' ? settings.inputSettings.local_file : null,
      observedAt: new Date().toISOString(),
      connectionStatus: this.status,
    };
  }
  async pauseMedia(inputName = VOICE_INPUT) {
    const result = await this.call('TriggerMediaInputAction', {
      inputName,
      mediaAction: 'OBS_WEBSOCKET_MEDIA_INPUT_ACTION_PAUSE',
    });
    if (inputName === VOICE_INPUT)
      await this.call('TriggerMediaInputAction', {
        inputName: ARTICLE_VIDEO_INPUT,
        mediaAction: 'OBS_WEBSOCKET_MEDIA_INPUT_ACTION_PAUSE',
      }).catch(() => undefined);
    return result;
  }
  async playMedia(inputName = VOICE_INPUT) {
    const result = await this.call('TriggerMediaInputAction', {
      inputName,
      mediaAction: 'OBS_WEBSOCKET_MEDIA_INPUT_ACTION_PLAY',
    });
    if (inputName === VOICE_INPUT)
      await this.call('TriggerMediaInputAction', {
        inputName: ARTICLE_VIDEO_INPUT,
        mediaAction: 'OBS_WEBSOCKET_MEDIA_INPUT_ACTION_PLAY',
      }).catch(() => undefined);
    return result;
  }
  async stopMedia(inputName = VOICE_INPUT) {
    const result = await this.call('TriggerMediaInputAction', {
      inputName,
      mediaAction: 'OBS_WEBSOCKET_MEDIA_INPUT_ACTION_STOP',
    });
    if (inputName === VOICE_INPUT)
      await this.call('TriggerMediaInputAction', {
        inputName: ARTICLE_VIDEO_INPUT,
        mediaAction: 'OBS_WEBSOCKET_MEDIA_INPUT_ACTION_STOP',
      }).catch(() => undefined);
    return result;
  }
  async setMediaCursor(cursorMs: number, inputName = VOICE_INPUT) {
    return this.call('SetMediaInputCursor', { inputName, mediaCursor: cursorMs });
  }
  async playTestContribution(opts: {
    articleId: string;
    audioPath: string;
    videoPath?: string;
    overlayUrl: string;
    onState?: (s: PlaybackState) => Promise<void> | void;
    timeoutMs?: number;
    expectedDurationMs?: number;
    control?: () => Promise<PlaybackControlSignal | undefined> | PlaybackControlSignal | undefined;
    onPaused?: () => Promise<PauseCallbackResult> | PauseCallbackResult;
  }) {
    const emit = async (s: PlaybackState) => opts.onState?.(s);
    await emit({
      status: 'preparing',
      articleId: opts.articleId,
      scene: MAIN_NEWS_SCENE,
      audioPath: opts.audioPath,
      videoPath: opts.videoPath,
      startedAt: new Date().toISOString(),
    });
    await this.ensureConnectedWithRetry();
    if (opts.videoPath) await this.ensureArticleVideoSource(MAIN_NEWS_SCENE, opts.videoPath);
    await this.ensureMainNewsScene(liveOverlayUrlForArticle(opts.overlayUrl, opts.articleId));
    await this.ensureVoiceSource(MAIN_NEWS_SCENE, opts.audioPath);
    await this.call('SetCurrentProgramScene', { sceneName: MAIN_NEWS_SCENE });
    if (opts.videoPath) {
      await this.call('SetInputSettings', {
        inputName: ARTICLE_VIDEO_INPUT,
        inputSettings: { local_file: opts.videoPath, is_local_file: true, looping: true },
        overlay: true,
      });
      await this.call('SetInputMute', { inputName: ARTICLE_VIDEO_INPUT, inputMuted: true });
      await this.call('TriggerMediaInputAction', {
        inputName: ARTICLE_VIDEO_INPUT,
        mediaAction: 'OBS_WEBSOCKET_MEDIA_INPUT_ACTION_RESTART',
      });
    }
    await this.call('SetInputSettings', {
      inputName: VOICE_INPUT,
      inputSettings: { local_file: opts.audioPath, is_local_file: true },
      overlay: true,
    });
    await this.call('TriggerMediaInputAction', {
      inputName: VOICE_INPUT,
      mediaAction: 'OBS_WEBSOCKET_MEDIA_INPUT_ACTION_RESTART',
    });
    await emit({
      status: 'playing',
      articleId: opts.articleId,
      scene: MAIN_NEWS_SCENE,
      audioPath: opts.audioPath,
      videoPath: opts.videoPath,
      startedAt: new Date().toISOString(),
    });
    await this.waitForMediaEnded(
      VOICE_INPUT,
      opts.timeoutMs ?? 300000,
      opts.control,
      opts.onPaused,
      opts.expectedDurationMs,
    );
    if (opts.videoPath) await this.stopMedia(ARTICLE_VIDEO_INPUT).catch(() => undefined);
    await this.call('SetCurrentProgramScene', { sceneName: MAINTENANCE_SCENE });
    await emit({
      status: 'ended',
      articleId: opts.articleId,
      scene: MAINTENANCE_SCENE,
      audioPath: opts.audioPath,
      videoPath: opts.videoPath,
      endedAt: new Date().toISOString(),
    });
  }
  async waitForMediaEnded(
    inputName: string,
    timeoutMs: number,
    control?: () => Promise<PlaybackControlSignal | undefined> | PlaybackControlSignal | undefined,
    onPaused?: () => Promise<PauseCallbackResult> | PauseCallbackResult,
    expectedDurationMs?: number,
  ) {
    const start = Date.now();
    let pausedDurationMs = 0;
    const expectedEndMs =
      expectedDurationMs && Number.isFinite(expectedDurationMs) && expectedDurationMs > 0
        ? Math.max(expectedDurationMs + 5000, Math.ceil(expectedDurationMs * 1.1))
        : null;
    while (Date.now() - start < timeoutMs) {
      const signal = await control?.();
      if (signal === 'stop' || signal === 'skip') {
        throw new Error(signal);
      }
      if (signal === 'pause') {
        const pausedAt = Date.now();
        const pauseResult = await onPaused?.();
        pausedDurationMs += Date.now() - pausedAt;
        if (pauseResult === 'skip') {
          throw new Error('skip');
        }
        if (pauseResult === 'stop' || pauseResult === 'lease_lost') {
          throw new Error('stop');
        }
        if (pauseResult === 'error') throw new Error('pause-callback-error');
      }
      if (expectedEndMs != null && Date.now() - start - pausedDurationMs >= expectedEndMs) {
        void this.stopMedia(inputName).catch(() => undefined);
        return;
      }
      const r = await this.getMediaInputStatus(inputName);
      if (r.mediaState === 'OBS_MEDIA_STATE_ENDED' || r.mediaState === 'OBS_MEDIA_STATE_NONE') return;
      await new Promise((r) => setTimeout(r, 100));
    }
    throw new Error(`Medienende für ${inputName} nicht rechtzeitig erreicht`);
  }
  async stats() {
    return this.call('GetStats');
  }
  async disconnect() {
    try {
      await this.obs.disconnect();
    } finally {
      this.status = 'disconnected';
    }
  }
}
