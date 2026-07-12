import React, { useEffect, useRef, useState } from 'react';
import { api, can, type SessionUser } from '../api/client.js';
export function MediaPage({ user }: { user: SessionUser }) {
  const [items, setItems] = useState<any[]>([]);
  const [q, setQ] = useState('');
  const [uploading, setUploading] = useState(false);
  const input = useRef<HTMLInputElement>(null);
  async function load() {
    setItems(await api(`/api/media?q=${encodeURIComponent(q)}`));
  }
  useEffect(() => {
    void load();
  }, [q]);
  async function upload(files: FileList | null) {
    if (!files) return;
    setUploading(true);
    for (const f of Array.from(files)) {
      const fd = new FormData();
      fd.append('file', f);
      fd.append('license', 'unknown');
      await api('/api/media', { method: 'POST', body: fd as any });
    }
    setUploading(false);
    await load();
  }
  return (
    <section
      className="panel"
      onDragOver={(e) => e.preventDefault()}
      onDrop={(e) => {
        e.preventDefault();
        void upload(e.dataTransfer.files);
      }}
    >
      <h2>Medien</h2>
      <input value={q} onChange={(e) => setQ(e.target.value)} placeholder="Suche" />
      <button disabled={!can(user, 'articles:write') || uploading} onClick={() => input.current?.click()}>
        {uploading ? 'Upload…' : 'Mehrfachupload'}
      </button>
      <input hidden multiple ref={input} type="file" accept="image/*" onChange={(e) => void upload(e.target.files)} />
      <div className="media-grid">
        {items.map((m) => (
          <article key={m.id}>
            <img src={`/media/${m.id}/derivatives/thumb`} alt={m.filename} />
            <b>{m.filename}</b>
            <p>
              {m.license_name ?? 'Lizenz fehlt'} · {m.unused ? 'unbenutzt' : 'verwendet'}
            </p>
          </article>
        ))}
      </div>
    </section>
  );
}
