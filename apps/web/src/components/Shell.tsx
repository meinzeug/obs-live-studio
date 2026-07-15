import React, { useEffect, useRef, useState } from 'react';
import {
  Activity,
  BellRing,
  BookOpenText,
  ChevronDown,
  ChevronRight,
  Database,
  FileClock,
  Files,
  HeartPulse,
  Image,
  LogOut,
  MonitorUp,
  Radio,
  RadioTower,
  Rss,
  Settings,
  Users,
  type LucideIcon,
} from 'lucide-react';
import { Link, NavLink, useLocation } from 'react-router-dom';
import { api, can, type SessionUser, type StudioProfile } from '../api/client.js';
import { routes } from '../navigation.js';

type NavItem = { to: string; label: string; icon: LucideIcon; count?: number };

export function Shell({
  studio,
  user,
  onLogout,
  children,
}: {
  studio: StudioProfile;
  user: SessionUser;
  onLogout: () => void;
  children: React.ReactNode;
}) {
  const location = useLocation();
  const [unreadNotifications, setUnreadNotifications] = useState(0);
  const [profileMenuOpen, setProfileMenuOpen] = useState(false);
  const profileMenuRef = useRef<HTMLDivElement>(null);

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

  useEffect(() => {
    setProfileMenuOpen(false);
  }, [location.pathname]);

  useEffect(() => {
    if (!profileMenuOpen) return;
    function handlePointerDown(event: PointerEvent) {
      if (!profileMenuRef.current?.contains(event.target as Node)) setProfileMenuOpen(false);
    }
    function handleKeyDown(event: KeyboardEvent) {
      if (event.key === 'Escape') setProfileMenuOpen(false);
    }
    document.addEventListener('pointerdown', handlePointerDown);
    document.addEventListener('keydown', handleKeyDown);
    return () => {
      document.removeEventListener('pointerdown', handlePointerDown);
      document.removeEventListener('keydown', handleKeyDown);
    };
  }, [profileMenuOpen]);

  const studioLinks: NavItem[] = [
    { to: routes.dashboard, label: 'Dashboard', icon: Activity },
    { to: routes.sources, label: 'Quellen', icon: Rss },
    { to: routes.sourceHealth, label: 'Quellenmonitor', icon: HeartPulse },
    { to: routes.articles, label: 'Nachrichten', icon: BookOpenText },
    { to: routes.broadcast, label: 'Broadcast', icon: Radio },
    { to: routes.overlays, label: 'Overlays', icon: Files },
    { to: routes.media, label: 'Medien', icon: Image },
    { to: routes.obs, label: 'OBS', icon: MonitorUp },
    { to: routes.notifications, label: 'Störungen', icon: BellRing, count: unreadNotifications },
    { to: routes.settings, label: 'Einstellungen', icon: Settings },
  ];
  const adminLinks: NavItem[] = [
    { to: routes.adminUsers, label: 'Benutzer', icon: Users },
    { to: routes.adminAudit, label: 'Audit', icon: FileClock },
    { to: routes.adminSessions, label: 'Sitzungen', icon: Database },
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
            <strong>{studio.channelName}</strong>
            <span>{studio.studioName}</span>
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
            <span>{studio.channelName}</span>
            <ChevronRight size={15} aria-hidden="true" />
            <strong>{current?.label ?? 'Unbekannte Seite'}</strong>
          </div>
          <div className="topbar-meta">
            <span className="role-pill">{user.role}</span>
            <span className="topbar-email">{user.email}</span>
            <div className="profile-menu" ref={profileMenuRef}>
              <button
                className="profile-menu-trigger"
                onClick={() => setProfileMenuOpen((open) => !open)}
                aria-label="Profilmenü öffnen"
                aria-haspopup="menu"
                aria-expanded={profileMenuOpen}
              >
                <span className="user-avatar">{initials}</span>
                <span className="profile-menu-trigger-copy">
                  <strong>{user.display_name}</strong>
                  <small>Profil und Einstellungen</small>
                </span>
                <ChevronDown size={15} aria-hidden="true" />
              </button>
              {profileMenuOpen && (
                <div className="profile-menu-popover" role="menu">
                  <div className="profile-menu-header">
                    <span className="user-avatar">{initials}</span>
                    <span>
                      <strong>{user.display_name}</strong>
                      <small>{user.email}</small>
                    </span>
                  </div>
                  <Link to={routes.settings} role="menuitem">
                    <Settings size={17} />
                    <span>
                      <strong>Einstellungen</strong>
                      <small>Studio, Oberfläche und Konto</small>
                    </span>
                  </Link>
                  {can(user, 'users:write') && (
                    <Link to={routes.adminUsers} role="menuitem">
                      <Users size={17} />
                      <span>
                        <strong>Benutzerverwaltung</strong>
                        <small>Konten und Rollen</small>
                      </span>
                    </Link>
                  )}
                  <div className="profile-menu-separator" />
                  <button role="menuitem" onClick={onLogout}>
                    <LogOut size={17} />
                    <span>
                      <strong>Abmelden</strong>
                      <small>Aktuelle Sitzung beenden</small>
                    </span>
                  </button>
                </div>
              )}
            </div>
          </div>
        </header>
        <div className="page-content">{children}</div>
      </div>
    </div>
  );
}
