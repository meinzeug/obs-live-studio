import React, { useEffect, useMemo, useRef, useState } from 'react';
import {
  BellRing,
  ChevronDown,
  ChevronRight,
  CircleHelp,
  Command,
  LogOut,
  Menu,
  PanelLeftClose,
  PanelLeftOpen,
  Plus,
  RadioTower,
  RefreshCw,
  Search,
  Settings,
  Star,
  Users,
  X,
} from 'lucide-react';
import { Link, NavLink, useLocation, useNavigate } from 'react-router-dom';
import { can, type SessionUser, type StudioProfile } from '../api/client.js';
import { routes } from '../navigation.js';
import { useStudioStatus } from '../studio-status.js';
import { workspaceForPath, workspaces, type WorkspaceLink } from '../workspace-navigation.js';
import { CommandPalette, HelpDrawer, type QuickRoute } from './StudioOverlayPanels.js';
import { OnboardingWizard } from './OnboardingWizard.js';

const FAVORITES_KEY = 'open-tv-studio:favorites';
const RECENTS_KEY = 'open-tv-studio:recents';
const SIDEBAR_KEY = 'open-tv-studio:sidebar-collapsed';

function readStoredArray<T>(key: string): T[] {
  try {
    const parsed = JSON.parse(window.localStorage.getItem(key) ?? '[]');
    return Array.isArray(parsed) ? parsed : [];
  } catch {
    return [];
  }
}

function itemAllowed(item: WorkspaceLink, user: SessionUser) {
  return !item.permission || can(user, item.permission);
}

function pathMatches(pathname: string, target: string) {
  const clean = target.split('?', 1)[0];
  return pathname === clean || pathname.startsWith(`${clean}/`);
}

export function Shell({
  studio,
  user,
  onLogout,
  onStudioChange,
  children,
}: {
  studio: StudioProfile;
  user: SessionUser;
  onLogout: () => void;
  onStudioChange: (studio: StudioProfile) => void;
  children: React.ReactNode;
}) {
  const location = useLocation();
  const navigate = useNavigate();
  const { dashboard, error: statusError, refreshing, lastUpdated, refresh } = useStudioStatus();
  const [sidebarCollapsed, setSidebarCollapsed] = useState(() => window.localStorage.getItem(SIDEBAR_KEY) === 'true');
  const [mobileNavigationOpen, setMobileNavigationOpen] = useState(false);
  const [profileMenuOpen, setProfileMenuOpen] = useState(false);
  const [quickAccessOpen, setQuickAccessOpen] = useState(false);
  const [createMenuOpen, setCreateMenuOpen] = useState(false);
  const [commandOpen, setCommandOpen] = useState(false);
  const [helpOpen, setHelpOpen] = useState(false);
  const [setupOpen, setSetupOpen] = useState(false);
  const [favorites, setFavorites] = useState<string[]>(() => readStoredArray<string>(FAVORITES_KEY));
  const [recents, setRecents] = useState<QuickRoute[]>(() => readStoredArray<QuickRoute>(RECENTS_KEY));
  const [clock, setClock] = useState(new Date());
  const profileMenuRef = useRef<HTMLDivElement>(null);
  const quickAccessRef = useRef<HTMLDivElement>(null);
  const createMenuRef = useRef<HTMLDivElement>(null);
  const shortcutPrefix = useRef('');
  const shortcutTimer = useRef<number | null>(null);
  const currentWorkspace = workspaceForPath(location.pathname);

  const currentItem = useMemo(() => {
    const child = currentWorkspace.children.find((item) => pathMatches(location.pathname, item.to));
    return child ?? currentWorkspace;
  }, [currentWorkspace, location.pathname]);

  const initials = user.display_name
    .split(/\s+/)
    .map((part) => part[0])
    .join('')
    .slice(0, 2)
    .toUpperCase();
  const streamLive = Boolean(dashboard?.stream?.outputActive);
  const obsConnected = dashboard?.obs?.status === 'connected';
  const autopilotEnabled = Boolean(dashboard?.automation?.enabled);

  useEffect(() => {
    setProfileMenuOpen(false);
    setQuickAccessOpen(false);
    setCreateMenuOpen(false);
    setMobileNavigationOpen(false);
    const next: QuickRoute = {
      to: location.pathname + location.search,
      label: currentItem.label,
      visitedAt: new Date().toISOString(),
    };
    setRecents((current) => {
      const updated = [next, ...current.filter((item) => item.to.split('?', 1)[0] !== location.pathname)].slice(0, 8);
      window.localStorage.setItem(RECENTS_KEY, JSON.stringify(updated));
      return updated;
    });
  }, [currentItem.label, location.pathname, location.search]);

  useEffect(() => {
    const timer = window.setInterval(() => setClock(new Date()), 1_000);
    return () => window.clearInterval(timer);
  }, []);

  useEffect(() => {
    function closeMenus(event: PointerEvent) {
      const target = event.target as Node;
      if (!profileMenuRef.current?.contains(target)) setProfileMenuOpen(false);
      if (!quickAccessRef.current?.contains(target)) setQuickAccessOpen(false);
      if (!createMenuRef.current?.contains(target)) setCreateMenuOpen(false);
    }
    document.addEventListener('pointerdown', closeMenus);
    return () => document.removeEventListener('pointerdown', closeMenus);
  }, []);

  useEffect(() => {
    function handleKeyDown(event: KeyboardEvent) {
      const target = event.target as HTMLElement | null;
      const typing = target?.matches('input, textarea, select, [contenteditable="true"]');
      if ((event.ctrlKey || event.metaKey) && event.key.toLocaleLowerCase() === 'k') {
        event.preventDefault();
        setCommandOpen(true);
        return;
      }
      if (event.key === 'Escape') {
        setCommandOpen(false);
        setHelpOpen(false);
        return;
      }
      if (typing) return;
      if (event.key === '?') {
        event.preventDefault();
        setHelpOpen(true);
        return;
      }
      const key = event.key.toLocaleLowerCase('de');
      if (shortcutPrefix.current === 'g') {
        shortcutPrefix.current = '';
        if (shortcutTimer.current) window.clearTimeout(shortcutTimer.current);
        if (key === 'ü' || key === 'u') navigate(routes.overview);
        if (key === 'r') navigate(routes.live);
        if (key === 'n') navigate(routes.newsroom);
        return;
      }
      if (key === 'g') {
        shortcutPrefix.current = 'g';
        shortcutTimer.current = window.setTimeout(() => (shortcutPrefix.current = ''), 900);
      }
    }
    document.addEventListener('keydown', handleKeyDown);
    return () => document.removeEventListener('keydown', handleKeyDown);
  }, [navigate]);

  function toggleSidebar() {
    setSidebarCollapsed((current) => {
      window.localStorage.setItem(SIDEBAR_KEY, String(!current));
      return !current;
    });
  }

  function toggleFavorite(path = location.pathname) {
    setFavorites((current) => {
      const next = current.includes(path) ? current.filter((item) => item !== path) : [...current, path];
      window.localStorage.setItem(FAVORITES_KEY, JSON.stringify(next));
      return next;
    });
  }

  function navLink(item: WorkspaceLink, isMain = false) {
    const Icon = item.icon;
    return (
      <NavLink
        key={item.id}
        to={item.to}
        title={sidebarCollapsed ? `${item.label} – ${item.description}` : undefined}
        className={() => (pathMatches(location.pathname, item.to) ? 'active' : '')}
        onContextMenu={(event) => {
          event.preventDefault();
          toggleFavorite(item.to.split('?', 1)[0]);
        }}
      >
        <span className={`studio-nav-icon ${isMain ? `accent-${'accent' in item ? item.accent : 'slate'}` : ''}`}>
          <Icon size={isMain ? 19 : 17} />
        </span>
        <span className="studio-nav-copy">
          <strong>{item.label}</strong>
          {isMain && <small>{item.description}</small>}
        </span>
        {favorites.includes(item.to.split('?', 1)[0]) && (
          <Star size={11} className="nav-favorite" fill="currentColor" />
        )}
        {item.id === 'system' && (dashboard?.notifications?.unreadCount ?? 0) > 0 && (
          <span className="nav-count">{dashboard!.notifications.unreadCount}</span>
        )}
      </NavLink>
    );
  }

  const intelligenceIds = new Set(['ai', 'sendegott', 'automation', 'analytics']);
  const intelligence = workspaces.filter((workspace) => intelligenceIds.has(workspace.id));
  const systemWorkspace = workspaces.filter((workspace) => workspace.id === 'system');
  const operations = workspaces.filter((workspace) => !intelligenceIds.has(workspace.id) && workspace.id !== 'system');
  const quickItems = [
    ...favorites
      .map((path) => workspaces.flatMap((item) => [item, ...item.children]).find((item) => item.to === path))
      .filter((item): item is WorkspaceLink => Boolean(item)),
    ...recents
      .map((recent) =>
        workspaces.flatMap((item) => [item, ...item.children]).find((item) => item.to === recent.to.split('?', 1)[0]),
      )
      .filter((item): item is WorkspaceLink => Boolean(item)),
  ];
  const uniqueQuickItems = [...new Map(quickItems.map((item) => [item.to, item])).values()].slice(0, 7);

  return (
    <div
      className={`studio-shell ${sidebarCollapsed ? 'sidebar-collapsed' : ''} ${mobileNavigationOpen ? 'mobile-nav-open' : ''}`}
    >
      {mobileNavigationOpen && (
        <button
          className="mobile-nav-scrim"
          aria-label="Navigation schließen"
          onClick={() => setMobileNavigationOpen(false)}
        />
      )}
      <aside className="studio-sidebar">
        <div className="studio-brand-row">
          <Link className="studio-brand" to={routes.overview} aria-label={`${studio.channelName} – Übersicht`}>
            <span className="studio-brand-mark">
              {studio.logoUrl ? <img src={studio.logoUrl} alt="" /> : <RadioTower size={22} />}
            </span>
            <span>
              <strong>{studio.channelName}</strong>
              <small>Open TV Studio</small>
            </span>
          </Link>
          <button
            className="sidebar-collapse"
            onClick={toggleSidebar}
            aria-label={sidebarCollapsed ? 'Navigation ausklappen' : 'Navigation einklappen'}
          >
            {sidebarCollapsed ? <PanelLeftOpen size={17} /> : <PanelLeftClose size={17} />}
          </button>
          <button
            className="mobile-nav-close"
            onClick={() => setMobileNavigationOpen(false)}
            aria-label="Navigation schließen"
          >
            <X size={18} />
          </button>
        </div>

        <div className="sidebar-create" ref={createMenuRef}>
          <button className="sidebar-create-button" onClick={() => setCreateMenuOpen((value) => !value)}>
            <Plus size={18} />
            <span>Neu erstellen</span>
            <ChevronDown size={14} />
          </button>
          {createMenuOpen && (
            <div className="sidebar-create-menu">
              <Link to={`${routes.broadcast}?create=true`}>
                <Plus size={17} />
                <span>
                  <strong>Sendung</strong>
                  <small>Manuell oder mit KI planen</small>
                </span>
              </Link>
              <Link to={`${routes.sources}?create=true`}>
                <RadioTower size={17} />
                <span>
                  <strong>Quelle</strong>
                  <small>Feed, Webseite oder Kanal</small>
                </span>
              </Link>
              <Link to={`${routes.overlays}?create=true`}>
                <Plus size={17} />
                <span>
                  <strong>Overlay</strong>
                  <small>Designprojekt anlegen</small>
                </span>
              </Link>
            </div>
          )}
        </div>

        <nav className="studio-navigation" aria-label="Studio-Arbeitsbereiche">
          <div className="studio-nav-group">
            <p>Produktion</p>
            {operations.map((item) => navLink(item, true))}
          </div>
          <div className="studio-nav-group">
            <p>Intelligenz</p>
            {intelligence.map((item) => navLink(item, true))}
          </div>
          <div className="studio-nav-group">
            <p>Verwaltung</p>
            {systemWorkspace.map((item) => navLink(item, true))}
          </div>
        </nav>

        <div className="sidebar-system-state">
          <span className={`system-orb ${statusError ? 'error' : obsConnected ? 'online' : 'warning'}`} />
          <span>
            <strong>{statusError ? 'Verbindung gestört' : obsConnected ? 'Studio bereit' : 'OBS getrennt'}</strong>
            <small>
              {lastUpdated
                ? `Aktualisiert ${lastUpdated.toLocaleTimeString('de-DE', { hour: '2-digit', minute: '2-digit' })}`
                : 'Status wird geladen'}
            </small>
          </span>
        </div>
      </aside>

      <div className="studio-workspace">
        <header className="studio-topbar">
          <button
            className="mobile-menu-button"
            onClick={() => setMobileNavigationOpen(true)}
            aria-label="Navigation öffnen"
          >
            <Menu size={20} />
          </button>
          <div className="studio-breadcrumb">
            <span>{currentWorkspace.label}</span>
            <ChevronRight size={14} />
            <strong>{currentItem.label}</strong>
          </div>
          <div className="studio-top-status" aria-label="Studiostatus">
            <Link to={routes.obs} className={obsConnected ? 'is-good' : 'is-warning'}>
              <i />
              OBS {obsConnected ? 'verbunden' : 'getrennt'}
            </Link>
            <Link to={routes.automation} className={autopilotEnabled ? 'is-good' : ''}>
              <i />
              Autopilot {autopilotEnabled ? 'aktiv' : 'aus'}
            </Link>
            <Link to={routes.live} className={streamLive ? 'is-live' : ''}>
              <i />
              {streamLive ? 'LIVE' : 'OFF AIR'}
            </Link>
            <Link
              to={routes.sendegott}
              className={
                (dashboard?.governance?.failed_decisions ?? 0) > 0
                  ? 'is-warning'
                  : (dashboard?.governance?.open_decisions ?? 0) > 0
                    ? 'is-governance'
                    : 'is-good'
              }
              title="CEO-Lagebild und KI-Sendergremium"
            >
              <i />
              Gremium {dashboard?.governance?.open_decisions ?? 0}
            </Link>
          </div>
          <div className="studio-top-actions">
            <button className="global-search-button" onClick={() => setCommandOpen(true)}>
              <Search size={17} />
              <span>Studio durchsuchen</span>
              <kbd>
                <Command size={11} />K
              </kbd>
            </button>
            <button
              className="topbar-icon"
              onClick={() => void refresh()}
              title="Status aktualisieren"
              aria-label="Status aktualisieren"
            >
              <RefreshCw size={17} className={refreshing ? 'spin' : ''} />
            </button>
            <button
              className={`topbar-icon ${favorites.includes(location.pathname) ? 'is-active' : ''}`}
              onClick={() => toggleFavorite()}
              title="Seite als Favorit markieren"
              aria-label="Favorit umschalten"
            >
              <Star size={17} fill={favorites.includes(location.pathname) ? 'currentColor' : 'none'} />
            </button>
            <div className="quick-access" ref={quickAccessRef}>
              <button
                className="topbar-icon"
                onClick={() => setQuickAccessOpen((value) => !value)}
                aria-label="Favoriten und zuletzt benutzt"
              >
                <ChevronDown size={17} />
              </button>
              {quickAccessOpen && (
                <div className="quick-access-popover">
                  <header>
                    <div>
                      <p className="eyebrow">Schnellzugriff</p>
                      <strong>Favoriten & Verlauf</strong>
                    </div>
                    <button className="icon-button ghost-button" onClick={() => setQuickAccessOpen(false)}>
                      <X size={15} />
                    </button>
                  </header>
                  {uniqueQuickItems.map((item) => {
                    const Icon = item.icon;
                    return (
                      <Link key={item.to} to={item.to}>
                        <Icon size={17} />
                        <span>
                          <strong>{item.label}</strong>
                          <small>{favorites.includes(item.to) ? 'Favorit' : 'Zuletzt benutzt'}</small>
                        </span>
                        <ChevronRight size={14} />
                      </Link>
                    );
                  })}
                  {uniqueQuickItems.length === 0 && <p>Noch keine Favoriten oder zuletzt besuchten Seiten.</p>}
                </div>
              )}
            </div>
            <Link className="topbar-icon notification-button" to={routes.notifications} aria-label="Störungen">
              <BellRing size={17} />
              {(dashboard?.notifications?.unreadCount ?? 0) > 0 && (
                <span>{dashboard!.notifications.unreadCount > 99 ? '99+' : dashboard!.notifications.unreadCount}</span>
              )}
            </Link>
            <button className="topbar-icon" onClick={() => setHelpOpen(true)} aria-label="Hilfe öffnen">
              <CircleHelp size={18} />
            </button>
            <div className="profile-menu" ref={profileMenuRef}>
              <button
                className="studio-profile-trigger"
                onClick={() => setProfileMenuOpen((value) => !value)}
                aria-label="Profilmenü öffnen"
                aria-haspopup="menu"
                aria-expanded={profileMenuOpen}
              >
                <span className="user-avatar">{initials}</span>
                <span>
                  <strong>{user.display_name}</strong>
                  <small>{user.role}</small>
                </span>
                <ChevronDown size={14} />
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
                  <button
                    role="menuitem"
                    onClick={() => {
                      setSetupOpen(true);
                      setProfileMenuOpen(false);
                    }}
                  >
                    <Plus size={17} />
                    <span>
                      <strong>Einrichtungsassistent</strong>
                      <small>Studio Schritt für Schritt prüfen</small>
                    </span>
                  </button>
                  <Link to={routes.system} role="menuitem">
                    <Settings size={17} />
                    <span>
                      <strong>System</strong>
                      <small>Konfiguration und Wartung</small>
                    </span>
                  </Link>
                  <Link to={routes.settings} role="menuitem">
                    <Settings size={17} />
                    <span>
                      <strong>Einstellungen</strong>
                      <small>Sender und Ausgabe</small>
                    </span>
                  </Link>
                  {can(user, 'users:write') && (
                    <Link to={routes.adminUsers} role="menuitem">
                      <Users size={17} />
                      <span>
                        <strong>Benutzer</strong>
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

        <div className="workspace-contextbar">
          <div className="context-tabs">
            {(currentWorkspace.children.length ? currentWorkspace.children : [currentWorkspace])
              .filter((item) => itemAllowed(item, user))
              .map((item) => {
                const Icon = item.icon;
                return (
                  <NavLink
                    key={item.id}
                    to={item.to}
                    className={() => (pathMatches(location.pathname, item.to) ? 'active' : '')}
                  >
                    <Icon size={15} />
                    <span>{item.label}</span>
                  </NavLink>
                );
              })}
          </div>
          <div className="studio-clock">
            <span>{clock.toLocaleDateString('de-DE', { weekday: 'short', day: '2-digit', month: '2-digit' })}</span>
            <strong>
              {clock.toLocaleTimeString('de-DE', { hour: '2-digit', minute: '2-digit', second: '2-digit' })}
            </strong>
          </div>
        </div>

        <main className="studio-page-content">{children}</main>
      </div>

      <CommandPalette
        open={commandOpen}
        user={user}
        favorites={favorites}
        recents={recents}
        onClose={() => setCommandOpen(false)}
      />
      <HelpDrawer open={helpOpen} workspace={currentWorkspace} onClose={() => setHelpOpen(false)} />
      <OnboardingWizard
        open={setupOpen}
        user={user}
        studio={studio}
        onOpenChange={setSetupOpen}
        onStudioChange={onStudioChange}
      />
    </div>
  );
}
