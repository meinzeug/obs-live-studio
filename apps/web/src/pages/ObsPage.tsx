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
import { api, can, type SessionUser, type StudioProfile } from '../api/client.js';

export function ObsPage({ user, studio }: { user: SessionUser; studio: StudioProfile }) {
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
  const activeAdditionalTargets = studio.additionalTargets.filter((target) => target.enabled);
  const multistream = obs?.process?.multistream;
  const multistreamEnabled = activeAdditionalTargets.length > 0;
  const multistreamReady = !multistreamEnabled || multistream?.ready === true;
  const multistreamErrors = Array.isArray(multistream?.checks)
    ? multistream.checks.filter((check: any) => check?.status === 'error')
    : [];
  const destinationNames = [studio.primary.name, ...activeAdditionalTargets.map((target) => target.name)];
  const destinationLabel = destinationNames.join(' + ');
  const backups = obs?.process?.backups;
  const backupStatus = backups?.status ?? 'error';
  const backupReady = backupStatus === 'ready';
  const backupLabel = backupReady ? 'bereit' : backupStatus === 'warning' ? 'prüfen' : 'gestört';
  const backupProblems = Array.isArray(backups?.checks)
    ? backups.checks.filter((check: any) => check?.status !== 'ok')
    : [];
  const backupDetail = backups?.backup?.name
    ? backups?.rehearsal?.ok === true
      ? 'Backup und Wiederherstellungsprobe geprüft'
      : 'Backup vorhanden, Wiederherstellungsprobe offen'
    : 'Kein aktuelles Backup erkannt';

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
            Studio-Prozess, Szenenverbindung und Ausgabe für {destinationLabel || 'das konfigurierte Streaming-Ziel'}
            zentral steuern.
          </p>
        </div>
        <div className="page-title-actions">
          <span className={`state-pill ${live ? 'live' : ''}`}>
            <RadioTower size={12} /> {live ? `${destinationLabel} Live` : 'Offline'}
          </span>
          {studio.channelUrl && (
            <a className="button" href={studio.channelUrl} target="_blank" rel="noreferrer">
              {studio.channelName} <ExternalLink size={15} />
            </a>
          )}
        </div>
      </div>

      <div className="stats-grid">
        <article className="stat">
          <div>
            <span>Hauptziel</span>
            <strong>{studio.primary.name}</strong>
            <small>{studio.primary.configured ? 'Server und Schlüssel konfiguriert' : 'Konfiguration unvollständig'}</small>
          </div>
          <span className={`stat-icon ${studio.primary.configured ? 'success' : 'warning'}`}>
            {studio.primary.configured ? <ShieldCheck size={18} /> : <AlertTriangle size={18} />}
          </span>
        </article>
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
        {multistreamEnabled && (
          <article className="stat">
            <div>
              <span>Zusätzliche Ziele</span>
              <strong>{multistreamReady ? 'bereit' : 'blockiert'}</strong>
              <small>
                {multistreamReady
                  ? `${activeAdditionalTargets.length} Ziel(e) synchron geprüft`
                  : `${multistreamErrors.length || 1} Konfigurationsfehler`}
              </small>
            </div>
            <span className={`stat-icon ${multistreamReady ? 'success' : 'warning'}`}>
              {multistreamReady ? <ShieldCheck size={18} /> : <AlertTriangle size={18} />}
            </span>
          </article>
        )}
        <article className="stat">
          <div>
            <span>Datensicherung</span>
            <strong>{backupLabel}</strong>
            <small>{backupDetail}</small>
          </div>
          <span className={`stat-icon ${backupReady ? 'success' : 'warning'}`}>
            {backupReady ? <ShieldCheck size={18} /> : <AlertTriangle size={18} />}
          </span>
        </article>
      </div>

      {activeAdditionalTargets.length > 0 && (
        <div className="detail-grid">
          {activeAdditionalTargets.map((target) => (
            <article className="detail-card" key={target.id}>
              <strong>{target.name}</strong>
              <span>{target.platform}</span>
              <p>{target.configured ? 'Zusätzliches Ziel ist konfiguriert.' : 'Server oder Streamschlüssel fehlt.'}</p>
              {target.channelUrl && (
                <a href={target.channelUrl} target="_blank" rel="noreferrer">
                  Kanal öffnen <ExternalLink size={14} />
                </a>
              )}
            </article>
          ))}
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
          {studio.primary.platform === 'youtube' && (
            <button disabled={!allowed || live} onClick={() => void resetYouTubeAccount()}>
              <UserRoundCog size={16} /> YouTube-Konto wechseln
            </button>
          )}
        </div>
        <div className="control-group">
          <span className="control-label">Livestream-Ziele</span>
          <button
            className="primary-button"
            disabled={!allowed || live || !connected || !studio.primary.configured || !multistreamReady}
            title={!multistreamReady ? 'Alle zusätzlichen Ziele müssen zuerst erfolgreich geprüft werden.' : undefined}
            onClick={() => post('/api/stream/start')}
          >
            <Play size={16} /> {multistreamEnabled ? 'Mehrfachstream starten' : 'Livestream starten'}
          </button>
          <button className="danger" disabled={!allowed || !live} onClick={() => post('/api/stream/stop')}>
            <CircleStop size={16} /> {multistreamEnabled ? 'Mehrfachstream stoppen' : 'Livestream stoppen'}
          </button>
        </div>
      </div>

      {message && <p role="status">{message}</p>}
      {backups && !backupReady && (
        <div className={`status-message ${backupStatus === 'error' ? 'status-error' : ''}`} role="alert">
          <AlertTriangle size={19} />
          <div>
            <strong>Datensicherung benötigt Aufmerksamkeit</strong>
            <p>
              Das Studio hat ein fehlendes, veraltetes oder fehlerhaft geprüftes Backup beziehungsweise eine offene
              Wiederherstellungsprobe erkannt.
            </p>
            {backupProblems.map((check: any) => (
              <p key={check.id}>• {check.message}</p>
            ))}
          </div>
        </div>
      )}
      {multistreamEnabled && !multistreamReady && (
        <div className="status-message status-error" role="alert">
          <AlertTriangle size={19} />
          <div>
            <strong>Zusätzliche Streaming-Ziele sind nicht bereit</strong>
            <p>
              Der Sendestart bleibt blockiert, bis Plugin, Ziele, Synchronisierung, Streamschlüssel und Encoder-Sharing
              korrekt geprüft wurden.
            </p>
            {multistreamErrors.map((check: any) => (
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
