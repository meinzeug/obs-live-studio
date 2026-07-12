import React, { useEffect, useState } from 'react';
import { Link } from 'react-router-dom';
import { api, can, type SessionUser } from '../api/client.js';
export function OverlaysPage({ user }: { user: SessionUser }) {
  const [items, setItems] = useState<any[]>([]);
  async function load() {
    setItems(await api('/api/overlays'));
  }
  useEffect(() => {
    void load();
  }, []);
  async function create() {
    await api('/api/overlays', {
      method: 'POST',
      body: JSON.stringify({ name: 'Overlay', template: 'main-news', width: 1920, height: 1080 }),
    });
    await load();
  }
  return (
    <section className="panel">
      <h2>Overlays</h2>
      <button disabled={!can(user, 'obs:write')} onClick={create}>
        Neu
      </button>
      {items.map((o) => (
        <article key={o.id}>
          <b>{o.name}</b>
          <p>
            {o.template} · OBS: {o.obs_configured_url ?? 'nicht eingerichtet'}
          </p>
          <Link to={`/overlays/${o.id}/edit`}>Bearbeiten</Link>
        </article>
      ))}
    </section>
  );
}
