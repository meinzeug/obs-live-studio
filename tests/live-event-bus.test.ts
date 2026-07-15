import { afterEach, describe, expect, it, vi } from 'vitest';
import { LiveEventBus } from '../apps/api/src/liveEventBus.js';

class FakeListener {
  handlers = new Map<string, Array<(value?: any) => void>>();
  connect = vi.fn<() => Promise<void>>().mockResolvedValue(undefined);
  query = vi.fn<(sql: string) => Promise<unknown>>().mockResolvedValue({});
  end = vi.fn<() => Promise<void>>().mockResolvedValue(undefined);

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

function createReply() {
  const chunks: string[] = [];
  return {
    chunks,
    reply: {
      raw: {
        write: vi.fn((chunk: string) => {
          chunks.push(chunk);
          return true;
        }),
        writeHead: vi.fn(),
        end: vi.fn(),
        on: vi.fn(),
        once: vi.fn(),
      },
    },
  };
}

function createBackpressuredReply() {
  const chunks: string[] = [];
  let eventWrites = 0;
  let drainCallback: (() => void) | undefined;
  const write = vi.fn((chunk: string) => {
    chunks.push(chunk);
    if (chunk.includes('event: hello')) return true;
    eventWrites += 1;
    return eventWrites !== 1;
  });
  return {
    chunks,
    write,
    releaseDrain() {
      const callback = drainCallback;
      drainCallback = undefined;
      callback?.();
    },
    reply: {
      raw: {
        write,
        writeHead: vi.fn(),
        end: vi.fn(),
        on: vi.fn(),
        once: vi.fn((event: string, callback: () => void) => {
          if (event === 'drain') drainCallback = callback;
        }),
      },
    },
  };
}

afterEach(() => {
  vi.useRealTimers();
  vi.restoreAllMocks();
});

describe('LiveEventBus', () => {
  it('isolates the event object for every recipient before redaction', async () => {
    const listener = new FakeListener();
    const storedEvent = {
      id: 7,
      type: 'item-started',
      payload: { publicValue: 'visible', internalValue: 'keep' },
    };
    const runQuery = vi.fn().mockResolvedValue({ rows: [storedEvent] });
    const bus = new LiveEventBus('postgres://test', {
      createListener: () => listener,
      listEventsAfter: vi.fn().mockResolvedValue([]),
      runQuery,
    });
    await bus.start();

    const publicRecipient = createReply();
    const internalRecipient = createReply();
    let internalEvent: any;
    await bus.add(publicRecipient.reply, 0, (event) => {
      delete event.payload.internalValue;
      return true;
    });
    await bus.add(internalRecipient.reply, 0, (event) => {
      internalEvent = event;
      return true;
    });

    listener.emit('notification', { payload: '7' });
    await vi.waitFor(() => expect(runQuery).toHaveBeenCalledWith('select * from live_events where id=$1', [7]));
    await vi.waitFor(() => expect(internalEvent).toBeDefined());

    expect(internalEvent.payload.internalValue).toBe('keep');
    expect(storedEvent.payload.internalValue).toBe('keep');
    expect(publicRecipient.chunks.join('')).not.toContain('internalValue');
    expect(internalRecipient.chunks.join('')).toContain('internalValue');

    await bus.close();
  });

  it('waits for drain before writing the next event to a saturated client', async () => {
    const listener = new FakeListener();
    const events = new Map([
      [1, { id: 1, type: 'item-started', payload: { title: 'First' } }],
      [2, { id: 2, type: 'item-started', payload: { title: 'Second' } }],
    ]);
    const runQuery = vi.fn(async (_sql: string, params?: unknown[]) => ({
      rows: [events.get(Number(params?.[0]))].filter(Boolean),
    }));
    const bus = new LiveEventBus('postgres://test', {
      createListener: () => listener,
      listEventsAfter: vi.fn().mockResolvedValue([]),
      runQuery,
    });
    await bus.start();

    const recipient = createBackpressuredReply();
    await bus.add(recipient.reply, 0);

    listener.emit('notification', { payload: '1' });
    await vi.waitFor(() => expect(recipient.chunks.join('')).toContain('id: 1'));

    listener.emit('notification', { payload: '2' });
    await vi.waitFor(() => expect(runQuery).toHaveBeenCalledWith('select * from live_events where id=$1', [2]));
    expect(recipient.chunks.join('')).not.toContain('id: 2');

    recipient.releaseDrain();
    await vi.waitFor(() => expect(recipient.chunks.join('')).toContain('id: 2'));
    expect(recipient.write).toHaveBeenCalledTimes(3);

    await bus.close();
  });

  it('schedules another reconnect after a reconnect attempt fails', async () => {
    vi.useFakeTimers();
    vi.spyOn(console, 'error').mockImplementation(() => undefined);
    const initial = new FakeListener();
    const failedReconnect = new FakeListener();
    failedReconnect.connect.mockRejectedValueOnce(new Error('database unavailable'));
    const recovered = new FakeListener();
    const listeners = [initial, failedReconnect, recovered];
    const createListener = vi.fn(() => {
      const next = listeners.shift();
      if (!next) throw new Error('unexpected listener request');
      return next;
    });
    const bus = new LiveEventBus('postgres://test', {
      createListener,
      listEventsAfter: vi.fn().mockResolvedValue([]),
      runQuery: vi.fn().mockResolvedValue({ rows: [] }),
    });
    await bus.start();

    initial.emit('error', new Error('connection lost'));
    await vi.advanceTimersByTimeAsync(1000);
    expect(failedReconnect.connect).toHaveBeenCalledTimes(1);

    await vi.advanceTimersByTimeAsync(2000);
    expect(recovered.connect).toHaveBeenCalledTimes(1);
    expect(createListener).toHaveBeenCalledTimes(3);

    await bus.close();
  });

  it('does not replay clients from a superseded listener that finishes late', async () => {
    vi.useFakeTimers();
    vi.spyOn(console, 'error').mockImplementation(() => undefined);
    const initial = new FakeListener();
    const recovered = new FakeListener();
    let releaseListen!: () => void;
    const listenGate = new Promise<void>((resolve) => {
      releaseListen = resolve;
    });
    initial.query.mockImplementation(async (sql: string) => {
      if (sql === 'listen live_events') await listenGate;
      return {};
    });
    const listeners = [initial, recovered];
    const listEventsAfter = vi.fn().mockResolvedValue([]);
    const bus = new LiveEventBus('postgres://test', {
      createListener: () => {
        const next = listeners.shift();
        if (!next) throw new Error('unexpected listener request');
        return next;
      },
      listEventsAfter,
      runQuery: vi.fn().mockResolvedValue({ rows: [] }),
    });

    const starting = bus.start();
    await vi.waitFor(() => expect(initial.query).toHaveBeenCalledWith('listen live_events'));
    await bus.add(createReply().reply, 0);
    initial.emit('error', new Error('connection lost'));

    await vi.advanceTimersByTimeAsync(1000);
    expect(recovered.connect).toHaveBeenCalledTimes(1);
    expect(listEventsAfter).toHaveBeenCalledTimes(2);

    releaseListen();
    await starting;
    expect(listEventsAfter).toHaveBeenCalledTimes(2);

    await bus.close();
  });
});
