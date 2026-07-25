import React, { useEffect, useMemo, useRef, useState } from 'react';
import {
  Activity,
  AlertTriangle,
  AudioLines,
  ArrowRightLeft,
  ArrowDown,
  ArrowUp,
  CheckCircle2,
  Clapperboard,
  Clock3,
  Copy,
  ExternalLink,
  Eye,
  EyeOff,
  Grid3X3,
  Image as ImageIcon,
  Layers3,
  LayoutDashboard,
  Maximize2,
  Mic,
  MicOff,
  MessageSquareText,
  ListChecks,
  ListVideo,
  Megaphone,
  MonitorPlay,
  Pause,
  PictureInPicture2,
  Play,
  RefreshCw,
  Radio,
  Search,
  Send,
  Settings,
  SkipForward,
  SlidersHorizontal,
  SplitSquareHorizontal,
  Square,
  Trash2,
  UserPlus,
  Users,
  Video,
  Volume2,
  VolumeX,
  Wand2,
  Wifi,
  X,
  Zap,
} from 'lucide-react';
import { useSearchParams } from 'react-router-dom';
import { api, can, isApiRateLimitError, type SessionUser } from '../api/client.js';
import {
  OnAirBar,
  productionStatusLabels,
  type SendebetriebPlaylist,
  type SendebetriebRundownItem,
  type SendebetriebStatus,
} from '../components/OnAirBar.js';
import { LiveRegieHeader, type LiveRegieWorkspace } from '../components/LiveRegieHeader.js';
import { LiveSignalFlow } from '../components/LiveSignalFlow.js';
import { LiveTelemetryStrip } from '../components/LiveTelemetryStrip.js';
import { SourceEditorialChat } from '../components/SourceEditorialChat.js';
import { SourceInvitationDialog } from '../components/SourceInvitationDialog.js';

type LiveLayout = 'fullscreen' | 'split' | 'grid' | 'pip' | 'reaction' | 'talk';
type LiveTransition = 'cut' | 'fade' | 'swipe' | 'slide' | 'luma_wipe';
type LiveSourceTransition = 'cut' | 'fade' | 'slide' | 'zoom' | 'wipe';
type LiveSourceLabelStyle = 'lower-third' | 'badge' | 'minimal';
type LiveSourceFilter = 'all' | 'ready' | 'obs' | 'youtube';
type LiveStingerKind = 'live-now' | 'breaking-news' | 'back-to-program';
type StingerAnimation = 'sweep' | 'zoom' | 'pulse' | 'glitch';
type LiveDialog =
  | 'stream'
  | 'mode'
  | 'program'
  | 'autopilot'
  | 'portal'
  | 'sources'
  | 'overlay'
  | 'chat'
  | 'reaction'
  | 'talk'
  | 'youtube-auth'
  | 'return-program'
  | 'show-switch'
  | 'director-cue'
  | 'diagnostics'
  | null;

type DirectorCueDraft = {
  cueType: 'text' | 'banner' | 'image' | 'video';
  title: string;
  message: string;
  mediaId: string;
  position: 'fullscreen' | 'top' | 'lower-third' | 'bottom-right';
  style: 'studio' | 'breaking' | 'info' | 'minimal';
  transition: 'fade' | 'slide' | 'zoom' | 'cut';
  durationSeconds: number;
};

type ShowSwitchDraft = {
  playlist: SendebetriebPlaylist;
  item?: SendebetriebRundownItem | null;
  transition: LiveTransition;
  durationMs: number;
};

const defaultDirectorCue: DirectorCueDraft = {
  cueType: 'banner',
  title: 'Aktuelle Information',
  message: '',
  mediaId: '',
  position: 'lower-third',
  style: 'studio',
  transition: 'slide',
  durationSeconds: 10,
};

type LiveStingerProfile = {
  enabled: boolean;
  durationMs: number;
  kicker: string;
  title: string;
  subtitle: string;
  accentColor: string;
  animation: StingerAnimation;
  soundEnabled: boolean;
  volume: number;
};

type LiveSource = {
  id: string;
  name: string;
  user: string | null;
  status: 'live' | 'connecting' | 'offline' | 'error';
  resolution: string | null;
  audioLevel: number | null;
  network: 'good' | 'unstable' | 'poor' | 'offline' | null;
  previewUrl: string | null;
  updatedAt: string | null;
  communication?: {
    control: {
      tally: 'offline' | 'standby' | 'preview' | 'program';
      muted: boolean;
      directorName: string | null;
      instruction: string | null;
      updatedAt: string | null;
    };
    unread: { streamer: number; editorial: number };
    lastMessageAt: string | null;
  } | null;
  sourceType?: 'portal' | 'youtube';
  youtubeReady?: boolean;
  youtubeAuthPreparing?: boolean;
  youtubePlaybackMode?: string | null;
  youtubePlaybackError?: string | null;
  youtubePlaybackResolvedAt?: string | null;
  obs: null | {
    inputName: string;
    viewerUrl: string | null;
    muted: boolean;
    hidden: boolean;
    index: number;
    inProgram: boolean;
  };
};

type LiveOverlayOption = {
  id: string;
  name: string;
  publishedVersion: number | null;
  draftVersion: number | null;
  obsConfiguredUrl: string | null;
};

type YoutubeLibraryVideo = {
  id: string;
  title: string;
  url: string;
  video_id: string;
  channel_title: string;
  duration_seconds: number;
  enabled: boolean;
  thumbnail_url?: string | null;
  transcript_status: 'pending' | 'processing' | 'ready' | 'unavailable' | 'error';
  editorial_analysis_status: 'pending' | 'processing' | 'ready' | 'fallback' | 'error';
  category_name?: string | null;
};

type LiveTalkShow = {
  id: string;
  title: string;
  subtitle: string;
  topic: string;
  status: 'draft' | 'ready' | 'on_air' | 'ended' | 'archived' | 'error';
  layout: 'host-guest' | 'interview' | 'panel' | 'townhall';
  source_ids: string[];
  ava_enabled: boolean;
  mia_enabled: boolean;
  chat_enabled: boolean;
  advertising_enabled: boolean;
  advertising_interval_minutes: number;
  accent_color: string;
  planned_at: string | null;
};

type LiveTalkInvitation = {
  id: string;
  show_id: string;
  portal_invitation_id: string;
  display_name: string;
  invitation_url: string;
  status: 'open' | 'accepted' | 'expired' | 'revoked';
  source_id: string | null;
  expires_at: string;
};

type LiveTalkPortalSource = {
  id: string;
  name: string;
  user?: string | null;
  status: 'live' | 'connecting' | 'offline' | 'error';
  resolution?: string | null;
  audioLevel?: number | null;
  network?: 'good' | 'unstable' | 'poor' | 'offline' | null;
  previewUrl?: string | null;
  updatedAt?: string | null;
};

type LiveTalkDashboard = {
  shows: LiveTalkShow[];
  invitations: LiveTalkInvitation[];
  sources: LiveTalkPortalSource[];
  portal: { configured: boolean; baseUrl: string; error?: string | null };
  advertising: {
    campaigns: Array<{ id: string; name: string; status: string }>;
    creatives: Array<{ id: string; name: string; type: string; duration_seconds?: number | null }>;
    active: unknown;
  };
  serverTime: string;
};

type LiveTalkDraft = {
  id: string | null;
  title: string;
  subtitle: string;
  topic: string;
  layout: LiveTalkShow['layout'];
  sourceIds: string[];
  avaEnabled: boolean;
  miaEnabled: boolean;
  chatEnabled: boolean;
  advertisingEnabled: boolean;
  advertisingIntervalMinutes: number;
  accentColor: string;
  plannedAt: string | null;
};

const defaultLiveTalkDraft: LiveTalkDraft = {
  id: null,
  title: 'AVA Live Talk',
  subtitle: 'Menschen, Perspektiven und Publikumsfragen live im Studio',
  topic: '',
  layout: 'host-guest',
  sourceIds: [],
  avaEnabled: true,
  miaEnabled: true,
  chatEnabled: true,
  advertisingEnabled: true,
  advertisingIntervalMinutes: 20,
  accentColor: '#22d3ee',
  plannedAt: null,
};

type LiveStatus = {
  sceneName: string;
  settings: {
    enabled: boolean;
    layout: LiveLayout;
    transition: LiveTransition;
    transition_duration_ms: number;
    program_source_id: string | null;
    preview_source_id: string | null;
    overlay_project_id: string | null;
    chat_url: string | null;
    chat_visible: boolean;
    overlay_visible: boolean;
    source_transition: LiveSourceTransition;
    source_transition_duration_ms: number;
    source_auto_layout: boolean;
    source_overlay_enabled: boolean;
    source_label_style: LiveSourceLabelStyle;
    stinger_settings: Record<LiveStingerKind, LiveStingerProfile>;
    reaction_enabled: boolean;
    reaction_previous_layout: Exclude<LiveLayout, 'reaction'>;
    reaction_youtube_source_id: string | null;
    reaction_camera_source_ids: string[];
    reaction_position: 'left' | 'right' | 'top' | 'bottom';
    reaction_size_percent: number;
    reaction_gap: number;
    reaction_style: 'neon' | 'news' | 'glass' | 'clean';
    reaction_animation: 'fade' | 'slide' | 'pop' | 'pulse';
    reaction_title: string;
    reaction_accent_color: string;
    reaction_mode: 'camera' | 'ava';
    reaction_youtube_library_id: string | null;
    reaction_ava_intensity: 'calm' | 'balanced' | 'intensive';
    reaction_chat_enabled: boolean;
    production_mode: 'studio' | 'reaction' | 'talk';
    talk_show_id: string | null;
    talk_title: string;
    talk_subtitle: string;
    talk_accent_color: string;
    talk_ava_visible: boolean;
    talk_chat_enabled: boolean;
    updated_at: string;
  };
  currentScene?: { currentProgramSceneName?: string } | null;
  portal: { configured: boolean; baseUrl: string; tokenConfigured: boolean; error: string | null };
  overlays: LiveOverlayOption[];
  chat: { url: string | null; visible: boolean };
  autopilot: null | { enabled: boolean; requireStream?: boolean; requireVideo?: boolean; showItemCount?: number };
  playback: null | { status: string; articleId?: string; scene?: string; error?: string };
  sources: LiveSource[];
  obs: { status: string; lastError?: string | null };
  stream: null | { outputActive: boolean; outputReconnecting?: boolean; outputCongestion?: number };
  serverTime: string;
};

const layoutOptions: Array<{ id: LiveLayout; label: string; icon: React.ElementType }> = [
  { id: 'fullscreen', label: 'Vollbild', icon: Maximize2 },
  { id: 'split', label: 'Split', icon: SplitSquareHorizontal },
  { id: 'grid', label: 'Raster', icon: Grid3X3 },
  { id: 'pip', label: 'PiP', icon: PictureInPicture2 },
];

const transitionOptions: Array<{ id: LiveTransition; label: string }> = [
  { id: 'fade', label: 'Fade' },
  { id: 'cut', label: 'Cut' },
  { id: 'swipe', label: 'Swipe' },
  { id: 'slide', label: 'Slide' },
  { id: 'luma_wipe', label: 'Luma Wipe' },
];

const sourceTransitionOptions: Array<{ id: LiveSourceTransition; label: string; description: string }> = [
  { id: 'fade', label: 'Weich blenden', description: 'Dezente Überblendung für Gespräche.' },
  { id: 'slide', label: 'Seitlich fahren', description: 'Dynamischer Wechsel aus der Regie.' },
  { id: 'zoom', label: 'Zoom', description: 'Prägnanter Fokus auf die neue Quelle.' },
  { id: 'wipe', label: 'Wipe', description: 'Grafische Fläche verdeckt den Umbau.' },
  { id: 'cut', label: 'Harter Schnitt', description: 'Sofortiger Wechsel ohne Animation.' },
];

const stingerLabels: Record<LiveStingerKind, string> = {
  'live-now': 'Live-Intro',
  'breaking-news': 'Breaking-News-Teaser',
  'back-to-program': 'Programm-Outro',
};

const fallbackStingers: Record<LiveStingerKind, LiveStingerProfile> = {
  'live-now': {
    enabled: true,
    durationMs: 3200,
    kicker: 'LIVE',
    title: 'LIVE SENDUNG JETZT',
    subtitle: 'Wir schalten direkt ins Studio.',
    accentColor: '#d20a2e',
    animation: 'sweep',
    soundEnabled: true,
    volume: 65,
  },
  'breaking-news': {
    enabled: true,
    durationMs: 3000,
    kicker: 'BREAKING NEWS',
    title: 'EILMELDUNG',
    subtitle: 'Aktuelle Entwicklung live.',
    accentColor: '#ffbf00',
    animation: 'glitch',
    soundEnabled: true,
    volume: 72,
  },
  'back-to-program': {
    enabled: true,
    durationMs: 2600,
    kicker: 'PROGRAMM',
    title: 'ZURÜCK ZUR SENDUNG',
    subtitle: 'Der Autopilot übernimmt wieder.',
    accentColor: '#16a34a',
    animation: 'zoom',
    soundEnabled: true,
    volume: 58,
  },
};

function numberValue(value: string, fallback: number) {
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : fallback;
}

function durationLabel(milliseconds: number | null | undefined) {
  if (milliseconds == null || !Number.isFinite(milliseconds)) return '--:--';
  const seconds = Math.max(0, Math.round(milliseconds / 1000));
  const minutes = Math.floor(seconds / 60);
  return `${String(minutes).padStart(2, '0')}:${String(seconds % 60).padStart(2, '0')}`;
}

function scheduledLabel(value: string | null | undefined) {
  if (!value) return 'ohne feste Startzeit';
  const date = new Date(value);
  return Number.isNaN(date.getTime())
    ? value
    : date.toLocaleString('de-DE', { dateStyle: 'short', timeStyle: 'short' });
}

function stringArray(value: unknown): string[] {
  return Array.isArray(value) ? value.filter((item): item is string => typeof item === 'string') : [];
}

function statusLabel(source: LiveSource) {
  if (source.status === 'live') return 'Live';
  if (source.status === 'connecting') return 'Verbindet';
  if (source.status === 'error') return 'Fehler';
  return 'Offline';
}

function monitorTile(source: LiveSource | null, fallback: string) {
  if (!source) {
    return (
      <div className="live-empty">
        <Video size={34} />
        <span>{fallback}</span>
      </div>
    );
  }
  return (
    <div className="live-tile live-monitor-tile">
      {source.previewUrl ? <img src={source.previewUrl} alt="" /> : <Video size={32} />}
      <span>{source.name}</span>
    </div>
  );
}

export function LivePage({ user }: { user: SessionUser }) {
  const [searchParams] = useSearchParams();
  const [status, setStatus] = useState<LiveStatus | null>(null);
  const [operations, setOperations] = useState<SendebetriebStatus | null>(null);
  const [message, setMessage] = useState('');
  const [error, setError] = useState('');
  const [busy, setBusy] = useState('');
  const [selectedOverlayId, setSelectedOverlayId] = useState('');
  const [chatUrl, setChatUrl] = useState('');
  const [transition, setTransition] = useState<LiveTransition>('fade');
  const [durationMs, setDurationMs] = useState(450);
  const [sourceTransition, setSourceTransition] = useState<LiveSourceTransition>('fade');
  const [sourceDurationMs, setSourceDurationMs] = useState(650);
  const [sourceAutoLayout, setSourceAutoLayout] = useState(true);
  const [sourceOverlayEnabled, setSourceOverlayEnabled] = useState(true);
  const [sourceLabelStyle, setSourceLabelStyle] = useState<LiveSourceLabelStyle>('lower-third');
  const [activeDialog, setActiveDialog] = useState<LiveDialog>(null);
  const [stingerKind, setStingerKind] = useState<LiveStingerKind | null>(null);
  const [stingerDraft, setStingerDraft] = useState<LiveStingerProfile | null>(null);
  const [youtubeDialog, setYoutubeDialog] = useState(false);
  const [youtubeUrl, setYoutubeUrl] = useState('');
  const [youtubeName, setYoutubeName] = useState('');
  const [youtubeAuthSourceId, setYoutubeAuthSourceId] = useState('');
  const [reactionYoutubeSourceId, setReactionYoutubeSourceId] = useState('');
  const [reactionMode, setReactionMode] = useState<'camera' | 'ava'>('camera');
  const [reactionYoutubeLibraryId, setReactionYoutubeLibraryId] = useState('');
  const [reactionYoutubeLibrary, setReactionYoutubeLibrary] = useState<YoutubeLibraryVideo[]>([]);
  const [reactionVideoSearch, setReactionVideoSearch] = useState('');
  const [reactionAvaIntensity, setReactionAvaIntensity] = useState<'calm' | 'balanced' | 'intensive'>(
    'balanced',
  );
  const [reactionChatEnabled, setReactionChatEnabled] = useState(true);
  const [reactionCameraSourceIds, setReactionCameraSourceIds] = useState<string[]>([]);
  const [reactionPosition, setReactionPosition] = useState<'left' | 'right' | 'top' | 'bottom'>('right');
  const [reactionSizePercent, setReactionSizePercent] = useState(28);
  const [reactionGap, setReactionGap] = useState(24);
  const [reactionStyle, setReactionStyle] = useState<'neon' | 'news' | 'glass' | 'clean'>('neon');
  const [reactionAnimation, setReactionAnimation] = useState<'fade' | 'slide' | 'pop' | 'pulse'>('slide');
  const [reactionTitle, setReactionTitle] = useState('LIVE REACTION');
  const [reactionAccentColor, setReactionAccentColor] = useState('#d20a2e');
  const [liveTalk, setLiveTalk] = useState<LiveTalkDashboard | null>(null);
  const [liveTalkDraft, setLiveTalkDraft] = useState<LiveTalkDraft>(defaultLiveTalkDraft);
  const [liveTalkGuestName, setLiveTalkGuestName] = useState('');
  const [liveTalkCuePresenter, setLiveTalkCuePresenter] = useState<'ava' | 'mia'>('ava');
  const [liveTalkCueHeadline, setLiveTalkCueHeadline] = useState('Einordnung aus dem Studio');
  const [liveTalkCueText, setLiveTalkCueText] = useState('');
  const [liveTalkAdCreativeId, setLiveTalkAdCreativeId] = useState('');
  const [previewShow, setPreviewShow] = useState<SendebetriebPlaylist | null>(null);
  const [previewShowItems, setPreviewShowItems] = useState<SendebetriebRundownItem[]>([]);
  const [previewShowItemId, setPreviewShowItemId] = useState('');
  const [showSwitchDraft, setShowSwitchDraft] = useState<ShowSwitchDraft | null>(null);
  const [returnStrategy, setReturnStrategy] = useState<'resume-position' | 'next-item' | 'next-show' | 'standby'>(
    'resume-position',
  );
  const [directorCues, setDirectorCues] = useState<{ active: any; history: any[]; media: any[] }>({
    active: null,
    history: [],
    media: [],
  });
  const [directorCue, setDirectorCue] = useState<DirectorCueDraft>(defaultDirectorCue);
  const [activationKind, setActivationKind] = useState<'live-now' | 'breaking-news'>('live-now');
  const [workspace, setWorkspace] = useState<LiveRegieWorkspace>('program');
  const [sourceFilter, setSourceFilter] = useState<LiveSourceFilter>('all');
  const [sourceSearch, setSourceSearch] = useState('');
  const [communicationSourceId, setCommunicationSourceId] = useState('');
  const [invitationDialogOpen, setInvitationDialogOpen] = useState(false);
  const programMonitorRef = useRef<HTMLDivElement>(null);
  const backoffUntil = useRef(0);
  const loadInFlight = useRef(false);
  const allowed = can(user, 'obs:write');
  const allowedBroadcast = can(user, 'broadcast:write');

  async function loadLiveTalk() {
    try {
      const dashboard = await api<LiveTalkDashboard>('/api/live/talk-shows');
      setLiveTalk(dashboard);
      setLiveTalkAdCreativeId((current) => current || dashboard.advertising.creatives[0]?.id || '');
      const currentId = liveTalkDraft.id ?? status?.settings.talk_show_id;
      const selected = dashboard.shows.find((show) => show.id === currentId);
      if (selected) {
        setLiveTalkDraft({
          id: selected.id,
          title: selected.title,
          subtitle: selected.subtitle,
          topic: selected.topic,
          layout: selected.layout,
          sourceIds: selected.source_ids ?? [],
          avaEnabled: selected.ava_enabled,
          miaEnabled: selected.mia_enabled,
          chatEnabled: selected.chat_enabled,
          advertisingEnabled: selected.advertising_enabled,
          advertisingIntervalMinutes: selected.advertising_interval_minutes,
          accentColor: selected.accent_color,
          plannedAt: selected.planned_at,
        });
      }
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
    }
  }

  function selectLiveTalkShow(show: LiveTalkShow) {
    setLiveTalkDraft({
      id: show.id,
      title: show.title,
      subtitle: show.subtitle,
      topic: show.topic,
      layout: show.layout,
      sourceIds: show.source_ids ?? [],
      avaEnabled: show.ava_enabled,
      miaEnabled: show.mia_enabled,
      chatEnabled: show.chat_enabled,
      advertisingEnabled: show.advertising_enabled,
      advertisingIntervalMinutes: show.advertising_interval_minutes,
      accentColor: show.accent_color,
      plannedAt: show.planned_at,
    });
  }

  function liveTalkPayload() {
    return {
      title: liveTalkDraft.title,
      subtitle: liveTalkDraft.subtitle,
      topic: liveTalkDraft.topic,
      layout: liveTalkDraft.layout,
      sourceIds: liveTalkDraft.sourceIds,
      avaEnabled: liveTalkDraft.avaEnabled,
      miaEnabled: liveTalkDraft.miaEnabled,
      chatEnabled: liveTalkDraft.chatEnabled,
      advertisingEnabled: liveTalkDraft.advertisingEnabled,
      advertisingIntervalMinutes: liveTalkDraft.advertisingIntervalMinutes,
      accentColor: liveTalkDraft.accentColor,
      plannedAt: liveTalkDraft.plannedAt,
    };
  }

  async function saveLiveTalk() {
    setBusy('live-talk-save');
    setError('');
    try {
      const show = liveTalkDraft.id
        ? await api<LiveTalkShow>(`/api/live/talk-shows/${liveTalkDraft.id}`, {
            method: 'PATCH',
            body: JSON.stringify(liveTalkPayload()),
          })
        : await api<LiveTalkShow>('/api/live/talk-shows', {
            method: 'POST',
            body: JSON.stringify(liveTalkPayload()),
          });
      setLiveTalkDraft((current) => ({ ...current, id: show.id }));
      setMessage(liveTalkDraft.id ? 'Live-Talk gespeichert.' : 'Live-Talk angelegt und für die Regie vorbereitet.');
      await loadLiveTalk();
      return show;
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
      return null;
    } finally {
      setBusy('');
    }
  }

  async function ensureLiveTalkSaved() {
    if (liveTalkDraft.id) {
      const saved = await saveLiveTalk();
      return saved?.id ?? null;
    }
    return (await saveLiveTalk())?.id ?? null;
  }

  function toggleLiveTalkSource(sourceId: string) {
    setLiveTalkDraft((current) => ({
      ...current,
      sourceIds: current.sourceIds.includes(sourceId)
        ? current.sourceIds.filter((id) => id !== sourceId)
        : [...current.sourceIds, sourceId].slice(0, 8),
    }));
  }

  async function load() {
    if (!allowed || loadInFlight.current || Date.now() < backoffUntil.current) return;
    loadInFlight.current = true;
    try {
      const [next, nextOperations, nextDirectorCues] = await Promise.all([
        api<LiveStatus>('/api/live/status'),
        api<SendebetriebStatus>('/api/sendebetrieb/status'),
        api<{ active: any; history: any[]; media: any[] }>('/api/broadcast/director-cues?limit=8'),
      ]);
      setStatus(next);
      setOperations(nextOperations);
      setDirectorCues(nextDirectorCues);
      setError('');
      backoffUntil.current = 0;
    } catch (err) {
      if (isApiRateLimitError(err)) {
        backoffUntil.current = Date.now() + 30_000;
        setError('Live-Status wurde kurz pausiert, weil zu viele Abfragen gleichzeitig liefen.');
        return;
      }
      setError(err instanceof Error ? err.message : String(err));
    } finally {
      loadInFlight.current = false;
    }
  }

  async function run(action: string, request: () => Promise<unknown>, success: string) {
    setBusy(action);
    setError('');
    setMessage('');
    try {
      await request();
      setMessage(success);
      await load();
      return true;
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
      return false;
    } finally {
      setBusy('');
    }
  }

  function transport(action: 'pause' | 'resume' | 'skip' | 'stop') {
    void run(
      `transport-${action}`,
      () =>
        api('/api/broadcast/control', {
          method: 'POST',
          body: JSON.stringify({ action, idempotencyKey: `live-regie-${action}-${Date.now()}` }),
        }),
      {
        pause: 'Sendung pausiert.',
        resume: 'Sendung fortgesetzt.',
        skip: 'Nächster Rundown-Punkt wird übernommen.',
        stop: 'Sendung wird kontrolliert gestoppt.',
      }[action],
    );
  }

  function openShowSwitch(playlist: SendebetriebPlaylist, item?: SendebetriebRundownItem | null) {
    if (operations?.live.interruption) {
      setError('Beende zuerst die Live-Unterbrechung und wähle dort die gewünschte Rückkehr.');
      return;
    }
    setShowSwitchDraft({ playlist, item: item ?? null, transition, durationMs });
    setActiveDialog('show-switch');
  }

  function executeShowSwitch() {
    if (!showSwitchDraft) return;
    void run(
      `show-switch-${showSwitchDraft.playlist.id}`,
      () =>
        api(`/api/broadcast/playlists/${showSwitchDraft.playlist.id}/take`, {
          method: 'POST',
          body: JSON.stringify({
            itemId: showSwitchDraft.item?.id ?? null,
            transition: showSwitchDraft.transition,
            transitionDurationMs: showSwitchDraft.durationMs,
            suppressProgramIntro: true,
            idempotencyKey: `live-regie-${Date.now()}`,
          }),
        }),
      `„${showSwitchDraft.playlist.name}“ wird kontrolliert ins Programm übernommen.`,
    ).then((saved) => {
      if (!saved) return;
      setPreviewShow(null);
      setShowSwitchDraft(null);
      setActiveDialog(null);
    });
  }

  function returnToProgram() {
    const strategy = returnStrategy;
    void run(
      `return-${strategy}`,
      () =>
        api('/api/live/return-to-program', {
          method: 'POST',
          body: JSON.stringify({
            enableAutopilot: strategy !== 'standby',
            target: strategy === 'standby' ? 'maintenance' : 'main-news',
            strategy,
            transition,
            stinger: 'back-to-program',
          }),
        }),
      {
        'resume-position': 'Das unterbrochene Programm wird an der gespeicherten Position fortgesetzt.',
        'next-item': 'Das Programm setzt mit dem nächsten Beitrag fort.',
        'next-show': 'Die nächste geplante Sendung wird übernommen.',
        standby: 'Die Regie bleibt in Bereitschaft.',
      }[strategy],
    ).then((saved) => {
      if (saved) setActiveDialog(null);
    });
  }

  function sendDirectorCue() {
    void run(
      'director-cue',
      () =>
        api('/api/broadcast/director-cues', {
          method: 'POST',
          body: JSON.stringify({ ...directorCue, mediaId: directorCue.mediaId || null }),
        }),
      `Soforteinblendung läuft für ${directorCue.durationSeconds} Sekunden.`,
    ).then((saved) => {
      if (saved) setActiveDialog(null);
    });
  }

  function hideDirectorCue() {
    if (!directorCues.active?.id) return;
    void run(
      'director-cue-hide',
      () => api(`/api/broadcast/director-cues/${directorCues.active.id}`, { method: 'DELETE' }),
      'Soforteinblendung wurde ausgeblendet.',
    );
  }

  function openStingerSettings(kind: LiveStingerKind) {
    const profile = status?.settings.stinger_settings?.[kind] ?? fallbackStingers[kind];
    setActiveDialog(null);
    setStingerKind(kind);
    setStingerDraft({ ...profile });
  }

  function saveStingerSettings(preview = false) {
    if (!stingerKind || !stingerDraft) return;
    const kind = stingerKind;
    const draft = stingerDraft;
    void run(
      `stinger-settings-${kind}`,
      async () => {
        await api('/api/live/settings', {
          method: 'PATCH',
          body: JSON.stringify({ stingers: { [kind]: draft } }),
        });
        if (preview && draft.enabled) {
          await api('/api/live/stinger', { method: 'POST', body: JSON.stringify({ kind }) });
        }
      },
      preview ? `${stingerLabels[kind]} gespeichert und in OBS getestet.` : `${stingerLabels[kind]} gespeichert.`,
    );
  }

  function saveSourceSettings() {
    void run(
      'source-settings',
      () =>
        api('/api/live/settings', {
          method: 'PATCH',
          body: JSON.stringify({
            sourceTransition,
            sourceTransitionDurationMs: sourceDurationMs,
            sourceAutoLayout,
            sourceOverlayEnabled,
            sourceLabelStyle,
          }),
        }),
      'Quellenwechsel und dynamisches Overlay gespeichert.',
    );
  }

  function addYoutubeSource() {
    if (!youtubeUrl.trim()) return;
    void run(
      'youtube-add',
      () =>
        api('/api/live/sources/youtube', {
          method: 'POST',
          body: JSON.stringify({ url: youtubeUrl.trim(), name: youtubeName.trim() || undefined }),
        }),
      'YouTube-Livestream in OBS hinzugefügt.',
    ).then((saved) => {
      if (!saved) return;
      setYoutubeDialog(false);
      setYoutubeUrl('');
      setYoutubeName('');
    });
  }

  function reactionPayload() {
    return {
      reactionMode,
      reactionYoutubeSourceId: reactionYoutubeSourceId || null,
      reactionYoutubeLibraryId: reactionMode === 'ava' ? reactionYoutubeLibraryId || null : null,
      reactionCameraSourceIds,
      reactionAvaIntensity,
      reactionChatEnabled,
      reactionPosition,
      reactionSizePercent,
      reactionGap,
      reactionStyle,
      reactionAnimation,
      reactionTitle,
      reactionAccentColor,
    };
  }

  function saveReactionSettings() {
    void run(
      'reaction-settings',
      () => api('/api/live/settings', { method: 'PATCH', body: JSON.stringify(reactionPayload()) }),
      'Reaction-Show-Design gespeichert.',
    );
  }

  function activateReaction() {
    void run(
      'reaction-activate',
      () =>
        api('/api/live/reaction/activate', {
          method: 'POST',
          body: JSON.stringify({
            mode: reactionMode,
            youtubeSourceId: reactionYoutubeSourceId || undefined,
            youtubeLibraryId: reactionMode === 'ava' ? reactionYoutubeLibraryId || undefined : undefined,
            cameraSourceIds: reactionCameraSourceIds,
            avaIntensity: reactionAvaIntensity,
            chatEnabled: reactionChatEnabled,
            position: reactionPosition,
            sizePercent: reactionSizePercent,
            gap: reactionGap,
            style: reactionStyle,
            animation: reactionAnimation,
            title: reactionTitle,
            accentColor: reactionAccentColor,
          }),
        }),
      'Reaction-Show ist im Programm.',
    );
  }

  function setYoutubeReady(sourceId: string, ready: boolean) {
    void run(
      `youtube-ready-${sourceId}`,
      () =>
        api(`/api/live/sources/${encodeURIComponent(sourceId)}/youtube-ready`, {
          method: 'POST',
          body: JSON.stringify({ ready }),
        }),
      ready
        ? 'YouTube-Quelle ist für Vorschau und Programm freigegeben.'
        : 'YouTube-Quelle wurde gesperrt und in OBS ausgeblendet.',
    ).then((saved) => {
      if (saved && ready) setActiveDialog(null);
    });
  }

  function prepareYoutubePlayback(sourceId: string) {
    void run(
      `youtube-prepare-${sourceId}`,
      () => api(`/api/live/sources/${encodeURIComponent(sourceId)}/youtube-prepare`, { method: 'POST' }),
      'Der lokale YouTube-Stream wurde aufgelöst und in OBS aktualisiert.',
    );
  }

  function toggleReactionCamera(sourceId: string) {
    setReactionCameraSourceIds((current) =>
      current.includes(sourceId) ? current.filter((id) => id !== sourceId) : [...current, sourceId],
    );
  }

  useEffect(() => {
    void load();
    const timer = window.setInterval(() => void load(), 2500);
    return () => window.clearInterval(timer);
  }, [allowed]);

  useEffect(() => {
    if (!status) return;
    setSelectedOverlayId(status.settings.overlay_project_id ?? status.overlays[0]?.id ?? '');
    setChatUrl(status.chat.url ?? '');
    setTransition(status.settings.transition);
    setDurationMs(status.settings.transition_duration_ms);
    setSourceTransition(status.settings.source_transition ?? 'fade');
    setSourceDurationMs(status.settings.source_transition_duration_ms ?? 650);
    setSourceAutoLayout(status.settings.source_auto_layout ?? true);
    setSourceOverlayEnabled(status.settings.source_overlay_enabled ?? true);
    setSourceLabelStyle(status.settings.source_label_style ?? 'lower-third');
    setReactionYoutubeSourceId(status.settings.reaction_youtube_source_id ?? '');
    setReactionMode(status.settings.reaction_mode ?? 'camera');
    setReactionYoutubeLibraryId(status.settings.reaction_youtube_library_id ?? '');
    setReactionAvaIntensity(status.settings.reaction_ava_intensity ?? 'balanced');
    setReactionChatEnabled(status.settings.reaction_chat_enabled ?? true);
    setReactionCameraSourceIds(stringArray(status.settings.reaction_camera_source_ids));
    setReactionPosition(status.settings.reaction_position ?? 'right');
    setReactionSizePercent(status.settings.reaction_size_percent ?? 28);
    setReactionGap(status.settings.reaction_gap ?? 24);
    setReactionStyle(status.settings.reaction_style ?? 'neon');
    setReactionAnimation(status.settings.reaction_animation ?? 'slide');
    setReactionTitle(status.settings.reaction_title ?? 'LIVE REACTION');
    setReactionAccentColor(status.settings.reaction_accent_color ?? '#d20a2e');
  }, [status?.settings.updated_at]);

  useEffect(() => {
    if (!status) return;
    const configuredYoutube = status.sources.find((source) => source.obs && source.sourceType === 'youtube');
    const configuredCameras = status.sources.filter((source) => source.obs && source.sourceType !== 'youtube');
    if (!status.settings.reaction_youtube_source_id && configuredYoutube)
      setReactionYoutubeSourceId(configuredYoutube.id);
    if (stringArray(status.settings.reaction_camera_source_ids).length === 0 && configuredCameras.length > 0) {
      setReactionCameraSourceIds(configuredCameras.map((source) => source.id));
    }
  }, [status?.settings.updated_at, status?.sources.length]);

  useEffect(() => {
    if (activeDialog !== 'reaction' || reactionYoutubeLibrary.length > 0) return;
    let cancelled = false;
    void api<{ videos: YoutubeLibraryVideo[] }>('/api/youtube-videos')
      .then((result) => {
        if (cancelled) return;
        const videos = (result.videos ?? []).filter((video) => video.enabled);
        setReactionYoutubeLibrary(videos);
        if (!reactionYoutubeLibraryId && videos[0]) setReactionYoutubeLibraryId(videos[0].id);
      })
      .catch((err) => {
        if (!cancelled) setError(err instanceof Error ? err.message : String(err));
      });
    return () => {
      cancelled = true;
    };
  }, [activeDialog, reactionYoutubeLibrary.length, reactionYoutubeLibraryId]);

  useEffect(() => {
    if (activeDialog !== 'talk') return;
    void loadLiveTalk();
  }, [activeDialog]);

  useEffect(() => {
    const playlistId = searchParams.get('playlist');
    if (!playlistId || !operations) return;
    const candidate = [operations.current.playlist, operations.next, ...operations.prepared].find(
      (playlist) => playlist?.id === playlistId,
    );
    if (candidate) setPreviewShow(candidate);
  }, [operations?.serverTime, searchParams]);

  useEffect(() => {
    if (!previewShow) {
      setPreviewShowItems([]);
      setPreviewShowItemId('');
      return;
    }
    let cancelled = false;
    void api<{ items: SendebetriebRundownItem[] }>(`/api/broadcast/playlists/${previewShow.id}`)
      .then((result) => {
        if (cancelled) return;
        setPreviewShowItems(result.items ?? []);
        const requestedItemId = searchParams.get('item');
        setPreviewShowItemId(
          requestedItemId && result.items.some((item) => item.id === requestedItemId) ? requestedItemId : '',
        );
      })
      .catch((err) => {
        if (!cancelled) setError(err instanceof Error ? err.message : String(err));
      });
    return () => {
      cancelled = true;
    };
  }, [previewShow?.id]);

  const sortedSources = useMemo(
    () => [...(status?.sources ?? [])].sort((a, b) => (a.obs?.index ?? 999) - (b.obs?.index ?? 999)),
    [status?.sources],
  );
  const visibleSources = sortedSources.filter((source) => source.obs && !source.obs.hidden);
  const youtubeSources = sortedSources.filter((source) => source.obs && source.sourceType === 'youtube');
  const youtubeAuthSource = youtubeSources.find((source) => source.id === youtubeAuthSourceId) ?? null;
  const communicationSource = sortedSources.find((source) => source.id === communicationSourceId) ?? null;
  const selectedReactionYoutube = youtubeSources.find((source) => source.id === reactionYoutubeSourceId) ?? null;
  const selectedReactionLibraryVideo =
    reactionYoutubeLibrary.find((video) => video.id === reactionYoutubeLibraryId) ?? null;
  const filteredReactionLibrary = reactionYoutubeLibrary.filter((video) => {
    const needle = reactionVideoSearch.trim().toLocaleLowerCase('de');
    return (
      !needle ||
      video.title.toLocaleLowerCase('de').includes(needle) ||
      video.channel_title.toLocaleLowerCase('de').includes(needle) ||
      (video.category_name ?? '').toLocaleLowerCase('de').includes(needle)
    );
  });
  const cameraSources = sortedSources.filter((source) => source.obs && source.sourceType !== 'youtube');
  const reactionSourceIds = [
    status?.settings.reaction_youtube_source_id,
    ...stringArray(status?.settings.reaction_camera_source_ids),
  ];
  const compositionSources =
    status?.settings.layout === 'reaction'
      ? reactionSourceIds
          .map((sourceId) => sortedSources.find((source) => source.id === sourceId && source.obs))
          .filter((source): source is LiveSource => Boolean(source))
      : visibleSources;
  const previewSource = sortedSources.find((source) => source.id === status?.settings.preview_source_id) ?? null;
  const currentProgramScene = status?.currentScene?.currentProgramSceneName ?? 'unbekannt';
  const liveModeOnAir =
    operations?.mode === 'live' ||
    operations?.mode === 'breaking' ||
    Boolean(status?.sceneName && currentProgramScene === status.sceneName);
  const liveTalkOnAir =
    liveModeOnAir && status?.settings.production_mode === 'talk' && Boolean(status.settings.talk_show_id);
  const activePortalSources = sortedSources.filter((source) => source.status === 'live').length;
  const obsSources = sortedSources.filter((source) => source.obs).length;
  const filteredSources = sortedSources.filter((source) => {
    const needle = sourceSearch.trim().toLocaleLowerCase('de');
    const matchesSearch =
      !needle ||
      source.name.toLocaleLowerCase('de').includes(needle) ||
      (source.user ?? '').toLocaleLowerCase('de').includes(needle);
    const matchesFilter =
      sourceFilter === 'all' ||
      (sourceFilter === 'ready' && source.status === 'live') ||
      (sourceFilter === 'obs' && Boolean(source.obs)) ||
      (sourceFilter === 'youtube' && source.sourceType === 'youtube');
    return matchesSearch && matchesFilter;
  });
  const liveAudioPercent = visibleSources.length
    ? Math.round(
        (visibleSources.reduce((total, source) => total + (source.obs?.muted ? 0 : source.audioLevel ?? 0), 0) /
          visibleSources.length) *
          100,
      )
    : 0;
  const streamCongestionPercent = Math.round((status?.stream?.outputCongestion ?? 0) * 100);
  const modeName =
    {
      autopilot: 'Autopilot',
      manual: 'Manuell',
      live: 'Live-Regie',
      breaking: 'Breaking News',
      standby: 'Bereitschaft',
    }[operations?.mode ?? 'standby'] ?? 'Bereitschaft';

  function navigateWorkspace(nextWorkspace: LiveRegieWorkspace) {
    setWorkspace(nextWorkspace);
    window.requestAnimationFrame(() => {
      document.getElementById(`live-workspace-${nextWorkspace}`)?.scrollIntoView({
        behavior: 'smooth',
        block: 'start',
      });
    });
  }

  function openProgramFullscreen() {
    const target = programMonitorRef.current;
    if (!target) return;
    void target.requestFullscreen?.().catch((fullscreenError) => {
      setError(fullscreenError instanceof Error ? fullscreenError.message : String(fullscreenError));
    });
  }

  if (!allowed) {
    return (
      <main className="page">
        <section className="panel">
          <h1>Live</h1>
          <p className="muted">Für die Live-Regie ist die OBS-Berechtigung erforderlich.</p>
        </section>
      </main>
    );
  }

  return (
    <main className="page live-page">
      <LiveRegieHeader
        workspace={workspace}
        currentTitle={operations?.current.playlist?.name ?? 'Kein Programm aktiv'}
        currentItem={operations?.current.item?.title ?? 'Bereitschaft'}
        nextTitle={operations?.next?.name ?? 'Noch nichts eingeplant'}
        progress={
          operations?.current.durationMs
            ? Math.min(100, Math.max(0, (operations.current.elapsedMs / operations.current.durationMs) * 100))
            : 0
        }
        timingLabel={`${durationLabel(operations?.current.elapsedMs)} / ${durationLabel(operations?.current.durationMs)}`}
        streamActive={Boolean(status?.stream?.outputActive)}
        obsConnected={Boolean(operations?.obs.connected)}
        busy={Boolean(busy)}
        onWorkspace={navigateWorkspace}
        onRefresh={() => void load()}
        onInterrupt={() => {
          setActivationKind('live-now');
          setActiveDialog('mode');
        }}
        onPreview={() =>
          run(
            'preview-scene',
            () => api('/api/live/preview', { method: 'POST' }),
            'Live-Szene ist in der Vorschau.',
          )
        }
        onTake={() =>
          run(
            'take',
            () => api('/api/live/take', { method: 'POST', body: JSON.stringify({ transition, durationMs }) }),
            'Vorschau ins Programm übernommen.',
          )
        }
        onCue={() => {
          setDirectorCue(defaultDirectorCue);
          setActiveDialog('director-cue');
        }}
      />

      <OnAirBar status={operations} active="control" />

      <LiveTelemetryStrip
        scene={currentProgramScene}
        sourceCount={visibleSources.length}
        audioPercent={liveAudioPercent}
        congestionPercent={streamCongestionPercent}
        warningCount={operations?.warnings.length ?? 0}
        streamActive={Boolean(status?.stream?.outputActive)}
        onProgram={() => setActiveDialog('program')}
        onSources={() => setActiveDialog('sources')}
        onStream={() => setActiveDialog('stream')}
        onDiagnostics={() => setActiveDialog('diagnostics')}
      />

      {(message || error || status?.portal.error) && (
        <div
          className={`status-message live-regie-notice ${error || status?.portal.error ? 'status-error' : 'status-ok'}`}
          role={error || status?.portal.error ? 'alert' : 'status'}
          aria-live="polite"
        >
          {error || status?.portal.error ? <Wifi size={17} /> : <CheckCircle2 size={17} />}
          <span>{error || status?.portal.error || message}</span>
          <button
            className="icon-button"
            onClick={() => {
              setError('');
              setMessage('');
            }}
            title="Hinweis schließen"
          >
            <X size={15} />
          </button>
        </div>
      )}

      {workspace === 'program' && (
        <>
          <LiveSignalFlow
            sourceCount={visibleSources.length}
            previewName={previewShow?.name ?? previewSource?.name ?? 'Nicht belegt'}
            programName={operations?.current.playlist?.name ?? 'Bereitschaft'}
            sceneName={currentProgramScene}
            modeName={modeName}
            obsConnected={Boolean(operations?.obs.connected)}
            streamActive={Boolean(status?.stream?.outputActive)}
            reconnecting={Boolean(status?.stream?.outputReconnecting)}
            autopilotEnabled={Boolean(status?.autopilot?.enabled)}
            overlayVisible={Boolean(status?.settings.overlay_visible)}
            chatVisible={Boolean(status?.chat.visible)}
            onSources={() => navigateWorkspace('sources')}
            onPreview={() => navigateWorkspace('program')}
            onProgram={() => setActiveDialog('program')}
            onStream={() => setActiveDialog('stream')}
            onAutopilot={() => setActiveDialog('autopilot')}
            onOverlay={() => setActiveDialog('overlay')}
            onChat={() => setActiveDialog('chat')}
          />

          <section className="live-mode-control">
        <header className="live-section-heading">
          <div>
            <p className="eyebrow">Sendungsmodi</p>
            <h2>Kontrolliert ins Programm wechseln</h2>
          </div>
          <span>Live-Eingriffe speichern die aktuelle Programmposition für die Rückkehr.</span>
        </header>
        <div className="live-director-actions">
        <div className="live-director-action-wrap">
          <button
            className="live-director-action live"
            disabled={Boolean(busy)}
            title="Autopilot kontrolliert pausieren und Live-Studio übernehmen"
            onClick={() => {
              setActivationKind('live-now');
              setActiveDialog('mode');
            }}
          >
            <Radio size={24} />
            <span>
              <strong>Live aktivieren</strong>
              <small>Autopilot pausieren, Live-Szene schalten, Intro mit Sound</small>
            </span>
          </button>
          <button
            className="live-action-settings"
            onClick={() => openStingerSettings('live-now')}
            title="Live-Intro einstellen"
          >
            <Settings size={17} />
          </button>
        </div>
        <div className="live-director-action-wrap">
          <button
            className="live-director-action breaking"
            disabled={Boolean(busy)}
            title="Breaking News mit Intro und gespeichertem Rückkehrpunkt übernehmen"
            onClick={() => {
              setActivationKind('breaking-news');
              setActiveDialog('mode');
            }}
          >
            <Wand2 size={24} />
            <span>
              <strong>Breaking News übernehmen</strong>
              <small>Programm kontrolliert unterbrechen und Breaking-Regie aktivieren</small>
            </span>
          </button>
          <button
            className="live-action-settings"
            onClick={() => openStingerSettings('breaking-news')}
            title="Teaser einstellen"
          >
            <Settings size={17} />
          </button>
        </div>
        <div className="live-director-action-wrap">
          <button
            className="live-director-action program"
            disabled={Boolean(busy)}
            title="Live-Eingriff beenden und kontrolliert zum geplanten Programm zurückkehren"
            onClick={() => setActiveDialog('return-program')}
          >
            <MonitorPlay size={24} />
            <span>
              <strong>Zum Programm zurück</strong>
              <small>Position, nächster Beitrag, nächste Sendung oder Bereitschaft wählen</small>
            </span>
          </button>
          <button
            className="live-action-settings"
            onClick={() => openStingerSettings('back-to-program')}
            title="Programm-Outro einstellen"
          >
            <Settings size={17} />
          </button>
        </div>
        <div className="live-director-action-wrap">
          <button
            className="live-director-action reaction"
            disabled={Boolean(busy)}
            title="Reaction Show mit AVA, YouTube oder Live-Kameras vorbereiten"
            onClick={() => setActiveDialog('reaction')}
          >
            <Clapperboard size={24} />
            <span>
              <strong>Reaction Show</strong>
              <small>AVA moderiert ein Mediathek-Video oder Kameras reagieren live</small>
            </span>
          </button>
          <button
            className="live-action-settings"
            onClick={() => setActiveDialog('reaction')}
            title="Reaction-Show gestalten"
          >
            <Settings size={17} />
          </button>
        </div>
        <div className="live-director-action-wrap">
          <button
            className="live-director-action talk"
            disabled={Boolean(busy)}
            title="AVA Live Talk mit Gästen aus dem Live-Portal öffnen"
            onClick={() => setActiveDialog('talk')}
          >
            <Users size={24} />
            <span>
              <strong>AVA Live Talk</strong>
              <small>Gäste einladen, Quellen prüfen und moderierte Talkshow starten</small>
            </span>
          </button>
          <button
            className="live-action-settings"
            onClick={() => setActiveDialog('talk')}
            title="AVA Live Talk einrichten"
          >
            <Settings size={17} />
          </button>
        </div>
        <div className="live-director-action-wrap">
          <button
            className="live-director-action neutral"
            disabled={Boolean(busy)}
            title="Live-Ausgabe kontrolliert in Bereitschaft versetzen"
            onClick={() => {
              setReturnStrategy('standby');
              setActiveDialog('return-program');
            }}
          >
            <Square size={24} />
            <span>
              <strong>Bereitschaft</strong>
              <small>Live sauber verlassen, Autopilot bleibt aus</small>
            </span>
          </button>
          <button
            className="live-action-settings"
            onClick={() => setActiveDialog('program')}
            title="Umschaltung einstellen"
          >
            <Settings size={17} />
          </button>
        </div>
        </div>
          </section>

          <section className="live-regie-grid live-workspace-section" id="live-workspace-program">
        <div className="live-monitor-card preview">
          <div className="panel-heading">
            <h2>Vorschau</h2>
            <span className="state-pill">{previewShow?.name ?? previewSource?.name ?? 'leer'}</span>
          </div>
          <div className="live-monitor-screen">
            {previewShow ? (
              <div className="show-preview-slate">
                <Clapperboard size={34} />
                <span>Regie-Vorschau</span>
                <strong>{previewShow.name}</strong>
                <small>
                  {previewShow.format_name ?? 'Individuelle Sendung'} ·{' '}
                  {previewShowItems.length || previewShow.item_count || 0} Beiträge
                </small>
              </div>
            ) : (
              monitorTile(previewSource, 'Keine Quelle oder Sendung in Vorschau')
            )}
          </div>
        </div>
        <div className="live-monitor-card program">
          <div className="panel-heading">
            <h2>Programm</h2>
            <div className="live-monitor-heading-actions">
              <span className={`state-pill ${status?.stream?.outputActive ? 'ok' : 'muted'}`}>
                {status?.stream?.outputActive ? 'Stream läuft' : 'Stream gestoppt'}
              </span>
              <button className="icon-button" onClick={openProgramFullscreen} title="Programmmonitor im Vollbild">
                <Maximize2 size={16} />
              </button>
            </div>
          </div>
          <div
            ref={programMonitorRef}
            className={`live-program-preview layout-${status?.settings.layout ?? 'grid'} reaction-${status?.settings.reaction_position ?? 'right'}`}
          >
            {compositionSources.length === 0 ? (
              operations?.current.playlist ? (
                <div className="show-preview-slate on-program">
                  <Radio size={34} />
                  <span>Programm</span>
                  <strong>{operations.current.playlist.name}</strong>
                  <small>{operations.current.item?.title ?? 'Sendung wird vorbereitet'}</small>
                </div>
              ) : (
                monitorTile(null, 'Kein Programm aktiv')
              )
            ) : (
              compositionSources.slice(0, status?.settings.layout === 'fullscreen' ? 1 : 9).map((source) => (
                <div className="live-tile" key={source.id}>
                  {source.previewUrl ? <img src={source.previewUrl} alt="" /> : <Video size={32} />}
                  <span>{source.name}</span>
                </div>
              ))
            )}
          </div>
        </div>
          </section>
        </>
      )}

      {workspace === 'rundown' && (
        <>
          <header className="live-workspace-titlebar" id="live-workspace-rundown">
            <span>
              <ListVideo size={19} />
            </span>
            <div>
              <p className="eyebrow">Sendungssteuerung</p>
              <h2>Rundown und nächste Sendungen</h2>
              <small>Beiträge anspielen, pausieren, überspringen oder eine vorbereitete Sendung übernehmen.</small>
            </div>
            <strong className={operations?.current.playback.status === 'playing' ? 'live' : ''}>
              {operations?.current.playback.status === 'playing' ? 'ON AIR' : modeName}
            </strong>
          </header>
          <section className="program-control-grid live-workspace-section">
        <article className="program-rundown-card">
          <div className="panel-heading">
            <div>
              <p className="eyebrow">Aktuelle Sendung</p>
              <h2>{operations?.current.playlist?.name ?? 'Kein Rundown aktiv'}</h2>
            </div>
            <span className={`state-pill ${operations?.current.playback.status === 'playing' ? 'live' : ''}`}>
              {operations?.current.playback.status ?? 'idle'}
            </span>
          </div>
          <div className="transport-console" aria-label="Sendung steuern">
            <button
              disabled={
                !allowedBroadcast || !['playing', 'preparing'].includes(operations?.current.playback.status ?? '')
              }
              onClick={() => transport('pause')}
            >
              <Pause size={17} /> Pause
            </button>
            <button
              className="primary-button"
              disabled={!allowedBroadcast || operations?.current.playback.status !== 'paused'}
              onClick={() => transport('resume')}
            >
              <Play size={17} /> Fortsetzen
            </button>
            <button
              disabled={
                !allowedBroadcast ||
                !['playing', 'paused', 'preparing'].includes(operations?.current.playback.status ?? '')
              }
              onClick={() => transport('skip')}
            >
              <SkipForward size={17} /> Überspringen
            </button>
            <button
              className="danger"
              disabled={
                !allowedBroadcast ||
                !['playing', 'paused', 'preparing'].includes(operations?.current.playback.status ?? '')
              }
              onClick={() => {
                if (window.confirm('Die laufende Sendung kontrolliert stoppen?')) transport('stop');
              }}
            >
              <Square size={17} /> Stoppen
            </button>
          </div>
          <ol className="control-rundown-list">
            {(operations?.current.rundown ?? []).map((item, index) => {
              const active = item.id === operations?.current.item?.id;
              return (
                <li className={active ? 'active' : ''} key={item.id}>
                  <span className="rundown-position">{index + 1}</span>
                  <span>
                    <strong>{item.title ?? `Beitrag ${index + 1}`}</strong>
                    <small>
                      {item.status} ·{' '}
                      {durationLabel(Number(item.audio_duration_seconds ?? item.duration_seconds ?? 0) * 1000)}
                    </small>
                  </span>
                  <span className={`state-pill ${active ? 'live' : ''}`}>{active ? 'ON AIR' : item.status}</span>
                  <button
                    disabled={
                      !allowedBroadcast ||
                      active ||
                      Boolean(operations?.activeShowSwitch) ||
                      Boolean(operations?.live.interruption) ||
                      !operations?.current.playlist
                    }
                    onClick={() => operations?.current.playlist && openShowSwitch(operations.current.playlist, item)}
                  >
                    <ArrowRightLeft size={14} /> Ab hier
                  </button>
                </li>
              );
            })}
            {!operations?.current.rundown.length && (
              <li className="empty-rundown">
                <ListVideo size={22} />
                <span>Der aktuelle Rundown erscheint hier, sobald eine Sendung läuft.</span>
              </li>
            )}
          </ol>
        </article>

        <aside className="control-next-column">
          <article className="control-next-card">
            <div className="panel-heading">
              <div>
                <p className="eyebrow">Als Nächstes</p>
                <h2>{operations?.next?.name ?? 'Noch nichts eingeplant'}</h2>
              </div>
              <span className="state-pill">{scheduledLabel(operations?.next?.scheduled_at)}</span>
            </div>
            {operations?.next && (
              <>
                <p>
                  {operations.next.format_name ?? 'Individuelle Sendung'} · {operations.next.item_count ?? 0} Beiträge
                </p>
                <div className="control-next-actions">
                  <button onClick={() => setPreviewShow(operations.next)}>
                    <Eye size={16} /> In Vorschau laden
                  </button>
                  <button
                    className="primary-button"
                    disabled={
                      !allowedBroadcast || Boolean(operations.activeShowSwitch) || Boolean(operations.live.interruption)
                    }
                    onClick={() => openShowSwitch(operations.next!)}
                  >
                    <Send size={16} /> Übernehmen
                  </button>
                </div>
              </>
            )}
          </article>
          <article className="prepared-shows-card">
            <div className="panel-heading">
              <div>
                <p className="eyebrow">Vorbereitete Sendungen</p>
                <h2>Regie-Ablage</h2>
              </div>
              <span className="state-pill">{operations?.prepared.length ?? 0}</span>
            </div>
            <div className="prepared-show-list">
              {(operations?.prepared ?? []).slice(0, 6).map((playlist) => (
                <button
                  className={previewShow?.id === playlist.id ? 'active' : ''}
                  key={playlist.id}
                  onClick={() => setPreviewShow(playlist)}
                >
                  <span>
                    <strong>{playlist.name}</strong>
                    <small>
                      {productionStatusLabels[playlist.production_status ?? 'scheduled'] ?? playlist.production_status}{' '}
                      · {scheduledLabel(playlist.scheduled_at)}
                    </small>
                  </span>
                  <Eye size={16} />
                </button>
              ))}
            </div>
            {previewShow && (
              <div className="preview-show-take">
                <span>
                  <small>In Regie-Vorschau</small>
                  <strong>{previewShow.name}</strong>
                </span>
                <select
                  value={previewShowItemId}
                  onChange={(event) => setPreviewShowItemId(event.target.value)}
                  aria-label="Startpunkt der vorbereiteten Sendung"
                >
                  <option value="">Am Anfang starten</option>
                  {previewShowItems.map((item, index) => (
                    <option value={item.id} key={item.id}>
                      {index + 1}. {item.title ?? 'Beitrag'}
                    </option>
                  ))}
                </select>
                <button
                  className="primary-button"
                  disabled={
                    !allowedBroadcast || Boolean(operations?.activeShowSwitch) || Boolean(operations?.live.interruption)
                  }
                  onClick={() =>
                    openShowSwitch(previewShow, previewShowItems.find((item) => item.id === previewShowItemId) ?? null)
                  }
                >
                  <Send size={16} /> Take
                </button>
              </div>
            )}
          </article>
          <article className="instant-cue-card">
            <div>
              <p className="eyebrow">Sofort ins Bild</p>
              <h2>Soforteinblendung</h2>
              <p>Hinweis, Breaking-Banner, Bild oder Clip über das laufende Programm legen.</p>
            </div>
            <button
              onClick={() => {
                setDirectorCue(defaultDirectorCue);
                setActiveDialog('director-cue');
              }}
            >
              <Megaphone size={17} /> Einblendung vorbereiten
            </button>
          </article>
        </aside>
          </section>
        </>
      )}

      {workspace === 'graphics' && (
        <>
          <header className="live-workspace-titlebar" id="live-workspace-graphics">
            <span>
              <Layers3 size={19} />
            </span>
            <div>
              <p className="eyebrow">Bildgestaltung</p>
              <h2>Grafik, Übergänge und Chat</h2>
              <small>Alles, was zusätzlich über das laufende Programmbild gelegt oder animiert wird.</small>
            </div>
            <button
              onClick={() => {
                setDirectorCue(defaultDirectorCue);
                setActiveDialog('director-cue');
              }}
            >
              <Megaphone size={16} /> Soforteinblendung
            </button>
          </header>
          {directorCues.active && (
            <section className="active-director-cue" role="status">
              <Megaphone size={18} />
              <span>
                <strong>{directorCues.active.title || directorCues.active.filename} ist on air</strong>
                <small>Automatische Ausblendung {scheduledLabel(directorCues.active.expires_at)}</small>
              </span>
              <button className="danger" disabled={Boolean(busy)} onClick={hideDirectorCue}>
                Jetzt ausblenden
              </button>
            </section>
          )}
          <section className="live-tools-grid live-workspace-section">
        <div className="live-tool-card">
          <div className="panel-heading">
            <h2>Übergang</h2>
            <button className="icon-button" onClick={() => setActiveDialog('program')} title="Übergänge einstellen">
              <Settings size={17} />
            </button>
          </div>
          <div className="live-form-row">
            <select value={transition} onChange={(event) => setTransition(event.target.value as LiveTransition)}>
              {transitionOptions.map((item) => (
                <option value={item.id} key={item.id}>
                  {item.label}
                </option>
              ))}
            </select>
            <input
              type="number"
              min={0}
              max={5000}
              step={50}
              value={durationMs}
              onChange={(event) => setDurationMs(Number(event.target.value))}
              aria-label="Übergangsdauer in Millisekunden"
            />
            <button
              disabled={Boolean(busy)}
              onClick={() =>
                run(
                  'transition',
                  () =>
                    api('/api/live/transition', { method: 'POST', body: JSON.stringify({ transition, durationMs }) }),
                  'Übergang gespeichert.',
                )
              }
            >
              Speichern
            </button>
          </div>
          <div className="live-layout-row">
            {layoutOptions.map(({ id, label, icon: Icon }) => (
              <button
                key={id}
                className={status?.settings.layout === id ? 'active' : ''}
                onClick={() =>
                  run(
                    `layout-${id}`,
                    () => api('/api/live/layout', { method: 'POST', body: JSON.stringify({ layout: id }) }),
                    `Layout ${label} angewendet.`,
                  )
                }
                disabled={Boolean(busy)}
                title={label}
              >
                <Icon size={16} /> {label}
              </button>
            ))}
          </div>
        </div>

        <div className="live-tool-card">
          <div className="panel-heading">
            <h2>Overlay live wechseln</h2>
            <button className="icon-button" onClick={() => setActiveDialog('overlay')} title="Overlay-Einstellungen">
              <Settings size={17} />
            </button>
          </div>
          <div className="live-form-row">
            <select value={selectedOverlayId} onChange={(event) => setSelectedOverlayId(event.target.value)}>
              <option value="">Kein Live-Studio-Overlay</option>
              {(status?.overlays ?? []).map((overlay) => (
                <option value={overlay.id} key={overlay.id}>
                  {overlay.name} · {overlay.publishedVersion ? `v${overlay.publishedVersion}` : 'Entwurf'}
                </option>
              ))}
            </select>
            <button
              className="primary-button"
              disabled={Boolean(busy) || !selectedOverlayId}
              onClick={() =>
                run(
                  'overlay',
                  () =>
                    api('/api/live/overlay/apply', {
                      method: 'POST',
                      body: JSON.stringify({ projectId: selectedOverlayId, transition, durationMs }),
                    }),
                  'Overlay live gewechselt.',
                )
              }
            >
              <Send size={16} /> Anwenden
            </button>
          </div>
          <div className="live-compact-actions">
            <button
              disabled={Boolean(busy)}
              onClick={() =>
                run(
                  'overlay-visibility',
                  () =>
                    api('/api/live/overlay/visibility', {
                      method: 'POST',
                      body: JSON.stringify({ visible: !status?.settings.overlay_visible }),
                    }),
                  status?.settings.overlay_visible ? 'Clean Feed aktiviert.' : 'Live-Overlay eingeblendet.',
                )
              }
            >
              {status?.settings.overlay_visible ? <EyeOff size={15} /> : <Eye size={15} />}
              {status?.settings.overlay_visible ? 'Clean Feed' : 'Overlay einblenden'}
            </button>
            <span className="muted">Quellenlabels: {sourceOverlayEnabled ? sourceLabelStyle : 'aus'}</span>
          </div>
          <p className="muted">
            Änderungen werden über das bestehende Overlay-System veröffentlicht und in OBS nachgeladen.
          </p>
        </div>

        <div className="live-tool-card">
          <div className="panel-heading">
            <h2>Chat</h2>
            <button className="icon-button" onClick={() => setActiveDialog('chat')} title="Chat-Einstellungen">
              <Settings size={17} />
            </button>
          </div>
          <div className="live-form-row">
            <input
              value={chatUrl}
              onChange={(event) => setChatUrl(event.target.value)}
              placeholder="Chat-Popout-/Embed-URL"
            />
            <button
              disabled={Boolean(busy)}
              onClick={() =>
                run(
                  'chat-save',
                  () =>
                    api('/api/live/chat', {
                      method: 'POST',
                      body: JSON.stringify({ url: chatUrl, visible: Boolean(chatUrl) }),
                    }),
                  'Chat in OBS aktualisiert.',
                )
              }
            >
              Speichern
            </button>
            <button
              disabled={Boolean(busy) || !status?.chat.url}
              onClick={() =>
                run(
                  'chat-toggle',
                  () =>
                    api('/api/live/chat', { method: 'POST', body: JSON.stringify({ visible: !status?.chat.visible }) }),
                  status?.chat.visible ? 'Chat ausgeblendet.' : 'Chat eingeblendet.',
                )
              }
            >
              {status?.chat.visible ? <EyeOff size={16} /> : <Eye size={16} />}
              {status?.chat.visible ? 'Ausblenden' : 'Einblenden'}
            </button>
          </div>
        </div>
          </section>
        </>
      )}

      {workspace === 'sources' && (
        <section className="live-source-workspace live-workspace-section" id="live-workspace-sources">
          <header className="live-source-workspace-head">
            <div>
              <p className="eyebrow">Eingangssignale</p>
              <h2>Quellen-Pool</h2>
              <p>
                Quelle prüfen, in die Vorschau laden und anschließend kontrolliert ins Programm übernehmen.
              </p>
            </div>
            <div className="live-heading-actions">
              <button onClick={() => setInvitationDialogOpen(true)} disabled={Boolean(busy)}>
                <UserPlus size={15} /> Gast einladen
              </button>
              <button onClick={() => setYoutubeDialog(true)} disabled={Boolean(busy)}>
                <Video size={16} /> YouTube hinzufügen
              </button>
              <button
                onClick={() =>
                  run(
                    'sources-sync',
                    () => api('/api/live/sources/sync', { method: 'POST' }),
                    'OBS-Quellen neu verbunden.',
                  )
                }
                disabled={Boolean(busy) || obsSources === 0}
              >
                <RefreshCw size={16} /> Synchronisieren
              </button>
              <button onClick={() => setActiveDialog('sources')}>
                <Settings size={16} /> Wechsel & Layout
              </button>
            </div>
          </header>

          <div className="live-source-commandbar">
            <div className="live-source-filters" aria-label="Quellen filtern">
              {[
                ['all', 'Alle', sortedSources.length],
                ['ready', 'Live', sortedSources.filter((source) => source.status === 'live').length],
                ['obs', 'In OBS', obsSources],
                ['youtube', 'YouTube', youtubeSources.length],
              ].map(([id, label, count]) => (
                <button
                  className={sourceFilter === id ? 'active' : ''}
                  key={String(id)}
                  onClick={() => setSourceFilter(id as LiveSourceFilter)}
                >
                  {id === 'all' ? (
                    <Grid3X3 size={14} />
                  ) : id === 'ready' ? (
                    <Radio size={14} />
                  ) : id === 'obs' ? (
                    <MonitorPlay size={14} />
                  ) : (
                    <Video size={14} />
                  )}
                  {label} <span>{count}</span>
                </button>
              ))}
            </div>
            <label className="live-source-search">
              <Search size={15} />
              <input
                value={sourceSearch}
                onChange={(event) => setSourceSearch(event.target.value)}
                placeholder="Quelle oder Benutzer suchen"
              />
              {sourceSearch && (
                <button onClick={() => setSourceSearch('')} aria-label="Suche leeren">
                  <X size={14} />
                </button>
              )}
            </label>
            <div className="live-source-global-audio">
              <button
                disabled={Boolean(busy) || obsSources === 0}
                onClick={() =>
                  run(
                    'mute-all',
                    () => api('/api/live/sources/audio', { method: 'POST', body: JSON.stringify({ muted: true }) }),
                    'Alle Live-Quellen stummgeschaltet.',
                  )
                }
              >
                <VolumeX size={15} /> Alle stumm
              </button>
              <button
                disabled={Boolean(busy) || obsSources === 0}
                onClick={() =>
                  run(
                    'unmute-all',
                    () => api('/api/live/sources/audio', { method: 'POST', body: JSON.stringify({ muted: false }) }),
                    'Audio aller Live-Quellen freigegeben.',
                  )
                }
              >
                <Volume2 size={15} /> Audio frei
              </button>
            </div>
          </div>

          <div className="live-source-flow-hint">
            <span>
              <Video size={14} /> Quelle wählen
            </span>
            <b>›</b>
            <span>
              <Eye size={14} /> Vorschau prüfen
            </span>
            <b>›</b>
            <span>
              <Send size={14} /> Take ins Programm
            </span>
            <em>
              {sourceAutoLayout ? 'Auto-Layout' : status?.settings.layout ?? 'Manuell'} · {sourceTransition}{' '}
              {sourceDurationMs} ms
            </em>
          </div>

          {filteredSources.length === 0 ? (
            <div className="live-source-empty">
              <Video size={34} />
              <strong>Keine passende Quelle</strong>
              <span>Filter ändern, Live-Portal prüfen oder eine YouTube-Quelle hinzufügen.</span>
            </div>
          ) : (
            <div className="live-source-pool">
              {filteredSources.map((source) => {
                const index = sortedSources.findIndex((candidate) => candidate.id === source.id);
                const isPreview = source.id === status?.settings.preview_source_id;
                const isProgram = Boolean(source.obs?.inProgram);
                return (
                  <article
                    className={`live-source-deck ${isProgram ? 'is-program' : ''} ${isPreview ? 'is-preview' : ''}`}
                    key={source.id}
                  >
                    <header>
                      <span className={`live-source-kind ${source.sourceType === 'youtube' ? 'youtube' : ''}`}>
                        {source.sourceType === 'youtube' ? <Video size={15} /> : <Wifi size={15} />}
                      </span>
                      <span>
                        <strong>{source.name}</strong>
                        <small>
                          {source.sourceType === 'youtube' ? 'YouTube' : source.user || 'Live-Portal'}
                        </small>
                      </span>
                      <em className={isProgram ? 'program' : isPreview ? 'preview' : source.status}>
                        {isProgram ? 'PROGRAMM' : isPreview ? 'VORSCHAU' : statusLabel(source).toUpperCase()}
                      </em>
                    </header>

                    <div className="live-source-deck-preview">
                      {source.previewUrl ? <img src={source.previewUrl} alt="" /> : <Video size={32} />}
                      <div>
                        <span>
                          <LayoutDashboard size={12} /> {source.resolution || 'Auflösung unbekannt'}
                        </span>
                        <span>
                          <Wifi size={12} /> {source.network || 'Netz unbekannt'}
                        </span>
                      </div>
                    </div>

                    <div className="live-source-signal">
                      <span className={source.obs?.muted ? 'muted' : ''}>
                        {source.obs?.muted ? <MicOff size={14} /> : <Mic size={14} />}
                        {source.obs?.muted ? 'Stumm' : `${Math.round((source.audioLevel ?? 0) * 100)}%`}
                      </span>
                      <i>
                        <b
                          style={{
                            width: `${source.obs?.muted ? 0 : Math.min(100, Math.max(0, (source.audioLevel ?? 0) * 100))}%`,
                          }}
                        />
                      </i>
                      <span>{source.obs ? `OBS · Slot ${source.obs.index + 1}` : 'Noch nicht in OBS'}</span>
                    </div>

                    {source.sourceType === 'youtube' && !source.youtubeReady && (
                      <button
                        className="live-source-readiness-warning"
                        onClick={() => {
                          setYoutubeAuthSourceId(source.id);
                          setActiveDialog('youtube-auth');
                        }}
                      >
                        <AlertTriangle size={15} />
                        <span>
                          <strong>Wiedergabe zuerst vorbereiten</strong>
                          <small>{source.youtubePlaybackError || 'Die Quelle bleibt bis zur Prüfung unsichtbar.'}</small>
                        </span>
                      </button>
                    )}

                    {source.sourceType !== 'youtube' && (
                      <button
                        className="source-chat-button"
                        onClick={() => setCommunicationSourceId(source.id)}
                      >
                        <MessageSquareText size={15} />
                        Regie-Chat
                        {(source.communication?.unread.editorial ?? 0) > 0 && (
                          <b>{source.communication?.unread.editorial}</b>
                        )}
                      </button>
                    )}

                    {source.obs ? (
                      <>
                        <div className="live-source-primary-actions">
                          <button
                            className={isPreview ? 'preview-active' : ''}
                            disabled={Boolean(busy)}
                            onClick={() =>
                              run(
                                `preview-${source.id}`,
                                () =>
                                  api(`/api/live/sources/${encodeURIComponent(source.id)}`, {
                                    method: 'PATCH',
                                    body: JSON.stringify({ preview: true }),
                                  }),
                                'Quelle in Vorschau markiert.',
                              )
                            }
                          >
                            <Eye size={16} /> {isPreview ? 'In Vorschau' : 'Vorschau'}
                          </button>
                          <button
                            className="primary-button"
                            disabled={Boolean(busy) || isProgram}
                            onClick={() =>
                              run(
                                `take-${source.id}`,
                                () =>
                                  api('/api/live/take', {
                                    method: 'POST',
                                    body: JSON.stringify({ sourceId: source.id, transition, durationMs }),
                                  }),
                                'Quelle ins Programm übernommen.',
                              )
                            }
                          >
                            <Send size={16} /> {isProgram ? 'On Air' : 'TAKE'}
                          </button>
                        </div>
                        <div className="live-source-utility-actions">
                          <button
                            disabled={index <= 0}
                            onClick={() =>
                              run(
                                `up-${source.id}`,
                                () =>
                                  api(`/api/live/sources/${encodeURIComponent(source.id)}`, {
                                    method: 'PATCH',
                                    body: JSON.stringify({ index: Math.max(0, (source.obs?.index ?? index) - 1) }),
                                  }),
                                'Quelle nach oben verschoben.',
                              )
                            }
                            title="In der Ebenenreihenfolge nach oben"
                          >
                            <ArrowUp size={15} />
                          </button>
                          <button
                            onClick={() =>
                              run(
                                `down-${source.id}`,
                                () =>
                                  api(`/api/live/sources/${encodeURIComponent(source.id)}`, {
                                    method: 'PATCH',
                                    body: JSON.stringify({ index: (source.obs?.index ?? index) + 1 }),
                                  }),
                                'Quelle nach unten verschoben.',
                              )
                            }
                            title="In der Ebenenreihenfolge nach unten"
                          >
                            <ArrowDown size={15} />
                          </button>
                          <button
                            onClick={() =>
                              run(
                                `mute-${source.id}`,
                                () =>
                                  api(`/api/live/sources/${encodeURIComponent(source.id)}`, {
                                    method: 'PATCH',
                                    body: JSON.stringify({ muted: !source.obs?.muted }),
                                  }),
                                source.obs?.muted ? 'Quelle hörbar.' : 'Quelle stummgeschaltet.',
                              )
                            }
                            title={source.obs.muted ? 'Ton einschalten' : 'Stummschalten'}
                          >
                            {source.obs.muted ? <MicOff size={15} /> : <Mic size={15} />}
                          </button>
                          <button
                            onClick={() =>
                              run(
                                `hide-${source.id}`,
                                () =>
                                  api(`/api/live/sources/${encodeURIComponent(source.id)}`, {
                                    method: 'PATCH',
                                    body: JSON.stringify({ hidden: !source.obs?.hidden }),
                                  }),
                                source.obs?.hidden ? 'Quelle eingeblendet.' : 'Quelle ausgeblendet.',
                              )
                            }
                            title={source.obs.hidden ? 'Einblenden' : 'Ausblenden'}
                          >
                            {source.obs.hidden ? <EyeOff size={15} /> : <Eye size={15} />}
                          </button>
                          {source.sourceType === 'youtube' && (
                            <button
                              onClick={() => {
                                setYoutubeAuthSourceId(source.id);
                                setActiveDialog('youtube-auth');
                              }}
                              title="YouTube-Wiedergabe prüfen"
                            >
                              <CheckCircle2 size={15} />
                            </button>
                          )}
                          <button
                            className="danger"
                            onClick={() =>
                              run(
                                `remove-${source.id}`,
                                () => api(`/api/live/sources/${encodeURIComponent(source.id)}`, { method: 'DELETE' }),
                                'Quelle aus OBS entfernt.',
                              )
                            }
                            title="Aus OBS entfernen"
                          >
                            <Trash2 size={15} />
                          </button>
                        </div>
                      </>
                    ) : (
                      <button
                        className="live-source-add primary-button"
                        disabled={source.status !== 'live' || Boolean(busy)}
                        onClick={() =>
                          run(
                            `add-${source.id}`,
                            () => api(`/api/live/sources/${encodeURIComponent(source.id)}/add`, { method: 'POST' }),
                            'Quelle in OBS hinzugefügt.',
                          )
                        }
                      >
                        <MonitorPlay size={16} /> In die Regie übernehmen
                      </button>
                    )}
                  </article>
                );
              })}
            </div>
          )}
        </section>
      )}

      {communicationSource && (
        <SourceEditorialChat
          source={communicationSource}
          user={user}
          onClose={() => setCommunicationSourceId('')}
          onUpdated={() => void load()}
        />
      )}

      {invitationDialogOpen && (
        <SourceInvitationDialog
          onClose={() => setInvitationDialogOpen(false)}
          onUpdated={() => void load()}
        />
      )}

      {activeDialog && (
        <div className="modal-backdrop" onMouseDown={() => setActiveDialog(null)}>
          <div
            className="modal-card live-settings-modal"
            role="dialog"
            aria-modal="true"
            onMouseDown={(event) => event.stopPropagation()}
          >
            <div className="modal-header">
              <div>
                <p className="eyebrow">Live-Regie · Details & Einstellungen</p>
                <h3>
                  <SlidersHorizontal size={19} />
                  {
                    {
                      stream: 'Stream-Ausgabe',
                      mode: 'Live-Modus',
                      program: 'Programm & Übergänge',
                      autopilot: 'Autopilot',
                      portal: 'Live-Portal',
                      sources: 'Quellen & Animationen',
                      reaction: 'Reaction Show',
                      talk: 'AVA Live Talk · Gäste & Studio',
                      'youtube-auth': 'Lokale YouTube-Wiedergabe',
                      overlay: 'Live-Overlay',
                      chat: 'Live-Chat',
                      'return-program': 'Kontrolliert zum Programm zurück',
                      'show-switch': 'Sendung übernehmen',
                      'director-cue': 'Soforteinblendung',
                      diagnostics: 'Live-Diagnose',
                    }[activeDialog]
                  }
                </h3>
              </div>
              <button className="icon-button" onClick={() => setActiveDialog(null)} aria-label="Dialog schließen">
                <X size={18} />
              </button>
            </div>

            {activeDialog === 'stream' && (
              <>
                <div className="live-dialog-metrics">
                  <div>
                    <Radio size={20} />
                    <span>Status</span>
                    <strong>{status?.stream?.outputActive ? 'ON AIR' : 'Gestoppt'}</strong>
                  </div>
                  <div>
                    <Activity size={20} />
                    <span>Verbindung</span>
                    <strong>{status?.stream?.outputReconnecting ? 'Reconnect' : 'Stabil'}</strong>
                  </div>
                  <div>
                    <Wifi size={20} />
                    <span>Auslastung</span>
                    <strong>{Math.round((status?.stream?.outputCongestion ?? 0) * 100)}%</strong>
                  </div>
                </div>
                <p className="muted">Start und Stop wirken direkt auf die konfigurierte OBS-Streaming-Ausgabe.</p>
                <div className="live-dialog-actions">
                  <button
                    className="primary-button"
                    disabled={Boolean(busy) || Boolean(status?.stream?.outputActive)}
                    onClick={() =>
                      run(
                        'stream-start-modal',
                        () => api('/api/live/stream/start', { method: 'POST' }),
                        'Stream gestartet.',
                      )
                    }
                  >
                    <Radio size={16} /> Stream starten
                  </button>
                  <button
                    disabled={Boolean(busy) || !status?.stream?.outputActive}
                    onClick={() =>
                      run(
                        'stream-stop-modal',
                        () => api('/api/live/stream/stop', { method: 'POST' }),
                        'Stream gestoppt.',
                      )
                    }
                  >
                    <Square size={16} /> Stream stoppen
                  </button>
                </div>
              </>
            )}

            {activeDialog === 'diagnostics' && (
              <>
                <div className="live-dialog-metrics live-diagnostics-metrics">
                  <div>
                    <MonitorPlay size={20} />
                    <span>OBS</span>
                    <strong>{operations?.obs.connected ? 'Verbunden' : 'Getrennt'}</strong>
                  </div>
                  <div>
                    <Radio size={20} />
                    <span>Stream</span>
                    <strong>{status?.stream?.outputActive ? 'ON AIR' : 'Gestoppt'}</strong>
                  </div>
                  <div>
                    <Video size={20} />
                    <span>Sichtbare Quellen</span>
                    <strong>{visibleSources.length}</strong>
                  </div>
                  <div>
                    <AudioLines size={20} />
                    <span>Mittlerer Audiopegel</span>
                    <strong>{liveAudioPercent}%</strong>
                  </div>
                  <div>
                    <Wifi size={20} />
                    <span>Netzwerklast</span>
                    <strong>{streamCongestionPercent}%</strong>
                  </div>
                  <div>
                    <Clock3 size={20} />
                    <span>Letzter Serverstatus</span>
                    <strong>{scheduledLabel(status?.serverTime)}</strong>
                  </div>
                </div>
                <div className="live-diagnostics-scene">
                  <span className={status?.stream?.outputActive ? 'live' : ''}>
                    <i /> {status?.stream?.outputActive ? 'PROGRAMM WIRD GESENDET' : 'STREAM NICHT AKTIV'}
                  </span>
                  <strong>{currentProgramScene}</strong>
                  <small>
                    {operations?.current.playlist?.name ?? 'Keine Sendung'} ·{' '}
                    {operations?.current.item?.title ?? 'Bereitschaft'}
                  </small>
                </div>
                <div className="live-diagnostics-warnings">
                  <div className="panel-heading">
                    <h4>
                      <AlertTriangle size={17} /> Aktive Hinweise
                    </h4>
                    <span className="state-pill">{operations?.warnings.length ?? 0}</span>
                  </div>
                  {(operations?.warnings ?? []).map((warning) => (
                    <div className={`live-diagnostic-warning ${warning.level}`} key={`${warning.code}-${warning.message}`}>
                      <AlertTriangle size={15} />
                      <span>
                        <strong>{warning.code.replaceAll('_', ' ')}</strong>
                        <small>{warning.message}</small>
                      </span>
                    </div>
                  ))}
                  {!operations?.warnings.length && (
                    <div className="live-diagnostic-warning ok">
                      <CheckCircle2 size={16} />
                      <span>
                        <strong>Keine dringenden Eingriffe</strong>
                        <small>OBS, Regie und Programm melden einen stabilen Betriebszustand.</small>
                      </span>
                    </div>
                  )}
                </div>
                <div className="live-dialog-actions">
                  <button onClick={() => setActiveDialog('sources')}>
                    <Video size={16} /> Quellen prüfen
                  </button>
                  <button onClick={() => setActiveDialog('stream')}>
                    <Radio size={16} /> Streamdetails
                  </button>
                  <button className="primary-button" disabled={Boolean(busy)} onClick={() => void load()}>
                    <RefreshCw size={16} /> Diagnose aktualisieren
                  </button>
                </div>
              </>
            )}

            {activeDialog === 'mode' && (
              <>
                <div className={`live-interruption-preview ${activationKind === 'breaking-news' ? 'breaking' : ''}`}>
                  <span className="stat-icon live">
                    {activationKind === 'breaking-news' ? <Zap size={22} /> : <Radio size={22} />}
                  </span>
                  <div>
                    <p className="eyebrow">
                      {activationKind === 'breaking-news' ? 'Breaking-News-Unterbrechung' : 'Live-Unterbrechung'}
                    </p>
                    <h3>
                      {operations?.current.playlist?.name
                        ? `„${operations.current.playlist.name}“ wird pausiert`
                        : 'Live-Regie wird aktiviert'}
                    </h3>
                    <p>
                      {operations?.current.item?.title
                        ? `Die Position bei „${operations.current.item.title}“ wird gespeichert.`
                        : 'Es läuft derzeit kein Beitrag.'}{' '}
                      {operations?.autopilot.enabled
                        ? 'Der Autopilot wird für den Eingriff pausiert.'
                        : 'Der Autopilot ist bereits pausiert.'}
                    </p>
                  </div>
                </div>
                <div className="live-dialog-metrics">
                  <div>
                    <Radio size={20} />
                    <span>Modus</span>
                    <strong>{status?.settings.enabled ? 'Live aktiv' : 'Standby'}</strong>
                  </div>
                  <div>
                    <MonitorPlay size={20} />
                    <span>Szene</span>
                    <strong>{currentProgramScene}</strong>
                  </div>
                  <div>
                    <Clock3 size={20} />
                    <span>Intro</span>
                    <strong>
                      {status?.settings.stinger_settings?.[activationKind]?.durationMs ??
                        fallbackStingers[activationKind].durationMs}{' '}
                      ms
                    </strong>
                  </div>
                </div>
                <div className="live-dialog-actions">
                  <button onClick={() => openStingerSettings('live-now')}>
                    <Settings size={16} /> Live-Intro gestalten
                  </button>
                  <button onClick={() => openStingerSettings('breaking-news')}>
                    <Zap size={16} /> Breaking-Teaser gestalten
                  </button>
                  <button
                    className="primary-button"
                    disabled={Boolean(busy)}
                    onClick={() =>
                      run(
                        'activate-live-modal',
                        () =>
                          api('/api/live/activate', {
                            method: 'POST',
                            body: JSON.stringify({ kind: activationKind, transition, disableAutopilot: true }),
                          }),
                        activationKind === 'breaking-news'
                          ? 'Breaking-News-Regie mit gespeichertem Rückkehrpunkt aktiviert.'
                          : 'Live-Regie mit gespeichertem Rückkehrpunkt aktiviert.',
                      ).then((saved) => {
                        if (saved) setActiveDialog(null);
                      })
                    }
                  >
                    {activationKind === 'breaking-news' ? <Zap size={16} /> : <Radio size={16} />}
                    {activationKind === 'breaking-news' ? 'Jetzt Breaking übernehmen' : 'Jetzt Live übernehmen'}
                  </button>
                </div>
              </>
            )}

            {activeDialog === 'return-program' && (
              <>
                <div className="return-program-context">
                  <p className="eyebrow">Unterbrochenes Programm</p>
                  <h3>
                    {operations?.live.interruption?.source_playlist_name ??
                      operations?.current.playlist?.name ??
                      'Kein gespeicherter Rückkehrpunkt'}
                  </h3>
                  <p>
                    {operations?.live.interruption?.source_item_title
                      ? `Gespeichert bei „${operations.live.interruption.source_item_title}“.`
                      : 'Die Regie kann zum nächsten geplanten Programm oder in Bereitschaft wechseln.'}
                  </p>
                </div>
                <div className="return-strategy-grid">
                  {(
                    [
                      [
                        'resume-position',
                        'An bisheriger Position fortsetzen',
                        'Der pausierte Beitrag läuft an der gespeicherten Stelle weiter.',
                      ],
                      ['next-item', 'Mit nächstem Beitrag fortsetzen', 'Der unterbrochene Beitrag wird übersprungen.'],
                      [
                        'next-show',
                        'Zur nächsten geplanten Sendung',
                        operations?.next?.name
                          ? `„${operations.next.name}“ wird kontrolliert übernommen.`
                          : 'Nur verfügbar, wenn eine nächste Sendung geplant ist.',
                      ],
                      ['standby', 'In Bereitschaft bleiben', 'Autopilot und Programm bleiben pausiert.'],
                    ] as const
                  ).map(([value, label, detail]) => (
                    <button
                      className={returnStrategy === value ? 'active' : ''}
                      disabled={value === 'next-show' && !operations?.next}
                      key={value}
                      onClick={() => setReturnStrategy(value)}
                    >
                      <span>
                        <strong>{label}</strong>
                        <small>{detail}</small>
                      </span>
                      {returnStrategy === value && <CheckCircle2 size={18} />}
                    </button>
                  ))}
                </div>
                <div className="live-dialog-actions">
                  <button onClick={() => openStingerSettings('back-to-program')}>
                    <Settings size={16} /> Rückkehr-Animation
                  </button>
                  <button className="primary-button" disabled={Boolean(busy)} onClick={returnToProgram}>
                    <ArrowRightLeft size={16} /> Auswahl ausführen
                  </button>
                </div>
              </>
            )}

            {activeDialog === 'show-switch' && showSwitchDraft && (
              <>
                <div className="show-switch-route live-show-switch-route">
                  <article>
                    <span className="eyebrow">Aktuell</span>
                    <strong>{operations?.current.playlist?.name ?? 'Bereitschaft'}</strong>
                    <small>{operations?.current.item?.title ?? operations?.current.playback.status}</small>
                  </article>
                  <ArrowRightLeft size={24} />
                  <article className="target">
                    <span className="eyebrow">Danach on air</span>
                    <strong>{showSwitchDraft.playlist.name}</strong>
                    <small>
                      {showSwitchDraft.item ? `Ab „${showSwitchDraft.item.title}“` : 'Vom Beginn der Sendung'}
                    </small>
                  </article>
                </div>
                <div className="live-settings-grid">
                  <label className="live-field">
                    <span>Übergang</span>
                    <select
                      value={showSwitchDraft.transition}
                      onChange={(event) =>
                        setShowSwitchDraft({
                          ...showSwitchDraft,
                          transition: event.target.value as LiveTransition,
                        })
                      }
                    >
                      {transitionOptions.map((option) => (
                        <option value={option.id} key={option.id}>
                          {option.label}
                        </option>
                      ))}
                    </select>
                  </label>
                  <label className="live-field">
                    <span>Blenddauer: {showSwitchDraft.durationMs} ms</span>
                    <input
                      type="range"
                      min={0}
                      max={2500}
                      step={50}
                      disabled={showSwitchDraft.transition === 'cut'}
                      value={showSwitchDraft.transition === 'cut' ? 0 : showSwitchDraft.durationMs}
                      onChange={(event) =>
                        setShowSwitchDraft({ ...showSwitchDraft, durationMs: Number(event.target.value) })
                      }
                    />
                  </label>
                </div>
                <p className="show-switch-safety-note">
                  Der aktuelle Lauf wird zuerst sauber gestoppt. Erst danach startet der Broadcast-Runner die
                  Zielsendung. Während des Wechsels sind weitere Takes gesperrt.
                </p>
                <div className="live-dialog-actions">
                  <button onClick={() => setActiveDialog(null)}>Abbrechen</button>
                  <button className="primary-button" disabled={Boolean(busy)} onClick={executeShowSwitch}>
                    <Send size={16} /> Kontrolliert übernehmen
                  </button>
                </div>
              </>
            )}

            {activeDialog === 'director-cue' && (
              <>
                <div className="director-cue-type-grid">
                  {(
                    [
                      ['banner', 'Hinweis', Megaphone],
                      ['text', 'Texttafel', ListChecks],
                      ['image', 'Bild', ImageIcon],
                      ['video', 'Videoclip', Video],
                    ] as const
                  ).map(([value, label, Icon]) => (
                    <button
                      className={directorCue.cueType === value ? 'active' : ''}
                      key={value}
                      onClick={() =>
                        setDirectorCue({
                          ...directorCue,
                          cueType: value,
                          position: value === 'image' || value === 'video' ? 'fullscreen' : directorCue.position,
                        })
                      }
                    >
                      <Icon size={17} /> {label}
                    </button>
                  ))}
                </div>
                {(directorCue.cueType === 'image' || directorCue.cueType === 'video') && (
                  <label className="live-field">
                    <span>Medium</span>
                    <select
                      value={directorCue.mediaId}
                      onChange={(event) => setDirectorCue({ ...directorCue, mediaId: event.target.value })}
                    >
                      <option value="">Aus Mediathek auswählen …</option>
                      {directorCues.media
                        .filter((media) =>
                          String(media.mime_type).startsWith(directorCue.cueType === 'image' ? 'image/' : 'video/'),
                        )
                        .map((media) => (
                          <option value={media.id} key={media.id}>
                            {media.filename}
                          </option>
                        ))}
                    </select>
                  </label>
                )}
                <div className="live-settings-grid">
                  <label className="live-field">
                    <span>Überschrift</span>
                    <input
                      value={directorCue.title}
                      maxLength={120}
                      onChange={(event) => setDirectorCue({ ...directorCue, title: event.target.value })}
                    />
                  </label>
                  <label className="live-field">
                    <span>Position</span>
                    <select
                      value={directorCue.position}
                      onChange={(event) =>
                        setDirectorCue({
                          ...directorCue,
                          position: event.target.value as DirectorCueDraft['position'],
                        })
                      }
                    >
                      <option value="lower-third">Bauchbinde</option>
                      <option value="top">Oben</option>
                      <option value="bottom-right">Rechts unten</option>
                      <option value="fullscreen">Vollbild</option>
                    </select>
                  </label>
                </div>
                <label className="live-field">
                  <span>Mitteilung</span>
                  <textarea
                    rows={4}
                    value={directorCue.message}
                    maxLength={700}
                    onChange={(event) => setDirectorCue({ ...directorCue, message: event.target.value })}
                  />
                </label>
                <div className="live-settings-grid">
                  <label className="live-field">
                    <span>Design</span>
                    <select
                      value={directorCue.style}
                      onChange={(event) =>
                        setDirectorCue({ ...directorCue, style: event.target.value as DirectorCueDraft['style'] })
                      }
                    >
                      <option value="studio">Studio Türkis</option>
                      <option value="breaking">Breaking Rot</option>
                      <option value="info">Information Blau</option>
                      <option value="minimal">Minimal</option>
                    </select>
                  </label>
                  <label className="live-field">
                    <span>Dauer: {directorCue.durationSeconds} Sekunden</span>
                    <input
                      type="range"
                      min={2}
                      max={120}
                      value={directorCue.durationSeconds}
                      onChange={(event) =>
                        setDirectorCue({ ...directorCue, durationSeconds: Number(event.target.value) })
                      }
                    />
                  </label>
                </div>
                <div className="live-dialog-actions">
                  <button onClick={() => setActiveDialog(null)}>Abbrechen</button>
                  <button
                    className="primary-button"
                    disabled={
                      Boolean(busy) ||
                      ((directorCue.cueType === 'image' || directorCue.cueType === 'video') && !directorCue.mediaId) ||
                      ((directorCue.cueType === 'banner' || directorCue.cueType === 'text') &&
                        !directorCue.title.trim() &&
                        !directorCue.message.trim())
                    }
                    onClick={sendDirectorCue}
                  >
                    <Send size={16} /> Jetzt einblenden
                  </button>
                </div>
              </>
            )}

            {activeDialog === 'program' && (
              <>
                <div className="live-settings-grid">
                  <label className="live-field">
                    <span>Szenenübergang</span>
                    <select
                      value={transition}
                      onChange={(event) => setTransition(event.target.value as LiveTransition)}
                    >
                      {transitionOptions.map((item) => (
                        <option key={item.id} value={item.id}>
                          {item.label}
                        </option>
                      ))}
                    </select>
                  </label>
                  <label className="live-field">
                    <span>Dauer in Millisekunden</span>
                    <input
                      type="number"
                      min={0}
                      max={5000}
                      step={50}
                      value={durationMs}
                      onChange={(event) => setDurationMs(numberValue(event.target.value, 450))}
                    />
                  </label>
                </div>
                <p className="muted">
                  Diese Einstellung gilt für Szenenwechsel zwischen Vorschau, Live-Studio, Hauptprogramm und
                  Bereitschaft.
                </p>
                <div className="live-dialog-actions">
                  <button onClick={() => openStingerSettings('back-to-program')}>
                    <Settings size={16} /> Programm-Outro gestalten
                  </button>
                  <button
                    className="primary-button"
                    disabled={Boolean(busy)}
                    onClick={() =>
                      run(
                        'transition-modal',
                        () =>
                          api('/api/live/transition', {
                            method: 'POST',
                            body: JSON.stringify({ transition, durationMs }),
                          }),
                        'Szenenübergang gespeichert.',
                      )
                    }
                  >
                    <CheckCircle2 size={16} /> Übergang speichern
                  </button>
                </div>
              </>
            )}

            {activeDialog === 'autopilot' && (
              <>
                <div className="live-dialog-metrics">
                  <div>
                    <Activity size={20} />
                    <span>Autopilot</span>
                    <strong>{status?.autopilot?.enabled ? 'Aktiv' : 'Pausiert'}</strong>
                  </div>
                  <div>
                    <AudioLines size={20} />
                    <span>Sprecher</span>
                    <strong>{status?.playback?.status ?? 'idle'}</strong>
                  </div>
                  <div>
                    <MonitorPlay size={20} />
                    <span>Programm</span>
                    <strong>{currentProgramScene}</strong>
                  </div>
                </div>
                <div className="live-dialog-actions">
                  <button onClick={() => openStingerSettings('back-to-program')}>
                    <Settings size={16} /> Rückkehr-Outro
                  </button>
                  <button
                    className="primary-button"
                    disabled={Boolean(busy)}
                    onClick={() => setActiveDialog('return-program')}
                  >
                    <MonitorPlay size={16} /> Rückkehr auswählen
                  </button>
                </div>
              </>
            )}

            {activeDialog === 'portal' && (
              <>
                <div className="live-dialog-metrics">
                  <div>
                    <Wifi size={20} />
                    <span>Konfiguration</span>
                    <strong>{status?.portal.configured ? 'Bereit' : 'Fehlt'}</strong>
                  </div>
                  <div>
                    <CheckCircle2 size={20} />
                    <span>Service-Token</span>
                    <strong>{status?.portal.tokenConfigured ? 'Gesetzt' : 'Fehlt'}</strong>
                  </div>
                  <div>
                    <Video size={20} />
                    <span>Aktive Quellen</span>
                    <strong>{activePortalSources}</strong>
                  </div>
                </div>
                {status?.portal.error && <p className="status-message status-error">{status.portal.error}</p>}
                <div className="live-dialog-actions">
                  <a
                    className="button-link"
                    href={status?.portal.baseUrl || 'https://obs.meinzeug.cloud'}
                    target="_blank"
                    rel="noreferrer"
                  >
                    <ExternalLink size={16} /> Portal öffnen
                  </a>
                  <button
                    onClick={() =>
                      run(
                        'portal-refresh',
                        () => api('/api/live/sources/sync', { method: 'POST' }),
                        'Portal-Quellen synchronisiert.',
                      )
                    }
                  >
                    <RefreshCw size={16} /> Quellen synchronisieren
                  </button>
                </div>
              </>
            )}

            {activeDialog === 'sources' && (
              <>
                <div className="live-settings-grid">
                  <label className="live-field">
                    <span>Quellenwechsel-Animation</span>
                    <select
                      value={sourceTransition}
                      onChange={(event) => setSourceTransition(event.target.value as LiveSourceTransition)}
                    >
                      {sourceTransitionOptions.map((item) => (
                        <option key={item.id} value={item.id}>
                          {item.label}
                        </option>
                      ))}
                    </select>
                    <small>{sourceTransitionOptions.find((item) => item.id === sourceTransition)?.description}</small>
                  </label>
                  <label className="live-field">
                    <span>Animationsdauer in ms</span>
                    <input
                      type="number"
                      min={0}
                      max={3000}
                      step={50}
                      disabled={sourceTransition === 'cut'}
                      value={sourceDurationMs}
                      onChange={(event) => setSourceDurationMs(numberValue(event.target.value, 650))}
                    />
                    <small>Wirkt bei Hinzufügen, Entfernen, Ein-/Ausblenden, Layout und Take.</small>
                  </label>
                  <label className="live-field">
                    <span>Quellenlabel-Stil</span>
                    <select
                      value={sourceLabelStyle}
                      onChange={(event) => setSourceLabelStyle(event.target.value as LiveSourceLabelStyle)}
                    >
                      <option value="lower-third">Lower Third</option>
                      <option value="badge">Kompaktes Badge</option>
                      <option value="minimal">Minimal</option>
                    </select>
                    <small>Name, Programmstatus und Audiostatus im Stream.</small>
                  </label>
                  <div className="live-toggle-stack">
                    <label>
                      <input
                        type="checkbox"
                        checked={sourceAutoLayout}
                        onChange={(event) => setSourceAutoLayout(event.target.checked)}
                      />
                      <span>
                        <strong>Automatisches Layout</strong>
                        <small>1 Quelle Vollbild, 2 Split, ab 3 Raster.</small>
                      </span>
                    </label>
                    <label>
                      <input
                        type="checkbox"
                        checked={sourceOverlayEnabled}
                        onChange={(event) => setSourceOverlayEnabled(event.target.checked)}
                      />
                      <span>
                        <strong>Dynamisches Quellen-Overlay</strong>
                        <small>Animiert Namen und verdeckt Layoutumbauten.</small>
                      </span>
                    </label>
                  </div>
                </div>
                <div className="live-dialog-actions">
                  <button
                    onClick={() => {
                      setActiveDialog(null);
                      setYoutubeDialog(true);
                    }}
                  >
                    <Video size={16} /> YouTube-Live hinzufügen
                  </button>
                  <button className="primary-button" disabled={Boolean(busy)} onClick={saveSourceSettings}>
                    <CheckCircle2 size={16} /> Einstellungen speichern
                  </button>
                </div>
              </>
            )}

            {activeDialog === 'youtube-auth' && (
              <>
                {youtubeAuthSource ? (
                  <div className="youtube-auth-guide">
                    <div className={`youtube-auth-state ${youtubeAuthSource.youtubeReady ? 'ready' : 'warning'}`}>
                      {youtubeAuthSource.youtubeReady ? <CheckCircle2 size={24} /> : <EyeOff size={24} />}
                      <div>
                        <strong>
                          {youtubeAuthSource.youtubeReady
                            ? 'Lokale Wiedergabe ist sendefertig'
                            : 'Quelle ist bis zur erfolgreichen Prüfung ausgeblendet'}
                        </strong>
                        <p>
                          {youtubeAuthSource.youtubeReady
                            ? `yt-dlp und der lokale Player umgehen die eingebettete Bot-Anmeldeseite.${
                                youtubeAuthSource.youtubePlaybackResolvedAt
                                  ? ` Zuletzt geprüft: ${new Date(
                                      youtubeAuthSource.youtubePlaybackResolvedAt,
                                    ).toLocaleTimeString('de-DE')}.`
                                  : ''
                              }`
                            : youtubeAuthSource.youtubePlaybackError ||
                              'Der lokale Stream wurde noch nicht erfolgreich aufgelöst.'}
                        </p>
                      </div>
                    </div>
                    <button
                      className="youtube-auth-prepare-button"
                      disabled={Boolean(busy)}
                      onClick={() => prepareYoutubePlayback(youtubeAuthSource.id)}
                    >
                      <RefreshCw size={16} />
                      {youtubeAuthSource.youtubeReady ? 'Streamadresse erneuern und testen' : 'Lokalen Stream vorbereiten'}
                    </button>
                    <ol>
                      <li>Das Studio löst Video beziehungsweise Livestream lokal und authentifiziert auf.</li>
                      <li>OBS erhält nur den lokalen Player – niemals eine Login- oder Bot-Seite.</li>
                      <li>Ablaufende Streamadressen werden bei Wiedergabefehlern automatisch erneuert.</li>
                      <li>Video und Ton bleiben als eigene OBS-Quelle regelbar.</li>
                    </ol>
                    <p className="muted">
                      Verwendet werden ausschließlich das lokal konfigurierte Cookieprofil und der lokale
                      PO-Token-Provider. Zugangsdaten werden nicht an die WebUI übertragen.
                    </p>
                    <div className="live-dialog-actions">
                      {youtubeAuthSource.youtubeReady ? (
                        <button disabled={Boolean(busy)} onClick={() => setYoutubeReady(youtubeAuthSource.id, false)}>
                          <EyeOff size={16} /> Freigabe zurücknehmen
                        </button>
                      ) : (
                        <button
                          className="primary-button"
                          disabled={Boolean(busy)}
                          onClick={() => setYoutubeReady(youtubeAuthSource.id, true)}
                        >
                          <CheckCircle2 size={16} /> Erneut auflösen und freigeben
                        </button>
                      )}
                    </div>
                  </div>
                ) : (
                  <p className="muted">Wähle zuerst eine YouTube-Quelle aus der Quellenliste.</p>
                )}
              </>
            )}

            {activeDialog === 'talk' && (
              <div className="live-talk-console">
                <div className="live-talk-showbar">
                  <div className="live-talk-show-list">
                    {(liveTalk?.shows ?? []).map((show) => (
                      <button
                        key={show.id}
                        className={liveTalkDraft.id === show.id ? 'active' : ''}
                        onClick={() => selectLiveTalkShow(show)}
                      >
                        <span className={`live-talk-show-state state-${show.status}`}>{show.status}</span>
                        <strong>{show.title}</strong>
                        <small>{show.source_ids.length} Gäste · {show.layout}</small>
                      </button>
                    ))}
                  </div>
                  <button
                    className="live-talk-new"
                    onClick={() => setLiveTalkDraft({ ...defaultLiveTalkDraft })}
                  >
                    <Users size={17} /> Neue Talkshow
                  </button>
                </div>

                <div className="live-talk-production-grid">
                  <section className="live-talk-editor">
                    <div className="live-talk-section-head">
                      <div>
                        <p className="eyebrow">Sendung & Bildsprache</p>
                        <h4>Produktion vorbereiten</h4>
                      </div>
                      <span
                        className={`state-pill ${
                          liveTalkDraft.id &&
                          liveTalk?.shows.find((show) => show.id === liveTalkDraft.id)?.status === 'on_air'
                            ? 'live'
                            : ''
                        }`}
                      >
                        {liveTalkDraft.id
                          ? liveTalk?.shows.find((show) => show.id === liveTalkDraft.id)?.status ?? 'Entwurf'
                          : 'Neu'}
                      </span>
                    </div>
                    <div className="live-settings-grid">
                      <label className="live-field">
                        <span>Sendungsname</span>
                        <input
                          value={liveTalkDraft.title}
                          maxLength={160}
                          onChange={(event) =>
                            setLiveTalkDraft((current) => ({ ...current, title: event.target.value }))
                          }
                        />
                      </label>
                      <label className="live-field">
                        <span>Studio-Layout</span>
                        <select
                          value={liveTalkDraft.layout}
                          onChange={(event) =>
                            setLiveTalkDraft((current) => ({
                              ...current,
                              layout: event.target.value as LiveTalkDraft['layout'],
                            }))
                          }
                        >
                          <option value="host-guest">AVA + Gast</option>
                          <option value="interview">Interview</option>
                          <option value="panel">Panelrunde</option>
                          <option value="townhall">Publikumsforum</option>
                        </select>
                      </label>
                      <label className="live-field live-field-wide">
                        <span>Unterzeile</span>
                        <input
                          value={liveTalkDraft.subtitle}
                          maxLength={240}
                          onChange={(event) =>
                            setLiveTalkDraft((current) => ({ ...current, subtitle: event.target.value }))
                          }
                        />
                      </label>
                      <label className="live-field live-field-wide">
                        <span>Thema und redaktioneller Auftrag</span>
                        <textarea
                          rows={3}
                          value={liveTalkDraft.topic}
                          maxLength={4000}
                          onChange={(event) =>
                            setLiveTalkDraft((current) => ({ ...current, topic: event.target.value }))
                          }
                          placeholder="Worum geht es, welche Perspektiven und Fragen soll AVA einbringen?"
                        />
                      </label>
                      <label className="live-field">
                        <span>Akzentfarbe</span>
                        <div className="live-color-field">
                          <input
                            type="color"
                            value={liveTalkDraft.accentColor}
                            onChange={(event) =>
                              setLiveTalkDraft((current) => ({ ...current, accentColor: event.target.value }))
                            }
                          />
                          <code>{liveTalkDraft.accentColor}</code>
                        </div>
                      </label>
                      <label className="live-field">
                        <span>Werbeabstand: {liveTalkDraft.advertisingIntervalMinutes} Minuten</span>
                        <input
                          type="range"
                          min={5}
                          max={60}
                          step={5}
                          value={liveTalkDraft.advertisingIntervalMinutes}
                          onChange={(event) =>
                            setLiveTalkDraft((current) => ({
                              ...current,
                              advertisingIntervalMinutes: Number(event.target.value),
                            }))
                          }
                        />
                      </label>
                    </div>
                    <div className="live-toggle-stack live-talk-toggles">
                      {[
                        ['avaEnabled', 'AVA im Studio', 'Moderiert das Gespräch und ordnet Aussagen ein.'],
                        ['miaEnabled', 'Mia für das Publikum', 'Übernimmt Fragen und Reaktionen aus dem Chat.'],
                        ['chatEnabled', 'Livechat auswerten', 'YouTube und Twitch fließen in die Redaktion ein.'],
                        ['advertisingEnabled', 'Werbung zulassen', 'Regie kann passende Spots und Banner einblenden.'],
                      ].map(([key, title, description]) => (
                        <label key={key}>
                          <input
                            type="checkbox"
                            checked={Boolean(liveTalkDraft[key as keyof LiveTalkDraft])}
                            onChange={(event) =>
                              setLiveTalkDraft((current) => ({ ...current, [key]: event.target.checked }))
                            }
                          />
                          <span>
                            <strong>{title}</strong>
                            <small>{description}</small>
                          </span>
                        </label>
                      ))}
                    </div>
                    <div className="live-dialog-actions">
                      {liveTalkDraft.id && (
                        <button
                          className="danger"
                          disabled={Boolean(busy)}
                          onClick={() => {
                            if (!window.confirm(`„${liveTalkDraft.title}“ archivieren?`)) return;
                            void run(
                              'live-talk-delete',
                              () => api(`/api/live/talk-shows/${liveTalkDraft.id}`, { method: 'DELETE' }),
                              'Live-Talk archiviert.',
                            ).then(async (saved) => {
                              if (!saved) return;
                              setLiveTalkDraft({ ...defaultLiveTalkDraft });
                              await loadLiveTalk();
                            });
                          }}
                        >
                          <Trash2 size={16} /> Archivieren
                        </button>
                      )}
                      <button className="primary-button" disabled={Boolean(busy)} onClick={() => void saveLiveTalk()}>
                        <CheckCircle2 size={16} /> Sendung speichern
                      </button>
                    </div>
                  </section>

                  <aside className="live-talk-preview">
                    <div
                      className="live-talk-mini-stage"
                      style={{ '--talk-accent': liveTalkDraft.accentColor } as React.CSSProperties}
                    >
                      <header>
                        <span>OPEN TV STUDIO</span>
                        <strong>{liveTalkDraft.title || 'AVA Live Talk'}</strong>
                        <em>● LIVE</em>
                      </header>
                      <div className="live-talk-mini-guests">
                        {liveTalkDraft.sourceIds.length ? (
                          liveTalkDraft.sourceIds.slice(0, 4).map((sourceId) => {
                            const source = liveTalk?.sources.find((candidate) => candidate.id === sourceId);
                            return (
                              <div key={sourceId}>
                                {source?.previewUrl ? <img src={source.previewUrl} alt="" /> : <Video size={24} />}
                                <span>{source?.name ?? 'Gastquelle'}</span>
                              </div>
                            );
                          })
                        ) : (
                          <div className="empty">
                            <Users size={26} />
                            <span>Live-Gäste auswählen</span>
                          </div>
                        )}
                      </div>
                      <div className="live-talk-mini-ava">
                        <Wand2 size={30} />
                        <strong>AVA</strong>
                        <small>Moderation</small>
                      </div>
                      <footer>{liveTalkDraft.topic || liveTalkDraft.subtitle}</footer>
                    </div>
                    <div className="live-talk-readiness">
                      <span className={liveTalk?.portal.configured ? 'ok' : 'error'}>
                        <CheckCircle2 size={15} /> Portal {liveTalk?.portal.configured ? 'verbunden' : 'nicht bereit'}
                      </span>
                      <span className={liveTalkDraft.sourceIds.length ? 'ok' : 'warn'}>
                        <Video size={15} /> {liveTalkDraft.sourceIds.length} Quelle(n) gewählt
                      </span>
                      <span className={liveTalkDraft.title.trim().length >= 2 ? 'ok' : 'error'}>
                        <ListChecks size={15} /> Sendungsdaten
                      </span>
                    </div>
                  </aside>
                </div>

                <section className="live-talk-guest-desk">
                  <div className="live-talk-section-head">
                    <div>
                      <p className="eyebrow">Gäste-Lobby</p>
                      <h4>Einladen, prüfen und ins Bild setzen</h4>
                    </div>
                    <a
                      className="button-link"
                      href={liveTalk?.portal.baseUrl || status?.portal.baseUrl || 'https://obs.meinzeug.cloud'}
                      target="_blank"
                      rel="noreferrer"
                    >
                      <ExternalLink size={15} /> Portal öffnen
                    </a>
                  </div>
                  <div className="live-talk-invite-row">
                    <input
                      value={liveTalkGuestName}
                      onChange={(event) => setLiveTalkGuestName(event.target.value)}
                      placeholder="Name des Gastes"
                    />
                    <button
                      disabled={Boolean(busy) || liveTalkGuestName.trim().length < 2}
                      onClick={() => {
                        void (async () => {
                          const showId = await ensureLiveTalkSaved();
                          if (!showId) return;
                          const created = await run(
                            'live-talk-invite',
                            () =>
                              api(`/api/live/talk-shows/${showId}/invitations`, {
                                method: 'POST',
                                body: JSON.stringify({ displayName: liveTalkGuestName.trim(), expiresInHours: 48 }),
                              }),
                            `Einladung für ${liveTalkGuestName.trim()} erstellt.`,
                          );
                          if (created) {
                            setLiveTalkGuestName('');
                            await loadLiveTalk();
                          }
                        })();
                      }}
                    >
                      <UserPlus size={16} /> Sicher einladen
                    </button>
                  </div>
                  <div className="live-talk-invitation-list">
                    {(liveTalk?.invitations ?? [])
                      .filter((invitation) => !liveTalkDraft.id || invitation.show_id === liveTalkDraft.id)
                      .slice(0, 8)
                      .map((invitation) => (
                        <div key={invitation.id}>
                          <span className={`source-dot ${invitation.status === 'accepted' ? 'live' : ''}`} />
                          <span>
                            <strong>{invitation.display_name}</strong>
                            <small>
                              {invitation.status} · gültig bis {new Date(invitation.expires_at).toLocaleString('de-DE')}
                            </small>
                          </span>
                          <button
                            className="icon-button"
                            title="Einladungslink kopieren"
                            onClick={() => void navigator.clipboard.writeText(invitation.invitation_url)}
                          >
                            <Copy size={15} />
                          </button>
                          <button
                            className="icon-button danger"
                            title="Einladung widerrufen"
                            disabled={Boolean(busy) || invitation.status === 'revoked'}
                            onClick={() =>
                              void run(
                                `live-talk-revoke-${invitation.id}`,
                                () => api(`/api/live/talk-invitations/${invitation.portal_invitation_id}`, { method: 'DELETE' }),
                                'Einladung widerrufen.',
                              ).then(() => loadLiveTalk())
                            }
                          >
                            <Trash2 size={15} />
                          </button>
                        </div>
                      ))}
                  </div>
                  <div className="live-talk-source-picker">
                    {(liveTalk?.sources ?? []).map((source) => (
                      <button
                        key={source.id}
                        className={liveTalkDraft.sourceIds.includes(source.id) ? 'selected' : ''}
                        onClick={() => toggleLiveTalkSource(source.id)}
                      >
                        <span className={`source-dot ${source.status}`} />
                        {source.previewUrl ? <img src={source.previewUrl} alt="" /> : <Video size={20} />}
                        <span>
                          <strong>{source.name}</strong>
                          <small>
                            {source.user || 'Gast'} · {source.resolution || 'Auflösung offen'} ·{' '}
                            {source.network || 'Netz offen'}
                          </small>
                        </span>
                        <em>{liveTalkDraft.sourceIds.includes(source.id) ? 'Im Bild' : source.status}</em>
                      </button>
                    ))}
                    {!liveTalk?.sources.length && (
                      <p className="muted">Noch keine Portalquelle vorhanden. Sende einem Gast zuerst eine Einladung.</p>
                    )}
                  </div>
                </section>

                <section className="live-talk-onair-desk">
                  <div className="live-talk-section-head">
                    <div>
                      <p className="eyebrow">On-Air Desk</p>
                      <h4>Vorschau, Moderation und Werbung</h4>
                    </div>
                    <span className={`state-pill ${liveTalkOnAir ? 'live' : ''}`}>
                      {liveTalkOnAir ? 'ON AIR' : 'OFF AIR'}
                    </span>
                  </div>
                  <div className="live-talk-take-actions">
                    <button
                      disabled={Boolean(busy) || liveTalkDraft.sourceIds.length === 0}
                      onClick={() =>
                        void (async () => {
                          const showId = await ensureLiveTalkSaved();
                          if (!showId) return;
                          await run(
                            'live-talk-prepare',
                            () => api(`/api/live/talk-shows/${showId}/prepare`, { method: 'POST' }),
                            'AVA Live Talk ist in OBS vorbereitet.',
                          );
                          await loadLiveTalk();
                        })()
                      }
                    >
                      <Eye size={16} /> In Vorschau vorbereiten
                    </button>
                    <button
                      className="primary-button live-take-button"
                      disabled={Boolean(busy) || liveTalkDraft.sourceIds.length === 0}
                      onClick={() => {
                        if (
                          !window.confirm(
                            `„${liveTalkDraft.title}“ jetzt live übernehmen? Das aktuelle Programm wird kontrolliert pausiert.`,
                          )
                        )
                          return;
                        void (async () => {
                          const showId = await ensureLiveTalkSaved();
                          if (!showId) return;
                          await run(
                            'live-talk-activate',
                            () => api(`/api/live/talk-shows/${showId}/activate`, { method: 'POST' }),
                            'AVA Live Talk ist jetzt on air.',
                          );
                          await loadLiveTalk();
                        })();
                      }}
                    >
                      <Radio size={17} /> Talkshow jetzt übernehmen
                    </button>
                  </div>
                  <div className="live-talk-cue-grid">
                    <div>
                      <div className="live-talk-presenter-switch">
                        <button
                          className={liveTalkCuePresenter === 'ava' ? 'active' : ''}
                          onClick={() => setLiveTalkCuePresenter('ava')}
                        >
                          AVA
                        </button>
                        <button
                          className={liveTalkCuePresenter === 'mia' ? 'active' : ''}
                          onClick={() => setLiveTalkCuePresenter('mia')}
                        >
                          MIA
                        </button>
                      </div>
                      <input
                        value={liveTalkCueHeadline}
                        onChange={(event) => setLiveTalkCueHeadline(event.target.value)}
                        placeholder="Überschrift"
                      />
                      <textarea
                        rows={3}
                        value={liveTalkCueText}
                        onChange={(event) => setLiveTalkCueText(event.target.value)}
                        placeholder="Sprechertext für den nächsten moderierten Einsatz"
                      />
                      <button
                        disabled={Boolean(busy) || !liveTalkOnAir || liveTalkCueText.trim().length < 2}
                        onClick={() =>
                          void run(
                            'live-talk-presenter-cue',
                            () =>
                              api(`/api/live/talk-shows/${liveTalkDraft.id}/presenter-cue`, {
                                method: 'POST',
                                body: JSON.stringify({
                                  presenter: liveTalkCuePresenter,
                                  headline: liveTalkCueHeadline,
                                  text: liveTalkCueText,
                                }),
                              }),
                            `${liveTalkCuePresenter.toUpperCase()} übernimmt den nächsten Moderations-Cue.`,
                          ).then((saved) => {
                            if (saved) setLiveTalkCueText('');
                          })
                        }
                      >
                        <MessageSquareText size={16} /> Moderations-Cue senden
                      </button>
                    </div>
                    <div className="live-talk-ad-cue">
                      <label className="live-field">
                        <span>Werbemittel</span>
                        <select
                          value={liveTalkAdCreativeId}
                          onChange={(event) => setLiveTalkAdCreativeId(event.target.value)}
                        >
                          <option value="">Werbemittel wählen</option>
                          {(liveTalk?.advertising.creatives ?? []).map((creative) => (
                            <option key={creative.id} value={creative.id}>
                              {creative.name} · {creative.type}
                            </option>
                          ))}
                        </select>
                      </label>
                      <button
                        disabled={Boolean(busy) || !liveTalkOnAir || !liveTalkAdCreativeId}
                        onClick={() =>
                          void run(
                            'live-talk-advertising',
                            () =>
                              api(`/api/live/talk-shows/${liveTalkDraft.id}/advertising`, {
                                method: 'POST',
                                body: JSON.stringify({ creativeId: liveTalkAdCreativeId }),
                              }),
                            'Werbung wird über die Talkshow eingeblendet.',
                          )
                        }
                      >
                        <Megaphone size={16} /> Werbung ausspielen
                      </button>
                      <small>Die vorhandene Werbeverwaltung, Frequenzlimits und OBS-Ebene bleiben aktiv.</small>
                    </div>
                  </div>
                </section>
              </div>
            )}

            {activeDialog === 'reaction' && (
              <>
                <div className="reaction-mode-switch" role="tablist" aria-label="Reaction-Regiemodus">
                  <button
                    className={reactionMode === 'ava' ? 'active' : ''}
                    onClick={() => setReactionMode('ava')}
                  >
                    <Wand2 size={20} />
                    <span>
                      <strong>AVA moderiert</strong>
                      <small>Video aus der Mediathek, KI-Einordnung, Chat und TTS</small>
                    </span>
                  </button>
                  <button
                    className={reactionMode === 'camera' ? 'active' : ''}
                    onClick={() => setReactionMode('camera')}
                  >
                    <Video size={20} />
                    <span>
                      <strong>Kamera-Reaction</strong>
                      <small>YouTube plus Smartphone- oder Webkameraquellen</small>
                    </span>
                  </button>
                </div>
                <div className="reaction-regie-grid">
                  <div
                    className={`reaction-ui-preview mode-${reactionMode} position-${reactionPosition} style-${reactionStyle}`}
                    style={
                      {
                        '--reaction-accent': reactionAccentColor,
                        '--reaction-size': `${reactionSizePercent}%`,
                        '--reaction-gap': `${Math.max(6, Math.round(reactionGap / 2))}px`,
                      } as React.CSSProperties
                    }
                  >
                    <div className="reaction-preview-video">
                      {reactionMode === 'ava' && selectedReactionLibraryVideo ? (
                        <img
                          src={`https://i.ytimg.com/vi/${encodeURIComponent(selectedReactionLibraryVideo.video_id)}/hqdefault.jpg`}
                          alt=""
                        />
                      ) : youtubeSources.find((source) => source.id === reactionYoutubeSourceId)?.previewUrl ? (
                        <img
                          src={youtubeSources.find((source) => source.id === reactionYoutubeSourceId)!.previewUrl!}
                          alt=""
                        />
                      ) : (
                        <Video size={40} />
                      )}
                      <span>
                        {reactionMode === 'ava'
                          ? selectedReactionLibraryVideo?.channel_title || 'YouTube-Mediathek'
                          : 'YouTube · Hauptvideo'}
                      </span>
                    </div>
                    <strong className="reaction-preview-title">{reactionTitle || 'LIVE REACTION'}</strong>
                    <div className={`reaction-preview-rail animation-${reactionAnimation}`}>
                      {reactionMode === 'ava' ? (
                        <div className="reaction-preview-camera reaction-preview-ava">
                          <Wand2 size={22} />
                          <span>
                            <strong>AVA LIVE</strong>
                            <small>Einordnung & Chat</small>
                          </span>
                        </div>
                      ) : reactionCameraSourceIds.length === 0 ? (
                        <div className="reaction-preview-camera empty">
                          <Video size={20} />
                          <span>Kamera wählen</span>
                        </div>
                      ) : (
                        reactionCameraSourceIds.slice(0, 4).map((sourceId) => {
                          const source = cameraSources.find((candidate) => candidate.id === sourceId);
                          return (
                            <div className="reaction-preview-camera" key={sourceId}>
                              {source?.previewUrl ? <img src={source.previewUrl} alt="" /> : <Video size={20} />}
                              <span>{source?.name ?? 'Live-Kamera'}</span>
                            </div>
                          );
                        })
                      )}
                    </div>
                  </div>

                  <div className="reaction-config-panel">
                    {reactionMode === 'ava' && (
                      <>
                        <label className="live-field">
                          <span>Video in der Mediathek suchen</span>
                          <input
                            value={reactionVideoSearch}
                            onChange={(event) => setReactionVideoSearch(event.target.value)}
                            placeholder="Titel, Kanal oder Kategorie"
                          />
                          <small>
                            Das Studio erzeugt die lokale OBS-Quelle selbst. Eine vorherige Anlage als Live-Quelle ist
                            nicht nötig.
                          </small>
                        </label>
                        <div className="reaction-library-picker">
                          {filteredReactionLibrary.length === 0 ? (
                            <p className="muted">Kein passendes, aktiviertes YouTube-Video gefunden.</p>
                          ) : (
                            filteredReactionLibrary.slice(0, 12).map((video) => (
                              <button
                                key={video.id}
                                className={reactionYoutubeLibraryId === video.id ? 'selected' : ''}
                                onClick={() => {
                                  setReactionYoutubeLibraryId(video.id);
                                  setReactionTitle(`AVA REAGIERT · ${video.channel_title}`);
                                }}
                              >
                                <img
                                  src={`https://i.ytimg.com/vi/${encodeURIComponent(video.video_id)}/mqdefault.jpg`}
                                  alt=""
                                />
                                <span>
                                  <strong>{video.title}</strong>
                                  <small>
                                    {video.channel_title} · {Math.max(1, Math.round(video.duration_seconds / 60))} Min.
                                  </small>
                                </span>
                                {video.transcript_status === 'ready' && <CheckCircle2 size={16} />}
                              </button>
                            ))
                          )}
                        </div>
                        <label className="live-field">
                          <span>Moderationsdichte</span>
                          <select
                            value={reactionAvaIntensity}
                            onChange={(event) =>
                              setReactionAvaIntensity(event.target.value as typeof reactionAvaIntensity)
                            }
                          >
                            <option value="calm">Ruhig · etwa alle 7 Minuten</option>
                            <option value="balanced">Ausgewogen · etwa alle 4 Minuten</option>
                            <option value="intensive">Intensiv · etwa alle 2 Minuten</option>
                          </select>
                          <small>
                            AVA ordnet Aussagen ein; bei vorhandenem Transkript nutzt die Redaktion die vorbereitete
                            Videoanalyse.
                          </small>
                        </label>
                        <label className="live-check-card">
                          <input
                            type="checkbox"
                            checked={reactionChatEnabled}
                            onChange={(event) => setReactionChatEnabled(event.target.checked)}
                          />
                          <span>
                            <strong>Live-Chat in die Show einbeziehen</strong>
                            <small>Sam beobachtet YouTube und Twitch; AVA beziehungsweise Mia greifen Fragen auf.</small>
                          </span>
                        </label>
                      </>
                    )}
                    {reactionMode === 'camera' && (
                      <label className="live-field">
                        <span>YouTube-Hauptvideo</span>
                        <select
                          value={reactionYoutubeSourceId}
                          onChange={(event) => setReactionYoutubeSourceId(event.target.value)}
                        >
                          <option value="">YouTube-Quelle wählen</option>
                          {youtubeSources.map((source) => (
                            <option key={source.id} value={source.id}>
                              {source.name}
                            </option>
                          ))}
                        </select>
                        <small>Das Video füllt den Hintergrund und sein Ton bleibt separat in OBS regelbar.</small>
                      </label>
                    )}
                    {reactionMode === 'camera' && youtubeSources.length === 0 && (
                      <button
                        onClick={() => {
                          setActiveDialog(null);
                          setYoutubeDialog(true);
                        }}
                      >
                        <Video size={16} /> Erst YouTube-Live hinzufügen
                      </button>
                    )}
                    {reactionMode === 'camera' && selectedReactionYoutube && !selectedReactionYoutube.youtubeReady && (
                      <div className="youtube-reaction-warning">
                        <EyeOff size={18} />
                        <span>
                          <strong>Lokale YouTube-Wiedergabe noch nicht bereit</strong>
                          <small>
                            {selectedReactionYoutube.youtubePlaybackError ||
                              'Die Quelle bleibt gesperrt, damit keine Login-Meldung auf Sendung geht.'}
                          </small>
                        </span>
                        <button
                          onClick={() => {
                            setYoutubeAuthSourceId(selectedReactionYoutube.id);
                            setActiveDialog('youtube-auth');
                          }}
                        >
                          Lokal vorbereiten
                        </button>
                      </div>
                    )}
                    {reactionMode === 'camera' && (
                      <div className="live-field">
                        <span>Reaction-Kameras</span>
                        <div className="reaction-camera-picker">
                          {cameraSources.length === 0 ? (
                            <p className="muted">Noch keine Kamera-/Smartphone-Quelle in OBS.</p>
                          ) : (
                            cameraSources.map((source) => (
                              <label
                                key={source.id}
                                className={reactionCameraSourceIds.includes(source.id) ? 'selected' : ''}
                              >
                                <input
                                  type="checkbox"
                                  checked={reactionCameraSourceIds.includes(source.id)}
                                  onChange={() => toggleReactionCamera(source.id)}
                                />
                                <span>
                                  {source.previewUrl ? <img src={source.previewUrl} alt="" /> : <Video size={18} />}
                                  <strong>{source.name}</strong>
                                  <small>{source.obs?.muted ? 'stumm' : 'Audio aktiv'}</small>
                                </span>
                              </label>
                            ))
                          )}
                        </div>
                      </div>
                    )}
                  </div>
                </div>

                <div className="reaction-design-settings">
                  <div className="live-field reaction-position-field">
                    <span>{reactionMode === 'ava' ? 'Position von AVA' : 'Position der Reaction-Kameras'}</span>
                    <div className="reaction-position-picker">
                      {(['left', 'right', 'top', 'bottom'] as const).map((position) => (
                        <button
                          key={position}
                          className={reactionPosition === position ? 'active' : ''}
                          onClick={() => setReactionPosition(position)}
                        >
                          {position === 'left'
                            ? 'Links'
                            : position === 'right'
                              ? 'Rechts'
                              : position === 'top'
                                ? 'Oben'
                                : 'Unten'}
                        </button>
                      ))}
                    </div>
                  </div>
                  <label className="live-field">
                    <span>Größe · {reactionSizePercent}%</span>
                    <input
                      type="range"
                      min={15}
                      max={45}
                      value={reactionSizePercent}
                      onChange={(event) => setReactionSizePercent(numberValue(event.target.value, 28))}
                    />
                  </label>
                  <label className="live-field">
                    <span>Abstand · {reactionGap}px</span>
                    <input
                      type="range"
                      min={0}
                      max={80}
                      value={reactionGap}
                      onChange={(event) => setReactionGap(numberValue(event.target.value, 24))}
                    />
                  </label>
                  <label className="live-field">
                    <span>Rahmen-Design</span>
                    <select
                      value={reactionStyle}
                      onChange={(event) => setReactionStyle(event.target.value as typeof reactionStyle)}
                    >
                      <option value="neon">Neon Studio</option>
                      <option value="news">News Reaction</option>
                      <option value="glass">Glass</option>
                      <option value="clean">Clean</option>
                    </select>
                  </label>
                  <label className="live-field">
                    <span>Einfahranimation</span>
                    <select
                      value={reactionAnimation}
                      onChange={(event) => setReactionAnimation(event.target.value as typeof reactionAnimation)}
                    >
                      <option value="slide">Slide</option>
                      <option value="pop">Pop</option>
                      <option value="fade">Fade</option>
                      <option value="pulse">Pulse-Rahmen</option>
                    </select>
                  </label>
                  <label className="live-field">
                    <span>Show-Titel</span>
                    <input
                      value={reactionTitle}
                      maxLength={80}
                      onChange={(event) => setReactionTitle(event.target.value)}
                    />
                  </label>
                  <label className="live-field">
                    <span>Akzentfarbe</span>
                    <div className="live-color-field">
                      <input
                        type="color"
                        value={reactionAccentColor}
                        onChange={(event) => setReactionAccentColor(event.target.value)}
                      />
                      <code>{reactionAccentColor}</code>
                    </div>
                  </label>
                </div>

                <div className="live-dialog-actions">
                  {status?.settings.reaction_enabled && (
                    <button
                      disabled={Boolean(busy)}
                      onClick={() =>
                        run(
                          'reaction-deactivate',
                          () => api('/api/live/reaction/deactivate', { method: 'POST' }),
                          'Reaction-Modus beendet; vorheriges Live-Layout wiederhergestellt.',
                        )
                      }
                    >
                      <Square size={16} /> Reaction beenden
                    </button>
                  )}
                  <button disabled={Boolean(busy)} onClick={saveReactionSettings}>
                    <CheckCircle2 size={16} /> Preset speichern
                  </button>
                  <button
                    className="primary-button"
                    disabled={
                      Boolean(busy) ||
                      (reactionMode === 'ava'
                        ? !reactionYoutubeLibraryId
                        : !reactionYoutubeSourceId ||
                          selectedReactionYoutube?.youtubeReady !== true ||
                          reactionCameraSourceIds.length === 0)
                    }
                    onClick={activateReaction}
                  >
                    <Clapperboard size={16} />{' '}
                    {reactionMode === 'ava' ? 'AVA-Reaction jetzt starten' : 'Reaction jetzt ins Programm'}
                  </button>
                </div>
              </>
            )}

            {activeDialog === 'overlay' && (
              <>
                <div className="live-settings-grid">
                  <label className="live-field live-field-wide">
                    <span>Aktives Live-Studio-Overlay</span>
                    <select value={selectedOverlayId} onChange={(event) => setSelectedOverlayId(event.target.value)}>
                      <option value="">Standard-Overlay</option>
                      {(status?.overlays ?? []).map((overlay) => (
                        <option key={overlay.id} value={overlay.id}>
                          {overlay.name}
                        </option>
                      ))}
                    </select>
                  </label>
                </div>
                <div className="live-dialog-actions">
                  <button
                    disabled={Boolean(busy)}
                    onClick={() =>
                      run(
                        'overlay-toggle-modal',
                        () =>
                          api('/api/live/overlay/visibility', {
                            method: 'POST',
                            body: JSON.stringify({ visible: !status?.settings.overlay_visible }),
                          }),
                        status?.settings.overlay_visible ? 'Clean Feed aktiviert.' : 'Overlay eingeblendet.',
                      )
                    }
                  >
                    {status?.settings.overlay_visible ? <EyeOff size={16} /> : <Eye size={16} />}
                    {status?.settings.overlay_visible ? 'Clean Feed' : 'Overlay einblenden'}
                  </button>
                  <button
                    className="primary-button"
                    disabled={Boolean(busy) || !selectedOverlayId}
                    onClick={() =>
                      run(
                        'overlay-modal',
                        () =>
                          api('/api/live/overlay/apply', {
                            method: 'POST',
                            body: JSON.stringify({ projectId: selectedOverlayId, transition, durationMs }),
                          }),
                        'Overlay live gewechselt.',
                      )
                    }
                  >
                    <Layers3 size={16} /> Overlay anwenden
                  </button>
                </div>
              </>
            )}

            {activeDialog === 'chat' && (
              <>
                <label className="live-field">
                  <span>Chat-Popout- oder Embed-URL</span>
                  <input value={chatUrl} onChange={(event) => setChatUrl(event.target.value)} placeholder="https://…" />
                  <small>Die URL wird als transparente OBS-Browserquelle rechts im Live-Studio eingeblendet.</small>
                </label>
                <div className="live-dialog-actions">
                  <button
                    className="primary-button"
                    disabled={Boolean(busy)}
                    onClick={() =>
                      run(
                        'chat-modal-save',
                        () =>
                          api('/api/live/chat', {
                            method: 'POST',
                            body: JSON.stringify({ url: chatUrl, visible: Boolean(chatUrl) }),
                          }),
                        'Chat gespeichert und aktualisiert.',
                      )
                    }
                  >
                    <CheckCircle2 size={16} /> Speichern
                  </button>
                  <button
                    disabled={Boolean(busy) || !status?.chat.url}
                    onClick={() =>
                      run(
                        'chat-modal-toggle',
                        () =>
                          api('/api/live/chat', {
                            method: 'POST',
                            body: JSON.stringify({ visible: !status?.chat.visible }),
                          }),
                        status?.chat.visible ? 'Chat ausgeblendet.' : 'Chat eingeblendet.',
                      )
                    }
                  >
                    {status?.chat.visible ? <EyeOff size={16} /> : <Eye size={16} />}
                    {status?.chat.visible ? 'Ausblenden' : 'Einblenden'}
                  </button>
                </div>
              </>
            )}
          </div>
        </div>
      )}

      {stingerKind && stingerDraft && (
        <div
          className="modal-backdrop"
          onMouseDown={() => {
            setStingerKind(null);
            setStingerDraft(null);
          }}
        >
          <div
            className="modal-card live-settings-modal stinger-settings-modal"
            role="dialog"
            aria-modal="true"
            onMouseDown={(event) => event.stopPropagation()}
          >
            <div className="modal-header">
              <div>
                <p className="eyebrow">On-Air-Design</p>
                <h3>
                  <Wand2 size={19} /> {stingerLabels[stingerKind]} einstellen
                </h3>
              </div>
              <button
                className="icon-button"
                onClick={() => {
                  setStingerKind(null);
                  setStingerDraft(null);
                }}
                aria-label="Dialog schließen"
              >
                <X size={18} />
              </button>
            </div>
            <div className="stinger-editor-grid">
              <div className="live-settings-grid">
                <label className="live-field live-field-wide">
                  <span>Kurze Kennzeichnung</span>
                  <input
                    value={stingerDraft.kicker}
                    maxLength={40}
                    onChange={(event) => setStingerDraft({ ...stingerDraft, kicker: event.target.value })}
                  />
                </label>
                <label className="live-field live-field-wide">
                  <span>Hauptzeile</span>
                  <input
                    value={stingerDraft.title}
                    maxLength={100}
                    onChange={(event) => setStingerDraft({ ...stingerDraft, title: event.target.value })}
                  />
                </label>
                <label className="live-field live-field-wide">
                  <span>Unterzeile</span>
                  <input
                    value={stingerDraft.subtitle}
                    maxLength={180}
                    onChange={(event) => setStingerDraft({ ...stingerDraft, subtitle: event.target.value })}
                  />
                </label>
                <label className="live-field">
                  <span>Einblenddauer in ms</span>
                  <input
                    type="number"
                    min={250}
                    max={10000}
                    step={100}
                    value={stingerDraft.durationMs}
                    onChange={(event) =>
                      setStingerDraft({ ...stingerDraft, durationMs: numberValue(event.target.value, 2800) })
                    }
                  />
                </label>
                <label className="live-field">
                  <span>Animation</span>
                  <select
                    value={stingerDraft.animation}
                    onChange={(event) =>
                      setStingerDraft({ ...stingerDraft, animation: event.target.value as StingerAnimation })
                    }
                  >
                    <option value="sweep">Sweep</option>
                    <option value="zoom">Zoom</option>
                    <option value="pulse">Pulse</option>
                    <option value="glitch">News Glitch</option>
                  </select>
                </label>
                <label className="live-field">
                  <span>Akzentfarbe</span>
                  <div className="live-color-field">
                    <input
                      type="color"
                      value={stingerDraft.accentColor}
                      onChange={(event) => setStingerDraft({ ...stingerDraft, accentColor: event.target.value })}
                    />
                    <code>{stingerDraft.accentColor}</code>
                  </div>
                </label>
                <label className="live-field">
                  <span>Sound-Lautstärke · {stingerDraft.volume}%</span>
                  <input
                    type="range"
                    min={0}
                    max={100}
                    value={stingerDraft.volume}
                    disabled={!stingerDraft.soundEnabled}
                    onChange={(event) =>
                      setStingerDraft({ ...stingerDraft, volume: numberValue(event.target.value, 65) })
                    }
                  />
                </label>
                <div className="live-toggle-stack live-field-wide">
                  <label>
                    <input
                      type="checkbox"
                      checked={stingerDraft.enabled}
                      onChange={(event) => setStingerDraft({ ...stingerDraft, enabled: event.target.checked })}
                    />
                    <span>
                      <strong>Einblendung verwenden</strong>
                      <small>Deaktiviert überspringt die Umschaltung das Intro oder Outro.</small>
                    </span>
                  </label>
                  <label>
                    <input
                      type="checkbox"
                      checked={stingerDraft.soundEnabled}
                      onChange={(event) => setStingerDraft({ ...stingerDraft, soundEnabled: event.target.checked })}
                    />
                    <span>
                      <strong>Soundeffekt abspielen</strong>
                      <small>Audio wird über die OBS-Browserquelle ausgegeben.</small>
                    </span>
                  </label>
                </div>
              </div>
              <div
                className={`stinger-ui-preview animation-${stingerDraft.animation}`}
                style={{ '--stinger-accent': stingerDraft.accentColor } as React.CSSProperties}
              >
                <div className="stinger-preview-bars" />
                <div>
                  <span>{stingerDraft.kicker || 'LIVE'}</span>
                  <strong>{stingerDraft.title || 'Titel'}</strong>
                  <small>{stingerDraft.subtitle}</small>
                </div>
              </div>
            </div>
            <div className="live-dialog-actions">
              <button disabled={Boolean(busy)} onClick={() => saveStingerSettings(false)}>
                <CheckCircle2 size={16} /> Speichern
              </button>
              <button
                className="primary-button"
                disabled={Boolean(busy) || !stingerDraft.enabled}
                onClick={() => saveStingerSettings(true)}
              >
                <MonitorPlay size={16} /> Speichern & in OBS testen
              </button>
            </div>
          </div>
        </div>
      )}

      {youtubeDialog && (
        <div className="modal-backdrop" onMouseDown={() => setYoutubeDialog(false)}>
          <div
            className="modal-card live-settings-modal youtube-source-modal"
            role="dialog"
            aria-modal="true"
            onMouseDown={(event) => event.stopPropagation()}
          >
            <div className="modal-header">
              <div>
                <p className="eyebrow">Externe Live-Quelle</p>
                <h3>
                  <Video size={19} /> YouTube-Livestream hinzufügen
                </h3>
              </div>
              <button className="icon-button" onClick={() => setYoutubeDialog(false)} aria-label="Dialog schließen">
                <X size={18} />
              </button>
            </div>
            <div className="live-youtube-callout">
              <Zap size={22} />
              <div>
                <strong>Direkt als OBS-Browserquelle</strong>
                <p>
                  Video und Ton werden in der Live-Szene eingebunden. Stummschaltung, Vorschau, Take, PiP und
                  Quellenanimationen funktionieren wie bei einer Kameraquelle.
                </p>
              </div>
            </div>
            <label className="live-field">
              <span>YouTube-Video- oder Live-URL</span>
              <input
                autoFocus
                value={youtubeUrl}
                onChange={(event) => setYoutubeUrl(event.target.value)}
                placeholder="https://www.youtube.com/watch?v=…"
              />
              <small>
                Erforderlich ist die konkrete Watch-, Teilen- oder /live/Video-URL, nicht nur die Kanaladresse.
              </small>
            </label>
            <label className="live-field">
              <span>Anzeigename in der Regie (optional)</span>
              <input
                value={youtubeName}
                maxLength={100}
                onChange={(event) => setYoutubeName(event.target.value)}
                placeholder="z. B. Pressekonferenz Berlin"
              />
            </label>
            <div className="live-dialog-actions">
              <button onClick={() => setYoutubeDialog(false)}>Abbrechen</button>
              <button
                className="primary-button"
                disabled={Boolean(busy) || !youtubeUrl.trim()}
                onClick={addYoutubeSource}
              >
                <MonitorPlay size={16} /> In OBS hinzufügen
              </button>
            </div>
          </div>
        </div>
      )}
    </main>
  );
}
