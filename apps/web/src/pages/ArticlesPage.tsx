import React, { useEffect, useState } from 'react';
import { Link } from 'react-router-dom';
import { api } from '../api/client.js';
export function ArticlesPage() {
  const [articles, setArticles] = useState<any[]>([]);
  useEffect(() => {
    api<any[]>('/api/articles').then(setArticles);
  }, []);
  return (
    <section className="panel">
      <h2>Nachrichten</h2>
      {articles.map((a) => (
        <article key={a.id}>
          <Link to={`/articles/${a.id}`}>
            <h3>{a.title}</h3>
          </Link>
          <p>{a.excerpt}</p>
          <small>
            {a.source_name} · {a.status}
          </small>
        </article>
      ))}
    </section>
  );
}
