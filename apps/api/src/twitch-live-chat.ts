import { isAutomatedStudioPrompt, moderatePublicChatMessage } from './youtube-live-chat.js';

export type TwitchLiveChatMessage = {
  provider: 'twitch';
  providerMessageId: string;
  authorName: string;
  authorChannelId: string | null;
  message: string;
  messageType: 'textMessageEvent';
  safe: boolean;
  moderationReason: string | null;
  publishedAt: string;
};

export type TwitchLiveChatStatus = {
  configured: boolean;
  connected: boolean;
  connecting: boolean;
  channel: string | null;
  lastMessageAt: string | null;
  error: string | null;
};

function cleanText(value: unknown, maximum: number) {
  return typeof value === 'string'
    ? value
        .replace(/[\u0000-\u001f\u007f]/g, ' ')
        .replace(/\s+/g, ' ')
        .trim()
        .slice(0, maximum)
    : '';
}

export function twitchChannelName(value: string | null | undefined) {
  const raw = value?.trim();
  if (!raw) return null;
  let candidate = raw.replace(/^#/, '');
  try {
    const url = new URL(raw.includes('://') ? raw : `https://www.twitch.tv/${candidate}`);
    if (!['twitch.tv', 'www.twitch.tv', 'm.twitch.tv'].includes(url.hostname.toLowerCase())) return null;
    candidate = url.pathname.split('/').filter(Boolean)[0] ?? '';
  } catch {
    return null;
  }
  const normalized = candidate.toLowerCase();
  return /^[a-z0-9_]{3,25}$/.test(normalized) ? normalized : null;
}

function unescapeTag(value: string) {
  return value.replace(/\\([sn:r\\])/g, (_, escaped: string) => {
    if (escaped === 's') return ' ';
    if (escaped === 'n') return '\n';
    if (escaped === 'r') return '\r';
    if (escaped === ':') return ';';
    return '\\';
  });
}

function parseTags(raw: string) {
  return Object.fromEntries(
    raw.split(';').map((entry) => {
      const separator = entry.indexOf('=');
      return separator < 0 ? [entry, ''] : [entry.slice(0, separator), unescapeTag(entry.slice(separator + 1))];
    }),
  );
}

export function parseTwitchIrcMessage(
  line: string,
  channel: string,
  fallbackId: string,
  receivedAtMs = Date.now(),
): TwitchLiveChatMessage | null {
  const match = line.match(/^@([^ ]+) :([^! ]+)![^ ]+ PRIVMSG #([^ ]+) :([\s\S]+)$/);
  if (!match || match[3]?.toLowerCase() !== channel.toLowerCase()) return null;
  const tags = parseTags(match[1] ?? '');
  const message = cleanText(match[4], 500);
  if (!message) return null;
  const moderation = moderatePublicChatMessage(message);
  const senderIsChannel = match[2]?.toLowerCase() === channel.toLowerCase();
  const automatedSenderMessage = senderIsChannel && isAutomatedStudioPrompt(message);
  const providerTimestamp = Number(tags['tmi-sent-ts']);
  const timestamp =
    Number.isFinite(providerTimestamp) && Math.abs(providerTimestamp - receivedAtMs) <= 5 * 60_000
      ? providerTimestamp
      : receivedAtMs;
  return {
    provider: 'twitch',
    providerMessageId: cleanText(tags.id, 300) || fallbackId,
    authorName: cleanText(tags['display-name'], 120) || cleanText(match[2], 120) || 'Twitch-Zuschauer',
    authorChannelId: cleanText(tags['user-id'], 200) || null,
    message,
    messageType: 'textMessageEvent',
    safe: moderation.safe && !automatedSenderMessage,
    moderationReason: automatedSenderMessage ? 'Automatisierte Sendernachricht' : moderation.reason,
    publishedAt: new Date(timestamp).toISOString(),
  };
}

export class TwitchLiveChatClient {
  private socket: WebSocket | null = null;
  private channel: string | null = null;
  private generation = 0;
  private sequence = 0;
  private queue: TwitchLiveChatMessage[] = [];
  private lastMessageAt: string | null = null;
  private error: string | null = null;
  private nextRetryAt = 0;

  ensure(rawChannel: string | null | undefined) {
    const channel = twitchChannelName(rawChannel);
    if (!channel) {
      this.disconnect();
      this.error = rawChannel?.trim() ? 'Der Twitch-Kanalname oder die Kanal-URL ist ungültig.' : null;
      return this.status();
    }
    if (
      this.channel === channel &&
      this.socket &&
      (this.socket.readyState === WebSocket.CONNECTING || this.socket.readyState === WebSocket.OPEN)
    ) {
      return this.status();
    }
    if (Date.now() < this.nextRetryAt && this.channel === channel) return this.status();
    this.connect(channel);
    return this.status();
  }

  drain(limit = 200) {
    const count = Math.max(1, Math.min(500, limit));
    return this.queue.splice(0, count);
  }

  status(): TwitchLiveChatStatus {
    return {
      configured: Boolean(this.channel),
      connected: this.socket?.readyState === WebSocket.OPEN,
      connecting: this.socket?.readyState === WebSocket.CONNECTING,
      channel: this.channel,
      lastMessageAt: this.lastMessageAt,
      error: this.error,
    };
  }

  disconnect() {
    this.generation += 1;
    const socket = this.socket;
    this.socket = null;
    this.channel = null;
    this.queue = [];
    if (socket && (socket.readyState === WebSocket.CONNECTING || socket.readyState === WebSocket.OPEN))
      socket.close(1000, 'Studio chat disabled');
  }

  private connect(channel: string) {
    this.disconnect();
    this.channel = channel;
    this.error = null;
    const generation = this.generation;
    const socket = new WebSocket('wss://irc-ws.chat.twitch.tv:443');
    this.socket = socket;
    const nickname = `justinfan${Math.floor(10_000 + Math.random() * 89_999)}`;
    socket.addEventListener('open', () => {
      if (generation !== this.generation) return socket.close();
      socket.send('CAP REQ :twitch.tv/tags twitch.tv/commands');
      socket.send('PASS SCHMOOPIIE');
      socket.send(`NICK ${nickname}`);
      socket.send(`JOIN #${channel}`);
      this.error = null;
      this.nextRetryAt = 0;
    });
    socket.addEventListener('message', (event) => {
      if (generation !== this.generation || typeof event.data !== 'string') return;
      for (const line of event.data.split('\r\n').filter(Boolean)) {
        if (line.startsWith('PING ')) {
          if (socket.readyState === WebSocket.OPEN) socket.send(line.replace(/^PING/, 'PONG'));
          continue;
        }
        const receivedAtMs = Date.now();
        const parsed = parseTwitchIrcMessage(
          line,
          channel,
          `twitch-${channel}-${receivedAtMs}-${this.sequence++}`,
          receivedAtMs,
        );
        if (!parsed) continue;
        this.queue.push(parsed);
        if (this.queue.length > 500) this.queue.splice(0, this.queue.length - 500);
        this.lastMessageAt = parsed.publishedAt;
      }
    });
    socket.addEventListener('error', () => {
      if (generation !== this.generation) return;
      this.error = 'Die Verbindung zum Twitch-Chat ist fehlgeschlagen.';
    });
    socket.addEventListener('close', (event) => {
      if (generation !== this.generation) return;
      this.socket = null;
      this.nextRetryAt = Date.now() + 15_000;
      if (event.code !== 1000) this.error = 'Twitch-Chat getrennt – automatische Wiederverbindung läuft.';
    });
  }
}
