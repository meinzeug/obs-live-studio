import React, { useEffect, useState } from 'react';
import { RefreshCw, Search } from 'lucide-react';
import { api, can, type SessionUser } from '../api/client.js';
import { Forbidden } from '../components/Status.js';

export function AdminAuditPage({ user }: { user: SessionUser }) {
  const allowed = can(user, 'users:write');
  const [rows, setRows] = useState<any[]>([]);
  const [query, setQuery] = useState('');
  const [error, setError] = useState('');
  async function load() {
    if (!allowed) return;
    try {
      setRows(await api(`/api/auth/audit?q=${encodeURIComponent(query)}&limit=200`));
      setError('');
    } catch (requestError) {
      setError(requestError instanceof Error ? requestError.message : String(requestError));
    }
  }
  useEffect(() => {
    void load();
  }, [allowed]);
  if (!allowed)
    return (
      <section className="panel">
        <h2>Audit-Log</h2>
        <Forbidden />
      </section>
    );
  return (
    <section className="panel">
      <div className="page-title">
        <div>
          <p className="eyebrow">Administration</p>
          <h2>Audit-Log</h2>
          <p>Sicherheitsrelevante und redaktionelle Änderungen nachvollziehen.</p>
        </div>
        <button className="icon-button ghost-button" onClick={load} title="Aktualisieren" aria-label="Aktualisieren">
          <RefreshCw size={17} />
        </button>
      </div>
      <form
        className="search-row"
        onSubmit={(event) => {
          event.preventDefault();
          void load();
        }}
      >
        <input value={query} onChange={(event) => setQuery(event.target.value)} placeholder="Volltextsuche" />
        <button type="submit" className="icon-button" title="Suchen" aria-label="Suchen">
          <Search size={17} />
        </button>
      </form>
      {error && <p className="error">{error}</p>}
      <div className="table-wrap">
        <table>
          <thead>
            <tr>
              <th>Zeit</th>
              <th>Benutzer</th>
              <th>Aktion</th>
              <th>Objekt</th>
              <th>Details</th>
            </tr>
          </thead>
          <tbody>
            {rows.map((row) => (
              <tr key={row.id}>
                <td>{new Date(row.created_at).toLocaleString('de-DE')}</td>
                <td>{row.user_email ?? 'System'}</td>
                <td>{row.action}</td>
                <td>{row.entity_type ? `${row.entity_type} · ${row.entity_id ?? '-'}` : '-'}</td>
                <td className="details-cell">
                  {Object.keys(row.details ?? {}).length ? JSON.stringify(row.details) : '-'}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </section>
  );
}
