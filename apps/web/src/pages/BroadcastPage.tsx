import React, { useEffect, useMemo, useState } from 'react';
import { api, can, type SessionUser } from '../api/client.js';
const controllable: Record<string, string[]> = {
  idle: [],
  preparing: ['pause', 'skip', 'stop'],
  playing: ['pause', 'skip', 'stop'],
  paused: ['resume', 'skip', 'stop'],
  pausing: ['resume', 'skip', 'stop'],
  resuming: ['pause', 'skip', 'stop'],
  skipping: ['stop'],
  stopping: [],
  ended: [],
  error: [],
  interrupted: [],
};
export function BroadcastPage({ user }: { user: SessionUser }) {
  const [status, setStatus] = useState<any>();
  const [playlists, setPlaylists] = useState<any[]>([]);
  const [message, setMessage] = useState('');
  async function load() {
    setStatus(await api('/api/broadcast/status'));
    setPlaylists(await api('/api/broadcast/playlists'));
  }
  useEffect(() => {
    void load();
  }, []);
  useEffect(() => {
    let lastId = Number(window.localStorage.getItem('broadcast:lastEventId') ?? 0);
    let closed = false;
    let source: EventSource | null = null;
    const connect = () => {
      if (closed) return;
      source = new EventSource(`/api/events/internal?lastEventId=${lastId}`);
      const update = (event: MessageEvent) => {
        if (event.lastEventId) {
          const id = Number(event.lastEventId);
          if (id <= lastId) return;
          lastId = id;
          window.localStorage.setItem('broadcast:lastEventId', String(lastId));
        }
        void load();
      };
      for (const name of [
        'article-prepared',
        'item-started',
        'item-paused',
        'item-resumed',
        'item-ended',
        'item-skipped',
        'broadcast-stopped',
        'broadcast-control',
        'obs-disconnected',
        'obs-restored',
        'scene-changed',
      ])
        source.addEventListener(name, update);
      source.onerror = () => {
        source?.close();
        setTimeout(connect, 1500);
      };
    };
    connect();
    const emergency = setInterval(load, 30000);
    return () => {
      closed = true;
      source?.close();
      clearInterval(emergency);
    };
  }, []);
  async function control(action: string) {
    try {
      const result = await api<{ commandId: string; sequence: number; expectedState: string }>(
        '/api/broadcast/control',
        {
          method: 'POST',
          body: JSON.stringify({ action, idempotencyKey: `${action}-${Date.now()}` }),
        },
      );
      setMessage(`Befehl ${result.commandId} gespeichert, Sequenz ${result.sequence}, Ziel ${result.expectedState}`);
      await load();
    } catch (e) {
      setMessage(e instanceof Error ? e.message : String(e));
    }
  }
  async function start(id: string) {
    await api(`/api/broadcast/playlists/${id}/start`, { method: 'POST' });
    await load();
  }
  const playback = status?.playback ?? { status: 'idle' };
  const allowed = useMemo(() => new Set(controllable[playback.status] ?? []), [playback.status]);
  const items = status?.items ?? [];
  return (
    <section className="panel">
      <h2>Broadcast</h2>
      <p role="status">
        Status: {playback.status ?? 'idle'} · Beitrag {playback.articleId ?? '-'} · Position {playback.position ?? '-'}{' '}
        · Revision {playback.stateRevision ?? status?.lease?.last_state_revision ?? 0}
      </p>
      <p>
        Runner: {status?.lease?.runner_id ?? '-'} · Lease bis: {status?.lease?.lease_expires_at ?? '-'} · Recovery:{' '}
        {playback.recoveryMode ?? '-'}
      </p>
      <p>
        OBS: {playback.obsMediaStatus ?? '-'} · Medienposition: {playback.mediaPositionMs ?? '-'} /{' '}
        {playback.mediaDurationMs ?? '-'} ms
      </p>
      {message && <p className="error">{message}</p>}
      {['pause', 'resume', 'skip', 'stop'].map((action) => (
        <button
          key={action}
          disabled={!can(user, 'broadcast:write') || !allowed.has(action)}
          onClick={() => control(action)}
        >
          {action === 'pause'
            ? 'Pause'
            : action === 'resume'
              ? 'Fortsetzen'
              : action === 'skip'
                ? 'Überspringen'
                : 'Stop'}
        </button>
      ))}
      <h3>Letzte Befehle</h3>
      <ol>
        {(status?.commands ?? []).map((c: any) => (
          <li key={c.id}>
            #{c.sequence} {c.command} – {c.status} {c.error_details?.reason ?? ''}
          </li>
        ))}
      </ol>
      <h3>Nächste Beiträge</h3>
      <ol>
        {items.slice((playback.position ?? 0) + 1, (playback.position ?? 0) + 4).map((i: any) => (
          <li key={i.id}>
            {i.title} · {i.status}
          </li>
        ))}
      </ol>
      {playlists.map((p) => (
        <article key={p.id}>
          <b>{p.name}</b> · {p.status} · Position {p.current_position}
          <button disabled={!can(user, 'broadcast:write') || status?.run} onClick={() => start(p.id)}>
            Start
          </button>
        </article>
      ))}
    </section>
  );
}
