import React, { useEffect, useState } from 'react';
import { ArrowLeft, FileImage, Link2 } from 'lucide-react';
import { Link, useParams } from 'react-router-dom';
import { api } from '../api/client.js';
import { Loading } from '../components/Status.js';
import { routes } from '../navigation.js';

function formatBytes(value: unknown) {
  const bytes = Number(value);
  if (!Number.isFinite(bytes) || bytes < 0) return 'Unbekannte Größe';
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`;
  return `${(bytes / 1024 / 1024).toFixed(1)} MB`;
}

export function MediaDetailPage() {
  const { id } = useParams();
  const [asset, setAsset] = useState<any>();
  const [usage, setUsage] = useState<any[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');

  useEffect(() => {
    let active = true;
    async function load() {
      try {
        const [assets, usages] = await Promise.all([
          api<any[]>('/api/media'),
          api<any[]>(`/api/media/${id}/usage`).catch(() => []),
        ]);
        if (!active) return;
        const found = assets.find((item) => item.id === id);
        if (!found) {
          setError('Das Medium wurde nicht gefunden oder inzwischen gelöscht.');
          return;
        }
        setAsset(found);
        setUsage(usages);
      } catch (cause) {
        if (active) setError(cause instanceof Error ? cause.message : String(cause));
      } finally {
        if (active) setLoading(false);
      }
    }
    void load();
    return () => {
      active = false;
    };
  }, [id]);

  if (loading) return <Loading label="Medium wird geladen …" />;

  return (
    <section className="panel">
      <Link className="back-link" to={routes.media}>
        <ArrowLeft size={16} /> Zurück zur Medienbibliothek
      </Link>
      {error ? (
        <div className="status-message status-error" role="alert">
          <FileImage size={19} />
          <div>
            <strong>Medium nicht verfügbar</strong>
            <p>{error}</p>
          </div>
        </div>
      ) : (
        <>
          <div className="page-title">
            <div>
              <p className="eyebrow">Mediendetails</p>
              <h2>{asset.filename}</h2>
              <p>Metadaten, Vorschau und aktuelle Verwendungen dieses Assets.</p>
            </div>
            <span className={`state-pill ${asset.unused ? 'warning' : 'success'}`}>
              {asset.unused ? 'Unbenutzt' : 'Verwendet'}
            </span>
          </div>
          <div className="media-detail-layout">
            <div className="media-detail-preview">
              <img src={`/media/${asset.id}`} alt={asset.filename} />
            </div>
            <div className="detail-section media-detail-meta">
              <h3>Dateiinformationen</h3>
              <p><strong>Dateityp:</strong> {asset.mime_type ?? 'Unbekannt'}</p>
              <p><strong>Größe:</strong> {formatBytes(asset.size_bytes)}</p>
              <p><strong>Lizenz:</strong> {asset.license_name ?? 'Nicht angegeben'}</p>
              <p><strong>Urheber:</strong> {asset.author ?? 'Nicht angegeben'}</p>
              <p><strong>Quelle:</strong> {asset.source ?? 'Nicht angegeben'}</p>
              {asset.attribution && <p><strong>Attribution:</strong> {asset.attribution}</p>}
            </div>
          </div>
          <div className="detail-section">
            <h3>Verwendungen</h3>
            {usage.length ? (
              <div className="usage-list">
                {usage.map((item, index) => (
                  <div className="usage-row" key={item.id ?? `${item.article_id ?? item.overlay_project_id}-${index}`}>
                    <Link2 size={16} />
                    <span>{item.purpose ?? 'Verknüpfung'}</span>
                    <small>{item.article_id ? `Artikel ${item.article_id}` : item.overlay_project_id ? `Overlay ${item.overlay_project_id}` : 'Interne Verwendung'}</small>
                  </div>
                ))}
              </div>
            ) : (
              <p>Dieses Medium ist derzeit mit keinem Beitrag oder Overlay verknüpft.</p>
            )}
          </div>
        </>
      )}
    </section>
  );
}
