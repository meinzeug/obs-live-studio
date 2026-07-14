import { describe, expect, it } from 'vitest';
import {
  redactOperationalText,
  sanitizeOperationalDetails,
} from '../packages/database/src/notifications.js';

describe('operational notification redaction', () => {
  const env = {
    DATABASE_URL: 'postgresql://studio:database-password@localhost:5432/studio',
    OBS_PASSWORD: 'obs-super-secret',
    STREAM_KEY: 'youtube-secret-key',
    TWITCH_STREAM_KEY: 'twitch-secret-key',
  };

  it('redacts URL credentials and configured secrets', () => {
    const text = redactOperationalText(
      'Failed postgresql://studio:database-password@localhost:5432/studio with obs-super-secret and youtube-secret-key',
      env,
    );

    expect(text).toContain('postgresql://[redacted]@localhost:5432/studio');
    expect(text).not.toContain('database-password');
    expect(text).not.toContain('obs-super-secret');
    expect(text).not.toContain('youtube-secret-key');
  });

  it('sanitizes nested details and limits oversized collections', () => {
    const details = sanitizeOperationalDetails(
      {
        error: 'Twitch failed with twitch-secret-key',
        nested: { url: 'https://user:password@example.org/path' },
        list: Array.from({ length: 30 }, (_, index) => `value-${index}`),
      },
      env,
    );

    expect(JSON.stringify(details)).not.toContain('twitch-secret-key');
    expect(JSON.stringify(details)).not.toContain('password');
    expect(details.list).toHaveLength(20);
  });
});
