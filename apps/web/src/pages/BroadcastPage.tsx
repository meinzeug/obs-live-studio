import React, { useEffect, useMemo, useRef, useState } from 'react';
import {
  ChevronDown,
  ChevronUp,
  CirclePlay,
  Cpu,
  ListVideo,
  MonitorUp,
  Pause,
  Play,
  Radio,
  SkipForward,
  Square,
} from 'lucide-react';
import { useSearchParams } from 'react-router-dom';
import { api, can, type SessionUser } from '../api/client.js';

const controllable: Record<string, string[]> = {
  idle: [],
  preparing: ['pause', 'skip', 'stop'],
  playing: ['pause', 'skip', 'stop'],
  paused: ['resume', 'skip', 'stop'],
  pausing: ['resume', 'skip', 'stop'],
  resuming: ['pause', 'skip', 'stop'],
  skipping: ['stop'],
  stopping: [],
  ended: [],
  error: [],
  interrupted: [],
};

const controls = [
  { action: 'pause', label: 'Pause', icon: Pause },
  { action: 'resume', label: 'Fortsetzen', icon: Play },
  { action: 'skip', label: 'Überspringen', icon: SkipForward },
  { action: 'stop', label: 'Stoppen', icon: Square },
];

function formatTime(value: unknown) {
  if (!value) return '-';
  const date = new Date(String(value));
  return Number.isNaN(date.getTime()) ? String(value) : date.toLocaleString('de-DE');
}

function commandKey(action: string) {
  return `${action}-${Date.now()}-${Math.random().toString(36).slice(2, 10)}`;
}

export function BroadcastPage({ user }: { user: SessionUser }) {
  const [searchParams] = useSearchParams();
  const view = searchParams.get('view') ?? '';
  const writeAllowed = can(user, 'broadcast:write');
  const [status, setStatus] = useState<any>();
  const [playlists, setPlaylists] = useState<any[]>([]);
  const [showAllPlaylists, setShowAllPlaylists] = useState(view === 'planned');
  const [message, setMessage] = useState('');
  const [workingAction, setWorkingAction] = useState('');
  const [startingPlaylistId, setStartingPlaylistId] = useState('');
  const loadInProgress = useRef(false);
  const loadAgain = useRef(false);

  async function load() {
    if (loadInProgress.current) {
      loadAgain.current = true;
      return;
    }
    loadInProgress.current = true;
    try {
      const [nextStatus, nextPlaylists] = await Promise.all([
        api('/api/broadcast/status'),
        api<any[]>('/api/broadcast/playlists'),
      ]);
      setStatus(nextStatus);
      setPlaylists(nextPlaylists);
    } catch (error) {
      setMessage(error instanceof Error ? error.message : String(error));
    } finally {
      loadInProgress.current = false;
      if (loadAgain.current) {
        loadAgain.current = false;
        void load();
      }
    }
  }

  useEffect(() => {
    void load();
  }, []);

  useEffect(() => {
    if (!view) return;
    if (view === 'planned') setShowAllPlaylists(true);
    const targetId = view === 'planned' ? 'broadcast-planned' : 'broadcast-active';
    const timer = window.setTimeout(() => document.getElementById(targetId)?.scrollIntoView({ block: 'start' }), 0);
    return () => window.clearTimeout(timer);
  }, [view, playlists.length]);

  useEffect(() => {
    let closed = false;
    let source: EventSource | null = null;
    let retryTimer: number | null = null;
    let lastId = Number(window.localStorage.getItem('broadcast:lastEventId') ?? 0);
    if (!Number.isFinite(lastId) || lastId < 0) lastId = 0;

    const connect = () => {
      if (closed || !writeAllowed) return;
      source = new EventSource(`/api/events/internal?lastEventId=${lastId}`);
      const update = (event: MessageEvent) => {
        if (event.lastEventId) {
          const id = Number(event.lastEventId);
          if (!Number.isFinite(id) || id <= lastId) return;
          lastId = id;
          window.localStorage.setItem('broadcast:lastEventId', String(lastId));
        }
        void load();
      };
      for (const name of [
        'article-prepared',
        'item-started',
        'item-paused',
        'item-resumed',
        'item-ended',
        'item-skipped',
        'broadcast-stopped',
        'broadcast-control',
        'obs-disconnected',
        'obs-restored',
        'scene-changed',
      ]) {
        source.addEventListener(name, update);
      }
      source.onerror = () => {
        source?.close();
        source = null;
        if (!closed && retryTimer === null) {
          retryTimer = window.setTimeout(() => {
            retryTimer = null;
            connect();
          }, 1500);
        }
      };
    };

    connect();
    const emergency = window.setInterval(() => void load(), 30000);
    return () => {
      closed = true;
      source?.close();
      if (retryTimer !== null) window.clearTimeout(retryTimer);
      window.clearInterval(emergency);
    };
  }, [writeAllowed]);

  async function control(action: string) {
    if (!writeAllowed || workingAction || startingPlaylistId) return;
    setWorkingAction(action);
    setMessage('');
    try {
      const result = await api<{ commandId: string; sequence: number; expectedState: string }>(
        '/api/broadcast/control',
        {
          method: 'POST',
          body: JSON.stringify({ action, idempotencyKey: commandKey(action) }),
        },
      );
      setMessage(`Befehl ${result.commandId} angenommen, Sequenz ${result.sequence}, Ziel ${result.expectedState}`);
      await load();
    } catch (error) {
      setMessage(error instanceof Error ? error.message : String(error));
    } finally {
      setWorkingAction('');
    }
  }

  async function start(id: string) {
    if (!writeAllowed || startingPlaylistId || workingAction || status?.run) return;
    setStartingPlaylistId(id);
    setMessage('');
    const idempotencyKey = commandKey(`start-${id}`);
    try {
      await api(`/api/broadcast/playlists/${id}/start`, {
        method: 'POST',
        headers: { 'idempotency-key': idempotencyKey },
        body: JSON.stringify({ idempotencyKey }),
      });
      setMessage('Sendestart angefordert. Der Broadcast-Runner übernimmt die Sendeliste.');
      await load();
    } catch (error) {
      setMessage(error instanceof Error ? error.message : String(error));
    } finally {
      setStartingPlaylistId('');
    }
  }

  const playback = status?.playback ?? { status: 'idle' };
  const controllableActions = useMemo(() => new Set(controllable[playback.status] ?? []), [playback.status]);
  const items = status?.items ?? [];
  const visiblePlaylists = showAllPlaylists ? playlists : playlists.slice(0, 10);
  const commandPending = Boolean(workingAction || startingPlaylistId);

  return (
    <section className="panel">
      <div className="page-title">
        <div>
          <p className="eyebrow">Senderegie</p>
          <h2>Broadcast</h2>
          <p>Aktiven Ablauf überwachen, Beiträge steuern und Sendelisten starten.</p>
        </div>
        <span className={`state-pill ${playback.status === 'playing' ? 'live' : ''}`}>
          <Radio size={12} /> {playback.status ?? 'idle'}
        </span>
      </div>

      <div className="stats-grid">
        <article className="stat">
          <div>
            <span>Playback</span>
            <strong>{playback.status ?? 'idle'}</strong>
            <small>
              Position {playback.position ?? '-'} · Revision{' '}
              {playback.stateRevision ?? status?.lease?.last_state_revision ?? 0}
            </small>
          </div>
          <span className={`stat-icon ${playback.status === 'playing' ? 'live' : ''}`}>
            <CirclePlay size={18} />
          </span>
        </article>
        <article className="stat">
          <div>
            <span>Runner</span>
            <strong>{status?.lease?.runner_id ? 'aktiv' : 'bereit'}</strong>
            <small>Lease bis {formatTime(status?.lease?.lease_expires_at)}</small>
          </div>
          <span className={`stat-icon ${status?.lease?.runner_id ? 'success' : ''}`}>
            <Cpu size={18} />
          </span>
        </article>
        <article className="stat">
          <div>
            <span>OBS-Medium</span>
            <strong>{playback.obsMediaStatus ?? '-'}</strong>
            <small>
              {playback.mediaPositionMs ?? '-'} / {playback.mediaDurationMs ?? '-'} ms
            </small>
          </div>
          <span className="stat-icon">
            <MonitorUp size={18} />
          </span>
        </article>
      </div>

      <div className="control-surface" id="broadcast-active">
        <div className="control-group">
          <span className="control-label">Transport</span>
          {controls.map(({ action, label, icon: Icon }) => (
            <button
              className={action === 'resume' ? 'primary-button' : action === 'stop' ? 'danger' : ''}
              key={action}
              disabled={!writeAllowed || commandPending || !controllableActions.has(action)}
              onClick={() => void control(action)}
            >
              <Icon size={17} /> {workingAction === action ? 'Wird ausgeführt …' : label}
            </button>
          ))}
        </div>
        <div className="control-group">
          <span className="control-label">Kontext</span>
          <span className="muted">Beitrag {playback.articleId ?? '-'}</span>
          <span className="state-pill">Recovery {playback.recoveryMode ?? '-'}</span>
        </div>
        {message && (
          <p className="notice" role="status">
            {message}
          </p>
        )}
      </div>

      <div className="broadcast-layout">
        <section className="broadcast-panel">
          <h3>Letzte Befehle</h3>
          <ol className="timeline-list">
            {(status?.commands ?? []).length ? (
              (status?.commands ?? []).map((command: any) => (
                <li key={command.id}>
                  <span className="list-index">{command.sequence}</span>
                  <span>
                    {command.command} {command.error_details?.reason ?? ''}
                  </span>
                  <span className={`state-pill ${command.status === 'completed' ? 'success' : ''}`}>
                    {command.status}
                  </span>
                </li>
              ))
            ) : (
              <li>
                <span className="list-index">-</span>
                <span>Noch keine Befehle</span>
                <span />
              </li>
            )}
          </ol>
        </section>
        <section className="broadcast-panel">
          <h3>Nächste Beiträge</h3>
          <ol className="broadcast-list">
            {items.slice((playback.position ?? 0) + 1, (playback.position ?? 0) + 4).length ? (
              items
                .slice((playback.position ?? 0) + 1, (playback.position ?? 0) + 4)
                .map((item: any, index: number) => (
                  <li key={item.id}>
                    <span className="list-index">{index + 1}</span>
                    <span>{item.title}</span>
                    <span className="state-pill">{item.status}</span>
                  </li>
                ))
            ) : (
              <li>
                <span className="list-index">-</span>
                <span>Keine weiteren Beiträge</span>
                <span />
              </li>
            )}
          </ol>
        </section>
      </div>

      <div className="section-heading" id="broadcast-planned">
        <div>
          <p className="eyebrow">Planung</p>
          <h3>Sendelisten</h3>
        </div>
        <ListVideo size={18} className="muted" />
      </div>
      <div className="playlist-list">
        {visiblePlaylists.map((playlist) => (
          <article className="playlist-row" key={playlist.id}>
            <div>
              <strong>{playlist.name}</strong>
              <p>
                {playlist.status} · Position {playlist.current_position}
              </p>
            </div>
            <button
              className="primary-button"
              disabled={!writeAllowed || commandPending || Boolean(status?.run)}
              onClick={() => void start(playlist.id)}
            >
              <Play size={17} />{' '}
              {startingPlaylistId === playlist.id ? 'Start wird angefordert …' : 'Starten'}
            </button>
          </article>
        ))}
        {playlists.length > 10 && (
          <button
            className="ghost-button"
            disabled={commandPending}
            onClick={() => setShowAllPlaylists((current) => !current)}
          >
            {showAllPlaylists ? <ChevronUp size={17} /> : <ChevronDown size={17} />}
            {showAllPlaylists ? 'Weniger anzeigen' : `${playlists.length - 10} weitere Sendelisten anzeigen`}
          </button>
        )}
      </div>
    </section>
  );
}
