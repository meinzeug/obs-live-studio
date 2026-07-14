import React, { useEffect, useMemo, useState } from 'react';
import { AlertTriangle, ArrowUpRight, Newspaper, Search } from 'lucide-react';
import { Link } from 'react-router-dom';
import { api } from '../api/client.js';

export function ArticlesPage() {
  const [articles, setArticles] = useState<any[]>([]);
  const [query, setQuery] = useState('');
  const [warningsOnly, setWarningsOnly] = useState(false);

  useEffect(() => {
    api<any[]>('/api/articles').then(setArticles);
  }, []);

  const warningCount = useMemo(
    () => articles.filter((article) => Array.isArray(article.warnings) && article.warnings.length > 0).length,
    [articles],
  );
  const filtered = useMemo(() => {
    const normalized = query.trim().toLocaleLowerCase('de-DE');
    return articles.filter((article) => {
      if (warningsOnly && (!Array.isArray(article.warnings) || article.warnings.length === 0)) return false;
      if (!normalized) return true;
      return [article.title, article.excerpt, article.source_name, ...(article.warnings ?? [])].some((value) =>
        String(value ?? '')
          .toLocaleLowerCase('de-DE')
          .includes(normalized),
      );
    });
  }, [articles, query, warningsOnly]);

  return (
    <section className="panel">
      <div className="page-title">
        <div>
          <p className="eyebrow">Redaktion</p>
          <h2>Nachrichten</h2>
          <p>Eingegangene Beiträge prüfen, Warnhinweise bewerten und für die Sendung freigeben.</p>
        </div>
        <span className="count-pill">{articles.length} Artikel</span>
      </div>
      <div className="search-row">
        <input
          type="search"
          value={query}
          onChange={(event) => setQuery(event.target.value)}
          placeholder="Titel, Quelle, Warnhinweis oder Inhalt suchen"
          aria-label="Nachrichten durchsuchen"
        />
        <span className="icon-button ghost-button" aria-hidden="true">
          <Search size={17} />
        </span>
      </div>
      <label className="toggle-row">
        <input type="checkbox" checked={warningsOnly} onChange={(event) => setWarningsOnly(event.target.checked)} />
        Nur Beiträge mit Warnhinweisen ({warningCount})
      </label>
      {filtered.length > 0 ? (
        <div className="article-list">
          {filtered.map((article) => {
            const warnings = Array.isArray(article.warnings) ? article.warnings : [];
            return (
              <Link className="article-row" key={article.id} to={`/articles/${article.id}`}>
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
                    {article.status}
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
