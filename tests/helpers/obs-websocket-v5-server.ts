import { createRequire } from 'node:module';

const { WebSocketServer } = createRequire(import.meta.url)('ws') as {
  WebSocketServer: new (options: Record<string, unknown>) => {
    on(event: string, listener: (...args: any[]) => void): void;
    once(event: string, listener: (...args: any[]) => void): void;
    address(): string | { port: number } | null;
    close(callback: () => void): void;
  };
};

export type ObsMockMode = 'normal' | 'delayed' | 'timeout' | 'disconnect';
export type ObsMockRequest = { requestType: string; requestData?: Record<string, unknown> };
const mediaStates = {
  playing: 'OBS_MEDIA_STATE_PLAYING',
  paused: 'OBS_MEDIA_STATE_PAUSED',
  stopped: 'OBS_MEDIA_STATE_STOPPED',
  ended: 'OBS_MEDIA_STATE_ENDED',
} as const;

export class ObsWebSocketV5TestServer {
  readonly requests: ObsMockRequest[] = [];
  mode: ObsMockMode = 'normal';
  mediaState: keyof typeof mediaStates = 'stopped';
  mediaCursor = 0;
  mediaDuration = 1000;
  cursorStep = 250;
  holdPlaying = false;
  streamActive = false;
  streamStartSucceeds = true;
  private server?: InstanceType<typeof WebSocketServer>;
  private sockets = new Set<{ close(): void; terminate(): void }>();
  private inputs = new Map<string, Record<string, unknown>>();
  private scenes = new Set<string>();
  private sceneItems = new Map<string, Set<string>>();
  private sceneItemIds = new Map<string, number>();
  private nextSceneItemId = 1;
  private currentScene = '';

  get port() {
    const address = this.server?.address();
    if (!address || typeof address === 'string') throw new Error('OBS mock not listening');
    return address.port;
  }

  async start(port = 0) {
    this.server = new WebSocketServer({ host: '127.0.0.1', port, handleProtocols: () => 'obswebsocket.json' });
    this.server.on('connection', (socket) => {
      this.sockets.add(socket);
      socket.on('close', () => this.sockets.delete(socket));
      socket.send(JSON.stringify({ op: 0, d: { obsWebSocketVersion: '5.0.0', rpcVersion: 1 } }));
      socket.on('message', async (raw: unknown) => {
        const msg = JSON.parse(String(raw));
        if (msg.op === 1) {
          socket.send(JSON.stringify({ op: 2, d: { negotiatedRpcVersion: 1 } }));
          return;
        }
        if (msg.op !== 6) return;
        const { requestId, requestType, requestData = {} } = msg.d;
        this.requests.push({ requestType, requestData });
        if (this.mode === 'disconnect') {
          socket.close();
          return;
        }
        if (this.mode === 'timeout') return;
        if (this.mode === 'delayed') await new Promise((resolve) => setTimeout(resolve, 75));
        socket.send(
          JSON.stringify({
            op: 7,
            d: {
              requestId,
              requestStatus: { result: true, code: 100 },
              responseData: this.handle(requestType, requestData),
            },
          }),
        );
      });
    });
    await new Promise<void>((resolve) => this.server!.once('listening', resolve));
  }

  async stop() {
    for (const socket of this.sockets) socket.terminate();
    await new Promise<void>((resolve) => this.server?.close(() => resolve()));
  }

  configure(config: {
    mediaDuration?: number;
    cursorStep?: number;
    holdPlaying?: boolean;
    mediaState?: keyof typeof mediaStates;
  }) {
    if (config.mediaDuration != null) this.mediaDuration = config.mediaDuration;
    if (config.cursorStep != null) this.cursorStep = config.cursorStep;
    if (config.holdPlaying != null) this.holdPlaying = config.holdPlaying;
    if (config.mediaState != null) this.mediaState = config.mediaState;
    if (config.mediaState === 'stopped') this.mediaCursor = 0;
    if (config.mediaState === 'ended') this.mediaCursor = this.mediaDuration;
  }

  countActions(suffix: string, inputName?: string) {
    return this.requests.filter(
      (request) =>
        request.requestType === 'TriggerMediaInputAction' &&
        String(request.requestData?.mediaAction ?? '').endsWith(suffix) &&
        (!inputName || request.requestData?.inputName === inputName),
    ).length;
  }

  private handle(requestType: string, requestData: Record<string, unknown>) {
    switch (requestType) {
      case 'GetMediaInputStatus':
        if (this.mediaState === 'playing') {
          this.mediaCursor = Math.min(this.mediaCursor + this.cursorStep, this.mediaDuration);
          if (this.mediaCursor >= this.mediaDuration && !this.holdPlaying) this.mediaState = 'ended';
        }
        return {
          mediaState: mediaStates[this.mediaState],
          mediaCursor: this.mediaCursor,
          mediaDuration: this.mediaDuration,
        };
      case 'TriggerMediaInputAction': {
        const action = String(requestData.mediaAction ?? '');
        if (action.endsWith('_PAUSE')) this.mediaState = 'paused';
        if (action.endsWith('_PLAY') || action.endsWith('_RESTART')) this.mediaState = 'playing';
        if (action.endsWith('_STOP')) this.mediaState = 'stopped';
        if (action.endsWith('_RESTART')) this.mediaCursor = 0;
        return {};
      }
      case 'GetSceneList':
        return { scenes: [...this.scenes].map((sceneName) => ({ sceneName })) };
      case 'GetInputList':
        return { inputs: [...this.inputs.keys()].map((inputName) => ({ inputName })) };
      case 'CreateScene':
        this.scenes.add(String(requestData.sceneName));
        this.sceneItems.set(String(requestData.sceneName), new Set());
        return {};
      case 'CreateInput':
        this.scenes.add(String(requestData.sceneName));
        this.inputs.set(String(requestData.inputName), (requestData.inputSettings as Record<string, unknown>) ?? {});
        if (!this.sceneItems.has(String(requestData.sceneName)))
          this.sceneItems.set(String(requestData.sceneName), new Set());
        this.sceneItems.get(String(requestData.sceneName))!.add(String(requestData.inputName));
        this.ensureSceneItemId(String(requestData.sceneName), String(requestData.inputName));
        return {};
      case 'GetSceneItemList':
        return {
          sceneItems: [...(this.sceneItems.get(String(requestData.sceneName)) ?? [])].map((sourceName) => ({
            sourceName,
            sceneItemId: this.ensureSceneItemId(String(requestData.sceneName), sourceName),
          })),
        };
      case 'CreateSceneItem':
        if (!this.sceneItems.has(String(requestData.sceneName)))
          this.sceneItems.set(String(requestData.sceneName), new Set());
        this.sceneItems.get(String(requestData.sceneName))!.add(String(requestData.sourceName));
        return { sceneItemId: this.ensureSceneItemId(String(requestData.sceneName), String(requestData.sourceName)) };
      case 'GetSceneItemId':
        return { sceneItemId: this.ensureSceneItemId(String(requestData.sceneName), String(requestData.sourceName)) };
      case 'SetSceneItemEnabled':
      case 'SetSceneItemIndex':
      case 'SetSceneItemTransform':
        return {};
      case 'RemoveInput':
        this.inputs.delete(String(requestData.inputName));
        for (const items of this.sceneItems.values()) items.delete(String(requestData.inputName));
        return {};
      case 'RemoveSceneItem':
        for (const [sceneName, items] of this.sceneItems.entries()) {
          if (sceneName === String(requestData.sceneName)) {
            for (const sourceName of items) {
              const key = `${sceneName}:${sourceName}`;
              if (this.sceneItemIds.get(key) === Number(requestData.sceneItemId)) items.delete(sourceName);
            }
          }
        }
        return {};
      case 'SetInputMute':
        return {};
      case 'SetInputSettings':
        this.inputs.set(String(requestData.inputName), {
          ...(this.inputs.get(String(requestData.inputName)) ?? {}),
          ...((requestData.inputSettings as Record<string, unknown>) ?? {}),
        });
        return {};
      case 'GetInputSettings':
        return { inputSettings: this.inputs.get(String(requestData.inputName)) ?? {} };
      case 'SetCurrentProgramScene':
        this.currentScene = String(requestData.sceneName);
        return {};
      case 'GetCurrentProgramScene':
        return { currentProgramSceneName: this.currentScene };
      case 'GetStreamStatus':
        return {
          outputActive: this.streamActive,
          outputReconnecting: false,
          outputTimecode: '00:00:00.000',
          outputDuration: 0,
          outputCongestion: 0,
          outputBytes: 0,
          outputSkippedFrames: 0,
          outputTotalFrames: 0,
        };
      case 'StartStream':
        if (this.streamStartSucceeds) this.streamActive = true;
        return {};
      case 'StopStream':
        this.streamActive = false;
        return {};
      default:
        return {};
    }
  }

  private ensureSceneItemId(sceneName: string, sourceName: string) {
    const key = `${sceneName}:${sourceName}`;
    const existing = this.sceneItemIds.get(key);
    if (existing) return existing;
    const next = this.nextSceneItemId++;
    this.sceneItemIds.set(key, next);
    return next;
  }
}
