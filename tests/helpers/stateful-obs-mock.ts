import { EventEmitter } from 'node:events';

export type MockObsMode = 'normal' | 'delayed' | 'timeout' | 'disconnect';
export type MockObsRequest = { requestType: string; requestData?: Record<string, unknown>; at: string };

const stateToObs = {
  playing: 'OBS_MEDIA_STATE_PLAYING',
  paused: 'OBS_MEDIA_STATE_PAUSED',
  stopped: 'OBS_MEDIA_STATE_STOPPED',
  ended: 'OBS_MEDIA_STATE_ENDED',
} as const;

export class StatefulObsWebSocketMock extends EventEmitter {
  readonly requests: MockObsRequest[] = [];
  connected = false;
  mode: MockObsMode = 'normal';
  mediaState: keyof typeof stateToObs = 'stopped';
  mediaCursor = 0;
  mediaDuration = 1_000;
  private inputs = new Map<string, Record<string, unknown>>();
  private scenes = new Set<string>();
  private currentScene = '';

  async connect() {
    if (this.mode === 'disconnect') throw new Error('obs-disconnected');
    this.connected = true;
  }

  disconnect() {
    this.connected = false;
    this.emit('ConnectionClosed');
  }

  setMode(mode: MockObsMode) {
    this.mode = mode;
  }

  advance(ms: number) {
    if (this.mediaState !== 'playing') return;
    this.mediaCursor = Math.min(this.mediaCursor + ms, this.mediaDuration);
    if (this.mediaCursor >= this.mediaDuration) this.mediaState = 'ended';
  }

  async call(requestType: string, requestData: Record<string, unknown> = {}) {
    if (!this.connected || this.mode === 'disconnect') throw new Error('obs-disconnected');
    this.requests.push({ requestType, requestData, at: new Date().toISOString() });
    if (this.mode === 'timeout' && requestType === 'GetMediaInputStatus') {
      this.mediaState = 'playing';
    }
    if (this.mode === 'delayed') await new Promise((resolve) => setTimeout(resolve, 25));

    switch (requestType) {
      case 'GetMediaInputStatus':
        this.advance(100);
        return {
          mediaState: stateToObs[this.mediaState],
          mediaCursor: this.mediaCursor,
          mediaDuration: this.mediaDuration,
        };
      case 'GetInputSettings':
        return { inputSettings: this.inputs.get(String(requestData.inputName)) ?? {} };
      case 'TriggerMediaInputAction': {
        const action = String(requestData.mediaAction ?? '');
        if (action.endsWith('_PAUSE')) this.mediaState = 'paused';
        if (action.endsWith('_PLAY') || action.endsWith('_RESTART')) this.mediaState = 'playing';
        if (action.endsWith('_STOP')) this.mediaState = 'stopped';
        if (action.endsWith('_RESTART')) this.mediaCursor = 0;
        return {};
      }
      case 'SetMediaInputCursor':
        this.mediaCursor = Number(requestData.mediaCursor ?? 0);
        return {};
      case 'SetInputSettings':
        this.inputs.set(String(requestData.inputName), {
          ...(this.inputs.get(String(requestData.inputName)) ?? {}),
          ...((requestData.inputSettings as Record<string, unknown> | undefined) ?? {}),
        });
        return {};
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
      case 'SetCurrentProgramScene':
        this.currentScene = String(requestData.sceneName);
        return {};
      case 'GetCurrentProgramScene':
        return { currentProgramSceneName: this.currentScene };
      default:
        return {};
    }
  }

  countActions(suffix: string) {
    return this.requests.filter(
      (request) =>
        request.requestType === 'TriggerMediaInputAction' &&
        String(request.requestData?.mediaAction ?? '').endsWith(suffix),
    ).length;
  }
}
