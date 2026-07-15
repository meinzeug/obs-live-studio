import React, { useEffect, useMemo, useState } from 'react';
import { AlertTriangle, ArrowUpRight, Newspaper, Search } from 'lucide-react';
import { Link, useSearchParams } from 'react-router-dom';
import { api } from '../api/client.js';
import { articleDetailRoute } from '../navigation.js';

export function ArticlesPage() {
  const [articles, setArticles] = useState<any[]>([]);
  const [searchParams, setSearchParams] = useSearchParams();
  const query = searchParams.get('q') ?? '';
  const status = searchParams.get('status') ?? '';
  const warningsOnly = searchParams.get('warnings') === 'true';

  useEffect(() => {
    api<any[]>('/api/articles').then(setArticles);
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
    return articles.filter((article) => {
      const articleStatus = String(article.status ?? 'new');
      if (status && articleStatus !== status) return false;
      if (warningsOnly && (!Array.isArray(article.warnings) || article.warnings.length === 0)) return false;
      if (!normalized) return true;
      return [article.title, article.excerpt, article.source_name, ...(article.warnings ?? [])].some((value) =>
        String(value ?? '')
          .toLocaleLowerCase('de-DE')
          .includes(normalized),
      );
    });
  }, [articles, query, status, warningsOnly]);

  return (
    <section className="panel">
      <div className="page-title">
        <div>
          <p className="eyebrow">Redaktion</p>
          <h2>Nachrichten</h2>
          <p>Eingegangene Beiträge prüfen, Warnhinweise bewerten und für die Sendung freigeben.</p>
        </div>
        <span className="count-pill">{filtered.length} von {articles.length} Artikeln</span>
      </div>
      <div className="filter-row">
        <div className="search-row">
          <input
            type="search"
            value={query}
            onChange={(event) => updateFilter('q', event.target.value)}
            placeholder="Titel, Quelle, Warnhinweis oder Inhalt suchen"
            aria-label="Nachrichten durchsuchen"
          />
          <span className="icon-button ghost-button" aria-hidden="true">
            <Search size={17} />
          </span>
        </div>
        <label className="compact-filter">
          Status
          <select value={status} onChange={(event) => updateFilter('status', event.target.value)}>
            <option value="">Alle Status</option>
            {statuses.map((item) => (
              <option key={item} value={item}>
                {item}
              </option>
            ))}
          </select>
        </label>
        <label className="toggle-row">
          <input
            type="checkbox"
            checked={warningsOnly}
            onChange={(event) => updateFilter('warnings', event.target.checked)}
          />
          Nur Beiträge mit Warnhinweisen ({warningCount})
        </label>
      </div>
      {filtered.length > 0 ? (
        <div className="article-list">
          {filtered.map((article) => {
            const warnings = Array.isArray(article.warnings) ? article.warnings : [];
            return (
              <Link className="article-row" key={article.id} to={articleDetailRoute(article.id)}>
                <div>
                  <h3>{article.title}</h3>
                  <p>{article.excerpt}</p>
                </div>
                <div className="article-meta">
                  <span>{article.source_name ?? 'Unbekannte Quelle'}</span>
                  {warnings.length > 0 && (
                    <span className="state-pill warning" title={warnings.join(', ')}>
                      <AlertTriangle size={12} /> {warnings.length} Warnhinweis{warnings.length === 1 ? '' : 'e'}
                    </span>
                  )}
                  <span
                    className={`state-pill ${['approved', 'published', 'on_air'].includes(article.status) ? 'success' : ''}`}
                  >
                    {article.status ?? 'new'}
                  </span>
                  <ArrowUpRight size={16} />
                </div>
              </Link>
            );
          })}
        </div>
      ) : (
        <div className="empty-state">
          <div>
            <Newspaper size={24} />
            <p>Keine passenden Nachrichten gefunden.</p>
          </div>
        </div>
      )}
    </section>
  );
}
