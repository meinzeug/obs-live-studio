import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { cloneLiveEventForClient, LiveEventBus } from '../apps/api/src/liveEventBus.js';

class FakeListener {
  private handlers = new Map<string, Array<(value?: any) => void>>();
  readonly connect = vi.fn<() => Promise<void>>();
  readonly query = vi.fn(async () => ({ rows: [] }));
  readonly end = vi.fn(async () => undefined);

  constructor(connectResult: 'success' | 'failure' = 'success') {
    this.connect.mockImplementation(async () => {
      if (connectResult === 'failure') throw new Error('database unavailable');
    });
  }

  on(event: string, callback: (value?: any) => void) {
    const callbacks = this.handlers.get(event) ?? [];
    callbacks.push(callback);
    this.handlers.set(event, callbacks);
    return this;
  }

  emit(event: string, value?: any) {
    for (const callback of this.handlers.get(event) ?? []) callback(value);
  }
}

describe('LiveEventBus', () => {
  beforeEach(() => {
    vi.useFakeTimers();
  });

  afterEach(() => {
    vi.useRealTimers();
    vi.restoreAllMocks();
  });

  it('isolates event payloads before a client filter redacts them', () => {
    const original = {
      id: 12,
      type: 'item-started',
      payload: { articleId: 'article-1', audioPath: '/private/audio.wav' },
    };
    const cloned = cloneLiveEventForClient(original);
    delete cloned.payload.audioPath;

    expect(cloned.payload).not.toHaveProperty('audioPath');
    expect(original.payload.audioPath).toBe('/private/audio.wav');

    const bus = new LiveEventBus(undefined) as any;
    const redacted = bus.eventForClient(
      {
        filter: (event: any) => {
          delete event.payload.audioPath;
          return true;
        },
      },
      original,
    );
    const internal = bus.eventForClient({ filter: undefined }, original);

    expect(redacted.payload).not.toHaveProperty('audioPath');
    expect(internal.payload.audioPath).toBe('/private/audio.wav');
    expect(original.payload.audioPath).toBe('/private/audio.wav');
  });

  it('continues retrying after a reconnect attempt itself fails', async () => {
    const listeners = [new FakeListener('success'), new FakeListener('failure'), new FakeListener('success')];
    const factory = vi.fn(() => {
      const listener = listeners[factory.mock.calls.length - 1];
      if (!listener) throw new Error('unexpected listener request');
      return listener;
    });
    const bus = new LiveEventBus('postgres://studio.test/database', factory as any);

    await bus.start();
    expect(factory).toHaveBeenCalledTimes(1);
    listeners[0].emit('error', new Error('connection lost'));

    await vi.advanceTimersByTimeAsync(1000);
    expect(factory).toHaveBeenCalledTimes(2);
    await vi.advanceTimersByTimeAsync(2000);
    expect(factory).toHaveBeenCalledTimes(3);
    expect(listeners[2].query).toHaveBeenCalledWith('listen live_events');

    await bus.close();
  });

  it('cancels pending reconnects during shutdown', async () => {
    const listener = new FakeListener('success');
    const factory = vi.fn(() => listener);
    const bus = new LiveEventBus('postgres://studio.test/database', factory as any);

    await bus.start();
    listener.emit('error', new Error('connection lost'));
    await bus.close();
    await vi.advanceTimersByTimeAsync(60_000);

    expect(factory).toHaveBeenCalledTimes(1);
    expect(listener.end).toHaveBeenCalled();
  });
});
