import React, { useEffect, useMemo, useRef, useState } from 'react';
import {
  AlertTriangle,
  CheckCircle2,
  CirclePlay,
  Clock3,
  CloudOff,
  Download,
  ExternalLink,
  Film,
  LoaderCircle,
  PenLine,
  Play,
  RefreshCw,
  Save,
  Scissors,
  Search,
  Settings2,
  ShieldCheck,
  Sparkles,
  UploadCloud,
  WandSparkles,
  X,
  Trash2,
} from 'lucide-react';
import { api, can, type SessionUser } from '../api/client.js';

type ShortStatus =
  | 'queued'
  | 'downloading'
  | 'rendering'
  | 'ready'
  | 'upload-queued'
  | 'uploading'
  | 'uploaded'
  | 'failed'
  | 'cancelled';

type ShortsSettings = {
  enabled: boolean;
  auto_create: boolean;
  auto_upload: boolean;
  daily_limit: number;
  duration_seconds: 90;
  privacy_status: 'private' | 'unlisted' | 'public';
  rights_confirmed: boolean;
  source_volume_percent: number;
  source_duck_percent: number;
  title_template: string;
  description_template: string;
  tags: string[];
  time_zone: string;
  overlay_path: string;
  youtube_channel_id: string;
};

type YoutubeChannel = {
  id: string;
  title: string;
  handle: string;
  connectedAt: string;
};

type ShortJob = {
  id: string;
  status: ShortStatus;
  progress: number;
  source_title: string;
  source_channel: string;
  source_url: string;
  commentary_headline: string;
  commentary_text: string;
  commentary_model: string;
  clip_start_seconds: number;
  output_path: string | null;
  youtube_upload_id: string | null;
  youtube_upload_url: string | null;
  upload_privacy: string | null;
  error: string | null;
  created_at: string;
  uploaded_at: string | null;
  metadata: {
    youtubeRemoteState?: 'available' | 'missing' | 'reupload-queued';
    youtubeCheckedAt?: string;
    uploadedChannelId?: string;
    [key: string]: unknown;
  };
  publication: {
    title: string;
    description: string;
    tags: string[];
    privacyStatus: 'private' | 'unlisted' | 'public';
  };
};

type Dashboard = {
  settings: ShortsSettings;
  summary: {
    productionDate: string;
    today: number;
    remaining: number;
    counts: Partial<Record<ShortStatus, number>>;
  };
  jobs: ShortJob[];
  oauth: {
    clientConfigured: boolean;
    connected: boolean;
    clientIdHint: string;
    clientSecretHint: string;
    redirectUri: string;
    scopes: string[];
    dataApiConfigured: boolean;
    dataApiKeyHint: string;
    researchReady: boolean;
    uploadReady: boolean;
    channels: YoutubeChannel[];
    channelDiscoveryInProgress: boolean;
    channelDiscoveryError: string;
  };
  overlayUrl: string;
  prerequisites: {
    overlay: boolean;
    ffmpeg: boolean;
    ytDlp: boolean;
    oauth: boolean;
    channel: boolean;
    rights: boolean;
  };
};

type SettingsDraft = {
  enabled: boolean;
  autoCreate: boolean;
  autoUpload: boolean;
  dailyLimit: number;
  privacyStatus: 'private' | 'unlisted' | 'public';
  rightsConfirmed: boolean;
  sourceVolumePercent: number;
  sourceDuckPercent: number;
  titleTemplate: string;
  descriptionTemplate: string;
  tags: string;
  timeZone: string;
  youtubeChannelId: string;
};

type JobDraft = {
  title: string;
  description: string;
  tags: string;
  privacyStatus: 'private' | 'unlisted' | 'public';
  commentaryHeadline: string;
  commentaryText: string;
  rerender: boolean;
  syncYoutube: boolean;
};

const statusLabels: Record<ShortStatus, string> = {
  queued: 'Eingeplant',
  downloading: 'Ausschnitt wird geladen',
  rendering: 'Wird gerendert',
  ready: 'Bereit',
  'upload-queued': 'Upload eingeplant',
  uploading: 'Wird hochgeladen',
  uploaded: 'Auf YouTube',
  failed: 'Fehlgeschlagen',
  cancelled: 'Abgebrochen',
};

function settingsDraft(settings: ShortsSettings, channels: YoutubeChannel[]): SettingsDraft {
  return {
    enabled: settings.enabled,
    autoCreate: settings.auto_create,
    autoUpload: settings.auto_upload,
    dailyLimit: settings.daily_limit,
    privacyStatus: settings.privacy_status,
    rightsConfirmed: settings.rights_confirmed,
    sourceVolumePercent: settings.source_volume_percent,
    sourceDuckPercent: settings.source_duck_percent,
    titleTemplate: settings.title_template,
    descriptionTemplate: settings.description_template,
    tags: settings.tags.join(', '),
    timeZone: settings.time_zone,
    youtubeChannelId: settings.youtube_channel_id || (channels.length === 1 ? channels[0]!.id : ''),
  };
}

function localDate(value: string | null) {
  if (!value) return '–';
  const date = new Date(value);
  return Number.isNaN(date.getTime()) ? '–' : date.toLocaleString('de-DE');
}

function clipTime(seconds: number) {
  const value = Math.max(0, Math.round(seconds));
  return `${Math.floor(value / 60)}:${String(value % 60).padStart(2, '0')}`;
}

export function YoutubeShortsPage({ user }: { user: SessionUser }) {
  const [dashboard, setDashboard] = useState<Dashboard | null>(null);
  const [draft, setDraft] = useState<SettingsDraft | null>(null);
  const [settingsOpen, setSettingsOpen] = useState(false);
  const [overlayFile, setOverlayFile] = useState<File | null>(null);
  const [working, setWorking] = useState('');
  const [message, setMessage] = useState('');
  const [error, setError] = useState('');
  const [jobSearch, setJobSearch] = useState('');
  const [jobFilter, setJobFilter] = useState<'all' | ShortStatus>('all');
  const [editingJob, setEditingJob] = useState<ShortJob | null>(null);
  const [jobDraft, setJobDraft] = useState<JobDraft | null>(null);
  const [deletingJob, setDeletingJob] = useState<ShortJob | null>(null);
  const [deleteRemote, setDeleteRemote] = useState(false);
  const [deleteConfirmation, setDeleteConfirmation] = useState('');
  const lastAutomaticReconcileAt = useRef(0);
  const reconcileInFlight = useRef(false);
  const loadInFlight = useRef(false);
  const allowedWrite = can(user, 'broadcast:write');
  const allowedAdmin = can(user, 'users:write');

  async function load(silent = false) {
    if (loadInFlight.current) return;
    loadInFlight.current = true;
    try {
      const next = await api<Dashboard>('/api/youtube-shorts', { signal: AbortSignal.timeout(20_000) });
      setDashboard(next);
      if (!silent) setDraft(settingsDraft(next.settings, next.oauth.channels));
      if (!silent) setError('');
      if (
        allowedWrite &&
        next.oauth.connected &&
        next.jobs.some((job) => job.status === 'uploaded') &&
        Date.now() - lastAutomaticReconcileAt.current >= 5 * 60_000
      ) {
        lastAutomaticReconcileAt.current = Date.now();
        window.setTimeout(() => void reconcileYoutube(true), 0);
      }
    } catch (requestError) {
      if (!silent) setError(requestError instanceof Error ? requestError.message : String(requestError));
    } finally {
      loadInFlight.current = false;
    }
  }

  useEffect(() => {
    void load();
    const timer = window.setInterval(() => void load(true), 7000);
    const oauthState = new URLSearchParams(window.location.hash.split('?', 2)[1] ?? '').get('oauth');
    if (oauthState === 'connected') setMessage('YouTube wurde erfolgreich verbunden.');
    else if (oauthState === 'denied') setError('Die YouTube-Verbindung wurde nicht freigegeben.');
    else if (oauthState === 'failed') setError('YouTube OAuth konnte nicht abgeschlossen werden.');
    return () => window.clearInterval(timer);
  }, []);

  async function saveSettings() {
    if (!draft || !allowedWrite || working) return;
    setWorking('settings');
    setError('');
    try {
      await api('/api/youtube-shorts/settings', {
        method: 'PATCH',
        body: JSON.stringify({
          ...draft,
          tags: draft.tags
            .split(',')
            .map((tag) => tag.trim())
            .filter(Boolean),
        }),
      });
      if (overlayFile) {
        const form = new FormData();
        form.append('file', overlayFile);
        await api('/api/youtube-shorts/overlay', { method: 'POST', body: form });
        setOverlayFile(null);
      }
      setMessage('Shorts-Automation gespeichert.');
      setSettingsOpen(false);
      await load();
    } catch (requestError) {
      setError(requestError instanceof Error ? requestError.message : String(requestError));
    } finally {
      setWorking('');
    }
  }

  async function connectOauth() {
    if (!allowedAdmin || working) return;
    setWorking('oauth-connect');
    setError('');
    try {
      const result = await api<{ url: string }>('/api/youtube/oauth/start', {
        method: 'POST',
        body: JSON.stringify({ returnTo: '/youtube-shorts' }),
      });
      window.location.assign(result.url);
    } catch (requestError) {
      setError(requestError instanceof Error ? requestError.message : String(requestError));
      setWorking('');
    }
  }

  async function testOauth() {
    setWorking('oauth-test');
    try {
      const result = await api<{ message: string }>('/api/youtube/oauth/test', {
        method: 'POST',
        body: JSON.stringify({ channelId: draft?.youtubeChannelId || undefined }),
      });
      setMessage(result.message);
    } catch (requestError) {
      setError(requestError instanceof Error ? requestError.message : String(requestError));
    } finally {
      setWorking('');
    }
  }

  async function disconnectOauth() {
    if (!window.confirm('YouTube-Upload und automatische Senderchat-Erkennung trennen?')) return;
    setWorking('oauth-disconnect');
    try {
      await api('/api/youtube/oauth', { method: 'DELETE' });
      setMessage('YouTube wurde getrennt.');
      await load();
    } catch (requestError) {
      setError(requestError instanceof Error ? requestError.message : String(requestError));
    } finally {
      setWorking('');
    }
  }

  async function createCurrent() {
    if (!allowedWrite || working) return;
    setWorking('create');
    setError('');
    try {
      await api('/api/youtube-shorts/create-current', { method: 'POST' });
      setMessage('Das aktuelle AVA-Segment wurde für einen Short vorgemerkt.');
      await load();
    } catch (requestError) {
      setError(requestError instanceof Error ? requestError.message : String(requestError));
    } finally {
      setWorking('');
    }
  }

  async function jobAction(job: ShortJob, action: 'retry' | 'upload' | 'reupload' | 'cancel') {
    if (!allowedWrite || working) return;
    setWorking(`${job.id}:${action}`);
    try {
      await api(`/api/youtube-shorts/jobs/${job.id}/${action}`, { method: 'POST' });
      setMessage(
        action === 'upload'
          ? 'YouTube-Upload eingeplant.'
          : action === 'reupload'
            ? 'Der extern gelöschte Short wird erneut hochgeladen.'
            : action === 'retry'
              ? 'Erneut eingeplant.'
              : 'Auftrag abgebrochen.',
      );
      await load();
    } catch (requestError) {
      setError(requestError instanceof Error ? requestError.message : String(requestError));
    } finally {
      setWorking('');
    }
  }

  async function reconcileYoutube(silent = false) {
    if (!allowedWrite || reconcileInFlight.current || (working && !silent)) return;
    reconcileInFlight.current = true;
    if (!silent) setWorking('reconcile');
    try {
      const result = await api<{ checked: number; missing: number; skipped: number; warnings: string[] }>(
        '/api/youtube-shorts/reconcile',
        { method: 'POST' },
      );
      if (!silent)
        setMessage(
          result.missing
            ? `${result.checked} YouTube-Shorts geprüft; ${result.missing} extern gelöschte Videos erkannt.`
            : `${result.checked} YouTube-Shorts geprüft; alle veröffentlichten Videos sind vorhanden.`,
        );
      if (result.warnings.length && !silent) setError(result.warnings[0]!);
      await load(true);
    } catch (requestError) {
      if (!silent) setError(requestError instanceof Error ? requestError.message : String(requestError));
    } finally {
      reconcileInFlight.current = false;
      if (!silent) setWorking('');
    }
  }

  function editJob(job: ShortJob) {
    setEditingJob(job);
    setJobDraft({
      title: job.publication.title,
      description: job.publication.description,
      tags: job.publication.tags.join(', '),
      privacyStatus: job.publication.privacyStatus,
      commentaryHeadline: job.commentary_headline,
      commentaryText: job.commentary_text,
      rerender: false,
      syncYoutube: job.status === 'uploaded' && job.metadata.youtubeRemoteState !== 'missing',
    });
  }

  async function saveJob() {
    if (!editingJob || !jobDraft || !allowedWrite || working) return;
    setWorking(`edit:${editingJob.id}`);
    setError('');
    try {
      const result = await api<{ warning?: string | null }>(`/api/youtube-shorts/jobs/${editingJob.id}`, {
        method: 'PATCH',
        body: JSON.stringify({
          commentaryHeadline: jobDraft.commentaryHeadline,
          commentaryText: jobDraft.commentaryText,
          publication: {
            title: jobDraft.title,
            description: jobDraft.description,
            tags: jobDraft.tags
              .split(',')
              .map((tag) => tag.trim())
              .filter(Boolean),
            privacyStatus: jobDraft.privacyStatus,
          },
          rerender: jobDraft.rerender,
          syncYoutube: editingJob.status === 'uploaded' && jobDraft.syncYoutube,
          channelId: draft?.youtubeChannelId || undefined,
        }),
      });
      setMessage(
        result.warning ||
          (editingJob.status === 'uploaded' && jobDraft.syncYoutube
            ? 'Short-Daten wurden lokal und auf YouTube aktualisiert.'
            : jobDraft.rerender ||
                jobDraft.commentaryHeadline !== editingJob.commentary_headline ||
                jobDraft.commentaryText !== editingJob.commentary_text
              ? 'Änderungen gespeichert; der Short wird neu gerendert.'
              : 'Short-Daten gespeichert.'),
      );
      setEditingJob(null);
      setJobDraft(null);
      await load();
    } catch (requestError) {
      setError(requestError instanceof Error ? requestError.message : String(requestError));
    } finally {
      setWorking('');
    }
  }

  function requestDelete(job: ShortJob) {
    setDeletingJob(job);
    setDeleteRemote(false);
    setDeleteConfirmation('');
  }

  async function deleteJob() {
    if (!deletingJob || deleteConfirmation !== 'LÖSCHEN' || !allowedWrite || working) return;
    setWorking(`delete:${deletingJob.id}`);
    setError('');
    try {
      await api(`/api/youtube-shorts/jobs/${deletingJob.id}`, {
        method: 'DELETE',
        body: JSON.stringify({
          confirmation: 'LÖSCHEN',
          deleteFromYoutube: deleteRemote,
          channelId: draft?.youtubeChannelId || undefined,
        }),
      });
      setMessage(
        deleteRemote
          ? 'Short wurde im Studio und endgültig auf YouTube gelöscht.'
          : 'Short-Produktion wurde lokal gelöscht.',
      );
      setDeletingJob(null);
      await load();
    } catch (requestError) {
      setError(requestError instanceof Error ? requestError.message : String(requestError));
    } finally {
      setWorking('');
    }
  }

  const setupReady = useMemo(
    () =>
      Boolean(
        dashboard &&
        dashboard.prerequisites.overlay &&
        dashboard.prerequisites.ffmpeg &&
        dashboard.prerequisites.ytDlp &&
        (!dashboard.settings.auto_upload ||
          (dashboard.prerequisites.oauth && dashboard.prerequisites.channel && dashboard.prerequisites.rights)),
      ),
    [dashboard],
  );

  const filteredJobs = useMemo(() => {
    const needle = jobSearch.trim().toLocaleLowerCase('de-DE');
    return (dashboard?.jobs ?? []).filter(
      (job) =>
        (jobFilter === 'all' || job.status === jobFilter) &&
        (!needle ||
          [job.source_title, job.source_channel, job.commentary_headline, job.publication.title].some((value) =>
            value.toLocaleLowerCase('de-DE').includes(needle),
          )),
    );
  }, [dashboard?.jobs, jobFilter, jobSearch]);

  if (!dashboard || !draft) {
    return (
      <section className="panel shorts-page">
        {error ? (
          <div className="shorts-load-error" role="alert">
            <AlertTriangle />
            <div>
              <h2>Shorts Creator konnte nicht geladen werden</h2>
              <p>{error}</p>
              <button className="primary-button" onClick={() => void load()}>
                <RefreshCw size={16} /> Erneut versuchen
              </button>
            </div>
          </div>
        ) : (
          <span className="shorts-loading">
            <LoaderCircle className="spin" /> Shorts Creator wird geladen …
          </span>
        )}
      </section>
    );
  }

  const selectedChannel = dashboard.oauth.channels.find((channel) => channel.id === draft.youtubeChannelId);

  return (
    <section className="panel shorts-page">
      <div className="shorts-hero">
        <div>
          <p className="eyebrow">Automation · Vertical Video</p>
          <h2>YouTube Shorts Creator</h2>
          <p>Verwandelt qualifizierte „Einordnung mit AVA“-Momente automatisch in sendefertige 90-Sekunden-Shorts.</p>
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
            <strong>
              {(dashboard.summary.counts.queued ?? 0) +
                (dashboard.summary.counts.rendering ?? 0) +
                (dashboard.summary.counts.downloading ?? 0)}
            </strong>
            <span>wartend oder aktiv</span>
          </div>
        </article>
        <article>
          <UploadCloud />
          <div>
            <small>YouTube</small>
            <strong>{dashboard.summary.counts.uploaded ?? 0}</strong>
            <span>
              {selectedChannel?.title || (dashboard.oauth.connected ? 'Zielkanal wählen' : 'noch nicht verbunden')}
            </span>
          </div>
        </article>
        <article className={setupReady ? 'ready' : 'attention'}>
          {setupReady ? <CheckCircle2 /> : <AlertTriangle />}
          <div>
            <small>Automatik</small>
            <strong>{setupReady ? 'Startklar' : 'Einrichtung offen'}</strong>
            <span>{dashboard.settings.enabled ? 'Creator aktiviert' : 'Creator pausiert'}</span>
          </div>
        </article>
      </div>

      <div className="shorts-workflow">
        {[
          ['1', 'Transkript', 'Nur Videos mit echtem, zeitcodiertem Transkript.'],
          ['2', 'AVA-Einordnung', 'Ein KI-Modell muss eine inhaltlich belastbare Einordnung geliefert haben.'],
          [
            '3',
            '90-Sekunden-Schnitt',
            'Ausschnitt, AVA-Sprechvideo, Idle-Loop und PNG-Design werden synchron gerendert.',
          ],
          ['4', 'YouTube Upload', 'Upload erst nach OAuth und bestätigten Nutzungsrechten.'],
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
          <h3>Shorts verwalten</h3>
        </div>
        <div className="shorts-management-tools">
          <label className="shorts-search">
            <Search size={16} />
            <input
              value={jobSearch}
              onChange={(event) => setJobSearch(event.target.value)}
              placeholder="Titel oder Kanal suchen"
              aria-label="Shorts durchsuchen"
            />
          </label>
          <select
            value={jobFilter}
            onChange={(event) => setJobFilter(event.target.value as 'all' | ShortStatus)}
            aria-label="Shorts nach Status filtern"
          >
            <option value="all">Alle Status</option>
            {Object.entries(statusLabels).map(([value, label]) => (
              <option key={value} value={value}>
                {label}
              </option>
            ))}
          </select>
          <button className="ghost-button" disabled={Boolean(working)} onClick={() => void reconcileYoutube()}>
            <RefreshCw className={working === 'reconcile' ? 'spin' : ''} size={16} /> YouTube abgleichen
          </button>
        </div>
      </div>

      <div className="shorts-job-grid">
        {filteredJobs.map((job) => (
          <article className={`short-job status-${job.status}`} key={job.id}>
            <div className="short-job-preview">
              {job.output_path ? (
                <video controls preload="metadata" src={`/api/youtube-shorts/jobs/${job.id}/video`} />
              ) : (
                <div>
                  <Scissors size={36} />
                  <span>{job.progress}%</span>
                </div>
              )}
              <span className="short-status">{statusLabels[job.status]}</span>
              {job.metadata.youtubeRemoteState === 'missing' && (
                <span className="short-remote-missing">
                  <CloudOff size={13} /> Auf YouTube gelöscht
                </span>
              )}
            </div>
            <div className="short-job-body">
              <div className="short-job-source">
                <CirclePlay size={15} />
                <span>{job.source_channel}</span>
                <small>Ausschnitt ab {clipTime(job.clip_start_seconds)}</small>
              </div>
              <h3>{job.source_title}</h3>
              <div className="short-publication-title">YouTube: {job.publication.title}</div>
              <strong>{job.commentary_headline}</strong>
              <p>{job.commentary_text}</p>
              <div className="short-progress">
                <i style={{ width: `${job.progress}%` }} />
              </div>
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
                {job.youtube_upload_url && job.metadata.youtubeRemoteState !== 'missing' && (
                  <a className="primary-button" href={job.youtube_upload_url} target="_blank" rel="noreferrer">
                    <CirclePlay size={15} /> YouTube
                  </a>
                )}
                {job.output_path && (
                  <a className="ghost-button" href={`/api/youtube-shorts/jobs/${job.id}/video`} download>
                    <Download size={15} /> MP4
                  </a>
                )}
                {!['downloading', 'rendering', 'uploading'].includes(job.status) && (
                  <button
                    className="ghost-button"
                    disabled={!allowedWrite || Boolean(working)}
                    onClick={() => editJob(job)}
                  >
                    <PenLine size={15} /> Bearbeiten
                  </button>
                )}
                {job.status === 'ready' && (
                  <button
                    className="ghost-button"
                    disabled={!allowedWrite || Boolean(working)}
                    onClick={() => void jobAction(job, 'upload')}
                  >
                    <UploadCloud size={15} /> Hochladen
                  </button>
                )}
                {job.status === 'uploaded' && job.metadata.youtubeRemoteState === 'missing' && job.output_path && (
                  <button
                    className="primary-button"
                    disabled={!allowedWrite || Boolean(working)}
                    onClick={() => void jobAction(job, 'reupload')}
                  >
                    <UploadCloud size={15} /> Neu hochladen
                  </button>
                )}
                {['failed', 'cancelled'].includes(job.status) && (
                  <button
                    className="ghost-button"
                    disabled={!allowedWrite || Boolean(working)}
                    onClick={() => void jobAction(job, 'retry')}
                  >
                    <RefreshCw size={15} /> Wiederholen
                  </button>
                )}
                {!['uploaded', 'cancelled', 'failed'].includes(job.status) && (
                  <button
                    className="danger-button"
                    disabled={!allowedWrite || Boolean(working)}
                    onClick={() => void jobAction(job, 'cancel')}
                  >
                    <X size={15} /> Stoppen
                  </button>
                )}
                {!['downloading', 'rendering', 'uploading'].includes(job.status) && (
                  <button
                    className="danger-button"
                    disabled={!allowedWrite || Boolean(working)}
                    onClick={() => requestDelete(job)}
                  >
                    <Trash2 size={15} /> Löschen
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
          <h3>Noch kein Short produziert</h3>
          <p>
            Sobald AVA eine qualifizierte Transkript-Einordnung spricht, wird der erste Auftrag automatisch angelegt.
          </p>
        </div>
      )}
      {dashboard.jobs.length > 0 && !filteredJobs.length && (
        <div className="shorts-empty compact">
          <Search />
          <h3>Keine passenden Shorts</h3>
          <p>Ändere Suchbegriff oder Statusfilter.</p>
        </div>
      )}

      {settingsOpen && (
        <div className="modal-backdrop" role="dialog" aria-modal="true" aria-label="YouTube Shorts Einstellungen">
          <div className="modal-card shorts-settings-modal">
            <div className="modal-header">
              <div>
                <p className="eyebrow">YouTube Shorts Creator</p>
                <h3>
                  <Settings2 size={20} /> Automation einrichten
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
                    Qualifizierte AVA-Momente verarbeiten
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
                    Während „Einordnung mit AVA“ vormerken
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
                  <small>0 pausiert neue Produktionen. Gezählt wird in der gewählten Zeitzone.</small>
                </label>
                <label className="settings-option">
                  <span>Zeitzone</span>
                  <input
                    value={draft.timeZone}
                    onChange={(event) => setDraft({ ...draft, timeZone: event.target.value })}
                  />
                </label>
                <label className="settings-option">
                  <span>Programmaudio normal</span>
                  <input
                    type="range"
                    min="0"
                    max="150"
                    value={draft.sourceVolumePercent}
                    onChange={(event) => setDraft({ ...draft, sourceVolumePercent: Number(event.target.value) })}
                  />
                  <small>{draft.sourceVolumePercent}%</small>
                </label>
                <label className="settings-option">
                  <span>Programmaudio während AVA</span>
                  <input
                    type="range"
                    min="0"
                    max="100"
                    value={draft.sourceDuckPercent}
                    onChange={(event) => setDraft({ ...draft, sourceDuckPercent: Number(event.target.value) })}
                  />
                  <small>{draft.sourceDuckPercent}%</small>
                </label>
              </section>

              <section>
                <h4>
                  <Film size={18} /> Design und Metadaten
                </h4>
                <div className="short-overlay-preview">
                  <img
                    src={`${dashboard.overlayUrl}?v=${encodeURIComponent(dashboard.settings.overlay_path ?? '')}`}
                    alt="Shorts PNG Overlay"
                  />
                </div>
                <label className="settings-option">
                  <span>PNG-Overlay austauschen</span>
                  <input
                    type="file"
                    accept="image/png"
                    onChange={(event) => setOverlayFile(event.target.files?.[0] ?? null)}
                  />
                  <small>Empfohlen: transparentes 9:16-PNG, zum Beispiel 1080 × 1920.</small>
                </label>
                <label className="settings-option">
                  <span>Titelvorlage</span>
                  <input
                    value={draft.titleTemplate}
                    onChange={(event) => setDraft({ ...draft, titleTemplate: event.target.value })}
                  />
                  <small>
                    Platzhalter: {'{title}'}, {'{channel}'}, {'{url}'}
                  </small>
                </label>
                <label className="settings-option">
                  <span>Beschreibung</span>
                  <textarea
                    value={draft.descriptionTemplate}
                    onChange={(event) => setDraft({ ...draft, descriptionTemplate: event.target.value })}
                  />
                </label>
                <label className="settings-option">
                  <span>Tags, kommagetrennt</span>
                  <input value={draft.tags} onChange={(event) => setDraft({ ...draft, tags: event.target.value })} />
                </label>
              </section>

              <section className="shorts-oauth-section">
                <h4>
                  <CirclePlay size={18} /> YouTube-Verbindung
                </h4>
                <div className="youtube-capability-grid">
                  <div className={`shorts-oauth-state ${dashboard.oauth.dataApiConfigured ? 'connected' : ''}`}>
                    {dashboard.oauth.dataApiConfigured ? <CheckCircle2 /> : <ShieldCheck />}
                    <div>
                      <strong>
                        {dashboard.oauth.dataApiConfigured
                          ? 'Zentrale YouTube-API wird verwendet'
                          : 'YouTube-Recherche nicht verbunden'}
                      </strong>
                      <span>
                        {dashboard.oauth.dataApiConfigured
                          ? `Der vorhandene Data-API-Key aus der Medien-Engine wird automatisch übernommen (${dashboard.oauth.dataApiKeyHint}).`
                          : 'Den Data-API-Key einmal zentral unter System → Medien-Engine hinterlegen.'}
                      </span>
                    </div>
                  </div>
                  <div className={`shorts-oauth-state ${dashboard.oauth.uploadReady ? 'connected' : ''}`}>
                    {dashboard.oauth.uploadReady ? <CheckCircle2 /> : <UploadCloud />}
                    <div>
                      <strong>
                        {dashboard.oauth.uploadReady
                          ? 'YouTube-Kanal für Uploads freigegeben'
                          : 'Upload-Freigabe fehlt'}
                      </strong>
                      <span>
                        {dashboard.oauth.uploadReady
                          ? `${dashboard.oauth.channels.length || 1} Upload-Kanal${dashboard.oauth.channels.length === 1 ? '' : 'äle'} freigegeben. Shorts und Senderchat nutzen die zentrale OAuth-Verbindung.`
                          : dashboard.oauth.clientConfigured
                            ? 'Google muss den Upload auf deinen Kanal einmalig bestätigen; der vorhandene API-Key bleibt aktiv.'
                            : 'Ein API-Key kann suchen, aber nicht im Namen deines Kanals hochladen. Richte OAuth einmal zentral ein.'}
                      </span>
                    </div>
                  </div>
                </div>
                <div className="youtube-connection-note">
                  <ShieldCheck size={17} />
                  <div>
                    <strong>Eine Verbindung, mehrere Funktionen</strong>
                    <span>
                      Es werden keine Zugangsdaten im Shorts Creator dupliziert. Recherche, Livechat und Upload greifen
                      auf die zentrale serverseitige YouTube-Konfiguration zu.
                    </span>
                  </div>
                </div>
                <label className="settings-option youtube-channel-picker">
                  <span>Zielkanal für Shorts</span>
                  <select
                    value={draft.youtubeChannelId}
                    disabled={!dashboard.oauth.channels.length}
                    onChange={(event) => setDraft({ ...draft, youtubeChannelId: event.target.value })}
                  >
                    <option value="">
                      {dashboard.oauth.channels.length ? 'Bitte YouTube-Kanal auswählen' : 'Noch kein Kanal verfügbar'}
                    </option>
                    {dashboard.oauth.channels.map((channel) => (
                      <option key={channel.id} value={channel.id}>
                        {channel.title}
                        {channel.handle ? ` · ${channel.handle}` : ''}
                      </option>
                    ))}
                  </select>
                  <small>
                    {selectedChannel
                      ? `Uploads werden kanalgebunden an ${selectedChannel.title}${selectedChannel.handle ? ` (${selectedChannel.handle})` : ''} gesendet.`
                      : dashboard.oauth.channelDiscoveryError ||
                        'Bei mehreren Kanälen wird hier eindeutig festgelegt, in welchem Kanal die Shorts erscheinen.'}
                  </small>
                </label>
                <div className="shorts-oauth-actions">
                  <a className="ghost-button" href="#/settings/media">
                    <Settings2 size={16} /> Zentrale YouTube-Verbindung verwalten
                  </a>
                  {dashboard.oauth.clientConfigured && (
                    <button
                      className={dashboard.oauth.connected ? 'ghost-button' : 'primary-button'}
                      disabled={!allowedAdmin || Boolean(working)}
                      onClick={() => void connectOauth()}
                    >
                      <CirclePlay size={16} />
                      {dashboard.oauth.connected ? 'Weiteren Kanal verbinden' : 'Upload-Berechtigung erteilen'}
                    </button>
                  )}
                  {dashboard.oauth.connected && (
                    <button className="ghost-button" disabled={Boolean(working)} onClick={() => void testOauth()}>
                      <Play size={16} /> Verbindung testen
                    </button>
                  )}
                  {dashboard.oauth.connected && (
                    <button
                      className="danger-button"
                      disabled={Boolean(working)}
                      onClick={() => void disconnectOauth()}
                    >
                      <X size={16} /> Trennen
                    </button>
                  )}
                </div>
                <label className="settings-option settings-toggle-option">
                  <span>Automatisch hochladen</span>
                  <span className="toggle-row">
                    <input
                      type="checkbox"
                      checked={draft.autoUpload}
                      onChange={(event) => setDraft({ ...draft, autoUpload: event.target.checked })}
                    />
                    Nach erfolgreichem Rendern hochladen
                  </span>
                </label>
                <label className="settings-option">
                  <span>Sichtbarkeit</span>
                  <select
                    value={draft.privacyStatus}
                    onChange={(event) =>
                      setDraft({ ...draft, privacyStatus: event.target.value as SettingsDraft['privacyStatus'] })
                    }
                  >
                    <option value="private">Privat</option>
                    <option value="unlisted">Nicht gelistet</option>
                    <option value="public">Öffentlich</option>
                  </select>
                </label>
                <label className="rights-confirmation">
                  <input
                    type="checkbox"
                    checked={draft.rightsConfirmed}
                    onChange={(event) => setDraft({ ...draft, rightsConfirmed: event.target.checked })}
                  />
                  <span>
                    <strong>Nutzungsrechte bestätigt</strong>Ich bestätige, dass der Sender den verwendeten
                    YouTube-Ausschnitt bearbeiten und erneut veröffentlichen darf. Ohne diese Bestätigung bleibt das
                    Video lokal bereit.
                  </span>
                </label>
              </section>
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
                {working === 'settings' ? <LoaderCircle className="spin" size={16} /> : <Save size={16} />}{' '}
                Einstellungen speichern
              </button>
            </div>
          </div>
        </div>
      )}

      {editingJob && jobDraft && (
        <div className="modal-backdrop" role="dialog" aria-modal="true" aria-label="Short bearbeiten">
          <div className="modal-card short-editor-modal">
            <div className="modal-header">
              <div>
                <p className="eyebrow">Short-Verwaltung</p>
                <h3>
                  <PenLine size={20} /> Short bearbeiten
                </h3>
                <p>{editingJob.source_title}</p>
              </div>
              <button
                className="ghost-button icon-button"
                onClick={() => {
                  setEditingJob(null);
                  setJobDraft(null);
                }}
                aria-label="Schließen"
              >
                <X size={18} />
              </button>
            </div>

            {editingJob.metadata.youtubeRemoteState === 'missing' && (
              <div className="short-editor-warning">
                <CloudOff size={18} />
                <div>
                  <strong>Dieses Video wurde außerhalb des Studios auf YouTube gelöscht.</strong>
                  <span>
                    Die lokale MP4-Datei und die Produktionsdaten bleiben bearbeitbar und können neu hochgeladen werden.
                  </span>
                </div>
              </div>
            )}

            <div className="short-editor-grid">
              <section>
                <h4>Veröffentlichung</h4>
                <label className="settings-option">
                  <span>YouTube-Titel</span>
                  <input
                    maxLength={100}
                    value={jobDraft.title}
                    onChange={(event) => setJobDraft({ ...jobDraft, title: event.target.value })}
                  />
                  <small>{jobDraft.title.length}/100 Zeichen</small>
                </label>
                <label className="settings-option">
                  <span>Beschreibung</span>
                  <textarea
                    maxLength={5000}
                    value={jobDraft.description}
                    onChange={(event) => setJobDraft({ ...jobDraft, description: event.target.value })}
                  />
                </label>
                <label className="settings-option">
                  <span>Tags, kommagetrennt</span>
                  <input
                    value={jobDraft.tags}
                    onChange={(event) => setJobDraft({ ...jobDraft, tags: event.target.value })}
                  />
                </label>
                <label className="settings-option">
                  <span>Sichtbarkeit</span>
                  <select
                    value={jobDraft.privacyStatus}
                    onChange={(event) =>
                      setJobDraft({ ...jobDraft, privacyStatus: event.target.value as JobDraft['privacyStatus'] })
                    }
                  >
                    <option value="private">Privat</option>
                    <option value="unlisted">Nicht gelistet</option>
                    <option value="public">Öffentlich</option>
                  </select>
                </label>
              </section>

              <section>
                <h4>AVA-Inhalt</h4>
                <label className="settings-option">
                  <span>Einordnungs-Titel</span>
                  <input
                    disabled={editingJob.status === 'uploaded'}
                    value={jobDraft.commentaryHeadline}
                    onChange={(event) => setJobDraft({ ...jobDraft, commentaryHeadline: event.target.value })}
                  />
                </label>
                <label className="settings-option">
                  <span>Gesprochene Einordnung</span>
                  <textarea
                    disabled={editingJob.status === 'uploaded'}
                    value={jobDraft.commentaryText}
                    onChange={(event) => setJobDraft({ ...jobDraft, commentaryText: event.target.value })}
                  />
                  <small>
                    {editingJob.status === 'uploaded'
                      ? 'Der Medieninhalt eines bereits veröffentlichten Videos bleibt unverändert.'
                      : 'Eine Textänderung löst automatisch ein neues Rendering mit TTS aus.'}
                  </small>
                </label>
                {editingJob.status !== 'uploaded' && editingJob.output_path && (
                  <label className="settings-option settings-toggle-option">
                    <span>Video neu erzeugen</span>
                    <span className="toggle-row">
                      <input
                        type="checkbox"
                        checked={jobDraft.rerender}
                        onChange={(event) => setJobDraft({ ...jobDraft, rerender: event.target.checked })}
                      />
                      MP4 mit aktuellem Design und TTS neu rendern
                    </span>
                  </label>
                )}
                {editingJob.status === 'uploaded' && editingJob.metadata.youtubeRemoteState !== 'missing' && (
                  <label className="settings-option settings-toggle-option">
                    <span>Mit YouTube synchronisieren</span>
                    <span className="toggle-row">
                      <input
                        type="checkbox"
                        checked={jobDraft.syncYoutube}
                        onChange={(event) => setJobDraft({ ...jobDraft, syncYoutube: event.target.checked })}
                      />
                      Titel, Beschreibung, Tags und Sichtbarkeit auch online ändern
                    </span>
                    <small>
                      Falls Google die Freigabe noch nicht kennt, muss der Kanal einmal neu verbunden werden.
                    </small>
                  </label>
                )}
              </section>
            </div>

            <div className="modal-actions">
              <button
                className="ghost-button"
                onClick={() => {
                  setEditingJob(null);
                  setJobDraft(null);
                }}
              >
                Abbrechen
              </button>
              <button
                className="primary-button"
                disabled={!jobDraft.title.trim() || !jobDraft.commentaryText.trim() || Boolean(working)}
                onClick={() => void saveJob()}
              >
                {working === `edit:${editingJob.id}` ? <LoaderCircle className="spin" size={16} /> : <Save size={16} />}
                Änderungen speichern
              </button>
            </div>
          </div>
        </div>
      )}

      {deletingJob && (
        <div className="modal-backdrop" role="dialog" aria-modal="true" aria-label="Short löschen">
          <div className="modal-card short-delete-modal">
            <div className="modal-header">
              <div>
                <p className="eyebrow danger">Unwiderrufliche Aktion</p>
                <h3>
                  <Trash2 size={20} /> Short löschen
                </h3>
              </div>
              <button className="ghost-button icon-button" onClick={() => setDeletingJob(null)} aria-label="Schließen">
                <X size={18} />
              </button>
            </div>
            <div className="short-delete-summary">
              <strong>{deletingJob.publication.title}</strong>
              <span>Lokale MP4-Datei, Vorschaubild, Auftrag und Produktionshistorie werden entfernt.</span>
            </div>
            {deletingJob.status === 'uploaded' && deletingJob.metadata.youtubeRemoteState !== 'missing' && (
              <label className="rights-confirmation destructive">
                <input
                  type="checkbox"
                  checked={deleteRemote}
                  onChange={(event) => setDeleteRemote(event.target.checked)}
                />
                <span>
                  <strong>Auch endgültig von YouTube löschen</strong>
                  Ohne diese Auswahl bleibt das bereits veröffentlichte Video auf YouTube bestehen.
                </span>
              </label>
            )}
            {deletingJob.metadata.youtubeRemoteState === 'missing' && (
              <div className="short-editor-warning">
                <CloudOff size={18} /> YouTube meldet dieses Video bereits als gelöscht. Es werden nur lokale Daten
                entfernt.
              </div>
            )}
            <label className="settings-option">
              <span>Zur Bestätigung „LÖSCHEN“ eingeben</span>
              <input
                autoFocus
                value={deleteConfirmation}
                onChange={(event) => setDeleteConfirmation(event.target.value)}
              />
            </label>
            <div className="modal-actions">
              <button className="ghost-button" onClick={() => setDeletingJob(null)}>
                Abbrechen
              </button>
              <button
                className="danger-button"
                disabled={deleteConfirmation !== 'LÖSCHEN' || Boolean(working)}
                onClick={() => void deleteJob()}
              >
                {working === `delete:${deletingJob.id}` ? (
                  <LoaderCircle className="spin" size={16} />
                ) : (
                  <Trash2 size={16} />
                )}
                {deleteRemote ? 'Lokal und auf YouTube löschen' : 'Lokal löschen'}
              </button>
            </div>
          </div>
        </div>
      )}
    </section>
  );
}
