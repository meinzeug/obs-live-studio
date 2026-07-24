import {
  AlertTriangle,
  CalendarClock,
  CheckCircle2,
  CircleDot,
  Clock3,
  MonitorCheck,
  Radio,
  RadioTower,
} from 'lucide-react';
import { Link } from 'react-router-dom';
import { routes } from '../navigation.js';

export type SendebetriebRundownItem = {
  id: string;
  title?: string;
  position: number;
  duration_seconds?: number | null;
  audio_duration_seconds?: number | null;
  status: string;
  rules?: Record<string, unknown>;
};

export type SendebetriebPlaylist = {
  id: string;
  name: string;
  description?: string | null;
  scheduled_at?: string | null;
  production_status?: string;
  readiness_snapshot?: BroadcastReadiness | Record<string, never>;
  format_name?: string | null;
  format_color?: string | null;
  item_count?: number;
};

export type BroadcastReadinessIssue = {
  code: string;
  severity: 'error' | 'warning';
  label: string;
  detail: string;
  itemId?: string;
};

export type BroadcastReadiness = {
  playlistId: string;
  ready: boolean;
  status: string;
  checkedAt: string;
  itemCount: number;
  totalRuntimeSeconds: number;
  targetRuntimeSeconds: number | null;
  issues: BroadcastReadinessIssue[];
};

export type SendebetriebStatus = {
  mode: 'autopilot' | 'manual' | 'live' | 'breaking' | 'standby';
  current: {
    runId: string | null;
    playlist: SendebetriebPlaylist | null;
    item: SendebetriebRundownItem | null;
    playback: {
      status: string;
      itemId: string | null;
      position: number | null;
      stateRevision: number;
    };
    rundown: SendebetriebRundownItem[];
    nextItems: SendebetriebRundownItem[];
    elapsedMs: number;
    durationMs: number;
    remainingMs: number | null;
  };
  next: SendebetriebPlaylist | null;
  prepared: SendebetriebPlaylist[];
  live: {
    enabled: boolean;
    sceneName: string;
    currentSceneName: string | null;
    interruption: null | {
      id: string;
      kind: 'live' | 'breaking';
      source_playlist_id: string | null;
      source_playlist_name?: string | null;
      source_item_id: string | null;
      source_item_title?: string | null;
      source_position: number | null;
      source_playback_status: string | null;
      autopilot_was_enabled: boolean;
      autopilot_was_paused: boolean;
      started_at: string;
    };
  };
  autopilot: { enabled: boolean };
  obs: { status: string; connected: boolean; lastError?: string | null };
  stream: { active: boolean; reconnecting: boolean; congestion: number };
  activeShowSwitch: null | {
    id: string;
    status: string;
    target_playlist_id: string;
    target_playlist_name?: string;
    target_item_title?: string;
  };
  activeCue?: unknown;
  scheduleHealth?: { status?: string; delay_seconds?: number } | null;
  warnings: Array<{ code: string; level: 'info' | 'warning' | 'error'; message: string }>;
  serverTime: string;
};

const modeLabels: Record<SendebetriebStatus['mode'], string> = {
  autopilot: 'Autopilot',
  manual: 'Manuelle Sendung',
  live: 'Live-Regie',
  breaking: 'Breaking News',
  standby: 'Bereitschaft',
};

export const productionStatusLabels: Record<string, string> = {
  draft: 'Entwurf',
  incomplete: 'Unvollständig',
  ready: 'Sendefertig',
  scheduled: 'Eingeplant',
  prepared: 'In Regie vorbereitet',
  on_air: 'On Air',
  completed: 'Beendet',
  error: 'Fehlerhaft',
};

function durationLabel(milliseconds: number | null | undefined) {
  if (milliseconds == null || !Number.isFinite(milliseconds)) return '--:--';
  const seconds = Math.max(0, Math.round(milliseconds / 1000));
  const hours = Math.floor(seconds / 3600);
  const minutes = Math.floor((seconds % 3600) / 60);
  const rest = seconds % 60;
  return hours
    ? `${hours}:${String(minutes).padStart(2, '0')}:${String(rest).padStart(2, '0')}`
    : `${String(minutes).padStart(2, '0')}:${String(rest).padStart(2, '0')}`;
}

function timeLabel(value: string | null | undefined) {
  if (!value) return 'nicht eingeplant';
  const date = new Date(value);
  return Number.isNaN(date.getTime())
    ? value
    : date.toLocaleTimeString('de-DE', { hour: '2-digit', minute: '2-digit' });
}

export function OnAirBar({
  status,
  active,
}: {
  status: SendebetriebStatus | null | undefined;
  active: 'planning' | 'control';
}) {
  const progress =
    status?.current.durationMs && status.current.durationMs > 0
      ? Math.min(100, Math.max(0, (status.current.elapsedMs / status.current.durationMs) * 100))
      : 0;
  const highestWarning = status?.warnings.find((warning) => warning.level === 'error') ?? status?.warnings[0] ?? null;
  return (
    <section className="on-air-bar" aria-label="Gemeinsamer On-Air-Status">
      <div className="on-air-mode">
        <span className={`on-air-beacon mode-${status?.mode ?? 'standby'}`}>
          <CircleDot size={15} />
          {modeLabels[status?.mode ?? 'standby']}
        </span>
        <div className="sendebetrieb-tabs" aria-label="Sendebetrieb wechseln">
          <Link className={active === 'planning' ? 'active' : ''} to={routes.broadcast}>
            <CalendarClock size={15} /> Planung
          </Link>
          <Link className={active === 'control' ? 'active' : ''} to={routes.live}>
            <RadioTower size={15} /> Regie
          </Link>
        </div>
      </div>
      <div className="on-air-current">
        <div className="on-air-current-copy">
          <span>Jetzt</span>
          <strong>{status?.current.playlist?.name ?? 'Kein Programm aktiv'}</strong>
          <small>{status?.current.item?.title ?? 'Bereitschaft'}</small>
        </div>
        <div className="on-air-progress" aria-label="Laufzeit">
          <div>
            <span style={{ width: `${progress}%` }} />
          </div>
          <small>
            <Clock3 size={12} /> {durationLabel(status?.current.elapsedMs)} /{' '}
            {durationLabel(status?.current.durationMs)}
            {status?.current.remainingMs != null ? ` · noch ${durationLabel(status.current.remainingMs)}` : ''}
          </small>
        </div>
      </div>
      <div className="on-air-next">
        <span>Als Nächstes · {timeLabel(status?.next?.scheduled_at)}</span>
        <strong>{status?.next?.name ?? 'Noch keine Sendung eingeplant'}</strong>
      </div>
      <div className="on-air-systems">
        <span className={status?.obs.connected ? 'ok' : 'error'}>
          <MonitorCheck size={14} /> OBS {status?.obs.connected ? 'verbunden' : 'getrennt'}
        </span>
        <span className={status?.stream.active ? 'ok' : 'warning'}>
          <Radio size={14} /> Stream {status?.stream.active ? 'läuft' : 'aus'}
        </span>
      </div>
      <div className={`on-air-warning ${highestWarning?.level ?? 'ok'}`}>
        {highestWarning ? <AlertTriangle size={15} /> : <CheckCircle2 size={15} />}
        <span>{highestWarning?.message ?? 'Sendebetrieb ohne dringenden Eingriff'}</span>
        {(status?.warnings.length ?? 0) > 1 && <strong>+{status!.warnings.length - 1}</strong>}
      </div>
    </section>
  );
}
