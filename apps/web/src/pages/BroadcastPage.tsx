import React, { useEffect, useRef, useState } from 'react';
import {
  Archive,
  ArrowRightLeft,
  CalendarPlus,
  CalendarClock,
  ChevronDown,
  ChevronUp,
  CirclePlay,
  Clapperboard,
  Clock3,
  Copy,
  Edit3,
  Film,
  Layers3,
  LayoutTemplate,
  Library,
  ListChecks,
  ListPlus,
  ListVideo,
  LoaderCircle,
  PanelRight,
  Play,
  Plus,
  Radio,
  Newspaper,
  Save,
  Scissors,
  Search,
  Settings2,
  Shuffle,
  Sparkles,
  Trash2,
  UsersRound,
  WandSparkles,
  X,
} from 'lucide-react';
import { useNavigate, useSearchParams } from 'react-router-dom';
import { api, can, type SessionUser } from '../api/client.js';
import {
  OnAirBar,
  productionStatusLabels,
  type BroadcastReadiness,
  type SendebetriebStatus,
} from '../components/OnAirBar.js';

type PlaylistSettings = {
  contentMode?: BroadcastContentMode;
  defaultItemCount?: number;
  pauseSeconds?: number;
  transition?: 'clean' | 'fade' | 'headline' | 'bumper';
  repeatPolicy?: 'none' | 'recent-published' | 'loop';
  youtubeNewsSidebar?: boolean;
  youtubeContext?: boolean;
  aiRoundtable?: boolean;
  sidebarRotationSeconds?: number;
  targetRuntimeMinutes?: number;
  notes?: string;
};
type BroadcastContentMode =
  | 'news'
  | 'youtube'
  | 'mixed'
  | 'youtube-news-sidebar'
  | 'youtube-context'
  | 'ai-roundtable';
type BroadcastLayout = 'main-news' | 'youtube-video' | 'youtube-news-sidebar' | 'youtube-context' | 'custom';
type BroadcastFormat = {
  id: string;
  name: string;
  system_key: string | null;
  description: string | null;
  content_mode: BroadcastContentMode;
  layout: BroadcastLayout;
  overlay_project_id: string | null;
  overlay_project_name: string | null;
  overlay_template: string | null;
  default_duration_minutes: number;
  default_item_count: number;
  color: string;
  icon: string;
  settings: PlaylistSettings;
  active: boolean;
  is_system: boolean;
  usage_count: number;
  upcoming_count: number;
  next_scheduled_at: string | null;
};
type BroadcastFormatDraft = {
  name: string;
  description: string;
  contentMode: BroadcastContentMode;
  layout: BroadcastLayout;
  overlayProjectId: string;
  defaultDurationMinutes: number;
  defaultItemCount: number;
  color: string;
  icon: string;
  active: boolean;
  settings: {
    pauseSeconds: number;
    transition: 'clean' | 'fade' | 'headline' | 'bumper';
    repeatPolicy: 'none' | 'recent-published' | 'loop';
    sidebarRotationSeconds: number;
  };
};
type PlaylistDraft = {
  name: string;
  description: string;
  scheduledAt: string;
  kind: 'playlist' | 'show' | 'hour' | 'special';
  formatId: string;
  overlayProjectId: string;
  settings: Required<Omit<PlaylistSettings, 'notes'>> & { notes: string };
};
type AiPlanDraft = {
  name: string;
  maximumItems: number;
  targetRuntimeMinutes: number;
  minimumTrust: number;
  freshnessHours: number;
  focus:
    | 'balanced'
    | 'breaking'
    | 'politics'
    | 'economy'
    | 'technology'
    | 'regional'
    | 'international'
    | 'culture'
    | 'sports';
  diversity: 'high' | 'balanced' | 'focused';
  categoryFilters: string[];
  sourceIds: string[];
  instructions: string;
  scheduledAt: string;
  kind: 'playlist' | 'show' | 'hour' | 'special';
  formatId: string;
  overlayProjectId: string;
  pauseSeconds: number;
  transition: 'clean' | 'fade' | 'headline' | 'bumper';
};
type ShowSwitchTransition = 'cut' | 'fade' | 'swipe' | 'slide' | 'luma_wipe';
type ShowSwitchTarget = {
  playlist: any;
  item?: any | null;
  transition: ShowSwitchTransition;
  transitionDurationMs: number;
  suppressProgramIntro: boolean;
};
const defaultDraft: PlaylistDraft = {
  name: `Nachrichtensendung ${new Date().toLocaleDateString('de-DE')}`,
  description: '',
  scheduledAt: '',
  kind: 'show',
  formatId: '',
  overlayProjectId: '',
  settings: {
    contentMode: 'news',
    defaultItemCount: 8,
    pauseSeconds: 5,
    transition: 'fade',
    repeatPolicy: 'recent-published',
    youtubeNewsSidebar: false,
    youtubeContext: false,
    aiRoundtable: false,
    sidebarRotationSeconds: 12,
    targetRuntimeMinutes: 30,
    notes: '',
  },
};
const defaultAiPlanDraft: AiPlanDraft = {
  name: '',
  maximumItems: 8,
  targetRuntimeMinutes: 20,
  minimumTrust: 50,
  freshnessHours: 72,
  focus: 'balanced',
  diversity: 'balanced',
  categoryFilters: [],
  sourceIds: [],
  instructions: '',
  scheduledAt: '',
  kind: 'show',
  formatId: '',
  overlayProjectId: '',
  pauseSeconds: 5,
  transition: 'fade',
};
const defaultFormatDraft: BroadcastFormatDraft = {
  name: '',
  description: '',
  contentMode: 'news',
  layout: 'main-news',
  overlayProjectId: '',
  defaultDurationMinutes: 30,
  defaultItemCount: 8,
  color: '#5690ff',
  icon: 'clapperboard',
  active: true,
  settings: {
    pauseSeconds: 5,
    transition: 'fade',
    repeatPolicy: 'none',
    sidebarRotationSeconds: 12,
  },
};
const contentModeLabels: Record<BroadcastContentMode, string> = {
  news: 'Nachrichten',
  youtube: 'YouTube',
  mixed: 'Magazin gemischt',
  'youtube-news-sidebar': 'YouTube + News-Sidebar',
  'youtube-context': 'YouTube-Einordnung mit AVA',
  'ai-roundtable': 'KI Studio Runde',
};

const layoutLabels: Record<BroadcastLayout, string> = {
  'main-news': 'Hauptnachrichten',
  'youtube-video': 'YouTube Vollbild',
  'youtube-news-sidebar': 'News links / YouTube rechts',
  'youtube-context': 'AVA-Einordnungsstudio',
  custom: 'Eigenes Overlay-Layout',
};

function contentModeIcon(mode: BroadcastContentMode) {
  if (mode === 'youtube') return CirclePlay;
  if (mode === 'youtube-news-sidebar') return PanelRight;
  if (mode === 'youtube-context') return Sparkles;
  if (mode === 'mixed') return Layers3;
  return Newspaper;
}

function formatTime(value: unknown) {
  if (!value) return '-';
  const date = new Date(String(value));
  return Number.isNaN(date.getTime()) ? String(value) : date.toLocaleString('de-DE');
}
function toLocalInput(value: string | null | undefined) {
  if (!value) return '';
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return '';
  return new Date(date.getTime() - date.getTimezoneOffset() * 60_000).toISOString().slice(0, 16);
}
function fromLocalInput(value: string) {
  return value ? new Date(value).toISOString() : null;
}
function formatDurationSeconds(value: unknown) {
  const seconds = Math.max(0, Math.round(Number(value ?? 0)));
  if (!seconds) return '-';
  const minutes = Math.floor(seconds / 60);
  const rest = seconds % 60;
  if (minutes < 1) return `${rest}s`;
  return `${minutes}:${String(rest).padStart(2, '0')} Min.`;
}
function isYoutubeBroadcastItem(item: any) {
  return (
    item?.rules?.kind === 'youtube-video' ||
    item?.rules?.kind === 'youtube-news-sidebar' ||
    item?.rules?.kind === 'youtube-context'
  );
}
function itemRuntimeSeconds(item: any) {
  return isYoutubeBroadcastItem(item)
    ? Number(item.duration_seconds ?? item.rules?.durationSeconds ?? 0)
    : Number(item.audio_duration_seconds ?? item.duration_seconds ?? 0);
}
function itemSourceLine(item: any) {
  if (isYoutubeBroadcastItem(item)) {
    const format =
      item.rules?.kind === 'youtube-news-sidebar'
        ? 'YouTube + News-Sidebar'
        : item.rules?.kind === 'youtube-context'
          ? item.rules?.aiRoundtable
            ? 'KI Studio Runde'
            : 'YouTube-Einordnung mit AVA'
          : 'YouTube';
    return `${item.status} · ${format} · ${item.rules?.channelTitle ?? 'YouTube'} · ${formatDurationSeconds(itemRuntimeSeconds(item))}`;
  }
  return `${item.status} · Sprecher-Audio · ${formatDurationSeconds(itemRuntimeSeconds(item))}`;
}
function playlistToDraft(playlist: any): PlaylistDraft {
  const settings = playlist?.settings ?? {};
  return {
    name: playlist?.name ?? defaultDraft.name,
    description: playlist?.description ?? '',
    scheduledAt: toLocalInput(playlist?.scheduled_at),
    kind: ['playlist', 'show', 'hour', 'special'].includes(playlist?.kind) ? playlist.kind : 'show',
    formatId: playlist?.format_id ?? '',
    overlayProjectId: playlist?.overlay_project_id ?? '',
    settings: {
      contentMode: ['news', 'youtube', 'mixed', 'youtube-news-sidebar', 'youtube-context', 'ai-roundtable'].includes(
        settings.contentMode,
      )
        ? settings.contentMode
        : (playlist?.format_content_mode ?? 'news'),
      defaultItemCount: Number(settings.defaultItemCount ?? 8),
      pauseSeconds: Number(settings.pauseSeconds ?? 5),
      transition: ['clean', 'fade', 'headline', 'bumper'].includes(settings.transition) ? settings.transition : 'fade',
      repeatPolicy: ['none', 'recent-published', 'loop'].includes(settings.repeatPolicy)
        ? settings.repeatPolicy
        : 'recent-published',
      youtubeNewsSidebar: Boolean(settings.youtubeNewsSidebar),
      youtubeContext: Boolean(settings.youtubeContext),
      aiRoundtable: Boolean(settings.aiRoundtable),
      sidebarRotationSeconds: Number(settings.sidebarRotationSeconds ?? 12),
      targetRuntimeMinutes: Number(settings.targetRuntimeMinutes ?? 30),
      notes: String(settings.notes ?? ''),
    },
  };
}

function applyFormatToDraft(current: PlaylistDraft, format: BroadcastFormat, rename = false): PlaylistDraft {
  const configured = format.settings ?? {};
  return {
    ...current,
    name: rename
      ? `${format.name} · ${new Date().toLocaleString('de-DE', { dateStyle: 'short', timeStyle: 'short' })}`
      : current.name,
    description: rename ? (format.description ?? '') : current.description,
    formatId: format.id,
    overlayProjectId: format.overlay_project_id ?? '',
    settings: {
      ...current.settings,
      contentMode: format.content_mode,
      defaultItemCount: format.default_item_count,
      pauseSeconds: Number(configured.pauseSeconds ?? current.settings.pauseSeconds),
      transition: ['clean', 'fade', 'headline', 'bumper'].includes(String(configured.transition))
        ? (configured.transition as PlaylistDraft['settings']['transition'])
        : current.settings.transition,
      repeatPolicy: ['none', 'recent-published', 'loop'].includes(String(configured.repeatPolicy))
        ? (configured.repeatPolicy as PlaylistDraft['settings']['repeatPolicy'])
        : current.settings.repeatPolicy,
      youtubeNewsSidebar: format.content_mode === 'youtube-news-sidebar',
      youtubeContext: format.content_mode === 'youtube-context' || format.content_mode === 'ai-roundtable',
      aiRoundtable: format.content_mode === 'ai-roundtable' || format.settings?.aiRoundtable === true,
      sidebarRotationSeconds: Number(configured.sidebarRotationSeconds ?? current.settings.sidebarRotationSeconds),
      targetRuntimeMinutes: format.default_duration_minutes,
    },
  };
}

function formatToDraft(format: BroadcastFormat): BroadcastFormatDraft {
  return {
    name: format.name,
    description: format.description ?? '',
    contentMode: format.content_mode,
    layout: format.layout,
    overlayProjectId: format.overlay_project_id ?? '',
    defaultDurationMinutes: Number(format.default_duration_minutes),
    defaultItemCount: Number(format.default_item_count),
    color: format.color,
    icon: format.icon,
    active: format.active,
    settings: {
      pauseSeconds: Number(format.settings?.pauseSeconds ?? 5),
      transition: ['clean', 'fade', 'headline', 'bumper'].includes(String(format.settings?.transition))
        ? (format.settings?.transition as BroadcastFormatDraft['settings']['transition'])
        : 'fade',
      repeatPolicy: ['none', 'recent-published', 'loop'].includes(String(format.settings?.repeatPolicy))
        ? (format.settings?.repeatPolicy as BroadcastFormatDraft['settings']['repeatPolicy'])
        : 'none',
      sidebarRotationSeconds: Number(format.settings?.sidebarRotationSeconds ?? 12),
    },
  };
}

function BroadcastModal({ title, icon: Icon, children, onClose }: any) {
  return (
    <div className="modal-backdrop" role="dialog" aria-modal="true">
      <div className="modal-card broadcast-modal-card">
        <div className="modal-header">
          <div>
            <p className="eyebrow">Senderegie</p>
            <h3>
              <Icon size={18} /> {title}
            </h3>
          </div>
          <button className="ghost-button icon-button" onClick={onClose} aria-label="Schließen">
            <X size={17} />
          </button>
        </div>
        {children}
      </div>
    </div>
  );
}

export function BroadcastPage({ user }: { user: SessionUser }) {
  const navigate = useNavigate();
  const [searchParams] = useSearchParams();
  const view = searchParams.get('view') ?? '';
  const [status, setStatus] = useState<any>();
  const [operations, setOperations] = useState<SendebetriebStatus | null>(null);
  const [playlists, setPlaylists] = useState<any[]>([]);
  const [articles, setArticles] = useState<any[]>([]);
  const [youtubeVideos, setYoutubeVideos] = useState<any[]>([]);
  const [overlays, setOverlays] = useState<any[]>([]);
  const [formats, setFormats] = useState<BroadcastFormat[]>([]);
  const [showAllPlaylists, setShowAllPlaylists] = useState(view === 'planned');
  const [message, setMessage] = useState('');
  const [aiPlanning, setAiPlanning] = useState(false);
  const [modal, setModal] = useState<'create' | 'edit' | 'ai-plan' | 'format' | 'show-switch' | 'readiness' | null>(
    null,
  );
  const [draft, setDraft] = useState<PlaylistDraft>(defaultDraft);
  const [aiDraft, setAiDraft] = useState<AiPlanDraft>(defaultAiPlanDraft);
  const [formatDraft, setFormatDraft] = useState<BroadcastFormatDraft>(defaultFormatDraft);
  const [editingFormat, setEditingFormat] = useState<BroadcastFormat | null>(null);
  const [selectedArticleIds, setSelectedArticleIds] = useState<string[]>([]);
  const [selectedYoutubeVideoIds, setSelectedYoutubeVideoIds] = useState<string[]>([]);
  const [editing, setEditing] = useState<any>();
  const [editingItems, setEditingItems] = useState<any[]>([]);
  const [query, setQuery] = useState('');
  const [formatQuery, setFormatQuery] = useState('');
  const [modalError, setModalError] = useState('');
  const [creatingPlaylist, setCreatingPlaylist] = useState(false);
  const [createdPlaylistFocusId, setCreatedPlaylistFocusId] = useState<string | null>(null);
  const [planView, setPlanView] = useState<'grid' | 'list' | 'timeline'>('grid');
  const [scheduleDate, setScheduleDate] = useState(() => new Date().toISOString().slice(0, 10));
  const [draggingPlaylistId, setDraggingPlaylistId] = useState<string | null>(null);
  const [showSwitchTarget, setShowSwitchTarget] = useState<ShowSwitchTarget | null>(null);
  const [switchingShow, setSwitchingShow] = useState(false);
  const [deletingPlaylistId, setDeletingPlaylistId] = useState<string | null>(null);
  const [readiness, setReadiness] = useState<BroadcastReadiness | null>(null);
  const [readinessPlaylist, setReadinessPlaylist] = useState<any>(null);
  const [workflowBusyId, setWorkflowBusyId] = useState<string | null>(null);
  const loadRevision = useRef(0);
  const allowedWrite = can(user, 'broadcast:write');

  async function load() {
    const revision = ++loadRevision.current;
    try {
      const [nextStatus, nextOperations, nextPlaylists, nextArticles, nextYoutubeLibrary, nextOverlays, nextFormats] =
        await Promise.all([
          api('/api/broadcast/status'),
          api<SendebetriebStatus>('/api/sendebetrieb/status'),
          api<any[]>('/api/broadcast/playlists'),
          api<any[]>('/api/broadcast/articles?limit=160'),
          api<{ videos: any[] }>('/api/youtube-videos'),
          api<any[]>('/api/overlays'),
          api<BroadcastFormat[]>('/api/broadcast/formats?includeInactive=true'),
        ]);
      if (revision !== loadRevision.current) return;
      setStatus(nextStatus);
      setOperations(nextOperations);
      setPlaylists(nextPlaylists);
      setArticles(nextArticles);
      setYoutubeVideos((nextYoutubeLibrary.videos ?? []).filter((video) => video.enabled));
      setOverlays(nextOverlays);
      setFormats(nextFormats);
    } catch (error) {
      if (revision === loadRevision.current) setMessage(error instanceof Error ? error.message : String(error));
    }
  }
  useEffect(() => {
    void load();
    return () => {
      loadRevision.current++;
    };
  }, []);
  useEffect(() => {
    if (!view) return;
    if (view === 'planned') setShowAllPlaylists(true);
    const targetId = view === 'planned' ? 'broadcast-planned' : 'broadcast-active';
    const timer = window.setTimeout(() => document.getElementById(targetId)?.scrollIntoView({ block: 'start' }), 0);
    return () => window.clearTimeout(timer);
  }, [view, playlists.length]);
  useEffect(() => {
    const emergency = setInterval(load, 5000);
    return () => {
      clearInterval(emergency);
    };
  }, []);
  useEffect(() => {
    if (!createdPlaylistFocusId || planView !== 'timeline') return;
    let focusTimer = 0;
    let highlightTimer = 0;
    let attempt = 0;
    const focusCreatedPlaylist = () => {
      const element = document.getElementById(`broadcast-timeline-${createdPlaylistFocusId}`);
      if (!element && attempt < 20) {
        attempt += 1;
        focusTimer = window.setTimeout(focusCreatedPlaylist, 50);
        return;
      }
      if (!element) return;
      element.scrollIntoView({ behavior: 'smooth', block: 'center' });
      element.focus({ preventScroll: true });
      highlightTimer = window.setTimeout(() => setCreatedPlaylistFocusId(null), 3200);
    };
    focusTimer = window.setTimeout(focusCreatedPlaylist, 50);
    return () => {
      window.clearTimeout(focusTimer);
      window.clearTimeout(highlightTimer);
    };
  }, [createdPlaylistFocusId, planView, scheduleDate, playlists]);

  async function executeShowSwitch(target: ShowSwitchTarget) {
    setSwitchingShow(true);
    setModalError('');
    try {
      const result = await api<{ switchId: string; sourceRunId: string | null }>(
        `/api/broadcast/playlists/${target.playlist.id}/take`,
        {
          method: 'POST',
          body: JSON.stringify({
            itemId: target.item?.id ?? null,
            transition: target.transition,
            transitionDurationMs: target.transitionDurationMs,
            suppressProgramIntro: target.suppressProgramIntro,
            idempotencyKey: `web-${Date.now()}`,
          }),
        },
      );
      setModal(null);
      setShowSwitchTarget(null);
      setMessage(
        result.sourceRunId
          ? `Überblendung zu „${target.playlist.name}“ wurde gestartet.`
          : `„${target.playlist.name}“ wird jetzt gestartet.`,
      );
      await load();
    } catch (error) {
      const errorMessage = error instanceof Error ? error.message : String(error);
      if (modal === 'show-switch') setModalError(errorMessage);
      else setMessage(errorMessage);
    } finally {
      setSwitchingShow(false);
    }
  }
  function playNow(playlist: any, item?: any | null) {
    const activeSwitch = (status?.showSwitches ?? []).find((entry: any) =>
      ['pending', 'stopping', 'starting'].includes(entry.status),
    );
    if (activeSwitch) {
      setMessage(`Der Wechsel zu „${activeSwitch.target_playlist_name ?? 'einer anderen Sendung'}“ läuft bereits.`);
      return;
    }
    const target: ShowSwitchTarget = {
      playlist,
      item: item ?? null,
      transition: 'fade',
      transitionDurationMs: 650,
      suppressProgramIntro: true,
    };
    if (status?.run) {
      setShowSwitchTarget(target);
      setModalError('');
      setModal('show-switch');
      return;
    }
    void executeShowSwitch(target);
  }
  async function createAiPlan() {
    setModalError('');
    setAiPlanning(true);
    try {
      const result = await api<any>('/api/ai/broadcast-plan', {
        method: 'POST',
        body: JSON.stringify({
          ...aiDraft,
          name: aiDraft.name.trim() || undefined,
          instructions: aiDraft.instructions.trim() || undefined,
          scheduledAt: fromLocalInput(aiDraft.scheduledAt),
          overlayProjectId: aiDraft.overlayProjectId || null,
        }),
      });
      setMessage(
        `${result.ai?.fallback ? 'Redaktioneller Ersatzplan' : 'KI-Sendung'} „${result.playlist.name}“ erstellt · ${result.ai?.model ?? 'OpenRouter'}. ${result.rationale}`,
      );
      setModal(null);
      setShowAllPlaylists(true);
      await load();
    } catch (error) {
      setModalError(error instanceof Error ? error.message : String(error));
    } finally {
      setAiPlanning(false);
    }
  }
  function openAiPlan() {
    const format = formats.find((candidate) => candidate.active && candidate.system_key === 'news');
    setAiDraft({
      ...defaultAiPlanDraft,
      categoryFilters: [],
      sourceIds: [],
      formatId: format?.id ?? '',
      overlayProjectId: format?.overlay_project_id ?? '',
      targetRuntimeMinutes: format?.default_duration_minutes ?? defaultAiPlanDraft.targetRuntimeMinutes,
      maximumItems: Math.min(16, format?.default_item_count ?? defaultAiPlanDraft.maximumItems),
    });
    setModalError('');
    setModal('ai-plan');
  }
  function openCreate(options: { format?: BroadcastFormat; scheduledAt?: Date } = {}) {
    const initial: PlaylistDraft = {
      ...defaultDraft,
      name: `Sendung ${new Date().toLocaleString('de-DE', { dateStyle: 'short', timeStyle: 'short' })}`,
      scheduledAt: options.scheduledAt ? toLocalInput(options.scheduledAt.toISOString()) : '',
    };
    setDraft(options.format ? applyFormatToDraft(initial, options.format, true) : initial);
    setSelectedArticleIds([]);
    setSelectedYoutubeVideoIds([]);
    setEditing(undefined);
    setEditingItems([]);
    setModalError('');
    setModal('create');
  }
  function chooseDraftFormat(formatId: string) {
    if (!formatId) {
      setDraft((current) => ({ ...current, formatId: '' }));
      return;
    }
    const format = formats.find((candidate) => candidate.id === formatId);
    if (format) {
      setDraft((current) => applyFormatToDraft(current, format));
      if (format.content_mode === 'news') setSelectedYoutubeVideoIds([]);
      if (format.content_mode === 'youtube') setSelectedArticleIds([]);
    }
  }
  function openNewFormat() {
    setEditingFormat(null);
    setFormatDraft({ ...defaultFormatDraft, settings: { ...defaultFormatDraft.settings } });
    setModalError('');
    setModal('format');
  }
  function openFormat(format: BroadcastFormat) {
    setEditingFormat(format);
    setFormatDraft(formatToDraft(format));
    setModalError('');
    setModal('format');
  }
  async function saveFormat() {
    setModalError('');
    try {
      const saved = await api<BroadcastFormat>(
        editingFormat ? `/api/broadcast/formats/${editingFormat.id}` : '/api/broadcast/formats',
        {
          method: editingFormat ? 'PUT' : 'POST',
          body: JSON.stringify({
            ...formatDraft,
            description: formatDraft.description || null,
            overlayProjectId: formatDraft.overlayProjectId || null,
          }),
        },
      );
      setModal(null);
      setMessage(`Sendeformat „${saved.name}“ gespeichert.`);
      await load();
    } catch (error) {
      setModalError(error instanceof Error ? error.message : String(error));
    }
  }
  async function duplicateFormat(format: BroadcastFormat) {
    try {
      const copy = await api<BroadcastFormat>(`/api/broadcast/formats/${format.id}/duplicate`, {
        method: 'POST',
        body: JSON.stringify({ name: `${format.name} – Kopie` }),
      });
      setMessage(`Sendeformat „${copy.name}“ als bearbeitbare Kopie angelegt.`);
      await load();
      openFormat(copy);
    } catch (error) {
      setMessage(error instanceof Error ? error.message : String(error));
    }
  }
  async function archiveFormat(format: BroadcastFormat) {
    if (!window.confirm(`Sendeformat „${format.name}“ wirklich archivieren? Bestehende Sendungen bleiben erhalten.`))
      return;
    try {
      await api(`/api/broadcast/formats/${format.id}`, { method: 'DELETE' });
      setModal(null);
      setMessage('Sendeformat archiviert. Bereits geplante Sendungen bleiben unverändert.');
      await load();
    } catch (error) {
      setModalError(error instanceof Error ? error.message : String(error));
    }
  }
  async function openEdit(playlist: any) {
    const detail = await api<any>(`/api/broadcast/playlists/${playlist.id}`);
    setEditing(detail.playlist);
    setEditingItems(detail.items ?? []);
    setDraft(playlistToDraft(detail.playlist));
    setSelectedArticleIds([]);
    setSelectedYoutubeVideoIds([]);
    setModalError('');
    setModal('edit');
  }
  function requestBody() {
    return {
      name: draft.name,
      description: draft.description || null,
      scheduledAt: fromLocalInput(draft.scheduledAt),
      kind: draft.kind,
      formatId: draft.formatId || null,
      overlayProjectId: draft.overlayProjectId || null,
      settings: draft.settings,
    };
  }
  async function saveCreate() {
    if (creatingPlaylist) return;
    setModalError('');
    setCreatingPlaylist(true);
    try {
      const [result] = await Promise.all([
        api<{ playlist: { id: string; name?: string; scheduled_at?: string | null } }>(
          '/api/broadcast/playlists',
          {
            method: 'POST',
            body: JSON.stringify({
              ...requestBody(),
              articleIds: selectedArticleIds,
              youtubeVideoIds: selectedYoutubeVideoIds,
            }),
          },
        ),
        new Promise<void>((resolve) => window.setTimeout(resolve, 1200)),
      ]);
      const scheduledAt = result.playlist.scheduled_at ?? fromLocalInput(draft.scheduledAt);
      if (scheduledAt) {
        const scheduledDate = new Date(scheduledAt);
        if (!Number.isNaN(scheduledDate.getTime())) {
          setScheduleDate(scheduledDate.toISOString().slice(0, 10));
        }
      }
      setPlanView('timeline');
      setShowAllPlaylists(true);
      setModal(null);
      setMessage(`Sendung „${result.playlist.name?.trim() || draft.name.trim()}“ wurde erstellt.`);
      await load();
      setCreatedPlaylistFocusId(result.playlist.id);
    } catch (error) {
      setModalError(error instanceof Error ? error.message : String(error));
    } finally {
      setCreatingPlaylist(false);
    }
  }
  async function saveEdit() {
    if (!editing) return;
    setModalError('');
    try {
      await api(`/api/broadcast/playlists/${editing.id}`, { method: 'PUT', body: JSON.stringify(requestBody()) });
      if (draft.settings.youtubeContext && selectedYoutubeVideoIds.length) {
        for (const youtubeVideoId of selectedYoutubeVideoIds) {
          await api(`/api/broadcast/playlists/${editing.id}/items`, {
            method: 'POST',
            body: JSON.stringify({
              youtubeVideoId,
              sidebarArticleIds: selectedArticleIds,
              youtubeContext: true,
              aiRoundtable: draft.settings.aiRoundtable === true,
            }),
          });
        }
      } else if (draft.settings.youtubeNewsSidebar && selectedYoutubeVideoIds.length && selectedArticleIds.length) {
        for (const youtubeVideoId of selectedYoutubeVideoIds) {
          await api(`/api/broadcast/playlists/${editing.id}/items`, {
            method: 'POST',
            body: JSON.stringify({ youtubeVideoId, sidebarArticleIds: selectedArticleIds }),
          });
        }
      } else {
        for (const articleId of selectedArticleIds) {
          await api(`/api/broadcast/playlists/${editing.id}/items`, {
            method: 'POST',
            body: JSON.stringify({ articleId }),
          });
        }
        for (const youtubeVideoId of selectedYoutubeVideoIds) {
          await api(`/api/broadcast/playlists/${editing.id}/items`, {
            method: 'POST',
            body: JSON.stringify({ youtubeVideoId }),
          });
        }
      }
      setSelectedArticleIds([]);
      setSelectedYoutubeVideoIds([]);
      await openEdit(editing);
      await load();
      setMessage('Sendung gespeichert.');
    } catch (error) {
      setModalError(error instanceof Error ? error.message : String(error));
    }
  }
  async function deletePlaylist(id: string, name?: string) {
    if (
      !window.confirm(
        `Sendung „${name?.trim() || 'Unbenannt'}“ inklusive aller eingeplanten Beiträge wirklich löschen?`,
      )
    )
      return;
    setDeletingPlaylistId(id);
    try {
      await api(`/api/broadcast/playlists/${id}`, { method: 'DELETE' });
      setModal(null);
      setMessage(`Sendung „${name?.trim() || 'Unbenannt'}“ wurde gelöscht.`);
      await load();
    } catch (error) {
      const detail = error instanceof Error ? error.message : String(error);
      setModalError(detail);
      setMessage(detail);
    } finally {
      setDeletingPlaylistId(null);
    }
  }
  async function inspectReadiness(playlist: any, openModal = true) {
    setWorkflowBusyId(playlist.id);
    setModalError('');
    try {
      const result = await api<BroadcastReadiness>(`/api/broadcast/playlists/${playlist.id}/readiness`);
      setReadiness(result);
      setReadinessPlaylist(playlist);
      if (openModal) setModal('readiness');
      await load();
      return result;
    } catch (error) {
      setMessage(error instanceof Error ? error.message : String(error));
      return null;
    } finally {
      setWorkflowBusyId(null);
    }
  }
  async function prepareForControl(playlist: any) {
    setWorkflowBusyId(playlist.id);
    try {
      const result = await api<{ readiness: BroadcastReadiness }>(`/api/broadcast/playlists/${playlist.id}/prepare`, {
        method: 'POST',
      });
      setReadiness(result.readiness);
      setReadinessPlaylist(playlist);
      setMessage(`„${playlist.name}“ ist in der Regie vorbereitet.`);
      await load();
    } catch (error) {
      await inspectReadiness(playlist, true);
      setMessage(error instanceof Error ? error.message : String(error));
    } finally {
      setWorkflowBusyId(null);
    }
  }
  async function duplicatePlaylist(playlist: any) {
    setWorkflowBusyId(playlist.id);
    try {
      const result = await api<{ playlist: any }>(`/api/broadcast/playlists/${playlist.id}/duplicate`, {
        method: 'POST',
      });
      setMessage(`„${result.playlist.name}“ wurde als neuer Entwurf angelegt.`);
      await load();
    } catch (error) {
      setMessage(error instanceof Error ? error.message : String(error));
    } finally {
      setWorkflowBusyId(null);
    }
  }
  async function takeReadyPlaylist(playlist: any, item?: any | null) {
    const result = await inspectReadiness(playlist, false);
    if (!result?.ready) {
      setReadiness(result);
      setReadinessPlaylist(playlist);
      setModal('readiness');
      return;
    }
    playNow(playlist, item);
  }
  async function removeItem(itemId: string) {
    if (!editing) return;
    await api(`/api/broadcast/playlists/${editing.id}/items/${itemId}`, { method: 'DELETE' });
    await openEdit(editing);
    await load();
  }
  async function moveItem(itemId: string, direction: -1 | 1) {
    if (!editing) return;
    const index = editingItems.findIndex((item) => item.id === itemId);
    const next = [...editingItems];
    const swap = index + direction;
    if (index < 0 || swap < 0 || swap >= next.length) return;
    [next[index], next[swap]] = [next[swap], next[index]];
    await api(`/api/broadcast/playlists/${editing.id}/reorder`, {
      method: 'POST',
      body: JSON.stringify({ itemIds: next.map((item) => item.id) }),
    });
    await openEdit(editing);
    await load();
  }
  async function reschedulePlaylist(playlistId: string, scheduledAt: string | null) {
    if (!allowedWrite) return;
    try {
      await api(`/api/broadcast/playlists/${playlistId}`, {
        method: 'PUT',
        body: JSON.stringify({ scheduledAt }),
      });
      await load();
      setMessage(scheduledAt ? 'Sendung im Sendeplan verschoben.' : 'Sendung aus dem festen Sendeplan gelöst.');
    } catch (error) {
      setMessage(error instanceof Error ? error.message : String(error));
    }
  }
  function slotDate(hour: number) {
    const date = new Date(`${scheduleDate}T00:00:00`);
    date.setHours(hour, 0, 0, 0);
    return date;
  }
  function playlistHour(playlist: any) {
    if (!playlist.scheduled_at) return null;
    const date = new Date(playlist.scheduled_at);
    if (Number.isNaN(date.getTime()) || date.toISOString().slice(0, 10) !== scheduleDate) return null;
    return date.getHours();
  }
  async function dropPlaylistOnHour(hour: number) {
    if (!draggingPlaylistId) return;
    await reschedulePlaylist(draggingPlaylistId, slotDate(hour).toISOString());
    setDraggingPlaylistId(null);
  }
  async function dropPlaylistNear(target: any) {
    if (!draggingPlaylistId || draggingPlaylistId === target.id) return;
    const targetDate = target.scheduled_at ? new Date(target.scheduled_at) : new Date();
    if (Number.isNaN(targetDate.getTime())) targetDate.setTime(Date.now());
    targetDate.setMinutes(targetDate.getMinutes() + 5);
    await reschedulePlaylist(draggingPlaylistId, targetDate.toISOString());
    setDraggingPlaylistId(null);
  }

  const playback = status?.playback ?? { status: 'idle' };
  const items = status?.items ?? [];
  const activeShowSwitch = (status?.showSwitches ?? []).find((entry: any) =>
    ['pending', 'stopping', 'starting'].includes(entry.status),
  );
  const currentPlaylist = playlists.find((playlist) => playlist.id === status?.run?.playlist_id) ?? null;
  const activeFormats = formats.filter((format) => format.active);
  const selectedFormat = formats.find((format) => format.id === draft.formatId) ?? null;
  const normalizedFormatQuery = formatQuery.trim().toLocaleLowerCase('de');
  const visibleFormats = formats.filter((format) => {
    if (!normalizedFormatQuery) return true;
    return `${format.name} ${format.description ?? ''} ${contentModeLabels[format.content_mode]} ${format.overlay_project_name ?? ''}`
      .toLocaleLowerCase('de')
      .includes(normalizedFormatQuery);
  });
  const visiblePlaylists = planView === 'timeline' || showAllPlaylists ? playlists : playlists.slice(0, 12);
  const normalizedQuery = query.trim().toLocaleLowerCase('de');
  const selectableArticles = articles.filter((article) => {
    if (editingItems.some((item) => item.article_id === article.id) || selectedArticleIds.includes(article.id))
      return false;
    if (!normalizedQuery) return true;
    return `${article.title} ${article.source_name ?? ''} ${article.category ?? ''}`
      .toLocaleLowerCase('de')
      .includes(normalizedQuery);
  });
  const selectableYoutubeVideos = youtubeVideos.filter((video) => {
    if (
      editingItems.some((item) => item.rules?.youtubeLibraryId === video.id) ||
      selectedYoutubeVideoIds.includes(video.id)
    )
      return false;
    if (!normalizedQuery) return true;
    return `${video.title} ${video.channel_title ?? ''} ${video.category_name ?? ''} ${video.url ?? ''}`
      .toLocaleLowerCase('de')
      .includes(normalizedQuery);
  });
  const selectedArticleDuration = articles
    .filter((article) => selectedArticleIds.includes(article.id))
    .reduce((sum, article) => sum + Number(article.audio_duration_seconds ?? 60), 0);
  const selectedYoutubeDuration = youtubeVideos
    .filter((video) => selectedYoutubeVideoIds.includes(video.id))
    .reduce((sum, video) => sum + Number(video.duration_seconds ?? 0), 0);
  const selectedContentCount = selectedArticleIds.length + selectedYoutubeVideoIds.length;
  const selectedDuration = selectedArticleDuration + selectedYoutubeDuration;
  const plannerCategories = [
    ...new Set(articles.map((article) => String(article.category ?? '').trim()).filter(Boolean)),
  ].sort((a, b) => a.localeCompare(b, 'de'));
  const plannerSources = [
    ...new Map(
      articles
        .filter((article) => article.source_id)
        .map((article) => [article.source_id, article.source_name ?? article.source_id]),
    ),
  ].sort((a, b) => String(a[1]).localeCompare(String(b[1]), 'de'));
  const plannerCandidateCount = articles.filter((article) => {
    if (!['approved', 'published'].includes(article.status)) return false;
    if (Number(article.trust_score ?? 0) < aiDraft.minimumTrust) return false;
    const timestamp = Date.parse(article.published_at ?? article.fetched_at ?? '');
    if (!Number.isFinite(timestamp) || timestamp < Date.now() - aiDraft.freshnessHours * 3_600_000) return false;
    if (aiDraft.categoryFilters.length && !aiDraft.categoryFilters.includes(article.category)) return false;
    if (aiDraft.sourceIds.length && !aiDraft.sourceIds.includes(article.source_id)) return false;
    return true;
  }).length;

  function DraftFields() {
    return (
      <>
        <section className="broadcast-format-picker">
          <div className="section-heading compact-heading">
            <div>
              <p className="eyebrow">1 · Sendeformat</p>
              <h4>Welche wiederverwendbare Sendungsvorlage soll ausgestrahlt werden?</h4>
            </div>
            <button className="ghost-button" type="button" onClick={openNewFormat} disabled={!allowedWrite}>
              <Plus size={15} /> Neues Format
            </button>
          </div>
          <div className="broadcast-format-choice-grid">
            <button
              type="button"
              className={`broadcast-format-choice ${!draft.formatId ? 'active' : ''}`}
              disabled={Boolean(editing && editingItems.length > 0 && draft.formatId)}
              onClick={() => chooseDraftFormat('')}
            >
              <span className="format-choice-icon">
                <Settings2 size={18} />
              </span>
              <span>
                <strong>Individuelle Sendung</strong>
                <small>Einmalig ohne wiederverwendbare Formatvorlage konfigurieren.</small>
              </span>
            </button>
            {activeFormats.map((format) => {
              const FormatIcon = contentModeIcon(format.content_mode);
              const formatModeLabel =
                format.settings?.aiRoundtable === true ? 'KI-Runde mit sechs Moderatoren' : contentModeLabels[format.content_mode];
              return (
                <button
                  type="button"
                  className={`broadcast-format-choice ${draft.formatId === format.id ? 'active' : ''}`}
                  style={{ '--format-color': format.color } as React.CSSProperties}
                  disabled={Boolean(editing && editingItems.length > 0 && draft.formatId !== format.id)}
                  onClick={() => chooseDraftFormat(format.id)}
                  key={format.id}
                >
                  <span className="format-choice-icon">
                    <FormatIcon size={18} />
                  </span>
                  <span>
                    <strong>{format.name}</strong>
                    <small>
                      {formatModeLabel} · {format.default_duration_minutes} Min. ·{' '}
                      {format.default_item_count} Inhalte
                    </small>
                  </span>
                </button>
              );
            })}
          </div>
          {editing && editingItems.length > 0 && (
            <p className="format-picker-hint">
              Das Format ist gesperrt, solange diese Sendung bereits Inhalte enthält. So bleiben Rundown und
              Bildaufteilung konsistent; für ein anderes Format bitte eine neue Sendung anlegen.
            </p>
          )}
          {selectedFormat && (
            <div
              className="selected-format-summary"
              style={{ '--format-color': selectedFormat.color } as React.CSSProperties}
            >
              <LayoutTemplate size={19} />
              <span>
                <strong>{selectedFormat.name}</strong>
                <small>
                  Layout „{layoutLabels[selectedFormat.layout]}“ · Overlay{' '}
                  {selectedFormat.overlay_project_name ?? 'Studio-Standard'}. Die Sendung übernimmt einen Snapshot der
                  Formatwerte; spätere Formatänderungen verändern diese Ausstrahlung nicht rückwirkend.
                </small>
              </span>
              <button type="button" className="ghost-button" onClick={() => openFormat(selectedFormat)}>
                <Edit3 size={14} /> Format öffnen
              </button>
            </div>
          )}
        </section>
        <div className="settings-automation-grid broadcast-form-grid">
          <label className="settings-option">
            <span>Sendungstitel</span>
            <small>Der Name der ganzen Sendung oder Playlist.</small>
            <input value={draft.name} onChange={(event) => setDraft({ ...draft, name: event.target.value })} />
          </label>
          <label className="settings-option">
            <span>Sendungsart</span>
            <small>Die konkrete Platzierung ist eine Sendung, ein Stundenblock oder eine Spezialausgabe.</small>
            <select value={draft.kind} onChange={(event) => setDraft({ ...draft, kind: event.target.value as any })}>
              <option value="show">Ganze Sendung</option>
              <option value="hour">Stundenblock</option>
              <option value="special">Spezialausgabe</option>
              <option value="playlist">Einfache Playlist</option>
            </select>
          </label>
          <label className="settings-option">
            <span>Geplante Ausstrahlung</span>
            <small>Optionaler Sendeplan-Zeitpunkt für den 24h-Betrieb.</small>
            <input
              type="datetime-local"
              value={draft.scheduledAt}
              onChange={(event) => setDraft({ ...draft, scheduledAt: event.target.value })}
            />
          </label>
          <label className="settings-option">
            <span>Overlay-Set</span>
            <small>Sendung mit einem bestehenden Overlay-Projekt verknüpfen.</small>
            <select
              value={draft.overlayProjectId}
              disabled={Boolean(selectedFormat)}
              onChange={(event) => setDraft({ ...draft, overlayProjectId: event.target.value })}
            >
              <option value="">Standard / veröffentlichtes Overlay</option>
              {overlays.map((overlay) => (
                <option value={overlay.id} key={overlay.id}>
                  {overlay.name} · {overlay.template}
                </option>
              ))}
            </select>
          </label>
          <label className="settings-option">
            <span>Pause zwischen Beiträgen</span>
            <small>Wie viele Sekunden Regie-/Übergangszeit zwischen Beiträgen geplant sind.</small>
            <input
              type="number"
              min="0"
              max="600"
              value={draft.settings.pauseSeconds}
              onChange={(event) =>
                setDraft({ ...draft, settings: { ...draft.settings, pauseSeconds: Number(event.target.value) } })
              }
            />
          </label>
          <label className="settings-option">
            <span>Übergang</span>
            <small>Visueller Stil für den Wechsel zwischen Beiträgen.</small>
            <select
              value={draft.settings.transition}
              onChange={(event) =>
                setDraft({ ...draft, settings: { ...draft.settings, transition: event.target.value as any } })
              }
            >
              <option value="fade">Weiche Blende</option>
              <option value="headline">Headline-Bridge</option>
              <option value="bumper">Kurzer Bumper</option>
              <option value="clean">Direkt sauber</option>
            </select>
          </label>
          <label className="settings-option settings-toggle-option">
            <span>YouTube + News-Sidebar</span>
            <small>
              Kombiniert ausgewählte Nachrichten links als Titel/Text/Quelle ohne Sprecher-Audio mit YouTube-Video
              rechts inklusive Audio.
            </small>
            <span className="toggle-row">
              <input
                type="checkbox"
                disabled={Boolean(selectedFormat)}
                checked={draft.settings.youtubeNewsSidebar}
                onChange={(event) =>
                  setDraft({
                    ...draft,
                    settings: {
                      ...draft.settings,
                      contentMode: event.target.checked ? 'youtube-news-sidebar' : draft.settings.contentMode,
                      youtubeNewsSidebar: event.target.checked,
                      youtubeContext: event.target.checked ? false : draft.settings.youtubeContext,
                      aiRoundtable: event.target.checked ? false : draft.settings.aiRoundtable,
                    },
                  })
                }
              />
              Parallelmodus aktivieren
            </span>
          </label>
          <label className="settings-option settings-toggle-option">
            <span>YouTube-Einordnung mit AVA</span>
            <small>
              AVA bleibt groß links im Studio, die KI-Redaktion analysiert das Video-Transkript und liefert belegte
              Einordnungskarten. Für Moderationen wird das Video pausiert; bei Free-Limit laufen aktuelle News weiter.
            </small>
            <span className="toggle-row">
              <input
                type="checkbox"
                disabled={Boolean(selectedFormat)}
                checked={draft.settings.youtubeContext}
                onChange={(event) =>
                  setDraft({
                    ...draft,
                    settings: {
                      ...draft.settings,
                      contentMode: event.target.checked ? 'youtube-context' : draft.settings.contentMode,
                      youtubeContext: event.target.checked,
                      aiRoundtable: false,
                      youtubeNewsSidebar: event.target.checked ? false : draft.settings.youtubeNewsSidebar,
                    },
                  })
                }
              />
              AVA-Einordnung aktivieren
            </span>
          </label>
          <label className="settings-option settings-toggle-option">
            <span>
              <UsersRound size={17} aria-hidden="true" /> KI Studio Runde
            </span>
            <small>
              Eigenständige Diskussionssendung mit Ava, Mia, Lea, Leon, Jonas und Karim. Alle sechs stellen sich vor,
              ordnen das laufende Video anhand des vorbereiteten Transkripts ein und reagieren auf den Live-Chat.
            </small>
            <span className="toggle-row">
              <input
                type="checkbox"
                disabled={Boolean(selectedFormat)}
                checked={draft.settings.aiRoundtable === true}
                onChange={(event) =>
                  setDraft({
                    ...draft,
                    settings: {
                      ...draft.settings,
                      contentMode: event.target.checked ? 'ai-roundtable' : 'youtube-context',
                      aiRoundtable: event.target.checked,
                      youtubeContext: event.target.checked ? true : draft.settings.youtubeContext,
                      youtubeNewsSidebar: event.target.checked ? false : draft.settings.youtubeNewsSidebar,
                    },
                  })
                }
              />
              KI-Runde mit sechs Personen aktivieren
            </span>
          </label>
          <label className="settings-option">
            <span>Sidebar-Rotation</span>
            <small>Sekunden pro Nachrichtenkarte im Parallelmodus.</small>
            <input
              type="number"
              min="3"
              max="120"
              value={draft.settings.sidebarRotationSeconds}
              onChange={(event) =>
                setDraft({
                  ...draft,
                  settings: { ...draft.settings, sidebarRotationSeconds: Number(event.target.value) },
                })
              }
            />
          </label>
          <label className="settings-option">
            <span>Wiederholung</span>
            <small>Was passiert, wenn neue Beiträge fehlen.</small>
            <select
              value={draft.settings.repeatPolicy}
              onChange={(event) =>
                setDraft({ ...draft, settings: { ...draft.settings, repeatPolicy: event.target.value as any } })
              }
            >
              <option value="recent-published">Published der letzten 3 Tage</option>
              <option value="loop">Sendung wiederholen</option>
              <option value="none">Nicht wiederholen</option>
            </select>
          </label>
          <label className="settings-option">
            <span>Ziel-Laufzeit</span>
            <small>Planwert in Minuten für eine volle Sendung.</small>
            <input
              type="number"
              min="1"
              max="1440"
              value={draft.settings.targetRuntimeMinutes}
              onChange={(event) =>
                setDraft({
                  ...draft,
                  settings: { ...draft.settings, targetRuntimeMinutes: Number(event.target.value) },
                })
              }
            />
          </label>
          <label className="settings-option stream-target-wide">
            <span>Regie-Notizen</span>
            <small>Interne Hinweise für Moderation, Übergänge oder Quellenlage.</small>
            <textarea
              value={draft.settings.notes}
              onChange={(event) => setDraft({ ...draft, settings: { ...draft.settings, notes: event.target.value } })}
            />
          </label>
          <label className="settings-option stream-target-wide">
            <span>Beschreibung</span>
            <small>Öffentliche Kurzbeschreibung dieser Sendung.</small>
            <textarea
              value={draft.description}
              onChange={(event) => setDraft({ ...draft, description: event.target.value })}
            />
          </label>
        </div>
      </>
    );
  }

  function FormatFields() {
    return (
      <>
        <div className="format-editor-intro" style={{ '--format-color': formatDraft.color } as React.CSSProperties}>
          <span className="format-editor-icon">
            <LayoutTemplate size={24} />
          </span>
          <span>
            <strong>{formatDraft.name || 'Neues Sendeformat'}</strong>
            <small>
              Diese Vorlage definiert Redaktion, Layout und Regie-Standards. Jede geplante Sendung übernimmt daraus eine
              eigenständige Momentaufnahme.
            </small>
          </span>
        </div>
        <div className="settings-automation-grid broadcast-form-grid">
          <label className="settings-option">
            <span>Formatname</span>
            <small>Zum Beispiel „Abendnachrichten“, „Dokumentation“ oder „AVA ordnet ein“.</small>
            <input
              value={formatDraft.name}
              onChange={(event) => setFormatDraft({ ...formatDraft, name: event.target.value })}
            />
          </label>
          <label className="settings-option">
            <span>Inhaltsprinzip</span>
            <small>Bestimmt, welche Inhalte eine Sendung dieses Formats benötigt.</small>
            <select
              value={formatDraft.contentMode}
              onChange={(event) => {
                const contentMode = event.target.value as BroadcastContentMode;
                const layout: Record<BroadcastContentMode, BroadcastLayout> = {
                  news: 'main-news',
                  youtube: 'youtube-video',
                  mixed: 'main-news',
                  'youtube-news-sidebar': 'youtube-news-sidebar',
                  'youtube-context': 'youtube-context',
                  'ai-roundtable': 'youtube-context',
                };
                setFormatDraft({ ...formatDraft, contentMode, layout: layout[contentMode] });
              }}
            >
              {Object.entries(contentModeLabels).map(([value, label]) => (
                <option value={value} key={value}>
                  {label}
                </option>
              ))}
            </select>
          </label>
          <label className="settings-option">
            <span>Bildaufteilung</span>
            <small>Die semantische Layoutart für OBS und den Overlay-Renderer.</small>
            <select
              value={formatDraft.layout}
              onChange={(event) => setFormatDraft({ ...formatDraft, layout: event.target.value as BroadcastLayout })}
            >
              {Object.entries(layoutLabels).map(([value, label]) => (
                <option value={value} key={value}>
                  {label}
                </option>
              ))}
            </select>
          </label>
          <label className="settings-option">
            <span>Overlay-Layout</span>
            <small>Das konkrete Overlay-Projekt, das jede neue Sendung dieses Formats übernimmt.</small>
            <select
              value={formatDraft.overlayProjectId}
              onChange={(event) => setFormatDraft({ ...formatDraft, overlayProjectId: event.target.value })}
            >
              <option value="">Studio-Standard verwenden</option>
              {overlays.map((overlay) => (
                <option value={overlay.id} key={overlay.id}>
                  {overlay.name} · {overlay.template}
                </option>
              ))}
            </select>
            {formatDraft.overlayProjectId && (
              <a className="inline-settings-link" href={`#/overlays/${formatDraft.overlayProjectId}/edit`}>
                Overlay im Designer bearbeiten
              </a>
            )}
          </label>
          <label className="settings-option">
            <span>Standard-Laufzeit</span>
            <small>Zielwert einer einzelnen Ausstrahlung in Minuten.</small>
            <input
              type="number"
              min="1"
              max="1440"
              value={formatDraft.defaultDurationMinutes}
              onChange={(event) =>
                setFormatDraft({ ...formatDraft, defaultDurationMinutes: Number(event.target.value) })
              }
            />
          </label>
          <label className="settings-option">
            <span>Standard-Inhalte</span>
            <small>Wie viele Beiträge oder Videos beim Befüllen vorgeschlagen werden.</small>
            <input
              type="number"
              min="1"
              max="100"
              value={formatDraft.defaultItemCount}
              onChange={(event) => setFormatDraft({ ...formatDraft, defaultItemCount: Number(event.target.value) })}
            />
          </label>
          <label className="settings-option">
            <span>Formatfarbe</span>
            <small>Erkennungsfarbe in Karten und Zeitstrahl.</small>
            <span className="format-color-control">
              <input
                type="color"
                value={formatDraft.color}
                onChange={(event) => setFormatDraft({ ...formatDraft, color: event.target.value })}
              />
              <input
                value={formatDraft.color}
                pattern="^#[0-9A-Fa-f]{6}$"
                onChange={(event) => setFormatDraft({ ...formatDraft, color: event.target.value })}
              />
            </span>
          </label>
          <label className="settings-option">
            <span>Übergang</span>
            <small>Standard für Wechsel zwischen Beiträgen.</small>
            <select
              value={formatDraft.settings.transition}
              onChange={(event) =>
                setFormatDraft({
                  ...formatDraft,
                  settings: { ...formatDraft.settings, transition: event.target.value as any },
                })
              }
            >
              <option value="fade">Weiche Blende</option>
              <option value="headline">Headline-Bridge</option>
              <option value="bumper">Kurzer Bumper</option>
              <option value="clean">Direkter Schnitt</option>
            </select>
          </label>
          <label className="settings-option">
            <span>Pause zwischen Inhalten</span>
            <small>Regieabstand in Sekunden.</small>
            <input
              type="number"
              min="0"
              max="600"
              value={formatDraft.settings.pauseSeconds}
              onChange={(event) =>
                setFormatDraft({
                  ...formatDraft,
                  settings: { ...formatDraft.settings, pauseSeconds: Number(event.target.value) },
                })
              }
            />
          </label>
          <label className="settings-option">
            <span>Sidebar-Wechsel</span>
            <small>Einblenddauer je Textkarte in Sekunden.</small>
            <input
              type="number"
              min="3"
              max="120"
              value={formatDraft.settings.sidebarRotationSeconds}
              onChange={(event) =>
                setFormatDraft({
                  ...formatDraft,
                  settings: { ...formatDraft.settings, sidebarRotationSeconds: Number(event.target.value) },
                })
              }
            />
          </label>
          <label className="settings-option settings-toggle-option">
            <span>Format aktiv</span>
            <small>
              Inaktive Formate bleiben in bestehenden Sendungen erhalten, erscheinen aber nicht beim Planen.
            </small>
            <span className="toggle-row">
              <input
                type="checkbox"
                checked={formatDraft.active}
                onChange={(event) => setFormatDraft({ ...formatDraft, active: event.target.checked })}
              />
              Für neue Sendungen anbieten
            </span>
          </label>
          <label className="settings-option stream-target-wide">
            <span>Formatbeschreibung</span>
            <small>Redaktionelles Konzept und Zweck dieses wiederverwendbaren Formats.</small>
            <textarea
              value={formatDraft.description}
              onChange={(event) => setFormatDraft({ ...formatDraft, description: event.target.value })}
            />
          </label>
        </div>
      </>
    );
  }

  function ContentPicker() {
    return (
      <section className="broadcast-modal-section">
        <div className="section-heading compact-heading">
          <div>
            <p className="eyebrow">Inhaltsauswahl</p>
            <h4>Nachrichten und YouTube-Videos in die Sendung ziehen</h4>
          </div>
          <span className="state-pill">
            {selectedContentCount} ausgewählt · {formatDurationSeconds(selectedDuration)}
          </span>
        </div>
        <label className="settings-search broadcast-search">
          <Search size={16} aria-hidden="true" />
          <span className="visually-hidden">Inhalte suchen</span>
          <input
            value={query}
            placeholder="Beitrag, Quelle, Ressort, Kanal oder YouTube-URL suchen …"
            onChange={(event) => setQuery(event.target.value)}
          />
        </label>
        {draft.settings.youtubeNewsSidebar && (
          <p className="notice">
            Parallelmodus: Die ausgewählten Nachrichten werden als Textkarten in die linke Sidebar geschrieben. Nur die
            ausgewählten YouTube-Videos liefern Audio.
          </p>
        )}
        {draft.settings.youtubeContext && !draft.settings.aiRoundtable && (
          <p className="notice">
            YouTube-Einordnung: Wähle mindestens ein Video. Nachrichten sind optional und dienen als Fallback, falls
            Transkript oder OpenRouter Free vorübergehend nicht verfügbar sind.
          </p>
        )}
        {draft.settings.aiRoundtable && (
          <p className="notice">
            KI Studio Runde: Das Video wird im großen Programmfenster gespielt. Sechs eigenständige Moderatoren
            sprechen mit ihren Stimmen zeitcodierte Einordnungen und greifen sichere Chatimpulse auf.
          </p>
        )}
        {draft.settings.contentMode !== 'youtube' && (
          <>
            <div className="section-heading compact-heading">
              <div>
                <p className="eyebrow">Nachrichten</p>
                <h4>Freigegebene Beiträge</h4>
              </div>
              <span className="state-pill">{selectableArticles.length} verfügbar</span>
            </div>
            <div className="broadcast-article-picker">
              {selectableArticles.slice(0, 30).map((article) => (
                <button
                  type="button"
                  className="article-pick-card"
                  key={article.id}
                  onClick={() => setSelectedArticleIds((current) => [...current, article.id])}
                >
                  <span className="article-pick-icon">
                    <Plus size={15} />
                  </span>
                  <span>
                    <strong>{article.title}</strong>
                    <small>
                      {article.source_name ?? 'Quelle'} · {article.status} ·{' '}
                      {formatDurationSeconds(article.audio_duration_seconds ?? 60)}
                    </small>
                  </span>
                </button>
              ))}
            </div>
          </>
        )}
        {draft.settings.contentMode !== 'news' && (
          <>
            <div className="section-heading compact-heading">
              <div>
                <p className="eyebrow">YouTube</p>
                <h4>Videos aus der Bibliothek</h4>
              </div>
              <span className="state-pill">{selectableYoutubeVideos.length} verfügbar</span>
            </div>
            <div className="broadcast-article-picker">
              {selectableYoutubeVideos.slice(0, 30).map((video) => (
                <button
                  type="button"
                  className="article-pick-card"
                  key={video.id}
                  onClick={() => setSelectedYoutubeVideoIds((current) => [...current, video.id])}
                >
                  <span className="article-pick-icon youtube">
                    <Film size={15} />
                  </span>
                  <span>
                    <strong>{video.title}</strong>
                    <small>
                      {video.channel_title ?? 'YouTube'} · {video.category_name ?? 'ohne Kategorie'} ·{' '}
                      {formatDurationSeconds(video.duration_seconds)}
                    </small>
                  </span>
                </button>
              ))}
            </div>
          </>
        )}
        {selectedArticleIds.length > 0 && (
          <div className="selected-chip-row">
            {selectedArticleIds.map((id) => {
              const article = articles.find((candidate) => candidate.id === id);
              return (
                <button
                  key={id}
                  className="state-pill"
                  onClick={() => setSelectedArticleIds((current) => current.filter((candidate) => candidate !== id))}
                >
                  <X size={12} /> {article?.title?.slice(0, 38) ?? id}
                </button>
              );
            })}
          </div>
        )}
        {selectedYoutubeVideoIds.length > 0 && (
          <div className="selected-chip-row">
            {selectedYoutubeVideoIds.map((id) => {
              const video = youtubeVideos.find((candidate) => candidate.id === id);
              return (
                <button
                  key={id}
                  className="state-pill"
                  onClick={() =>
                    setSelectedYoutubeVideoIds((current) => current.filter((candidate) => candidate !== id))
                  }
                >
                  <X size={12} /> YouTube: {video?.title?.slice(0, 34) ?? id}
                </button>
              );
            })}
          </div>
        )}
      </section>
    );
  }

  function AiPlannerFields() {
    const toggleCategory = (category: string) =>
      setAiDraft((current) => ({
        ...current,
        categoryFilters: current.categoryFilters.includes(category)
          ? current.categoryFilters.filter((value) => value !== category)
          : [...current.categoryFilters, category],
      }));
    return (
      <>
        <div className="ai-planner-summary">
          <span className="stat-icon">
            <WandSparkles size={20} />
          </span>
          <div>
            <strong>{plannerCandidateCount} passende Beiträge verfügbar</strong>
            <p>
              OpenRouter plant zuerst redaktionell. Bei Provider- oder JSON-Fehlern entsteht automatisch ein lokaler,
              sendefähiger Ersatzplan.
            </p>
          </div>
        </div>
        <div className="settings-automation-grid broadcast-form-grid">
          <label className="settings-option">
            <span>Sendungstitel</span>
            <small>Optional – sonst wird ein Titel aus Kanal, Schwerpunkt und Zeit erzeugt.</small>
            <input
              value={aiDraft.name}
              placeholder="Automatisch erzeugen"
              onChange={(event) => setAiDraft({ ...aiDraft, name: event.target.value })}
            />
          </label>
          <label className="settings-option">
            <span>Sendeformat</span>
            <small>Der KI-Plan wird als konkrete Sendung dieses Formats angelegt.</small>
            <select
              value={aiDraft.formatId}
              onChange={(event) => {
                const format = formats.find((candidate) => candidate.id === event.target.value);
                setAiDraft({
                  ...aiDraft,
                  formatId: event.target.value,
                  overlayProjectId: format?.overlay_project_id ?? '',
                  targetRuntimeMinutes: format?.default_duration_minutes ?? aiDraft.targetRuntimeMinutes,
                  maximumItems: Math.min(16, format?.default_item_count ?? aiDraft.maximumItems),
                });
              }}
            >
              <option value="">Individueller Nachrichtenplan</option>
              {activeFormats
                .filter((format) => ['news', 'mixed'].includes(format.content_mode))
                .map((format) => (
                  <option value={format.id} key={format.id}>
                    {format.name} · {format.default_duration_minutes} Min.
                  </option>
                ))}
            </select>
          </label>
          <label className="settings-option">
            <span>Redaktioneller Schwerpunkt</span>
            <small>Steuert Gewichtung und Dramaturgie der Beitragsauswahl.</small>
            <select
              value={aiDraft.focus}
              onChange={(event) => setAiDraft({ ...aiDraft, focus: event.target.value as AiPlanDraft['focus'] })}
            >
              <option value="balanced">Ausgewogener Überblick</option>
              <option value="breaking">Aktuelle / Breaking News</option>
              <option value="politics">Politik</option>
              <option value="economy">Wirtschaft</option>
              <option value="technology">Technologie</option>
              <option value="regional">Regional</option>
              <option value="international">International</option>
              <option value="culture">Kultur</option>
              <option value="sports">Sport</option>
            </select>
          </label>
          <label className="settings-option">
            <span>Themenmischung</span>
            <small>Wie stark Ressorts und Quellen zwischen Beiträgen wechseln sollen.</small>
            <select
              value={aiDraft.diversity}
              onChange={(event) =>
                setAiDraft({ ...aiDraft, diversity: event.target.value as AiPlanDraft['diversity'] })
              }
            >
              <option value="high">Hohe Vielfalt</option>
              <option value="balanced">Ausgewogen</option>
              <option value="focused">Fokussiert</option>
            </select>
          </label>
          <label className="settings-option">
            <span>Maximale Beiträge</span>
            <small>Obergrenze der Sendeliste.</small>
            <input
              type="number"
              min="1"
              max="16"
              value={aiDraft.maximumItems}
              onChange={(event) => setAiDraft({ ...aiDraft, maximumItems: Number(event.target.value) })}
            />
          </label>
          <label className="settings-option">
            <span>Ziel-Laufzeit</span>
            <small>Gewünschter Umfang in Minuten.</small>
            <input
              type="number"
              min="2"
              max="180"
              value={aiDraft.targetRuntimeMinutes}
              onChange={(event) => setAiDraft({ ...aiDraft, targetRuntimeMinutes: Number(event.target.value) })}
            />
          </label>
          <label className="settings-option">
            <span>Aktualitätsfenster</span>
            <small>Nur Beiträge aus diesem Zeitraum berücksichtigen.</small>
            <select
              value={aiDraft.freshnessHours}
              onChange={(event) => setAiDraft({ ...aiDraft, freshnessHours: Number(event.target.value) })}
            >
              <option value={6}>Letzte 6 Stunden</option>
              <option value={24}>Letzte 24 Stunden</option>
              <option value={72}>Letzte 3 Tage</option>
              <option value={168}>Letzte 7 Tage</option>
              <option value={720}>Letzte 30 Tage</option>
            </select>
          </label>
          <label className="settings-option">
            <span>Mindestvertrauen</span>
            <small>Beiträge unter diesem redaktionellen Quellenwert ausschließen.</small>
            <input
              type="number"
              min="0"
              max="100"
              value={aiDraft.minimumTrust}
              onChange={(event) => setAiDraft({ ...aiDraft, minimumTrust: Number(event.target.value) })}
            />
          </label>
          <label className="settings-option">
            <span>Format</span>
            <small>Metadaten für Sendeplan und Regie.</small>
            <select
              value={aiDraft.kind}
              onChange={(event) => setAiDraft({ ...aiDraft, kind: event.target.value as AiPlanDraft['kind'] })}
            >
              <option value="show">Ganze Sendung</option>
              <option value="hour">Stundenblock</option>
              <option value="special">Spezialausgabe</option>
              <option value="playlist">Playlist</option>
            </select>
          </label>
          <label className="settings-option">
            <span>Geplante Ausstrahlung</span>
            <small>Optional direkt in den zeitlichen Sendeplan einordnen.</small>
            <input
              type="datetime-local"
              value={aiDraft.scheduledAt}
              onChange={(event) => setAiDraft({ ...aiDraft, scheduledAt: event.target.value })}
            />
          </label>
          <label className="settings-option">
            <span>Übergang</span>
            <small>Standardübergang zwischen den geplanten Beiträgen.</small>
            <select
              value={aiDraft.transition}
              onChange={(event) =>
                setAiDraft({ ...aiDraft, transition: event.target.value as AiPlanDraft['transition'] })
              }
            >
              <option value="fade">Weiche Blende</option>
              <option value="headline">Headline-Bridge</option>
              <option value="bumper">Bumper</option>
              <option value="clean">Direkt</option>
            </select>
          </label>
          <label className="settings-option">
            <span>Beitragspause</span>
            <small>Regiepause zwischen zwei Beiträgen in Sekunden.</small>
            <input
              type="number"
              min="0"
              max="600"
              value={aiDraft.pauseSeconds}
              onChange={(event) => setAiDraft({ ...aiDraft, pauseSeconds: Number(event.target.value) })}
            />
          </label>
          <label className="settings-option">
            <span>Overlay-Set</span>
            <small>Optional ein bestimmtes veröffentlichtes Design vorsehen.</small>
            <select
              value={aiDraft.overlayProjectId}
              onChange={(event) => setAiDraft({ ...aiDraft, overlayProjectId: event.target.value })}
            >
              <option value="">Standard-Overlay</option>
              {overlays.map((overlay) => (
                <option key={overlay.id} value={overlay.id}>
                  {overlay.name}
                </option>
              ))}
            </select>
          </label>
          <label className="settings-option stream-target-wide">
            <span>Zusätzlicher Planungsauftrag</span>
            <small>
              Zum Beispiel gewünschte Reihenfolge, Schwerpunkte oder Themen, die nicht nebeneinander stehen sollen.
            </small>
            <textarea
              value={aiDraft.instructions}
              maxLength={1200}
              onChange={(event) => setAiDraft({ ...aiDraft, instructions: event.target.value })}
            />
          </label>
        </div>
        {plannerCategories.length > 0 && (
          <section className="broadcast-modal-section">
            <div className="section-heading compact-heading">
              <div>
                <p className="eyebrow">Ressortfilter</p>
                <h4>Erlaubte Themenbereiche</h4>
              </div>
              <span className="state-pill">{aiDraft.categoryFilters.length || 'alle'}</span>
            </div>
            <div className="planner-filter-chips">
              {plannerCategories.map((category) => (
                <button
                  type="button"
                  key={category}
                  className={aiDraft.categoryFilters.includes(category) ? 'active' : ''}
                  onClick={() => toggleCategory(category)}
                >
                  {category}
                </button>
              ))}
            </div>
          </section>
        )}
        {plannerSources.length > 0 && (
          <label className="settings-option planner-source-filter">
            <span>Auf Quelle begrenzen</span>
            <small>Optional nur Beiträge einer bestimmten Quelle verwenden.</small>
            <select
              value={aiDraft.sourceIds[0] ?? ''}
              onChange={(event) =>
                setAiDraft({ ...aiDraft, sourceIds: event.target.value ? [event.target.value] : [] })
              }
            >
              <option value="">Alle aktiven Quellen</option>
              {plannerSources.map(([id, name]) => (
                <option value={id} key={id}>
                  {name}
                </option>
              ))}
            </select>
          </label>
        )}
      </>
    );
  }

  function FormatLibrary() {
    return (
      <section className="broadcast-format-library" id="broadcast-formats">
        <div className="section-heading">
          <div>
            <p className="eyebrow">Vorlagenbibliothek</p>
            <h3>Sendeformate</h3>
            <p className="section-description">
              Ein Format beschreibt, wie eine Sendung aussieht und funktioniert. Erst beim Einplanen entsteht daraus
              eine konkrete Sendung mit Uhrzeit und Inhalten.
            </p>
          </div>
          <div className="toolbar">
            <button className="primary-button" disabled={!allowedWrite} onClick={openNewFormat}>
              <Plus size={17} /> Sendeformat erstellen
            </button>
          </div>
        </div>
        <label className="settings-search broadcast-format-search">
          <Search size={16} aria-hidden="true" />
          <span className="visually-hidden">Sendeformate suchen</span>
          <input
            value={formatQuery}
            placeholder="Sendeformat, Inhaltsart oder Overlay suchen …"
            onChange={(event) => setFormatQuery(event.target.value)}
          />
        </label>
        <div className="broadcast-format-grid">
          {visibleFormats.map((format) => {
            const FormatIcon = contentModeIcon(format.content_mode);
            return (
              <article
                className={`broadcast-format-card ${!format.active ? 'inactive' : ''}`}
                style={{ '--format-color': format.color } as React.CSSProperties}
                key={format.id}
              >
                <div className="format-card-accent" />
                <div className="format-card-heading">
                  <span className="format-card-icon">
                    <FormatIcon size={21} />
                  </span>
                  <span>
                    <span className="format-card-kicker">
                      {format.is_system ? 'Studioformat' : 'Eigenes Format'} · {format.active ? 'aktiv' : 'inaktiv'}
                    </span>
                    <strong>{format.name}</strong>
                  </span>
                </div>
                <p>{format.description || 'Noch keine Formatbeschreibung hinterlegt.'}</p>
                <div className="format-stat-grid">
                  <span>
                    <strong>{format.default_duration_minutes}</strong>
                    <small>Minuten</small>
                  </span>
                  <span>
                    <strong>{format.default_item_count}</strong>
                    <small>Inhalte</small>
                  </span>
                  <span>
                    <strong>{format.upcoming_count}</strong>
                    <small>geplant</small>
                  </span>
                  <span>
                    <strong>{format.usage_count}</strong>
                    <small>Sendungen</small>
                  </span>
                </div>
                <div className="format-layout-summary">
                  <span>
                    <LayoutTemplate size={14} /> {layoutLabels[format.layout]}
                  </span>
                  <small>{format.overlay_project_name ?? 'Studio-Standard-Overlay'}</small>
                </div>
                <div className="show-card-actions format-card-actions">
                  <button disabled={!allowedWrite || !format.active} onClick={() => openCreate({ format })}>
                    <CalendarPlus size={16} /> Sendung planen
                  </button>
                  <button disabled={!allowedWrite} onClick={() => openFormat(format)}>
                    <Edit3 size={16} /> Einstellungen
                  </button>
                  <button
                    className="ghost-button icon-button"
                    disabled={!allowedWrite}
                    title="Als eigenes Format duplizieren"
                    onClick={() => void duplicateFormat(format)}
                  >
                    <Copy size={15} />
                  </button>
                </div>
              </article>
            );
          })}
          {!visibleFormats.length && (
            <div className="empty-state-card">
              <Library size={22} />
              <strong>Kein passendes Sendeformat</strong>
              <span>Suche ändern oder ein neues Format anlegen.</span>
            </div>
          )}
        </div>
      </section>
    );
  }

  function scrollToSection(id: string) {
    document.getElementById(id)?.scrollIntoView({ behavior: 'smooth', block: 'start' });
  }

  function PlaylistCard({ playlist, compact = false }: { playlist: any; compact?: boolean }) {
    const settings = playlist.settings ?? {};
    const overlay = overlays.find((candidate) => candidate.id === playlist.overlay_project_id);
    const formatMode = (playlist.format_content_mode ?? settings.contentMode ?? 'news') as BroadcastContentMode;
    const ShowFormatIcon = contentModeIcon(formatMode);
    const productionStatus =
      playlist.production_status ??
      (playlist.status === 'running' ? 'on_air' : playlist.scheduled_at ? 'scheduled' : 'draft');
    return (
      <article
        className={`playlist-row show-card ${compact ? 'compact-show-card' : ''} ${draggingPlaylistId === playlist.id ? 'dragging' : ''}`}
        style={{ '--format-color': playlist.format_color ?? '#5690ff' } as React.CSSProperties}
        draggable={allowedWrite}
        onDragStart={() => setDraggingPlaylistId(playlist.id)}
        onDragEnd={() => setDraggingPlaylistId(null)}
        onDragOver={(event) => event.preventDefault()}
        onDrop={() => void dropPlaylistNear(playlist)}
        title="Sendung per Drag-and-drop im Sendeplan verschieben"
      >
        <div className="show-card-main">
          <span className="show-kind-icon">
            <ShowFormatIcon size={18} />
          </span>
          <div>
            <span className="show-format-label">{playlist.format_name ?? 'Individuelle Sendung'}</span>
            <strong>{playlist.name}</strong>
            <p>{playlist.description || 'Keine Beschreibung hinterlegt.'}</p>
            <small>
              {productionStatusLabels[productionStatus] ?? productionStatus} · {playlist.kind ?? 'playlist'} · geplant{' '}
              {formatTime(playlist.scheduled_at)}
            </small>
          </div>
        </div>
        <div className="show-meta-strip">
          <span className="state-pill">
            <Scissors size={12} /> {settings.transition ?? 'fade'}
          </span>
          <span className="state-pill">
            <Clock3 size={12} /> {settings.pauseSeconds ?? 5}s Pause
          </span>
          <span className="state-pill">
            <Shuffle size={12} /> {settings.repeatPolicy ?? 'recent-published'}
          </span>
          <span className="state-pill">
            <Layers3 size={12} /> {overlay?.name ?? 'Standard'}
          </span>
          <span className="state-pill">
            <LayoutTemplate size={12} /> {contentModeLabels[formatMode]}
          </span>
        </div>
        <div className="show-card-actions">
          <button
            className={`workflow-status-button status-${productionStatus}`}
            disabled={workflowBusyId === playlist.id}
            onClick={() => void inspectReadiness(playlist)}
          >
            <ListChecks size={16} /> {productionStatusLabels[productionStatus] ?? 'Prüfen'}
          </button>
          <button disabled={!allowedWrite} onClick={() => void openEdit(playlist)}>
            <Edit3 size={16} /> Bearbeiten
          </button>
          <button
            className="ghost-button"
            disabled={!allowedWrite || workflowBusyId === playlist.id}
            onClick={() => void duplicatePlaylist(playlist)}
          >
            <Copy size={16} /> Duplizieren
          </button>
          <button
            disabled={
              !allowedWrite || workflowBusyId === playlist.id || ['prepared', 'on_air'].includes(productionStatus)
            }
            onClick={() => void prepareForControl(playlist)}
          >
            <Clapperboard size={16} /> Für Regie vorbereiten
          </button>
          <button
            className="ghost-button"
            onClick={() => navigate(`/live?workspace=rundown&playlist=${playlist.id}`)}
          >
            <Radio size={16} /> In Regie öffnen
          </button>
          <button
            className="ghost-button danger-text"
            disabled={
              !allowedWrite ||
              deletingPlaylistId === playlist.id ||
              status?.run?.playlist_id === playlist.id ||
              activeShowSwitch?.target_playlist_id === playlist.id
            }
            title={
              status?.run?.playlist_id === playlist.id
                ? 'Die laufende Sendung muss vor dem Löschen gestoppt werden'
                : 'Sendung und Ablauf löschen'
            }
            onClick={() => void deletePlaylist(playlist.id, playlist.name)}
          >
            <Trash2 size={16} /> {deletingPlaylistId === playlist.id ? 'Lösche …' : 'Löschen'}
          </button>
          <button
            className="primary-button"
            disabled={!allowedWrite || switchingShow || Boolean(activeShowSwitch) || workflowBusyId === playlist.id}
            onClick={() => void takeReadyPlaylist(playlist)}
          >
            {status?.run ? <ArrowRightLeft size={17} /> : <Play size={17} />}
            Jetzt übernehmen
          </button>
        </div>
      </article>
    );
  }

  function PlanTimeline() {
    const scheduledInDay = visiblePlaylists.filter((playlist) => playlistHour(playlist) !== null);
    const unscheduled = visiblePlaylists.filter((playlist) => playlistHour(playlist) === null);
    return (
      <div className="broadcast-timeline-view">
        <div className="timeline-toolbar">
          <label>
            Sendetag
            <input type="date" value={scheduleDate} onChange={(event) => setScheduleDate(event.target.value)} />
          </label>
          <span className="state-pill">
            <CalendarClock size={12} /> {scheduledInDay.length} geplante Slots
          </span>
          <span className="state-pill">
            <Shuffle size={12} /> {unscheduled.length} ohne feste Uhrzeit
          </span>
        </div>
        <div className="calendar-lane">
          {Array.from({ length: 24 }, (_, hour) => {
            const slotPlaylists = visiblePlaylists.filter((playlist) => playlistHour(playlist) === hour);
            return (
              <section
                className={`calendar-hour-slot ${slotPlaylists.length ? 'filled' : ''}`}
                key={hour}
                onDragOver={(event) => event.preventDefault()}
                onDrop={() => void dropPlaylistOnHour(hour)}
              >
                <div className="calendar-hour-label">
                  <strong>{String(hour).padStart(2, '0')}:00</strong>
                  <small>{slotPlaylists.length ? `${slotPlaylists.length} Sendung(en)` : 'frei'}</small>
                </div>
                <div className="calendar-hour-content">
                  {slotPlaylists.length ? (
                    slotPlaylists.map((playlist) => <TimelineShowCard playlist={playlist} key={playlist.id} />)
                  ) : (
                    <span className="empty-slot-actions">
                      <span className="drop-hint">Sendung hier ablegen</span>
                      <button
                        type="button"
                        className="ghost-button"
                        disabled={!allowedWrite}
                        onClick={() => openCreate({ scheduledAt: slotDate(hour) })}
                      >
                        <CalendarPlus size={14} /> Sendung einplanen
                      </button>
                    </span>
                  )}
                </div>
              </section>
            );
          })}
        </div>
        {unscheduled.length > 0 && (
          <section className="unscheduled-strip">
            <div className="section-heading compact-heading">
              <div>
                <p className="eyebrow">Ablage</p>
                <h4>Ohne feste Uhrzeit</h4>
              </div>
              <span className="state-pill">per Drag-and-drop auf einen Slot ziehen</span>
            </div>
            <div className="unscheduled-card-grid">
              {unscheduled.map((playlist) => (
                <TimelineShowCard playlist={playlist} key={playlist.id} />
              ))}
            </div>
          </section>
        )}
      </div>
    );
  }

  function TimelineShowCard({ playlist }: { playlist: any }) {
    const settings = playlist.settings ?? {};
    const productionStatus =
      playlist.production_status ??
      (playlist.status === 'running' ? 'on_air' : playlist.scheduled_at ? 'scheduled' : 'draft');
    return (
      <article
        id={`broadcast-timeline-${playlist.id}`}
        className={`timeline-show-card ${draggingPlaylistId === playlist.id ? 'dragging' : ''} ${
          createdPlaylistFocusId === playlist.id ? 'created-focus' : ''
        }`}
        style={{ '--format-color': playlist.format_color ?? '#5690ff' } as React.CSSProperties}
        tabIndex={-1}
        draggable={allowedWrite}
        onDragStart={() => setDraggingPlaylistId(playlist.id)}
        onDragEnd={() => setDraggingPlaylistId(null)}
        onDragOver={(event) => event.preventDefault()}
        onDrop={() => void dropPlaylistNear(playlist)}
      >
        <div>
          <p className="eyebrow">
            {playlist.format_name ?? 'Individuell'} · {productionStatusLabels[productionStatus] ?? productionStatus}
          </p>
          <h4>{playlist.name}</h4>
          <p>{playlist.description || 'Keine Beschreibung hinterlegt.'}</p>
          <div className="show-meta-strip">
            <span className="state-pill">
              <Clock3 size={12} /> {settings.pauseSeconds ?? 5}s
            </span>
            <span className="state-pill">
              <Scissors size={12} /> {settings.transition ?? 'fade'}
            </span>
            <span className="state-pill">
              <Sparkles size={12} /> {settings.targetRuntimeMinutes ?? 30} Min Ziel
            </span>
          </div>
        </div>
        <div className="show-card-actions">
          <button disabled={workflowBusyId === playlist.id} onClick={() => void inspectReadiness(playlist)}>
            <ListChecks size={16} /> Prüfen
          </button>
          <button disabled={!allowedWrite} onClick={() => void openEdit(playlist)}>
            <Edit3 size={16} /> Bearbeiten
          </button>
          <button
            disabled={!allowedWrite || workflowBusyId === playlist.id || productionStatus === 'on_air'}
            onClick={() => void prepareForControl(playlist)}
          >
            <Clapperboard size={16} /> Vorbereiten
          </button>
          <button
            className="ghost-button"
            onClick={() => navigate(`/live?workspace=rundown&playlist=${playlist.id}`)}
          >
            <Radio size={16} /> Regie
          </button>
          <button
            className="ghost-button"
            disabled={!allowedWrite || workflowBusyId === playlist.id}
            onClick={() => void duplicatePlaylist(playlist)}
          >
            <Copy size={16} /> Duplizieren
          </button>
          <button
            className="ghost-button danger-text"
            disabled={
              !allowedWrite ||
              deletingPlaylistId === playlist.id ||
              status?.run?.playlist_id === playlist.id ||
              activeShowSwitch?.target_playlist_id === playlist.id
            }
            title={
              status?.run?.playlist_id === playlist.id
                ? 'Die laufende Sendung muss vor dem Löschen gestoppt werden'
                : 'Sendung und Ablauf löschen'
            }
            onClick={() => void deletePlaylist(playlist.id, playlist.name)}
          >
            <Trash2 size={16} /> {deletingPlaylistId === playlist.id ? 'Lösche …' : 'Löschen'}
          </button>
          <button
            className="primary-button"
            disabled={!allowedWrite || switchingShow || Boolean(activeShowSwitch) || workflowBusyId === playlist.id}
            onClick={() => void takeReadyPlaylist(playlist)}
          >
            {status?.run ? <ArrowRightLeft size={17} /> : <Play size={17} />}
            Übernehmen
          </button>
        </div>
      </article>
    );
  }

  return (
    <section className="panel broadcast-page">
      <div className="page-title">
        <div>
          <p className="eyebrow">Sendebetrieb · Planung</p>
          <h2>Sendungen vorbereiten und einplanen</h2>
          <p>Formate gestalten, Rundowns sendefertig machen und anschließend kontrolliert an die Regie übergeben.</p>
        </div>
        <button className="primary-button" onClick={() => navigate('/live?workspace=rundown')}>
          <Radio size={16} /> Regie öffnen
        </button>
      </div>

      <OnAirBar status={operations} active="planning" />

      <nav className="broadcast-workspace-nav" aria-label="Planungsbereiche">
        <button onClick={() => scrollToSection('broadcast-planned')}>
          <CalendarClock size={16} />
          <span>
            <strong>24-Stunden-Programm</strong>
            <small>Zeitstrahl und ungeplante Sendungen</small>
          </span>
        </button>
        <button onClick={() => scrollToSection('broadcast-formats')}>
          <LayoutTemplate size={16} />
          <span>
            <strong>Sendeformate</strong>
            <small>Wiederverwendbare Vorlagen</small>
          </span>
        </button>
        <button onClick={() => navigate('/live?workspace=rundown')}>
          <Radio size={16} />
          <span>
            <strong>Zur Regie</strong>
            <small>Rundown und On-Air-Steuerung</small>
          </span>
        </button>
      </nav>

      <div className="broadcast-hero-grid">
        <button className="broadcast-hero-card hero-action-card" onClick={() => setPlanView('timeline')}>
          <span className="stat-icon success">
            <CalendarClock size={21} />
          </span>
          <div>
            <p className="eyebrow">Tagesprogramm</p>
            <h3>{playlists.filter((playlist) => playlist.scheduled_at).length} eingeplant</h3>
            <p>{playlists.filter((playlist) => !playlist.scheduled_at).length} Sendungen warten noch auf einen Slot.</p>
          </div>
        </button>
        <button className="broadcast-hero-card hero-action-card" onClick={() => scrollToSection('broadcast-planned')}>
          <span className="stat-icon">
            <ListChecks size={21} />
          </span>
          <div>
            <p className="eyebrow">Sendefertig</p>
            <h3>{playlists.filter((playlist) => ['ready', 'prepared'].includes(playlist.production_status)).length}</h3>
            <p>
              {playlists.filter((playlist) => ['draft', 'incomplete'].includes(playlist.production_status)).length}{' '}
              Entwürfe oder unvollständige Sendungen.
            </p>
          </div>
        </button>
        <button className="broadcast-hero-card hero-action-card" onClick={() => scrollToSection('broadcast-formats')}>
          <span className="stat-icon">
            <LayoutTemplate size={21} />
          </span>
          <div>
            <p className="eyebrow">Sendeformate</p>
            <h3>{activeFormats.length} aktiv</h3>
            <p>{formats.length} Vorlagen mit eigenem Inhalt, Layout und Overlay.</p>
          </div>
        </button>
        <button
          className="broadcast-hero-card hero-action-card"
          onClick={() => navigate('/live?workspace=rundown')}
        >
          <span className={`stat-icon ${operations?.prepared.length ? 'success' : ''}`}>
            <Clapperboard size={21} />
          </span>
          <div>
            <p className="eyebrow">Für Regie vorbereitet</p>
            <h3>{operations?.prepared.length ?? 0} verfügbar</h3>
            <p>Vorbereitete Sendungen können in der Regie in Vorschau geladen werden.</p>
          </div>
        </button>
      </div>

      <div className="planning-action-deck">
        <div>
          <p className="eyebrow">Nächster Schritt</p>
          <h3>Sendung aufbauen</h3>
          <p>Manuell zusammenstellen oder einen redaktionellen KI-Plan als Ausgangspunkt verwenden.</p>
        </div>
        <div className="planning-primary-actions">
          <button className="primary-button" disabled={!allowedWrite} onClick={() => openCreate()}>
            <Clapperboard size={17} /> Neue Sendung
          </button>
          <button disabled={!allowedWrite || aiPlanning} onClick={openAiPlan}>
            <WandSparkles size={17} /> {aiPlanning ? 'KI plant …' : 'KI-Plan'}
          </button>
        </div>
      </div>
      {message && <p className="notice planning-notice">{message}</p>}

      <FormatLibrary />

      <div className="section-heading" id="broadcast-planned">
        <div>
          <p className="eyebrow">Sendeplan</p>
          <h3>Sendungen und Playlists</h3>
        </div>
        <div className="toolbar">
          <div className="view-toggle" aria-label="Sendeplan-Ansicht wählen">
            <button className={planView === 'grid' ? 'active' : ''} onClick={() => setPlanView('grid')}>
              <Layers3 size={15} /> Raster
            </button>
            <button className={planView === 'list' ? 'active' : ''} onClick={() => setPlanView('list')}>
              <ListVideo size={15} /> Liste
            </button>
            <button className={planView === 'timeline' ? 'active' : ''} onClick={() => setPlanView('timeline')}>
              <CalendarClock size={15} /> Zeitstrahl
            </button>
          </div>
          <button className="primary-button" disabled={!allowedWrite} onClick={() => openCreate()}>
            <ListPlus size={17} /> Sendung erstellen
          </button>
          <ListVideo size={18} className="muted" />
        </div>
      </div>
      {planView === 'timeline' ? (
        <PlanTimeline />
      ) : (
        <div className={`playlist-list ${planView === 'grid' ? 'broadcast-show-grid' : 'broadcast-show-list'}`}>
          {visiblePlaylists.map((playlist) => (
            <PlaylistCard playlist={playlist} compact={planView === 'list'} key={playlist.id} />
          ))}
        </div>
      )}
      <div className="playlist-list">
        {playlists.length > 12 && (
          <button className="ghost-button" onClick={() => setShowAllPlaylists((current) => !current)}>
            {showAllPlaylists ? <ChevronUp size={17} /> : <ChevronDown size={17} />}
            {showAllPlaylists ? 'Weniger anzeigen' : `${playlists.length - 12} weitere Sendungen anzeigen`}
          </button>
        )}
      </div>

      {modal === 'readiness' && readiness && readinessPlaylist && (
        <BroadcastModal
          title="Sendefähigkeitsprüfung"
          icon={ListChecks}
          onClose={() => {
            setModal(null);
            setReadiness(null);
            setReadinessPlaylist(null);
          }}
        >
          <div className={`readiness-summary ${readiness.ready ? 'ready' : 'blocked'}`}>
            <span className="stat-icon">{readiness.ready ? <CirclePlay size={22} /> : <Archive size={22} />}</span>
            <div>
              <p className="eyebrow">{readinessPlaylist.name}</p>
              <h3>{readiness.ready ? 'Sendefertig' : 'Noch nicht sendefertig'}</h3>
              <p>
                {readiness.itemCount} Beiträge · etwa {formatDurationSeconds(readiness.totalRuntimeSeconds)}
                {readiness.targetRuntimeSeconds
                  ? ` · Ziel ${formatDurationSeconds(readiness.targetRuntimeSeconds)}`
                  : ''}
              </p>
            </div>
          </div>
          <div className="readiness-check-list">
            {readiness.issues.length ? (
              readiness.issues.map((issue) => (
                <article className={`readiness-issue ${issue.severity}`} key={`${issue.code}-${issue.itemId ?? ''}`}>
                  <strong>{issue.label}</strong>
                  <p>{issue.detail}</p>
                </article>
              ))
            ) : (
              <article className="readiness-issue success">
                <strong>Alle Prüfungen bestanden</strong>
                <p>Inhalte, Laufzeiten, Audios und Overlay sind für die Ausstrahlung vorbereitet.</p>
              </article>
            )}
          </div>
          {modalError && <p className="status-message status-error">{modalError}</p>}
          <div className="modal-actions">
            <button
              onClick={() => {
                setModal(null);
                void openEdit(readinessPlaylist);
              }}
            >
              <Edit3 size={16} /> Sendung bearbeiten
            </button>
            <button
              disabled={!allowedWrite || !readiness.ready || workflowBusyId === readinessPlaylist.id}
              onClick={() => void prepareForControl(readinessPlaylist)}
            >
              <Clapperboard size={16} /> Für Regie vorbereiten
            </button>
            <button
              className="primary-button"
              disabled={!readiness.ready}
              onClick={() => navigate(`/live?workspace=rundown&playlist=${readinessPlaylist.id}`)}
            >
              <Radio size={16} /> In Regie öffnen
            </button>
          </div>
        </BroadcastModal>
      )}

      {modal === 'show-switch' && showSwitchTarget && (
        <BroadcastModal
          title="Sendung jetzt übernehmen"
          icon={ArrowRightLeft}
          onClose={() => !switchingShow && setModal(null)}
        >
          <div className="show-switch-route">
            <article>
              <span className="eyebrow">Aktuell</span>
              <strong>{currentPlaylist?.name ?? 'Laufendes Programm'}</strong>
              <small>{items.find((item: any) => item.id === playback.itemId)?.title ?? playback.status}</small>
            </article>
            <span className="show-switch-arrow">
              <ArrowRightLeft size={22} />
            </span>
            <article className="target">
              <span className="eyebrow">Danach on air</span>
              <strong>{showSwitchTarget.playlist.name}</strong>
              <small>
                {showSwitchTarget.item
                  ? `Start ab Beitrag „${showSwitchTarget.item.title}“`
                  : 'Start am Anfang der Sendung'}
              </small>
            </article>
          </div>
          <div className="settings-grid show-switch-settings">
            <label className="settings-option">
              <span>Überblendung</span>
              <small>Die aktuelle Sendung wird zuerst sauber aus dem Programm genommen.</small>
              <select
                value={showSwitchTarget.transition}
                onChange={(event) =>
                  setShowSwitchTarget((current) =>
                    current ? { ...current, transition: event.target.value as ShowSwitchTransition } : current,
                  )
                }
              >
                <option value="fade">Weiche Blende</option>
                <option value="swipe">Wischen</option>
                <option value="slide">Schieben</option>
                <option value="luma_wipe">Luma-Blende</option>
                <option value="cut">Harter Schnitt</option>
              </select>
            </label>
            <label className="settings-option">
              <span>Blenddauer: {showSwitchTarget.transitionDurationMs} ms</span>
              <small>Kurze Blenden wirken direkt, längere Wechsel ruhiger.</small>
              <input
                type="range"
                min="0"
                max="2500"
                step="50"
                disabled={showSwitchTarget.transition === 'cut'}
                value={showSwitchTarget.transition === 'cut' ? 0 : showSwitchTarget.transitionDurationMs}
                onChange={(event) =>
                  setShowSwitchTarget((current) =>
                    current ? { ...current, transitionDurationMs: Number(event.target.value) } : current,
                  )
                }
              />
            </label>
          </div>
          <label className="settings-option show-switch-intro-option">
            <span>
              <input
                type="checkbox"
                checked={showSwitchTarget.suppressProgramIntro}
                onChange={(event) =>
                  setShowSwitchTarget((current) =>
                    current ? { ...current, suppressProgramIntro: event.target.checked } : current,
                  )
                }
              />{' '}
              Direkt in die Zielsendung wechseln
            </span>
            <small>Deaktivieren, wenn vor der Zielsendung zusätzlich das reguläre Sender-Intro laufen soll.</small>
          </label>
          <p className="show-switch-safety-note">
            Die laufende Sendung wird kontrolliert gestoppt. Danach übernimmt der Broadcast-Runner die Zielsendung; der
            Auftrag bleibt auch bei einem Prozessneustart erhalten.
          </p>
          {modalError && <p className="settings-permission-note">{modalError}</p>}
          <div className="modal-actions">
            <button className="ghost-button" disabled={switchingShow} onClick={() => setModal(null)}>
              Abbrechen
            </button>
            <button
              className="primary-button"
              disabled={!allowedWrite || switchingShow}
              onClick={() => void executeShowSwitch(showSwitchTarget)}
            >
              <ArrowRightLeft size={17} /> {switchingShow ? 'Wechsel wird vorbereitet …' : 'Jetzt übernehmen'}
            </button>
          </div>
        </BroadcastModal>
      )}
      {modal === 'create' && (
        <BroadcastModal
          title="Neue Sendung erstellen"
          icon={Clapperboard}
          onClose={() => !creatingPlaylist && setModal(null)}
        >
          {DraftFields()}
          {ContentPicker()}
          {modalError && <p className="settings-permission-note">{modalError}</p>}
          <div className="modal-actions">
            <button className="ghost-button" disabled={creatingPlaylist} onClick={() => setModal(null)}>
              Abbrechen
            </button>
            <button
              className="primary-button"
              type="button"
              aria-busy={creatingPlaylist}
              disabled={!allowedWrite || !draft.name.trim() || creatingPlaylist}
              onClick={() => void saveCreate()}
            >
              {creatingPlaylist ? <LoaderCircle className="spin" size={17} /> : <Save size={17} />}
              {creatingPlaylist ? 'Sendung wird erstellt …' : 'Sendung erstellen'}
            </button>
          </div>
        </BroadcastModal>
      )}
      {modal === 'ai-plan' && (
        <BroadcastModal
          title="KI-Sendeplan konfigurieren"
          icon={WandSparkles}
          onClose={() => !aiPlanning && setModal(null)}
        >
          {AiPlannerFields()}
          {modalError && <p className="settings-permission-note">{modalError}</p>}
          <div className="modal-actions">
            <button className="ghost-button" disabled={aiPlanning} onClick={() => setModal(null)}>
              Abbrechen
            </button>
            <button
              className="primary-button"
              disabled={!allowedWrite || aiPlanning || plannerCandidateCount === 0}
              onClick={() => void createAiPlan()}
            >
              <WandSparkles size={17} /> {aiPlanning ? 'Sendung wird geplant …' : 'Plan erstellen'}
            </button>
          </div>
        </BroadcastModal>
      )}
      {modal === 'format' && (
        <BroadcastModal
          title={editingFormat ? 'Sendeformat bearbeiten' : 'Neues Sendeformat'}
          icon={LayoutTemplate}
          onClose={() => setModal(null)}
        >
          {FormatFields()}
          {modalError && <p className="settings-permission-note">{modalError}</p>}
          <div className="modal-actions split-actions">
            {editingFormat && !editingFormat.is_system ? (
              <button className="danger" disabled={!allowedWrite} onClick={() => void archiveFormat(editingFormat)}>
                <Archive size={16} /> Archivieren
              </button>
            ) : (
              <span className="state-pill">
                {editingFormat?.is_system ? 'Mitgeliefertes Studioformat' : 'Eigenes Format'}
              </span>
            )}
            <span />
            {editingFormat && (
              <button
                className="ghost-button"
                disabled={!allowedWrite}
                onClick={() => void duplicateFormat(editingFormat)}
              >
                <Copy size={16} /> Duplizieren
              </button>
            )}
            <button className="ghost-button" onClick={() => setModal(null)}>
              Abbrechen
            </button>
            <button
              className="primary-button"
              disabled={!allowedWrite || formatDraft.name.trim().length < 2}
              onClick={() => void saveFormat()}
            >
              <Save size={17} /> Format speichern
            </button>
          </div>
        </BroadcastModal>
      )}
      {modal === 'edit' && editing && (
        <BroadcastModal title="Sendung bearbeiten" icon={Edit3} onClose={() => setModal(null)}>
          {DraftFields()}
          <section className="broadcast-modal-section">
            <div className="section-heading compact-heading">
              <div>
                <p className="eyebrow">Ablauf</p>
                <h4>Playlist editieren</h4>
              </div>
              <span className="state-pill">{editingItems.length} Beiträge</span>
            </div>
            <ol className="broadcast-list editable-rundown">
              {editingItems.map((item, index) => (
                <li key={item.id}>
                  <span className="list-index">{index + 1}</span>
                  <span>
                    <strong>{item.title}</strong>
                    <small>{itemSourceLine(item)}</small>
                  </span>
                  <span className="rundown-actions">
                    <button
                      className="ghost-button rundown-play-button"
                      title="Sendung ab diesem Beitrag in der Regie öffnen"
                      onClick={() =>
                        navigate(`/live?workspace=rundown&playlist=${editing.id}&item=${item.id}`)
                      }
                    >
                      <Radio size={15} /> In Regie öffnen
                    </button>
                    <button
                      className="ghost-button icon-button"
                      disabled={index === 0}
                      onClick={() => void moveItem(item.id, -1)}
                    >
                      <ChevronUp size={15} />
                    </button>
                    <button
                      className="ghost-button icon-button"
                      disabled={index === editingItems.length - 1}
                      onClick={() => void moveItem(item.id, 1)}
                    >
                      <ChevronDown size={15} />
                    </button>
                    <button className="ghost-button icon-button danger-text" onClick={() => void removeItem(item.id)}>
                      <Trash2 size={15} />
                    </button>
                  </span>
                </li>
              ))}
            </ol>
          </section>
          {ContentPicker()}
          {modalError && <p className="settings-permission-note">{modalError}</p>}
          <div className="modal-actions split-actions">
            <button
              className="danger"
              disabled={!allowedWrite || deletingPlaylistId === editing.id || status?.run?.playlist_id === editing.id}
              onClick={() => void deletePlaylist(editing.id, editing.name)}
            >
              <Trash2 size={17} /> Sendung löschen
            </button>
            <span />
            <button className="ghost-button" onClick={() => setModal(null)}>
              Schließen
            </button>
            <button
              className="primary-button"
              disabled={!allowedWrite || !draft.name.trim()}
              onClick={() => void saveEdit()}
            >
              <Save size={17} /> Änderungen speichern
            </button>
          </div>
        </BroadcastModal>
      )}
    </section>
  );
}
