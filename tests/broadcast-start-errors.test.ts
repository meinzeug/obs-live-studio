import { describe, expect, it } from 'vitest';
import { broadcastStartErrorStatus } from '../apps/api/src/broadcast-start-errors.js';

describe('broadcast start error mapping', () => {
  it('maps expected domain failures to useful client statuses', () => {
    expect(broadcastStartErrorStatus(new Error('playlist-not-found'))).toBe(404);
    expect(broadcastStartErrorStatus(new Error('active-broadcast-run-exists'))).toBe(409);
    expect(broadcastStartErrorStatus(new Error('playlist-has-no-broadcastable-items'))).toBe(409);
    expect(broadcastStartErrorStatus(new Error('published-main-overlay-required'))).toBe(409);
    expect(broadcastStartErrorStatus(new Error('idempotency-key-conflict'))).toBe(409);
  });

  it('does not disguise infrastructure failures as user conflicts', () => {
    expect(broadcastStartErrorStatus(new Error('database connection lost'))).toBeNull();
  });
});
