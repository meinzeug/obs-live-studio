import pg from 'pg';
import { listLiveEventsAfter, query } from '@ans/database';
import { boundedRuntimeNumber } from './runtime-values.js';

type RawSse = {
  write: (chunk: string) => boolean;
  writeHead?: (code: number, headers: Record<string, string>) => void;
  end: () => void;
  on: (event: string, cb: () => void) => void;
  once?: (event: string, cb: () => void) => void;
};
type Client = { raw: RawSse };
type BacklogEvent = { id: number; type: string; chunk: string };
type BusClient = {
  reply: Client;
  scanCursor: number;
  lastDeliveredId: number;
  closed: boolean;
  draining: boolean;
  backlog: BacklogEvent[];
  filter?: (ev: any) => boolean;
};
type Listener = {
  on: (event: string, cb: (value?: any) => void) => unknown;
  connect: () => Promise<void>;
  query: (sql: string) => Promise<unknown>;
  end: () => Promise<void>;
};

export interface LiveEventBusOptions {
  createListener?: (databaseUrl: string) => Listener;
  listEventsAfter?: typeof listLiveEventsAfter;
  runQuery?: typeof query;
  backpressureLimit?: number;
}

export function isolateLiveEvent<T>(event: T): T {
  if (typeof structuredClone === 'function') return structuredClone(event);
  return JSON.parse(JSON.stringify(event)) as T;
}

export class LiveEventBus {
  private listener: Listener | null = null;
  private clients = new Set<BusClient>();
  private heartbeat: NodeJS.Timeout | null = null;
  private reconnect: NodeJS.Timeout | null = null;
  private cleanup: NodeJS.Timeout | null = null;
  private reconnecting = false;
  private reconnectAttempts = 0;
  private delivery = Promise.resolve();
  private stopped = false;
  constructor(
    private databaseUrl = process.env.DATABASE_URL,
    private options: LiveEventBusOptions = {},
  ) {}
  async start() {
    if (this.listener || !this.databaseUrl) return;
    this.stopped = false;
    await this.connect();
    this.heartbeat = setInterval(() => this.heartbeatClients(), 15000);
    this.cleanup = setInterval(
      () =>
        void (this.options.runQuery ?? query)(
          `delete from live_events where created_at < now()-interval '48 hours'`,
        ).catch((e) => console.error('live-event cleanup failed', e)),
      3600000,
    );
    this.cleanup.unref?.();
  }
  private async connect() {
    const listener = this.options.createListener
      ? this.options.createListener(this.databaseUrl!)
      : (new pg.Client({ connectionString: this.databaseUrl }) as unknown as Listener);
    this.listener = listener;
    listener.on('notification', (msg) => {
      if (this.listener !== listener || this.stopped) return;
      const id = Number(msg?.payload);
      this.delivery = this.delivery
        .then(() => this.deliverId(id))
        .catch((e) => console.error('live-event delivery failed', e));
    });
    listener.on('error', (e) => {
      if (this.listener !== listener || this.stopped) return;
      console.error('live-event listen error', e);
      this.scheduleReconnect();
    });
    listener.on('end', () => {
      if (this.listener === listener && !this.stopped) this.scheduleReconnect();
    });
    await listener.connect();
    await listener.query('listen live_events');
    if (this.stopped || this.listener !== listener) {
      if (this.listener === listener) this.listener = null;
      await listener.end().catch(() => undefined);
      return;
    }
    this.reconnectAttempts = 0;
    await this.replayAllClients();
  }
  private scheduleReconnect() {
    if (this.stopped || this.reconnect || this.reconnecting) return;
    const listener = this.listener;
    this.listener = null;
    void listener?.end().catch(() => undefined);
    const delay = Math.min(30000, 2 ** this.reconnectAttempts * 1000);
    this.reconnectAttempts += 1;
    this.reconnect = setTimeout(async () => {
      this.reconnect = null;
      this.reconnecting = true;
      let retry = false;
      try {
        await this.connect();
      } catch (e) {
        retry = true;
        console.error('live-event reconnect failed', e);
      } finally {
        this.reconnecting = false;
        if (retry) this.scheduleReconnect();
      }
    }, delay);
    this.reconnect.unref?.();
  }
  async add(reply: Client, lastId: number, filter?: (ev: any) => boolean) {
    const client: BusClient = {
      reply,
      scanCursor: Number.isFinite(lastId) ? lastId : 0,
      lastDeliveredId: Number.isFinite(lastId) ? lastId : 0,
      closed: false,
      draining: false,
      backlog: [],
      filter,
    };
    this.clients.add(client);
    reply.raw.on('close', () => this.remove(client));
    reply.raw.writeHead?.(200, {
      'content-type': 'text/event-stream',
      'cache-control': 'no-store',
      connection: 'keep-alive',
    });
    this.enqueue(client, {
      type: 'hello',
      payload: { scanCursor: client.scanCursor, lastDeliveredId: client.lastDeliveredId },
    });
    this.drain(client);
    await this.replay(client);
  }
  private remove(client: BusClient) {
    client.closed = true;
    client.backlog = [];
    this.clients.delete(client);
  }
  private async replayAllClients() {
    await Promise.all(
      [...this.clients].map((c) => this.replay(c).catch((e) => console.error('live-event replay failed', e))),
    );
  }
  private async replay(client: BusClient) {
    const listEventsAfter = this.options.listEventsAfter ?? listLiveEventsAfter;
    while (!client.closed) {
      const events = await listEventsAfter(client.scanCursor, 500);
      if (!events.length) return;
      for (const ev of events) {
        client.scanCursor = Math.max(client.scanCursor, Number(ev.id));
        const recipientEvent = isolateLiveEvent(ev);
        if (!client.filter || client.filter(recipientEvent)) this.enqueue(client, recipientEvent);
      }
      this.drain(client);
      if (events.length < 500) return;
    }
  }
  private async deliverId(id: number) {
    if (!Number.isFinite(id)) return;
    const ev = (await (this.options.runQuery ?? query)(`select * from live_events where id=$1`, [id])).rows[0];
    if (!ev) return;
    for (const client of [...this.clients]) {
      if (id <= client.scanCursor) continue;
      client.scanCursor = id;
      const recipientEvent = isolateLiveEvent(ev);
      if (client.filter && !client.filter(recipientEvent)) continue;
      this.enqueue(client, recipientEvent);
      this.drain(client);
    }
  }
  private enqueue(client: BusClient, ev: any) {
    if (client.closed) return;
    const id = ev.id == null ? undefined : Number(ev.id);
    const type = String(ev.type ?? 'message');
    const idLine = id == null ? '' : `id: ${id}\n`;
    const chunk = `event: ${type}\n${idLine}data: ${JSON.stringify(ev)}\n\n`;
    client.backlog.push({ id: id ?? client.lastDeliveredId, type, chunk });
    const backpressureLimit = boundedRuntimeNumber(
      this.options.backpressureLimit ?? process.env.LIVE_EVENT_BACKPRESSURE_LIMIT,
      1000,
      1,
      10_000,
    );
    if (client.backlog.length > backpressureLimit) {
      console.error('live-event client exceeded backpressure limit', {
        lastDeliveredId: client.lastDeliveredId,
        pending: client.backlog.length,
      });
      client.reply.raw.end();
      this.remove(client);
    }
  }
  private waitForDrain(client: BusClient) {
    let resumed = false;
    const resume = () => {
      if (resumed) return;
      resumed = true;
      if (client.closed) return;
      client.draining = false;
      this.drain(client);
    };
    if (client.reply.raw.once) client.reply.raw.once('drain', resume);
    else client.reply.raw.on('drain', resume);
  }
  private failClientWrite(client: BusClient, error: unknown) {
    console.error('live-event client write failed', error);
    client.reply.raw.end();
    this.remove(client);
  }
  private drain(client: BusClient) {
    if (client.closed || client.draining) return;
    client.draining = true;
    try {
      while (!client.closed && client.backlog.length) {
        const next = client.backlog.shift();
        if (!next) break;
        const ok = client.reply.raw.write(next.chunk);
        // A false return value means Node accepted the chunk into its buffer and
        // asks us to wait for "drain" before writing more.
        client.lastDeliveredId = Math.max(client.lastDeliveredId, next.id);
        if (!ok) {
          this.waitForDrain(client);
          return;
        }
      }
      client.draining = false;
    } catch (error) {
      this.failClientWrite(client, error);
    }
  }
  private heartbeatClients() {
    for (const client of this.clients) {
      if (client.closed || client.draining || client.backlog.length > 0) continue;
      try {
        const ok = client.reply.raw.write(`event: heartbeat\ndata: ${JSON.stringify({ t: Date.now() })}\n\n`);
        if (!ok) {
          client.draining = true;
          this.waitForDrain(client);
        }
      } catch (error) {
        this.failClientWrite(client, error);
      }
    }
  }
  async close() {
    this.stopped = true;
    if (this.heartbeat) clearInterval(this.heartbeat);
    if (this.reconnect) clearTimeout(this.reconnect);
    if (this.cleanup) clearInterval(this.cleanup);
    this.heartbeat = null;
    this.reconnect = null;
    this.cleanup = null;
    for (const c of [...this.clients]) {
      c.reply.raw.end();
      this.remove(c);
    }
    const listener = this.listener;
    this.listener = null;
    await listener?.query('unlisten live_events').catch((e) => console.error('unlisten failed', e));
    await listener?.end().catch((e) => console.error('listener close failed', e));
  }
}
