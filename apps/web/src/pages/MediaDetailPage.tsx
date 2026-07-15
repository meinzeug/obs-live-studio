import React, { useEffect, useState } from 'react';
import { ArrowLeft, ExternalLink, FileImage, ImageOff, Link2 } from 'lucide-react';
import { Link, useParams } from 'react-router-dom';
import { api } from '../api/client.js';
import { ErrorBox, Loading } from '../components/Status.js';
import { safeEditorialSourceUrl } from '../editorial-source.js';
import { articlePath, mediaDetailPath, overlayEditorPath, routes } from '../routes.js';

type MediaDetailResponse = {
  media: any | null;
  usage: any[];
};

function usageTarget(usage: any) {
  const articleId = String(usage?.article_id ?? usage?.articleId ?? '').trim();
  if (articleId) return { to: articlePath(articleId), label: 'Beitrag öffnen' };
  const overlayId = String(usage?.overlay_project_id ?? usage?.overlayProjectId ?? '').trim();
  if (overlayId) return { to: overlayEditorPath(overlayId), label: 'Overlay öffnen' };
  return null;
}

export function MediaDetailPage() {
  const { id = '' } = useParams();
  const [data, setData] = useState<MediaDetailResponse | null>(null);
  const [error, setError] = useState('');
  const [preview, setPreview] = useState<'preview' | 'original' | 'failed'>('preview');

  useEffect(() => {
    if (!id) return;
    api<MediaDetailResponse>(`/api/media/${encodeURIComponent(id)}`)
      .then((result) => {
        setData(result);
        setError('');
      })
      .catch((reason) => setError(reason instanceof Error ? reason.message : String(reason)));
  }, [id]);

  if (!data && !error) return <Loading label="Medium wird geladen …" />;
  const media = data?.media;
  const sourceUrl = media ? safeEditorialSourceUrl(media.original_url, media.source) : null;
  const mediaPath = `/media/${encodeURIComponent(id)}`;
  const previewPath = `${mediaPath}/derivatives/preview`;

  return (
    <section className="panel">
      <Link className="back-link" to={routes.media}>
        <ArrowLeft size={16} /> Zurück zur Medienbibliothek
      </Link>
      {error && <ErrorBox message={error} />}
      {!error && !media && <ErrorBox message="Dieses Medium existiert nicht oder wurde entfernt." />}
      {media && (
        <>
          <div className="page-title">
            <div>
              <p className="eyebrow">Medienbibliothek</p>
              <h2>{media.filename}</h2>
              <p>
                {media.mime_type ?? 'Unbekannter Typ'} · {Number(media.size_bytes ?? 0).toLocaleString('de-DE')} Bytes ·{' '}
                {media.license_name ?? 'Lizenz nicht angegeben'}
              </p>
            </div>
            <a className="button" href={mediaPath} target="_blank" rel="noreferrer">
              Original öffnen <ExternalLink size={15} />
            </a>
          </div>

          <div className="media-detail-layout">
            <div className="media-detail-preview">
              {preview === 'failed' ? (
                <div className="media-placeholder">
                  <ImageOff size={32} />
                  <span>Keine Vorschau verfügbar</span>
                </div>
              ) : (
                <img
                  src={preview === 'preview' ? previewPath : mediaPath}
                  alt={media.filename}
                  onError={() => setPreview((current) => (current === 'preview' ? 'original' : 'failed'))}
                />
              )}
            </div>
            <div className="detail-section media-detail-meta">
              <h3>Metadaten</h3>
              <dl className="metadata-list">
                <div>
                  <dt>Urheber</dt>
                  <dd>{media.author ?? 'Nicht angegeben'}</dd>
                </div>
                <div>
                  <dt>Lizenz</dt>
                  <dd>{media.license_name ?? 'Nicht angegeben'}</dd>
                </div>
                <div>
                  <dt>Attribution</dt>
                  <dd>{media.attribution ?? 'Nicht angegeben'}</dd>
                </div>
                <div>
                  <dt>Prüfsumme</dt>
                  <dd><code>{media.sha256 ?? 'Nicht vorhanden'}</code></dd>
                </div>
              </dl>
              {sourceUrl && (
                <a className="button" href={sourceUrl} target="_blank" rel="noreferrer">
                  Quelle öffnen <ExternalLink size={15} />
                </a>
              )}
            </div>
          </div>

          <div className="section-heading">
            <div>
              <p className="eyebrow">Verknüpfungen</p>
              <h3>Verwendung</h3>
            </div>
            <span className="count-pill">{data?.usage.length ?? 0}</span>
          </div>
          {data?.usage.length ? (
            <div className="source-grid">
              {data.usage.map((usage, index) => {
                const target = usageTarget(usage);
                return (
                  <article className="source-card" key={usage.id ?? `${id}-${index}`}>
                    <div>
                      <div className="card-header">
                        <h3>{usage.purpose ?? 'Verknüpfung'}</h3>
                        <span className="state-pill"><Link2 size={12} /> Aktiv</span>
                      </div>
                      <p className="card-meta">
                        {usage.article_title ?? usage.overlay_name ?? usage.article_id ?? usage.overlay_project_id ?? 'Interne Verwendung'}
                      </p>
                    </div>
                    <div className="card-footer">
                      <span className="muted">Medium {mediaDetailPath(id)}</span>
                      {target && <Link className="button" to={target.to}>{target.label}</Link>}
                    </div>
                  </article>
                );
              })}
            </div>
          ) : (
            <div className="empty-state">
              <div>
                <FileImage size={24} />
                <p>Dieses Medium ist aktuell mit keinem Beitrag oder Overlay verknüpft.</p>
              </div>
            </div>
          )}
        </>
      )}
    </section>
  );
}
