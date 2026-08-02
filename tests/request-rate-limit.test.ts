import { describe, expect, it } from 'vitest';
import { isGlobalRateLimitExemptRoute, isInternalPlayoutRoute } from '../apps/api/src/request-rate-limit.js';

describe('internal playout rate-limit policy', () => {
  it.each([
    ['GET', '/api/overlay/ai-roundtable'],
    ['HEAD', '/api/overlay/ai-roundtable'],
    ['GET', '/api/overlay/advertising/active'],
    ['POST', '/api/live/youtube/progress/123e4567-e89b-12d3-a456-426614174000'],
  ])('exempts the local %s %s playout request from the shared global budget', (method, url) => {
    expect(isGlobalRateLimitExemptRoute({ method, url, ip: '127.0.0.1' })).toBe(true);
  });

  it('accepts IPv6 loopback used by a local OBS browser source', () => {
    expect(
      isInternalPlayoutRoute({
        method: 'GET',
        url: '/api/overlay/advertising/active',
        ip: '::1',
      }),
    ).toBe(true);
  });

  it.each([
    ['GET', '/api/overlay/ai-roundtable', '203.0.113.10'],
    ['POST', '/api/live/youtube/progress/123e4567-e89b-12d3-a456-426614174000', '203.0.113.10'],
    ['POST', '/api/live/youtube/progress/not-a-uuid', '127.0.0.1'],
    ['POST', '/api/overlay/advertising/active', '127.0.0.1'],
    ['GET', '/api/overlay/ai-roundtable/turns/123/audio', '127.0.0.1'],
  ])('does not exempt %s %s from %s', (method, url, ip) => {
    expect(isInternalPlayoutRoute({ method, url, ip })).toBe(false);
  });
});
