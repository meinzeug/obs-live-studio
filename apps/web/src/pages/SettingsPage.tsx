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
  ImageUp,
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
  Trash2,
  Users,
  Volume2,
  WandSparkles,
  Video,
  type LucideIcon,
} from 'lucide-react';
import { Link } from 'react-router-dom';
import { api, can, type SessionUser, type StudioProfile } from '../api/client.js';
import { routes } from '../navigation.js';
import { readInterfacePreferences, saveInterfacePreferences, type InterfacePreferences } from '../preferences.js';
import { AgentPresenterSettings } from '../components/AgentPresenterSettings.js';

type AutopilotSettings = {
  enabled: boolean;
  contentMode: 'news' | 'youtube' | 'mixed' | 'youtube-news-sidebar' | 'youtube-context';
  minimumTrust: number;
  requireStream: boolean;
  requireVideo: boolean;
  showItemCount: number;
  pauseSeconds: number;
  pauseBetweenShowsSeconds: number;
  sidebarRotationSeconds: number;
  sourceIds?: string[];
  youtubeCategoryIds?: string[];
  dailyFormats?: Array<{
    id: string;
    name: string;
    startTime: string;
    durationMinutes: number;
    contentMode: 'news' | 'youtube' | 'mixed' | 'youtube-news-sidebar' | 'youtube-context';
    youtubeCategoryIds: string[];
    sourceIds: string[];
    enabled: boolean;
  }>;
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
  freeChatDataCollection: 'allow' | 'deny';
  presenterPaidFallback: boolean;
  dailyBudgetUsd: number;
  maxRequestUsd: number;
  automaticModelSelection: true;
  taskPolicies: Array<{
    id: string;
    label: string;
    purpose: string;
    paidModels: string[];
    maxPromptPrice: number;
    maxCompletionPrice: number;
    freeOnly?: boolean;
    budgetedPresenterFallback?: boolean;
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
  provider: 'pocket-tts' | 'piper' | 'espeak-ng' | 'qwen3-tts';
  voice: string;
  serverUrl: string;
  temperature: number;
  decodeSteps: number;
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
  engine: 'pocket-tts' | 'piper' | 'espeak-ng' | 'qwen3-tts';
  voice: string;
  size: 'klein' | 'mittel' | 'hoch';
  audioReady: boolean;
  installHint: string;
  installed: boolean;
  checks: Record<string, boolean>;
  license?: string;
  licenseUrl?: string;
  commercialUse?: boolean;
};

type TtsTestResult = {
  ok: boolean;
  preview: string;
  file: string;
  durationSeconds: number;
  engine: string;
  configuredEngine: string;
  voice: string;
  audioUrl: string;
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

type ChannelIdentitySettings = {
  channelName: string;
  studioName: string;
  logoConfigured: boolean;
  logoUrl: string;
  logoWidthOriginal: number;
  logoHeightOriginal: number;
  logoEnabled: boolean;
  logoVisibility: 'always' | 'streaming' | 'broadcast' | 'streaming-or-broadcast';
  logoPosition: 'top-left' | 'top-right' | 'bottom-left' | 'bottom-right';
  logoWidth: number;
  logoOpacity: number;
  logoMargin: number;
};

export function SettingsPage({
  user,
  studio,
  onStudioChange,
}: {
  user: SessionUser;
  studio: StudioProfile;
  onStudioChange: (studio: StudioProfile) => void;
}) {
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
  const [ttsVoice, setTtsVoice] = useState('');
  const [ttsServerUrl, setTtsServerUrl] = useState('');
  const [ttsTemperature, setTtsTemperature] = useState(0.7);
  const [ttsDecodeSteps, setTtsDecodeSteps] = useState(4);
  const [ttsTestText, setTtsTestText] = useState('Das ist eine Testausgabe aus dem Open TV Studio.');
  const [ttsTestResult, setTtsTestResult] = useState<TtsTestResult>();
  const [ttsError, setTtsError] = useState('');
  const [identity, setIdentity] = useState<ChannelIdentitySettings>();
  const [identityError, setIdentityError] = useState('');
  const [identityWorking, setIdentityWorking] = useState(false);
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
      setTtsVoice(settings.voice);
      setTtsServerUrl(settings.serverUrl);
      setTtsTemperature(settings.temperature);
      setTtsDecodeSteps(settings.decodeSteps);
      setTtsError('');
    } catch (error) {
      setTtsError(error instanceof Error ? error.message : String(error));
    }
  }

  async function loadIdentity() {
    if (!hasAdminAccess) return;
    try {
      setIdentity(await api<ChannelIdentitySettings>('/api/channel/settings'));
      setIdentityError('');
    } catch (error) {
      setIdentityError(error instanceof Error ? error.message : String(error));
    }
  }

  useEffect(() => {
    void loadAutopilot();
  }, []);

  useEffect(() => {
    void loadBackups();
    void loadAiSettings();
    void loadTtsSettings();
    void loadIdentity();
  }, [hasAdminAccess]);

  async function saveIdentity() {
    if (!identity || !hasAdminAccess || identityWorking) return;
    setIdentityWorking(true);
    setIdentityError('');
    try {
      const response = await api<{ settings: ChannelIdentitySettings; studio: StudioProfile; warning?: string }>(
        '/api/channel/settings',
        {
          method: 'POST',
          body: JSON.stringify({
            channelName: identity.channelName,
            studioName: identity.studioName,
            logoEnabled: identity.logoEnabled,
            logoVisibility: identity.logoVisibility,
            logoPosition: identity.logoPosition,
            logoWidth: identity.logoWidth,
            logoOpacity: identity.logoOpacity,
            logoMargin: identity.logoMargin,
          }),
        },
      );
      setIdentity(response.settings);
      onStudioChange(response.studio);
      setMessage(response.warning || 'Senderidentität und Logo-Einblendung gespeichert.');
    } catch (error) {
      setIdentityError(error instanceof Error ? error.message : String(error));
    } finally {
      setIdentityWorking(false);
    }
  }

  async function uploadLogo(file?: File) {
    if (!file || !hasAdminAccess || identityWorking) return;
    setIdentityWorking(true);
    setIdentityError('');
    try {
      const form = new FormData();
      form.append('file', file);
      const response = await api<{ settings: ChannelIdentitySettings; warning?: string }>('/api/channel/logo', {
        method: 'POST',
        body: form,
      });
      setIdentity(response.settings);
      onStudioChange({
        ...studio,
        channelName: response.settings.channelName,
        studioName: response.settings.studioName,
        logoConfigured: response.settings.logoConfigured,
        logoUrl: response.settings.logoUrl,
      });
      setMessage(response.warning || 'Senderlogo hochgeladen und in OBS aktualisiert.');
    } catch (error) {
      setIdentityError(error instanceof Error ? error.message : String(error));
    } finally {
      setIdentityWorking(false);
    }
  }

  async function deleteLogo() {
    if (!identity?.logoConfigured || !hasAdminAccess || identityWorking) return;
    if (!window.confirm('Senderlogo wirklich löschen? Es wird anschließend auch in OBS ausgeblendet.')) return;
    setIdentityWorking(true);
    setIdentityError('');
    try {
      const response = await api<{ settings: ChannelIdentitySettings; warning?: string }>('/api/channel/logo', {
        method: 'DELETE',
      });
      setIdentity(response.settings);
      onStudioChange({ ...studio, logoConfigured: false, logoUrl: '' });
      setMessage(response.warning || 'Senderlogo gelöscht und in OBS ausgeblendet.');
    } catch (error) {
      setIdentityError(error instanceof Error ? error.message : String(error));
    } finally {
      setIdentityWorking(false);
    }
  }

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
          freeChatDataCollection: aiSettings.freeChatDataCollection,
          presenterPaidFallback: aiSettings.presenterPaidFallback,
          dailyBudgetUsd: aiSettings.dailyBudgetUsd,
          maxRequestUsd: aiSettings.maxRequestUsd,
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
        body: JSON.stringify({
          presetId: ttsPresetId,
          voice: ttsVoice,
          serverUrl: ttsServerUrl,
          temperature: ttsTemperature,
          decodeSteps: ttsDecodeSteps,
        }),
      });
      setTtsSettings(saved);
      setTtsPresetId(saved.presetId);
      setTtsVoice(saved.voice);
      setTtsServerUrl(saved.serverUrl);
      setTtsTemperature(saved.temperature);
      setTtsDecodeSteps(saved.decodeSteps);
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

  async function testTtsSettings() {
    if (!hasAdminAccess || working || !ttsPresetId) return;
    setWorking(true);
    setTtsError('');
    try {
      const result = await api<TtsTestResult>('/api/tts/test', {
        method: 'POST',
        body: JSON.stringify({
          presetId: ttsPresetId,
          text: ttsTestText,
          voice: ttsVoice,
          serverUrl: ttsServerUrl,
          temperature: ttsTemperature,
          decodeSteps: ttsDecodeSteps,
        }),
      });
      setTtsTestResult(result);
      setMessage(`TTS-Test erzeugt: ${result.engine}, ${Math.round(result.durationSeconds)} Sekunden.`);
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
            to: routes.youtubeVideos,
            title: 'YouTube Videos',
            description: 'Video-Links, Kategorien und Autopilot-Formate verwalten.',
            icon: Video,
            keywords: 'youtube videos kategorien autopilot dokumentationen playlist',
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

      {hasAdminAccess && (
        <section className="settings-section channel-identity-section" aria-labelledby="channel-identity-title">
          <div className="settings-section-header">
            <div>
              <p className="eyebrow">Senderidentität</p>
              <h3 id="channel-identity-title">Kanalname und Senderlogo</h3>
              <p>
                Name und Logo werden in der WebUI, in automatisch erzeugten Sendungen und als eigene OBS-Quelle
                verwendet.
              </p>
            </div>
            <Radio size={19} aria-hidden="true" />
          </div>
          {identity ? (
            <>
              <div className="channel-identity-grid">
                <div className="channel-logo-editor">
                  <div className={`channel-logo-preview ${identity.logoPosition}`}>
                    <span>OBS 1920 × 1080</span>
                    {identity.logoUrl ? (
                      <img
                        src={identity.logoUrl}
                        alt={`Senderlogo ${identity.channelName}`}
                        style={{
                          width: `${Math.max(44, Math.min(160, identity.logoWidth / 2))}px`,
                          opacity: identity.logoEnabled ? identity.logoOpacity / 100 : 0.25,
                          margin: `${Math.min(24, identity.logoMargin / 4)}px`,
                        }}
                      />
                    ) : (
                      <div className="channel-logo-empty">
                        <Image size={24} />
                        <strong>Noch kein Logo</strong>
                      </div>
                    )}
                  </div>
                  <div className="channel-logo-actions">
                    <label className="button">
                      <ImageUp size={16} /> {identity.logoConfigured ? 'Logo ersetzen' : 'Logo hochladen'}
                      <input
                        hidden
                        type="file"
                        accept="image/png,image/jpeg,image/webp"
                        disabled={identityWorking}
                        onChange={(event) => {
                          void uploadLogo(event.target.files?.[0]);
                          event.currentTarget.value = '';
                        }}
                      />
                    </label>
                    <button
                      className="danger-button"
                      disabled={!identity.logoConfigured || identityWorking}
                      onClick={() => void deleteLogo()}
                    >
                      <Trash2 size={16} /> Löschen
                    </button>
                  </div>
                  <small className="muted">
                    PNG, JPEG oder WebP · transparente PNG/WebP eignen sich am besten
                    {identity.logoConfigured
                      ? ` · Original ${identity.logoWidthOriginal} × ${identity.logoHeightOriginal}`
                      : ''}
                  </small>
                </div>

                <div className="channel-identity-fields">
                  <label>
                    Kanalname
                    <input
                      maxLength={80}
                      disabled={identityWorking}
                      value={identity.channelName}
                      onChange={(event) => setIdentity({ ...identity, channelName: event.target.value })}
                    />
                  </label>
                  <label>
                    Studioname
                    <input
                      maxLength={120}
                      disabled={identityWorking}
                      value={identity.studioName}
                      onChange={(event) => setIdentity({ ...identity, studioName: event.target.value })}
                    />
                  </label>
                  <label className="settings-toggle-option">
                    Senderlogo in OBS
                    <span className="toggle-row">
                      <input
                        type="checkbox"
                        disabled={identityWorking || !identity.logoConfigured}
                        checked={identity.logoEnabled}
                        onChange={(event) => setIdentity({ ...identity, logoEnabled: event.target.checked })}
                      />
                      Logo-Einblendung aktiv
                    </span>
                  </label>
                  <label>
                    Wann einblenden
                    <select
                      disabled={identityWorking}
                      value={identity.logoVisibility}
                      onChange={(event) =>
                        setIdentity({
                          ...identity,
                          logoVisibility: event.target.value as ChannelIdentitySettings['logoVisibility'],
                        })
                      }
                    >
                      <option value="always">Immer, sobald OBS läuft</option>
                      <option value="streaming">Nur bei aktivem Livestream</option>
                      <option value="broadcast">Nur während einer Sendung</option>
                      <option value="streaming-or-broadcast">Bei Stream oder Sendung</option>
                    </select>
                  </label>
                  <label>
                    Position
                    <select
                      disabled={identityWorking}
                      value={identity.logoPosition}
                      onChange={(event) =>
                        setIdentity({
                          ...identity,
                          logoPosition: event.target.value as ChannelIdentitySettings['logoPosition'],
                        })
                      }
                    >
                      <option value="top-left">Oben links</option>
                      <option value="top-right">Oben rechts</option>
                      <option value="bottom-left">Unten links</option>
                      <option value="bottom-right">Unten rechts</option>
                    </select>
                  </label>
                  <div className="channel-logo-number-grid">
                    <label>
                      Breite (px)
                      <input
                        type="number"
                        min="48"
                        max="640"
                        disabled={identityWorking}
                        value={identity.logoWidth}
                        onChange={(event) => setIdentity({ ...identity, logoWidth: Number(event.target.value) })}
                      />
                    </label>
                    <label>
                      Deckkraft (%)
                      <input
                        type="number"
                        min="10"
                        max="100"
                        disabled={identityWorking}
                        value={identity.logoOpacity}
                        onChange={(event) => setIdentity({ ...identity, logoOpacity: Number(event.target.value) })}
                      />
                    </label>
                    <label>
                      Randabstand (px)
                      <input
                        type="number"
                        min="0"
                        max="240"
                        disabled={identityWorking}
                        value={identity.logoMargin}
                        onChange={(event) => setIdentity({ ...identity, logoMargin: Number(event.target.value) })}
                      />
                    </label>
                  </div>
                </div>
              </div>
              <div className="channel-identity-save-row">
                <span className="muted">
                  Die OBS-Quelle „ANS_CHANNEL_LOGO“ wird in allen Studioszenen ganz oben eingebunden.
                </span>
                <button
                  className="primary-button"
                  disabled={identityWorking || !identity.channelName.trim() || !identity.studioName.trim()}
                  onClick={() => void saveIdentity()}
                >
                  <Save size={17} /> {identityWorking ? 'Wird gespeichert …' : 'Senderidentität speichern'}
                </button>
              </div>
            </>
          ) : identityError ? (
            <div className="settings-load-error" role="alert">
              <div>
                <strong>Senderidentität konnte nicht geladen werden.</strong>
                <span>{identityError}</span>
              </div>
              <button className="ghost-button" onClick={() => void loadIdentity()}>
                <RotateCw size={16} /> Erneut versuchen
              </button>
            </div>
          ) : (
            <p className="muted">Senderidentität wird geladen …</p>
          )}
          {identityError && identity && <p className="settings-permission-note">{identityError}</p>}
        </section>
      )}

      {hasAdminAccess && (
        <section className="settings-section" aria-labelledby="external-media-api-title">
          <div className="settings-section-header">
            <div>
              <p className="eyebrow">Externe Dienste</p>
              <h3 id="external-media-api-title">Medien-APIs</h3>
              <p>
                YouTube Data, Wikimedia Commons, Pexels und Pixabay für die Nachrichtenmedien-Recherche konfigurieren.
              </p>
            </div>
            <KeyRound size={19} aria-hidden="true" />
          </div>
          <div className="media-api-summary">
            {['YouTube Data', 'Wikimedia Commons', 'Pexels', 'Pixabay'].map((provider) => (
              <span className="state-pill" key={provider}>
                {provider}
              </span>
            ))}
            <Link className="primary-button" to={routes.mediaSettings}>
              API-Keys und Provider verwalten <ChevronRight size={16} />
            </Link>
          </div>
        </section>
      )}

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
              <span>Inhalte</span>
              <small>Welche Inhalte der Autopilot für neue Sendungen verwenden soll.</small>
              <select
                disabled={!automationAllowed || working}
                value={autopilot.contentMode ?? 'news'}
                onChange={(event) => setAutopilot({ ...autopilot, contentMode: event.target.value as any })}
              >
                <option value="news">Nur Nachrichten</option>
                <option value="youtube">Nur YouTube Videos</option>
                <option value="mixed">Nachrichten und YouTube gemischt</option>
                <option value="youtube-news-sidebar">YouTube rechts + News links</option>
                <option value="youtube-context">YouTube-Einordnung mit AVA</option>
              </select>
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
            <label className="settings-option">
              <span>News-Sidebar Rotation</span>
              <small>Sekunden pro Nachrichtenkarte im Modus „YouTube rechts + News links“.</small>
              <input
                type="number"
                min="3"
                max="120"
                disabled={!automationAllowed || working}
                value={autopilot.sidebarRotationSeconds ?? 12}
                onChange={(event) => setAutopilot({ ...autopilot, sidebarRotationSeconds: Number(event.target.value) })}
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
                    onChange={(event) => {
                      const preset = ttsSettings.presets.find((candidate) => candidate.id === event.target.value);
                      setTtsPresetId(event.target.value);
                      if (preset?.engine === 'pocket-tts') setTtsVoice(preset.voice);
                    }}
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
                      {preset.license && (
                        <small>
                          Lizenz:{' '}
                          {preset.licenseUrl ? (
                            <a href={preset.licenseUrl} target="_blank" rel="noreferrer">
                              {preset.license}
                            </a>
                          ) : (
                            preset.license
                          )}
                          {preset.commercialUse === false ? ' · nur nicht-kommerzielle Nutzung' : ''}
                        </small>
                      )}
                    </div>
                  ))}
                <label className="settings-option">
                  <span>Stimme</span>
                  <small>
                    Pocket TTS akzeptiert Built-in-Stimmen, Hugging-Face-Voice-URLs oder lokale Voice-Dateien.
                  </small>
                  <input
                    type="text"
                    value={ttsVoice}
                    onChange={(event) => setTtsVoice(event.target.value)}
                    placeholder="lola"
                  />
                </label>
                <label className="settings-option">
                  <span>Server-URL</span>
                  <small>Lokaler Pocket-TTS-Dienst. Standard: http://127.0.0.1:8000</small>
                  <input
                    type="text"
                    value={ttsServerUrl}
                    onChange={(event) => setTtsServerUrl(event.target.value)}
                    placeholder="http://127.0.0.1:8000"
                  />
                </label>
                <label className="settings-option">
                  <span>Temperatur</span>
                  <small>Dienstkonfiguration für Pocket TTS. Der offizielle Server setzt dies beim Modellstart.</small>
                  <input
                    type="number"
                    min="0"
                    max="2"
                    step="0.05"
                    value={ttsTemperature}
                    onChange={(event) => setTtsTemperature(Number(event.target.value))}
                  />
                </label>
                <label className="settings-option">
                  <span>Decode-Steps</span>
                  <small>Dienstkonfiguration für Pocket TTS. Höher kann stabiler, aber langsamer sein.</small>
                  <input
                    type="number"
                    min="1"
                    max="16"
                    step="1"
                    value={ttsDecodeSteps}
                    onChange={(event) => setTtsDecodeSteps(Number(event.target.value))}
                  />
                </label>
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
              <div className="tts-test-panel">
                <label>
                  <span>Testtext</span>
                  <textarea value={ttsTestText} onChange={(event) => setTtsTestText(event.target.value)} rows={3} />
                </label>
                <div className="toolbar settings-ai-actions">
                  <button disabled={working || !ttsTestText.trim()} onClick={() => void testTtsSettings()}>
                    <Volume2 size={16} /> TTS testen
                  </button>
                  {ttsTestResult && (
                    <span className="muted">
                      {ttsTestResult.engine}
                      {ttsTestResult.configuredEngine !== ttsTestResult.engine
                        ? ` · Fallback von ${ttsTestResult.configuredEngine}`
                        : ''}{' '}
                      · {Math.round(ttsTestResult.durationSeconds)} Sek.
                    </span>
                  )}
                </div>
                {ttsTestResult && (
                  <audio controls src={ttsTestResult.audioUrl} className="tts-test-player" aria-label="TTS-Testaudio" />
                )}
              </div>
              {ttsSettings.job && (
                <div className={`tts-install-status ${ttsSettings.job.status}`} role="status">
                  <strong>{ttsSettings.job.message}</strong>
                  {ttsSettings.job.error && <span>{ttsSettings.job.error}</span>}
                  {ttsSettings.job.log.length > 0 && <code>{ttsSettings.job.log.slice(-4).join('\n')}</code>}
                </div>
              )}
              {ttsSettings.note && <p className="settings-permission-note">{ttsSettings.note}</p>}
              <AgentPresenterSettings disabled={working || ttsSettings.job?.status === 'running'} />
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
                  <span>Ava & Mia: Paid-Fallback</span>
                  <small>Verwendet bei Free-Limits automatisch ein günstiges Modell innerhalb des Budgets.</small>
                  <span className="toggle-row">
                    <input
                      type="checkbox"
                      disabled={working || !aiSettings.paidFallback}
                      checked={aiSettings.presenterPaidFallback}
                      onChange={(event) =>
                        setAiSettings({ ...aiSettings, presenterPaidFallback: event.target.checked })
                      }
                    />
                    Budgetierten Fallback erlauben
                  </span>
                </label>
                <label className="settings-option">
                  <span>Tagesbudget (USD)</span>
                  <small>Gemeinsame harte Grenze für alle bezahlten OpenRouter-Anfragen.</small>
                  <input
                    type="number"
                    min="0"
                    max="1000"
                    step="0.01"
                    disabled={working}
                    value={aiSettings.dailyBudgetUsd}
                    onChange={(event) =>
                      setAiSettings({ ...aiSettings, dailyBudgetUsd: Math.max(0, Number(event.target.value) || 0) })
                    }
                  />
                </label>
                <label className="settings-option">
                  <span>Limit je Anfrage (USD)</span>
                  <small>
                    Die automatische Modellauswahl verwirft alle Modelle, die diese Grenze voraussichtlich
                    überschreiten.
                  </small>
                  <input
                    type="number"
                    min="0"
                    max={aiSettings.dailyBudgetUsd || 100}
                    step="0.001"
                    disabled={working}
                    value={aiSettings.maxRequestUsd}
                    onChange={(event) =>
                      setAiSettings({ ...aiSettings, maxRequestUsd: Math.max(0, Number(event.target.value) || 0) })
                    }
                  />
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
