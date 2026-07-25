import {
  CalendarClock,
  Eye,
  Layers3,
  Megaphone,
  MonitorPlay,
  Podcast,
  RefreshCw,
  Send,
  Users,
  Video,
} from 'lucide-react';
import { Link } from 'react-router-dom';
import { routes } from '../navigation.js';

export type LiveRegieWorkspace = 'program' | 'rundown' | 'graphics' | 'sources' | 'team';

const workspaces: Array<{
  id: LiveRegieWorkspace;
  label: string;
  description: string;
  icon: typeof MonitorPlay;
}> = [
  { id: 'program', label: 'Studiozentrale', description: 'Live-Produktion und Monitore', icon: MonitorPlay },
  { id: 'sources', label: 'Quellen & Gäste', description: 'Kameras, YouTube und Audio', icon: Video },
  { id: 'graphics', label: 'Szenen & Grafik', description: 'Overlays, Chat und Übergänge', icon: Layers3 },
  { id: 'team', label: 'Team & Intercom', description: 'Außenstudios und Regiechat', icon: Users },
];

export function LiveRegieHeader({
  workspace,
  currentTitle,
  currentItem,
  nextTitle,
  liveActive,
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
  liveActive: boolean;
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
              <Podcast size={23} />
            </div>
            <div>
              <p className="eyebrow">Eigenständiger Arbeitsbereich · Live-Produktion</p>
              <h1>Live-Studio</h1>
              <p>Livestreams, Gäste, Außenstudios, Reaction-Shows und Live-Grafiken an einem Ort.</p>
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
            <Link to={routes.broadcast} title="Zum geplanten Programm wechseln">
              <CalendarClock size={15} />
              Sendeplanung
            </Link>
          </div>
        </div>

        <div className="live-regie-now">
          <div className="live-regie-now-copy">
            <span>{liveActive ? 'LIVE-PRODUKTION ON AIR' : 'LIVE-STUDIO BEREIT'}</span>
            <strong>{currentTitle}</strong>
            <small>{currentItem}</small>
          </div>
          <div className="live-regie-next">
            <span>{liveActive ? 'RÜCKKEHR ZUM PROGRAMM' : 'GEPLANTES PROGRAMM'}</span>
            <strong>{nextTitle}</strong>
          </div>
          <div className="live-regie-primary-actions" aria-label="Wichtige Regieaktionen">
            <button className="live-interrupt-button" onClick={onInterrupt} disabled={busy}>
              <Podcast size={18} />
              {liveActive ? 'Live steuern' : 'Live starten'}
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

      <nav className="live-workspace-nav" aria-label="Arbeitsbereiche des Live-Studio Management Centers">
        {workspaces.map(({ id, label, description, icon: Icon }) => (
          <button className={workspace === id ? 'active' : ''} key={id} onClick={() => onWorkspace(id)}>
            <Icon size={18} />
            <span>
              <strong>{label}</strong>
              <small>{description}</small>
            </span>
          </button>
        ))}
      </nav>
    </>
  );
}
