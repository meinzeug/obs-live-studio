import React, { useEffect, useState } from 'react';
import { ArrowLeft, AudioLines, CheckCircle2, WandSparkles } from 'lucide-react';
import { Link, useParams } from 'react-router-dom';
import { api, can, type SessionUser } from '../api/client.js';
import { Loading } from '../components/Status.js';
export function ArticleDetailPage({ user }: { user: SessionUser }) {
  const { id } = useParams();
  const [a, setA] = useState<any>();
  const [msg, setMsg] = useState('');
  async function load() {
    setA(await api(`/api/articles/${id}`));
  }
  useEffect(() => {
    void load();
  }, [id]);
  async function post(path: string, body?: unknown) {
    const r = await api<any>(path, { method: 'POST', body: body ? JSON.stringify(body) : undefined });
    setMsg('Gespeichert');
    await load();
    return r;
  }
  if (!a) return <Loading label="Nachricht wird geladen …" />;
  return (
    <section className="panel">
      <Link className="back-link" to="/articles">
        <ArrowLeft size={16} /> Zurück zu Nachrichten
      </Link>
      <div className="detail-hero">
        <div className="page-title">
          <div>
            <p className="eyebrow">Beitragsdetails</p>
            <h2>{a.title}</h2>
          </div>
          <span className={`state-pill ${a.status === 'approved' ? 'success' : ''}`}>{a.status ?? 'neu'}</span>
        </div>
        <p className="detail-copy">{a.main_text ?? a.excerpt}</p>
        <div className="toolbar">
          <button disabled={!can(user, 'articles:write')} onClick={() => post(`/api/articles/${id}/process`)}>
            <WandSparkles size={17} /> Verarbeiten
          </button>
          <button
            className="primary-button"
            disabled={!can(user, 'articles:write')}
            onClick={() => post(`/api/articles/${id}/status`, { status: 'approved' })}
          >
            <CheckCircle2 size={17} /> Freigeben
          </button>
          <button disabled={!can(user, 'articles:write')} onClick={() => post(`/api/articles/${id}/tts`)}>
            <AudioLines size={17} /> TTS erzeugen
          </button>
        </div>
        {msg && <p role="status">{msg}</p>}
      </div>
      <div className="detail-section">
        <h3>Zusammenfassung</h3>
        <p>{a.summary || 'Noch keine Zusammenfassung vorhanden.'}</p>
      </div>
      <div className="detail-section">
        <h3>Sprechertext</h3>
        <p>{a.script_text || 'Noch kein Sprechertext erzeugt.'}</p>
      </div>
    </section>
  );
}
