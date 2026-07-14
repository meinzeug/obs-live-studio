import React, { useEffect, useRef, useState } from 'react';
import {
  AlertTriangle,
  ArrowLeft,
  AudioLines,
  BarChart3,
  CheckCircle2,
  Download,
  ExternalLink,
  Image as ImageIcon,
  RefreshCw,
  ShieldCheck,
  Upload,
  Video,
  WandSparkles,
  XCircle,
} from 'lucide-react';
import { Link, useParams } from 'react-router-dom';
import { api, can, type SessionUser } from '../api/client.js';
import { Loading } from '../components/Status.js';
import { safeEditorialSourceUrl } from '../editorial-source.js';

type MediaReadiness = {
  ready: boolean;
  approved_videos: number;
  approved_graphics: number;
  candidates: number;
  references: number;
};

type MediaCandidate = {
  id: string;
  media_id?: string | null;
  kind: 'video' | 'image' | 'graphic' | 'statistic' | 'reference';
  provider: string;
  title: string;
  source_url: string;
  preview_url?: string | null;
  embed_url?: string | null;
  author?: string | null;
  license_name?: string | null;
  license_url?: string | null;
  attribution?: string | null;
  duration_seconds?: number | null;
  relevance_score?: number;
  rights_status: 'approved' | 'review' | 'restricted' | 'unknown';
  status: 'candidate' | 'importing' | 'approved' | 'rejected' | 'reference' | 'failed';
  error?: string | null;
  metadata?: Record<string, unknown>;
};

type ArticleMediaState = {
  readiness: MediaReadiness;
  candidates: MediaCandidate[];
};

const emptyMedia: ArticleMediaState = {
  readiness: { ready: false, approved_videos: 0, approved_graphics: 0, candidates: 0, references: 0 },
  candidates: [],
};

function kindLabel(kind: MediaCandidate['kind']) {
  if (kind === 'video') return 'Video';
  if (kind === 'statistic') return 'Statistik';
  if (kind === 'reference') return 'Video-Referenz';
  if (kind === 'graphic') return 'Grafik';
  return 'Bild';
}

function CandidateIcon({ kind }: { kind: MediaCandidate['kind'] }) {
  if (kind === 'video' || kind === 'reference') return <Video size={18} />;
  if (kind === 'statistic') return <BarChart3 size={18} />;
  return <ImageIcon size={18} />;
}

export function ArticleDetailPage({ user }: { user: SessionUser }) {
  const { id } = useParams();
  const [a, setA] = useState<any>();
  const [media, setMedia] = useState<ArticleMediaState>(emptyMedia);
  const [msg, setMsg] = useState('');
  const [busy, setBusy] = useState('');
  const [rightsConfirmed, setRightsConfirmed] = useState(false);
  const [uploadAuthor, setUploadAuthor] = useState(user.display_name || user.email);
  const [uploadSource, setUploadSource] = useState('Eigene Aufnahme');
  const [uploadLicense, setUploadLicense] = useState('Eigene oder redaktionell freigegebene Aufnahme');
  const videoInput = useRef<HTMLInputElement>(null);

  async function load() {
    const [article, articleMedia] = await Promise.all([
      api(`/api/articles/${id}`),
      api<ArticleMediaState>(`/api/articles/${id}/media`).catch(() => emptyMedia),
    ]);
    setA(article);
    setMedia(articleMedia);
  }

  useEffect(() => {
    void load();
  }, [id]);

  async function post(path: string, body?: unknown) {
    const result = await api<any>(path, { method: 'POST', body: body ? JSON.stringify(body) : undefined });
    setMsg('Gespeichert');
    await load();
    return result;
  }

  async function mediaAction(label: string, path: string, body?: unknown) {
    setBusy(label);
    setMsg('');
    try {
      const result = await api<ArticleMediaState>(path, {
        method: 'POST',
        body: JSON.stringify(body ?? {}),
      });
      setMedia(result);
      setMsg('Medienauswahl aktualisiert');
    } catch (error) {
      setMsg(error instanceof Error ? error.message : String(error));
    } finally {
      setBusy('');
    }
  }

  async function uploadVideo(file?: File) {
    if (!file || !rightsConfirmed) return;
    setBusy('upload');
    setMsg('');
    try {
      const data = new FormData();
      data.append('rightsConfirmed', 'true');
      data.append('author', uploadAuthor);
      data.append('source', uploadSource);
      data.append('license', uploadLicense);
      data.append('file', file);
      const result = await api<ArticleMediaState>(`/api/articles/${id}/media/upload`, {
        method: 'POST',
        body: data,
      });
      setMedia(result);
      setMsg('Eigenes Video geprüft, gespeichert und mit dem Beitrag verknüpft');
      setRightsConfirmed(false);
    } catch (error) {
      setMsg(error instanceof Error ? error.message : String(error));
    } finally {
      setBusy('');
      if (videoInput.current) videoInput.current.value = '';
    }
  }

  if (!a) return <Loading label="Nachricht wird geladen …" />;

  const warnings = Array.isArray(a.warnings) ? a.warnings : [];
  const sourceUrl = safeEditorialSourceUrl(a.canonical_url, a.url);
  const publishedAt = a.published_at ? new Date(a.published_at).toLocaleString('de-DE') : null;
  const editable = can(user, 'articles:write');

  async function approve() {
    if (!media.readiness.ready) {
      setMsg('Vor der Freigabe muss mindestens ein geprüftes, lokal importiertes Video vorhanden sein.');
      return;
    }
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

  async function importCandidate(candidate: MediaCandidate) {
    const needsConfirmation = candidate.rights_status !== 'approved';
    if (
      needsConfirmation &&
      !window.confirm(
        'Die Nutzungsrechte dieses Treffers sind noch nicht bestätigt. Importieren Sie nur, wenn Sie Quelle, Lizenz und zulässige Verwendung manuell geprüft haben.',
      )
    ) {
      return;
    }
    await mediaAction(`import-${candidate.id}`, `/api/articles/${id}/media/${candidate.id}/import`, {
      confirmRights: needsConfirmation,
    });
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
          <button disabled={!editable} onClick={() => post(`/api/articles/${id}/process`)}>
            <WandSparkles size={17} /> Verarbeiten
          </button>
          <button
            className="primary-button"
            disabled={!editable || !media.readiness.ready}
            onClick={() => void approve()}
          >
            <CheckCircle2 size={17} /> {warnings.length ? 'Geprüft freigeben' : 'Freigeben'}
          </button>
          <button disabled={!editable} onClick={() => post(`/api/articles/${id}/tts`)}>
            <AudioLines size={17} /> TTS erzeugen
          </button>
        </div>
        {msg && <p role="status">{msg}</p>}
      </div>

      <div className="detail-section">
        <div className="page-title">
          <div>
            <h3>Video, Grafiken und Statistiken</h3>
            <p>Jeder sendefähige Beitrag benötigt mindestens ein geprüftes lokales Video.</p>
          </div>
          <button
            className="primary-button"
            disabled={!editable || Boolean(busy)}
            onClick={() => void mediaAction('discover', `/api/articles/${id}/media/discover`, { background: false })}
          >
            <RefreshCw size={17} /> {busy === 'discover' ? 'Suche läuft …' : 'Passende Medien suchen'}
          </button>
        </div>
        <div className={`status-message ${media.readiness.ready ? 'status-success' : 'status-error'}`} role="status">
          {media.readiness.ready ? <ShieldCheck size={19} /> : <AlertTriangle size={19} />}
          <div>
            <strong>{media.readiness.ready ? 'Beitrag ist visuell sendefähig' : 'Video fehlt noch'}</strong>
            <p>
              {media.readiness.approved_videos} Video · {media.readiness.approved_graphics} Grafik ·{' '}
              {media.readiness.candidates} offene Treffer · {media.readiness.references} Referenzen
            </p>
          </div>
        </div>

        <div className="drop-zone" style={{ alignItems: 'stretch', textAlign: 'left' }}>
          <div>
            <strong>Eigenes Video als Ersatz hochladen</strong>
            <p>
              MP4, WebM oder MOV; mindestens 640×360 Pixel. Das Video wird geprüft, stumm abgespielt und mit
              Sprecher-Audio kombiniert.
            </p>
          </div>
          <div
            style={{
              display: 'grid',
              gridTemplateColumns: 'repeat(auto-fit,minmax(220px,1fr))',
              gap: 12,
              width: '100%',
            }}
          >
            <label>
              Urheber
              <input value={uploadAuthor} onChange={(event) => setUploadAuthor(event.target.value)} />
            </label>
            <label>
              Quelle
              <input value={uploadSource} onChange={(event) => setUploadSource(event.target.value)} />
            </label>
            <label>
              Lizenz/Rechtsgrundlage
              <input value={uploadLicense} onChange={(event) => setUploadLicense(event.target.value)} />
            </label>
          </div>
          <label style={{ display: 'flex', gap: 10, alignItems: 'flex-start' }}>
            <input
              type="checkbox"
              checked={rightsConfirmed}
              onChange={(event) => setRightsConfirmed(event.target.checked)}
            />
            <span>Ich habe Urheberrecht, Lizenz und die zulässige Verwendung dieses Videos redaktionell geprüft.</span>
          </label>
          <button disabled={!editable || !rightsConfirmed || Boolean(busy)} onClick={() => videoInput.current?.click()}>
            <Upload size={17} /> {busy === 'upload' ? 'Video wird geprüft …' : 'Eigenes Video auswählen'}
          </button>
          <input
            hidden
            ref={videoInput}
            type="file"
            accept="video/mp4,video/webm,video/quicktime"
            onChange={(event) => void uploadVideo(event.target.files?.[0])}
          />
        </div>

        {media.candidates.length > 0 ? (
          <div className="media-grid">
            {media.candidates.map((candidate) => {
              const localThumb = candidate.media_id ? `/media/${candidate.media_id}/derivatives/thumb` : null;
              const preview = localThumb ?? candidate.preview_url;
              const statement = typeof candidate.metadata?.statement === 'string' ? candidate.metadata.statement : null;
              const importable = ['video', 'image', 'graphic', 'statistic'].includes(candidate.kind);
              return (
                <article className="media-card" key={candidate.id}>
                  {preview ? (
                    <img src={preview} alt={candidate.title} loading="lazy" referrerPolicy="no-referrer" />
                  ) : (
                    <div className="empty-state" style={{ minHeight: 160 }}>
                      <CandidateIcon kind={candidate.kind} />
                    </div>
                  )}
                  <div className="media-card-body">
                    <p className="eyebrow">
                      <CandidateIcon kind={candidate.kind} /> {kindLabel(candidate.kind)} · {candidate.provider}
                    </p>
                    <strong>{candidate.title}</strong>
                    {statement && <p>{statement}</p>}
                    <p>
                      {candidate.author ? `${candidate.author} · ` : ''}
                      {candidate.license_name ?? 'Lizenz nicht angegeben'}
                      {candidate.duration_seconds ? ` · ${Math.round(candidate.duration_seconds)} s` : ''}
                    </p>
                    <p>
                      Status: {candidate.status} · Rechte: {candidate.rights_status} · Relevanz:{' '}
                      {Math.round(Number(candidate.relevance_score ?? 0))}
                    </p>
                    {candidate.attribution && <p>{candidate.attribution}</p>}
                    {candidate.error && <p className="status-error">{candidate.error}</p>}
                    <div className="toolbar">
                      <a className="button" href={candidate.source_url} target="_blank" rel="noreferrer">
                        Quelle <ExternalLink size={15} />
                      </a>
                      {candidate.license_url && (
                        <a className="button" href={candidate.license_url} target="_blank" rel="noreferrer">
                          Lizenz <ShieldCheck size={15} />
                        </a>
                      )}
                      {importable && candidate.status !== 'approved' && candidate.status !== 'rejected' && (
                        <button disabled={!editable || Boolean(busy)} onClick={() => void importCandidate(candidate)}>
                          <Download size={15} />{' '}
                          {busy === `import-${candidate.id}`
                            ? 'Importiert …'
                            : candidate.kind === 'statistic'
                              ? 'Grafik erzeugen'
                              : 'Importieren'}
                        </button>
                      )}
                      {candidate.status !== 'rejected' && (
                        <button
                          disabled={!editable || Boolean(busy)}
                          onClick={() =>
                            void mediaAction(
                              `reject-${candidate.id}`,
                              `/api/articles/${id}/media/${candidate.id}/reject`,
                            )
                          }
                        >
                          <XCircle size={15} /> Ablehnen
                        </button>
                      )}
                    </div>
                  </div>
                </article>
              );
            })}
          </div>
        ) : (
          <div className="empty-state">
            <div>
              <Video size={24} />
              <p>Noch keine Medientreffer. Starten Sie die thematische Recherche.</p>
            </div>
          </div>
        )}
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
