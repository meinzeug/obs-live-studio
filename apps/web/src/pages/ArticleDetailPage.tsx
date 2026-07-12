import React, { useEffect, useState } from 'react';
import { useParams } from 'react-router-dom';
import { api, can, type SessionUser } from '../api/client.js';
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
  if (!a) return <p>Lade…</p>;
  return (
    <section className="panel">
      <h2>{a.title}</h2>
      <p>{a.main_text ?? a.excerpt}</p>
      <button disabled={!can(user, 'articles:write')} onClick={() => post(`/api/articles/${id}/process`)}>
        Verarbeiten
      </button>
      <button
        disabled={!can(user, 'articles:write')}
        onClick={() => post(`/api/articles/${id}/status`, { status: 'approved' })}
      >
        Freigeben
      </button>
      <button disabled={!can(user, 'articles:write')} onClick={() => post(`/api/articles/${id}/tts`)}>
        TTS
      </button>
      <p>{msg}</p>
      <h3>Zusammenfassung</h3>
      <p>{a.summary}</p>
      <h3>Sprechertext</h3>
      <p>{a.script_text}</p>
    </section>
  );
}
