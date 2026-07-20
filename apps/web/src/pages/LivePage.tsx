import React, { useEffect, useMemo, useRef, useState } from 'react';
import {
  Eye,
  EyeOff,
  Grid3X3,
  LayoutDashboard,
  Maximize2,
  Mic,
  MicOff,
  MonitorPlay,
  PictureInPicture2,
  RefreshCw,
  Radio,
  SplitSquareHorizontal,
  Square,
  Trash2,
  Video,
  Wifi,
} from 'lucide-react';
import { api, can, isApiRateLimitError, type SessionUser } from '../api/client.js';

type LiveLayout = 'fullscreen' | 'split' | 'grid' | 'pip';

type LiveSource = {
  id: string;
  name: string;
  user: string | null;
  status: 'live' | 'connecting' | 'offline' | 'error';
  resolution: string | null;
  audioLevel: number | null;
  network: 'good' | 'unstable' | 'poor' | 'offline' | null;
  previewUrl: string | null;
  updatedAt: string | null;
  obs: null | {
    inputName: string;
    viewerUrl: string | null;
    muted: boolean;
    hidden: boolean;
    index: number;
    inProgram: boolean;
  };
};

type LiveStatus = {
  sceneName: string;
  settings: {
    enabled: boolean;
    layout: LiveLayout;
    program_source_id: string | null;
    preview_source_id: string | null;
  };
  portal: { configured: boolean; baseUrl: string; tokenConfigured: boolean; error: string | null };
  sources: LiveSource[];
  obs: { status: string; lastError?: string | null };
  stream: null | { outputActive: boolean; outputReconnecting?: boolean; outputCongestion?: number };
  serverTime: string;
};

const layoutOptions: Array<{ id: LiveLayout; label: string; icon: React.ElementType }> = [
  { id: 'fullscreen', label: 'Vollbild', icon: Maximize2 },
  { id: 'split', label: 'Split', icon: SplitSquareHorizontal },
  { id: 'grid', label: 'Raster', icon: Grid3X3 },
  { id: 'pip', label: 'PiP', icon: PictureInPicture2 },
];

function statusLabel(source: LiveSource) {
  if (source.status === 'live') return 'Live';
  if (source.status === 'connecting') return 'Verbindet';
  if (source.status === 'error') return 'Fehler';
  return 'Offline';
}

export function LivePage({ user }: { user: SessionUser }) {
  const [status, setStatus] = useState<LiveStatus | null>(null);
  const [message, setMessage] = useState('');
  const [error, setError] = useState('');
  const [busy, setBusy] = useState('');
  const backoffUntil = useRef(0);
  const allowed = can(user, 'obs:write');

  async function load() {
    if (!allowed || Date.now() < backoffUntil.current) return;
    try {
      setStatus(await api<LiveStatus>('/api/live/status'));
      setError('');
      backoffUntil.current = 0;
    } catch (err) {
      if (isApiRateLimitError(err)) {
        backoffUntil.current = Date.now() + 30_000;
        setError('Live-Status wurde kurz pausiert, weil zu viele Abfragen gleichzeitig liefen.');
        return;
      }
      setError(err instanceof Error ? err.message : String(err));
    }
  }

  async function run(action: string, request: () => Promise<unknown>, success: string) {
    setBusy(action);
    setError('');
    setMessage('');
    try {
      await request();
      setMessage(success);
      await load();
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
    } finally {
      setBusy('');
    }
  }

  useEffect(() => {
    void load();
    const timer = window.setInterval(() => void load(), 2500);
    return () => window.clearInterval(timer);
  }, [allowed]);

  const sortedSources = useMemo(
    () => [...(status?.sources ?? [])].sort((a, b) => (a.obs?.index ?? 999) - (b.obs?.index ?? 999)),
    [status?.sources],
  );

  if (!allowed) {
    return (
      <main className="page">
        <section className="panel">
          <h1>Live</h1>
          <p className="muted">Für die Live-Regie ist die OBS-Berechtigung erforderlich.</p>
        </section>
      </main>
    );
  }

  return (
    <main className="page live-page">
      <section className="live-controlbar">
        <div>
          <p className="eyebrow">Live-Regie</p>
          <h1>Live</h1>
          <p className="muted">
            Szene {status?.sceneName ?? '08_LIVE_STUDIO'} · OBS {status?.obs.status ?? 'unbekannt'} · Portal{' '}
            {status?.portal.configured ? 'konfiguriert' : 'nicht konfiguriert'}
          </p>
        </div>
        <div className="live-actions">
          <button onClick={() => void load()} disabled={Boolean(busy)} title="Aktualisieren">
            <RefreshCw size={16} /> Aktualisieren
          </button>
          <button
            onClick={() =>
              run(
                'mode',
                () => api('/api/live/mode', { method: 'POST', body: JSON.stringify({ enabled: true }) }),
                'Live-Modus in OBS aktiviert.',
              )
            }
            disabled={Boolean(busy)}
          >
            <MonitorPlay size={16} /> Live-Modus
          </button>
          <button
            className="primary-button"
            onClick={() => run('program', () => api('/api/live/program', { method: 'POST' }), 'Live-Szene ist im Programm.')}
            disabled={Boolean(busy)}
          >
            <Radio size={16} /> Programm
          </button>
        </div>
      </section>

      {(message || error || status?.portal.error) && (
        <p className={`status-message ${error || status?.portal.error ? 'status-error' : 'status-ok'}`}>
          {error || status?.portal.error || message}
        </p>
      )}

      <section className="live-grid">
        <div className="live-program-panel">
          <div className="panel-heading">
            <h2>Programm</h2>
            <span className={`state-pill ${status?.stream?.outputActive ? 'ok' : 'muted'}`}>
              {status?.stream?.outputActive ? 'Stream läuft' : 'Stream gestoppt'}
            </span>
          </div>
          <div className={`live-program-preview layout-${status?.settings.layout ?? 'grid'}`}>
            {sortedSources.filter((source) => source.obs && !source.obs.hidden).length === 0 ? (
              <div className="live-empty">
                <Video size={34} />
                <span>Keine Quelle in OBS hinzugefügt</span>
              </div>
            ) : (
              sortedSources
                .filter((source) => source.obs && !source.obs.hidden)
                .slice(0, status?.settings.layout === 'fullscreen' ? 1 : 9)
                .map((source) => (
                  <div className="live-tile" key={source.id}>
                    {source.previewUrl ? <img src={source.previewUrl} alt="" /> : <Video size={32} />}
                    <span>{source.name}</span>
                  </div>
                ))
            )}
          </div>
          <div className="live-layout-row">
            {layoutOptions.map(({ id, label, icon: Icon }) => (
              <button
                key={id}
                className={status?.settings.layout === id ? 'active' : ''}
                onClick={() =>
                  run(
                    `layout-${id}`,
                    () => api('/api/live/layout', { method: 'POST', body: JSON.stringify({ layout: id }) }),
                    `Layout ${label} angewendet.`,
                  )
                }
                disabled={Boolean(busy)}
                title={label}
              >
                <Icon size={16} /> {label}
              </button>
            ))}
          </div>
          <div className="live-stream-row">
            <button
              className="primary-button"
              disabled={Boolean(busy) || Boolean(status?.stream?.outputActive)}
              onClick={() => run('stream-start', () => api('/api/live/stream/start', { method: 'POST' }), 'Stream gestartet.')}
            >
              <Radio size={16} /> Streaming starten
            </button>
            <button
              disabled={Boolean(busy) || !status?.stream?.outputActive}
              onClick={() => run('stream-stop', () => api('/api/live/stream/stop', { method: 'POST' }), 'Stream gestoppt.')}
            >
              <Square size={16} /> Streaming stoppen
            </button>
          </div>
        </div>

        <div className="live-source-list">
          <div className="panel-heading">
            <h2>Quellen</h2>
            <span>{sortedSources.length}</span>
          </div>
          {sortedSources.length === 0 ? (
            <p className="muted">Keine aktiven Portal-Quellen gefunden.</p>
          ) : (
            sortedSources.map((source) => (
              <article className="live-source-card" key={source.id}>
                <div className="live-source-preview">
                  {source.previewUrl ? <img src={source.previewUrl} alt="" /> : <Video size={28} />}
                  <span className={`live-dot ${source.status}`}>{statusLabel(source)}</span>
                </div>
                <div className="live-source-body">
                  <div>
                    <h3>{source.name}</h3>
                    <p className="muted">{source.user || 'Unbekannter Benutzer'}</p>
                  </div>
                  <div className="live-source-meta">
                    <span>
                      <LayoutDashboard size={14} /> {source.resolution || 'keine Auflösung'}
                    </span>
                    <span>
                      <Mic size={14} /> {Math.round((source.audioLevel ?? 0) * 100)}%
                    </span>
                    <span>
                      <Wifi size={14} /> {source.network || 'unbekannt'}
                    </span>
                  </div>
                  <div className="live-source-actions">
                    {source.obs ? (
                      <>
                        <button
                          onClick={() =>
                            run(
                              `mute-${source.id}`,
                              () =>
                                api(`/api/live/sources/${encodeURIComponent(source.id)}`, {
                                  method: 'PATCH',
                                  body: JSON.stringify({ muted: !source.obs?.muted }),
                                }),
                              source.obs!.muted ? 'Quelle hörbar.' : 'Quelle stummgeschaltet.',
                            )
                          }
                          title={source.obs!.muted ? 'Ton einschalten' : 'Stummschalten'}
                        >
                          {source.obs!.muted ? <MicOff size={16} /> : <Mic size={16} />}
                        </button>
                        <button
                          onClick={() =>
                            run(
                              `hide-${source.id}`,
                              () =>
                                api(`/api/live/sources/${encodeURIComponent(source.id)}`, {
                                  method: 'PATCH',
                                  body: JSON.stringify({ hidden: !source.obs?.hidden }),
                                }),
                              source.obs!.hidden ? 'Quelle eingeblendet.' : 'Quelle ausgeblendet.',
                            )
                          }
                          title={source.obs!.hidden ? 'Einblenden' : 'Ausblenden'}
                        >
                          {source.obs!.hidden ? <EyeOff size={16} /> : <Eye size={16} />}
                        </button>
                        <button
                          onClick={() =>
                            run(
                              `preview-${source.id}`,
                              () =>
                                api(`/api/live/sources/${encodeURIComponent(source.id)}`, {
                                  method: 'PATCH',
                                  body: JSON.stringify({ preview: true }),
                                }),
                              'Quelle in Vorschau markiert.',
                            )
                          }
                        >
                          Vorschau
                        </button>
                        <button
                          className="primary-button"
                          onClick={() =>
                            run(
                              `program-${source.id}`,
                              () =>
                                api(`/api/live/sources/${encodeURIComponent(source.id)}`, {
                                  method: 'PATCH',
                                  body: JSON.stringify({ program: true, hidden: false }),
                                }),
                              'Quelle ins Programm übernommen.',
                            )
                          }
                        >
                          Programm
                        </button>
                        <button
                          onClick={() =>
                            run(
                              `remove-${source.id}`,
                              () => api(`/api/live/sources/${encodeURIComponent(source.id)}`, { method: 'DELETE' }),
                              'Quelle aus OBS entfernt.',
                            )
                          }
                          title="Aus OBS entfernen"
                        >
                          <Trash2 size={16} />
                        </button>
                      </>
                    ) : (
                      <button
                        className="primary-button"
                        disabled={source.status !== 'live' || Boolean(busy)}
                        onClick={() =>
                          run(
                            `add-${source.id}`,
                            () => api(`/api/live/sources/${encodeURIComponent(source.id)}/add`, { method: 'POST' }),
                            'Quelle in OBS hinzugefügt.',
                          )
                        }
                      >
                        <MonitorPlay size={16} /> In OBS
                      </button>
                    )}
                  </div>
                </div>
              </article>
            ))
          )}
        </div>
      </section>
    </main>
  );
}
