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
  const [form, setForm] = useState({
    email: '',
    displayName: '',
    password: '',
    role: 'redaktion' as UserRow['role'],
  });
  async function load() {
    if (allowed) setUsers(await api('/api/auth/users'));
  }
  useEffect(() => {
    void load();
  }, [allowed]);
  async function run(action: () => Promise<unknown>, success: string) {
    try {
      await action();
      setMessage(success);
      await load();
    } catch (error) {
      setMessage(error instanceof Error ? error.message : String(error));
    }
  }
  if (!allowed)
    return (
      <section className="panel">
        <h2>Benutzer</h2>
        <Forbidden />
      </section>
    );
  return (
    <section className="panel">
      <div className="page-title">
        <h2>Benutzer</h2>
        <button className="icon-button" onClick={load} title="Aktualisieren" aria-label="Aktualisieren">
          <RefreshCw size={17} />
        </button>
      </div>
      <form
        className="form-grid"
        onSubmit={(event) => {
          event.preventDefault();
          void run(
            () => api('/api/auth/users', { method: 'POST', body: JSON.stringify(form) }),
            'Benutzer angelegt',
          ).then(() => setForm({ email: '', displayName: '', password: '', role: 'redaktion' }));
        }}
      >
        <label>
          E-Mail
          <input
            type="email"
            required
            value={form.email}
            onChange={(e) => setForm({ ...form, email: e.target.value })}
          />
        </label>
        <label>
          Anzeigename
          <input
            required
            value={form.displayName}
            onChange={(e) => setForm({ ...form, displayName: e.target.value })}
          />
        </label>
        <label>
          Passwort
          <input
            type="password"
            minLength={12}
            required
            value={form.password}
            onChange={(e) => setForm({ ...form, password: e.target.value })}
          />
        </label>
        <label>
          Rolle
          <select value={form.role} onChange={(e) => setForm({ ...form, role: e.target.value as UserRow['role'] })}>
            <option value="administrator">Administrator</option>
            <option value="redaktion">Redaktion</option>
            <option value="nur_lesen">Nur lesen</option>
          </select>
        </label>
        <button type="submit">
          <Plus size={17} /> Anlegen
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
                    value={row.role}
                    onChange={(e) =>
                      void run(
                        () =>
                          api(`/api/auth/users/${row.id}/role`, {
                            method: 'POST',
                            body: JSON.stringify({ role: e.target.value }),
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
                    checked={row.active}
                    aria-label={`${row.display_name} aktiv`}
                    onChange={(e) =>
                      void run(
                        () =>
                          api(`/api/auth/users/${row.id}/active`, {
                            method: 'POST',
                            body: JSON.stringify({ active: e.target.checked }),
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
                    value={passwords[row.id] ?? ''}
                    onChange={(e) => setPasswords({ ...passwords, [row.id]: e.target.value })}
                  />
                </td>
                <td className="row-actions">
                  <button
                    className="icon-button"
                    disabled={(passwords[row.id] ?? '').length < 12}
                    onClick={() =>
                      void run(
                        () =>
                          api(`/api/auth/users/${row.id}/password`, {
                            method: 'POST',
                            body: JSON.stringify({ password: passwords[row.id] }),
                          }),
                        'Passwort aktualisiert',
                      ).then(() => setPasswords({ ...passwords, [row.id]: '' }))
                    }
                    title="Passwort setzen"
                    aria-label="Passwort setzen"
                  >
                    <KeyRound size={17} />
                  </button>
                  <button
                    className="icon-button"
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
