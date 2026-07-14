import React, { useEffect, useState } from 'react';
import { Activity, AlertTriangle, Clock3, Gauge, RefreshCw, RotateCw, ShieldCheck } from 'lucide-react';
import { api, can, type SessionUser } from '../api/client.js';

interface SourceHealthSummary {
  sourceId: string;
  name: string;
  url: string;
  active: boolean;
  state: 'healthy' | 'degraded' | 'down' | 'inactive' | 'unknown';
  windowHours: number;
  totalChecks: number;
  successfulChecks: number;
  failedChecks: number;
  availabilityPercent: number | null;
  averageDurationMs: number | null;
  maximumDurationMs: number | null;
  lastCheckAt: string | null;
  lastStatus: string | null;
  lastError: string | null;
  consecutiveFailures: number;
  nextExpectedCheckAt: string | null;
  stale: boolean;
}

interface SourceHealthOverview {
  totalSources: number;
  healthy: number;
  degraded: number;
  down: number;
  inactive: number;
  unknown: number;
  averageAvailabilityPercent: number | null;
  averageDurationMs: number | null;
}

interface SourceHealthResponse {
  windowHours: number;
  overview: SourceHealthOverview;
  items: SourceHealthSummary[];
}

interface SourceCheckObservation {
  id: string;
  source_id: string;
  status: string;
  details: Record<string, unknown>;
  checked_at: string;
}

interface SourceHealthDetail {
  summary: SourceHealthSummary;
  recentChecks: SourceCheckObservation[];
}

function dateTime(value: string | null) {
  return value ? new Date(value).toLocaleString('de-DE') : 'Noch keine Prüfung';
}

function duration(value: number | null) {
  if (value === null) return '–';
  if (value < 1000) return `${value} ms`;
  return `${(value / 1000).toFixed(1)} s`;
}

function percentage(value: number | null) {
  return value === null ? '–' : `${value.toLocaleString('de-DE', { maximumFractionDigits: 1 })} %`;
}

function stateLabel(state: SourceHealthSummary['state']) {
  if (state === 'healthy') return 'Stabil';
  if (state === 'degraded') return 'Beeinträchtigt';
  if (state === 'down') return 'Ausgefallen';
  if (state === 'inactive') return 'Pausiert';
  return 'Unbekannt';
}

function stateClass(state: SourceHealthSummary['state']) {
  if (state === 'healthy') return 'success';
  if (state === 'down') return 'error';
  return 'warning';
}

function checkDetail(check: SourceCheckObservation) {
  const details = check.details ?? {};
  const parts = [
    Number.isFinite(Number(details.durationMs)) ? `Dauer ${duration(Number(details.durationMs))}` : '',
    Number.isFinite(Number(details.status)) ? `HTTP ${details.status}` : '',
    Number.isFinite(Number(details.items)) ? `${details.items} Beiträge erkannt` : '',
    Number.isFinite(Number(details.inserted)) ? `${details.inserted} neu` : '',
    details.notModified === true ? 'Inhalt unverändert' : '',
    typeof details.error === 'string' ? details.error : '',
  ].filter(Boolean);
  return parts.join(' · ');
}

export function SourceHealthPage({ user }: { user: SessionUser }) {
  const [hours, setHours] = useState(24);
  const [data, setData] = useState<SourceHealthResponse | null>(null);
  const [detail, setDetail] = useState<SourceHealthDetail | null>(null);
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [message, setMessage] = useState('');
  const [workingId, setWorkingId] = useState<string | null>(null);

  async function load() {
    try {
      const result = await api<SourceHealthResponse>(`/api/sources/health?hours=${hours}`);
      setData(result);
      if (selectedId && !result.items.some((item) => item.sourceId === selectedId)) {
        setSelectedId(null);
        setDetail(null);
      }
    } catch (error) {
      setMessage(error instanceof Error ? error.message : String(error));
    }
  }

  async function loadDetail(sourceId: string) {
    try {
      setSelectedId(sourceId);
      setDetail(await api<SourceHealthDetail>(`/api/sources/${sourceId}/health?hours=${hours}&limit=40`));
    } catch (error) {
      setMessage(error instanceof Error ? error.message : String(error));
    }
  }

  useEffect(() => {
    void load();
    const timer = window.setInterval(() => void load(), 15000);
    return () => window.clearInterval(timer);
  }, [hours, selectedId]);

  useEffect(() => {
    if (selectedId) void loadDetail(selectedId);
  }, [hours]);

  async function refresh(source: SourceHealthSummary) {
    setWorkingId(source.sourceId);
    try {
      const result = await api<{ message: string }>(`/api/sources/${source.sourceId}/refresh`, { method: 'POST' });
      setMessage(`${source.name}: ${result.message}`);
      await load();
      if (selectedId === source.sourceId) await loadDetail(source.sourceId);
    } catch (error) {
      setMessage(error instanceof Error ? error.message : String(error));
    } finally {
      setWorkingId(null);
    }
  }

  const overview = data?.overview;
  const allowed = can(user, 'sources:write');

  return (
    <section className="panel">
      <div className="page-title">
        <div>
          <p className="eyebrow">Quellenbetrieb</p>
          <h2>Quellenmonitor</h2>
          <p>Verfügbarkeit, Antwortzeiten, Fehlerfolgen und ausbleibende Abrufe der Nachrichtenquellen überwachen.</p>
        </div>
        <div className="page-title-actions">
          <select value={hours} onChange={(event) => setHours(Number(event.target.value))} aria-label="Zeitraum">
            <option value={6}>Letzte 6 Stunden</option>
            <option value={24}>Letzte 24 Stunden</option>
            <option value={168}>Letzte 7 Tage</option>
            <option value={720}>Letzte 30 Tage</option>
          </select>
          <button className="icon-button ghost-button" onClick={() => void load()} title="Aktualisieren">
            <RefreshCw size={18} />
          </button>
        </div>
      </div>

      <div className="stats-grid">
        <article className="stat">
          <div>
            <span>Überwachte Quellen</span>
            <strong>{overview?.totalSources ?? 0}</strong>
            <small>{overview?.inactive ?? 0} pausiert</small>
          </div>
          <span className="stat-icon">
            <Activity size={18} />
          </span>
        </article>
        <article className="stat">
          <div>
            <span>Stabil</span>
            <strong>{overview?.healthy ?? 0}</strong>
            <small>{overview?.degraded ?? 0} beeinträchtigt</small>
          </div>
          <span className="stat-icon success">
            <ShieldCheck size={18} />
          </span>
        </article>
        <article className="stat">
          <div>
            <span>Ausgefallen</span>
            <strong>{overview?.down ?? 0}</strong>
            <small>{overview?.unknown ?? 0} ohne Messdaten</small>
          </div>
          <span className={`stat-icon ${(overview?.down ?? 0) > 0 ? 'warning' : 'success'}`}>
            <AlertTriangle size={18} />
          </span>
        </article>
        <article className="stat">
          <div>
            <span>Verfügbarkeit</span>
            <strong>{percentage(overview?.averageAvailabilityPercent ?? null)}</strong>
            <small>Durchschnitt im Zeitraum</small>
          </div>
          <span className="stat-icon">
            <Gauge size={18} />
          </span>
        </article>
        <article className="stat">
          <div>
            <span>Antwortzeit</span>
            <strong>{duration(overview?.averageDurationMs ?? null)}</strong>
            <small>Durchschnitt aller Quellen</small>
          </div>
          <span className="stat-icon">
            <Clock3 size={18} />
          </span>
        </article>
      </div>

      {message && <p role="status">{message}</p>}

      <div className="source-grid">
        {(data?.items ?? []).map((source) => (
          <article className="source-card" key={source.sourceId}>
            <div>
              <div className="card-header">
                <h3>{source.name}</h3>
                <span className={`state-pill ${stateClass(source.state)}`}>{stateLabel(source.state)}</span>
              </div>
              <p className="card-meta">{source.url}</p>
              <p>
                Verfügbarkeit {percentage(source.availabilityPercent)} · Ø {duration(source.averageDurationMs)} ·{' '}
                {source.totalChecks} Prüfungen
              </p>
              <p className={source.lastError ? 'error-text' : 'muted'}>
                {source.lastError
                  ? source.lastError
                  : source.stale
                    ? 'Der erwartete Abruf ist überfällig.'
                    : `Zuletzt geprüft: ${dateTime(source.lastCheckAt)}`}
              </p>
            </div>
            <div className="card-footer">
              <span className="muted">
                {source.consecutiveFailures > 0 ? `${source.consecutiveFailures} Fehler in Folge` : 'Keine Fehlerfolge'}
              </span>
              <div className="toolbar">
                <button onClick={() => void loadDetail(source.sourceId)}>Verlauf</button>
                <button
                  disabled={!allowed || workingId === source.sourceId}
                  onClick={() => void refresh(source)}
                >
                  <RotateCw size={16} /> Jetzt abrufen
                </button>
              </div>
            </div>
          </article>
        ))}
      </div>

      {detail && (
        <div className="control-band">
          <div className="section-heading">
            <div>
              <p className="eyebrow">Prüfverlauf</p>
              <h3>{detail.summary.name}</h3>
            </div>
            <span className={`state-pill ${stateClass(detail.summary.state)}`}>
              {stateLabel(detail.summary.state)}
            </span>
          </div>
          {detail.recentChecks.length > 0 ? (
            <div className="source-grid">
              {detail.recentChecks.map((check) => (
                <article className="source-card" key={check.id}>
                  <div className="card-header">
                    <strong>{check.status === 'ok' ? 'Erfolgreich' : 'Fehlgeschlagen'}</strong>
                    <span className={`state-pill ${check.status === 'ok' ? 'success' : 'error'}`}>
                      {check.status}
                    </span>
                  </div>
                  <p className="card-meta">{dateTime(check.checked_at)}</p>
                  <p>{checkDetail(check) || 'Keine zusätzlichen Messdetails vorhanden.'}</p>
                </article>
              ))}
            </div>
          ) : (
            <p className="muted">Für diesen Zeitraum liegen noch keine Prüfungen vor.</p>
          )}
        </div>
      )}
    </section>
  );
}
