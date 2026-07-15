import { describe, expect, it, vi } from 'vitest';
import { isAuthenticatedLiveEventRead, requirePermission } from '../apps/api/src/auth.js';

function readOnlyRequest(url: string, method = 'GET') {
  return {
    method,
    url,
    user: {
      id: 'user-1',
      role: 'nur_lesen',
      permissions: [],
      active: true,
    },
  } as any;
}

function reply() {
  return { code: vi.fn().mockReturnThis() } as any;
}

describe('internal live event permissions', () => {
  it('treats the authenticated internal SSE GET as a read operation', () => {
    const request = readOnlyRequest('/api/events/internal?lastEventId=42');
    expect(isAuthenticatedLiveEventRead(request, 'broadcast:write')).toBe(true);
    expect(() => requirePermission(request, reply(), 'broadcast:write')).not.toThrow();
  });

  it('does not grant write permission or exempt unrelated read endpoints', () => {
    expect(isAuthenticatedLiveEventRead(readOnlyRequest('/api/broadcast/status'), 'broadcast:write')).toBe(false);
    expect(isAuthenticatedLiveEventRead(readOnlyRequest('/api/events/internal', 'POST'), 'broadcast:write')).toBe(false);
    expect(() => requirePermission(readOnlyRequest('/api/broadcast/status'), reply(), 'broadcast:write')).toThrow(
      'Keine Berechtigung',
    );
  });
});
