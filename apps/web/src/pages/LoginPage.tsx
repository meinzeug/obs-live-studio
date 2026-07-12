import React, { useState } from 'react';
import { api, setCsrf, type SessionUser } from '../api/client.js';
export function LoginPage({ setupRequired, onDone }: { setupRequired: boolean; onDone: (u: SessionUser) => void }) {
  const [email, setEmail] = useState('');
  const [displayName, setDisplayName] = useState('');
  const [password, setPassword] = useState('');
  const [error, setError] = useState('');
  async function submit(e: React.FormEvent) {
    e.preventDefault();
    setError('');
    try {
      const path = setupRequired ? '/api/auth/setup' : '/api/auth/login';
      const body = setupRequired ? { email, displayName, password } : { email, password };
      const r = await api<{ user: SessionUser; csrfToken: string }>(path, {
        method: 'POST',
        body: JSON.stringify(body),
      });
      setCsrf(r.csrfToken);
      onDone(r.user);
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
    }
  }
  return (
    <main className="login">
      <form onSubmit={submit} className="panel login-card">
        <h1>{setupRequired ? 'Ersten Administrator einrichten' : 'Anmelden'}</h1>
        <p>{setupRequired ? 'Lege den ersten lokalen Administrator an.' : 'Melde dich am lokalen Studio an.'}</p>
        <input value={email} onChange={(e) => setEmail(e.target.value)} placeholder="E-Mail" type="email" required />
        {setupRequired && (
          <input
            value={displayName}
            onChange={(e) => setDisplayName(e.target.value)}
            placeholder="Anzeigename"
            required
          />
        )}
        <input
          value={password}
          onChange={(e) => setPassword(e.target.value)}
          placeholder="Passwort"
          type="password"
          minLength={setupRequired ? 12 : 1}
          required
        />
        {error && <p className="error-text">{error}</p>}
        <button>{setupRequired ? 'Administrator anlegen' : 'Einloggen'}</button>
      </form>
    </main>
  );
}
