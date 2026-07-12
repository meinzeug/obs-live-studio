import React, { useEffect, useState } from 'react';
import { Save } from 'lucide-react';
import { api, can, type SessionUser } from '../api/client.js';
export function DashboardPage({ user }: { user: SessionUser }) {
  const [d, setD] = useState<any>();
  const [automation, setAutomation] = useState<any>();
  const [message, setMessage] = useState('');
  async function load() {
    const dashboard = await api<any>('/api/dashboard');
    setD(dashboard);
    setAutomation(dashboard.automation);
  }
  useEffect(() => {
    void load();
    const timer = window.setInterval(() => void load(), 10000);
    return () => window.clearInterval(timer);
  }, []);
  async function saveAutomation() {
    try {
      setAutomation(
        await api('/api/autopilot', {
          method: 'POST',
          body: JSON.stringify(automation),
        }),
      );
      setMessage('Autopilot gespeichert');
    } catch (error) {
      setMessage(error instanceof Error ? error.message : String(error));
    }
  }
  return (
    <section className="panel">
      <div className="page-title">
        <div>
          <h2>Sendestatus</h2>
          <p>{d?.current?.item ?? 'Lädt'}</p>
        </div>
        <span className={d?.stream?.outputActive ? 'live-badge' : 'status-badge'}>
          {d?.stream?.outputActive ? 'LIVE' : 'OFFLINE'}
        </span>
      </div>
      <div className="stats-grid">
        <article className="stat">
          <span>OBS</span>
          <strong>{d?.obs?.status ?? 'unbekannt'}</strong>
        </article>
        <article className="stat">
          <span>Playback</span>
          <strong>{d?.playback?.status ?? 'idle'}</strong>
        </article>
        <article className="stat">
          <span>Neue Artikel</span>
          <strong>{d?.counts?.newArticles ?? 0}</strong>
        </article>
        <article className="stat">
          <span>Geplant</span>
          <strong>{d?.counts?.planned ?? 0}</strong>
        </article>
      </div>
      {automation && (
        <div className="control-band">
          <h3>Autopilot</h3>
          <label className="toggle-row">
            <input
              type="checkbox"
              checked={automation.enabled}
              onChange={(event) => setAutomation({ ...automation, enabled: event.target.checked })}
            />
            Automatische Sendung
          </label>
          <label>
            Mindestvertrauen
            <input
              type="number"
              min="0"
              max="100"
              value={automation.minimumTrust}
              onChange={(event) => setAutomation({ ...automation, minimumTrust: Number(event.target.value) })}
            />
          </label>
          <label className="toggle-row">
            <input
              type="checkbox"
              checked={automation.requireStream}
              onChange={(event) => setAutomation({ ...automation, requireStream: event.target.checked })}
            />
            Nur bei aktivem Livestream
          </label>
          <button disabled={!can(user, 'broadcast:write')} onClick={saveAutomation}>
            <Save size={17} /> Speichern
          </button>
          {message && <span role="status">{message}</span>}
        </div>
      )}
    </section>
  );
}
