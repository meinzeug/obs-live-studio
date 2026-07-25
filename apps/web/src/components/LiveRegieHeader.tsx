import {
  CalendarClock,
  Clapperboard,
  Eye,
  Layers3,
  ListVideo,
  Megaphone,
  MonitorPlay,
  Radio,
  RefreshCw,
  Send,
  Video,
} from 'lucide-react';
import { Link } from 'react-router-dom';
import { routes } from '../navigation.js';

export type LiveRegieWorkspace = 'program' | 'rundown' | 'graphics' | 'sources';

const workspaces: Array<{
  id: LiveRegieWorkspace;
  label: string;
  description: string;
  icon: typeof MonitorPlay;
}> = [
  { id: 'program', label: 'Programm', description: 'Vorschau und Programmbild', icon: MonitorPlay },
  { id: 'rundown', label: 'Rundown', description: 'Sendung und Beiträge steuern', icon: ListVideo },
  { id: 'graphics', label: 'Grafik', description: 'Overlays, Chat und Übergänge', icon: Layers3 },
  { id: 'sources', label: 'Quellen', description: 'Kameras, YouTube und Audio', icon: Video },
];

export function LiveRegieHeader({
  workspace,
  currentTitle,
  currentItem,
  nextTitle,
  progress,
  timingLabel,
  streamActive,
  obsConnected,
  busy,
  onWorkspace,
  onRefresh,
  onInterrupt,
  onPreview,
  onTake,
  onCue,
}: {
  workspace: LiveRegieWorkspace;
  currentTitle: string;
  currentItem: string;
  nextTitle: string;
  progress: number;
  timingLabel: string;
  streamActive: boolean;
  obsConnected: boolean;
  busy: boolean;
  onWorkspace: (workspace: LiveRegieWorkspace) => void;
  onRefresh: () => void;
  onInterrupt: () => void;
  onPreview: () => void;
  onTake: () => void;
  onCue: () => void;
}) {
  return (
    <>
      <section className="live-regie-hero">
        <div className="live-regie-hero-main">
          <div className="live-regie-title">
            <div className="live-regie-emblem" aria-hidden="true">
              <Radio size={23} />
            </div>
            <div>
              <p className="eyebrow">Sendebetrieb · Master Control</p>
              <h1>Live-Regie</h1>
              <p>Programm, Gäste, Grafiken und Eingriffe in einer gemeinsamen Bedienoberfläche.</p>
            </div>
          </div>

          <div className="live-regie-system-tally" aria-label="Technischer Betriebszustand">
            <span className={obsConnected ? 'ok' : 'error'}>
              <i /> OBS {obsConnected ? 'verbunden' : 'getrennt'}
            </span>
            <span className={streamActive ? 'live' : 'muted'}>
              <i /> Stream {streamActive ? 'ON AIR' : 'aus'}
            </span>
            <button onClick={onRefresh} disabled={busy} title="Regiestatus aktualisieren">
              <RefreshCw size={15} className={busy ? 'is-spinning' : ''} />
              Aktualisieren
            </button>
          </div>
        </div>

        <div className="live-regie-now">
          <div className="live-regie-now-copy">
            <span>JETZT IM PROGRAMM</span>
            <strong>{currentTitle}</strong>
            <small>{currentItem}</small>
            <div className="live-regie-progress" aria-label={`Sendungsfortschritt ${Math.round(progress)} Prozent`}>
              <i>
                <b style={{ width: `${progress}%` }} />
              </i>
              <em>{timingLabel}</em>
            </div>
          </div>
          <div className="live-regie-next">
            <span>ALS NÄCHSTES</span>
            <strong>{nextTitle}</strong>
          </div>
          <div className="live-regie-primary-actions" aria-label="Wichtige Regieaktionen">
            <button className="live-interrupt-button" onClick={onInterrupt} disabled={busy}>
              <Clapperboard size={18} />
              Live-Eingriff
            </button>
            <button onClick={onPreview} disabled={busy}>
              <Eye size={18} />
              Vorschau
            </button>
            <button className="live-take-button" onClick={onTake} disabled={busy}>
              <Send size={19} />
              TAKE
            </button>
            <button onClick={onCue} disabled={busy}>
              <Megaphone size={18} />
              Einblendung
            </button>
          </div>
        </div>
      </section>

      <nav className="live-workspace-nav" aria-label="Arbeitsbereiche der Live-Regie">
        {workspaces.map(({ id, label, description, icon: Icon }) => (
          <button className={workspace === id ? 'active' : ''} key={id} onClick={() => onWorkspace(id)}>
            <Icon size={18} />
            <span>
              <strong>{label}</strong>
              <small>{description}</small>
            </span>
          </button>
        ))}
        <Link className="live-workspace-planning" to={routes.broadcast}>
          <CalendarClock size={17} />
          <span>
            <strong>Planung</strong>
            <small>Sendeplan bearbeiten</small>
          </span>
        </Link>
      </nav>
    </>
  );
}
