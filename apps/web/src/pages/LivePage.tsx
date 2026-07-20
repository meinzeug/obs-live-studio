import React, { useEffect, useMemo, useRef, useState } from 'react';
import {
  Activity,
  AudioLines,
  ArrowDown,
  ArrowUp,
  CheckCircle2,
  Clapperboard,
  Clock3,
  ExternalLink,
  Eye,
  EyeOff,
  Grid3X3,
  Layers3,
  LayoutDashboard,
  Maximize2,
  Mic,
  MicOff,
  MonitorPlay,
  PictureInPicture2,
  RefreshCw,
  Radio,
  Send,
  Settings,
  SlidersHorizontal,
  SplitSquareHorizontal,
  Square,
  Trash2,
  Video,
  Volume2,
  VolumeX,
  Wand2,
  Wifi,
  X,
  Zap,
} from 'lucide-react';
import { api, can, isApiRateLimitError, type SessionUser } from '../api/client.js';

type LiveLayout = 'fullscreen' | 'split' | 'grid' | 'pip' | 'reaction';
type LiveTransition = 'cut' | 'fade' | 'swipe' | 'slide' | 'luma_wipe';
type LiveSourceTransition = 'cut' | 'fade' | 'slide' | 'zoom' | 'wipe';
type LiveSourceLabelStyle = 'lower-third' | 'badge' | 'minimal';
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
  | 'youtube-auth'
  | null;

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
  sourceType?: 'portal' | 'youtube';
  youtubeReady?: boolean;
  youtubeAuthPreparing?: boolean;
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
  const [status, setStatus] = useState<LiveStatus | null>(null);
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
  const [reactionCameraSourceIds, setReactionCameraSourceIds] = useState<string[]>([]);
  const [reactionPosition, setReactionPosition] = useState<'left' | 'right' | 'top' | 'bottom'>('right');
  const [reactionSizePercent, setReactionSizePercent] = useState(28);
  const [reactionGap, setReactionGap] = useState(24);
  const [reactionStyle, setReactionStyle] = useState<'neon' | 'news' | 'glass' | 'clean'>('neon');
  const [reactionAnimation, setReactionAnimation] = useState<'fade' | 'slide' | 'pop' | 'pulse'>('slide');
  const [reactionTitle, setReactionTitle] = useState('LIVE REACTION');
  const [reactionAccentColor, setReactionAccentColor] = useState('#d20a2e');
  const backoffUntil = useRef(0);
  const loadInFlight = useRef(false);
  const allowed = can(user, 'obs:write');

  async function load() {
    if (!allowed || loadInFlight.current || Date.now() < backoffUntil.current) return;
    loadInFlight.current = true;
    try {
      const next = await api<LiveStatus>('/api/live/status');
      setStatus(next);
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
      reactionYoutubeSourceId: reactionYoutubeSourceId || null,
      reactionCameraSourceIds,
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
            youtubeSourceId: reactionYoutubeSourceId || undefined,
            cameraSourceIds: reactionCameraSourceIds,
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

  function prepareYoutubeLogin(sourceId: string) {
    void run(
      `youtube-prepare-${sourceId}`,
      () => api(`/api/live/sources/${encodeURIComponent(sourceId)}/youtube-prepare`, { method: 'POST' }),
      'Die echte YouTube-Seite ist jetzt sicher und ausgeblendet in der OBS-Quelle geladen.',
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

  const sortedSources = useMemo(
    () => [...(status?.sources ?? [])].sort((a, b) => (a.obs?.index ?? 999) - (b.obs?.index ?? 999)),
    [status?.sources],
  );
  const visibleSources = sortedSources.filter((source) => source.obs && !source.obs.hidden);
  const youtubeSources = sortedSources.filter((source) => source.obs && source.sourceType === 'youtube');
  const youtubeAuthSource = youtubeSources.find((source) => source.id === youtubeAuthSourceId) ?? null;
  const selectedReactionYoutube = youtubeSources.find((source) => source.id === reactionYoutubeSourceId) ?? null;
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
  const activePortalSources = sortedSources.filter((source) => source.status === 'live').length;
  const obsSources = sortedSources.filter((source) => source.obs).length;

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
      <section className="live-controlbar">
        <div>
          <p className="eyebrow">Live-Regie</p>
          <h1>Live</h1>
          <p className="muted">
            Szene {status?.sceneName ?? '08_LIVE_STUDIO'} · Programm {currentProgramScene} · OBS{' '}
            {status?.obs.status ?? 'unbekannt'} · Portal{' '}
            {status?.portal.configured ? 'konfiguriert' : 'nicht konfiguriert'}
          </p>
        </div>
        <div className="live-actions">
          <button onClick={() => void load()} disabled={Boolean(busy)} title="Aktualisieren">
            <RefreshCw size={16} /> Aktualisieren
          </button>
          <button
            onClick={() =>
              run(
                'mode',
                () =>
                  api('/api/live/mode', {
                    method: 'POST',
                    body: JSON.stringify({ enabled: true, transition, durationMs }),
                  }),
                'Live-Modus in OBS aktiviert.',
              )
            }
            disabled={Boolean(busy)}
          >
            <MonitorPlay size={16} /> Live-Modus
          </button>
          <button
            onClick={() =>
              run(
                'preview-scene',
                () => api('/api/live/preview', { method: 'POST' }),
                'Live-Szene ist in der Vorschau.',
              )
            }
            disabled={Boolean(busy)}
          >
            <Eye size={16} /> In Vorschau
          </button>
          <button
            className="primary-button"
            onClick={() =>
              run(
                'take',
                () => api('/api/live/take', { method: 'POST', body: JSON.stringify({ transition, durationMs }) }),
                'Vorschau ins Programm übernommen.',
              )
            }
            disabled={Boolean(busy)}
          >
            <Send size={16} /> Take
          </button>
        </div>
      </section>

      {(message || error || status?.portal.error) && (
        <p className={`status-message ${error || status?.portal.error ? 'status-error' : 'status-ok'}`}>
          {error || status?.portal.error || message}
        </p>
      )}

      <section className="live-status-grid" aria-label="Live-Regie Status">
        <button
          className={`live-status-card ${status?.stream?.outputActive ? 'ok' : ''}`}
          onClick={() => setActiveDialog('stream')}
        >
          <Settings className="live-status-settings" size={15} />
          <span>Stream</span>
          <strong>{status?.stream?.outputActive ? 'On Air' : 'Aus'}</strong>
          <small>{status?.stream?.outputReconnecting ? 'Reconnect läuft' : 'OBS Streaming'}</small>
        </button>
        <button
          className={`live-status-card ${status?.settings.enabled ? 'ok' : ''}`}
          onClick={() => setActiveDialog('mode')}
        >
          <Settings className="live-status-settings" size={15} />
          <span>Live-Modus</span>
          <strong>{status?.settings.enabled ? 'Aktiv' : 'Standby'}</strong>
          <small>{status?.sceneName ?? '08_LIVE_STUDIO'}</small>
        </button>
        <button
          className={`live-status-card ${status?.settings.reaction_enabled ? 'ok reaction' : ''}`}
          onClick={() => setActiveDialog('reaction')}
        >
          <Settings className="live-status-settings" size={15} />
          <span>Reaction Show</span>
          <strong>{status?.settings.reaction_enabled ? 'On Air' : 'Bereit'}</strong>
          <small>
            {status?.settings.reaction_position ?? 'right'} · {status?.settings.reaction_size_percent ?? 28}%
          </small>
        </button>
        <button
          className={`live-status-card ${currentProgramScene === status?.sceneName ? 'ok' : ''}`}
          onClick={() => setActiveDialog('program')}
        >
          <Settings className="live-status-settings" size={15} />
          <span>Programm-Szene</span>
          <strong>{currentProgramScene === status?.sceneName ? 'Live' : 'Normal'}</strong>
          <small>{currentProgramScene}</small>
        </button>
        <button
          className={`live-status-card ${status?.autopilot?.enabled ? 'ok' : ''}`}
          onClick={() => setActiveDialog('autopilot')}
        >
          <Settings className="live-status-settings" size={15} />
          <span>Autopilot</span>
          <strong>{status?.autopilot?.enabled ? 'Ein' : 'Aus'}</strong>
          <small>{status?.playback?.status ? `Playback: ${status.playback.status}` : 'Kein Playback'}</small>
        </button>
        <button
          className={`live-status-card ${status?.portal.configured ? 'ok' : 'warn'}`}
          onClick={() => setActiveDialog('portal')}
        >
          <Settings className="live-status-settings" size={15} />
          <span>Portal</span>
          <strong>{activePortalSources} live</strong>
          <small>{status?.portal.baseUrl ?? 'nicht konfiguriert'}</small>
        </button>
        <button className="live-status-card" onClick={() => setActiveDialog('sources')}>
          <Settings className="live-status-settings" size={15} />
          <span>OBS-Quellen</span>
          <strong>{obsSources}</strong>
          <small>{visibleSources.length} sichtbar</small>
        </button>
        <button
          className={`live-status-card ${status?.settings.overlay_visible ? 'ok' : 'warn'}`}
          onClick={() => setActiveDialog('overlay')}
        >
          <Settings className="live-status-settings" size={15} />
          <span>Overlay</span>
          <strong>{status?.settings.overlay_visible ? 'sichtbar' : 'Clean Feed'}</strong>
          <small>{status?.overlays.length ?? 0} Live-Overlays</small>
        </button>
        <button
          className={`live-status-card ${status?.chat.visible ? 'ok' : ''}`}
          onClick={() => setActiveDialog('chat')}
        >
          <Settings className="live-status-settings" size={15} />
          <span>Chat</span>
          <strong>{status?.chat.visible ? 'sichtbar' : 'aus'}</strong>
          <small>{status?.chat.url ? 'URL gesetzt' : 'keine URL'}</small>
        </button>
      </section>

      <section className="live-director-actions">
        <div className="live-director-action-wrap">
          <button
            className="live-director-action live"
            disabled={Boolean(busy)}
            onClick={() =>
              run(
                'activate-live',
                () =>
                  api('/api/live/activate', {
                    method: 'POST',
                    body: JSON.stringify({ kind: 'live-now', transition, disableAutopilot: true }),
                  }),
                'Live-Modus mit Intro aktiviert.',
              )
            }
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
            onClick={() =>
              run(
                'breaking-stinger',
                () => api('/api/live/stinger', { method: 'POST', body: JSON.stringify({ kind: 'breaking-news' }) }),
                'Breaking-News-Stinger ausgespielt.',
              )
            }
          >
            <Wand2 size={24} />
            <span>
              <strong>Breaking News Teaser</strong>
              <small>Animierter Teaser mit Sound über OBS</small>
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
            onClick={() =>
              run(
                'return-program',
                () =>
                  api('/api/live/return-to-program', {
                    method: 'POST',
                    body: JSON.stringify({
                      enableAutopilot: true,
                      target: 'main-news',
                      transition,
                      stinger: 'back-to-program',
                    }),
                  }),
                'Zurück zum Autopilot-Programm geschaltet.',
              )
            }
          >
            <MonitorPlay size={24} />
            <span>
              <strong>Zurück zum Autopilot</strong>
              <small>Outro-Stinger, Hauptprogramm-Szene, Autopilot wieder an</small>
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
            onClick={() => setActiveDialog('reaction')}
          >
            <Clapperboard size={24} />
            <span>
              <strong>Reaction Show</strong>
              <small>YouTube groß, Live-Kameras animiert am Bildrand</small>
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
            className="live-director-action neutral"
            disabled={Boolean(busy)}
            onClick={() =>
              run(
                'return-maintenance',
                () =>
                  api('/api/live/return-to-program', {
                    method: 'POST',
                    body: JSON.stringify({
                      enableAutopilot: false,
                      target: 'maintenance',
                      transition,
                      stinger: 'back-to-program',
                    }),
                  }),
                'Zur Wartungs-/Bereitschaftsszene geschaltet.',
              )
            }
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
      </section>

      <section className="live-regie-grid">
        <div className="live-monitor-card preview">
          <div className="panel-heading">
            <h2>Vorschau</h2>
            <span className="state-pill">{previewSource ? previewSource.name : 'leer'}</span>
          </div>
          <div className="live-monitor-screen">{monitorTile(previewSource, 'Keine Quelle in Vorschau')}</div>
        </div>
        <div className="live-monitor-card program">
          <div className="panel-heading">
            <h2>Programm</h2>
            <span className={`state-pill ${status?.stream?.outputActive ? 'ok' : 'muted'}`}>
              {status?.stream?.outputActive ? 'Stream läuft' : 'Stream gestoppt'}
            </span>
          </div>
          <div
            className={`live-program-preview layout-${status?.settings.layout ?? 'grid'} reaction-${status?.settings.reaction_position ?? 'right'}`}
          >
            {compositionSources.length === 0
              ? monitorTile(null, 'Keine Quelle in OBS hinzugefügt')
              : compositionSources.slice(0, status?.settings.layout === 'fullscreen' ? 1 : 9).map((source) => (
                  <div className="live-tile" key={source.id}>
                    {source.previewUrl ? <img src={source.previewUrl} alt="" /> : <Video size={32} />}
                    <span>{source.name}</span>
                  </div>
                ))}
          </div>
        </div>
      </section>

      <section className="live-tools-grid">
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

      <section className="live-grid">
        <div className="live-program-panel">
          <div className="panel-heading">
            <h2>Streaming</h2>
            <span className={`state-pill ${status?.stream?.outputActive ? 'ok' : 'muted'}`}>
              {status?.stream?.outputActive ? 'aktiv' : 'aus'}
            </span>
          </div>
          <div className="live-stream-row">
            <button
              className="primary-button"
              disabled={Boolean(busy) || Boolean(status?.stream?.outputActive)}
              onClick={() =>
                run('stream-start', () => api('/api/live/stream/start', { method: 'POST' }), 'Stream gestartet.')
              }
            >
              <Radio size={16} /> Streaming starten
            </button>
            <button
              disabled={Boolean(busy) || !status?.stream?.outputActive}
              onClick={() =>
                run('stream-stop', () => api('/api/live/stream/stop', { method: 'POST' }), 'Stream gestoppt.')
              }
            >
              <Square size={16} /> Streaming stoppen
            </button>
          </div>
        </div>

        <div className="live-source-list">
          <div className="panel-heading">
            <div>
              <h2>Quellen</h2>
              <small className="muted">
                {sortedSources.length} verfügbar · {obsSources} in OBS
              </small>
            </div>
            <div className="live-heading-actions">
              <button onClick={() => setYoutubeDialog(true)} disabled={Boolean(busy)}>
                <Video size={15} /> YouTube-Live
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
                title="Zuschauer-Tokens erneuern und Quellen neu verbinden"
              >
                <RefreshCw size={15} /> Neu verbinden
              </button>
              <button
                className="icon-button"
                onClick={() => setActiveDialog('sources')}
                title="Quellenwechsel einstellen"
              >
                <Settings size={16} />
              </button>
            </div>
          </div>
          <div className="live-source-toolbar">
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
              <Volume2 size={15} /> Alle hörbar
            </button>
            <span className="muted">
              {sourceAutoLayout ? 'Auto-Layout aktiv' : `Manuelles ${status?.settings.layout ?? 'Raster'}`} ·{' '}
              {sourceTransition} {sourceDurationMs} ms
            </span>
          </div>
          {sortedSources.length === 0 ? (
            <p className="muted">Keine aktiven Portal-Quellen gefunden.</p>
          ) : (
            sortedSources.map((source, index) => (
              <article
                className={`live-source-card ${source.id === status?.settings.preview_source_id ? 'is-preview' : ''}`}
                key={source.id}
              >
                <div className="live-source-preview">
                  {source.previewUrl ? <img src={source.previewUrl} alt="" /> : <Video size={28} />}
                  <span className={`live-dot ${source.status}`}>{statusLabel(source)}</span>
                </div>
                <div className="live-source-body">
                  <div>
                    <h3>{source.name}</h3>
                    <p className="muted">
                      {source.sourceType === 'youtube' ? 'YouTube-Livestream' : source.user || 'Unbekannter Benutzer'}
                    </p>
                  </div>
                  <div className="live-source-meta">
                    <span>
                      <LayoutDashboard size={14} /> {source.resolution || 'keine Auflösung'}
                    </span>
                    <span>
                      <Mic size={14} /> {Math.round((source.audioLevel ?? 0) * 100)}%
                    </span>
                    <span>
                      <Wifi size={14} /> {source.network || 'unbekannt'}
                    </span>
                  </div>
                  {source.sourceType === 'youtube' && (
                    <div className={`youtube-source-readiness ${source.youtubeReady ? 'ready' : 'warning'}`}>
                      {source.youtubeReady ? <CheckCircle2 size={16} /> : <EyeOff size={16} />}
                      <span>
                        <strong>
                          {source.youtubeReady ? 'Für Sendung freigegeben' : 'Vor Zuschaueransicht geschützt'}
                        </strong>
                        <small>
                          {source.youtubeReady
                            ? 'OBS-Anmeldung wurde durch die Regie bestätigt.'
                            : 'Die Quelle bleibt ausgeblendet, bis der YouTube-Login in OBS geprüft wurde.'}
                        </small>
                      </span>
                      <button
                        onClick={() => {
                          setYoutubeAuthSourceId(source.id);
                          setActiveDialog('youtube-auth');
                        }}
                      >
                        {source.youtubeReady ? 'Prüfstatus' : 'Anmeldung vorbereiten'}
                      </button>
                    </div>
                  )}
                  <div className="live-source-actions">
                    {source.obs ? (
                      <>
                        <button
                          disabled={index === 0}
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
                          title="Nach oben"
                        >
                          <ArrowUp size={16} />
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
                          title="Nach unten"
                        >
                          <ArrowDown size={16} />
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
                              source.obs!.muted ? 'Quelle hörbar.' : 'Quelle stummgeschaltet.',
                            )
                          }
                          title={source.obs!.muted ? 'Ton einschalten' : 'Stummschalten'}
                        >
                          {source.obs!.muted ? <MicOff size={16} /> : <Mic size={16} />}
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
                              source.obs!.hidden ? 'Quelle eingeblendet.' : 'Quelle ausgeblendet.',
                            )
                          }
                          title={source.obs!.hidden ? 'Einblenden' : 'Ausblenden'}
                        >
                          {source.obs!.hidden ? <EyeOff size={16} /> : <Eye size={16} />}
                        </button>
                        <button
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
                          Vorschau
                        </button>
                        <button
                          className="primary-button"
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
                          Take
                        </button>
                        <button
                          onClick={() =>
                            run(
                              `remove-${source.id}`,
                              () => api(`/api/live/sources/${encodeURIComponent(source.id)}`, { method: 'DELETE' }),
                              'Quelle aus OBS entfernt.',
                            )
                          }
                          title="Aus OBS entfernen"
                        >
                          <Trash2 size={16} />
                        </button>
                      </>
                    ) : (
                      <button
                        className="primary-button"
                        disabled={source.status !== 'live' || Boolean(busy)}
                        onClick={() =>
                          run(
                            `add-${source.id}`,
                            () => api(`/api/live/sources/${encodeURIComponent(source.id)}/add`, { method: 'POST' }),
                            'Quelle in OBS hinzugefügt.',
                          )
                        }
                      >
                        <MonitorPlay size={16} /> In OBS
                      </button>
                    )}
                  </div>
                </div>
              </article>
            ))
          )}
        </div>
      </section>

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
                      'youtube-auth': 'YouTube in OBS anmelden',
                      overlay: 'Live-Overlay',
                      chat: 'Live-Chat',
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

            {activeDialog === 'mode' && (
              <>
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
                    <strong>{status?.settings.stinger_settings?.['live-now']?.durationMs ?? 3200} ms</strong>
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
                            body: JSON.stringify({ kind: 'live-now', transition, disableAutopilot: true }),
                          }),
                        'Live-Modus mit Intro aktiviert.',
                      )
                    }
                  >
                    <Radio size={16} /> Jetzt Live aktivieren
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
                    onClick={() =>
                      run(
                        'return-autopilot-modal',
                        () =>
                          api('/api/live/return-to-program', {
                            method: 'POST',
                            body: JSON.stringify({
                              enableAutopilot: true,
                              target: 'main-news',
                              transition,
                              stinger: 'back-to-program',
                            }),
                          }),
                        'Autopilot und Sprecher-Audio wieder aktiviert.',
                      )
                    }
                  >
                    <MonitorPlay size={16} /> Zum Autopilot zurück
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
                            ? 'Quelle ist für die Sendung freigegeben'
                            : youtubeAuthSource.youtubeAuthPreparing
                              ? 'Anmeldeseite ist in OBS geladen'
                              : 'Quelle ist sicher ausgeblendet'}
                        </strong>
                        <p>
                          {youtubeAuthSource.youtubeReady
                            ? 'Wenn YouTube erneut eine Anmeldung verlangt, nimm die Freigabe zurück und prüfe die Quelle erneut.'
                            : youtubeAuthSource.youtubeAuthPreparing
                              ? 'Öffne jetzt das OBS-Interaktionsfenster. Der Login ist auf dieser obersten YouTube-Seite anklickbar.'
                              : 'Die Bot-/Login-Meldung kann in diesem Zustand nicht im Programm erscheinen.'}
                        </p>
                      </div>
                    </div>
                    {!youtubeAuthSource.youtubeReady && (
                      <button
                        className="youtube-auth-prepare-button"
                        disabled={Boolean(busy)}
                        onClick={() => prepareYoutubeLogin(youtubeAuthSource.id)}
                      >
                        <ExternalLink size={16} />
                        {youtubeAuthSource.youtubeAuthPreparing
                          ? 'YouTube-Anmeldeseite in OBS neu laden'
                          : '1. YouTube-Anmeldeseite in OBS laden'}
                      </button>
                    )}
                    <ol>
                      <li>Zuerst über den Button oben die echte YouTube-Seite in die ausgeblendete Quelle laden.</li>
                      <li>
                        In OBS die Szene <code>08_LIVE_STUDIO</code> öffnen.
                      </li>
                      <li>
                        Die Quelle <code>{youtubeAuthSource.obs?.inputName}</code> rechtsklicken und{' '}
                        <strong>Interagieren</strong> wählen.
                      </li>
                      <li>Bei YouTube anmelden und prüfen, ob das Video mit Ton startet.</li>
                      <li>Erst danach hier die Quelle für Vorschau und Programm freigeben.</li>
                    </ol>
                    <p className="muted">
                      Der Login bleibt ausschließlich im lokalen OBS-Browserprofil. Das Studio speichert weder
                      Google-Passwort noch YouTube-Cookies.
                    </p>
                    <div className="live-dialog-actions">
                      {youtubeAuthSource.youtubeReady ? (
                        <button disabled={Boolean(busy)} onClick={() => setYoutubeReady(youtubeAuthSource.id, false)}>
                          <EyeOff size={16} /> Freigabe zurücknehmen
                        </button>
                      ) : (
                        <button
                          className="primary-button"
                          disabled={Boolean(busy) || !youtubeAuthSource.youtubeAuthPreparing}
                          onClick={() => setYoutubeReady(youtubeAuthSource.id, true)}
                        >
                          <CheckCircle2 size={16} /> In OBS geprüft – freigeben
                        </button>
                      )}
                    </div>
                  </div>
                ) : (
                  <p className="muted">Wähle zuerst eine YouTube-Quelle aus der Quellenliste.</p>
                )}
              </>
            )}

            {activeDialog === 'reaction' && (
              <>
                <div className="reaction-regie-grid">
                  <div
                    className={`reaction-ui-preview position-${reactionPosition} style-${reactionStyle}`}
                    style={
                      {
                        '--reaction-accent': reactionAccentColor,
                        '--reaction-size': `${reactionSizePercent}%`,
                        '--reaction-gap': `${Math.max(6, Math.round(reactionGap / 2))}px`,
                      } as React.CSSProperties
                    }
                  >
                    <div className="reaction-preview-video">
                      {youtubeSources.find((source) => source.id === reactionYoutubeSourceId)?.previewUrl ? (
                        <img
                          src={youtubeSources.find((source) => source.id === reactionYoutubeSourceId)!.previewUrl!}
                          alt=""
                        />
                      ) : (
                        <Video size={40} />
                      )}
                      <span>YouTube · Hauptvideo</span>
                    </div>
                    <strong className="reaction-preview-title">{reactionTitle || 'LIVE REACTION'}</strong>
                    <div className={`reaction-preview-rail animation-${reactionAnimation}`}>
                      {reactionCameraSourceIds.length === 0 ? (
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
                    {youtubeSources.length === 0 && (
                      <button
                        onClick={() => {
                          setActiveDialog(null);
                          setYoutubeDialog(true);
                        }}
                      >
                        <Video size={16} /> Erst YouTube-Live hinzufügen
                      </button>
                    )}
                    {selectedReactionYoutube && !selectedReactionYoutube.youtubeReady && (
                      <div className="youtube-reaction-warning">
                        <EyeOff size={18} />
                        <span>
                          <strong>YouTube-Anmeldung noch nicht geprüft</strong>
                          <small>Die Quelle bleibt gesperrt, damit keine Login-Meldung auf Sendung geht.</small>
                        </span>
                        <button
                          onClick={() => {
                            setYoutubeAuthSourceId(selectedReactionYoutube.id);
                            setActiveDialog('youtube-auth');
                          }}
                        >
                          Jetzt vorbereiten
                        </button>
                      </div>
                    )}
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
                  </div>
                </div>

                <div className="reaction-design-settings">
                  <div className="live-field reaction-position-field">
                    <span>Position der Reaction-Kameras</span>
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
                      !reactionYoutubeSourceId ||
                      selectedReactionYoutube?.youtubeReady !== true ||
                      reactionCameraSourceIds.length === 0
                    }
                    onClick={activateReaction}
                  >
                    <Clapperboard size={16} /> Reaction jetzt ins Programm
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
