import React, { useEffect, useState } from 'react';
import {
  AlertTriangle,
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
  ShieldCheck,
  UserRoundCog,
} from 'lucide-react';
import { api, can, type SessionUser } from '../api/client.js';

export function ObsPage({ user }: { user: SessionUser }) {
  const [obs, setObs] = useState<any>();
  const [message, setMessage] = useState('');

  async function load() {
    setObs(await api('/api/obs/status'));
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
      await load().catch(() => undefined);
    }
  }

  const allowed = can(user, 'obs:write');
  const live = Boolean(obs?.stream?.outputActive);
  const processRunning = obs?.process?.state === 'running';
  const connected = obs?.status === 'connected';
  const twitch = obs?.process?.twitch;
  const multistream = twitch?.enabled === true || obs?.streamProfile?.service === 'youtube+twitch';
  const destinationLabel = multistream ? 'YouTube + Twitch' : 'YouTube';
  const twitchReady = !multistream || twitch?.ready === true;
  const twitchErrors = Array.isArray(twitch?.checks)
    ? twitch.checks.filter((check: any) => check?.status === 'error')
    : [];

  async function resetYouTubeAccount() {
    if (!window.confirm('Aktuelle YouTube-Anmeldung aus OBS entfernen und OBS neu starten?')) return;
    await post('/api/obs/youtube/reset', 'YouTube-Konto getrennt; OBS wurde neu gestartet.');
  }

  return (
    <section className="panel">
      <div className="page-title">
        <div>
          <p className="eyebrow">Ausgabe</p>
          <h2>OBS und Livestream</h2>
          <p>
            Studio-Prozess, Szenenverbindung und {multistream ? 'parallele YouTube-/Twitch-Ausgabe' : 'YouTube-Ausgabe'}{' '}
            zentral steuern.
          </p>
        </div>
        <div className="page-title-actions">
          <span className={`state-pill ${live ? 'live' : ''}`}>
            <RadioTower size={12} /> {live ? `${destinationLabel} Live` : 'Offline'}
          </span>
          {obs?.streamProfile?.channelUrl && (
            <a className="button" href={obs.streamProfile.channelUrl} target="_blank" rel="noreferrer">
              {obs.streamProfile.channelName || 'Zielkanal'} <ExternalLink size={15} />
            </a>
          )}
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
        {multistream && (
          <article className="stat">
            <div>
              <span>Twitch-Vorabprüfung</span>
              <strong>{twitchReady ? 'bereit' : 'blockiert'}</strong>
              <small>
                {twitchReady ? 'Plugin, Ziel und Encoder geprüft' : `${twitchErrors.length || 1} Konfigurationsfehler`}
              </small>
            </div>
            <span className={`stat-icon ${twitchReady ? 'success' : 'warning'}`}>
              {twitchReady ? <ShieldCheck size={18} /> : <AlertTriangle size={18} />}
            </span>
          </article>
        )}
      </div>

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
            disabled={!allowed || live || !connected || !twitchReady}
            title={!twitchReady ? 'Twitch-Vorabprüfung muss zuerst erfolgreich sein.' : undefined}
            onClick={() => post('/api/stream/start')}
          >
            <Play size={16} /> {multistream ? 'Parallelstream starten' : 'YouTube starten'}
          </button>
          <button className="danger" disabled={!allowed || !live} onClick={() => post('/api/stream/stop')}>
            <CircleStop size={16} /> {multistream ? 'Parallelstream stoppen' : 'YouTube stoppen'}
          </button>
        </div>
      </div>

      {message && <p role="status">{message}</p>}
      {multistream && !twitchReady && (
        <div className="status-message status-error" role="alert">
          <AlertTriangle size={19} />
          <div>
            <strong>Parallelstreaming ist gesperrt</strong>
            <p>
              Der Sendestart bleibt blockiert, bis Plugin, Twitch-Ziel, Synchronisierung, Streamschlüssel und
              Encoder-Sharing korrekt geprüft wurden.
            </p>
            {twitchErrors.map((check: any) => (
              <p key={check.id}>• {check.message}</p>
            ))}
          </div>
        </div>
      )}
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
