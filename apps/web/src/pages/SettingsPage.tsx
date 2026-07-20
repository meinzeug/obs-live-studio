import React, { useEffect, useMemo, useState } from 'react';
import {
  Activity,
  BellRing,
  BookOpenText,
  BrainCircuit,
  ChevronRight,
  Database,
  Eye,
  ExternalLink,
  FileClock,
  Files,
  HeartPulse,
  HardDrive,
  Image,
  KeyRound,
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
  Volume2,
  WandSparkles,
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
  requireVideo: boolean;
  showItemCount: number;
  pauseSeconds: number;
  pauseBetweenShowsSeconds: number;
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

type AiSettings = {
  provider: 'openrouter';
  configured: boolean;
  apiKeyHint: string;
  freeFirst: true;
  freeModel: string;
  paidFallback: boolean;
  autoProcessIngest: boolean;
  dataCollection: 'allow' | 'deny';
  taskPolicies: Array<{
    id: string;
    label: string;
    purpose: string;
    paidModels: string[];
    maxPromptPrice: number;
    maxCompletionPrice: number;
  }>;
};

type AiKeyCheck = {
  ok: true;
  key: {
    label: string;
    freeTier: boolean;
    limit: number | null;
    limitRemaining: number | null;
    usage: number | null;
    expiresAt: string | null;
  };
};

type TtsSettings = {
  presetId: string;
  selected: TtsPreset;
  presets: TtsPreset[];
  note: string;
  job: {
    id: string;
    presetId: string;
    status: 'idle' | 'running' | 'completed' | 'failed';
    step: string;
    message: string;
    startedAt: string;
    completedAt: string | null;
    error: string | null;
    log: string[];
  } | null;
};

type TtsPreset = {
  id: string;
  label: string;
  description: string;
  engine: 'piper' | 'espeak-ng' | 'qwen3-tts';
  voice: string;
  size: 'klein' | 'mittel' | 'hoch';
  audioReady: boolean;
  installHint: string;
  installed: boolean;
  checks: Record<string, boolean>;
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
  const [aiSettings, setAiSettings] = useState<AiSettings>();
  const [aiApiKey, setAiApiKey] = useState('');
  const [aiKeyCheck, setAiKeyCheck] = useState<AiKeyCheck>();
  const [aiError, setAiError] = useState('');
  const [ttsSettings, setTtsSettings] = useState<TtsSettings>();
  const [ttsPresetId, setTtsPresetId] = useState('');
  const [ttsError, setTtsError] = useState('');
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

  async function loadAiSettings() {
    if (!hasAdminAccess) return;
    try {
      setAiSettings(await api<AiSettings>('/api/ai/settings'));
      setAiError('');
    } catch (error) {
      setAiError(error instanceof Error ? error.message : String(error));
    }
  }

  async function loadTtsSettings() {
    if (!hasAdminAccess) return;
    try {
      const settings = await api<TtsSettings>('/api/tts/settings');
      setTtsSettings(settings);
      setTtsPresetId(settings.presetId);
      setTtsError('');
    } catch (error) {
      setTtsError(error instanceof Error ? error.message : String(error));
    }
  }

  useEffect(() => {
    void loadAutopilot();
  }, []);

  useEffect(() => {
    void loadBackups();
    void loadAiSettings();
    void loadTtsSettings();
  }, [hasAdminAccess]);

  useEffect(() => {
    if (backups?.job?.status !== 'running') return;
    const timer = window.setInterval(() => void loadBackups(), 2000);
    return () => window.clearInterval(timer);
  }, [backups?.job?.status]);

  useEffect(() => {
    if (ttsSettings?.job?.status !== 'running') return;
    const timer = window.setInterval(() => void loadTtsSettings(), 2000);
    return () => window.clearInterval(timer);
  }, [ttsSettings?.job?.status]);

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

  async function saveAiSettings(testAfterSave = false) {
    if (!hasAdminAccess || !aiSettings || working) return;
    setWorking(true);
    setAiError('');
    try {
      const saved = await api<AiSettings>('/api/ai/settings', {
        method: 'POST',
        body: JSON.stringify({
          apiKey: aiApiKey || undefined,
          paidFallback: aiSettings.paidFallback,
          autoProcessIngest: aiSettings.autoProcessIngest,
          dataCollection: aiSettings.dataCollection,
        }),
      });
      setAiSettings(saved);
      setAiApiKey('');
      setMessage('OpenRouter-Einstellungen gespeichert. Freie Modelle werden immer zuerst verwendet.');
      if (testAfterSave) {
        const checked = await api<AiKeyCheck>('/api/ai/settings/test', { method: 'POST' });
        setAiKeyCheck(checked);
        setMessage(`OpenRouter verbunden: ${checked.key.label}`);
      }
    } catch (error) {
      setAiError(error instanceof Error ? error.message : String(error));
    } finally {
      setWorking(false);
    }
  }

  async function saveTtsSettings() {
    if (!hasAdminAccess || working || !ttsPresetId) return;
    setWorking(true);
    setTtsError('');
    try {
      const saved = await api<TtsSettings>('/api/tts/settings', {
        method: 'POST',
        body: JSON.stringify({ presetId: ttsPresetId }),
      });
      setTtsSettings(saved);
      setTtsPresetId(saved.presetId);
      setMessage(
        saved.job?.status === 'running'
          ? 'TTS-Auswahl gespeichert. Installation wurde gestartet.'
          : 'TTS-Auswahl gespeichert.',
      );
    } catch (error) {
      setTtsError(error instanceof Error ? error.message : String(error));
    } finally {
      setWorking(false);
    }
  }

  async function installSelectedTts() {
    if (!hasAdminAccess || working) return;
    setWorking(true);
    setTtsError('');
    try {
      const saved = await api<TtsSettings>('/api/tts/settings/install', { method: 'POST' });
      setTtsSettings(saved);
      setTtsPresetId(saved.presetId);
      setMessage('TTS-Installation wurde gestartet.');
    } catch (error) {
      setTtsError(error instanceof Error ? error.message : String(error));
    } finally {
      setWorking(false);
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
          {
            to: routes.mediaSettings,
            title: 'Video- und Medienrecherche',
            description: 'Provider-Keys, automatische Videoauswahl und KI-Suchbegriffe konfigurieren.',
            icon: WandSparkles,
            keywords: 'video pexels pixabay youtube wikimedia openrouter medien recherche',
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
            <label className="settings-option settings-toggle-option">
              <span>Video-Bedingung</span>
              <small>Nur Beiträge mit geprüftem Video starten oder auch reine Nachrichtenbeiträge erlauben.</small>
              <span className="toggle-row">
                <input
                  type="checkbox"
                  disabled={!automationAllowed || working}
                  checked={autopilot.requireVideo}
                  onChange={(event) => setAutopilot({ ...autopilot, requireVideo: event.target.checked })}
                />
                Video vor Verarbeitung verlangen
              </span>
            </label>
            <label className="settings-option">
              <span>Beiträge pro Sendung</span>
              <small>Wie viele Beiträge der Autopilot in eine automatisch erzeugte Sendung packen soll.</small>
              <input
                type="number"
                min="1"
                max="20"
                disabled={!automationAllowed || working}
                value={autopilot.showItemCount}
                onChange={(event) => setAutopilot({ ...autopilot, showItemCount: Number(event.target.value) })}
              />
            </label>
            <label className="settings-option">
              <span>Pause zwischen Beiträgen</span>
              <small>Sekunden Regie-/Übergangszeit innerhalb automatischer Sendungen.</small>
              <input
                type="number"
                min="0"
                max="600"
                disabled={!automationAllowed || working}
                value={autopilot.pauseSeconds}
                onChange={(event) => setAutopilot({ ...autopilot, pauseSeconds: Number(event.target.value) })}
              />
            </label>
            <label className="settings-option">
              <span>Pause zwischen Sendungen</span>
              <small>Mindestens so viele Sekunden warten, bevor die nächste automatische Sendung startet.</small>
              <input
                type="number"
                min="0"
                max="3600"
                disabled={!automationAllowed || working}
                value={autopilot.pauseBetweenShowsSeconds}
                onChange={(event) =>
                  setAutopilot({ ...autopilot, pauseBetweenShowsSeconds: Number(event.target.value) })
                }
              />
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
        <section className="settings-section" aria-labelledby="tts-settings-title">
          <div className="settings-section-header">
            <div>
              <p className="eyebrow">Sprachausgabe</p>
              <h3 id="tts-settings-title">TTS</h3>
              <p>
                Engine und Stimme für Sprecher-Audio auswählen; fehlende lokale Modelle werden automatisch installiert.
              </p>
            </div>
            <Volume2 size={19} aria-hidden="true" />
          </div>
          {ttsSettings ? (
            <>
              <div className="settings-automation-grid tts-settings-grid">
                <label className="settings-option tts-preset-select">
                  <span>TTS-Preset</span>
                  <small>Gängige lokale Optionen: Piper, eSpeak NG und Qwen3-TTS in deutscher Konfiguration.</small>
                  <select
                    disabled={working || ttsSettings.job?.status === 'running'}
                    value={ttsPresetId}
                    onChange={(event) => setTtsPresetId(event.target.value)}
                  >
                    {ttsSettings.presets.map((preset) => (
                      <option key={preset.id} value={preset.id}>
                        {preset.label} · {preset.size}
                        {preset.installed ? ' · installiert' : ''}
                      </option>
                    ))}
                  </select>
                </label>
                {ttsSettings.presets
                  .filter((preset) => preset.id === ttsPresetId)
                  .map((preset) => (
                    <div className="settings-option" key={preset.id}>
                      <span>{preset.label}</span>
                      <small>{preset.description}</small>
                      <strong>
                        {preset.installed ? 'Installiert' : 'Fehlt'} · {preset.engine}
                        {preset.audioReady ? '' : ' · experimentell'}
                      </strong>
                      <small>{preset.installHint}</small>
                    </div>
                  ))}
                <div className="settings-option">
                  <span>Status</span>
                  <small>
                    {ttsSettings.job?.status === 'running'
                      ? ttsSettings.job.message
                      : ttsSettings.selected.installed
                        ? 'Ausgewähltes Preset ist einsatzbereit.'
                        : 'Ausgewähltes Preset ist noch nicht vollständig installiert.'}
                  </small>
                  <strong>
                    {ttsSettings.job?.status === 'running'
                      ? 'Installation läuft'
                      : ttsSettings.job?.status === 'failed'
                        ? 'Installation fehlgeschlagen'
                        : ttsSettings.selected.installed
                          ? 'Bereit'
                          : 'Installation nötig'}
                  </strong>
                </div>
                <button
                  className="primary-button settings-save-button"
                  disabled={working || ttsSettings.job?.status === 'running'}
                  onClick={() => void saveTtsSettings()}
                >
                  <Save size={17} /> {ttsSettings.job?.status === 'running' ? 'Installation läuft …' : 'TTS speichern'}
                </button>
              </div>
              <div className="toolbar settings-ai-actions">
                <button
                  disabled={working || ttsSettings.job?.status === 'running'}
                  onClick={() => void installSelectedTts()}
                >
                  <RotateCw size={16} /> Installation erneut starten
                </button>
              </div>
              {ttsSettings.job && (
                <div className={`tts-install-status ${ttsSettings.job.status}`} role="status">
                  <strong>{ttsSettings.job.message}</strong>
                  {ttsSettings.job.error && <span>{ttsSettings.job.error}</span>}
                  {ttsSettings.job.log.length > 0 && <code>{ttsSettings.job.log.slice(-4).join('\n')}</code>}
                </div>
              )}
              {ttsSettings.note && <p className="settings-permission-note">{ttsSettings.note}</p>}
            </>
          ) : ttsError ? (
            <div className="settings-load-error" role="alert">
              <div>
                <strong>TTS-Einstellungen konnten nicht geladen werden.</strong>
                <span>{ttsError}</span>
              </div>
              <button className="ghost-button" onClick={() => void loadTtsSettings()}>
                <RotateCw size={16} /> Erneut versuchen
              </button>
            </div>
          ) : (
            <p className="muted">TTS-Einstellungen werden geladen …</p>
          )}
          {ttsError && ttsSettings && <p className="settings-permission-note">{ttsError}</p>}
        </section>
      )}

      {hasAdminAccess && (
        <section className="settings-section" aria-labelledby="ai-settings-title">
          <div className="settings-section-header">
            <div>
              <p className="eyebrow">KI-Anbieter</p>
              <h3 id="ai-settings-title">OpenRouter</h3>
              <p>Freie Modelle zuerst; bezahlte Modelle nur als aufgabenspezifischer Fallback.</p>
            </div>
            <BrainCircuit size={19} aria-hidden="true" />
          </div>
          {aiSettings ? (
            <>
              <div className="settings-automation-grid">
                <label className="settings-option ai-key-option">
                  <span>API-Key</span>
                  <small>
                    {aiSettings.configured
                      ? `Verbunden: ${aiSettings.apiKeyHint}. Leer lassen, um den Key beizubehalten.`
                      : 'Ein eingeschränkter OpenRouter-Key mit Ausgabenlimit wird empfohlen.'}
                  </small>
                  <span className="ai-key-input">
                    <KeyRound size={16} aria-hidden="true" />
                    <input
                      type="password"
                      autoComplete="off"
                      value={aiApiKey}
                      placeholder={aiSettings.configured ? 'API-Key beibehalten' : 'sk-or-v1-…'}
                      onChange={(event) => setAiApiKey(event.target.value)}
                    />
                  </span>
                  <a href="https://openrouter.ai/settings/keys" target="_blank" rel="noreferrer">
                    OpenRouter-Key verwalten <ExternalLink size={13} />
                  </a>
                </label>
                <div className="settings-option">
                  <span>Modellreihenfolge</span>
                  <small>Der Free Router wählt ein aktuell verfügbares, passendes Gratis-Modell.</small>
                  <strong>
                    <WandSparkles size={15} /> {aiSettings.freeModel} → bezahlte Task-Modelle
                  </strong>
                </div>
                <label className="settings-option settings-toggle-option">
                  <span>Bezahlter Fallback</span>
                  <small>Nur wenn alle geeigneten freien Modelle scheitern oder limitiert sind.</small>
                  <span className="toggle-row">
                    <input
                      type="checkbox"
                      disabled={working}
                      checked={aiSettings.paidFallback}
                      onChange={(event) => setAiSettings({ ...aiSettings, paidFallback: event.target.checked })}
                    />
                    Bezahlte Modelle danach erlauben
                  </span>
                </label>
                <label className="settings-option settings-toggle-option">
                  <span>Eingangsmeldungen</span>
                  <small>Neue Artikel automatisch umschreiben, einordnen und für die Sendung vorbereiten.</small>
                  <span className="toggle-row">
                    <input
                      type="checkbox"
                      disabled={working}
                      checked={aiSettings.autoProcessIngest}
                      onChange={(event) => setAiSettings({ ...aiSettings, autoProcessIngest: event.target.checked })}
                    />
                    KI beim Nachrichtenabruf verwenden
                  </span>
                </label>
                <label className="settings-option">
                  <span>Provider-Datenschutz</span>
                  <small>„Keine Sammlung“ schließt Provider aus, die Anfragen zum Training speichern.</small>
                  <select
                    disabled={working}
                    value={aiSettings.dataCollection}
                    onChange={(event) =>
                      setAiSettings({
                        ...aiSettings,
                        dataCollection: event.target.value === 'allow' ? 'allow' : 'deny',
                      })
                    }
                  >
                    <option value="deny">Keine Datensammlung</option>
                    <option value="allow">Datensammlung erlauben</option>
                  </select>
                </label>
              </div>
              <div className="toolbar settings-ai-actions">
                <button disabled={working} onClick={() => void saveAiSettings(false)}>
                  <Save size={17} /> Speichern
                </button>
                <button
                  className="primary-button"
                  disabled={working || (!aiSettings.configured && !aiApiKey)}
                  onClick={() => void saveAiSettings(true)}
                >
                  <Activity size={17} /> Speichern und Verbindung prüfen
                </button>
              </div>
              {aiKeyCheck && (
                <p className="settings-permission-note">
                  Key „{aiKeyCheck.key.label}“ ist gültig · genutzt {aiKeyCheck.key.usage ?? 0} USD
                  {aiKeyCheck.key.limitRemaining !== null
                    ? ` · verbleibendes Key-Limit ${aiKeyCheck.key.limitRemaining} USD`
                    : ''}
                </p>
              )}
              <div className="ai-policy-grid" aria-label="Aufgabenspezifische KI-Modelle">
                {aiSettings.taskPolicies.map((policy) => (
                  <article className="settings-option" key={policy.id}>
                    <span>{policy.label}</span>
                    <small>{policy.purpose}</small>
                    <code>{policy.paidModels.join(' → ')}</code>
                    <small>
                      Preisgrenze: {policy.maxPromptPrice}/{policy.maxCompletionPrice} USD je Mio. Ein-/Ausgabetoken
                    </small>
                  </article>
                ))}
              </div>
            </>
          ) : aiError ? (
            <div className="settings-load-error" role="alert">
              <div>
                <strong>OpenRouter-Einstellungen konnten nicht geladen werden.</strong>
                <span>{aiError}</span>
              </div>
              <button className="ghost-button" onClick={() => void loadAiSettings()}>
                <RotateCw size={16} /> Erneut versuchen
              </button>
            </div>
          ) : (
            <p className="muted">OpenRouter-Einstellungen werden geladen …</p>
          )}
          {aiError && aiSettings && <p className="settings-permission-note">{aiError}</p>}
        </section>
      )}

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
