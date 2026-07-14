import React, { useEffect, useState } from 'react';
import { Edit3, Layers3, MonitorCheck, Plus } from 'lucide-react';
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
      <div className="page-title">
        <div>
          <p className="eyebrow">Grafiksystem</p>
          <h2>Overlays</h2>
          <p>Sendegrafiken entwerfen, veröffentlichen und mit OBS verbinden.</p>
        </div>
        <div className="page-title-actions">
          <button className="primary-button" disabled={!can(user, 'obs:write')} onClick={create}>
            <Plus size={17} /> Neues Overlay
          </button>
        </div>
      </div>
      {items.length > 0 ? (
        <div className="overlay-grid">
          {items.map((overlay) => (
            <article className="overlay-card" key={overlay.id}>
              <div>
                <div className="card-header">
                  <h3>{overlay.name}</h3>
                  <span className={`state-pill ${overlay.obs_configured_url ? 'success' : 'warning'}`}>
                    <MonitorCheck size={12} /> {overlay.obs_configured_url ? 'OBS aktiv' : 'Nicht verbunden'}
                  </span>
                </div>
                <p className="card-meta">Vorlage: {overlay.template}</p>
                <p className="card-meta">
                  {overlay.obs_configured_url ?? 'Noch keine OBS-Browserquelle eingerichtet.'}
                </p>
              </div>
              <div className="card-footer">
                <span className="state-pill">1920 × 1080</span>
                <Link className="button" to={`/overlays/${overlay.id}/edit`}>
                  <Edit3 size={16} /> Bearbeiten
                </Link>
              </div>
            </article>
          ))}
        </div>
      ) : (
        <div className="empty-state">
          <div>
            <Layers3 size={24} />
            <p>Noch keine Overlays angelegt.</p>
          </div>
        </div>
      )}
    </section>
  );
}
