import React, { useEffect, useState } from 'react';
import { FlaskConical, PauseCircle, PlayCircle, Plus, RefreshCw, RotateCw, Rss, Wifi, WifiOff } from 'lucide-react';
import { api, can, type SessionUser } from '../api/client.js';
import { Forbidden } from '../components/Status.js';
export function SourcesPage({ user }: { user: SessionUser }) {
  const [sources, setSources] = useState<any[]>([]);
  const [form, setForm] = useState({
    name: 'Lokaler Testfeed',
    url: `${location.origin}/test-feed.xml`,
    type: 'rss',
  });
  const [msg, setMsg] = useState('');
  const [workingSource, setWorkingSource] = useState<string | null>(null);
  async function load() {
    setSources(await api('/api/sources'));
  }
  useEffect(() => {
    void load();
  }, []);
  async function save() {
    try {
      await api('/api/sources', { method: 'POST', body: JSON.stringify(form) });
      setMsg('Quelle gespeichert');
      await load();
    } catch (error) {
      setMsg(error instanceof Error ? error.message : String(error));
    }
  }
  async function test() {
    try {
      const r = await api<any>('/api/sources/test', {
        method: 'POST',
        body: JSON.stringify({ url: form.url }),
      });
      setMsg(`Verbindung erfolgreich: ${r.detected}`);
    } catch (error) {
      setMsg(error instanceof Error ? error.message : String(error));
    }
  }
  async function toggle(source: any) {
    setWorkingSource(source.id);
    try {
      await api(`/api/sources/${source.id}/active`, {
        method: 'POST',
        body: JSON.stringify({ active: !source.active }),
      });
      setMsg(`Quelle „${source.name}“ wurde ${source.active ? 'pausiert' : 'aktiviert'}.`);
      await load();
    } catch (error) {
      setMsg(error instanceof Error ? error.message : String(error));
    } finally {
      setWorkingSource(null);
    }
  }
  async function refresh(source: any) {
    setWorkingSource(source.id);
    try {
      const result = await api<{ message: string }>(`/api/sources/${source.id}/refresh`, { method: 'POST' });
      setMsg(`${source.name}: ${result.message}`);
      await load();
    } catch (error) {
      setMsg(error instanceof Error ? error.message : String(error));
    } finally {
      setWorkingSource(null);
    }
  }
  return (
    <section className="panel">
      <div className="page-title">
        <div>
          <p className="eyebrow">Ingest</p>
          <h2>Quellen</h2>
          <p>Feeds verwalten, pausieren und bei Bedarf sofort neu abrufen.</p>
        </div>
        <button className="icon-button ghost-button" onClick={load} title="Aktualisieren" aria-label="Aktualisieren">
          <RefreshCw size={18} />
        </button>
      </div>
      {!can(user, 'sources:write') && <Forbidden />}
      <div className="form-surface source-form">
        <label>
          Name
          <input value={form.name} onChange={(e) => setForm({ ...form, name: e.target.value })} />
        </label>
        <label>
          Feed-URL
          <input type="url" value={form.url} onChange={(e) => setForm({ ...form, url: e.target.value })} />
        </label>
        <div className="source-form-actions">
          <button onClick={test}>
            <FlaskConical size={17} /> Testen
          </button>
          <button className="primary-button" disabled={!can(user, 'sources:write')} onClick={save}>
            <Plus size={17} /> Anlegen
          </button>
        </div>
      </div>
      {msg && <p role="status">{msg}</p>}
      <div className="section-heading">
        <h3>Konfigurierte Feeds</h3>
        <span className="count-pill">{sources.length}</span>
      </div>
      {sources.length > 0 ? (
        <div className="source-grid">
          {sources.map((source) => {
            const working = workingSource === source.id;
            return (
              <article className="source-card" key={source.id}>
                <div>
                  <div className="card-header">
                    <h3>{source.name}</h3>
                    <span className={`state-pill ${source.active ? 'success' : 'warning'}`}>
                      {source.active ? <Wifi size={12} /> : <WifiOff size={12} />}
                      {source.active ? 'Aktiv' : 'Inaktiv'}
                    </span>
                  </div>
                  <p className="card-meta">{source.url}</p>
                  <p className="muted">
                    Vertrauen {source.trust_level}/100 · Intervall {source.fetch_interval_seconds}s · maximal{' '}
                    {source.max_articles} Beiträge
                  </p>
                </div>
                <div className="card-footer">
                  <span className={source.last_error ? 'error-text' : 'muted'}>
                    {source.last_error
                      ? `${source.last_error}${source.consecutive_errors ? ` · ${source.consecutive_errors} Fehler` : ''}`
                      : source.last_success_at
                        ? `Zuletzt erfolgreich ${new Date(source.last_success_at).toLocaleString('de-DE')}`
                        : 'Noch nicht abgerufen'}
                  </span>
                  <div className="toolbar">
                    <button disabled={!can(user, 'sources:write') || working} onClick={() => void refresh(source)}>
                      <RotateCw size={16} /> Jetzt abrufen
                    </button>
                    <button disabled={!can(user, 'sources:write') || working} onClick={() => void toggle(source)}>
                      {source.active ? <PauseCircle size={16} /> : <PlayCircle size={16} />}
                      {source.active ? 'Pausieren' : 'Aktivieren'}
                    </button>
                  </div>
                </div>
              </article>
            );
          })}
        </div>
      ) : (
        <div className="empty-state">
          <div>
            <Rss size={24} />
            <p>Noch keine Quellen angelegt.</p>
          </div>
        </div>
      )}
    </section>
  );
}
