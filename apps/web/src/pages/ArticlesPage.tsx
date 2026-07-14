import React, { useEffect, useMemo, useState } from 'react';
import { ArrowUpRight, Newspaper, Search } from 'lucide-react';
import { Link } from 'react-router-dom';
import { api } from '../api/client.js';
export function ArticlesPage() {
  const [articles, setArticles] = useState<any[]>([]);
  const [query, setQuery] = useState('');
  useEffect(() => {
    api<any[]>('/api/articles').then(setArticles);
  }, []);
  const filtered = useMemo(() => {
    const normalized = query.trim().toLocaleLowerCase('de-DE');
    if (!normalized) return articles;
    return articles.filter((article) =>
      [article.title, article.excerpt, article.source_name].some((value) =>
        String(value ?? '')
          .toLocaleLowerCase('de-DE')
          .includes(normalized),
      ),
    );
  }, [articles, query]);
  return (
    <section className="panel">
      <div className="page-title">
        <div>
          <p className="eyebrow">Redaktion</p>
          <h2>Nachrichten</h2>
          <p>Eingegangene Beiträge prüfen, verarbeiten und für die Sendung freigeben.</p>
        </div>
        <span className="count-pill">{articles.length} Artikel</span>
      </div>
      <div className="search-row">
        <input
          type="search"
          value={query}
          onChange={(event) => setQuery(event.target.value)}
          placeholder="Titel, Quelle oder Inhalt suchen"
          aria-label="Nachrichten durchsuchen"
        />
        <span className="icon-button ghost-button" aria-hidden="true">
          <Search size={17} />
        </span>
      </div>
      {filtered.length > 0 ? (
        <div className="article-list">
          {filtered.map((article) => (
            <Link className="article-row" key={article.id} to={`/articles/${article.id}`}>
              <div>
                <h3>{article.title}</h3>
                <p>{article.excerpt}</p>
              </div>
              <div className="article-meta">
                <span>{article.source_name}</span>
                <span
                  className={`state-pill ${['approved', 'published', 'on_air'].includes(article.status) ? 'success' : ''}`}
                >
                  {article.status}
                </span>
                <ArrowUpRight size={16} />
              </div>
            </Link>
          ))}
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
