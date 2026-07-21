import { describe, expect, it } from 'vitest';
import { parseTwitchIrcMessage, twitchChannelName } from '../apps/api/src/twitch-live-chat.js';

describe('Twitch live chat ingestion', () => {
  it('normalizes channel names and public Twitch channel URLs', () => {
    expect(twitchChannelName('Mein_Kanal')).toBe('mein_kanal');
    expect(twitchChannelName('https://www.twitch.tv/Mein_Kanal/videos')).toBe('mein_kanal');
    expect(twitchChannelName('https://example.org/channel')).toBeNull();
    expect(twitchChannelName('x')).toBeNull();
  });

  it('parses tagged PRIVMSG lines and applies the shared privacy filter', () => {
    const regular = parseTwitchIrcMessage(
      '@badge-info=;display-name=Zuschauer;id=abc-123;tmi-sent-ts=1784630400000;user-id=42 :viewer!viewer@viewer.tmi.twitch.tv PRIVMSG #zeitkante :Welche Quelle belegt das?',
      'zeitkante',
      'fallback',
    );
    expect(regular).toMatchObject({
      provider: 'twitch',
      providerMessageId: 'abc-123',
      authorName: 'Zuschauer',
      authorChannelId: '42',
      message: 'Welche Quelle belegt das?',
      safe: true,
    });

    const privateData = parseTwitchIrcMessage(
      '@display-name=Viewer;id=unsafe :viewer!viewer@viewer.tmi.twitch.tv PRIVMSG #zeitkante :Schreib mir an test@example.org',
      'zeitkante',
      'fallback',
    );
    expect(privateData).toMatchObject({ safe: false, moderationReason: 'Mögliche personenbezogene Kontaktdaten' });
  });

  it('normalizes a skewed Twitch timestamp to the local live reception time', () => {
    const providerTime = Date.parse('2026-07-21T01:40:00.000Z');
    const receivedAt = Date.parse('2026-07-21T03:40:00.000Z');
    const message = parseTwitchIrcMessage(
      `@display-name=Argumentationskette;id=clock-skew;tmi-sent-ts=${providerTime} :argumentationskette!argumentationskette@argumentationskette.tmi.twitch.tv PRIVMSG #zeitkante :Moderator Test`,
      'zeitkante',
      'fallback',
      receivedAt,
    );

    expect(message?.publishedAt).toBe('2026-07-21T03:40:00.000Z');
  });
});
