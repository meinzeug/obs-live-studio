import React, { useEffect, useRef, useState } from 'react';
import { AlertTriangle, CloudUpload, Images, Search, Upload } from 'lucide-react';
import { Link, useSearchParams } from 'react-router-dom';
import { api, can, type SessionUser } from '../api/client.js';
import { mediaDetailRoute } from '../navigation.js';
export function MediaPage({ user }: { user: SessionUser }) {
  const [items, setItems] = useState<any[]>([]);
  const [searchParams, setSearchParams] = useSearchParams();
  const q = searchParams.get('q') ?? '';
  const [uploading, setUploading] = useState(false);
  const [message, setMessage] = useState('');
  const [loadError, setLoadError] = useState('');
  const [loading, setLoading] = useState(true);
  const input = useRef<HTMLInputElement>(null);
  const loadRevision = useRef(0);
  async function load() {
    const revision = ++loadRevision.current;
    setLoading(true);
    try {
      const next = await api<any[]>(`/api/media?q=${encodeURIComponent(q)}`);
      if (revision !== loadRevision.current) return;
      setItems(next);
      setLoadError('');
    } catch (error) {
      if (revision === loadRevision.current) setLoadError(error instanceof Error ? error.message : String(error));
    } finally {
      if (revision === loadRevision.current) setLoading(false);
    }
  }
  useEffect(() => {
    void load();
    return () => {
      loadRevision.current++;
    };
  }, [q]);
  function setQuery(value: string) {
    const next = new URLSearchParams(searchParams);
    if (value) next.set('q', value);
    else next.delete('q');
    setSearchParams(next, { replace: true });
  }
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
            onChange={(e) => setQuery(e.target.value)}
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
      {loadError && (
        <div className="status-message status-error" role="alert">
          <AlertTriangle size={19} />
          <div>
            <strong>Medien konnten nicht geladen werden</strong>
            <p>{loadError}</p>
          </div>
        </div>
      )}
      <input hidden multiple ref={input} type="file" accept="image/*" onChange={(e) => void upload(e.target.files)} />
      {loading ? (
        <p className="muted">Medien werden geladen …</p>
      ) : items.length > 0 ? (
        <div className="media-grid">
          {items.map((media) => (
            <Link className="media-card media-card-link" key={media.id} to={mediaDetailRoute(media.id)}>
              <img src={`/media/${media.id}/derivatives/thumb`} alt={media.filename} loading="lazy" />
              <div className="media-card-body">
                <strong>{media.filename}</strong>
                <p>
                  {media.license_name ?? 'Lizenz fehlt'} · {media.unused ? 'Unbenutzt' : 'Verwendet'}
                </p>
              </div>
            </Link>
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
