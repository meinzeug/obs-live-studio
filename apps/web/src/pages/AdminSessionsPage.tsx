import React, { useEffect, useState } from 'react';
import { Laptop, RefreshCw, ShieldX, UserRoundX } from 'lucide-react';
import { api, can, type SessionUser } from '../api/client.js';
import { Forbidden } from '../components/Status.js';

interface ActiveSession {
  id: string;
  user_id: string;
  email: string;
  display_name: string;
  user_agent: string | null;
  ip_address: string | null;
  created_at: string;
  expires_at: string;
  current: boolean;
}

function deviceLabel(userAgent: string | null) {
  if (!userAgent) return 'Unbekanntes Gerät';
  const platform = /Android/i.test(userAgent)
    ? 'Android'
    : /iPhone|iPad/i.test(userAgent)
      ? 'iOS/iPadOS'
      : /Windows/i.test(userAgent)
        ? 'Windows'
        : /Macintosh|Mac OS/i.test(userAgent)
          ? 'macOS'
          : /Linux/i.test(userAgent)
            ? 'Linux'
            : 'Unbekanntes System';
  const browser = /Edg\//i.test(userAgent)
    ? 'Edge'
    : /Firefox\//i.test(userAgent)
      ? 'Firefox'
      : /Chrome\//i.test(userAgent)
        ? 'Chrome'
        : /Safari\//i.test(userAgent)
          ? 'Safari'
          : 'Browser';
  return `${browser} · ${platform}`;
}

export function AdminSessionsPage({ user }: { user: SessionUser }) {
  const allowed = can(user, 'users:write');
  const [sessions, setSessions] = useState<ActiveSession[]>([]);
  const [message, setMessage] = useState('');
  const [working, setWorking] = useState(false);

  async function load() {
    if (!allowed) return;
    try {
      setSessions(await api<ActiveSession[]>('/api/auth/sessions'));
    } catch (error) {
      setMessage(error instanceof Error ? error.message : String(error));
    }
  }

  useEffect(() => {
    void load();
  }, [allowed]);

  async function revoke(path: string, successText: string, confirmText?: string) {
    if (confirmText && !window.confirm(confirmText)) return;
    setWorking(true);
    try {
      const result = await api<{ count?: number }>(path, { method: 'DELETE' });
      setMessage(result.count === undefined ? successText : `${successText} (${result.count})`);
      await load();
    } catch (error) {
      setMessage(error instanceof Error ? error.message : String(error));
    } finally {
      setWorking(false);
    }
  }

  const ownOtherSessionCount = sessions.filter(
    (session) => session.user_id === user.id && !session.current,
  ).length;
  const allOtherSessionCount = sessions.filter((session) => !session.current).length;

  if (!allowed)
    return (
      <section className="panel">
        <h2>Sitzungen</h2>
        <Forbidden />
      </section>
    );

  return (
    <section className="panel">
      <div className="page-title">
        <div>
          <p className="eyebrow">Administration</p>
          <h2>Aktive Sitzungen</h2>
          <p>Angemeldete Geräte, IP-Adressen und Ablaufzeiten prüfen sowie Zugriffe gezielt widerrufen.</p>
        </div>
        <div className="row-actions">
          <button
            className="icon-button ghost-button"
            disabled={working}
            onClick={() => void load()}
            title="Aktualisieren"
            aria-label="Aktualisieren"
          >
            <RefreshCw size={17} />
          </button>
          <button
            disabled={working || ownOtherSessionCount === 0}
            onClick={() =>
              void revoke(
                '/api/auth/sessions/mine',
                'Eigene andere Sitzungen abgemeldet',
                'Eigene andere Geräte abmelden?',
              )
            }
          >
            <UserRoundX size={17} /> Eigene andere abmelden
          </button>
          <button
            className="danger"
            disabled={working || allOtherSessionCount === 0}
            onClick={() =>
              void revoke(
                '/api/auth/sessions',
                'Alle anderen Sitzungen abgemeldet',
                'Wirklich alle anderen Benutzer und Geräte abmelden? Ihre aktuelle Sitzung bleibt bestehen.',
              )
            }
          >
            <ShieldX size={17} /> Alle anderen abmelden
          </button>
        </div>
      </div>
      {message && <p role="status">{message}</p>}
      <div className="table-wrap">
        <table>
          <thead>
            <tr>
              <th>Benutzer</th>
              <th>Gerät</th>
              <th>IP-Adresse</th>
              <th>Erstellt</th>
              <th>Läuft ab</th>
              <th>Status</th>
              <th></th>
            </tr>
          </thead>
          <tbody>
            {sessions.map((session) => (
              <tr key={session.id}>
                <td>
                  <strong>{session.display_name}</strong>
                  <small>{session.email}</small>
                </td>
                <td title={session.user_agent ?? undefined}>
                  <Laptop size={15} /> {deviceLabel(session.user_agent)}
                </td>
                <td>{session.ip_address ?? 'Nicht erfasst'}</td>
                <td>{new Date(session.created_at).toLocaleString('de-DE')}</td>
                <td>{new Date(session.expires_at).toLocaleString('de-DE')}</td>
                <td>{session.current ? 'Dieses Gerät' : 'Aktiv'}</td>
                <td>
                  <button
                    className="icon-button danger"
                    disabled={working || session.current}
                    onClick={() => void revoke(`/api/auth/sessions/${session.id}`, 'Sitzung abgemeldet')}
                    title="Sitzung widerrufen"
                    aria-label={`Sitzung von ${session.display_name} widerrufen`}
                  >
                    <ShieldX size={17} />
                  </button>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </section>
  );
}
