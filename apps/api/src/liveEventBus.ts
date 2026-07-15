import pg from 'pg';
import { listLiveEventsAfter, query } from '@ans/database';

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
type PgListener = {
  on: (event: string, callback: (value?: any) => void) => unknown;
  connect: () => Promise<void>;
  query: (text: string, params?: unknown[]) => Promise<any>;
  end: () => Promise<void>;
};
type ListenerFactory = (databaseUrl: string) => PgListener;

export function cloneLiveEventForClient<T>(event: T): T {
  if (typeof structuredClone === 'function') return structuredClone(event);
  return JSON.parse(JSON.stringify(event)) as T;
}

export class LiveEventBus {
  private listener: PgListener | null = null;
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
    private readonly listenerFactory: ListenerFactory = (databaseUrl) =>
      new pg.Client({ connectionString: databaseUrl }) as PgListener,
  ) {}

  async start() {
    if (this.listener || !this.databaseUrl) return;
    this.stopped = false;
    await this.connect();
    if (this.stopped) return;
    if (!this.heartbeat) {
      this.heartbeat = setInterval(() => this.heartbeatClients(), 15000);
      this.heartbeat.unref?.();
    }
    if (!this.cleanup) {
      this.cleanup = setInterval(
        () =>
          void query(`delete from live_events where created_at < now()-interval '48 hours'`).catch((error) =>
            console.error('live-event cleanup failed', error),
          ),
        3600000,
      );
      this.cleanup.unref?.();
    }
  }

  private async connect() {
    if (!this.databaseUrl || this.stopped) return;
    const listener = this.listenerFactory(this.databaseUrl);
    this.listener = listener;
    listener.on('notification', (message: any) => {
      if (this.listener !== listener || this.stopped) return;
      const id = Number(message?.payload);
      this.delivery = this.delivery
        .then(() => this.deliverId(id))
        .catch((error) => console.error('live-event delivery failed', error));
    });
    listener.on('error', (error: any) => {
      if (this.listener !== listener || this.stopped) return;
      console.error('live-event listen error', error);
      this.scheduleReconnect();
    });
    listener.on('end', () => {
      if (this.listener !== listener || this.stopped) return;
      this.listener = null;
      this.scheduleReconnect();
    });
    try {
      await listener.connect();
      if (this.stopped || this.listener !== listener) return;
      await listener.query('listen live_events');
      this.reconnectAttempts = 0;
      await this.replayAllClients();
    } catch (error) {
      if (this.listener === listener) this.listener = null;
      await listener.end().catch(() => undefined);
      throw error;
    }
  }

  private scheduleReconnect() {
    if (this.stopped || !this.databaseUrl || this.reconnect || this.reconnecting) return;
    const listener = this.listener;
    this.listener = null;
    if (listener) void listener.end().catch(() => undefined);
    const delay = Math.min(30000, 2 ** this.reconnectAttempts * 1000);
    this.reconnectAttempts += 1;
    this.reconnect = setTimeout(() => {
      this.reconnect = null;
      void this.reconnectOnce();
    }, delay);
    this.reconnect.unref?.();
  }

  private async reconnectOnce() {
    if (this.stopped) return;
    this.reconnecting = true;
    let failed = false;
    try {
      await this.connect();
    } catch (error) {
      failed = true;
      console.error('live-event reconnect failed', error);
    } finally {
      this.reconnecting = false;
      if (failed) this.scheduleReconnect();
    }
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
      [...this.clients].map((client) =>
        this.replay(client).catch((error) => console.error('live-event replay failed', error)),
      ),
    );
  }

  private eventForClient(client: BusClient, event: any) {
    const isolated = cloneLiveEventForClient(event);
    if (!client.filter) return isolated;
    try {
      return client.filter(isolated) ? isolated : null;
    } catch (error) {
      console.error('live-event client filter failed', { error, eventId: event?.id });
      return null;
    }
  }

  private async replay(client: BusClient) {
    while (!client.closed) {
      const events = await listLiveEventsAfter(client.scanCursor, 500);
      if (!events.length) return;
      for (const event of events) {
        client.scanCursor = Math.max(client.scanCursor, Number(event.id));
        const isolated = this.eventForClient(client, event);
        if (isolated) this.enqueue(client, isolated);
      }
      this.drain(client);
      if (events.length < 500) return;
    }
  }

  private async deliverId(id: number) {
    if (!Number.isFinite(id)) return;
    const event = (await query(`select * from live_events where id=$1`, [id])).rows[0];
    if (!event) return;
    for (const client of [...this.clients]) {
      if (id <= client.scanCursor) continue;
      client.scanCursor = id;
      const isolated = this.eventForClient(client, event);
      if (!isolated) continue;
      this.enqueue(client, isolated);
      this.drain(client);
    }
  }

  private enqueue(client: BusClient, event: any) {
    if (client.closed) return;
    const id = event.id == null ? undefined : Number(event.id);
    const type = String(event.type ?? 'message');
    const idLine = id == null ? '' : `id: ${id}\n`;
    const chunk = `event: ${type}\n${idLine}data: ${JSON.stringify(event)}\n\n`;
    client.backlog.push({ id: id ?? client.lastDeliveredId, type, chunk });
    if (client.backlog.length > Number(process.env.LIVE_EVENT_BACKPRESSURE_LIMIT ?? 1000)) {
      console.error('live-event client exceeded backpressure limit', {
        lastDeliveredId: client.lastDeliveredId,
        pending: client.backlog.length,
      });
      client.reply.raw.end();
      this.remove(client);
    }
  }

  private drain(client: BusClient) {
    if (client.closed || client.draining) return;
    client.draining = true;
    try {
      while (!client.closed && client.backlog.length) {
        const next = client.backlog.shift();
        if (!next) break;
        const ok = client.reply.raw.write(next.chunk);
        if (!ok) {
          const resume = () => {
            client.draining = false;
            this.drain(client);
          };
          if (client.reply.raw.once) client.reply.raw.once('drain', resume);
          else client.reply.raw.on('drain', resume);
          return;
        }
        client.lastDeliveredId = Math.max(client.lastDeliveredId, next.id);
      }
    } catch (error) {
      console.error('live-event client write failed', error);
      client.reply.raw.end();
      this.remove(client);
    } finally {
      if (!client.closed && client.backlog.length === 0) client.draining = false;
    }
  }

  private heartbeatClients() {
    for (const client of this.clients) {
      if (client.closed || client.draining || client.backlog.length > 0) continue;
      try {
        const ok = client.reply.raw.write(`event: heartbeat\ndata: ${JSON.stringify({ t: Date.now() })}\n\n`);
        if (!ok) {
          client.draining = true;
          const resume = () => {
            client.draining = false;
            this.drain(client);
          };
          if (client.reply.raw.once) client.reply.raw.once('drain', resume);
          else client.reply.raw.on('drain', resume);
        }
      } catch (error) {
        console.error('live-event heartbeat failed', error);
        client.reply.raw.end();
        this.remove(client);
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
    for (const client of [...this.clients]) {
      client.reply.raw.end();
      this.remove(client);
    }
    const listener = this.listener;
    this.listener = null;
    if (listener) {
      await listener.query('unlisten live_events').catch((error) => console.error('unlisten failed', error));
      await listener.end().catch((error) => console.error('listener close failed', error));
    }
  }
}
