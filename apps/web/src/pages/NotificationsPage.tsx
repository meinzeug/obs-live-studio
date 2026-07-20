import React, { useEffect, useRef, useState } from 'react';
import { ArrowUpRight, BellRing, Check, CheckCheck, CircleAlert, RefreshCw } from 'lucide-react';
import { Link } from 'react-router-dom';
import { api, isApiRateLimitError } from '../api/client.js';
import { notificationTarget } from '../navigation.js';

interface NotificationItem {
  id: string;
  level: 'info' | 'warning' | 'error' | 'critical';
  component: string;
  message: string;
  details: Record<string, unknown>;
  occurrences: number;
  created_at: string;
  last_seen_at: string;
  resolved_at: string | null;
  user_read_at: string | null;
}

interface NotificationResponse {
  items: NotificationItem[];
  unreadCount: number;
}

function dateTime(value: string | null) {
  return value ? new Date(value).toLocaleString('de-DE') : '–';
}

function levelLabel(level: NotificationItem['level']) {
  if (level === 'critical') return 'Kritisch';
  if (level === 'error') return 'Fehler';
  if (level === 'warning') return 'Warnung';
  return 'Information';
}

function levelClass(level: NotificationItem['level']) {
  if (level === 'info') return 'success';
  if (level === 'error' || level === 'critical') return 'error';
  return 'warning';
}

function componentLabel(component: string) {
  if (component === 'source-ingest') return 'Quellenabruf';
  if (component === 'broadcast-runner') return 'Broadcast-Runner';
  if (component.startsWith('obs')) return 'OBS';
  if (component.startsWith('stream')) return 'Livestream';
  return component;
}

function detailText(item: NotificationItem) {
  const details = item.details ?? {};
  const parts = [
    typeof details.sourceName === 'string' ? `Quelle: ${details.sourceName}` : '',
    typeof details.error === 'string' ? `Fehler: ${details.error}` : '',
    Number.isFinite(Number(details.consecutiveErrors)) ? `Fehlversuche: ${details.consecutiveErrors}` : '',
    Number.isFinite(Number(details.retryInSeconds)) ? `Nächster Versuch in ${details.retryInSeconds} Sekunden` : '',
  ].filter(Boolean);
  return parts.join(' · ');
}

export function NotificationsPage() {
  const [data, setData] = useState<NotificationResponse>({ items: [], unreadCount: 0 });
  const [includeResolved, setIncludeResolved] = useState(false);
  const [message, setMessage] = useState('');
  const notificationBackoffUntil = useRef(0);

  async function load() {
    if (Date.now() < notificationBackoffUntil.current) return;
    try {
      setData(
        await api<NotificationResponse>(
          `/api/notifications?limit=200&includeResolved=${includeResolved ? 'true' : 'false'}`,
        ),
      );
      notificationBackoffUntil.current = 0;
    } catch (error) {
      if (isApiRateLimitError(error)) notificationBackoffUntil.current = Date.now() + 30_000;
      setMessage(error instanceof Error ? error.message : String(error));
    }
  }

  useEffect(() => {
    void load();
    const timer = window.setInterval(() => void load(), 10000);
    return () => window.clearInterval(timer);
  }, [includeResolved]);

  async function markRead(id: string) {
    try {
      await api(`/api/notifications/${id}/read`, { method: 'POST' });
      await load();
    } catch (error) {
      setMessage(error instanceof Error ? error.message : String(error));
    }
  }

  async function markAllRead() {
    try {
      const result = await api<{ count: number }>('/api/notifications/read-all', { method: 'POST' });
      setMessage(`${result.count} Benachrichtigungen wurden quittiert.`);
      await load();
    } catch (error) {
      setMessage(error instanceof Error ? error.message : String(error));
    }
  }

  return (
    <section className="panel">
      <div className="page-title">
        <div>
          <p className="eyebrow">Betriebsüberwachung</p>
          <h2>Störungen und Hinweise</h2>
          <p>Persistente Meldungen aus Quellenabruf und Broadcast-Runner – benutzerspezifisch quittierbar.</p>
        </div>
        <span className={`state-pill ${data.unreadCount > 0 ? 'warning' : 'success'}`}>
          <BellRing size={13} /> {data.unreadCount} ungelesen
        </span>
      </div>

      <div className="toolbar">
        <label className="toggle-row">
          <input
            type="checkbox"
            checked={includeResolved}
            onChange={(event) => setIncludeResolved(event.target.checked)}
          />
          Behobene Meldungen anzeigen
        </label>
        <button onClick={() => void load()}>
          <RefreshCw size={17} /> Aktualisieren
        </button>
        <button className="primary-button" disabled={data.unreadCount === 0} onClick={() => void markAllRead()}>
          <CheckCheck size={17} /> Alle quittieren
        </button>
      </div>

      {message && <p role="status">{message}</p>}

      {data.items.length > 0 ? (
        <div className="source-grid">
          {data.items.map((item) => {
            const unread = !item.user_read_at && !item.resolved_at;
            const details = detailText(item);
            return (
              <article className="source-card" key={item.id}>
                <div>
                  <div className="card-header">
                    <h3>{item.message}</h3>
                    <span className={`state-pill ${levelClass(item.level)}`}>
                      <CircleAlert size={12} /> {levelLabel(item.level)}
                    </span>
                  </div>
                  <p className="card-meta">
                    {componentLabel(item.component)} · zuletzt {dateTime(item.last_seen_at)}
                  </p>
                  {details && <p>{details}</p>}
                </div>
                <div className="card-footer">
                  <span className={unread ? 'error-text' : 'muted'}>
                    {item.resolved_at
                      ? `Behoben ${dateTime(item.resolved_at)}`
                      : unread
                        ? 'Noch nicht quittiert'
                        : `Quittiert ${dateTime(item.user_read_at)}`}
                    {item.occurrences > 1 ? ` · ${item.occurrences} Ereignisse` : ''}
                  </span>
                  <div className="toolbar">
                    <Link className="button" to={notificationTarget(item.component, item.details)}>
                      Modul öffnen <ArrowUpRight size={15} />
                    </Link>
                    {unread && (
                      <button onClick={() => void markRead(item.id)}>
                        <Check size={16} /> Quittieren
                      </button>
                    )}
                  </div>
                </div>
              </article>
            );
          })}
        </div>
      ) : (
        <div className="empty-state">
          <div>
            <BellRing size={24} />
            <p>Keine offenen Betriebsstörungen vorhanden.</p>
          </div>
        </div>
      )}
    </section>
  );
}
