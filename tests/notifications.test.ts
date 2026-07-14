import { describe, expect, it } from 'vitest';
import { redactOperationalText, sanitizeOperationalDetails } from '../packages/database/src/notifications.js';

describe('operational notification redaction', () => {
  const env = {
    DATABASE_URL: 'postgresql://studio:database-password@localhost:5432/studio',
    OBS_PASSWORD: 'obs-super-secret',
    STREAM_KEY: 'youtube-secret-key',
    TWITCH_STREAM_KEY: 'twitch-secret-key',
    THIRD_PARTY_API_TOKEN: 'third-party-token-value',
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

  it('redacts authorization headers, cookies, secret query parameters and dynamically named secret variables', () => {
    const text = redactOperationalText(
      'Authorization: Bearer bearer-value Cookie: ans_session=cookie-value https://example.org/callback?token=query-token&ok=1 third-party-token-value',
      env,
    );

    expect(text).not.toContain('bearer-value');
    expect(text).not.toContain('cookie-value');
    expect(text).not.toContain('query-token');
    expect(text).not.toContain('third-party-token-value');
    expect(text).toContain('token=[redacted]');
  });

  it('sanitizes nested details, secret-bearing keys and oversized collections', () => {
    const details = sanitizeOperationalDetails(
      {
        error: 'Twitch failed with twitch-secret-key',
        nested: {
          url: 'https://user:password@example.org/path',
          password: 'previously-unknown-password',
          authorization: 'Bearer previously-unknown-token',
        },
        list: Array.from({ length: 30 }, (_, index) => `value-${index}`),
      },
      env,
    );

    const serialized = JSON.stringify(details);
    expect(serialized).not.toContain('twitch-secret-key');
    expect(serialized).not.toContain('previously-unknown-password');
    expect(serialized).not.toContain('previously-unknown-token');
    expect(serialized).not.toContain('user:password');
    expect(details.nested).toMatchObject({ password: '[redacted]', authorization: '[redacted]' });
    expect(details.list).toHaveLength(20);
  });

  it('preserves useful Error diagnostics after redaction', () => {
    const details = sanitizeOperationalDetails(
      { failure: new Error('Request failed with Basic dXNlcjpwYXNzd29yZA== and obs-super-secret') },
      env,
    );

    expect(details.failure).toMatchObject({ name: 'Error' });
    expect(JSON.stringify(details)).toContain('Request failed');
    expect(JSON.stringify(details)).not.toContain('dXNlcjpwYXNzd29yZA==');
    expect(JSON.stringify(details)).not.toContain('obs-super-secret');
  });
});
