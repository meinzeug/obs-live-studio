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

export class LiveEventBus {
  private listener: pg.Client | null = null;
  private clients = new Set<BusClient>();
  private heartbeat: NodeJS.Timeout | null = null;
  private reconnect: NodeJS.Timeout | null = null;
  private cleanup: NodeJS.Timeout | null = null;
  private reconnecting = false;
  private reconnectAttempts = 0;
  private delivery = Promise.resolve();
  constructor(private databaseUrl = process.env.DATABASE_URL) {}
  async start() {
    if (this.listener || !this.databaseUrl) return;
    await this.connect();
    this.heartbeat = setInterval(() => this.heartbeatClients(), 15000);
    this.cleanup = setInterval(
      () =>
        void query(`delete from live_events where created_at < now()-interval '48 hours'`).catch((e) =>
          console.error('live-event cleanup failed', e),
        ),
      3600000,
    );
    this.cleanup.unref?.();
  }
  private async connect() {
    this.listener = new pg.Client({ connectionString: this.databaseUrl });
    this.listener.on('notification', (msg) => {
      const id = Number(msg.payload);
      this.delivery = this.delivery
        .then(() => this.deliverId(id))
        .catch((e) => console.error('live-event delivery failed', e));
    });
    this.listener.on('error', (e) => {
      console.error('live-event listen error', e);
      this.scheduleReconnect();
    });
    this.listener.on('end', () => this.scheduleReconnect());
    await this.listener.connect();
    await this.listener.query('listen live_events');
    this.reconnectAttempts = 0;
    await this.replayAllClients();
  }
  private scheduleReconnect() {
    if (this.reconnect || this.reconnecting) return;
    void this.listener?.end().catch(() => undefined);
    this.listener = null;
    const delay = Math.min(30000, 2 ** this.reconnectAttempts * 1000);
    this.reconnectAttempts += 1;
    this.reconnect = setTimeout(async () => {
      this.reconnect = null;
      this.reconnecting = true;
      try {
        await this.connect();
      } catch (e) {
        console.error('live-event reconnect failed', e);
        this.scheduleReconnect();
      } finally {
        this.reconnecting = false;
      }
    }, delay);
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
    while (!client.closed) {
      const events = await listLiveEventsAfter(client.scanCursor, 500);
      if (!events.length) return;
      for (const ev of events) {
        client.scanCursor = Math.max(client.scanCursor, Number(ev.id));
        if (!client.filter || client.filter(ev)) this.enqueue(client, ev);
      }
      this.drain(client);
      if (events.length < 500) return;
    }
  }
  private async deliverId(id: number) {
    if (!Number.isFinite(id)) return;
    const ev = (await query(`select * from live_events where id=$1`, [id])).rows[0];
    if (!ev) return;
    for (const client of [...this.clients]) {
      if (id <= client.scanCursor) continue;
      client.scanCursor = id;
      if (client.filter && !client.filter(ev)) continue;
      this.enqueue(client, ev);
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
    } finally {
      if (!client.closed && client.backlog.length === 0) client.draining = false;
    }
  }
  private heartbeatClients() {
    for (const c of this.clients)
      if (!c.closed && !c.draining && c.backlog.length === 0)
        c.reply.raw.write(`event: heartbeat\ndata: ${JSON.stringify({ t: Date.now() })}\n\n`);
  }
  async close() {
    if (this.heartbeat) clearInterval(this.heartbeat);
    if (this.reconnect) clearTimeout(this.reconnect);
    if (this.cleanup) clearInterval(this.cleanup);
    for (const c of [...this.clients]) {
      c.reply.raw.end();
      this.remove(c);
    }
    await this.listener?.query('unlisten live_events').catch((e) => console.error('unlisten failed', e));
    await this.listener?.end().catch((e) => console.error('listener close failed', e));
    this.listener = null;
  }
}
