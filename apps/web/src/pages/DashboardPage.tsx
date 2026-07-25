import React, { useEffect, useMemo, useState } from 'react';
import {
  Activity,
  AlertTriangle,
  ArrowRight,
  Bot,
  CalendarClock,
  CirclePlay,
  Clapperboard,
  Clock3,
  Database,
  Gauge,
  Globe2,
  HeartPulse,
  Layers3,
  MonitorUp,
  Newspaper,
  Radio,
  RefreshCw,
  Rss,
  ShieldCheck,
  Sparkles,
  UsersRound,
  Video,
  WandSparkles,
  Wifi,
  WifiOff,
  Zap,
} from 'lucide-react';
import { Link } from 'react-router-dom';
import { api, can, type SessionUser } from '../api/client.js';
import {
  ControlMetric,
  formatClock,
  itemTitle,
  ResourceDial,
  SignalPill,
  type DashboardTone,
} from '../components/dashboard/StudioDashboardWidgets.js';
import { routes } from '../navigation.js';
import { useStudioStatus } from '../studio-status.js';

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
  if (mode === 'youtube-context') return 'Einordnung mit Moderation';
  return 'Nachrichten';
}

function modeMeta(mode: string | undefined): { label: string; detail: string; tone: DashboardTone } {
  if (mode === 'autopilot') return { label: 'Autopilot', detail: 'Programm wird automatisch gefahren', tone: 'green' };
  if (mode === 'manual') return { label: 'Manuelle Sendung', detail: 'Regie steuert den Ablauf', tone: 'cyan' };
  if (mode === 'live') return { label: 'Live-Regie', detail: 'Geplantes Programm ist unterbrochen', tone: 'red' };
  if (mode === 'breaking') return { label: 'Breaking News', detail: 'Sonderlage ist auf Sendung', tone: 'red' };
  return { label: 'Bereitschaft', detail: 'Studio wartet auf die nächste Sendung', tone: 'slate' };
}

export function DashboardPage({ user }: { user: SessionUser }) {
  const { dashboard, loading, error, refreshing, refresh, lastUpdated, lastEventAt, transport } = useStudioStatus();
  const [action, setAction] = useState('');
  const [message, setMessage] = useState('');
  const [failedPreviewRevision, setFailedPreviewRevision] = useState<number | null>(null);
  const [telemetry, setTelemetry] = useState<
    Array<{ at: string; cpu: number; memory: number; gpu: number; disk: number }>
  >([]);
  const writable = can(user, 'broadcast:write');
  const operations = dashboard?.operations;
  const streamLive = Boolean(operations?.stream.active ?? dashboard?.stream?.outputActive);
  const obsConnected = Boolean(operations?.obs.connected ?? dashboard?.obs?.status === 'connected');
  const mode = modeMeta(operations?.mode);
  const elapsedMs = Number(operations?.current.elapsedMs ?? 0);
  const durationMs = Number(operations?.current.durationMs ?? 0);
  const remainingMs = operations?.current.remainingMs ?? (durationMs ? Math.max(0, durationMs - elapsedMs) : null);
  const progress = durationMs > 0 ? Math.max(0, Math.min(100, (elapsedMs / durationMs) * 100)) : 0;
  const warningCount = operations?.warnings.length ?? 0;
  const playbackStatus = String(operations?.current.playback?.status ?? dashboard?.playback?.status ?? 'idle');
  const now = new Date(dashboard?.serverTime ?? Date.now()).getTime();
  const upcoming = useMemo(
    () => dashboard?.schedule.filter((item) => new Date(item.scheduledAt).getTime() >= now - 60_000).slice(0, 6) ?? [],
    [dashboard?.schedule, now],
  );
  const droppedFrames = Number(dashboard?.stream?.outputSkippedFrames ?? 0);
  const totalFrames = Number(dashboard?.stream?.outputTotalFrames ?? 0);
  const droppedPercent = totalFrames > 0 ? (droppedFrames / totalFrames) * 100 : 0;
  const previewRevision = Math.floor(new Date(dashboard?.serverTime ?? 0).getTime() / 5_000);
  const previewAvailable = obsConnected && previewRevision > 0 && failedPreviewRevision !== previewRevision;

  useEffect(() => {
    if (!dashboard?.serverTime) return;
    const point = {
      at: dashboard.serverTime,
      cpu: Number(dashboard.resources.cpu.percent ?? 0),
      memory: Number(dashboard.resources.memory.percent ?? 0),
      gpu: Number(dashboard.resources.gpu.percent ?? 0),
      disk: Number(dashboard.resources.disk?.percent ?? 0),
    };
    setTelemetry((current) => {
      if (current.at(-1)?.at === point.at) return current;
      return [...current, point].slice(-36);
    });
  }, [dashboard?.serverTime, dashboard?.resources]);

  async function runAction(name: string, request: () => Promise<string>) {
    if (!writable) return;
    setAction(name);
    setMessage('');
    try {
      setMessage(await request());
      await refresh();
    } catch (requestError) {
      setMessage(requestError instanceof Error ? requestError.message : String(requestError));
    } finally {
      setAction('');
    }
  }

  function toggleAutopilot() {
    if (!dashboard) return;
    void runAction('autopilot', async () => {
      await api('/api/autopilot', {
        method: 'POST',
        body: JSON.stringify({ enabled: !dashboard.automation.enabled }),
      });
      return `Autopilot ${dashboard.automation.enabled ? 'pausiert' : 'aktiviert'}.`;
    });
  }

  function planDay() {
    void runAction('plan', async () => {
      const result = await api<{ created?: unknown[]; skipped?: unknown[] }>('/api/autopilot/plan-24h', {
        method: 'POST',
        body: JSON.stringify({ replaceExisting: false }),
      });
      return `${result.created?.length ?? 0} Sendungen geplant, ${result.skipped?.length ?? 0} vorhandene Zeitfenster beibehalten.`;
    });
  }

  return (
    <section className="studio-overview-page control-center">
      <header className="control-center-header">
        <div>
          <p className="eyebrow">Open TV Studio · Master Control</p>
          <h1>Dein Sender. Jetzt.</h1>
          <p>
            Guten Tag, {user.display_name.split(/\s+/)[0]}. Programm, Redaktion, Automation und Technik laufen hier in
            einem gemeinsamen Echtzeitbild zusammen.
          </p>
        </div>
        <div className="control-center-header-actions">
          <a
            className="button"
            href="/public"
            target="_blank"
            rel="noreferrer"
            aria-label="Öffentliche Senderwebsite in neuem Tab öffnen"
          >
            <Globe2 size={15} /> Senderwebsite
          </a>
          <SignalPill
            tone={transport === 'live' ? 'green' : transport === 'offline' ? 'red' : 'amber'}
            pulse={transport === 'live'}
          >
            {transport === 'live' ? (
              <>
                <Wifi size={13} /> Live-Daten verbunden
              </>
            ) : (
              <>
                <WifiOff size={13} /> {transport === 'offline' ? 'Offline' : 'Verbindung wird aufgebaut'}
              </>
            )}
          </SignalPill>
          <span className="control-updated">
            <Clock3 size={14} />
            {lastEventAt?.toLocaleTimeString('de-DE') ?? lastUpdated?.toLocaleTimeString('de-DE') ?? '–'}
          </span>
          <button className="icon-button" onClick={() => void refresh()} aria-label="Live-Zustand neu laden">
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

      <section className={`master-control-hero ${streamLive ? 'is-live' : ''}`}>
        <div className="master-program">
          <div className="master-program-topline">
            <SignalPill tone={streamLive ? 'red' : mode.tone} pulse={streamLive}>
              {streamLive ? 'ON AIR' : mode.label}
            </SignalPill>
            <span>{dashboard?.current.scene ?? operations?.live.currentSceneName ?? 'Keine Programmszene'}</span>
            <span className="master-program-clock">
              {new Date(dashboard?.serverTime ?? Date.now()).toLocaleTimeString('de-DE')}
            </span>
          </div>
          <div className={`master-program-stage ${previewAvailable ? 'has-preview' : ''}`}>
            {previewAvailable && (
              <img
                key={previewRevision}
                className="master-program-preview"
                src={`/api/dashboard/program-preview?v=${previewRevision}`}
                alt="Aktuelles Programmbild aus OBS"
                onError={() => setFailedPreviewRevision(previewRevision)}
              />
            )}
            <span className="master-stage-grid" />
            <span className="master-stage-orbit one" />
            <span className="master-stage-orbit two" />
            <div className="master-stage-brand">
              {streamLive ? <Radio size={38} /> : <CirclePlay size={42} />}
              <small>{dashboard?.current.show ?? 'PROGRAMM'}</small>
              <strong>{dashboard?.current.item ?? 'Keine Sendung aktiv'}</strong>
              <span>{mode.detail}</span>
            </div>
            <div className="master-stage-lower-third">
              <span>{operations?.current.playlist?.format_name ?? mode.label}</span>
              <strong>{dashboard?.current.item ?? 'Bereitschaft'}</strong>
            </div>
          </div>
          <div className="master-transport">
            <div className="master-progress-copy">
              <span>
                <strong>{formatClock(elapsedMs)}</strong>
                <small>gelaufen</small>
              </span>
              <span>
                <strong>{formatClock(remainingMs)}</strong>
                <small>verbleibend</small>
              </span>
            </div>
            <div className="master-progress-track" aria-label={`${Math.round(progress)} Prozent abgespielt`}>
              <i style={{ width: `${progress}%` }} />
            </div>
            <div className="master-transport-links">
              <SignalPill tone={playbackStatus === 'playing' ? 'green' : playbackStatus === 'error' ? 'red' : 'amber'}>
                {playbackStatus === 'playing' ? 'Wiedergabe läuft' : playbackStatus}
              </SignalPill>
              <Link className="button primary-button" to={routes.live}>
                In die Regie <ArrowRight size={15} />
              </Link>
            </div>
          </div>
        </div>

        <aside className="master-next">
          <header>
            <div>
              <p className="eyebrow">Als Nächstes</p>
              <h2>{operations?.next?.name ?? dashboard?.current.next ?? 'Noch nicht geplant'}</h2>
            </div>
            <CalendarClock size={22} />
          </header>
          <div className="master-next-time">
            <strong>
              {dashboard?.current.nextAt
                ? new Date(dashboard.current.nextAt).toLocaleTimeString('de-DE', { hour: '2-digit', minute: '2-digit' })
                : '--:--'}
            </strong>
            <span>
              {dashboard?.current.nextAt
                ? new Date(dashboard.current.nextAt).toLocaleDateString('de-DE', {
                    weekday: 'long',
                    day: '2-digit',
                    month: 'long',
                  })
                : 'Kein weiterer Starttermin'}
            </span>
          </div>
          <div className="master-next-facts">
            <span>
              <Layers3 size={15} /> {operations?.next?.item_count ?? upcoming[0]?.itemCount ?? 0} Beiträge
            </span>
            <span>
              <Clock3 size={15} /> {formatDuration(upcoming[0]?.durationSeconds ?? 0)}
            </span>
          </div>
          <div className="master-rundown">
            <small>Nächste Beiträge der laufenden Sendung</small>
            {(operations?.current.nextItems ?? []).slice(0, 3).map((item, index) => (
              <div key={item.id}>
                <span>{String(index + 1).padStart(2, '0')}</span>
                <strong>{itemTitle(item)}</strong>
                <small>{formatDuration(Number(item.duration_seconds ?? 0))}</small>
              </div>
            ))}
            {!operations?.current.nextItems?.length && <p>Kein weiterer Rundown-Punkt vorbereitet.</p>}
          </div>
          <div className="master-next-actions">
            <Link className="button" to={routes.broadcast}>
              Planung
            </Link>
            <Link className="button primary-button" to={routes.live}>
              Regie
            </Link>
          </div>
        </aside>
      </section>

      <section className="control-metric-grid" aria-label="Aktuelle Studiokennzahlen">
        <ControlMetric
          icon={Radio}
          eyebrow="Livestream"
          value={streamLive ? 'Live' : 'Offline'}
          detail={
            streamLive
              ? `${dashboard?.stream?.outputTimecode || 'Ausgabe aktiv'} · ${droppedPercent.toFixed(2)} % Frames verloren`
              : 'Ausgabe ist startbereit'
          }
          tone={streamLive ? 'red' : 'slate'}
          to={routes.obs}
        />
        <ControlMetric
          icon={MonitorUp}
          eyebrow="OBS Studio"
          value={obsConnected ? 'Verbunden' : 'Getrennt'}
          detail={operations?.live.currentSceneName ?? dashboard?.current.scene ?? 'Keine Szene'}
          tone={obsConnected ? 'green' : 'amber'}
          to={routes.obs}
        />
        <ControlMetric
          icon={Bot}
          eyebrow="Autopilot"
          value={dashboard?.automation.enabled ? 'Aktiv' : 'Pausiert'}
          detail={contentModeLabel(dashboard?.automation.contentMode ?? 'news')}
          tone={dashboard?.automation.enabled ? 'violet' : 'slate'}
          to={routes.automation}
        />
        <ControlMetric
          icon={Newspaper}
          eyebrow="Redaktion"
          value={`${dashboard?.counts.newArticles ?? 0} neu`}
          detail={`${dashboard?.counts.approved ?? 0} freigegeben · ${dashboard?.counts.failedSources ?? 0} Quellenfehler`}
          tone={(dashboard?.counts.failedSources ?? 0) > 0 ? 'amber' : 'cyan'}
          to={routes.newsroom}
        />
        <ControlMetric
          icon={UsersRound}
          eyebrow="KI-Gremium"
          value={`${dashboard?.governance.open_decisions ?? 0} offen`}
          detail={`${dashboard?.governance.council_waiting ?? 0} im Rat · ${dashboard?.governance.review_waiting ?? 0} in Prüfung`}
          tone={(dashboard?.governance.failed_decisions ?? 0) > 0 ? 'amber' : 'green'}
          to={routes.sendegott}
        />
        <ControlMetric
          icon={HeartPulse}
          eyebrow="Störungscenter"
          value={`${dashboard?.notifications.unreadCount ?? 0} offen`}
          detail={warningCount ? `${warningCount} aktuelle Betriebswarnungen` : 'Keine akute Betriebswarnung'}
          tone={(dashboard?.notifications.unreadCount ?? 0) > 0 || warningCount > 0 ? 'amber' : 'green'}
          to={routes.notifications}
        />
      </section>

      {operations?.warnings.length ? (
        <section className="control-alert-strip">
          <header>
            <AlertTriangle size={18} />
            <strong>Master Control benötigt Aufmerksamkeit</strong>
            <Link to={routes.notifications}>Alle Störungen</Link>
          </header>
          <div>
            {operations.warnings.slice(0, 4).map((warning) => (
              <span className={warning.level} key={warning.code}>
                <i />
                {warning.message}
              </span>
            ))}
          </div>
        </section>
      ) : (
        <section className="control-all-clear">
          <ShieldCheck size={18} />
          <strong>Sendekette stabil</strong>
          <span>OBS, Wiedergabe und Zeitplan melden keinen unmittelbaren Eingriffsbedarf.</span>
        </section>
      )}

      <nav className="control-quick-actions" aria-label="Schnellzugriffe für den Sendebetrieb">
        <Link to={routes.live}>
          <Radio size={17} />
          <span>
            <strong>Regie öffnen</strong>
            <small>Programm, Vorschau und Rundown steuern</small>
          </span>
          <ArrowRight size={15} />
        </Link>
        <Link to={routes.broadcast}>
          <CalendarClock size={17} />
          <span>
            <strong>Sendetag planen</strong>
            <small>Formate und Startzeiten bearbeiten</small>
          </span>
          <ArrowRight size={15} />
        </Link>
        <Link to={routes.newsroom}>
          <Newspaper size={17} />
          <span>
            <strong>Redaktion prüfen</strong>
            <small>Neue Meldungen und Freigaben</small>
          </span>
          <ArrowRight size={15} />
        </Link>
        <Link to={routes.notifications}>
          <AlertTriangle size={17} />
          <span>
            <strong>Störungen bearbeiten</strong>
            <small>{dashboard?.notifications.unreadCount ?? 0} ungelesene Hinweise</small>
          </span>
          <ArrowRight size={15} />
        </Link>
      </nav>

      <div className="control-center-columns">
        <section className="control-panel control-schedule">
          <header>
            <div>
              <p className="eyebrow">Nächste sechs Sendungen</p>
              <h2>Programmfluss</h2>
            </div>
            <Link to={routes.broadcast}>
              24-Stunden-Plan <ArrowRight size={15} />
            </Link>
          </header>
          <div className="control-timeline">
            {upcoming.map((show, index) => (
              <Link
                key={show.id}
                to={`${routes.broadcast}?playlist=${encodeURIComponent(show.id)}`}
                className={index === 0 ? 'is-next' : ''}
              >
                <time>
                  {new Date(show.scheduledAt).toLocaleTimeString('de-DE', { hour: '2-digit', minute: '2-digit' })}
                </time>
                <span className="control-timeline-rail">
                  <i />
                </span>
                <span>
                  <strong>{show.name}</strong>
                  <small>
                    {show.itemCount} Beiträge · {formatDuration(show.durationSeconds)} · {show.status}
                  </small>
                </span>
                <ArrowRight size={15} />
              </Link>
            ))}
            {!upcoming.length && (
              <div className="control-empty">
                <CalendarClock size={25} />
                <strong>Kein Programm vorbereitet</strong>
                <p>Der Autopilot kann den nächsten vollständigen Sendetag aufbauen.</p>
                <button disabled={!writable || Boolean(action)} onClick={planDay}>
                  24 Stunden planen
                </button>
              </div>
            )}
          </div>
        </section>

        <aside className="control-side-stack">
          <section className="control-panel control-automation">
            <header>
              <div>
                <p className="eyebrow">Automatische Sendeleitung</p>
                <h2>Autopilot</h2>
              </div>
              <SignalPill
                tone={dashboard?.automation.enabled ? 'green' : 'slate'}
                pulse={dashboard?.automation.enabled}
              >
                {dashboard?.automation.enabled ? 'arbeitet' : 'pausiert'}
              </SignalPill>
            </header>
            <div className="control-automation-core">
              <span>
                <WandSparkles size={28} />
              </span>
              <div>
                <strong>{contentModeLabel(dashboard?.automation.contentMode ?? 'news')}</strong>
                <small>
                  {dashboard?.automation.showItemCount ?? 0} Beiträge pro Sendung ·{' '}
                  {dashboard?.automation.minimumTrust ?? 0} % Mindestvertrauen
                </small>
              </div>
            </div>
            <div className="control-automation-facts">
              <span>
                <small>Geplant</small>
                <strong>{dashboard?.counts.planned ?? 0}</strong>
              </span>
              <span>
                <small>Scan-Tiefe</small>
                <strong>{dashboard?.automation.scanLimit ?? 0}</strong>
              </span>
              <span>
                <small>Modus</small>
                <strong>{mode.label}</strong>
              </span>
            </div>
            <div className="panel-actions">
              <button disabled={!writable || Boolean(action)} onClick={toggleAutopilot}>
                {dashboard?.automation.enabled ? 'Pausieren' : 'Aktivieren'}
              </button>
              <button className="primary-button" disabled={!writable || Boolean(action)} onClick={planDay}>
                {action === 'plan' ? 'Plant …' : 'Tag planen'}
              </button>
            </div>
          </section>

          <section className="control-panel control-resources">
            <header>
              <div>
                <p className="eyebrow">Live-Telemetrie</p>
                <h2>Systemlast</h2>
              </div>
              <Link to={routes.system}>
                Diagnose <ArrowRight size={15} />
              </Link>
            </header>
            <div className="control-resource-grid">
              <ResourceDial
                label="CPU"
                value={dashboard?.resources.cpu.percent ?? 0}
                detail={`${dashboard?.resources.cpu.cores ?? 0} Kerne`}
                history={telemetry.map((point) => point.cpu)}
              />
              <ResourceDial
                label="RAM"
                value={dashboard?.resources.memory.percent ?? 0}
                detail={`${formatBytes(dashboard?.resources.memory.usedBytes ?? 0)} belegt`}
                history={telemetry.map((point) => point.memory)}
              />
              <ResourceDial
                label="GPU"
                value={dashboard?.resources.gpu.available ? dashboard.resources.gpu.percent : null}
                detail={dashboard?.resources.gpu.name ?? 'Nicht erkannt'}
                history={telemetry.map((point) => point.gpu)}
              />
              <ResourceDial
                label="Disk"
                value={dashboard?.resources.disk?.percent ?? null}
                detail={`${formatBytes(dashboard?.resources.disk?.freeBytes ?? 0)} frei`}
                history={telemetry.map((point) => point.disk)}
              />
            </div>
          </section>
        </aside>
      </div>

      <div className="control-intelligence-grid">
        <section className="control-panel control-editorial-pulse">
          <header>
            <div>
              <p className="eyebrow">Redaktion in Bewegung</p>
              <h2>Newsroom-Puls</h2>
            </div>
            <Link to={routes.newsroom}>
              Newsroom <ArrowRight size={15} />
            </Link>
          </header>
          <div className="control-editorial-metrics">
            <span>
              <strong>{dashboard?.editorial?.metrics.fresh_articles ?? 0}</strong>
              <small>frisch in 24 Std.</small>
            </span>
            <span>
              <strong>{dashboard?.editorial?.metrics.distinct_sources_24h ?? 0}</strong>
              <small>Quellen in 24 Std.</small>
            </span>
            <span>
              <strong>{dashboard?.editorial?.metrics.review_articles ?? 0}</strong>
              <small>in Prüfung</small>
            </span>
            <span>
              <strong>{dashboard?.editorial?.metrics.published_articles ?? 0}</strong>
              <small>veröffentlicht</small>
            </span>
          </div>
          <div className="control-activity-feed">
            {(dashboard?.editorial?.activity ?? []).slice(0, 4).map((entry) => (
              <article key={`${entry.staff_member_id}-${entry.created_at}-${entry.title}`}>
                <span>
                  <Bot size={15} />
                </span>
                <div>
                  <strong>{entry.display_name}</strong>
                  <p>{entry.title}</p>
                </div>
                <time>
                  {new Date(entry.created_at).toLocaleTimeString('de-DE', { hour: '2-digit', minute: '2-digit' })}
                </time>
              </article>
            ))}
            {!dashboard?.editorial?.activity?.length && (
              <div className="control-feed-empty">Noch keine redaktionelle Aktivität im aktuellen Fenster.</div>
            )}
          </div>
        </section>

        <section className="control-panel control-incident-feed">
          <header>
            <div>
              <p className="eyebrow">Betrieb und Sicherheit</p>
              <h2>Aktuelle Ereignisse</h2>
            </div>
            <Link to={routes.notifications}>
              Störungscenter <ArrowRight size={15} />
            </Link>
          </header>
          <div className="control-activity-feed">
            {(dashboard?.notifications.items ?? []).slice(0, 5).map((incident) => (
              <article className={incident.level} key={incident.id}>
                <span>
                  <AlertTriangle size={15} />
                </span>
                <div>
                  <strong>{incident.component}</strong>
                  <p>{incident.message}</p>
                </div>
                <time>
                  {new Date(incident.lastSeenAt).toLocaleTimeString('de-DE', { hour: '2-digit', minute: '2-digit' })}
                </time>
              </article>
            ))}
            {!dashboard?.notifications.items?.length && (
              <div className="control-feed-empty is-clear">
                <ShieldCheck size={17} /> Keine offene Betriebsstörung.
              </div>
            )}
          </div>
        </section>
      </div>

      <section className="control-panel control-library">
        <header>
          <div>
            <p className="eyebrow">Produktion und Bestand</p>
            <h2>Studio-Bibliothek</h2>
          </div>
          <Database size={20} />
        </header>
        <div>
          <Link to={routes.sources}>
            <Rss size={19} />
            <span>
              <strong>{dashboard?.library.sources ?? 0}</strong>
              <small>Quellen</small>
            </span>
          </Link>
          <Link to={routes.articles}>
            <Newspaper size={19} />
            <span>
              <strong>{dashboard?.library.articles ?? 0}</strong>
              <small>Beiträge</small>
            </span>
          </Link>
          <Link to={routes.youtubeVideos}>
            <Video size={19} />
            <span>
              <strong>{dashboard?.library.youtubeVideos ?? 0}</strong>
              <small>YouTube-Videos</small>
            </span>
          </Link>
          <Link to={routes.media}>
            <Clapperboard size={19} />
            <span>
              <strong>{dashboard?.library.media ?? 0}</strong>
              <small>Medien</small>
            </span>
          </Link>
          <Link to={routes.overlays}>
            <Layers3 size={19} />
            <span>
              <strong>{dashboard?.library.overlays ?? 0}</strong>
              <small>Overlays</small>
            </span>
          </Link>
          <Link to={routes.analytics}>
            <Activity size={19} />
            <span>
              <strong>{streamLive ? 'Live' : 'Bereit'}</strong>
              <small>Analytics</small>
            </span>
          </Link>
        </div>
      </section>

      {loading && !dashboard && (
        <div className="overview-loading">
          <Gauge size={25} />
          <span>Master Control verbindet sich mit dem Live-Datenstrom …</span>
        </div>
      )}
      <footer className="control-center-footer">
        <span>
          <Zap size={14} /> Zustand über Server-Sent Events · kein Browser-Polling
        </span>
        <Link to={routes.system}>
          Systemdetails <ArrowRight size={14} />
        </Link>
      </footer>
    </section>
  );
}
