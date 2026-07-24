import React, { useEffect, useMemo, useState } from 'react';
import {
  AlertTriangle,
  ArrowUpRight,
  Check,
  CheckCheck,
  Clock3,
  Filter,
  ListChecks,
  Newspaper,
  RefreshCw,
  Search,
  ShieldCheck,
  Trash2,
  X,
} from 'lucide-react';
import { Link, useSearchParams } from 'react-router-dom';
import { api, can, type SessionUser } from '../api/client.js';
import { articleDetailRoute } from '../navigation.js';

type BulkAction = 'delete' | 'review' | 'approve' | 'discard';

function articleDate(article: any) {
  const value = article.published_at ?? article.created_at;
  if (!value) return 'Datum unbekannt';
  const date = new Date(value);
  return Number.isNaN(date.getTime())
    ? 'Datum unbekannt'
    : date.toLocaleString('de-DE', { dateStyle: 'medium', timeStyle: 'short' });
}

export function ArticlesPage({ user }: { user: SessionUser }) {
  const [articles, setArticles] = useState<any[]>([]);
  const [searchParams, setSearchParams] = useSearchParams();
  const [selected, setSelected] = useState<Set<string>>(new Set());
  const [sort, setSort] = useState<'newest' | 'oldest' | 'title' | 'status'>('newest');
  const [loading, setLoading] = useState(true);
  const [working, setWorking] = useState(false);
  const [message, setMessage] = useState('');
  const query = searchParams.get('q') ?? '';
  const status = searchParams.get('status') ?? '';
  const warningsOnly = searchParams.get('warnings') === 'true';
  const allowedWrite = can(user, 'articles:write');

  async function load() {
    setLoading(true);
    try {
      setArticles(await api<any[]>('/api/articles?limit=500'));
      setMessage('');
    } catch (error) {
      setMessage(error instanceof Error ? error.message : String(error));
    } finally {
      setLoading(false);
    }
  }

  useEffect(() => {
    void load();
  }, []);

  function updateFilter(key: string, value: string | boolean) {
    const next = new URLSearchParams(searchParams);
    if (value === '' || value === false) next.delete(key);
    else next.set(key, String(value));
    setSearchParams(next, { replace: true });
  }

  const warningCount = useMemo(
    () => articles.filter((article) => Array.isArray(article.warnings) && article.warnings.length > 0).length,
    [articles],
  );
  const statuses = useMemo(
    () => Array.from(new Set(articles.map((article) => String(article.status ?? 'new')))).sort(),
    [articles],
  );
  const filtered = useMemo(() => {
    const normalized = query.trim().toLocaleLowerCase('de-DE');
    const rows = articles.filter((article) => {
      const articleStatus = String(article.status ?? 'new');
      if (status && articleStatus !== status) return false;
      if (warningsOnly && (!Array.isArray(article.warnings) || article.warnings.length === 0)) return false;
      if (!normalized) return true;
      return [article.title, article.excerpt, article.main_text, article.source_name, ...(article.warnings ?? [])].some(
        (value) =>
          String(value ?? '')
            .toLocaleLowerCase('de-DE')
            .includes(normalized),
      );
    });
    return rows.sort((left, right) => {
      if (sort === 'title') return String(left.title).localeCompare(String(right.title), 'de');
      if (sort === 'status') return String(left.status).localeCompare(String(right.status), 'de');
      const leftDate = Date.parse(left.published_at ?? left.created_at ?? 0) || 0;
      const rightDate = Date.parse(right.published_at ?? right.created_at ?? 0) || 0;
      return sort === 'oldest' ? leftDate - rightDate : rightDate - leftDate;
    });
  }, [articles, query, sort, status, warningsOnly]);

  const selectedVisible = filtered.filter((article) => selected.has(article.id)).length;
  const allVisibleSelected = filtered.length > 0 && selectedVisible === filtered.length;
  const approvedCount = articles.filter((article) =>
    ['approved', 'published', 'on_air'].includes(article.status),
  ).length;
  const reviewCount = articles.filter((article) => ['new', 'review'].includes(article.status)).length;

  function toggleSelected(id: string) {
    setSelected((current) => {
      const next = new Set(current);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  }

  function toggleAllVisible() {
    setSelected((current) => {
      const next = new Set(current);
      if (allVisibleSelected) filtered.forEach((article) => next.delete(article.id));
      else filtered.forEach((article) => next.add(article.id));
      return next;
    });
  }

  async function runBulk(action: BulkAction, ids = [...selected]) {
    if (!ids.length || working) return;
    const label =
      action === 'delete'
        ? 'löschen'
        : action === 'approve'
          ? 'freigeben'
          : action === 'review'
            ? 'zur Prüfung markieren'
            : 'verwerfen';
    if ((action === 'delete' || action === 'discard') && !window.confirm(`${ids.length} Artikel wirklich ${label}?`))
      return;
    setWorking(true);
    try {
      const result = await api<{ count: number }>('/api/articles/bulk', {
        method: 'POST',
        body: JSON.stringify({ ids, action }),
      });
      setSelected((current) => {
        const next = new Set(current);
        ids.forEach((id) => next.delete(id));
        return next;
      });
      setMessage(`${result.count} Artikel erfolgreich bearbeitet.`);
      await load();
    } catch (error) {
      setMessage(error instanceof Error ? error.message : String(error));
    } finally {
      setWorking(false);
    }
  }

  return (
    <section className="panel articles-workspace">
      <div className="page-title articles-title">
        <div>
          <p className="eyebrow">Newsroom · Redaktionsdesk</p>
          <h2>Nachrichten verwalten</h2>
          <p>Beiträge sichten, gesammelt freigeben, Warnungen bearbeiten und nicht benötigte Meldungen entfernen.</p>
        </div>
        <button className="ghost-button" onClick={() => void load()} disabled={loading}>
          <RefreshCw size={16} className={loading ? 'spin' : ''} /> Aktualisieren
        </button>
      </div>

      <div className="articles-stat-grid">
        <article>
          <span>
            <Newspaper size={19} />
          </span>
          <div>
            <small>GESAMTBESTAND</small>
            <strong>{articles.length}</strong>
            <p>verfügbare Nachrichten</p>
          </div>
        </article>
        <article>
          <span>
            <Clock3 size={19} />
          </span>
          <div>
            <small>REDAKTIONSPRÜFUNG</small>
            <strong>{reviewCount}</strong>
            <p>neu oder in Prüfung</p>
          </div>
        </article>
        <article>
          <span>
            <ShieldCheck size={19} />
          </span>
          <div>
            <small>SENDEBEREIT</small>
            <strong>{approvedCount}</strong>
            <p>freigegeben oder veröffentlicht</p>
          </div>
        </article>
        <article className={warningCount ? 'warning' : ''}>
          <span>
            <AlertTriangle size={19} />
          </span>
          <div>
            <small>WARNHINWEISE</small>
            <strong>{warningCount}</strong>
            <p>benötigen Aufmerksamkeit</p>
          </div>
        </article>
      </div>

      <div className="articles-control-deck">
        <div className="search-row articles-search">
          <Search size={17} />
          <input
            type="search"
            value={query}
            onChange={(event) => updateFilter('q', event.target.value)}
            placeholder="Titel, Volltext, Quelle oder Warnhinweis durchsuchen"
            aria-label="Nachrichten durchsuchen"
          />
          {query && (
            <button
              className="icon-button ghost-button"
              onClick={() => updateFilter('q', '')}
              aria-label="Suche leeren"
            >
              <X size={15} />
            </button>
          )}
        </div>
        <label className="compact-filter">
          <Filter size={14} /> Status
          <select value={status} onChange={(event) => updateFilter('status', event.target.value)}>
            <option value="">Alle Status</option>
            {statuses.map((item) => (
              <option key={item} value={item}>
                {item}
              </option>
            ))}
          </select>
        </label>
        <label className="compact-filter">
          Sortierung
          <select value={sort} onChange={(event) => setSort(event.target.value as typeof sort)}>
            <option value="newest">Neueste zuerst</option>
            <option value="oldest">Älteste zuerst</option>
            <option value="title">Titel A–Z</option>
            <option value="status">Nach Status</option>
          </select>
        </label>
        <label className="toggle-row articles-warning-toggle">
          <input
            type="checkbox"
            checked={warningsOnly}
            onChange={(event) => updateFilter('warnings', event.target.checked)}
          />
          Nur Warnungen
        </label>
      </div>

      <div className={`articles-selection-bar ${selected.size ? 'visible' : ''}`}>
        <button className="ghost-button" onClick={toggleAllVisible}>
          <CheckCheck size={16} /> {allVisibleSelected ? 'Sichtbare abwählen' : 'Alle sichtbaren auswählen'}
        </button>
        <strong>{selected.size} ausgewählt</strong>
        <span />
        <button disabled={!allowedWrite || working} onClick={() => void runBulk('review')}>
          <ListChecks size={16} /> In Prüfung
        </button>
        <button disabled={!allowedWrite || working} onClick={() => void runBulk('approve')}>
          <Check size={16} /> Freigeben
        </button>
        <button className="danger-text" disabled={!allowedWrite || working} onClick={() => void runBulk('discard')}>
          <X size={16} /> Verwerfen
        </button>
        <button className="danger" disabled={!allowedWrite || working} onClick={() => void runBulk('delete')}>
          <Trash2 size={16} /> Löschen
        </button>
      </div>

      {message && <p className="overview-notice">{message}</p>}

      {filtered.length > 0 ? (
        <div className="article-list modern-article-list">
          <div className="article-list-heading">
            <label>
              <input type="checkbox" checked={allVisibleSelected} onChange={toggleAllVisible} />
              <span>{filtered.length} Treffer</span>
            </label>
            <span>Quelle &amp; Status</span>
            <span>Aktionen</span>
          </div>
          {filtered.map((article) => {
            const warnings = Array.isArray(article.warnings) ? article.warnings : [];
            return (
              <article className={`article-row ${selected.has(article.id) ? 'selected' : ''}`} key={article.id}>
                <label className="article-select" aria-label={`${article.title} auswählen`}>
                  <input
                    type="checkbox"
                    checked={selected.has(article.id)}
                    onChange={() => toggleSelected(article.id)}
                  />
                </label>
                <Link className="article-row-copy" to={articleDetailRoute(article.id)}>
                  <small>
                    {article.category ?? 'Nachricht'} · {articleDate(article)}
                  </small>
                  <h3>{article.title}</h3>
                  <p>{article.excerpt || article.main_text || 'Noch kein redaktioneller Vorschautext vorhanden.'}</p>
                </Link>
                <div className="article-meta">
                  <span className="article-source">{article.source_name ?? 'Unbekannte Quelle'}</span>
                  {warnings.length > 0 && (
                    <span className="state-pill warning" title={warnings.join(', ')}>
                      <AlertTriangle size={12} /> {warnings.length}
                    </span>
                  )}
                  <span
                    className={`state-pill ${['approved', 'published', 'on_air'].includes(article.status) ? 'success' : ''}`}
                  >
                    {article.status ?? 'new'}
                  </span>
                </div>
                <div className="article-row-actions">
                  <Link
                    className="icon-button ghost-button"
                    to={articleDetailRoute(article.id)}
                    title="Artikel öffnen"
                    aria-label="Artikel öffnen"
                  >
                    <ArrowUpRight size={16} />
                  </Link>
                  <button
                    className="icon-button ghost-button danger-text"
                    disabled={!allowedWrite || working}
                    title="Artikel löschen"
                    aria-label={`${article.title} löschen`}
                    onClick={() => void runBulk('delete', [article.id])}
                  >
                    <Trash2 size={16} />
                  </button>
                </div>
              </article>
            );
          })}
        </div>
      ) : (
        <div className="empty-state">
          <div>
            <Newspaper size={24} />
            <p>{loading ? 'Nachrichten werden geladen …' : 'Keine passenden Nachrichten gefunden.'}</p>
          </div>
        </div>
      )}
    </section>
  );
}
