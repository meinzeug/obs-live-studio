import React from 'react';
import { api, can, type SessionUser } from '../api/client.js';
import { Forbidden } from '../components/Status.js';
export function ObsSystemPage({
  obsSystem,
  setObsSystem,
  setMsg,
  user,
  load,
}: {
  obsSystem: any;
  setObsSystem: (x: any) => void;
  setMsg: (s: string) => void;
  user: SessionUser;
  load: () => Promise<void>;
}) {
  async function obsProcess(action: 'start' | 'stop' | 'restart') {
    setObsSystem(await api(`/api/obs/process/${action}`, { method: 'POST' }));
    setMsg(`OBS-Prozess: ${action}`);
    await load();
  }
  const allowed = can(user, 'obs:write');
  return (
    <div className="panel" id="OBS-System">
      <h3>OBS-System</h3>
      <p>
        WebSocket: {obsSystem?.status ?? 'unbekannt'} · Prozess: {obsSystem?.process?.state ?? 'unbekannt'} · PID:{' '}
        {obsSystem?.process?.pid ?? '-'}
      </p>
      <p>
        Grafik: {obsSystem?.process?.graphics?.canStartObs ? 'verfügbar' : 'nicht erkannt'} · Letzter Fehler:{' '}
        {obsSystem?.process?.lastError ?? '-'}
      </p>
      {!allowed && <Forbidden />}
      <button disabled={!allowed} onClick={() => obsProcess('start')}>
        OBS starten
      </button>
      <button disabled={!allowed} onClick={() => obsProcess('stop')}>
        OBS stoppen
      </button>
      <button disabled={!allowed} onClick={() => obsProcess('restart')}>
        OBS neu starten
      </button>
      <button
        disabled={!allowed}
        onClick={async () => {
          await api('/api/obs/connect', { method: 'POST' });
          await load();
        }}
      >
        WebSocket verbinden
      </button>
      <button
        disabled={!allowed}
        onClick={async () => {
          await api('/api/obs/setup', { method: 'POST' });
          await load();
        }}
      >
        Szenen einrichten
      </button>
    </div>
  );
}
