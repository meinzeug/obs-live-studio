import React, { useEffect, useState } from 'react';
import { AlertTriangle, ArrowLeft, AudioLines, CheckCircle2, ExternalLink, WandSparkles } from 'lucide-react';
import { Link, useParams } from 'react-router-dom';
import { api, can, type SessionUser } from '../api/client.js';
import { Loading } from '../components/Status.js';
import { safeEditorialSourceUrl } from '../editorial-source.js';

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

  const warnings = Array.isArray(a.warnings) ? a.warnings : [];
  const sourceUrl = safeEditorialSourceUrl(a.canonical_url, a.url);
  const publishedAt = a.published_at ? new Date(a.published_at).toLocaleString('de-DE') : null;

  async function approve() {
    if (
      warnings.length > 0 &&
      !window.confirm(
        `Dieser Beitrag enthält ${warnings.length} Warnhinweis${warnings.length === 1 ? '' : 'e'}. ` +
          'Bestätigen Sie die Freigabe nur, wenn Sie Quelle, Inhalt und Warnhinweise manuell geprüft haben.',
      )
    ) {
      return;
    }
    await post(`/api/articles/${id}/status`, { status: 'approved' });
  }

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
          <span className={`state-pill ${a.status === 'approved' ? 'success' : warnings.length ? 'warning' : ''}`}>
            {a.status ?? 'neu'}
          </span>
        </div>
        <p className="detail-copy">{a.main_text ?? a.excerpt}</p>
        {warnings.length > 0 && (
          <div className="status-message status-error" role="alert">
            <AlertTriangle size={19} />
            <div>
              <strong>Manuelle redaktionelle Prüfung erforderlich</strong>
              <p>Der Autopilot überspringt diesen Beitrag. Prüfen Sie vor einer Freigabe insbesondere:</p>
              {warnings.map((warning: string, index: number) => (
                <p key={`${warning}-${index}`}>• {warning}</p>
              ))}
            </div>
          </div>
        )}
        <div className="toolbar">
          <button disabled={!can(user, 'articles:write')} onClick={() => post(`/api/articles/${id}/process`)}>
            <WandSparkles size={17} /> Verarbeiten
          </button>
          <button className="primary-button" disabled={!can(user, 'articles:write')} onClick={() => void approve()}>
            <CheckCircle2 size={17} /> {warnings.length ? 'Geprüft freigeben' : 'Freigeben'}
          </button>
          <button disabled={!can(user, 'articles:write')} onClick={() => post(`/api/articles/${id}/tts`)}>
            <AudioLines size={17} /> TTS erzeugen
          </button>
        </div>
        {msg && <p role="status">{msg}</p>}
      </div>
      <div className="detail-section">
        <h3>Quelle und Attribution</h3>
        <p>
          <strong>{a.source_name ?? 'Unbekannte Quelle'}</strong>
          {a.author ? ` · ${a.author}` : ''}
          {publishedAt ? ` · veröffentlicht ${publishedAt}` : ''}
        </p>
        <p>
          Vertrauensbewertung: {Number.isFinite(Number(a.trust_score)) ? `${a.trust_score} von 100` : 'nicht bewertet'}
        </p>
        {sourceUrl && (
          <a className="button" href={sourceUrl} target="_blank" rel="noreferrer">
            Originalquelle öffnen <ExternalLink size={15} />
          </a>
        )}
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
