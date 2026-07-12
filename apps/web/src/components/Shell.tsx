import React from 'react';
import type { SessionUser } from '../api/client.js';
export function Shell({
  user,
  onLogout,
  children,
}: {
  user: SessionUser;
  onLogout: () => void;
  children: React.ReactNode;
}) {
  return (
    <main>
      <aside>
        <h1>Automated News Studio</h1>
        {['Dashboard', 'Quellen', 'Nachrichten', 'Sendeliste', 'OBS-System'].map((x) => (
          <a key={x} href={`#${x}`}>
            {x}
          </a>
        ))}
      </aside>
      <section>
        <header>
          <div>
            <p>Broadcast-Control-Center</p>
            <h2>Vom Artikel zum Hauptnachrichtenbeitrag</h2>
            <small>
              {user.display_name} · {user.email} · Rolle: {user.role}
            </small>
          </div>
          <button onClick={onLogout}>Abmelden</button>
          <a className="button" href="/overlay/main" target="_blank">
            Overlay öffnen
          </a>
        </header>
        {children}
      </section>
    </main>
  );
}
