import React, { useEffect, useMemo, useState } from 'react';
import {
  Activity,
  BellRing,
  BookOpenText,
  ChevronRight,
  Database,
  Eye,
  FileClock,
  Files,
  HeartPulse,
  HardDrive,
  Image,
  MonitorUp,
  Radio,
  RotateCw,
  Rss,
  Save,
  Search,
  Settings2,
  ShieldCheck,
  SlidersHorizontal,
  Users,
  type LucideIcon,
} from 'lucide-react';
import { Link } from 'react-router-dom';
import { api, can, type SessionUser, type StudioProfile } from '../api/client.js';
import { routes } from '../navigation.js';
import { readInterfacePreferences, saveInterfacePreferences, type InterfacePreferences } from '../preferences.js';

type AutopilotSettings = {
  enabled: boolean;
  minimumTrust: number;
  requireStream: boolean;
  sourceIds?: string[];
  scanLimit?: number;
};

type BackupOverview = {
  health: {
    ready: boolean;
    status: 'ready' | 'warning' | 'error';
    backup: {
      present: boolean;
      name: string | null;
      createdAt: string | null;
      ageHours: number | null;
      stale: boolean | null;
      databaseIncluded: boolean | null;
      secure: boolean | null;
    };
    rehearsal: {
      present: boolean;
      ok: boolean | null;
      completedAt: string | null;
      stale: boolean | null;
    };
    checks: Array<{ id: string; status: 'ok' | 'warning' | 'error'; message: string }>;
  };
  job: {
    id: string;
    status: 'running' | 'completed' | 'failed';
    startedAt: string;
    completedAt: string | null;
    error: string | null;
  } | null;
};

type SettingsLink = {
  to: string;
  title: string;
  description: string;
  icon: LucideIcon;
  keywords: string;
};

type SettingsGroup = {
  title: string;
  description: string;
  links: SettingsLink[];
};

export function SettingsPage({ user, studio }: { user: SessionUser; studio: StudioProfile }) {
  const [preferences, setPreferences] = useState<InterfacePreferences>(() => readInterfacePreferences());
  const [autopilot, setAutopilot] = useState<AutopilotSettings>();
  const [autopilotLoading, setAutopilotLoading] = useState(true);
  const [autopilotError, setAutopilotError] = useState('');
  const [backups, setBackups] = useState<BackupOverview>();
  const [backupError, setBackupError] = useState('');
  const [query, setQuery] = useState('');
  const [message, setMessage] = useState('');
  const [working, setWorking] = useState(false);
  const automationAllowed = can(user, 'broadcast:write');
  const hasAdminAccess = can(user, 'users:write');

  async function loadAutopilot() {
    setAutopilotLoading(true);
    setAutopilotError('');
    try {
      setAutopilot(await api<AutopilotSettings>('/api/autopilot'));
    } catch (error) {
      setAutopilotError(error instanceof Error ? error.message : String(error));
    } finally {
      setAutopilotLoading(false);
    }
  }

  async function loadBackups() {
    if (!hasAdminAccess) return;
    try {
      setBackups(await api<BackupOverview>('/api/admin/backups'));
      setBackupError('');
    } catch (error) {
      setBackupError(error instanceof Error ? error.message : String(error));
    }
  }

  useEffect(() => {
    void loadAutopilot();
  }, []);

  useEffect(() => {
    void loadBackups();
  }, [hasAdminAccess]);

  useEffect(() => {
    if (backups?.job?.status !== 'running') return;
    const timer = window.setInterval(() => void loadBackups(), 2000);
    return () => window.clearInterval(timer);
  }, [backups?.job?.status]);

  function updatePreferences(patch: Partial<InterfacePreferences>) {
    setPreferences((current) => saveInterfacePreferences({ ...current, ...patch }));
    setMessage('Darstellung für diesen Browser gespeichert.');
  }

  async function saveAutopilot() {
    if (!autopilot || !automationAllowed || working) return;
    setWorking(true);
    try {
      const saved = await api<AutopilotSettings>('/api/autopilot', {
        method: 'POST',
        body: JSON.stringify(autopilot),
      });
      setAutopilot(saved);
      setMessage('Autopilot-Einstellungen gespeichert.');
    } catch (error) {
      setMessage(error instanceof Error ? error.message : String(error));
    } finally {
      setWorking(false);
    }
  }

  async function createBackup() {
    if (!hasAdminAccess || backups?.job?.status === 'running') return;
    setBackupError('');
    try {
      const result = await api<{ job: BackupOverview['job'] }>('/api/admin/backups', { method: 'POST' });
      setBackups((current) => (current ? { ...current, job: result.job } : current));
      setMessage('Backup-Erstellung wurde gestartet.');
      await loadBackups();
    } catch (error) {
      setBackupError(error instanceof Error ? error.message : String(error));
    }
  }

  const groups = useMemo<SettingsGroup[]>(() => {
    const result: SettingsGroup[] = [
      {
        title: 'Studio und Ausgabe',
        description: 'Sendebetrieb, Gestaltung und technische Ausgabe.',
        links: [
          {
            to: routes.obs,
            title: 'OBS und Streaming-Ziele',
            description: 'OBS-Verbindung, Szenen, Hauptziel und zusätzliche Livestream-Ziele.',
            icon: MonitorUp,
            keywords: 'obs stream streaming ziel youtube twitch ausgabe szenen',
          },
          {
            to: routes.broadcast,
            title: 'Broadcast und Sendelisten',
            description: 'Sendelisten, Ablaufsteuerung und laufende Ausgaben verwalten.',
            icon: Radio,
            keywords: 'broadcast sendeliste automation ablauf live',
          },
          {
            to: routes.overlays,
            title: 'Overlays und Szenendesign',
            description: 'Einblendungen gestalten und als OBS-Browserquelle verbinden.',
            icon: Files,
            keywords: 'overlay design szene browserquelle grafik',
          },
          {
            to: routes.media,
            title: 'Medienbibliothek',
            description: 'Bilder und andere Medien für Beiträge und Overlays verwalten.',
            icon: Image,
            keywords: 'medien bilder upload bibliothek assets',
          },
        ],
      },
      {
        title: 'Redaktion und Betrieb',
        description: 'Quellen, Meldungen und technische Hinweise.',
        links: [
          {
            to: routes.sources,
            title: 'Nachrichtenquellen',
            description: 'Feeds anlegen, bearbeiten, aktivieren und synchronisieren.',
            icon: Rss,
            keywords: 'quelle feed rss redaktion synchronisieren',
          },
          {
            to: routes.sourceHealth,
            title: 'Quellenmonitor',
            description: 'Fehler, Abrufstatus und Zustand aller Quellen kontrollieren.',
            icon: HeartPulse,
            keywords: 'monitor fehler gesundheit abruf status quelle',
          },
          {
            to: routes.articles,
            title: 'Nachrichten-Workflow',
            description: 'Artikel prüfen, freigeben, planen oder verwerfen.',
            icon: BookOpenText,
            keywords: 'nachrichten artikel workflow freigabe planung',
          },
          {
            to: routes.notifications,
            title: 'Störungen und Hinweise',
            description: 'Offene Betriebsstörungen ansehen und quittieren.',
            icon: BellRing,
            keywords: 'störung benachrichtigung hinweis alarm quittieren',
          },
        ],
      },
    ];

    if (hasAdminAccess) {
      result.push({
        title: 'Administration und Sicherheit',
        description: 'Konten, Zugriffe und nachvollziehbare Systemaktivitäten.',
        links: [
          {
            to: routes.adminUsers,
            title: 'Benutzer und Rollen',
            description: 'Konten, Rollen, Passwörter und Zugriffsstatus verwalten.',
            icon: Users,
            keywords: 'benutzer rollen passwort konto rechte admin',
          },
          {
            to: routes.adminSessions,
            title: 'Aktive Sitzungen',
            description: 'Anmeldungen kontrollieren und Sitzungen widerrufen.',
            icon: Database,
            keywords: 'sitzung login anmeldung widerrufen sicherheit',
          },
          {
            to: routes.adminAudit,
            title: 'Audit-Protokoll',
            description: 'Administrative und redaktionelle Änderungen nachvollziehen.',
            icon: FileClock,
            keywords: 'audit protokoll änderung sicherheit historie',
          },
        ],
      });
    }

    return result;
  }, [hasAdminAccess]);

  const normalizedQuery = query.trim().toLocaleLowerCase('de');
  const visibleGroups = groups
    .map((group) => ({
      ...group,
      links: group.links.filter((link) =>
        `${group.title} ${link.title} ${link.description} ${link.keywords}`
          .toLocaleLowerCase('de')
          .includes(normalizedQuery),
      ),
    }))
    .filter((group) => group.links.length > 0);

  return (
    <section className="panel settings-page">
      <div className="page-title">
        <div>
          <p className="eyebrow">Zentrale Verwaltung</p>
          <h2>Einstellungen</h2>
          <p>Studio, Oberfläche, Automation, redaktionelle Module und Zugriffe an einer Stelle verwalten.</p>
        </div>
        <span className="settings-title-icon" aria-hidden="true">
          <Settings2 size={21} />
        </span>
      </div>

      <div className="settings-profile-banner">
        <span className="settings-channel-mark" aria-hidden="true">
          <Radio size={20} />
        </span>
        <div>
          <span>Aktuelles Studio</span>
          <strong>{studio.channelName}</strong>
          <small>
            {studio.studioName} · Hauptziel: {studio.primary.name}
          </small>
        </div>
        <span className={`state-pill ${studio.primary.configured ? 'success' : 'warning'}`}>
          {studio.primary.configured ? 'Ausgabe konfiguriert' : 'Ausgabe unvollständig'}
        </span>
      </div>

      <section className="settings-section" aria-labelledby="interface-settings-title">
        <div className="settings-section-header">
          <div>
            <p className="eyebrow">Dieser Browser</p>
            <h3 id="interface-settings-title">Oberfläche</h3>
            <p>Die Darstellung wird lokal gespeichert und verändert keine Studio-Daten.</p>
          </div>
          <SlidersHorizontal size={19} aria-hidden="true" />
        </div>
        <div className="settings-option-grid">
          <label className="settings-option">
            <span>Dichte</span>
            <small>Abstände und Höhe der Navigation.</small>
            <select
              value={preferences.density}
              onChange={(event) =>
                updatePreferences({ density: event.target.value === 'compact' ? 'compact' : 'comfortable' })
              }
            >
              <option value="comfortable">Komfortabel</option>
              <option value="compact">Kompakt</option>
            </select>
          </label>
          <label className="settings-option">
            <span>Kontrast</span>
            <small>Lesbarkeit von Texten und Trennlinien.</small>
            <select
              value={preferences.contrast}
              onChange={(event) => updatePreferences({ contrast: event.target.value === 'high' ? 'high' : 'standard' })}
            >
              <option value="standard">Standard</option>
              <option value="high">Hoch</option>
            </select>
          </label>
          <label className="settings-option settings-toggle-option">
            <span>Bewegung reduzieren</span>
            <small>Animationen und Übergänge minimieren.</small>
            <span className="toggle-row">
              <input
                type="checkbox"
                checked={preferences.reduceMotion}
                onChange={(event) => updatePreferences({ reduceMotion: event.target.checked })}
              />
              Reduzierte Animationen
            </span>
          </label>
        </div>
      </section>

      <section className="settings-section" aria-labelledby="automation-settings-title">
        <div className="settings-section-header">
          <div>
            <p className="eyebrow">Sendesteuerung</p>
            <h3 id="automation-settings-title">Autopilot</h3>
            <p>Die zentralen Regeln für automatisch gestartete Beiträge.</p>
          </div>
          <Activity size={19} aria-hidden="true" />
        </div>
        {autopilot ? (
          <div className="settings-automation-grid">
            <label className="settings-option settings-toggle-option">
              <span>Automatische Sendung</span>
              <small>Geeignete Beiträge automatisch in den Ablauf übernehmen.</small>
              <span className="toggle-row">
                <input
                  type="checkbox"
                  disabled={!automationAllowed || working}
                  checked={autopilot.enabled}
                  onChange={(event) => setAutopilot({ ...autopilot, enabled: event.target.checked })}
                />
                Autopilot aktiv
              </span>
            </label>
            <label className="settings-option">
              <span>Mindestvertrauen</span>
              <small>Nur Beiträge ab diesem Prüfwert verwenden.</small>
              <input
                type="number"
                min="0"
                max="100"
                disabled={!automationAllowed || working}
                value={autopilot.minimumTrust}
                onChange={(event) => setAutopilot({ ...autopilot, minimumTrust: Number(event.target.value) })}
              />
            </label>
            <label className="settings-option settings-toggle-option">
              <span>Stream-Bedingung</span>
              <small>Automatik nur bei bereits aktiver Ausgabe ausführen.</small>
              <span className="toggle-row">
                <input
                  type="checkbox"
                  disabled={!automationAllowed || working}
                  checked={autopilot.requireStream}
                  onChange={(event) => setAutopilot({ ...autopilot, requireStream: event.target.checked })}
                />
                Aktiven Livestream verlangen
              </span>
            </label>
            <button
              className="primary-button settings-save-button"
              disabled={!automationAllowed || working}
              onClick={() => void saveAutopilot()}
            >
              <Save size={17} /> {working ? 'Wird gespeichert …' : 'Autopilot speichern'}
            </button>
          </div>
        ) : autopilotLoading ? (
          <p className="muted">Autopilot-Einstellungen werden geladen …</p>
        ) : (
          <div className="settings-load-error" role="alert">
            <div>
              <strong>Autopilot konnte nicht geladen werden.</strong>
              <span>{autopilotError || 'Die API hat keine Einstellungen zurückgegeben.'}</span>
            </div>
            <button className="ghost-button" onClick={() => void loadAutopilot()}>
              <RotateCw size={16} /> Erneut versuchen
            </button>
          </div>
        )}
        {!automationAllowed && (
          <p className="settings-permission-note">Für Änderungen fehlt die Berechtigung „broadcast:write“.</p>
        )}
      </section>

      {hasAdminAccess && (
        <section className="settings-section" aria-labelledby="backup-settings-title">
          <div className="settings-section-header">
            <div>
              <p className="eyebrow">Datensicherheit</p>
              <h3 id="backup-settings-title">Backups und Wiederherstellung</h3>
              <p>Verifizierte Studio-Sicherung erstellen und den letzten Wiederherstellungstest kontrollieren.</p>
            </div>
            <HardDrive size={19} aria-hidden="true" />
          </div>
          {backups ? (
            <div className="settings-automation-grid">
              <div className="settings-option">
                <span>Letztes Backup</span>
                <small>
                  {backups.health.backup.createdAt
                    ? new Date(backups.health.backup.createdAt).toLocaleString('de-DE')
                    : 'Noch kein vollständiges Backup vorhanden'}
                </small>
                <strong>{backups.health.backup.name ?? 'Nicht vorhanden'}</strong>
              </div>
              <div className="settings-option">
                <span>Prüfstatus</span>
                <small>
                  Datenbank: {backups.health.backup.databaseIncluded ? 'enthalten' : 'nicht enthalten'} · Rechte:{' '}
                  {backups.health.backup.secure ? 'sicher' : 'prüfen'}
                </small>
                <strong>
                  {backups.health.ready ? 'Bereit' : backups.health.status === 'warning' ? 'Warnung' : 'Fehler'}
                </strong>
              </div>
              <div className="settings-option">
                <span>Wiederherstellungsprobe</span>
                <small>
                  {backups.health.rehearsal.completedAt
                    ? new Date(backups.health.rehearsal.completedAt).toLocaleString('de-DE')
                    : 'Noch keine Probe protokolliert'}
                </small>
                <strong>{backups.health.rehearsal.ok ? 'Erfolgreich' : 'Ausstehend oder fehlgeschlagen'}</strong>
              </div>
              <button
                className="primary-button settings-save-button"
                disabled={backups.job?.status === 'running'}
                onClick={() => void createBackup()}
              >
                {backups.job?.status === 'running' ? <RotateCw size={17} /> : <ShieldCheck size={17} />}
                {backups.job?.status === 'running' ? 'Backup wird erstellt …' : 'Backup jetzt erstellen'}
              </button>
            </div>
          ) : backupError ? (
            <div className="settings-load-error" role="alert">
              <div>
                <strong>Backup-Status konnte nicht geladen werden.</strong>
                <span>{backupError}</span>
              </div>
              <button className="ghost-button" onClick={() => void loadBackups()}>
                <RotateCw size={16} /> Erneut versuchen
              </button>
            </div>
          ) : (
            <p className="muted">Backup-Status wird geladen …</p>
          )}
          {backups?.job?.status === 'failed' && <p className="settings-permission-note">{backups.job.error}</p>}
          {backups && !backups.health.ready && (
            <div className="settings-permission-note">
              {backups.health.checks
                .filter((check) => check.status !== 'ok')
                .map((check) => check.message)
                .join(' ')}
            </div>
          )}
        </section>
      )}

      <section className="settings-directory" aria-labelledby="all-settings-title">
        <div className="settings-directory-heading">
          <div>
            <p className="eyebrow">Alle Bereiche</p>
            <h3 id="all-settings-title">Konfiguration und Verwaltung</h3>
          </div>
          <label className="settings-search">
            <Search size={16} aria-hidden="true" />
            <span className="visually-hidden">Einstellungen durchsuchen</span>
            <input
              type="search"
              value={query}
              placeholder="Einstellungen durchsuchen …"
              onChange={(event) => setQuery(event.target.value)}
            />
          </label>
        </div>

        {visibleGroups.map((group) => (
          <div className="settings-group" key={group.title}>
            <div className="settings-group-heading">
              <strong>{group.title}</strong>
              <span>{group.description}</span>
            </div>
            <div className="settings-link-grid">
              {group.links.map(({ to, title, description, icon: Icon }) => (
                <Link className="settings-link-card" to={to} key={to}>
                  <span className="settings-link-icon" aria-hidden="true">
                    <Icon size={18} />
                  </span>
                  <span>
                    <strong>{title}</strong>
                    <small>{description}</small>
                  </span>
                  <ChevronRight size={17} aria-hidden="true" />
                </Link>
              ))}
            </div>
          </div>
        ))}
        {visibleGroups.length === 0 && (
          <div className="empty-state">
            <div>
              <Eye size={22} />
              <p>Keine Einstellung passt zu „{query}“.</p>
            </div>
          </div>
        )}
      </section>

      <section className="settings-section settings-account" aria-labelledby="account-settings-title">
        <div className="settings-section-header">
          <div>
            <p className="eyebrow">Angemeldetes Konto</p>
            <h3 id="account-settings-title">Profil und Rechte</h3>
          </div>
          <Users size={19} aria-hidden="true" />
        </div>
        <dl className="settings-account-grid">
          <div>
            <dt>Anzeigename</dt>
            <dd>{user.display_name}</dd>
          </div>
          <div>
            <dt>E-Mail</dt>
            <dd>{user.email}</dd>
          </div>
          <div>
            <dt>Rolle</dt>
            <dd>{user.role}</dd>
          </div>
          <div>
            <dt>Berechtigungen</dt>
            <dd>{user.role === 'administrator' ? 'Vollzugriff' : `${user.permissions.length} zugewiesen`}</dd>
          </div>
        </dl>
      </section>

      {message && (
        <p className="settings-status" role="status">
          {message}
        </p>
      )}
    </section>
  );
}
