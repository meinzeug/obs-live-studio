import React, { useEffect, useState } from 'react';
import { BellRing, BookOpenText, CirclePlay, ListVideo, MonitorUp, Radio, Save, Settings2 } from 'lucide-react';
import { Link } from 'react-router-dom';
import { api, can, type SessionUser } from '../api/client.js';
export function DashboardPage({ user }: { user: SessionUser }) {
  const [d, setD] = useState<any>();
  const [automation, setAutomation] = useState<any>();
  const [notifications, setNotifications] = useState<{ unreadCount: number }>({ unreadCount: 0 });
  const [message, setMessage] = useState('');
  async function load() {
    const dashboard = await api<any>('/api/dashboard');
    const operational = await api<{ unreadCount: number }>('/api/notifications?limit=1').catch(() => ({
      unreadCount: 0,
    }));
    setD(dashboard);
    setAutomation(dashboard.automation);
    setNotifications(operational);
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
          <p className="eyebrow">Live-Betrieb</p>
          <h2>Sendestatus</h2>
          <p>{d?.current?.item ?? 'Aktuell ist kein Beitrag auf Sendung.'}</p>
        </div>
        <span className={d?.stream?.outputActive ? 'live-badge' : 'status-badge'}>
          <Radio size={12} />
          {d?.stream?.outputActive ? 'LIVE' : 'OFFLINE'}
        </span>
      </div>
      <div className="stats-grid">
        <article className="stat">
          <div>
            <span>OBS-Verbindung</span>
            <strong>{d?.obs?.status ?? 'unbekannt'}</strong>
            <small>Studio-Ausgabe</small>
          </div>
          <span className={`stat-icon ${d?.obs?.status === 'connected' ? 'success' : 'warning'}`}>
            <MonitorUp size={18} />
          </span>
        </article>
        <article className="stat">
          <div>
            <span>Playback</span>
            <strong>{d?.playback?.status ?? 'idle'}</strong>
            <small>Aktueller Ablauf</small>
          </div>
          <span className={`stat-icon ${d?.playback?.status === 'playing' ? 'live' : ''}`}>
            <CirclePlay size={18} />
          </span>
        </article>
        <article className="stat">
          <div>
            <span>Neue Artikel</span>
            <strong>{d?.counts?.newArticles ?? 0}</strong>
            <small>Zur redaktionellen Prüfung</small>
          </div>
          <span className="stat-icon">
            <BookOpenText size={18} />
          </span>
        </article>
        <article className="stat">
          <div>
            <span>Geplant</span>
            <strong>{d?.counts?.planned ?? 0}</strong>
            <small>Beiträge in der Sendeliste</small>
          </div>
          <span className="stat-icon success">
            <ListVideo size={18} />
          </span>
        </article>
        <article className="stat">
          <div>
            <span>Offene Störungen</span>
            <strong>{notifications.unreadCount}</strong>
            <small>
              <Link to="/notifications">Betriebszentrum öffnen</Link>
            </small>
          </div>
          <span className={`stat-icon ${notifications.unreadCount > 0 ? 'warning' : 'success'}`}>
            <BellRing size={18} />
          </span>
        </article>
      </div>
      {automation && (
        <div className="control-band">
          <div className="section-heading">
            <div>
              <p className="eyebrow">Automation</p>
              <h3>Autopilot</h3>
            </div>
            <Settings2 size={18} className="muted" />
          </div>
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
          <button className="primary-button" disabled={!can(user, 'broadcast:write')} onClick={saveAutomation}>
            <Save size={17} /> Speichern
          </button>
          {message && (
            <span className="notice" role="status">
              {message}
            </span>
          )}
        </div>
      )}
    </section>
  );
}
