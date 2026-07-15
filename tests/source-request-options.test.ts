import { describe, expect, it } from 'vitest';
import { resolveSourceUserAgent } from '../apps/worker/src/source-request-options.js';

describe('source request settings', () => {
  it('prefers a configured per-source user agent', () => {
    expect(resolveSourceUserAgent({ user_agent: '  Nachrichtenstudio/3.0  ' }, { NEWS_USER_AGENT: 'Global/1.0' })).toBe(
      'Nachrichtenstudio/3.0',
    );
  });

  it('falls back to the global user agent for missing or blank source settings', () => {
    expect(resolveSourceUserAgent({}, { NEWS_USER_AGENT: ' Global/1.0 ' })).toBe('Global/1.0');
    expect(resolveSourceUserAgent({ user_agent: '   ' }, { NEWS_USER_AGENT: 'Global/1.0' })).toBe('Global/1.0');
  });

  it('leaves the header unset when neither source nor environment config provides one', () => {
    expect(resolveSourceUserAgent({}, {})).toBeUndefined();
  });
});
