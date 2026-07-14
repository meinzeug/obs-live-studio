import React, { useEffect, useMemo, useState } from 'react';
import {
  CircleStop,
  Clock3,
  ExternalLink,
  Gauge,
  Link2,
  MonitorUp,
  Play,
  Power,
  RadioTower,
  RefreshCw,
  Settings2,
  UserRoundCog,
} from 'lucide-react';
import { api, can, type SessionUser } from '../api/client.js';

type StreamingTarget = {
  provider: 'youtube' | 'twitch';
  enabled: boolean;
  configured: boolean;
  primary: boolean;
  channelName: string;
  channelUrl: string;
  server: string;
};

type StreamingConfiguration = {
  primaryProvider: 'youtube' | 'twitch';
  targets: StreamingTarget[];
  multiRtmp?: {
    required: boolean;
    pluginDetected: boolean;
  };
};

function providerName(provider: StreamingTarget['provider']) {
  return provider === 'youtube' ? 'YouTube' : 'Twitch';
}

export function ObsPage({ user }: { user: SessionUser }) {
  const [obs, setObs] = useState<any>();
  const [configuration, setConfiguration] = useState<StreamingConfiguration>();
  const [message, setMessage] = useState('');

  async function load() {
    const [obsStatus, targetConfiguration] = await Promise.all([
      api('/api/obs/status'),
      fetch(`/stream-targets.json?ts=${Date.now()}`, { cache: 'no-store' })
        .then(async (response) => (response.ok ? ((await response.json()) as StreamingConfiguration) : undefined))
        .catch(() => undefined),
    ]);
    setObs(obsStatus);
    setConfiguration(targetConfiguration);
  }

  useEffect(() => {
    void load();
    const timer = window.setInterval(() => void load(), 5000);
    return () => window.clearInterval(timer);
  }, []);

  async function post(path: string, successMessage = 'Ausgeführt') {
    try {
      await api(path, { method: 'POST' });
      setMessage(successMessage);
      await load();
    } catch (error) {
      setMessage(error instanceof Error ? error.message : String(error));
    }
  }

  const allowed = can(user, 'obs:write');
  const live = Boolean(obs?.stream?.outputActive);
  const processRunning = obs?.process?.state === 'running';
  const connected = obs?.status === 'connected';
  const primaryConfigured = Boolean(
    obs?.streamProfile?.streamKey || obs?.streamProfile?.server || obs?.streamProfile?.channelUrl,
  );
  const targets = useMemo<StreamingTarget[]>(() => {
    if (configuration?.targets?.length) {
      return configuration.targets.map((target) => ({
        ...target,
        configured: target.configured || (target.primary && primaryConfigured),
      }));
    }
    return [
      {
        provider: 'youtube',
        enabled: true,
        configured: primaryConfigured,
        primary: true,
        channelName: obs?.streamProfile?.channelName ?? 'ArgumentationsKette',
        channelUrl: obs?.streamProfile?.channelUrl ?? '',
        server: obs?.streamProfile?.server ?? '',
      },
    ];
  }, [configuration, obs, primaryConfigured]);
  const enabledTargets = targets.filter((target) => target.enabled);
  const liveLabel =
    enabledTargets.length > 1
      ? `${enabledTargets.map((target) => providerName(target.provider)).join(' + ')} Live`
      : `${providerName(enabledTargets[0]?.provider ?? 'youtube')} Live`;

  async function resetYouTubeAccount() {
    if (!window.confirm('Aktuelle YouTube-Anmeldung aus OBS entfernen und OBS neu starten?')) return;
    await post('/api/obs/youtube/reset', 'YouTube-Konto getrennt; OBS wurde neu gestartet.');
  }

  return (
    <section className="panel">
      <div className="page-title">
        <div>
          <p className="eyebrow">Ausgabe</p>
          <h2>OBS und Streaming</h2>
          <p>YouTube und Twitch über einen OBS-Prozess parallel steuern.</p>
        </div>
        <div className="page-title-actions">
          <span className={`state-pill ${live ? 'live' : ''}`}>
            <RadioTower size={12} /> {live ? liveLabel : 'Offline'}
          </span>
        </div>
      </div>

      <div className="stats-grid">
        <article className="stat">
          <div>
            <span>OBS-Verbindung</span>
            <strong>{obs?.status ?? 'unbekannt'}</strong>
            <small>WebSocket-Steuerung</small>
          </div>
          <span className={`stat-icon ${connected ? 'success' : 'warning'}`}>
            <MonitorUp size={18} />
          </span>
        </article>
        <article className="stat">
          <div>
            <span>Prozess</span>
            <strong>{obs?.process?.state ?? 'unbekannt'}</strong>
            <small>{obs?.process?.pid ? `PID ${obs.process.pid}` : 'Kein Prozess'}</small>
          </div>
          <span className={`stat-icon ${processRunning ? 'success' : 'warning'}`}>
            <Power size={18} />
          </span>
        </article>
        <article className="stat">
          <div>
            <span>Laufzeit</span>
            <strong>{obs?.stream?.outputTimecode ?? '00:00:00'}</strong>
            <small>{obs?.stream?.outputSkippedFrames ?? 0} ausgelassene Frames</small>
          </div>
          <span className={`stat-icon ${live ? 'live' : ''}`}>
            <Clock3 size={18} />
          </span>
        </article>
        <article className="stat">
          <div>
            <span>Auslastung</span>
            <strong>{Math.round((obs?.stream?.outputCongestion ?? 0) * 100)} %</strong>
            <small>Netzwerküberlastung</small>
          </div>
          <span className="stat-icon">
            <Gauge size={18} />
          </span>
        </article>
      </div>

      <div className="stats-grid">
        {targets.map((target) => {
          const coupledToLiveOutput = target.enabled && live;
          return (
            <article className="stat" key={target.provider}>
              <div>
                <span>{providerName(target.provider)}</span>
                <strong>
                  {!target.enabled
                    ? 'deaktiviert'
                    : !target.configured
                      ? 'nicht konfiguriert'
                      : coupledToLiveOutput
                        ? target.primary
                          ? 'LIVE'
                          : 'mit Hauptstream gekoppelt'
                        : 'offline'}
                </strong>
                <small>{target.primary ? 'OBS-Hauptausgang' : 'obs-multi-rtmp Zusatzoutput'}</small>
                {target.channelUrl && (
                  <a href={target.channelUrl} target="_blank" rel="noreferrer">
                    {target.channelName || providerName(target.provider)} <ExternalLink size={14} />
                  </a>
                )}
              </div>
              <span
                className={`stat-icon ${coupledToLiveOutput ? 'live' : target.enabled ? 'success' : 'warning'}`}
              >
                <RadioTower size={18} />
              </span>
            </article>
          );
        })}
      </div>

      {configuration?.multiRtmp?.required && !configuration.multiRtmp.pluginDetected && (
        <div className="status-message status-error" role="alert">
          <RadioTower size={19} />
          <div>
            <strong>Parallelstreaming nicht verfügbar</strong>
            <p>Das benötigte OBS-Plugin obs-multi-rtmp wurde bei der Konfiguration nicht gefunden.</p>
          </div>
        </div>
      )}

      <div className="control-surface">
        <div className="control-group">
          <span className="control-label">OBS-Prozess</span>
          <button disabled={!allowed || processRunning} onClick={() => post('/api/obs/process/start')}>
            <Power size={16} /> Starten
          </button>
          <button disabled={!allowed || !processRunning} onClick={() => post('/api/obs/process/restart')}>
            <RefreshCw size={16} /> Neu starten
          </button>
        </div>
        <div className="control-group">
          <span className="control-label">Studio</span>
          <button disabled={!allowed || connected} onClick={() => post('/api/obs/connect')}>
            <Link2 size={16} /> Verbinden
          </button>
          <button disabled={!allowed || !connected} onClick={() => post('/api/obs/setup')}>
            <Settings2 size={16} /> Szenen wiederherstellen
          </button>
          <button disabled={!allowed || live} onClick={() => void resetYouTubeAccount()}>
            <UserRoundCog size={16} /> YouTube-Konto wechseln
          </button>
        </div>
        <div className="control-group">
          <span className="control-label">Livestream-Ziele</span>
          <button
            className="primary-button"
            disabled={!allowed || live || !connected || enabledTargets.some((target) => !target.configured)}
            onClick={() => post('/api/stream/start', 'Alle aktivierten Streamingziele wurden gestartet.')}
          >
            <Play size={16} /> Alle Ziele starten
          </button>
          <button
            className="danger"
            disabled={!allowed || !live}
            onClick={() => post('/api/stream/stop', 'Alle Streamingziele wurden gestoppt.')}
          >
            <CircleStop size={16} /> Alle Ziele stoppen
          </button>
        </div>
      </div>
      {message && <p role="status">{message}</p>}
      {obs?.streamSupervisor?.supervisorLastError && (
        <div className="status-message status-error">
          <RadioTower size={19} />
          <div>
            <strong>Streamstart fehlgeschlagen</strong>
            <p>{obs.streamSupervisor.supervisorLastError}</p>
          </div>
        </div>
      )}
    </section>
  );
}
