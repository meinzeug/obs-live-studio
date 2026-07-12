import React from 'react';
import {
  Activity,
  BookOpenText,
  Database,
  FileClock,
  Files,
  Image,
  LogOut,
  MonitorUp,
  Radio,
  Rss,
  Users,
  type LucideIcon,
} from 'lucide-react';
import { NavLink } from 'react-router-dom';
import { can, type SessionUser } from '../api/client.js';
export function Shell({
  user,
  onLogout,
  children,
}: {
  user: SessionUser;
  onLogout: () => void;
  children: React.ReactNode;
}) {
  const links: Array<[string, string, LucideIcon]> = [
    ['/dashboard', 'Dashboard', Activity],
    ['/sources', 'Quellen', Rss],
    ['/articles', 'Nachrichten', BookOpenText],
    ['/broadcast', 'Broadcast', Radio],
    ['/overlays', 'Overlays', Files],
    ['/media', 'Medien', Image],
    ['/obs', 'OBS', MonitorUp],
  ];
  const adminLinks: Array<[string, string, LucideIcon]> = [
    ['/admin/users', 'Benutzer', Users],
    ['/admin/audit', 'Audit', FileClock],
    ['/admin/sessions', 'Sitzungen', Database],
  ];
  if (can(user, 'users:write')) links.push(...adminLinks);
  return (
    <main>
      <aside>
        <div className="brand">
          <span>ARGUMENTATIONSKETTE</span>
          <h1>TV Studio</h1>
        </div>
        <nav>
          {links.map(([to, label, Icon]) => (
            <NavLink key={to} to={to} className={({ isActive }) => (isActive ? 'active' : '')}>
              <Icon size={17} aria-hidden="true" />
              {label}
            </NavLink>
          ))}
        </nav>
      </aside>
      <section>
        <header>
          <div>
            <p>Live Control Center</p>
            <small>
              {user.display_name} · {user.email} · Rolle: {user.role}
            </small>
          </div>
          <button className="icon-button" onClick={onLogout} title="Abmelden" aria-label="Abmelden">
            <LogOut size={18} />
          </button>
        </header>
        {children}
      </section>
    </main>
  );
}
