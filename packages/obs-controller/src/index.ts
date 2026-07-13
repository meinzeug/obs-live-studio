import OBSWebSocket from 'obs-websocket-js/json';

type ObsClient = {
  connect: (url: string, password?: string) => Promise<unknown>;
  disconnect: () => Promise<void> | void;
  call: (requestType: string, requestData?: Record<string, unknown>) => Promise<any>;
  on?: (event: string, listener: (data?: any) => void) => void;
};
export type ObsStatus = 'disconnected' | 'connecting' | 'connected' | 'error';

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
  startedAt?: string;
  endedAt?: string;
  error?: string;
}
export const MAIN_NEWS_SCENE = '03_MAIN_NEWS';
export const MAINTENANCE_SCENE = '10_MAINTENANCE';
export const MAIN_BROWSER_INPUT = 'ANS_MAIN_OVERLAY';
export const OVERLAY_INPUTS: Record<string, { sceneName: string; inputName: string }> = {
  'main-news': { sceneName: MAIN_NEWS_SCENE, inputName: MAIN_BROWSER_INPUT },
  'breaking-news': { sceneName: '04_BREAKING_NEWS', inputName: 'ANS_BREAKING_OVERLAY' },
  'lower-third': { sceneName: '05_LOWER_THIRD', inputName: 'ANS_LOWER_THIRD_OVERLAY' },
  ticker: { sceneName: '06_TICKER', inputName: 'ANS_TICKER_OVERLAY' },
  maintenance: { sceneName: MAINTENANCE_SCENE, inputName: 'ANS_MAINTENANCE_OVERLAY' },
  'fullscreen-graphic': { sceneName: '07_FULLSCREEN_GRAPHIC', inputName: 'ANS_FULLSCREEN_OVERLAY' },
};
export const VOICE_INPUT = 'ANS_SPRECHER_AUDIO';
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
        await new Promise((r) => setTimeout(r, Math.min(this.cfg.reconnectMs ?? 1000, 250 * (i + 1))));
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
    const status = await this.getStreamStatus();
    if (!status.outputActive) await this.call('StartStream');
    return this.getStreamStatus();
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
    return this.call('TriggerMediaInputAction', { inputName, mediaAction: 'OBS_WEBSOCKET_MEDIA_INPUT_ACTION_PAUSE' });
  }
  async playMedia(inputName = VOICE_INPUT) {
    return this.call('TriggerMediaInputAction', { inputName, mediaAction: 'OBS_WEBSOCKET_MEDIA_INPUT_ACTION_PLAY' });
  }
  async stopMedia(inputName = VOICE_INPUT) {
    return this.call('TriggerMediaInputAction', { inputName, mediaAction: 'OBS_WEBSOCKET_MEDIA_INPUT_ACTION_STOP' });
  }
  async setMediaCursor(cursorMs: number, inputName = VOICE_INPUT) {
    return this.call('SetMediaInputCursor', { inputName, mediaCursor: cursorMs });
  }
  async playTestContribution(opts: {
    articleId: string;
    audioPath: string;
    overlayUrl: string;
    onState?: (s: PlaybackState) => Promise<void> | void;
    timeoutMs?: number;
    control?: () => Promise<PlaybackControlSignal | undefined> | PlaybackControlSignal | undefined;
    onPaused?: () => Promise<PauseCallbackResult> | PauseCallbackResult;
  }) {
    const emit = async (s: PlaybackState) => opts.onState?.(s);
    await emit({
      status: 'preparing',
      articleId: opts.articleId,
      scene: MAIN_NEWS_SCENE,
      audioPath: opts.audioPath,
      startedAt: new Date().toISOString(),
    });
    await this.ensureConnectedWithRetry();
    await this.ensureMainNewsScene(opts.overlayUrl);
    await this.ensureVoiceSource(MAIN_NEWS_SCENE, opts.audioPath);
    await this.call('SetCurrentProgramScene', { sceneName: MAIN_NEWS_SCENE });
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
      startedAt: new Date().toISOString(),
    });
    await this.waitForMediaEnded(VOICE_INPUT, opts.timeoutMs ?? 300000, opts.control, opts.onPaused);
    await this.call('SetCurrentProgramScene', { sceneName: MAINTENANCE_SCENE });
    await emit({
      status: 'ended',
      articleId: opts.articleId,
      scene: MAINTENANCE_SCENE,
      audioPath: opts.audioPath,
      endedAt: new Date().toISOString(),
    });
  }
  async waitForMediaEnded(
    inputName: string,
    timeoutMs: number,
    control?: () => Promise<PlaybackControlSignal | undefined> | PlaybackControlSignal | undefined,
    onPaused?: () => Promise<PauseCallbackResult> | PauseCallbackResult,
  ) {
    const start = Date.now();
    while (Date.now() - start < timeoutMs) {
      const signal = await control?.();
      if (signal === 'stop' || signal === 'skip') {
        throw new Error(signal);
      }
      if (signal === 'pause') {
        const pauseResult = await onPaused?.();
        if (pauseResult === 'skip') {
          throw new Error('skip');
        }
        if (pauseResult === 'stop' || pauseResult === 'lease_lost') {
          throw new Error('stop');
        }
        if (pauseResult === 'error') throw new Error('pause-callback-error');
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
    await this.obs.disconnect();
    this.status = 'disconnected';
  }
}
