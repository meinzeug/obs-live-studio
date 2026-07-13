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
  private server?: InstanceType<typeof WebSocketServer>;
  private sockets = new Set<{ close(): void; terminate(): void }>();
  private inputs = new Map<string, Record<string, unknown>>();
  private scenes = new Set<string>();
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

  countActions(suffix: string) {
    return this.requests.filter(
      (request) =>
        request.requestType === 'TriggerMediaInputAction' &&
        String(request.requestData?.mediaAction ?? '').endsWith(suffix),
    ).length;
  }

  private handle(requestType: string, requestData: Record<string, unknown>) {
    switch (requestType) {
      case 'GetMediaInputStatus':
        if (this.mediaState === 'playing') {
          this.mediaCursor = Math.min(this.mediaCursor + 250, this.mediaDuration);
          if (this.mediaCursor >= this.mediaDuration) this.mediaState = 'ended';
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
        return {};
      case 'CreateInput':
        this.scenes.add(String(requestData.sceneName));
        this.inputs.set(String(requestData.inputName), (requestData.inputSettings as Record<string, unknown>) ?? {});
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
      default:
        return {};
    }
  }
}
