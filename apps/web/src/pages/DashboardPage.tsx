import React, { useEffect, useRef, useState } from 'react';
import {
  BellRing,
  BookOpenText,
  CirclePlay,
  HeartPulse,
  ListVideo,
  MonitorUp,
  Radio,
  Save,
  Settings2,
} from 'lucide-react';
import { Link } from 'react-router-dom';
import { api, can, type SessionUser } from '../api/client.js';
import { articlesRoute, broadcastRoute, routes, sourceHealthRoute } from '../navigation.js';

export function DashboardPage({ user }: { user: SessionUser }) {
  const [dashboard, setDashboard] = useState<any>();
  const [automation, setAutomation] = useState<any>();
  const [notifications, setNotifications] = useState<{ unreadCount: number }>({ unreadCount: 0 });
  const [message, setMessage] = useState('');
  const automationDirty = useRef(false);
  const automationAllowed = can(user, 'broadcast:write');

  async function load() {
    try {
      const nextDashboard = await api<any>('/api/dashboard');
      setDashboard(nextDashboard);
      if (!automationDirty.current) setAutomation(nextDashboard.automation);
    } catch (error) {
      setMessage(error instanceof Error ? error.message : String(error));
      return;
    }

    try {
      setNotifications(await api<{ unreadCount: number }>('/api/notifications?limit=1'));
    } catch (error) {
      setMessage(
        `Störungen konnten nicht aktualisiert werden: ${error instanceof Error ? error.message : String(error)}`,
      );
    }
  }

  useEffect(() => {
    void load();
    const timer = window.setInterval(() => void load(), 10000);
    return () => window.clearInterval(timer);
  }, []);

  function updateAutomation(patch: Record<string, unknown>) {
    if (!automationAllowed) return;
    automationDirty.current = true;
    setAutomation((current: any) => ({ ...current, ...patch }));
  }

  async function saveAutomation() {
    if (!automationAllowed) return;
    try {
      const saved = await api('/api/autopilot', {
        method: 'POST',
        body: JSON.stringify(automation),
      });
      automationDirty.current = false;
      setAutomation(saved);
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
          <p>{dashboard?.current?.item ?? 'Aktuell ist kein Beitrag auf Sendung.'}</p>
        </div>
        <span className={dashboard?.stream?.outputActive ? 'live-badge' : 'status-badge'}>
          <Radio size={12} />
          {dashboard?.stream?.outputActive ? 'LIVE' : 'OFFLINE'}
        </span>
      </div>
      <div className="stats-grid">
        <Link className="stat stat-link" to={routes.obs} aria-label="OBS-Modul öffnen">
          <div>
            <span>OBS-Verbindung</span>
            <strong>{dashboard?.obs?.status ?? 'unbekannt'}</strong>
            <small>Studio-Ausgabe öffnen</small>
          </div>
          <span className={`stat-icon ${dashboard?.obs?.status === 'connected' ? 'success' : 'warning'}`}>
            <MonitorUp size={18} />
          </span>
        </Link>
        <Link className="stat stat-link" to={broadcastRoute('active')} aria-label="Aktiven Broadcast öffnen">
          <div>
            <span>Playback</span>
            <strong>{dashboard?.playback?.status ?? 'idle'}</strong>
            <small>Aktuellen Ablauf steuern</small>
          </div>
          <span className={`stat-icon ${dashboard?.playback?.status === 'playing' ? 'live' : ''}`}>
            <CirclePlay size={18} />
          </span>
        </Link>
        <Link className="stat stat-link" to={articlesRoute({ status: 'new' })} aria-label="Neue Artikel öffnen">
          <div>
            <span>Neue Artikel</span>
            <strong>{dashboard?.counts?.newArticles ?? 0}</strong>
            <small>Zur redaktionellen Prüfung</small>
          </div>
          <span className="stat-icon">
            <BookOpenText size={18} />
          </span>
        </Link>
        <Link className="stat stat-link" to={broadcastRoute('planned')} aria-label="Geplante Beiträge öffnen">
          <div>
            <span>Geplant</span>
            <strong>{dashboard?.counts?.planned ?? 0}</strong>
            <small>Beiträge in der Sendeliste</small>
          </div>
          <span className="stat-icon success">
            <ListVideo size={18} />
          </span>
        </Link>
        <Link
          className="stat stat-link"
          to={sourceHealthRoute({ state: 'problem' })}
          aria-label="Fehlerhafte Quellen öffnen"
        >
          <div>
            <span>Quellenfehler</span>
            <strong>{dashboard?.counts?.failedSources ?? 0}</strong>
            <small>Betroffene Quellen anzeigen</small>
          </div>
          <span className={`stat-icon ${(dashboard?.counts?.failedSources ?? 0) > 0 ? 'warning' : 'success'}`}>
            <HeartPulse size={18} />
          </span>
        </Link>
        <Link className="stat stat-link" to={routes.notifications} aria-label="Störungszentrum öffnen">
          <div>
            <span>Offene Störungen</span>
            <strong>{notifications.unreadCount}</strong>
            <small>Betriebszentrum öffnen</small>
          </div>
          <span className={`stat-icon ${notifications.unreadCount > 0 ? 'warning' : 'success'}`}>
            <BellRing size={18} />
          </span>
        </Link>
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
              disabled={!automationAllowed}
              checked={automation.enabled}
              onChange={(event) => updateAutomation({ enabled: event.target.checked })}
            />
            Automatische Sendung
          </label>
          <label>
            Mindestvertrauen
            <input
              type="number"
              min="0"
              max="100"
              disabled={!automationAllowed}
              value={automation.minimumTrust}
              onChange={(event) => updateAutomation({ minimumTrust: Number(event.target.value) })}
            />
          </label>
          <label className="toggle-row">
            <input
              type="checkbox"
              disabled={!automationAllowed}
              checked={automation.requireStream}
              onChange={(event) => updateAutomation({ requireStream: event.target.checked })}
            />
            Nur bei aktivem Livestream
          </label>
          <label className="toggle-row">
            <input
              type="checkbox"
              disabled={!automationAllowed}
              checked={automation.requireVideo}
              onChange={(event) => updateAutomation({ requireVideo: event.target.checked })}
            />
            Nur mit geprüftem Video
          </label>
          <label>
            Beiträge pro Sendung
            <input
              type="number"
              min="1"
              max="20"
              disabled={!automationAllowed}
              value={automation.showItemCount ?? 1}
              onChange={(event) => updateAutomation({ showItemCount: Number(event.target.value) })}
            />
          </label>
          <label>
            Pause zwischen Beiträgen (s)
            <input
              type="number"
              min="0"
              max="600"
              disabled={!automationAllowed}
              value={automation.pauseSeconds ?? 5}
              onChange={(event) => updateAutomation({ pauseSeconds: Number(event.target.value) })}
            />
          </label>
          <label>
            Pause zwischen Sendungen (s)
            <input
              type="number"
              min="0"
              max="3600"
              disabled={!automationAllowed}
              value={automation.pauseBetweenShowsSeconds ?? 15}
              onChange={(event) => updateAutomation({ pauseBetweenShowsSeconds: Number(event.target.value) })}
            />
          </label>
          <button className="primary-button" disabled={!automationAllowed} onClick={saveAutomation}>
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
