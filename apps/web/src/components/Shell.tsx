import React from 'react';
import { Link } from 'react-router-dom';
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
  const links = [
    ['/dashboard', 'Dashboard'],
    ['/sources', 'Quellen'],
    ['/articles', 'Nachrichten'],
    ['/broadcast', 'Broadcast'],
    ['/overlays', 'Overlays'],
    ['/media', 'Medien'],
    ['/obs', 'OBS'],
    ['/admin/users', 'Benutzer'],
    ['/admin/audit', 'Audit'],
    ['/admin/sessions', 'Sitzungen'],
  ];
  return (
    <main>
      <aside>
        <h1>Automated News Studio</h1>
        {links.map(([to, label]) => (
          <Link key={to} to={to}>
            {label}
          </Link>
        ))}
      </aside>
      <section>
        <header>
          <div>
            <p>Live-Control-Center</p>
            <h2>Veröffentlichte Overlays und OBS-Sendepfad</h2>
            <small>
              {user.display_name} · {user.email} · Rolle: {user.role}
            </small>
          </div>
          <button onClick={onLogout}>Abmelden</button>
        </header>
        {children}
      </section>
    </main>
  );
}
