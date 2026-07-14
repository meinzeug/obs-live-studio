import React, { useEffect, useState } from 'react';
import {
  Activity,
  BellRing,
  BookOpenText,
  ChevronRight,
  Database,
  FileClock,
  Files,
  Image,
  LogOut,
  MonitorUp,
  Radio,
  RadioTower,
  Rss,
  Users,
  type LucideIcon,
} from 'lucide-react';
import { NavLink, useLocation } from 'react-router-dom';
import { api, can, type SessionUser } from '../api/client.js';

type NavItem = { to: string; label: string; icon: LucideIcon; count?: number };

export function Shell({
  user,
  onLogout,
  children,
}: {
  user: SessionUser;
  onLogout: () => void;
  children: React.ReactNode;
}) {
  const location = useLocation();
  const [unreadNotifications, setUnreadNotifications] = useState(0);

  useEffect(() => {
    let active = true;
    async function loadNotifications() {
      try {
        const result = await api<{ unreadCount: number }>('/api/notifications?limit=1');
        if (active) setUnreadNotifications(result.unreadCount);
      } catch {}
    }
    void loadNotifications();
    const timer = window.setInterval(() => void loadNotifications(), 15000);
    return () => {
      active = false;
      window.clearInterval(timer);
    };
  }, [location.pathname]);

  const studioLinks: NavItem[] = [
    { to: '/dashboard', label: 'Dashboard', icon: Activity },
    { to: '/sources', label: 'Quellen', icon: Rss },
    { to: '/articles', label: 'Nachrichten', icon: BookOpenText },
    { to: '/broadcast', label: 'Broadcast', icon: Radio },
    { to: '/overlays', label: 'Overlays', icon: Files },
    { to: '/media', label: 'Medien', icon: Image },
    { to: '/obs', label: 'OBS', icon: MonitorUp },
    { to: '/notifications', label: 'Störungen', icon: BellRing, count: unreadNotifications },
  ];
  const adminLinks: NavItem[] = [
    { to: '/admin/users', label: 'Benutzer', icon: Users },
    { to: '/admin/audit', label: 'Audit', icon: FileClock },
    { to: '/admin/sessions', label: 'Sitzungen', icon: Database },
  ];
  const availableAdminLinks = can(user, 'users:write') ? adminLinks : [];
  const current = [...studioLinks, ...availableAdminLinks].find(
    ({ to }) => location.pathname === to || location.pathname.startsWith(`${to}/`),
  );
  const initials = user.display_name
    .split(/\s+/)
    .map((part) => part[0])
    .join('')
    .slice(0, 2)
    .toUpperCase();

  function navigation(items: NavItem[]) {
    return items.map(({ to, label, icon: Icon, count }) => (
      <NavLink key={to} to={to} className={({ isActive }) => (isActive ? 'active' : '')}>
        <Icon size={18} aria-hidden="true" />
        <span>{label}</span>
        {count ? <span className="count-pill">{count > 99 ? '99+' : count}</span> : null}
      </NavLink>
    ));
  }

  return (
    <div className="app-shell">
      <aside className="app-sidebar">
        <div className="brand">
          <span className="brand-mark" aria-hidden="true">
            <RadioTower size={21} />
          </span>
          <div>
            <strong>ArgumentationsKette</strong>
            <span>Broadcast Control</span>
          </div>
        </div>
        <nav className="sidebar-nav" aria-label="Hauptnavigation">
          <p className="nav-label">Studio</p>
          {navigation(studioLinks)}
          {availableAdminLinks.length > 0 && <p className="nav-label admin-label">Administration</p>}
          {navigation(availableAdminLinks)}
        </nav>
        <div className="sidebar-user">
          <span className="user-avatar">{initials}</span>
          <div>
            <strong>{user.display_name}</strong>
            <span>{user.role}</span>
          </div>
        </div>
      </aside>
      <div className="app-workspace">
        <header className="topbar">
          <div className="breadcrumb" aria-label="Aktuelle Seite">
            <span>Studio</span>
            <ChevronRight size={15} aria-hidden="true" />
            <strong>{current?.label ?? 'Control Center'}</strong>
          </div>
          <div className="topbar-meta">
            <span className="role-pill">{user.role}</span>
            <span className="topbar-email">{user.email}</span>
            <button
              className="icon-button ghost-button topbar-logout"
              onClick={onLogout}
              title="Abmelden"
              aria-label="Abmelden"
            >
              <LogOut size={18} />
            </button>
          </div>
        </header>
        <div className="page-content">{children}</div>
      </div>
    </div>
  );
}
