import React, { useEffect, useState } from 'react';
import { LogIn, RadioTower } from 'lucide-react';
import { api, setCsrf, type SessionUser, type StudioProfile } from '../api/client.js';

export function LoginPage({
  studio,
  setupRequired,
  initialMessage = '',
  onDone,
}: {
  studio: StudioProfile;
  setupRequired: boolean;
  initialMessage?: string;
  onDone: (u: SessionUser) => void;
}) {
  const [email, setEmail] = useState('');
  const [displayName, setDisplayName] = useState('');
  const [password, setPassword] = useState('');
  const [error, setError] = useState(initialMessage);
  const [submitting, setSubmitting] = useState(false);

  useEffect(() => {
    setError(initialMessage);
  }, [initialMessage]);

  async function submit(event: React.FormEvent) {
    event.preventDefault();
    if (submitting) return;
    setSubmitting(true);
    setError('');
    try {
      const path = setupRequired ? '/api/auth/setup' : '/api/auth/login';
      const body = setupRequired ? { email, displayName, password } : { email, password };
      const result = await api<{ user: SessionUser; csrfToken: string }>(path, {
        method: 'POST',
        body: JSON.stringify(body),
      });
      setCsrf(result.csrfToken);
      onDone(result.user);
    } catch (requestError) {
      setError(requestError instanceof Error ? requestError.message : String(requestError));
    } finally {
      setSubmitting(false);
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
              onChange={(event) => setEmail(event.target.value)}
              placeholder="name@beispiel.de"
              type="email"
              autoComplete="username"
              disabled={submitting}
              required
            />
          </label>
          {setupRequired && (
            <label>
              Anzeigename
              <input
                value={displayName}
                onChange={(event) => setDisplayName(event.target.value)}
                placeholder="Vor- und Nachname"
                autoComplete="name"
                disabled={submitting}
                required
              />
            </label>
          )}
          <label>
            Passwort
            <input
              value={password}
              onChange={(event) => setPassword(event.target.value)}
              placeholder="Passwort"
              type="password"
              autoComplete={setupRequired ? 'new-password' : 'current-password'}
              minLength={setupRequired ? 12 : 1}
              disabled={submitting}
              required
            />
          </label>
          {error && <p className="form-error">{error}</p>}
          <button className="primary-button login-button" disabled={submitting}>
            <LogIn size={18} />
            {submitting ? 'Anmeldung läuft …' : setupRequired ? 'Administrator anlegen' : 'Einloggen'}
          </button>
        </form>
        <p className="login-footer">Zugriff nur aus dem lokalen Studiobetrieb</p>
      </section>
    </main>
  );
}
