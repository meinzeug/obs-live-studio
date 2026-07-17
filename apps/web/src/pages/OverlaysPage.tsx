import React, { useEffect, useRef, useState } from 'react';
import { AlertTriangle, Edit3, Layers3, MonitorCheck, Plus } from 'lucide-react';
import { Link } from 'react-router-dom';
import { api, can, type SessionUser } from '../api/client.js';
import { overlayEditorRoute } from '../navigation.js';
export function OverlaysPage({ user }: { user: SessionUser }) {
  const [items, setItems] = useState<any[]>([]);
  const [loading, setLoading] = useState(true);
  const [creating, setCreating] = useState(false);
  const [error, setError] = useState('');
  const loadRevision = useRef(0);
  async function load() {
    const revision = ++loadRevision.current;
    setLoading(true);
    try {
      const next = await api<any[]>('/api/overlays');
      if (revision !== loadRevision.current) return;
      setItems(next);
      setError('');
    } catch (requestError) {
      if (revision === loadRevision.current)
        setError(requestError instanceof Error ? requestError.message : String(requestError));
    } finally {
      if (revision === loadRevision.current) setLoading(false);
    }
  }
  useEffect(() => {
    void load();
    return () => {
      loadRevision.current++;
    };
  }, []);
  async function create() {
    if (creating) return;
    setCreating(true);
    try {
      await api('/api/overlays', {
        method: 'POST',
        body: JSON.stringify({ name: 'Overlay', template: 'main-news', width: 1920, height: 1080 }),
      });
      await load();
    } catch (requestError) {
      setError(requestError instanceof Error ? requestError.message : String(requestError));
    } finally {
      setCreating(false);
    }
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
          <button
            className="primary-button"
            disabled={!can(user, 'obs:write') || creating}
            onClick={() => void create()}
          >
            <Plus size={17} /> {creating ? 'Wird erstellt …' : 'Neues Overlay'}
          </button>
        </div>
      </div>
      {error && (
        <div className="status-message status-error" role="alert">
          <AlertTriangle size={19} />
          <div>
            <strong>Overlays konnten nicht aktualisiert werden</strong>
            <p>{error}</p>
          </div>
        </div>
      )}
      {loading ? (
        <p className="muted">Overlays werden geladen …</p>
      ) : items.length > 0 ? (
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
                <Link className="button" to={overlayEditorRoute(overlay.id)}>
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
