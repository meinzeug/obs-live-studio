import React, { useEffect, useMemo, useRef, useState } from 'react';
import {
  ArrowDown,
  ArrowUp,
  Eye,
  EyeOff,
  Grid3X3,
  Layers3,
  LayoutDashboard,
  Maximize2,
  MessageSquare,
  Mic,
  MicOff,
  MonitorPlay,
  PictureInPicture2,
  RefreshCw,
  Radio,
  Send,
  SplitSquareHorizontal,
  Square,
  Trash2,
  Video,
  Wand2,
  Wifi,
} from 'lucide-react';
import { api, can, isApiRateLimitError, type SessionUser } from '../api/client.js';

type LiveLayout = 'fullscreen' | 'split' | 'grid' | 'pip';
type LiveTransition = 'cut' | 'fade' | 'swipe' | 'slide' | 'luma_wipe';

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

type LiveOverlayOption = {
  id: string;
  name: string;
  publishedVersion: number | null;
  draftVersion: number | null;
  obsConfiguredUrl: string | null;
};

type LiveStatus = {
  sceneName: string;
  settings: {
    enabled: boolean;
    layout: LiveLayout;
    transition: LiveTransition;
    transition_duration_ms: number;
    program_source_id: string | null;
    preview_source_id: string | null;
    overlay_project_id: string | null;
    chat_url: string | null;
    chat_visible: boolean;
  };
  currentScene?: { currentProgramSceneName?: string } | null;
  portal: { configured: boolean; baseUrl: string; tokenConfigured: boolean; error: string | null };
  overlays: LiveOverlayOption[];
  chat: { url: string | null; visible: boolean };
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

const transitionOptions: Array<{ id: LiveTransition; label: string }> = [
  { id: 'fade', label: 'Fade' },
  { id: 'cut', label: 'Cut' },
  { id: 'swipe', label: 'Swipe' },
  { id: 'slide', label: 'Slide' },
  { id: 'luma_wipe', label: 'Luma Wipe' },
];

function statusLabel(source: LiveSource) {
  if (source.status === 'live') return 'Live';
  if (source.status === 'connecting') return 'Verbindet';
  if (source.status === 'error') return 'Fehler';
  return 'Offline';
}

function monitorTile(source: LiveSource | null, fallback: string) {
  if (!source) {
    return (
      <div className="live-empty">
        <Video size={34} />
        <span>{fallback}</span>
      </div>
    );
  }
  return (
    <div className="live-tile live-monitor-tile">
      {source.previewUrl ? <img src={source.previewUrl} alt="" /> : <Video size={32} />}
      <span>{source.name}</span>
    </div>
  );
}

export function LivePage({ user }: { user: SessionUser }) {
  const [status, setStatus] = useState<LiveStatus | null>(null);
  const [message, setMessage] = useState('');
  const [error, setError] = useState('');
  const [busy, setBusy] = useState('');
  const [selectedOverlayId, setSelectedOverlayId] = useState('');
  const [chatUrl, setChatUrl] = useState('');
  const [transition, setTransition] = useState<LiveTransition>('fade');
  const [durationMs, setDurationMs] = useState(450);
  const backoffUntil = useRef(0);
  const allowed = can(user, 'obs:write');

  async function load() {
    if (!allowed || Date.now() < backoffUntil.current) return;
    try {
      const next = await api<LiveStatus>('/api/live/status');
      setStatus(next);
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

  useEffect(() => {
    if (!status) return;
    setSelectedOverlayId(status.settings.overlay_project_id ?? status.overlays[0]?.id ?? '');
    setChatUrl(status.chat.url ?? '');
    setTransition(status.settings.transition);
    setDurationMs(status.settings.transition_duration_ms);
  }, [status?.serverTime]);

  const sortedSources = useMemo(
    () => [...(status?.sources ?? [])].sort((a, b) => (a.obs?.index ?? 999) - (b.obs?.index ?? 999)),
    [status?.sources],
  );
  const visibleSources = sortedSources.filter((source) => source.obs && !source.obs.hidden);
  const previewSource = sortedSources.find((source) => source.id === status?.settings.preview_source_id) ?? null;
  const currentProgramScene = status?.currentScene?.currentProgramSceneName ?? 'unbekannt';

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
            Szene {status?.sceneName ?? '08_LIVE_STUDIO'} · Programm {currentProgramScene} · OBS{' '}
            {status?.obs.status ?? 'unbekannt'} · Portal {status?.portal.configured ? 'konfiguriert' : 'nicht konfiguriert'}
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
                () =>
                  api('/api/live/mode', {
                    method: 'POST',
                    body: JSON.stringify({ enabled: true, transition, durationMs }),
                  }),
                'Live-Modus in OBS aktiviert.',
              )
            }
            disabled={Boolean(busy)}
          >
            <MonitorPlay size={16} /> Live-Modus
          </button>
          <button
            onClick={() => run('preview-scene', () => api('/api/live/preview', { method: 'POST' }), 'Live-Szene ist in der Vorschau.')}
            disabled={Boolean(busy)}
          >
            <Eye size={16} /> In Vorschau
          </button>
          <button
            className="primary-button"
            onClick={() =>
              run(
                'take',
                () => api('/api/live/take', { method: 'POST', body: JSON.stringify({ transition, durationMs }) }),
                'Vorschau ins Programm übernommen.',
              )
            }
            disabled={Boolean(busy)}
          >
            <Send size={16} /> Take
          </button>
        </div>
      </section>

      {(message || error || status?.portal.error) && (
        <p className={`status-message ${error || status?.portal.error ? 'status-error' : 'status-ok'}`}>
          {error || status?.portal.error || message}
        </p>
      )}

      <section className="live-regie-grid">
        <div className="live-monitor-card preview">
          <div className="panel-heading">
            <h2>Vorschau</h2>
            <span className="state-pill">{previewSource ? previewSource.name : 'leer'}</span>
          </div>
          <div className="live-monitor-screen">{monitorTile(previewSource, 'Keine Quelle in Vorschau')}</div>
        </div>
        <div className="live-monitor-card program">
          <div className="panel-heading">
            <h2>Programm</h2>
            <span className={`state-pill ${status?.stream?.outputActive ? 'ok' : 'muted'}`}>
              {status?.stream?.outputActive ? 'Stream läuft' : 'Stream gestoppt'}
            </span>
          </div>
          <div className={`live-program-preview layout-${status?.settings.layout ?? 'grid'}`}>
            {visibleSources.length === 0
              ? monitorTile(null, 'Keine Quelle in OBS hinzugefügt')
              : visibleSources
                  .slice(0, status?.settings.layout === 'fullscreen' ? 1 : 9)
                  .map((source) => (
                    <div className="live-tile" key={source.id}>
                      {source.previewUrl ? <img src={source.previewUrl} alt="" /> : <Video size={32} />}
                      <span>{source.name}</span>
                    </div>
                  ))}
          </div>
        </div>
      </section>

      <section className="live-tools-grid">
        <div className="live-tool-card">
          <div className="panel-heading">
            <h2>Übergang</h2>
            <Wand2 size={18} />
          </div>
          <div className="live-form-row">
            <select value={transition} onChange={(event) => setTransition(event.target.value as LiveTransition)}>
              {transitionOptions.map((item) => (
                <option value={item.id} key={item.id}>
                  {item.label}
                </option>
              ))}
            </select>
            <input
              type="number"
              min={0}
              max={5000}
              step={50}
              value={durationMs}
              onChange={(event) => setDurationMs(Number(event.target.value))}
              aria-label="Übergangsdauer in Millisekunden"
            />
            <button
              disabled={Boolean(busy)}
              onClick={() =>
                run(
                  'transition',
                  () => api('/api/live/transition', { method: 'POST', body: JSON.stringify({ transition, durationMs }) }),
                  'Übergang gespeichert.',
                )
              }
            >
              Speichern
            </button>
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
        </div>

        <div className="live-tool-card">
          <div className="panel-heading">
            <h2>Overlay live wechseln</h2>
            <Layers3 size={18} />
          </div>
          <div className="live-form-row">
            <select value={selectedOverlayId} onChange={(event) => setSelectedOverlayId(event.target.value)}>
              <option value="">Kein Live-Studio-Overlay</option>
              {(status?.overlays ?? []).map((overlay) => (
                <option value={overlay.id} key={overlay.id}>
                  {overlay.name} · {overlay.publishedVersion ? `v${overlay.publishedVersion}` : 'Entwurf'}
                </option>
              ))}
            </select>
            <button
              className="primary-button"
              disabled={Boolean(busy) || !selectedOverlayId}
              onClick={() =>
                run(
                  'overlay',
                  () =>
                    api('/api/live/overlay/apply', {
                      method: 'POST',
                      body: JSON.stringify({ projectId: selectedOverlayId, transition, durationMs }),
                    }),
                  'Overlay live gewechselt.',
                )
              }
            >
              <Send size={16} /> Anwenden
            </button>
          </div>
          <p className="muted">Änderungen werden über das bestehende Overlay-System veröffentlicht und in OBS nachgeladen.</p>
        </div>

        <div className="live-tool-card">
          <div className="panel-heading">
            <h2>Chat</h2>
            <MessageSquare size={18} />
          </div>
          <div className="live-form-row">
            <input value={chatUrl} onChange={(event) => setChatUrl(event.target.value)} placeholder="Chat-Popout-/Embed-URL" />
            <button
              disabled={Boolean(busy)}
              onClick={() =>
                run(
                  'chat-save',
                  () => api('/api/live/chat', { method: 'POST', body: JSON.stringify({ url: chatUrl, visible: Boolean(chatUrl) }) }),
                  'Chat in OBS aktualisiert.',
                )
              }
            >
              Speichern
            </button>
            <button
              disabled={Boolean(busy) || !status?.chat.url}
              onClick={() =>
                run(
                  'chat-toggle',
                  () => api('/api/live/chat', { method: 'POST', body: JSON.stringify({ visible: !status?.chat.visible }) }),
                  status?.chat.visible ? 'Chat ausgeblendet.' : 'Chat eingeblendet.',
                )
              }
            >
              {status?.chat.visible ? <EyeOff size={16} /> : <Eye size={16} />}
              {status?.chat.visible ? 'Ausblenden' : 'Einblenden'}
            </button>
          </div>
        </div>
      </section>

      <section className="live-grid">
        <div className="live-program-panel">
          <div className="panel-heading">
            <h2>Streaming</h2>
            <span className={`state-pill ${status?.stream?.outputActive ? 'ok' : 'muted'}`}>
              {status?.stream?.outputActive ? 'aktiv' : 'aus'}
            </span>
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
            sortedSources.map((source, index) => (
              <article className={`live-source-card ${source.id === status?.settings.preview_source_id ? 'is-preview' : ''}`} key={source.id}>
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
                          disabled={index === 0}
                          onClick={() =>
                            run(
                              `up-${source.id}`,
                              () =>
                                api(`/api/live/sources/${encodeURIComponent(source.id)}`, {
                                  method: 'PATCH',
                                  body: JSON.stringify({ index: Math.max(0, (source.obs?.index ?? index) - 1) }),
                                }),
                              'Quelle nach oben verschoben.',
                            )
                          }
                          title="Nach oben"
                        >
                          <ArrowUp size={16} />
                        </button>
                        <button
                          onClick={() =>
                            run(
                              `down-${source.id}`,
                              () =>
                                api(`/api/live/sources/${encodeURIComponent(source.id)}`, {
                                  method: 'PATCH',
                                  body: JSON.stringify({ index: (source.obs?.index ?? index) + 1 }),
                                }),
                              'Quelle nach unten verschoben.',
                            )
                          }
                          title="Nach unten"
                        >
                          <ArrowDown size={16} />
                        </button>
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
                              `take-${source.id}`,
                              () =>
                                api('/api/live/take', {
                                  method: 'POST',
                                  body: JSON.stringify({ sourceId: source.id, transition, durationMs }),
                                }),
                              'Quelle ins Programm übernommen.',
                            )
                          }
                        >
                          Take
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
