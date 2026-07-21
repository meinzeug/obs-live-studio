import React, { useEffect, useMemo, useState } from 'react';
import {
  AlertTriangle,
  ArrowRight,
  CheckCircle2,
  Clock3,
  Edit3,
  ExternalLink,
  FileCheck2,
  HeartPulse,
  Newspaper,
  PlayCircle,
  Plus,
  RefreshCw,
  Rss,
  Search,
  Save,
  ShieldCheck,
  Sparkles,
  Trash2,
  Video,
  X,
} from 'lucide-react';
import { Link, useNavigate } from 'react-router-dom';
import { api, can, type SessionUser } from '../api/client.js';
import { articleDetailRoute, articlesRoute, routes, sourceHealthRoute } from '../navigation.js';
import { useStudioStatus } from '../studio-status.js';

type Article = {
  id: string;
  title: string;
  excerpt?: string | null;
  source_name?: string | null;
  status?: string;
  published_at?: string | null;
  fetched_at?: string | null;
  warnings?: string[];
  trust_score?: number;
};

type SourceHealth = {
  overview: { healthy: number; degraded: number; down: number; totalSources: number };
  items: Array<{ sourceId: string; name: string; state: string; lastSuccessAt?: string | null; consecutiveFailures: number }>;
};

type YoutubeResponse = {
  videos: Array<{ id: string; title: string; channel_name?: string; created_at?: string; duration_seconds?: number }>;
};

export function NewsroomPage({ user }: { user: SessionUser }) {
  const navigate = useNavigate();
  const { dashboard } = useStudioStatus();
  const [articles, setArticles] = useState<Article[]>([]);
  const [health, setHealth] = useState<SourceHealth | null>(null);
  const [youtube, setYoutube] = useState<YoutubeResponse['videos']>([]);
  const [query, setQuery] = useState('');
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const [busy, setBusy] = useState('');
  const [editingArticle, setEditingArticle] = useState<Article | null>(null);
  const [editForm, setEditForm] = useState({ title: '', excerpt: '' });
  const [creating, setCreating] = useState(false);
  const [createForm, setCreateForm] = useState({
    title: '',
    excerpt: '',
    mainText: '',
    author: user.display_name || user.email,
    category: 'Nachrichten',
    region: 'Deutschland',
    canonicalUrl: '',
  });
  const editable = can(user, 'articles:write');

  async function load() {
    setLoading(true);
    setError('');
    try {
      const [nextArticles, nextHealth, nextYoutube] = await Promise.all([
        api<Article[]>('/api/articles'),
        api<SourceHealth>('/api/sources/health?hours=24'),
        api<YoutubeResponse>('/api/youtube-videos'),
      ]);
      setArticles(nextArticles);
      setHealth(nextHealth);
      setYoutube(nextYoutube.videos ?? []);
    } catch (requestError) {
      setError(requestError instanceof Error ? requestError.message : String(requestError));
    } finally {
      setLoading(false);
    }
  }

  useEffect(() => {
    void load();
  }, []);

  function beginEdit(article: Article) {
    setEditingArticle(article);
    setEditForm({ title: article.title, excerpt: article.excerpt ?? '' });
    setError('');
  }

  async function saveArticle() {
    if (!editingArticle || !editable) return;
    setBusy(`save-${editingArticle.id}`);
    setError('');
    try {
      const updated = await api<Article>(`/api/articles/${editingArticle.id}`, {
        method: 'PATCH',
        body: JSON.stringify({
          title: editForm.title,
          excerpt: editForm.excerpt.trim() || null,
        }),
      });
      setArticles((current) => current.map((article) => (article.id === updated.id ? { ...article, ...updated } : article)));
      setEditingArticle(null);
    } catch (requestError) {
      setError(requestError instanceof Error ? requestError.message : String(requestError));
    } finally {
      setBusy('');
    }
  }

  async function deleteArticle(article: Article) {
    if (!editable) return;
    if (!window.confirm(`Nachricht „${article.title}“ wirklich löschen?`)) return;
    setBusy(`delete-${article.id}`);
    setError('');
    try {
      await api(`/api/articles/${article.id}`, { method: 'DELETE' });
      setArticles((current) => current.filter((item) => item.id !== article.id));
    } catch (requestError) {
      setError(requestError instanceof Error ? requestError.message : String(requestError));
    } finally {
      setBusy('');
    }
  }

  async function createArticle() {
    if (!editable) return;
    setBusy('create-article');
    setError('');
    try {
      const created = await api<Article>('/api/articles', {
        method: 'POST',
        body: JSON.stringify({
          title: createForm.title,
          excerpt: createForm.excerpt.trim() || null,
          mainText: createForm.mainText.trim() || createForm.excerpt.trim() || null,
          author: createForm.author.trim() || null,
          category: createForm.category.trim() || null,
          region: createForm.region.trim() || null,
          canonicalUrl: createForm.canonicalUrl.trim() || null,
        }),
      });
      setArticles((current) => [created, ...current.filter((article) => article.id !== created.id)]);
      setCreating(false);
      navigate(articleDetailRoute(created.id));
    } catch (requestError) {
      setError(requestError instanceof Error ? requestError.message : String(requestError));
    } finally {
      setBusy('');
    }
  }

  const filtered = useMemo(() => {
    const normalized = query.trim().toLocaleLowerCase('de');
    return articles.filter((article) =>
      !normalized || `${article.title} ${article.excerpt ?? ''} ${article.source_name ?? ''}`.toLocaleLowerCase('de').includes(normalized),
    );
  }, [articles, query]);
  const latest = filtered.slice(0, 7);
  const warningArticles = articles.filter((article) => (article.warnings?.length ?? 0) > 0).length;
  const approved = articles.filter((article) => ['approved', 'published', 'on_air'].includes(article.status ?? '')).length;

  return (
    <section className="workspace-hub newsroom-page">
      <header className="workspace-page-header">
        <div><p className="eyebrow">Redaktion</p><h1>Newsroom</h1><p>Von der Quelle bis zur freigegebenen Sendung – alle redaktionellen Schritte an einem Ort.</p></div>
        <div className="workspace-header-actions"><button onClick={() => void load()} disabled={loading}><RefreshCw size={17} className={loading ? 'spin' : ''} /> Aktualisieren</button><button className="primary-button" disabled={!editable} onClick={() => setCreating(true)}><Plus size={17} /> News erstellen</button><Link className="button" to={`${routes.sources}?create=true`}><Plus size={17} /> Quelle hinzufügen</Link></div>
      </header>

      {error && <div className="overview-notice error"><AlertTriangle size={16} />{error}</div>}

      <div className="newsroom-kpis">
        <Link to={articlesRoute({ status: 'new' })}><span className="hub-kpi-icon blue"><Newspaper /></span><div><small>Redaktionseingang</small><strong>{dashboard?.counts.newArticles ?? 0}</strong><span>neue Beiträge</span></div><ArrowRight /></Link>
        <Link to={articlesRoute({ warnings: true })}><span className="hub-kpi-icon amber"><AlertTriangle /></span><div><small>Prüfung nötig</small><strong>{warningArticles}</strong><span>mit Warnhinweisen</span></div><ArrowRight /></Link>
        <Link to={articlesRoute({ status: 'approved' })}><span className="hub-kpi-icon green"><FileCheck2 /></span><div><small>Sendefertig</small><strong>{approved}</strong><span>freigegeben</span></div><ArrowRight /></Link>
        <Link to={sourceHealthRoute({ state: 'problem' })}><span className="hub-kpi-icon rose"><HeartPulse /></span><div><small>Quellenzustand</small><strong>{health?.overview.down ?? dashboard?.counts.failedSources ?? 0}</strong><span>Fehler in 24 Stunden</span></div><ArrowRight /></Link>
      </div>

      <div className="newsroom-toolbar">
        <div className="studio-search-field"><Search size={17} /><input value={query} onChange={(event) => setQuery(event.target.value)} placeholder="Beiträge, Quellen und Themen durchsuchen …" /><kbd>⌘ K</kbd></div>
        <div className="newsroom-filter-links"><Link to={articlesRoute({ status: 'new' })}>Neu</Link><Link to={articlesRoute({ warnings: true })}>Zu prüfen</Link><Link to={articlesRoute({ status: 'approved' })}>Freigegeben</Link><Link to={routes.articles}>Alle Beiträge</Link></div>
      </div>

      <div className="newsroom-layout">
        <section className="hub-panel editorial-inbox">
          <header><div><p className="eyebrow">Aktueller Eingang</p><h2>Neueste Meldungen</h2></div><span>{filtered.length} Beiträge</span></header>
          <div className="editorial-list">
            {latest.map((article) => {
              const date = new Date(article.published_at ?? article.fetched_at ?? Date.now());
              const warnings = article.warnings?.length ?? 0;
              return <article className="editorial-row" key={article.id}>
                <div className="editorial-time"><strong>{date.toLocaleTimeString('de-DE', { hour: '2-digit', minute: '2-digit' })}</strong><small>{date.toLocaleDateString('de-DE', { day: '2-digit', month: '2-digit' })}</small></div>
                <div className="editorial-copy"><span><em>{article.source_name ?? 'Unbekannte Quelle'}</em>{warnings > 0 && <i className="warning"><AlertTriangle size={11} />{warnings}</i>}</span><strong>{article.title}</strong><p>{article.excerpt || 'Noch kein redaktioneller Auszug verfügbar.'}</p></div>
                <div className="editorial-score"><span>{article.trust_score ?? 0}%</span><small>Vertrauen</small></div>
                <div className="editorial-actions">
                  <Link className="button icon-button" to={articleDetailRoute(article.id)} aria-label="Nachricht öffnen">
                    <ArrowRight size={15} />
                  </Link>
                  <button disabled={!editable || Boolean(busy)} onClick={() => beginEdit(article)} aria-label="Nachricht bearbeiten">
                    <Edit3 size={15} />
                  </button>
                  <button
                    className="danger-button"
                    disabled={!editable || Boolean(busy)}
                    onClick={() => void deleteArticle(article)}
                    aria-label="Nachricht löschen"
                  >
                    <Trash2 size={15} />
                  </button>
                </div>
              </article>;
            })}
            {!loading && latest.length === 0 && <div className="hub-empty"><Search size={22} /><strong>Keine passenden Beiträge</strong><span>Passe die Suche an oder synchronisiere deine Quellen.</span></div>}
          </div>
          <footer><Link to={routes.articles}>Alle Nachrichten öffnen <ArrowRight size={15} /></Link></footer>
        </section>

        <aside className="newsroom-side-column">
          <section className="hub-panel source-pulse">
            <header><div><p className="eyebrow">Quellen</p><h2>Ingest-Status</h2></div><Rss size={19} /></header>
            <div className="source-health-ring-row"><div className="source-health-ring" style={{ '--healthy': `${health?.overview.totalSources ? (health.overview.healthy / health.overview.totalSources) * 100 : 0}%` } as React.CSSProperties}><span><strong>{health?.overview.healthy ?? 0}</strong><small>gesund</small></span></div><dl><div><dt><i className="good" />Aktiv</dt><dd>{health?.overview.healthy ?? 0}</dd></div><div><dt><i className="warning" />Warnung</dt><dd>{health?.overview.degraded ?? 0}</dd></div><div><dt><i className="error" />Fehler</dt><dd>{health?.overview.down ?? 0}</dd></div></dl></div>
            <div className="problem-sources">{health?.items.filter((item) => item.state !== 'healthy').slice(0, 3).map((item) => <Link key={item.sourceId} to={sourceHealthRoute({ source: item.sourceId })}><span><strong>{item.name}</strong><small>{item.consecutiveFailures} aufeinanderfolgende Fehler</small></span><AlertTriangle size={15} /></Link>)}{health && health.items.every((item) => item.state === 'healthy') && <div className="all-clear"><CheckCircle2 size={17} /><span>Alle Quellen arbeiten normal.</span></div>}</div>
            <footer><Link to={routes.sourceHealth}>Quellenmonitor öffnen <ArrowRight size={15} /></Link></footer>
          </section>

          <section className="hub-panel newsroom-ai-card">
            <header><div><p className="eyebrow">Redaktionshilfe</p><h2>KI Studio</h2></div><Sparkles size={19} /></header>
            <p>Texte umschreiben, Quellen einordnen, Sprechertexte erzeugen und Medienvorschläge prüfen.</p>
            <div><span><ShieldCheck size={14} /> Quellengetreu</span><span><FileCheck2 size={14} /> Redaktionell prüfbar</span></div>
            <Link className="button" to={routes.aiStudio}>KI-Werkzeuge öffnen <ArrowRight size={15} /></Link>
          </section>
        </aside>
      </div>

      <section className="hub-panel newsroom-video-strip">
        <header><div><p className="eyebrow">YouTube-Redaktion</p><h2>Neu in der Videothek</h2></div><Link to={routes.youtubeVideos}>Alle Videos <ArrowRight size={15} /></Link></header>
        <div>{youtube.slice(0, 4).map((video) => <Link key={video.id} to={routes.youtubeVideos}><span className="video-strip-thumb"><PlayCircle size={25} /></span><span><small>{video.channel_name || 'YouTube'}</small><strong>{video.title}</strong><em><Clock3 size={12} /> {Math.max(1, Math.round((video.duration_seconds ?? 0) / 60))} Min.</em></span><ExternalLink size={14} /></Link>)}{youtube.length === 0 && <div className="hub-empty"><Video size={22} /><strong>Noch keine YouTube-Videos</strong><span>Füge einen Kanal oder ein einzelnes Video hinzu.</span></div>}</div>
      </section>
      {editingArticle && (
        <div className="studio-modal-backdrop">
          <div className="studio-dialog article-edit-dialog" role="dialog" aria-modal="true" aria-label="Nachricht bearbeiten">
            <header>
              <div>
                <p className="eyebrow">Newsroom</p>
                <h2>Nachricht bearbeiten</h2>
              </div>
              <button onClick={() => setEditingArticle(null)} aria-label="Schließen">
                <X size={18} />
              </button>
            </header>
            <label>
              Überschrift
              <input
                value={editForm.title}
                onChange={(event) => setEditForm((current) => ({ ...current, title: event.target.value }))}
              />
            </label>
            <label>
              Kurztext
              <textarea
                rows={6}
                value={editForm.excerpt}
                onChange={(event) => setEditForm((current) => ({ ...current, excerpt: event.target.value }))}
              />
            </label>
            <footer>
              <button disabled={Boolean(busy)} onClick={() => setEditingArticle(null)}>
                <X size={16} /> Abbrechen
              </button>
              <button className="primary-button" disabled={Boolean(busy)} onClick={() => void saveArticle()}>
                <Save size={16} /> {busy.startsWith('save-') ? 'Speichert …' : 'Speichern'}
              </button>
            </footer>
          </div>
        </div>
      )}
      {creating && (
        <div className="studio-modal-backdrop">
          <div className="studio-dialog article-edit-dialog" role="dialog" aria-modal="true" aria-label="News erstellen">
            <header>
              <div>
                <p className="eyebrow">Newsroom</p>
                <h2>News manuell erstellen</h2>
              </div>
              <button onClick={() => setCreating(false)} aria-label="Schließen">
                <X size={18} />
              </button>
            </header>
            <div className="article-dialog-grid">
              <label className="wide">
                Überschrift
                <input
                  value={createForm.title}
                  onChange={(event) => setCreateForm((current) => ({ ...current, title: event.target.value }))}
                  placeholder="Klare, sendefähige Überschrift"
                />
              </label>
              <label>
                Autor
                <input
                  value={createForm.author}
                  onChange={(event) => setCreateForm((current) => ({ ...current, author: event.target.value }))}
                />
              </label>
              <label>
                Kategorie
                <input
                  value={createForm.category}
                  onChange={(event) => setCreateForm((current) => ({ ...current, category: event.target.value }))}
                />
              </label>
              <label>
                Region
                <input
                  value={createForm.region}
                  onChange={(event) => setCreateForm((current) => ({ ...current, region: event.target.value }))}
                />
              </label>
              <label>
                Quellen-URL optional
                <input
                  value={createForm.canonicalUrl}
                  onChange={(event) => setCreateForm((current) => ({ ...current, canonicalUrl: event.target.value }))}
                  placeholder="https://…"
                />
              </label>
              <label className="wide">
                Kurztext
                <textarea
                  rows={5}
                  value={createForm.excerpt}
                  onChange={(event) => setCreateForm((current) => ({ ...current, excerpt: event.target.value }))}
                  placeholder="Kurzfassung für Listen, Cards und Overlays"
                />
              </label>
              <label className="wide">
                Volltext
                <textarea
                  rows={10}
                  value={createForm.mainText}
                  onChange={(event) => setCreateForm((current) => ({ ...current, mainText: event.target.value }))}
                  placeholder="Vollständiger Nachrichtentext für Anzeige, KI-Aufbereitung und TTS"
                />
              </label>
            </div>
            <p className="dialog-note">Manuell erstellte News werden als „Review“ gespeichert und können danach wie importierte Beiträge freigegeben, mit Medien versehen und vertont werden.</p>
            <footer>
              <button disabled={Boolean(busy)} onClick={() => setCreating(false)}>
                <X size={16} /> Abbrechen
              </button>
              <button className="primary-button" disabled={Boolean(busy) || createForm.title.trim().length < 3} onClick={() => void createArticle()}>
                <Save size={16} /> {busy === 'create-article' ? 'Erstellt …' : 'News erstellen'}
              </button>
            </footer>
          </div>
        </div>
      )}
    </section>
  );
}
