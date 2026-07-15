import React, { useEffect, useState } from 'react';
import { ArrowLeft, CirclePlay, ListVideo, Play } from 'lucide-react';
import { Link, useParams } from 'react-router-dom';
import { api, can, type SessionUser } from '../api/client.js';
import { ErrorBox, Loading } from '../components/Status.js';
import { articlePath, routes } from '../routes.js';

type PlaylistResponse = {
  playlist: any | null;
  items: any[];
};

function articleId(item: any) {
  return String(item?.article_id ?? item?.articleId ?? '').trim();
}

export function BroadcastPlaylistPage({ user }: { user: SessionUser }) {
  const { id = '' } = useParams();
  const [data, setData] = useState<PlaylistResponse | null>(null);
  const [error, setError] = useState('');
  const [message, setMessage] = useState('');

  async function load() {
    if (!id) return;
    try {
      setData(await api<PlaylistResponse>(`/api/broadcast/playlists/${encodeURIComponent(id)}`));
      setError('');
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : String(reason));
    }
  }

  useEffect(() => {
    void load();
  }, [id]);

  async function start() {
    try {
      await api(`/api/broadcast/playlists/${encodeURIComponent(id)}/start`, { method: 'POST' });
      setMessage('Sendeliste wurde zum Start vorgemerkt.');
      await load();
    } catch (reason) {
      setMessage(reason instanceof Error ? reason.message : String(reason));
    }
  }

  if (!data && !error) return <Loading label="Sendeliste wird geladen …" />;

  return (
    <section className="panel">
      <Link className="back-link" to={routes.broadcast}>
        <ArrowLeft size={16} /> Zurück zur Senderegie
      </Link>
      {error && <ErrorBox message={error} />}
      {!error && !data?.playlist && <ErrorBox message="Diese Sendeliste existiert nicht oder wurde entfernt." />}
      {data?.playlist && (
        <>
          <div className="page-title">
            <div>
              <p className="eyebrow">Sendeliste</p>
              <h2>{data.playlist.name}</h2>
              <p>
                Status {data.playlist.status} · aktuelle Position {data.playlist.current_position ?? 0} ·{' '}
                {data.items.length} Beiträge
              </p>
            </div>
            <button className="primary-button" disabled={!can(user, 'broadcast:write')} onClick={() => void start()}>
              <Play size={17} /> Sendeliste starten
            </button>
          </div>
          {message && <p role="status">{message}</p>}
          {data.items.length > 0 ? (
            <ol className="broadcast-list playlist-detail-list">
              {data.items.map((item, index) => {
                const targetArticleId = articleId(item);
                const content = (
                  <>
                    <span className="list-index">{index + 1}</span>
                    <span>
                      <strong>{item.title ?? `Beitrag ${index + 1}`}</strong>
                      <small>Position {item.position ?? index} · {item.status ?? 'geplant'}</small>
                    </span>
                    <span className="state-pill">{item.status ?? 'geplant'}</span>
                  </>
                );
                return targetArticleId ? (
                  <li key={item.id}>
                    <Link className="list-row-link" to={articlePath(targetArticleId)}>
                      {content}
                    </Link>
                  </li>
                ) : (
                  <li key={item.id}>{content}</li>
                );
              })}
            </ol>
          ) : (
            <div className="empty-state">
              <div>
                <ListVideo size={24} />
                <p>Diese Sendeliste enthält noch keine Beiträge.</p>
              </div>
            </div>
          )}
          <div className="detail-section">
            <h3>Nächster Schritt</h3>
            <p>
              Beiträge werden in der Nachrichtenredaktion geprüft und anschließend einer Sendeliste zugeordnet. Öffnen Sie
              die Senderegie, um den laufenden Ablauf zu überwachen.
            </p>
            <Link className="button" to={`${routes.broadcast}#transport`}>
              <CirclePlay size={16} /> Transportsteuerung öffnen
            </Link>
          </div>
        </>
      )}
    </section>
  );
}
