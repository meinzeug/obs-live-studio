import React, { useEffect, useState } from 'react';
import { api, can, type SessionUser } from '../api/client.js';
import { Forbidden } from '../components/Status.js';
export function SourcesPage({ user }: { user: SessionUser }) {
  const [sources, setSources] = useState<any[]>([]);
  const [form, setForm] = useState({ name: 'Lokaler Testfeed', url: `${location.origin}/test-feed.xml`, type: 'rss' });
  const [msg, setMsg] = useState('');
  async function load() {
    setSources(await api('/api/sources'));
  }
  useEffect(() => {
    void load();
  }, []);
  async function save() {
    await api('/api/sources', { method: 'POST', body: JSON.stringify(form) });
    setMsg('Quelle gespeichert');
    await load();
  }
  async function test() {
    const r = await api<any>('/api/sources/test', { method: 'POST', body: JSON.stringify({ url: form.url }) });
    setMsg(`Test OK: ${r.detected}`);
  }
  return (
    <section className="panel">
      <h2>Quellen</h2>
      {!can(user, 'sources:write') && <Forbidden />}
      <input value={form.name} onChange={(e) => setForm({ ...form, name: e.target.value })} />
      <input value={form.url} onChange={(e) => setForm({ ...form, url: e.target.value })} />
      <button onClick={test}>Testen</button>
      <button disabled={!can(user, 'sources:write')} onClick={save}>
        Anlegen
      </button>
      <b>{msg}</b>
      {sources.map((s) => (
        <article key={s.id}>
          <b>{s.name}</b>
          <p>
            {s.url} · {s.active ? 'aktiv' : 'inaktiv'} · {s.last_error ?? s.last_success_at ?? 'neu'}
          </p>
        </article>
      ))}
    </section>
  );
}
