import React, { useEffect, useState } from 'react';
import { CircleStop, ExternalLink, Link2, Play, Power, RefreshCw, Settings2, UserRoundCog } from 'lucide-react';
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
    }
  }
  const allowed = can(user, 'obs:write');
  const live = Boolean(obs?.stream?.outputActive);
  const processRunning = obs?.process?.state === 'running';
  const connected = obs?.status === 'connected';
  async function resetYouTubeAccount() {
    if (!window.confirm('Aktuelle YouTube-Anmeldung aus OBS entfernen und OBS neu starten?')) return;
    await post('/api/obs/youtube/reset', 'YouTube-Konto getrennt; OBS wurde neu gestartet.');
  }
  return (
    <section className="panel">
      <h2>OBS und YouTube</h2>
      <p>
        OBS: {obs?.status ?? 'unbekannt'} · Prozess: {obs?.process?.state ?? 'unbekannt'} · YouTube:{' '}
        <b>{live ? 'LIVE' : 'offline'}</b>
      </p>
      {obs?.streamProfile?.channelUrl && (
        <p>
          Zielkanal:{' '}
          <a href={obs.streamProfile.channelUrl} target="_blank" rel="noreferrer">
            {obs.streamProfile.channelName || obs.streamProfile.channelUrl} <ExternalLink size={14} />
          </a>
        </p>
      )}
      <div className="toolbar">
        <button disabled={!allowed || processRunning} onClick={() => post('/api/obs/process/start')}>
          <Power size={16} /> OBS starten
        </button>
        <button disabled={!allowed || !processRunning} onClick={() => post('/api/obs/process/restart')}>
          <RefreshCw size={16} /> OBS neu starten
        </button>
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
      <div className="toolbar">
        <button disabled={!allowed || live || !connected} onClick={() => post('/api/stream/start')}>
          <Play size={16} /> YouTube starten
        </button>
        <button disabled={!allowed || !live} onClick={() => post('/api/stream/stop')}>
          <CircleStop size={16} /> YouTube stoppen
        </button>
      </div>
      <p role="status">{message}</p>
      {obs?.streamSupervisor?.supervisorLastError && (
        <p className="error-text">Streamstart: {obs.streamSupervisor.supervisorLastError}</p>
      )}
      <p>
        Laufzeit: {obs?.stream?.outputTimecode ?? '00:00:00'} · Ausgelassene Frames:{' '}
        {obs?.stream?.outputSkippedFrames ?? 0} · Auslastung: {Math.round((obs?.stream?.outputCongestion ?? 0) * 100)} %
      </p>
    </section>
  );
}
