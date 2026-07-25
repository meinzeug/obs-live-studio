import { afterEach, describe, expect, it, vi } from 'vitest';
import { LivePortalClient } from '../apps/api/src/live-portal-client.js';

const sourceId = '11111111-1111-4111-8111-111111111111';
const messageId = '22222222-2222-4222-8222-222222222222';
const offlineSourceId = '33333333-3333-4333-8333-333333333333';

function jsonResponse(body: unknown, status = 200) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { 'content-type': 'application/json' },
  });
}

afterEach(() => {
  vi.unstubAllGlobals();
});

describe('LivePortalClient Kommunikation', () => {
  it('führt Quellen und Kommunikationsstatus in einem Snapshot zusammen', async () => {
    const fetchMock = vi.fn(async (input: string | URL | Request, init: RequestInit = {}) => {
      void init;
      const path = new URL(String(input)).pathname;
      if (path === '/api/service/sources') {
        return jsonResponse({
          sources: [{ id: sourceId, name: 'Kamera Rathaus', status: 'live' }],
          serverTime: new Date().toISOString(),
        });
      }
      return jsonResponse({
        sources: [
          {
            sourceId,
            name: 'Kamera Rathaus',
            user: 'Reporterin',
            status: 'live',
            updatedAt: new Date().toISOString(),
            control: {
              tally: 'program',
              muted: false,
              directorName: 'Regie',
              instruction: 'Du bist live.',
              updatedAt: new Date().toISOString(),
            },
            unread: { streamer: 0, editorial: 2 },
            lastMessageAt: new Date().toISOString(),
          },
          {
            sourceId: offlineSourceId,
            name: 'Interviewplatz',
            user: 'Reporter',
            status: 'offline',
            updatedAt: new Date().toISOString(),
            control: {
              tally: 'standby',
              muted: false,
              directorName: null,
              instruction: 'Bitte Verbindung vorbereiten.',
              updatedAt: new Date().toISOString(),
            },
            unread: { streamer: 1, editorial: 0 },
            lastMessageAt: new Date().toISOString(),
          },
        ],
      });
    });
    vi.stubGlobal('fetch', fetchMock);

    const client = new LivePortalClient({
      baseUrl: 'https://portal.example/',
      serviceToken: 'service-secret',
    });
    const result = await client.listSources();

    expect(result.sources[0].communication?.control.tally).toBe('program');
    expect(result.sources[0].communication?.unread.editorial).toBe(2);
    expect(result.sources.find((source) => source.id === offlineSourceId)).toMatchObject({
      name: 'Interviewplatz',
      status: 'offline',
      communication: { unread: { streamer: 1 } },
    });
    expect(fetchMock).toHaveBeenCalledTimes(2);
    for (const [, init] of fetchMock.mock.calls) {
      expect((init as RequestInit).headers).toMatchObject({ authorization: 'Bearer service-secret' });
    }
  });

  it('sendet priorisierte Regiehinweise und aktualisiert den Tally-Zustand', async () => {
    const requests: Array<{ path: string; init: RequestInit }> = [];
    const fetchMock = vi.fn(async (input: string | URL | Request, init: RequestInit = {}) => {
      const path = new URL(String(input)).pathname;
      requests.push({ path, init });
      if (path.endsWith('/messages')) {
        return jsonResponse({
          id: messageId,
          sourceId,
          senderSide: 'editorial',
          senderName: 'Sendeleitung',
          kind: 'cue',
          priority: 'urgent',
          body: 'Jetzt live.',
          metadata: {},
          replyTo: null,
          streamerReadAt: null,
          editorialReadAt: new Date().toISOString(),
          createdAt: new Date().toISOString(),
        });
      }
      return jsonResponse({
        tally: 'program',
        muted: false,
        directorName: 'Sendeleitung',
        instruction: 'Jetzt live.',
        updatedAt: new Date().toISOString(),
      });
    });
    vi.stubGlobal('fetch', fetchMock);

    const client = new LivePortalClient({
      baseUrl: 'https://portal.example/',
      serviceToken: 'service-secret',
    });
    const message = await client.sendMessage(sourceId, {
      body: 'Jetzt live.',
      senderName: 'Sendeleitung',
      kind: 'cue',
      priority: 'urgent',
    });
    await client.setControlState(sourceId, {
      tally: 'program',
      muted: false,
      directorName: 'Sendeleitung',
      instruction: 'Jetzt live.',
    });

    expect(message.priority).toBe('urgent');
    expect(requests.map((request) => [request.path, request.init.method])).toEqual([
      [`/api/service/sources/${sourceId}/messages`, 'POST'],
      [`/api/service/sources/${sourceId}/control`, 'PUT'],
    ]);
    expect(JSON.parse(String(requests[0].init.body))).toMatchObject({
      kind: 'cue',
      priority: 'urgent',
    });
  });

  it('bleibt beim Quellenabruf mit älteren Portal-Versionen kompatibel', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn(async (input: string | URL | Request) => {
        const path = new URL(String(input)).pathname;
        return path === '/api/service/sources'
          ? jsonResponse({ sources: [{ id: sourceId, name: 'Kamera', status: 'offline' }] })
          : jsonResponse({ error: 'Nicht gefunden' }, 404);
      }),
    );
    const client = new LivePortalClient({
      baseUrl: 'https://portal.example/',
      serviceToken: 'service-secret',
    });

    const result = await client.listSources();
    expect(result.sources).toHaveLength(1);
    expect(result.sources[0].communication).toBeUndefined();
  });

  it('erstellt und widerruft einmalige Gast-Einladungen serverseitig', async () => {
    const invitationId = '44444444-4444-4444-8444-444444444444';
    const requests: Array<{ path: string; method: string }> = [];
    vi.stubGlobal(
      'fetch',
      vi.fn(async (input: string | URL | Request, init: RequestInit = {}) => {
        const path = new URL(String(input)).pathname;
        const method = init.method ?? 'GET';
        requests.push({ path, method });
        const base = {
          id: invitationId,
          displayName: 'Reporterin',
          showTitle: 'Abendschau',
          sourceName: 'Rathaus',
          expiresAt: new Date(Date.now() + 3_600_000).toISOString(),
          acceptedAt: null,
          sourceId: null,
          status: method === 'DELETE' ? 'revoked' : 'open',
          createdAt: new Date().toISOString(),
        };
        if (method === 'GET') return jsonResponse({ invitations: [base] });
        return jsonResponse(
          method === 'POST' ? { ...base, invitationUrl: 'https://portal.example/invite/opaque-token' } : base,
        );
      }),
    );
    const client = new LivePortalClient({
      baseUrl: 'https://portal.example/',
      serviceToken: 'service-secret',
    });

    expect((await client.listInvitations()).invitations).toHaveLength(1);
    const created = await client.createInvitation({
      displayName: 'Reporterin',
      showTitle: 'Abendschau',
      sourceName: 'Rathaus',
    });
    expect(created.invitationUrl).toContain('/invite/');
    expect((await client.revokeInvitation(invitationId)).status).toBe('revoked');
    expect(requests).toEqual([
      { path: '/api/service/invitations', method: 'GET' },
      { path: '/api/service/invitations', method: 'POST' },
      { path: `/api/service/invitations/${invitationId}`, method: 'DELETE' },
    ]);
  });
});
