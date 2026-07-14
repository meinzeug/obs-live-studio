import React, { useState } from 'react';
import { LogIn, RadioTower } from 'lucide-react';
import { api, setCsrf, type SessionUser, type StudioProfile } from '../api/client.js';

export function LoginPage({
  studio,
  setupRequired,
  onDone,
}: {
  studio: StudioProfile;
  setupRequired: boolean;
  onDone: (u: SessionUser) => void;
}) {
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
    <main className="login-shell">
      <section className="login-card">
        <div className="login-brand">
          <span className="brand-mark" aria-hidden="true">
            <RadioTower size={23} />
          </span>
          <div>
            <strong>{studio.channelName}</strong>
            <span>{studio.studioName}</span>
          </div>
        </div>
        <div className="login-heading">
          <p className="eyebrow">Lokales Streaming-Studio</p>
          <h1>{setupRequired ? 'Administrator einrichten' : 'Willkommen zurück'}</h1>
          <p>{setupRequired ? 'Lege den ersten lokalen Administrator an.' : 'Melde dich am Control Center an.'}</p>
        </div>
        <form onSubmit={submit} className="login-form">
          <label>
            E-Mail
            <input
              value={email}
              onChange={(e) => setEmail(e.target.value)}
              placeholder="name@beispiel.de"
              type="email"
              required
            />
          </label>
          {setupRequired && (
            <label>
              Anzeigename
              <input
                value={displayName}
                onChange={(e) => setDisplayName(e.target.value)}
                placeholder="Vor- und Nachname"
                required
              />
            </label>
          )}
          <label>
            Passwort
            <input
              value={password}
              onChange={(e) => setPassword(e.target.value)}
              placeholder="Passwort"
              type="password"
              minLength={setupRequired ? 12 : 1}
              required
            />
          </label>
          {error && <p className="form-error">{error}</p>}
          <button className="primary-button login-button">
            <LogIn size={18} /> {setupRequired ? 'Administrator anlegen' : 'Einloggen'}
          </button>
        </form>
        <p className="login-footer">Zugriff nur aus dem lokalen Studiobetrieb</p>
      </section>
    </main>
  );
}
