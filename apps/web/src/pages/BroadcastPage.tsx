import React, { useEffect, useState } from 'react';
import { api, can, type SessionUser } from '../api/client.js';
export function BroadcastPage({ user }: { user: SessionUser }) {
  const [status, setStatus] = useState<any>();
  const [playlists, setPlaylists] = useState<any[]>([]);
  async function load() {
    setStatus(await api('/api/broadcast/status'));
    setPlaylists(await api('/api/broadcast/playlists'));
  }
  useEffect(() => {
    void load();
    const t = setInterval(load, 3000);
    return () => clearInterval(t);
  }, []);
  async function control(action: string) {
    await api('/api/broadcast/control', { method: 'POST', body: JSON.stringify({ action }) });
    await load();
  }
  async function start(id: string) {
    await api(`/api/broadcast/playlists/${id}/start`, { method: 'POST' });
    await load();
  }
  return (
    <section className="panel">
      <h2>Broadcast</h2>
      <p>
        Status: {status?.playback?.status ?? 'idle'} · Position {status?.playback?.position ?? '-'}
      </p>
      <button disabled={!can(user, 'broadcast:write')} onClick={() => control('pause')}>
        Pause
      </button>
      <button disabled={!can(user, 'broadcast:write')} onClick={() => control('resume')}>
        Fortsetzen
      </button>
      <button disabled={!can(user, 'broadcast:write')} onClick={() => control('skip')}>
        Überspringen
      </button>
      <button disabled={!can(user, 'broadcast:write')} onClick={() => control('stop')}>
        Stop
      </button>
      {playlists.map((p) => (
        <article key={p.id}>
          <b>{p.name}</b>
          <button onClick={() => start(p.id)}>Start</button>
        </article>
      ))}
    </section>
  );
}
