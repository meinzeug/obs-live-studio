import React, { useEffect, useState } from 'react';
import { RefreshCw, ShieldX } from 'lucide-react';
import { api, can, type SessionUser } from '../api/client.js';
import { Forbidden } from '../components/Status.js';

export function AdminSessionsPage({ user }: { user: SessionUser }) {
  const allowed = can(user, 'users:write');
  const [sessions, setSessions] = useState<any[]>([]);
  const [message, setMessage] = useState('');
  async function load() {
    if (allowed) setSessions(await api('/api/auth/sessions'));
  }
  useEffect(() => {
    void load();
  }, [allowed]);
  async function revoke(path: string) {
    try {
      await api(path, { method: 'DELETE' });
      setMessage('Sitzungen widerrufen');
      await load();
    } catch (error) {
      setMessage(error instanceof Error ? error.message : String(error));
    }
  }
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
        <h2>Aktive Sitzungen</h2>
        <div className="row-actions">
          <button className="icon-button" onClick={load} title="Aktualisieren" aria-label="Aktualisieren">
            <RefreshCw size={17} />
          </button>
          <button className="danger" onClick={() => revoke('/api/auth/sessions')}>
            <ShieldX size={17} /> Andere widerrufen
          </button>
        </div>
      </div>
      {message && <p role="status">{message}</p>}
      <div className="table-wrap">
        <table>
          <thead>
            <tr>
              <th>Benutzer</th>
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
                <td>{new Date(session.created_at).toLocaleString('de-DE')}</td>
                <td>{new Date(session.expires_at).toLocaleString('de-DE')}</td>
                <td>{session.current ? 'Aktuell' : 'Aktiv'}</td>
                <td>
                  <button
                    className="icon-button danger"
                    disabled={session.current}
                    onClick={() => revoke(`/api/auth/sessions/${session.id}`)}
                    title="Sitzung widerrufen"
                    aria-label="Sitzung widerrufen"
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
