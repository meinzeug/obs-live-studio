import React, { useMemo, useState } from 'react';
import {
  AlertTriangle,
  ArrowRight,
  BarChart3,
  Bot,
  CalendarClock,
  CheckCircle2,
  ChevronRight,
  CirclePlay,
  Clapperboard,
  Clock3,
  Cpu,
  Database,
  Gauge,
  HardDrive,
  Layers3,
  MemoryStick,
  MonitorUp,
  Newspaper,
  Radio,
  RadioTower,
  RefreshCw,
  Rss,
  Sparkles,
  Video,
} from 'lucide-react';
import { Link } from 'react-router-dom';
import { api, can, type SessionUser } from '../api/client.js';
import { routes } from '../navigation.js';
import { useStudioStatus } from '../studio-status.js';

function percentClass(value: number) {
  return value >= 90 ? 'danger' : value >= 75 ? 'warning' : 'good';
}

function formatBytes(bytes: number) {
  if (!Number.isFinite(bytes) || bytes <= 0) return '0 GB';
  return `${(bytes / 1024 ** 3).toLocaleString('de-DE', { maximumFractionDigits: 1 })} GB`;
}

function formatDuration(seconds: number) {
  const hours = Math.floor(seconds / 3600);
  const minutes = Math.max(0, Math.round((seconds % 3600) / 60));
  return hours ? `${hours} Std. ${minutes} Min.` : `${minutes} Min.`;
}

function contentModeLabel(mode: string) {
  if (mode === 'youtube') return 'YouTube';
  if (mode === 'mixed') return 'News & YouTube';
  if (mode === 'youtube-news-sidebar') return 'Newsboard & YouTube';
  if (mode === 'youtube-context') return 'YouTube-Einordnung mit AVA';
  return 'Nachrichten';
}

export function DashboardPage({ user }: { user: SessionUser }) {
  const { dashboard, loading, error, refreshing, refresh, lastUpdated } = useStudioStatus();
  const [action, setAction] = useState('');
  const [message, setMessage] = useState('');
  const allowed = can(user, 'broadcast:write');
  const streamLive = Boolean(dashboard?.stream?.outputActive);
  const obsConnected = dashboard?.obs?.status === 'connected';
  const playbackStatus = String(dashboard?.playback?.status ?? 'idle');
  const now = Date.now();
  const upcoming = useMemo(
    () => dashboard?.schedule.filter((item) => new Date(item.scheduledAt).getTime() >= now - 60_000).slice(0, 6) ?? [],
    [dashboard?.schedule, now],
  );

  async function toggleAutopilot() {
    if (!dashboard || !allowed) return;
    setAction('autopilot');
    setMessage('');
    try {
      await api('/api/autopilot', {
        method: 'POST',
        body: JSON.stringify({ enabled: !dashboard.automation.enabled }),
      });
      setMessage(`Autopilot ${dashboard.automation.enabled ? 'pausiert' : 'aktiviert'}.`);
      await refresh();
    } catch (requestError) {
      setMessage(requestError instanceof Error ? requestError.message : String(requestError));
    } finally {
      setAction('');
    }
  }

  async function planDay() {
    if (!allowed) return;
    setAction('plan');
    setMessage('');
    try {
      const result = await api<{ created?: unknown[]; skipped?: unknown[] }>('/api/autopilot/plan-24h', {
        method: 'POST',
        body: JSON.stringify({ replaceExisting: false }),
      });
      setMessage(
        `${result.created?.length ?? 0} Sendungen geplant, ${result.skipped?.length ?? 0} vorhandene Zeitfenster beibehalten.`,
      );
      await refresh();
    } catch (requestError) {
      setMessage(requestError instanceof Error ? requestError.message : String(requestError));
    } finally {
      setAction('');
    }
  }

  return (
    <section className="studio-overview-page">
      <header className="workspace-page-header">
        <div>
          <p className="eyebrow">Studio-Kontrollzentrum</p>
          <h1>Guten Tag, {user.display_name.split(/\s+/)[0]}</h1>
          <p>Dein kompletter Senderbetrieb – live, geplant und technisch – auf einer Seite.</p>
        </div>
        <div className="workspace-header-actions">
          <span className={`overview-health-pill ${error ? 'error' : obsConnected ? 'good' : 'warning'}`}>
            {error ? <AlertTriangle size={15} /> : obsConnected ? <CheckCircle2 size={15} /> : <MonitorUp size={15} />}
            {error
              ? 'Studio nicht erreichbar'
              : obsConnected
                ? 'Alle Kernsysteme bereit'
                : 'OBS benötigt Aufmerksamkeit'}
          </span>
          <button className="icon-button" onClick={() => void refresh()} aria-label="Übersicht aktualisieren">
            <RefreshCw size={17} className={refreshing ? 'spin' : ''} />
          </button>
        </div>
      </header>

      {message && (
        <div className="overview-notice" role="status">
          <Sparkles size={16} />
          {message}
        </div>
      )}
      {error && (
        <div className="overview-notice error" role="alert">
          <AlertTriangle size={16} />
          {error}
        </div>
      )}

      <div className="on-air-grid">
        <article className={`on-air-card ${streamLive ? 'live' : ''}`}>
          <div className="on-air-visual">
            <div className="preview-grid-pattern" />
            <span className="preview-station-mark">
              <RadioTower size={18} /> OPEN TV
            </span>
            <div className="preview-center-state">
              {streamLive ? <Radio size={34} /> : <CirclePlay size={38} />}
              <strong>{streamLive ? 'AUF SENDUNG' : 'BEREIT FÜR SENDUNG'}</strong>
              <span>{dashboard?.current.item ?? 'Studio wird geladen …'}</span>
            </div>
            <span className={`preview-live-badge ${streamLive ? 'active' : ''}`}>
              <i />
              {streamLive ? 'LIVE' : 'OFF AIR'}
            </span>
            <div className="preview-lower-third">
              <span>{dashboard?.current.scene ?? 'Programm'}</span>
              <strong>{dashboard?.current.item ?? 'Keine Sendung aktiv'}</strong>
            </div>
          </div>
          <footer>
            <span>
              <i className={obsConnected ? 'good' : 'warning'} /> OBS {obsConnected ? 'verbunden' : 'getrennt'}
            </span>
            <span>
              <i className={playbackStatus === 'playing' ? 'good' : ''} /> Wiedergabe: {playbackStatus}
            </span>
            <Link to={routes.live}>
              Regie öffnen <ArrowRight size={15} />
            </Link>
          </footer>
        </article>

        <aside className="next-show-card">
          <header>
            <div>
              <p className="eyebrow">Als Nächstes</p>
              <h2>{dashboard?.current.next ?? 'Noch nicht geplant'}</h2>
            </div>
            <CalendarClock size={21} />
          </header>
          <div className="next-show-time">
            <span>
              {dashboard?.current.nextAt
                ? new Date(dashboard.current.nextAt).toLocaleTimeString('de-DE', { hour: '2-digit', minute: '2-digit' })
                : '--:--'}
            </span>
            <div>
              <strong>
                {dashboard?.current.nextAt
                  ? new Date(dashboard.current.nextAt).toLocaleDateString('de-DE', { weekday: 'long' })
                  : 'Kein Termin'}
              </strong>
              <small>
                {dashboard?.current.nextAt
                  ? new Date(dashboard.current.nextAt).toLocaleDateString('de-DE', { day: '2-digit', month: 'long' })
                  : 'Programmplan öffnen'}
              </small>
            </div>
          </div>
          <div className="next-show-meta">
            <span>
              <Layers3 size={15} /> {upcoming[0]?.itemCount ?? 0} Beiträge
            </span>
            <span>
              <Clock3 size={15} /> {formatDuration(upcoming[0]?.durationSeconds ?? 0)}
            </span>
          </div>
          <Link className="button primary-button" to={routes.broadcast}>
            Programm bearbeiten <ChevronRight size={15} />
          </Link>
        </aside>
      </div>

      <div className="overview-status-grid">
        <Link to={routes.obs} className="overview-status-card">
          <span className={`status-card-icon ${streamLive ? 'red' : 'slate'}`}>
            <Radio size={20} />
          </span>
          <div>
            <small>Livestream</small>
            <strong>{streamLive ? 'Live' : 'Offline'}</strong>
            <span>{streamLive ? dashboard?.stream?.outputTimecode || 'Ausgabe aktiv' : 'Bereit zum Start'}</span>
          </div>
          <i className={streamLive ? 'good' : ''} />
        </Link>
        <Link to={routes.obs} className="overview-status-card">
          <span className={`status-card-icon ${obsConnected ? 'green' : 'amber'}`}>
            <MonitorUp size={20} />
          </span>
          <div>
            <small>OBS Studio</small>
            <strong>{obsConnected ? 'Verbunden' : 'Getrennt'}</strong>
            <span>{dashboard?.current.scene ?? 'Keine Szene'}</span>
          </div>
          <i className={obsConnected ? 'good' : 'warning'} />
        </Link>
        <Link to={routes.automation} className="overview-status-card">
          <span className={`status-card-icon ${dashboard?.automation.enabled ? 'purple' : 'slate'}`}>
            <Bot size={20} />
          </span>
          <div>
            <small>Autopilot</small>
            <strong>{dashboard?.automation.enabled ? 'Aktiv' : 'Pausiert'}</strong>
            <span>{contentModeLabel(dashboard?.automation.contentMode ?? 'news')}</span>
          </div>
          <i className={dashboard?.automation.enabled ? 'good' : ''} />
        </Link>
        <Link to={routes.newsroom} className="overview-status-card">
          <span className="status-card-icon blue">
            <Newspaper size={20} />
          </span>
          <div>
            <small>Newsroom</small>
            <strong>{dashboard?.counts.newArticles ?? 0} neu</strong>
            <span>{dashboard?.counts.approved ?? 0} freigegeben</span>
          </div>
          <i className={(dashboard?.counts.failedSources ?? 0) > 0 ? 'warning' : 'good'} />
        </Link>
      </div>

      <div className="overview-main-grid">
        <section className="overview-panel program-panel">
          <header className="overview-panel-header">
            <div>
              <p className="eyebrow">Programm der nächsten Stunden</p>
              <h2>Sendeablauf</h2>
            </div>
            <Link to={routes.broadcast}>
              Gesamten Plan öffnen <ArrowRight size={15} />
            </Link>
          </header>
          <div className="mini-timeline">
            {upcoming.length > 0 ? (
              upcoming.map((show, index) => {
                const start = new Date(show.scheduledAt);
                return (
                  <Link
                    key={show.id}
                    to={`${routes.broadcast}?playlist=${encodeURIComponent(show.id)}`}
                    className={index === 0 ? 'next' : ''}
                  >
                    <time>{start.toLocaleTimeString('de-DE', { hour: '2-digit', minute: '2-digit' })}</time>
                    <span className="timeline-line">
                      <i />
                    </span>
                    <span className="timeline-show">
                      <strong>{show.name}</strong>
                      <small>
                        {show.itemCount} Beiträge · {formatDuration(show.durationSeconds)} · {show.status}
                      </small>
                    </span>
                    <ChevronRight size={16} />
                  </Link>
                );
              })
            ) : (
              <div className="overview-empty">
                <CalendarClock size={24} />
                <strong>Noch kein Programm geplant</strong>
                <p>Lass den Autopiloten den nächsten 24-Stunden-Plan erzeugen.</p>
                <button disabled={!allowed || action === 'plan'} onClick={() => void planDay()}>
                  Jetzt planen
                </button>
              </div>
            )}
          </div>
        </section>

        <section className="overview-panel autopilot-panel">
          <header className="overview-panel-header">
            <div>
              <p className="eyebrow">Automation</p>
              <h2>Autopilot</h2>
            </div>
            <span className={`state-pill ${dashboard?.automation.enabled ? 'success' : ''}`}>
              {dashboard?.automation.enabled ? 'Läuft' : 'Pausiert'}
            </span>
          </header>
          <div className="autopilot-visual">
            <span>
              <Bot size={30} />
            </span>
            <div>
              <strong>{contentModeLabel(dashboard?.automation.contentMode ?? 'news')}</strong>
              <small>
                {dashboard?.automation.showItemCount ?? 0} Beiträge je Sendung · Mindestvertrauen{' '}
                {dashboard?.automation.minimumTrust ?? 0}%
              </small>
            </div>
          </div>
          <dl className="autopilot-facts">
            <div>
              <dt>Geplante Beiträge</dt>
              <dd>{dashboard?.counts.planned ?? 0}</dd>
            </div>
            <div>
              <dt>Scan-Tiefe</dt>
              <dd>{dashboard?.automation.scanLimit ?? 0}</dd>
            </div>
            <div>
              <dt>Quellenfehler</dt>
              <dd className={(dashboard?.counts.failedSources ?? 0) > 0 ? 'warning-text' : ''}>
                {dashboard?.counts.failedSources ?? 0}
              </dd>
            </div>
          </dl>
          <div className="panel-actions">
            <button disabled={!allowed || Boolean(action)} onClick={() => void toggleAutopilot()}>
              {dashboard?.automation.enabled ? 'Autopilot pausieren' : 'Autopilot aktivieren'}
            </button>
            <button className="primary-button" disabled={!allowed || Boolean(action)} onClick={() => void planDay()}>
              {action === 'plan' ? 'Plant …' : '24 Stunden planen'}
            </button>
          </div>
        </section>
      </div>

      <div className="overview-main-grid lower">
        <section className="overview-panel system-panel">
          <header className="overview-panel-header">
            <div>
              <p className="eyebrow">Systemressourcen</p>
              <h2>Serverzustand</h2>
            </div>
            <Link to={routes.system}>
              Diagnose <ArrowRight size={15} />
            </Link>
          </header>
          <div className="resource-grid">
            <div className="resource-meter">
              <div
                className={`resource-ring ${percentClass(dashboard?.resources.cpu.percent ?? 0)}`}
                style={{ '--value': `${dashboard?.resources.cpu.percent ?? 0}%` } as React.CSSProperties}
              >
                <span>{dashboard?.resources.cpu.percent ?? 0}%</span>
              </div>
              <div>
                <strong>
                  <Cpu size={15} /> CPU
                </strong>
                <small>{dashboard?.resources.cpu.cores ?? 0} Kerne</small>
              </div>
            </div>
            <div className="resource-meter">
              <div
                className={`resource-ring ${percentClass(dashboard?.resources.memory.percent ?? 0)}`}
                style={{ '--value': `${dashboard?.resources.memory.percent ?? 0}%` } as React.CSSProperties}
              >
                <span>{dashboard?.resources.memory.percent ?? 0}%</span>
              </div>
              <div>
                <strong>
                  <MemoryStick size={15} /> RAM
                </strong>
                <small>{formatBytes(dashboard?.resources.memory.usedBytes ?? 0)} genutzt</small>
              </div>
            </div>
            <div className="resource-meter">
              <div
                className={`resource-ring ${percentClass(dashboard?.resources.gpu.percent ?? 0)}`}
                style={{ '--value': `${dashboard?.resources.gpu.percent ?? 0}%` } as React.CSSProperties}
              >
                <span>{dashboard?.resources.gpu.available ? `${dashboard.resources.gpu.percent}%` : '–'}</span>
              </div>
              <div>
                <strong>
                  <Gauge size={15} /> GPU
                </strong>
                <small>{dashboard?.resources.gpu.name ?? 'Nicht erkannt'}</small>
              </div>
            </div>
            <div className="resource-meter">
              <div
                className={`resource-ring ${percentClass(dashboard?.resources.disk?.percent ?? 0)}`}
                style={{ '--value': `${dashboard?.resources.disk?.percent ?? 0}%` } as React.CSSProperties}
              >
                <span>{dashboard?.resources.disk?.percent ?? 0}%</span>
              </div>
              <div>
                <strong>
                  <HardDrive size={15} /> Speicher
                </strong>
                <small>{formatBytes(dashboard?.resources.disk?.freeBytes ?? 0)} frei</small>
              </div>
            </div>
          </div>
        </section>

        <section className="overview-panel library-summary-panel">
          <header className="overview-panel-header">
            <div>
              <p className="eyebrow">Inhalte</p>
              <h2>Studio-Bibliothek</h2>
            </div>
            <Database size={19} />
          </header>
          <div className="library-summary-grid">
            <Link to={routes.sources}>
              <Rss />
              <span>
                <strong>{dashboard?.library.sources ?? 0}</strong>
                <small>Quellen</small>
              </span>
            </Link>
            <Link to={routes.articles}>
              <Newspaper />
              <span>
                <strong>{dashboard?.library.articles ?? 0}</strong>
                <small>Beiträge</small>
              </span>
            </Link>
            <Link to={routes.youtubeVideos}>
              <Video />
              <span>
                <strong>{dashboard?.library.youtubeVideos ?? 0}</strong>
                <small>YouTube-Videos</small>
              </span>
            </Link>
            <Link to={routes.overlays}>
              <Layers3 />
              <span>
                <strong>{dashboard?.library.overlays ?? 0}</strong>
                <small>Overlays</small>
              </span>
            </Link>
          </div>
        </section>
      </div>

      {loading && !dashboard && (
        <div className="overview-loading">
          <Clapperboard size={24} />
          <span>Studiozustand wird geladen …</span>
        </div>
      )}
      <footer className="overview-footer">
        <span>Letzte Aktualisierung: {lastUpdated?.toLocaleTimeString('de-DE') ?? '–'}</span>
        <Link to={routes.analytics}>
          <BarChart3 size={15} /> Analytics öffnen
        </Link>
      </footer>
    </section>
  );
}
