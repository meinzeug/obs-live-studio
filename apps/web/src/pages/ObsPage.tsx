import React, { useEffect, useState } from 'react';
import { api, can, type SessionUser } from '../api/client.js';
export function ObsPage({ user }: { user: SessionUser }) {
  const [obs, setObs] = useState<any>();
  async function load() {
    setObs(await api('/api/obs/status'));
  }
  useEffect(() => {
    void load();
  }, []);
  async function post(path: string) {
    setObs(await api(path, { method: 'POST' }));
  }
  return (
    <section className="panel">
      <h2>OBS</h2>
      <p>
        {obs?.status} · {obs?.endpoint}
      </p>
      <button disabled={!can(user, 'obs:write')} onClick={() => post('/api/obs/connect')}>
        Verbinden
      </button>
      <button disabled={!can(user, 'obs:write')} onClick={() => post('/api/obs/setup')}>
        Browserquellen wiederherstellen
      </button>
    </section>
  );
}
