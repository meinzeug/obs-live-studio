import React, { useEffect, useRef, useState } from 'react';
import { CloudUpload, Images, Search, Upload } from 'lucide-react';
import { api, can, type SessionUser } from '../api/client.js';
export function MediaPage({ user }: { user: SessionUser }) {
  const [items, setItems] = useState<any[]>([]);
  const [q, setQ] = useState('');
  const [uploading, setUploading] = useState(false);
  const [message, setMessage] = useState('');
  const input = useRef<HTMLInputElement>(null);
  async function load() {
    setItems(await api(`/api/media?q=${encodeURIComponent(q)}`));
  }
  useEffect(() => {
    void load();
  }, [q]);
  async function upload(files: FileList | null) {
    if (!files?.length) return;
    setUploading(true);
    try {
      for (const file of Array.from(files)) {
        const formData = new FormData();
        formData.append('file', file);
        formData.append('license', 'unknown');
        await api('/api/media', { method: 'POST', body: formData as any });
      }
      setMessage(`${files.length} Datei${files.length === 1 ? '' : 'en'} hochgeladen`);
      await load();
    } catch (error) {
      setMessage(error instanceof Error ? error.message : String(error));
    } finally {
      setUploading(false);
    }
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
      <div className="page-title">
        <div>
          <p className="eyebrow">Asset-Bibliothek</p>
          <h2>Medien</h2>
          <p>Bilder für Beiträge, Vollbildgrafiken und Overlay-Elemente verwalten.</p>
        </div>
        <div className="page-title-actions">
          <button
            className="primary-button"
            disabled={!can(user, 'articles:write') || uploading}
            onClick={() => input.current?.click()}
          >
            <Upload size={17} /> {uploading ? 'Wird hochgeladen …' : 'Dateien hochladen'}
          </button>
        </div>
      </div>
      <div className="media-toolbar">
        <div className="search-row">
          <input
            type="search"
            value={q}
            onChange={(e) => setQ(e.target.value)}
            placeholder="Medien durchsuchen"
            aria-label="Medien durchsuchen"
          />
          <span className="icon-button ghost-button" aria-hidden="true">
            <Search size={17} />
          </span>
        </div>
        <span className="count-pill">{items.length} Dateien</span>
      </div>
      <div className="drop-zone">
        <CloudUpload size={22} className="muted" />
        <strong>Dateien hier ablegen</strong>
        <p>Unterstützte Bilddateien werden automatisch verarbeitet.</p>
      </div>
      {message && <p role="status">{message}</p>}
      <input hidden multiple ref={input} type="file" accept="image/*" onChange={(e) => void upload(e.target.files)} />
      {items.length > 0 ? (
        <div className="media-grid">
          {items.map((media) => (
            <article className="media-card" key={media.id}>
              <img src={`/media/${media.id}/derivatives/thumb`} alt={media.filename} />
              <div className="media-card-body">
                <strong>{media.filename}</strong>
                <p>
                  {media.license_name ?? 'Lizenz fehlt'} · {media.unused ? 'Unbenutzt' : 'Verwendet'}
                </p>
              </div>
            </article>
          ))}
        </div>
      ) : (
        <div className="empty-state">
          <div>
            <Images size={24} />
            <p>Keine Medien gefunden.</p>
          </div>
        </div>
      )}
    </section>
  );
}
