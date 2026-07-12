import pg from 'pg';
import { listLiveEventsAfter, query } from '@ans/database';

type Client = {
  raw: {
    write: (chunk: string) => boolean;
    writeHead?: (code: number, headers: Record<string, string>) => void;
    end: () => void;
    on: (event: string, cb: () => void) => void;
  };
};

type BusClient = { reply: Client; lastSent: number; closed: boolean; backlog: string[] };

export class LiveEventBus {
  private listener: pg.Client | null = null;
  private clients = new Set<BusClient>();
  private heartbeat: NodeJS.Timeout | null = null;
  private reconnect: NodeJS.Timeout | null = null;
  private seen = new Set<number>();
  constructor(private databaseUrl = process.env.DATABASE_URL) {}
  async start() {
    if (this.listener || !this.databaseUrl) return;
    await this.connect();
    this.heartbeat = setInterval(() => this.heartbeatClients(), 15000);
    setInterval(
      () => void query(`delete from live_events where created_at < now()-interval '48 hours'`).catch(() => undefined),
      3600000,
    ).unref?.();
  }
  private async connect() {
    this.listener = new pg.Client({ connectionString: this.databaseUrl });
    this.listener.on('notification', (msg) => void this.deliverId(Number(msg.payload)));
    this.listener.on('error', () => this.scheduleReconnect());
    this.listener.on('end', () => this.scheduleReconnect());
    await this.listener.connect();
    await this.listener.query('listen live_events');
  }
  private scheduleReconnect() {
    if (this.reconnect) return;
    this.listener = null;
    this.reconnect = setTimeout(async () => {
      this.reconnect = null;
      try {
        await this.connect();
      } catch {
        this.scheduleReconnect();
      }
    }, 1000);
  }
  async add(reply: Client, lastId: number) {
    const client: BusClient = { reply, lastSent: Number.isFinite(lastId) ? lastId : 0, closed: false, backlog: [] };
    this.clients.add(client);
    reply.raw.on('close', () => this.remove(client));
    reply.raw.writeHead?.(200, {
      'content-type': 'text/event-stream',
      'cache-control': 'no-store',
      connection: 'keep-alive',
    });
    await this.replay(client);
    reply.raw.write(`event: hello\ndata: ${JSON.stringify({ lastEventId: client.lastSent })}\n\n`);
  }
  private remove(client: BusClient) {
    client.closed = true;
    this.clients.delete(client);
  }
  private async replay(client: BusClient) {
    const events = await listLiveEventsAfter(client.lastSent, 500);
    for (const ev of events) this.write(client, ev);
  }
  private async deliverId(id: number) {
    if (!Number.isFinite(id) || this.seen.has(id)) return;
    this.seen.add(id);
    if (this.seen.size > 10000) this.seen = new Set([...this.seen].slice(-5000));
    const ev = (await query(`select * from live_events where id=$1`, [id])).rows[0];
    if (!ev) return;
    for (const client of [...this.clients]) {
      if (id <= client.lastSent) continue;
      this.write(client, ev);
    }
  }
  private write(client: BusClient, ev: any) {
    if (client.closed) return;
    const chunk = `event: ${ev.type}\nid: ${ev.id}\ndata: ${JSON.stringify(ev)}\n\n`;
    client.backlog.push(chunk);
    if (client.backlog.length > 1000) {
      client.reply.raw.end();
      this.remove(client);
      return;
    }
    while (client.backlog.length) {
      const ok = client.reply.raw.write(client.backlog[0]);
      if (!ok) break;
      client.backlog.shift();
      client.lastSent = Number(ev.id);
    }
  }
  private heartbeatClients() {
    for (const c of this.clients) c.reply.raw.write(`event: heartbeat\ndata: ${JSON.stringify({ t: Date.now() })}\n\n`);
  }
  async close() {
    if (this.heartbeat) clearInterval(this.heartbeat);
    if (this.reconnect) clearTimeout(this.reconnect);
    for (const c of this.clients) c.reply.raw.end();
    this.clients.clear();
    await this.listener?.query('unlisten live_events').catch(() => undefined);
    await this.listener?.end().catch(() => undefined);
  }
}
