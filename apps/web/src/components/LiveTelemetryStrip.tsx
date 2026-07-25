import { useEffect, useState } from 'react';
import { Activity, AlertTriangle, AudioLines, Clock3, MonitorPlay, Video, Wifi } from 'lucide-react';

function compactClock(date: Date) {
  return date.toLocaleTimeString('de-DE', { hour: '2-digit', minute: '2-digit', second: '2-digit' });
}

export function LiveTelemetryStrip({
  scene,
  sourceCount,
  audioPercent,
  congestionPercent,
  warningCount,
  streamActive,
  onProgram,
  onSources,
  onStream,
  onDiagnostics,
}: {
  scene: string;
  sourceCount: number;
  audioPercent: number;
  congestionPercent: number;
  warningCount: number;
  streamActive: boolean;
  onProgram: () => void;
  onSources: () => void;
  onStream: () => void;
  onDiagnostics: () => void;
}) {
  const [now, setNow] = useState(() => new Date());

  useEffect(() => {
    const timer = window.setInterval(() => setNow(new Date()), 1_000);
    return () => window.clearInterval(timer);
  }, []);

  const audioBars = [16, 34, 52, 70, 88];

  return (
    <section className="live-telemetry-strip" aria-label="Live-Telemetrie">
      <button onClick={onDiagnostics} title="Zeitbasis und Regiediagnose öffnen">
        <Clock3 size={17} />
        <span>
          <small>Regiezeit</small>
          <strong>{compactClock(now)}</strong>
        </span>
      </button>
      <button onClick={onProgram} title="Programmszene und Übergänge öffnen">
        <MonitorPlay size={17} />
        <span>
          <small>Aktive Szene</small>
          <strong>{scene}</strong>
        </span>
      </button>
      <button onClick={onSources} title="Live-Quellen und Quellenanimationen öffnen">
        <Video size={17} />
        <span>
          <small>Im Studio</small>
          <strong>{sourceCount} Quellen</strong>
        </span>
      </button>
      <button onClick={onSources} title="Audiostatus aller Live-Quellen öffnen">
        <AudioLines size={17} />
        <span>
          <small>Live-Audio</small>
          <strong>{audioPercent}%</strong>
        </span>
        <i className="live-telemetry-audio" aria-hidden="true">
          {audioBars.map((threshold) => (
            <b className={audioPercent >= threshold ? 'active' : ''} key={threshold} />
          ))}
        </i>
      </button>
      <button
        className={streamActive ? 'is-live' : ''}
        onClick={onStream}
        title="Streaming-Verbindung und Netzwerkauslastung öffnen"
      >
        {streamActive ? <Activity size={17} /> : <Wifi size={17} />}
        <span>
          <small>Netzwerk</small>
          <strong>{streamActive ? `${congestionPercent}% Last` : 'Stream aus'}</strong>
        </span>
      </button>
      <button
        className={warningCount > 0 ? 'has-warning' : 'is-clear'}
        onClick={onDiagnostics}
        title="Warnungen und Regiediagnose öffnen"
      >
        <AlertTriangle size={17} />
        <span>
          <small>Regiehinweise</small>
          <strong>{warningCount > 0 ? `${warningCount} offen` : 'Alles bereit'}</strong>
        </span>
      </button>
    </section>
  );
}
