import React, { useEffect, useState } from 'react';
import { KeyRound, Plus, RefreshCw, ShieldCheck } from 'lucide-react';
import { api, can, type SessionUser } from '../api/client.js';
import { Forbidden } from '../components/Status.js';

type UserRow = {
  id: string;
  email: string;
  display_name: string;
  role: 'administrator' | 'redaktion' | 'nur_lesen';
  active: boolean;
};

export function AdminUsersPage({ user }: { user: SessionUser }) {
  const allowed = can(user, 'users:write');
  const [users, setUsers] = useState<UserRow[]>([]);
  const [passwords, setPasswords] = useState<Record<string, string>>({});
  const [message, setMessage] = useState('');
  const [working, setWorking] = useState(false);
  const [form, setForm] = useState({
    email: '',
    displayName: '',
    password: '',
    role: 'redaktion' as UserRow['role'],
  });

  async function load() {
    if (!allowed) return;
    try {
      setUsers(await api('/api/auth/users'));
    } catch (error) {
      setMessage(error instanceof Error ? error.message : String(error));
    }
  }

  useEffect(() => {
    void load();
  }, [allowed]);

  async function run(action: () => Promise<unknown>, success: string) {
    if (working) return false;
    setWorking(true);
    try {
      await action();
      setMessage(success);
      await load();
      return true;
    } catch (error) {
      setMessage(error instanceof Error ? error.message : String(error));
      return false;
    } finally {
      setWorking(false);
    }
  }

  if (!allowed) {
    return (
      <section className="panel">
        <h2>Benutzer</h2>
        <Forbidden />
      </section>
    );
  }

  return (
    <section className="panel">
      <div className="page-title">
        <div>
          <p className="eyebrow">Administration</p>
          <h2>Benutzer</h2>
          <p>Konten, Rollen und lokale Zugriffsrechte verwalten.</p>
        </div>
        <button
          className="icon-button ghost-button"
          disabled={working}
          onClick={() => void load()}
          title="Aktualisieren"
          aria-label="Aktualisieren"
        >
          <RefreshCw size={17} />
        </button>
      </div>
      <form
        className="form-grid"
        onSubmit={(event) => {
          event.preventDefault();
          void (async () => {
            const saved = await run(
              () => api('/api/auth/users', { method: 'POST', body: JSON.stringify(form) }),
              'Benutzer angelegt',
            );
            if (saved) setForm({ email: '', displayName: '', password: '', role: 'redaktion' });
          })();
        }}
      >
        <label>
          E-Mail
          <input
            type="email"
            required
            disabled={working}
            value={form.email}
            onChange={(event) => setForm({ ...form, email: event.target.value })}
          />
        </label>
        <label>
          Anzeigename
          <input
            required
            disabled={working}
            value={form.displayName}
            onChange={(event) => setForm({ ...form, displayName: event.target.value })}
          />
        </label>
        <label>
          Passwort
          <input
            type="password"
            minLength={12}
            required
            disabled={working}
            value={form.password}
            onChange={(event) => setForm({ ...form, password: event.target.value })}
          />
        </label>
        <label>
          Rolle
          <select
            disabled={working}
            value={form.role}
            onChange={(event) => setForm({ ...form, role: event.target.value as UserRow['role'] })}
          >
            <option value="administrator">Administrator</option>
            <option value="redaktion">Redaktion</option>
            <option value="nur_lesen">Nur lesen</option>
          </select>
        </label>
        <button className="primary-button" type="submit" disabled={working}>
          <Plus size={17} /> {working ? 'Wird gespeichert …' : 'Anlegen'}
        </button>
      </form>
      {message && <p role="status">{message}</p>}
      <div className="table-wrap">
        <table>
          <thead>
            <tr>
              <th>Benutzer</th>
              <th>Rolle</th>
              <th>Aktiv</th>
              <th>Neues Passwort</th>
              <th>Aktionen</th>
            </tr>
          </thead>
          <tbody>
            {users.map((row) => (
              <tr key={row.id}>
                <td>
                  <strong>{row.display_name}</strong>
                  <small>{row.email}</small>
                </td>
                <td>
                  <select
                    disabled={working}
                    value={row.role}
                    onChange={(event) =>
                      void run(
                        () =>
                          api(`/api/auth/users/${row.id}/role`, {
                            method: 'POST',
                            body: JSON.stringify({ role: event.target.value }),
                          }),
                        'Rolle aktualisiert',
                      )
                    }
                  >
                    <option value="administrator">Administrator</option>
                    <option value="redaktion">Redaktion</option>
                    <option value="nur_lesen">Nur lesen</option>
                  </select>
                </td>
                <td>
                  <input
                    type="checkbox"
                    disabled={working}
                    checked={row.active}
                    aria-label={`${row.display_name} aktiv`}
                    onChange={(event) =>
                      void run(
                        () =>
                          api(`/api/auth/users/${row.id}/active`, {
                            method: 'POST',
                            body: JSON.stringify({ active: event.target.checked }),
                          }),
                        'Status aktualisiert',
                      )
                    }
                  />
                </td>
                <td>
                  <input
                    type="password"
                    minLength={12}
                    disabled={working}
                    value={passwords[row.id] ?? ''}
                    onChange={(event) => setPasswords({ ...passwords, [row.id]: event.target.value })}
                  />
                </td>
                <td className="row-actions">
                  <button
                    className="icon-button"
                    disabled={working || (passwords[row.id] ?? '').length < 12}
                    onClick={() =>
                      void (async () => {
                        const saved = await run(
                          () =>
                            api(`/api/auth/users/${row.id}/password`, {
                              method: 'POST',
                              body: JSON.stringify({ password: passwords[row.id] }),
                            }),
                          'Passwort aktualisiert',
                        );
                        if (saved) setPasswords((current) => ({ ...current, [row.id]: '' }));
                      })()
                    }
                    title="Passwort setzen"
                    aria-label="Passwort setzen"
                  >
                    <KeyRound size={17} />
                  </button>
                  <button
                    className="icon-button"
                    disabled={working}
                    onClick={() =>
                      void run(
                        () => api(`/api/auth/users/${row.id}/revoke-sessions`, { method: 'POST' }),
                        'Sitzungen widerrufen',
                      )
                    }
                    title="Sitzungen widerrufen"
                    aria-label="Sitzungen widerrufen"
                  >
                    <ShieldCheck size={17} />
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
