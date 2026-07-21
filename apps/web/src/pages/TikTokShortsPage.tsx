import React, { useEffect, useMemo, useRef, useState } from 'react';
import {
  AlertTriangle,
  CheckCircle2,
  CirclePlay,
  ClipboardCheck,
  Clock3,
  Download,
  ExternalLink,
  Film,
  LoaderCircle,
  Music2,
  PenLine,
  RefreshCw,
  Save,
  Search,
  Settings2,
  ShieldCheck,
  Sparkles,
  Trash2,
  UploadCloud,
  WandSparkles,
  X,
} from 'lucide-react';
import { api, can, type SessionUser } from '../api/client.js';

type TikTokStatus =
  | 'queued'
  | 'rendering'
  | 'ready'
  | 'handed-off'
  | 'upload-queued'
  | 'uploading'
  | 'processing'
  | 'published'
  | 'failed'
  | 'cancelled';

type TikTokSettings = {
  enabled: boolean;
  auto_create: boolean;
  daily_limit: number;
  duration_seconds: 90;
  caption_template: string;
  time_zone: string;
  source_volume_percent: number;
  source_duck_percent: number;
  app_audited: boolean;
  publishing_mode: 'manual' | 'api';
};

type TikTokJob = {
  id: string;
  status: TikTokStatus;
  progress: number;
  output_path: string | null;
  caption: string;
  privacy_level: string | null;
  source_title: string;
  source_channel: string;
  source_url: string;
  commentary_headline: string;
  commentary_text: string;
  commentary_model: string;
  clip_start_seconds: number;
  publish_id: string | null;
  post_id: string | null;
  post_url: string | null;
  remote_status: string | null;
  handoff_at: string | null;
  handoff_count: number;
  manual_published_at: string | null;
  manual_post_url: string | null;
  error: string | null;
  created_at: string;
  published_at: string | null;
};

type CreatorInfo = {
  avatarUrl: string;
  username: string;
  nickname: string;
  privacyLevelOptions: string[];
  commentDisabled: boolean;
  duetDisabled: boolean;
  stitchDisabled: boolean;
  maxVideoPostDurationSec: number;
};

type Dashboard = {
  settings: TikTokSettings;
  summary: {
    productionDate: string;
    today: number;
    remaining: number;
    counts: Partial<Record<TikTokStatus, number>>;
  };
  jobs: TikTokJob[];
  oauth: {
    clientConfigured: boolean;
    connected: boolean;
    clientKeyHint: string;
    clientSecretHint: string;
    redirectUri: string;
    scopes: string[];
    account: null | {
      nickname: string;
      username: string;
      avatarUrl: string;
      connectedAt: string;
    };
  };
  prerequisites: { ffmpeg: boolean; ytDlp: boolean; oauth: boolean };
  compliance: {
    automaticPublishing: false;
    unauditedPrivacy: 'SELF_ONLY';
    publishingRequiresApproval: true;
    manualUploadUrl: string;
    manualHandoffRequiresFileSelection: true;
    docsUrl: string;
  };
};

type SettingsDraft = {
  enabled: boolean;
  autoCreate: boolean;
  dailyLimit: number;
  captionTemplate: string;
  timeZone: string;
  sourceVolumePercent: number;
  sourceDuckPercent: number;
  appAudited: boolean;
  publishingMode: 'manual' | 'api';
  clientKey: string;
  clientSecret: string;
  redirectUri: string;
};

type PublishDraft = {
  caption: string;
  privacyLevel: string;
  allowComment: boolean;
  allowDuet: boolean;
  allowStitch: boolean;
  brandContentToggle: boolean;
  brandOrganicToggle: boolean;
  rightsConfirmed: boolean;
  musicUsageConfirmed: boolean;
  publishConsent: boolean;
};

const statusLabels: Record<TikTokStatus, string> = {
  queued: 'Vorgemerkt',
  rendering: 'Wird gerendert',
  ready: 'Freigabe bereit',
  'handed-off': 'An TikTok übergeben',
  'upload-queued': 'Upload vorgemerkt',
  uploading: 'Wird übertragen',
  processing: 'TikTok verarbeitet',
  published: 'Veröffentlicht',
  failed: 'Fehlgeschlagen',
  cancelled: 'Gestoppt',
};

const privacyLabels: Record<string, string> = {
  PUBLIC_TO_EVERYONE: 'Alle',
  MUTUAL_FOLLOW_FRIENDS: 'Freunde, denen du ebenfalls folgst',
  FOLLOWER_OF_CREATOR: 'Follower',
  SELF_ONLY: 'Nur ich',
};

function settingsDraft(dashboard: Dashboard): SettingsDraft {
  return {
    enabled: dashboard.settings.enabled,
    autoCreate: dashboard.settings.auto_create,
    dailyLimit: dashboard.settings.daily_limit,
    captionTemplate: dashboard.settings.caption_template,
    timeZone: dashboard.settings.time_zone,
    sourceVolumePercent: dashboard.settings.source_volume_percent,
    sourceDuckPercent: dashboard.settings.source_duck_percent,
    appAudited: dashboard.settings.app_audited,
    publishingMode: dashboard.settings.publishing_mode,
    clientKey: '',
    clientSecret: '',
    redirectUri: dashboard.oauth.redirectUri,
  };
}

function emptyPublish(job: TikTokJob): PublishDraft {
  return {
    caption: job.caption,
    privacyLevel: '',
    allowComment: false,
    allowDuet: false,
    allowStitch: false,
    brandContentToggle: false,
    brandOrganicToggle: false,
    rightsConfirmed: false,
    musicUsageConfirmed: false,
    publishConsent: false,
  };
}

function localDate(value: string | null) {
  if (!value) return '–';
  return new Intl.DateTimeFormat('de-DE', { dateStyle: 'short', timeStyle: 'short' }).format(new Date(value));
}

function clipTime(value: number) {
  const seconds = Math.max(0, Math.floor(value));
  return `${Math.floor(seconds / 60)}:${String(seconds % 60).padStart(2, '0')}`;
}

async function copyText(value: string) {
  try {
    await navigator.clipboard.writeText(value);
    return true;
  } catch {
    const field = document.createElement('textarea');
    field.value = value;
    field.style.position = 'fixed';
    field.style.opacity = '0';
    document.body.appendChild(field);
    field.select();
    const copied = document.execCommand('copy');
    field.remove();
    return copied;
  }
}

function startDownload(url: string) {
  const link = document.createElement('a');
  link.href = url;
  link.download = '';
  link.style.display = 'none';
  document.body.appendChild(link);
  link.click();
  link.remove();
}

export function TikTokShortsPage({ user }: { user: SessionUser }) {
  const allowedWrite = can(user, 'broadcast:write');
  const allowedAdmin = can(user, 'users:write');
  const [dashboard, setDashboard] = useState<Dashboard | null>(null);
  const [draft, setDraft] = useState<SettingsDraft | null>(null);
  const [settingsOpen, setSettingsOpen] = useState(false);
  const [publishJob, setPublishJob] = useState<TikTokJob | null>(null);
  const [publishDraft, setPublishDraft] = useState<PublishDraft | null>(null);
  const [creator, setCreator] = useState<CreatorInfo | null>(null);
  const [creatorLoading, setCreatorLoading] = useState(false);
  const [editingJob, setEditingJob] = useState<TikTokJob | null>(null);
  const [editCaption, setEditCaption] = useState('');
  const [deleteJob, setDeleteJob] = useState<TikTokJob | null>(null);
  const [deleteConfirmation, setDeleteConfirmation] = useState('');
  const [handoffJob, setHandoffJob] = useState<TikTokJob | null>(null);
  const [handoffCopied, setHandoffCopied] = useState(false);
  const [manualPostUrl, setManualPostUrl] = useState('');
  const [search, setSearch] = useState('');
  const [filter, setFilter] = useState<'all' | TikTokStatus>('all');
  const [working, setWorking] = useState('');
  const [message, setMessage] = useState('');
  const [error, setError] = useState('');
  const revision = useRef(0);

  async function load(silent = false) {
    const current = ++revision.current;
    try {
      const next = await api<Dashboard>('/api/tiktok-shorts', { signal: AbortSignal.timeout(20_000) });
      if (current !== revision.current) return;
      setDashboard(next);
      setDraft((value) => (value && settingsOpen ? value : settingsDraft(next)));
      if (!silent) setError('');
    } catch (requestError) {
      if (current !== revision.current) return;
      if (!silent) setError(requestError instanceof Error ? requestError.message : String(requestError));
    }
  }

  useEffect(() => {
    void load();
    const timer = window.setInterval(() => void load(true), 12_000);
    return () => {
      window.clearInterval(timer);
      revision.current += 1;
    };
  }, []);

  async function action(key: string, operation: () => Promise<void>) {
    setWorking(key);
    setError('');
    setMessage('');
    try {
      await operation();
      await load(true);
    } catch (requestError) {
      setError(requestError instanceof Error ? requestError.message : String(requestError));
    } finally {
      setWorking('');
    }
  }

  async function saveSettings() {
    if (!draft) return;
    await action('settings', async () => {
      await api('/api/tiktok-shorts/settings', {
        method: 'PATCH',
        body: JSON.stringify({
          enabled: draft.enabled,
          autoCreate: draft.autoCreate,
          dailyLimit: draft.dailyLimit,
          captionTemplate: draft.captionTemplate,
          timeZone: draft.timeZone,
          sourceVolumePercent: draft.sourceVolumePercent,
          sourceDuckPercent: draft.sourceDuckPercent,
          appAudited: draft.appAudited,
          publishingMode: draft.publishingMode,
        }),
      });
      if (
        allowedAdmin &&
        draft.publishingMode === 'api' &&
        (draft.clientKey || draft.clientSecret || draft.redirectUri !== dashboard?.oauth.redirectUri)
      ) {
        await api('/api/tiktok/oauth/settings', {
          method: 'POST',
          body: JSON.stringify({
            clientKey: draft.clientKey || undefined,
            clientSecret: draft.clientSecret || undefined,
            redirectUri: draft.redirectUri,
          }),
        });
      }
      setMessage('TikTok-Creator-Einstellungen wurden gespeichert.');
      setSettingsOpen(false);
    });
  }

  async function connect() {
    await action('connect', async () => {
      const result = await api<{ url: string }>('/api/tiktok/oauth/start', { method: 'POST' });
      window.location.assign(result.url);
    });
  }

  async function testConnection() {
    await action('test', async () => {
      const result = await api<{ message: string }>('/api/tiktok/oauth/test', { method: 'POST' });
      setMessage(result.message);
    });
  }

  async function disconnect() {
    await action('disconnect', async () => {
      await api('/api/tiktok/oauth', { method: 'DELETE' });
      setMessage('Die TikTok-Freigabe wurde getrennt.');
    });
  }

  async function createCurrent() {
    await action('create', async () => {
      await api('/api/tiktok-shorts/create-current', { method: 'POST' });
      setMessage('Der aktuelle qualifizierte AVA-Moment wurde für TikTok vorgemerkt.');
    });
  }

  async function openPublish(job: TikTokJob) {
    setPublishJob(job);
    setPublishDraft(emptyPublish(job));
    setCreator(null);
    setCreatorLoading(true);
    setError('');
    try {
      setCreator(await api<CreatorInfo>('/api/tiktok-shorts/creator-info'));
    } catch (requestError) {
      setError(requestError instanceof Error ? requestError.message : String(requestError));
    } finally {
      setCreatorLoading(false);
    }
  }

  async function publish() {
    if (!publishJob || !publishDraft) return;
    await action(`publish-${publishJob.id}`, async () => {
      await api(`/api/tiktok-shorts/jobs/${publishJob.id}/publish`, {
        method: 'POST',
        body: JSON.stringify(publishDraft),
      });
      setPublishJob(null);
      setPublishDraft(null);
      setCreator(null);
      setMessage(
        'TikTok hat die ausdrückliche Veröffentlichungsfreigabe erhalten. Der Status wird automatisch verfolgt.',
      );
    });
  }

  async function handoff(job: TikTokJob) {
    const clipboard = copyText(job.caption);
    const uploadWindow = window.open('about:blank', '_blank');
    if (uploadWindow) {
      uploadWindow.document.title = 'TikTok wird geöffnet …';
      uploadWindow.document.body.textContent = 'Open TV Studio bereitet den TikTok-Upload vor …';
    }
    setWorking(`handoff-${job.id}`);
    setError('');
    setMessage('');
    try {
      const result = await api<{ job: TikTokJob; uploadUrl: string; downloadUrl: string }>(
        `/api/tiktok-shorts/jobs/${job.id}/handoff`,
        { method: 'POST' },
      );
      const copied = await clipboard;
      startDownload(result.downloadUrl);
      if (uploadWindow) {
        uploadWindow.opener = null;
        uploadWindow.location.replace(result.uploadUrl);
      }
      setHandoffCopied(copied);
      setHandoffJob(result.job);
      setManualPostUrl(result.job.manual_post_url ?? '');
      setMessage(
        `${copied ? 'Text kopiert, ' : ''}MP4-Download gestartet und TikTok geöffnet. Wähle dort die heruntergeladene Datei aus.`,
      );
      await load(true);
    } catch (requestError) {
      uploadWindow?.close();
      setError(requestError instanceof Error ? requestError.message : String(requestError));
    } finally {
      setWorking('');
    }
  }

  async function confirmManualPublish() {
    if (!handoffJob) return;
    await action(`manual-published-${handoffJob.id}`, async () => {
      await api(`/api/tiktok-shorts/jobs/${handoffJob.id}/manual-published`, {
        method: 'POST',
        body: JSON.stringify(manualPostUrl.trim() ? { postUrl: manualPostUrl.trim() } : {}),
      });
      setHandoffJob(null);
      setManualPostUrl('');
      setMessage('Der manuelle TikTok-Upload wurde als veröffentlicht protokolliert.');
    });
  }

  const filteredJobs = useMemo(() => {
    const value = search.trim().toLocaleLowerCase('de');
    return (dashboard?.jobs ?? []).filter((job) => {
      if (filter !== 'all' && job.status !== filter) return false;
      return (
        !value || `${job.source_title} ${job.source_channel} ${job.caption}`.toLocaleLowerCase('de').includes(value)
      );
    });
  }, [dashboard?.jobs, filter, search]);

  if (!dashboard && error)
    return (
      <section className="panel shorts-load-error">
        <AlertTriangle />
        <h2>TikTok Clips Creator konnte nicht geladen werden</h2>
        <p>{error}</p>
        <button className="primary-button" onClick={() => void load()}>
          <RefreshCw size={16} /> Erneut versuchen
        </button>
      </section>
    );
  if (!dashboard || !draft)
    return (
      <div className="shorts-loading">
        <LoaderCircle className="spin" /> TikTok Creator lädt …
      </div>
    );

  const manualMode = dashboard.settings.publishing_mode === 'manual';
  const setupReady =
    dashboard.settings.enabled &&
    dashboard.prerequisites.ffmpeg &&
    dashboard.prerequisites.ytDlp &&
    (manualMode || dashboard.oauth.connected);
  const publishReady = Boolean(
    publishDraft?.privacyLevel &&
    publishDraft.rightsConfirmed &&
    publishDraft.musicUsageConfirmed &&
    publishDraft.publishConsent &&
    creator &&
    creator.maxVideoPostDurationSec >= 90,
  );

  return (
    <section className="panel shorts-page tiktok-page">
      <div className="shorts-hero">
        <div>
          <p className="eyebrow">Automation · TikTok-Freigabewarteschlange</p>
          <h2>TikTok Shorts Creator</h2>
          <p>
            Produziert eigene vertikale AVA-Einordnungen lokal und übergibt sie mit einem Klick an den offiziellen
            TikTok-Uploader – standardmäßig ohne Developer-App.
          </p>
        </div>
        <div className="page-actions">
          <button className="ghost-button" onClick={() => setSettingsOpen(true)}>
            <Settings2 size={17} /> Einstellungen
          </button>
          <button
            className="primary-button"
            disabled={!allowedWrite || Boolean(working)}
            onClick={() => void createCurrent()}
          >
            {working === 'create' ? <LoaderCircle className="spin" size={17} /> : <WandSparkles size={17} />}
            Aktuellen Moment erstellen
          </button>
        </div>
      </div>

      {(message || error) && <div className={`settings-message ${error ? 'error' : ''}`}>{error || message}</div>}

      <div className="shorts-kpis">
        <article>
          <Clock3 />
          <div>
            <small>Heute</small>
            <strong>
              {dashboard.summary.today} / {dashboard.settings.daily_limit}
            </strong>
            <span>{dashboard.summary.remaining} Plätze frei</span>
          </div>
        </article>
        <article>
          <Film />
          <div>
            <small>Produktion</small>
            <strong>{(dashboard.summary.counts.queued ?? 0) + (dashboard.summary.counts.rendering ?? 0)}</strong>
            <span>lokal wartend oder aktiv</span>
          </div>
        </article>
        <article>
          <ClipboardCheck />
          <div>
            <small>Freigabewarteschlange</small>
            <strong>{(dashboard.summary.counts.ready ?? 0) + (dashboard.summary.counts['handed-off'] ?? 0)}</strong>
            <span>
              {dashboard.summary.counts.ready ?? 0} bereit · {dashboard.summary.counts['handed-off'] ?? 0} übergeben
            </span>
          </div>
        </article>
        <article className={setupReady ? 'ready' : 'attention'}>
          {setupReady ? <CheckCircle2 /> : <AlertTriangle />}
          <div>
            <small>Veröffentlichungsweg</small>
            <strong>{setupReady ? 'Startklar' : 'Einrichtung offen'}</strong>
            <span>{manualMode ? 'Manuelle Übergabe · keine App nötig' : 'Content Posting API'}</span>
          </div>
        </article>
      </div>

      <div className="shorts-workflow">
        {[
          ['1', 'Redaktion', 'Nur qualifizierte AVA-Einordnungen mit echtem Transkript.'],
          ['2', 'TikTok-Schnitt', 'Eigener 9:16-Render ohne eingebranntes Sender-Wasserzeichen.'],
          [
            '3',
            'Ein-Klick-Übergabe',
            manualMode
              ? 'Text kopieren, MP4 laden und den offiziellen TikTok-Uploader öffnen.'
              : 'Konto, Text, Sichtbarkeit, Interaktionen und Rechte einzeln prüfen.',
          ],
          [
            '4',
            manualMode ? 'In TikTok bestätigen' : 'Statuskontrolle',
            manualMode
              ? 'Datei auswählen, AIGC-Kennzeichnung prüfen und den veröffentlichten Clip abhaken.'
              : 'Upload und TikTok-Verarbeitung werden automatisch nachgeführt.',
          ],
        ].map(([step, title, text]) => (
          <article key={step}>
            <b>{step}</b>
            <div>
              <strong>{title}</strong>
              <span>{text}</span>
            </div>
          </article>
        ))}
      </div>

      <div className="shorts-section-heading">
        <div>
          <p className="eyebrow">Produktionsjournal</p>
          <h3>TikTok-Clips verwalten</h3>
        </div>
        <div className="shorts-management-tools">
          <label className="shorts-search">
            <Search size={16} />
            <input
              value={search}
              onChange={(event) => setSearch(event.target.value)}
              placeholder="Titel oder Kanal suchen"
            />
          </label>
          <select value={filter} onChange={(event) => setFilter(event.target.value as 'all' | TikTokStatus)}>
            <option value="all">Alle Status</option>
            {Object.entries(statusLabels).map(([value, label]) => (
              <option key={value} value={value}>
                {label}
              </option>
            ))}
          </select>
          {manualMode ? (
            <a className="ghost-button" href={dashboard.compliance.manualUploadUrl} target="_blank" rel="noreferrer">
              <ExternalLink size={16} /> TikTok-Uploader
            </a>
          ) : (
            <button
              className="ghost-button"
              disabled={Boolean(working)}
              onClick={() =>
                void action('reconcile', async () => {
                  const result = await api<{ checked: number }>('/api/tiktok-shorts/reconcile', { method: 'POST' });
                  setMessage(`${result.checked} laufende TikTok-Veröffentlichungen wurden abgeglichen.`);
                })
              }
            >
              <RefreshCw className={working === 'reconcile' ? 'spin' : ''} size={16} /> TikTok abgleichen
            </button>
          )}
        </div>
      </div>

      <div className="shorts-job-grid">
        {filteredJobs.map((job) => (
          <article className={`short-job status-${job.status}`} key={job.id}>
            <div className="short-job-preview">
              {job.output_path ? (
                <video controls preload="metadata" src={`/api/tiktok-shorts/jobs/${job.id}/video`} />
              ) : (
                <div>
                  <Music2 size={36} />
                  <span>{job.progress}%</span>
                </div>
              )}
              <span className="short-status">{statusLabels[job.status]}</span>
            </div>
            <div className="short-job-body">
              <div className="short-job-source">
                <CirclePlay size={15} />
                <span>{job.source_channel}</span>
                <small>Ausschnitt ab {clipTime(job.clip_start_seconds)}</small>
              </div>
              <h3>{job.source_title}</h3>
              <div className="short-publication-title">TikTok: {job.caption}</div>
              <strong>{job.commentary_headline}</strong>
              <p>{job.commentary_text}</p>
              <div className="short-progress">
                <i style={{ width: `${job.progress}%` }} />
              </div>
              {job.remote_status && <small>TikTok-Status: {job.remote_status}</small>}
              {job.error && (
                <div className="short-error">
                  <AlertTriangle size={15} /> {job.error}
                </div>
              )}
              <small>
                Erstellt: {localDate(job.created_at)} · Modell: {job.commentary_model}
              </small>
              <div className="short-job-actions">
                <a className="ghost-button" href={job.source_url} target="_blank" rel="noreferrer">
                  <ExternalLink size={15} /> Quelle
                </a>
                {job.output_path && (
                  <a className="ghost-button" href={`/api/tiktok-shorts/jobs/${job.id}/video?download=1`} download>
                    <Download size={15} /> MP4
                  </a>
                )}
                {job.post_url && (
                  <a className="primary-button" href={job.post_url} target="_blank" rel="noreferrer">
                    <Music2 size={15} /> TikTok
                  </a>
                )}
                {job.status === 'ready' && manualMode && (
                  <button
                    className="primary-button"
                    disabled={!allowedWrite || Boolean(working)}
                    onClick={() => void handoff(job)}
                  >
                    {working === `handoff-${job.id}` ? (
                      <LoaderCircle className="spin" size={15} />
                    ) : (
                      <UploadCloud size={15} />
                    )}{' '}
                    Mit einem Klick an TikTok übergeben
                  </button>
                )}
                {job.status === 'ready' && !manualMode && (
                  <button
                    className="primary-button"
                    disabled={!allowedWrite || Boolean(working)}
                    onClick={() => void openPublish(job)}
                  >
                    <UploadCloud size={15} /> Prüfen & veröffentlichen
                  </button>
                )}
                {job.status === 'handed-off' && (
                  <>
                    <button
                      className="primary-button"
                      disabled={!allowedWrite || Boolean(working)}
                      onClick={() => {
                        setHandoffJob(job);
                        setHandoffCopied(false);
                        setManualPostUrl(job.manual_post_url ?? '');
                      }}
                    >
                      <CheckCircle2 size={15} /> Veröffentlichung bestätigen
                    </button>
                    <button
                      className="ghost-button"
                      disabled={!allowedWrite || Boolean(working)}
                      onClick={() => void handoff(job)}
                    >
                      <RefreshCw size={15} /> Erneut übergeben
                    </button>
                  </>
                )}
                {['queued', 'ready', 'handed-off', 'failed', 'cancelled'].includes(job.status) && (
                  <button
                    className="ghost-button"
                    disabled={!allowedWrite || Boolean(working)}
                    onClick={() => {
                      setEditingJob(job);
                      setEditCaption(job.caption);
                    }}
                  >
                    <PenLine size={15} /> Text
                  </button>
                )}
                {['failed', 'cancelled'].includes(job.status) && (
                  <button
                    className="ghost-button"
                    disabled={!allowedWrite || Boolean(working)}
                    onClick={() =>
                      void action(`retry-${job.id}`, async () => {
                        await api(`/api/tiktok-shorts/jobs/${job.id}/retry`, { method: 'POST' });
                      })
                    }
                  >
                    <RefreshCw size={15} /> Wiederholen
                  </button>
                )}
                {['queued', 'ready', 'handed-off', 'upload-queued'].includes(job.status) && (
                  <button
                    className="danger-button"
                    disabled={!allowedWrite || Boolean(working)}
                    onClick={() =>
                      void action(`cancel-${job.id}`, async () => {
                        await api(`/api/tiktok-shorts/jobs/${job.id}/cancel`, { method: 'POST' });
                      })
                    }
                  >
                    <X size={15} /> Stoppen
                  </button>
                )}
                {!['rendering', 'uploading', 'processing'].includes(job.status) && (
                  <button
                    className="danger-button"
                    disabled={!allowedWrite || Boolean(working)}
                    onClick={() => {
                      setDeleteJob(job);
                      setDeleteConfirmation('');
                    }}
                  >
                    <Trash2 size={15} /> Lokal löschen
                  </button>
                )}
              </div>
            </div>
          </article>
        ))}
      </div>
      {!dashboard.jobs.length && (
        <div className="shorts-empty">
          <Sparkles />
          <h3>Noch kein TikTok-Clip produziert</h3>
          <p>Sobald AVA eine qualifizierte Einordnung spricht, erstellt der lokale Worker die erste TikTok-Fassung.</p>
        </div>
      )}

      {settingsOpen && (
        <div className="modal-backdrop" role="dialog" aria-modal="true" aria-label="TikTok Creator Einstellungen">
          <div className="modal-card shorts-settings-modal">
            <div className="modal-header">
              <div>
                <p className="eyebrow">TikTok Shorts Creator</p>
                <h3>
                  <Settings2 size={20} /> Produktion und Verbindung
                </h3>
              </div>
              <button
                className="ghost-button icon-button"
                onClick={() => setSettingsOpen(false)}
                aria-label="Schließen"
              >
                <X size={18} />
              </button>
            </div>
            <div className="shorts-settings-grid">
              <section className="tiktok-publishing-mode">
                <h4>
                  <UploadCloud size={18} /> Veröffentlichungsweg
                </h4>
                <div className="tiktok-mode-grid">
                  <label className={`tiktok-mode-card ${draft.publishingMode === 'manual' ? 'selected' : ''}`}>
                    <input
                      type="radio"
                      name="tiktok-publishing-mode"
                      value="manual"
                      checked={draft.publishingMode === 'manual'}
                      onChange={() => setDraft({ ...draft, publishingMode: 'manual' })}
                    />
                    <span>
                      <strong>Freigabewarteschlange · empfohlen</strong>
                      <small>
                        Ohne Developer-App: Text kopieren, MP4 laden und TikToks offiziellen Uploader in einem Schritt
                        öffnen.
                      </small>
                    </span>
                  </label>
                  <label className={`tiktok-mode-card ${draft.publishingMode === 'api' ? 'selected' : ''}`}>
                    <input
                      type="radio"
                      name="tiktok-publishing-mode"
                      value="api"
                      checked={draft.publishingMode === 'api'}
                      onChange={() => setDraft({ ...draft, publishingMode: 'api' })}
                    />
                    <span>
                      <strong>Content Posting API · optional</strong>
                      <small>
                        Für geprüfte TikTok-Developer-Apps mit OAuth; die ausdrückliche Freigabe pro Clip bleibt aktiv.
                      </small>
                    </span>
                  </label>
                </div>
              </section>
              <section>
                <h4>
                  <Sparkles size={18} /> Produktion
                </h4>
                <label className="settings-option settings-toggle-option">
                  <span>Creator aktiv</span>
                  <span className="toggle-row">
                    <input
                      type="checkbox"
                      checked={draft.enabled}
                      onChange={(event) => setDraft({ ...draft, enabled: event.target.checked })}
                    />
                    TikTok-Fassungen lokal rendern
                  </span>
                </label>
                <label className="settings-option settings-toggle-option">
                  <span>Automatisch erstellen</span>
                  <span className="toggle-row">
                    <input
                      type="checkbox"
                      checked={draft.autoCreate}
                      onChange={(event) => setDraft({ ...draft, autoCreate: event.target.checked })}
                    />
                    Qualifizierte AVA-Momente übernehmen
                  </span>
                </label>
                <label className="settings-option">
                  <span>Maximal pro Tag</span>
                  <input
                    type="number"
                    min="0"
                    max="50"
                    value={draft.dailyLimit}
                    onChange={(event) => setDraft({ ...draft, dailyLimit: Number(event.target.value) })}
                  />
                </label>
                <label className="settings-option">
                  <span>Zeitzone</span>
                  <input
                    value={draft.timeZone}
                    onChange={(event) => setDraft({ ...draft, timeZone: event.target.value })}
                  />
                </label>
                <label className="settings-option">
                  <span>Standardtext</span>
                  <textarea
                    rows={4}
                    value={draft.captionTemplate}
                    onChange={(event) => setDraft({ ...draft, captionTemplate: event.target.value })}
                  />
                  <small>
                    Platzhalter: {'{title}'}, {'{channel}'}, {'{url}'}
                  </small>
                </label>
                <label className="settings-option">
                  <span>Programmaudio normal: {draft.sourceVolumePercent}%</span>
                  <input
                    type="range"
                    min="0"
                    max="150"
                    value={draft.sourceVolumePercent}
                    onChange={(event) => setDraft({ ...draft, sourceVolumePercent: Number(event.target.value) })}
                  />
                </label>
                <label className="settings-option">
                  <span>Programmaudio während AVA: {draft.sourceDuckPercent}%</span>
                  <input
                    type="range"
                    min="0"
                    max="100"
                    value={draft.sourceDuckPercent}
                    onChange={(event) => setDraft({ ...draft, sourceDuckPercent: Number(event.target.value) })}
                  />
                </label>
              </section>
              {draft.publishingMode === 'api' ? (
                <section className="shorts-oauth-section">
                  <h4>
                    <ShieldCheck size={18} /> TikTok Content Posting API
                  </h4>
                  <div className={`shorts-oauth-state ${dashboard.oauth.connected ? 'connected' : ''}`}>
                    <ShieldCheck />
                    <div>
                      <strong>
                        {dashboard.oauth.connected
                          ? `Verbunden mit ${dashboard.oauth.account?.nickname || 'TikTok'}`
                          : 'TikTok-App verbinden'}
                      </strong>
                      <span>Token und Secret bleiben ausschließlich auf dem Studio-Server.</span>
                    </div>
                  </div>
                  {allowedAdmin && (
                    <div className="shorts-oauth-fields">
                      <label className="settings-option">
                        <span>Client-Key</span>
                        <input
                          value={draft.clientKey}
                          onChange={(event) => setDraft({ ...draft, clientKey: event.target.value })}
                          placeholder={dashboard.oauth.clientKeyHint || 'TikTok Developer Client-Key'}
                        />
                      </label>
                      <label className="settings-option">
                        <span>Client-Secret</span>
                        <input
                          type="password"
                          value={draft.clientSecret}
                          onChange={(event) => setDraft({ ...draft, clientSecret: event.target.value })}
                          placeholder={dashboard.oauth.clientSecretHint || 'Nur zum Ändern eingeben'}
                        />
                      </label>
                      <label className="settings-option stream-target-wide">
                        <span>Autorisierte Redirect-URI</span>
                        <input
                          value={draft.redirectUri}
                          onChange={(event) => setDraft({ ...draft, redirectUri: event.target.value })}
                        />
                      </label>
                      <label className="settings-option settings-toggle-option stream-target-wide">
                        <span>TikTok-App-Prüfung</span>
                        <span className="toggle-row">
                          <input
                            type="checkbox"
                            checked={draft.appAudited}
                            onChange={(event) => setDraft({ ...draft, appAudited: event.target.checked })}
                          />
                          Die Content Posting API wurde von TikTok für öffentliche Posts geprüft
                        </span>
                        <small>
                          Nur aktivieren, wenn TikTok die App tatsächlich freigegeben hat. Sonst erzwingt das Studio
                          „Nur ich“.
                        </small>
                      </label>
                    </div>
                  )}
                  <div className="shorts-oauth-actions">
                    <button
                      className="ghost-button"
                      disabled={!allowedAdmin || Boolean(working)}
                      onClick={() => void testConnection()}
                    >
                      <RefreshCw size={16} /> Verbindung testen
                    </button>
                    <button
                      className="primary-button"
                      disabled={!allowedAdmin || !dashboard.oauth.clientConfigured || Boolean(working)}
                      onClick={() => void connect()}
                    >
                      <ExternalLink size={16} /> {dashboard.oauth.connected ? 'Neu verbinden' : 'Mit TikTok verbinden'}
                    </button>
                    {dashboard.oauth.connected && (
                      <button
                        className="danger-button"
                        disabled={!allowedAdmin || Boolean(working)}
                        onClick={() => void disconnect()}
                      >
                        Trennen
                      </button>
                    )}
                  </div>
                  <a
                    href="https://developers.tiktok.com/doc/content-posting-api-get-started-upload-content/"
                    target="_blank"
                    rel="noreferrer"
                  >
                    Offizielle TikTok-Einrichtung <ExternalLink size={13} />
                  </a>
                </section>
              ) : (
                <section className="tiktok-manual-mode-info">
                  <h4>
                    <ClipboardCheck size={18} /> Ohne Developer-App startklar
                  </h4>
                  <div className="shorts-oauth-state connected">
                    <CheckCircle2 />
                    <div>
                      <strong>Keine App-Freigabe und kein OAuth nötig</strong>
                      <span>
                        Die MP4 bleibt lokal, bis du sie bewusst über TikToks offiziellen Web-Uploader auswählst.
                      </span>
                    </div>
                  </div>
                  <small>
                    Aus Sicherheitsgründen darf eine Webseite das Datei-Auswahlfeld einer anderen Webseite nicht
                    automatisch befüllen. Open TV Studio erledigt Download, Textkopie und Öffnen des Uploaders; du
                    wählst dort nur noch die Datei und bestätigst den Post.
                  </small>
                  <a href="https://www.tiktok.com/upload" target="_blank" rel="noreferrer">
                    Offiziellen TikTok-Uploader öffnen <ExternalLink size={13} />
                  </a>
                </section>
              )}
            </div>
            <div className="modal-actions">
              <button className="ghost-button" onClick={() => setSettingsOpen(false)}>
                Abbrechen
              </button>
              <button
                className="primary-button"
                disabled={!allowedWrite || Boolean(working)}
                onClick={() => void saveSettings()}
              >
                {working === 'settings' ? <LoaderCircle className="spin" size={16} /> : <Save size={16} />} Speichern
              </button>
            </div>
          </div>
        </div>
      )}

      {publishJob && publishDraft && (
        <div className="modal-backdrop" role="dialog" aria-modal="true" aria-label="TikTok Veröffentlichung prüfen">
          <div className="modal-card shorts-edit-modal tiktok-publish-modal">
            <div className="modal-header">
              <div>
                <p className="eyebrow">Manuelle Direct-Post-Freigabe</p>
                <h3>
                  <Music2 size={20} /> TikTok-Veröffentlichung prüfen
                </h3>
              </div>
              <button className="ghost-button icon-button" onClick={() => setPublishJob(null)} aria-label="Schließen">
                <X size={18} />
              </button>
            </div>
            {creatorLoading ? (
              <div className="shorts-loading">
                <LoaderCircle className="spin" /> Aktuelle Creator-Einstellungen werden geladen …
              </div>
            ) : creator ? (
              <>
                <div className="tiktok-creator-card">
                  {creator.avatarUrl && <img src={creator.avatarUrl} alt="" />}
                  <div>
                    <small>Veröffentlichen als</small>
                    <strong>{creator.nickname || creator.username}</strong>
                    <span>
                      {creator.username ? `@${creator.username.replace(/^@/, '')}` : ''} · maximal{' '}
                      {creator.maxVideoPostDurationSec} Sekunden
                    </span>
                  </div>
                </div>
                <video
                  className="tiktok-publish-preview"
                  controls
                  preload="metadata"
                  src={`/api/tiktok-shorts/jobs/${publishJob.id}/video`}
                />
                <label className="settings-option">
                  <span>Beschreibung</span>
                  <textarea
                    rows={5}
                    maxLength={2200}
                    value={publishDraft.caption}
                    onChange={(event) => setPublishDraft({ ...publishDraft, caption: event.target.value })}
                  />
                  <small>{publishDraft.caption.length} / 2.200 Zeichen</small>
                </label>
                <label className="settings-option">
                  <span>Sichtbarkeit – bewusst auswählen</span>
                  <select
                    value={publishDraft.privacyLevel}
                    onChange={(event) => setPublishDraft({ ...publishDraft, privacyLevel: event.target.value })}
                  >
                    <option value="">Bitte auswählen …</option>
                    {creator.privacyLevelOptions
                      .filter((value) => dashboard.settings.app_audited || value === 'SELF_ONLY')
                      .map((value) => (
                        <option value={value} key={value}>
                          {privacyLabels[value] || value}
                        </option>
                      ))}
                  </select>
                  {!dashboard.settings.app_audited && (
                    <small>Bis zur TikTok-App-Prüfung ist nur „Nur ich“ verfügbar.</small>
                  )}
                </label>
                <div className="tiktok-interactions">
                  <label>
                    <input
                      type="checkbox"
                      checked={publishDraft.allowComment}
                      disabled={creator.commentDisabled}
                      onChange={(event) => setPublishDraft({ ...publishDraft, allowComment: event.target.checked })}
                    />{' '}
                    Kommentare erlauben
                  </label>
                  <label>
                    <input
                      type="checkbox"
                      checked={publishDraft.allowDuet}
                      disabled={creator.duetDisabled}
                      onChange={(event) => setPublishDraft({ ...publishDraft, allowDuet: event.target.checked })}
                    />{' '}
                    Duett erlauben
                  </label>
                  <label>
                    <input
                      type="checkbox"
                      checked={publishDraft.allowStitch}
                      disabled={creator.stitchDisabled}
                      onChange={(event) => setPublishDraft({ ...publishDraft, allowStitch: event.target.checked })}
                    />{' '}
                    Stitch erlauben
                  </label>
                </div>
                <div className="tiktok-commercial">
                  <strong>Kommerzielle Inhalte</strong>
                  <label>
                    <input
                      type="checkbox"
                      checked={publishDraft.brandOrganicToggle}
                      onChange={(event) =>
                        setPublishDraft({ ...publishDraft, brandOrganicToggle: event.target.checked })
                      }
                    />{' '}
                    Eigene Marke / eigenes Unternehmen
                  </label>
                  <label>
                    <input
                      type="checkbox"
                      checked={publishDraft.brandContentToggle}
                      onChange={(event) =>
                        setPublishDraft({ ...publishDraft, brandContentToggle: event.target.checked })
                      }
                    />{' '}
                    Bezahlte Partnerschaft / Markeninhalt
                  </label>
                </div>
                <div className="tiktok-consents">
                  <label>
                    <input
                      type="checkbox"
                      checked={publishDraft.rightsConfirmed}
                      onChange={(event) => setPublishDraft({ ...publishDraft, rightsConfirmed: event.target.checked })}
                    />{' '}
                    Ich besitze die erforderlichen Rechte am Video, Ausschnitt, Ton und an der redaktionellen
                    Bearbeitung.
                  </label>
                  <label>
                    <input
                      type="checkbox"
                      checked={publishDraft.musicUsageConfirmed}
                      onChange={(event) =>
                        setPublishDraft({ ...publishDraft, musicUsageConfirmed: event.target.checked })
                      }
                    />{' '}
                    Ich bestätige die TikTok Music Usage Confirmation; enthaltene Musik ist rechtmäßig nutzbar.
                  </label>
                  <label>
                    <input
                      type="checkbox"
                      checked={publishDraft.publishConsent}
                      onChange={(event) => setPublishDraft({ ...publishDraft, publishConsent: event.target.checked })}
                    />{' '}
                    Ich veröffentliche diesen konkreten Clip jetzt bewusst bei TikTok. KI-generierter Inhalt wird als
                    AIGC gekennzeichnet.
                  </label>
                </div>
              </>
            ) : (
              <div className="shorts-load-error">
                <AlertTriangle />
                <p>Das aktuelle TikTok-Creator-Profil konnte nicht geladen werden.</p>
              </div>
            )}
            <div className="modal-actions">
              <button className="ghost-button" onClick={() => setPublishJob(null)}>
                Abbrechen
              </button>
              <button
                className="primary-button"
                disabled={!publishReady || Boolean(working)}
                onClick={() => void publish()}
              >
                {working.startsWith('publish-') ? (
                  <LoaderCircle className="spin" size={16} />
                ) : (
                  <UploadCloud size={16} />
                )}{' '}
                Jetzt bei TikTok veröffentlichen
              </button>
            </div>
          </div>
        </div>
      )}

      {handoffJob && (
        <div className="modal-backdrop" role="dialog" aria-modal="true" aria-label="TikTok Übergabe abschließen">
          <div className="modal-card shorts-edit-modal tiktok-handoff-modal">
            <div className="modal-header">
              <div>
                <p className="eyebrow">Freigabewarteschlange</p>
                <h3>
                  <ClipboardCheck size={20} /> Clip an TikTok übergeben
                </h3>
              </div>
              <button className="ghost-button icon-button" onClick={() => setHandoffJob(null)} aria-label="Schließen">
                <X size={18} />
              </button>
            </div>
            <div className="tiktok-handoff-state">
              <CheckCircle2 />
              <div>
                <strong>Übergabe vorbereitet</strong>
                <span>
                  {handoffCopied
                    ? 'Der Beschreibungstext ist in der Zwischenablage.'
                    : 'Kopiere den Beschreibungstext bei Bedarf mit dem Button unten.'}{' '}
                  Die MP4 steht als Download bereit.
                </span>
              </div>
            </div>
            <ol className="tiktok-handoff-checklist">
              <li>Wähle im geöffneten TikTok-Uploader die heruntergeladene MP4 aus.</li>
              <li>Füge den kopierten Beschreibungstext ein und kontrolliere Titel, Sichtbarkeit und Rechte.</li>
              <li>Kennzeichne den Clip in TikTok als KI-generiert und veröffentliche ihn bewusst.</li>
              <li>Bestätige die Veröffentlichung anschließend hier für ein sauberes Produktionsjournal.</li>
            </ol>
            <label className="settings-option">
              <span>Beschreibung</span>
              <textarea value={handoffJob.caption} rows={5} readOnly />
            </label>
            <div className="shorts-oauth-actions">
              <button
                className="ghost-button"
                onClick={() =>
                  void copyText(handoffJob.caption).then((copied) => {
                    setHandoffCopied(copied);
                    setMessage(
                      copied ? 'TikTok-Text wurde kopiert.' : 'Der Text konnte nicht automatisch kopiert werden.',
                    );
                  })
                }
              >
                <ClipboardCheck size={16} /> Text kopieren
              </button>
              <a className="ghost-button" href={`/api/tiktok-shorts/jobs/${handoffJob.id}/video?download=1`} download>
                <Download size={16} /> MP4 laden
              </a>
              <a
                className="primary-button"
                href={dashboard.compliance.manualUploadUrl}
                target="_blank"
                rel="noreferrer"
              >
                <ExternalLink size={16} /> TikTok-Uploader öffnen
              </a>
            </div>
            <label className="settings-option">
              <span>TikTok-Post-URL (optional)</span>
              <input
                type="url"
                value={manualPostUrl}
                placeholder="https://www.tiktok.com/@kanal/video/…"
                onChange={(event) => setManualPostUrl(event.target.value)}
              />
              <small>Kann nach dem Posten eingefügt werden; die Bestätigung funktioniert auch ohne URL.</small>
            </label>
            <div className="modal-actions">
              <button className="ghost-button" onClick={() => setHandoffJob(null)}>
                Später bestätigen
              </button>
              <button
                className="primary-button"
                disabled={Boolean(working)}
                onClick={() => void confirmManualPublish()}
              >
                {working.startsWith('manual-published-') ? (
                  <LoaderCircle className="spin" size={16} />
                ) : (
                  <CheckCircle2 size={16} />
                )}{' '}
                Als veröffentlicht markieren
              </button>
            </div>
          </div>
        </div>
      )}

      {editingJob && (
        <div className="modal-backdrop" role="dialog" aria-modal="true">
          <div className="modal-card shorts-edit-modal">
            <div className="modal-header">
              <h3>TikTok-Text bearbeiten</h3>
              <button className="ghost-button icon-button" onClick={() => setEditingJob(null)}>
                <X size={18} />
              </button>
            </div>
            <label className="settings-option">
              <span>Beschreibung</span>
              <textarea
                rows={7}
                maxLength={2200}
                value={editCaption}
                onChange={(event) => setEditCaption(event.target.value)}
              />
            </label>
            <div className="modal-actions">
              <button className="ghost-button" onClick={() => setEditingJob(null)}>
                Abbrechen
              </button>
              <button
                className="primary-button"
                disabled={!editCaption.trim() || Boolean(working)}
                onClick={() =>
                  void action(`edit-${editingJob.id}`, async () => {
                    await api(`/api/tiktok-shorts/jobs/${editingJob.id}`, {
                      method: 'PATCH',
                      body: JSON.stringify({ caption: editCaption }),
                    });
                    setEditingJob(null);
                    setMessage('TikTok-Text wurde gespeichert.');
                  })
                }
              >
                <Save size={16} /> Speichern
              </button>
            </div>
          </div>
        </div>
      )}

      {deleteJob && (
        <div className="modal-backdrop" role="dialog" aria-modal="true">
          <div className="modal-card shorts-edit-modal">
            <div className="modal-header">
              <h3>Lokalen TikTok-Clip löschen</h3>
              <button className="ghost-button icon-button" onClick={() => setDeleteJob(null)}>
                <X size={18} />
              </button>
            </div>
            <p>
              Dies entfernt Auftrag und lokale MP4. Ein bereits veröffentlichter Post bleibt bei TikTok und muss dort
              gelöscht werden.
            </p>
            <label className="settings-option">
              <span>Zur Bestätigung LÖSCHEN eingeben</span>
              <input value={deleteConfirmation} onChange={(event) => setDeleteConfirmation(event.target.value)} />
            </label>
            <div className="modal-actions">
              <button className="ghost-button" onClick={() => setDeleteJob(null)}>
                Abbrechen
              </button>
              <button
                className="danger-button"
                disabled={deleteConfirmation !== 'LÖSCHEN' || Boolean(working)}
                onClick={() =>
                  void action(`delete-${deleteJob.id}`, async () => {
                    const result = await api<{ warning?: string | null }>(`/api/tiktok-shorts/jobs/${deleteJob.id}`, {
                      method: 'DELETE',
                      body: JSON.stringify({ confirmation: deleteConfirmation }),
                    });
                    setDeleteJob(null);
                    setMessage(result.warning || 'Der lokale TikTok-Clip wurde gelöscht.');
                  })
                }
              >
                <Trash2 size={16} /> Lokal löschen
              </button>
            </div>
          </div>
        </div>
      )}
    </section>
  );
}
