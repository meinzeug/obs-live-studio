import React, { useEffect, useMemo, useRef, useState } from 'react';
import {
  AlertTriangle,
  Check,
  ChevronRight,
  CirclePlus,
  Clapperboard,
  Clock3,
  Copy,
  Download,
  Film,
  FolderOpen,
  GripVertical,
  HardDrive,
  Image,
  ImagePlay,
  Layers3,
  LoaderCircle,
  Maximize2,
  MousePointer2,
  MoveHorizontal,
  Music2,
  Pause,
  Play,
  Plus,
  Redo2,
  RotateCcw,
  Save,
  Scissors,
  Search,
  SlidersHorizontal,
  Sparkles,
  Split,
  Trash2,
  Type,
  Upload,
  Video,
  Volume2,
  WandSparkles,
  X,
} from 'lucide-react';
import { api, can, type SessionUser } from '../api/client.js';
import { ErrorBox, Loading } from '../components/Status.js';
import {
  rippleTimedLayers,
  rollTimelineCut,
  slipTimelineClip,
  snapTimelineTime,
  splitTimelineClip,
  timelineClipStart,
  timelineCutPoints,
  trimTimelineClip,
} from '../video-editor-timeline.js';

type AspectRatio = '16:9' | '9:16' | '1:1';
type Quality = '720p' | '1080p' | '1440p';
type DownloadQuality = 'best' | Quality;
type Transition =
  | 'cut'
  | 'fade'
  | 'dissolve'
  | 'fadeblack'
  | 'wipeleft'
  | 'wiperight'
  | 'slideleft'
  | 'slideright'
  | 'smoothleft'
  | 'smoothright'
  | 'circleopen'
  | 'pixelize';
type Clip = {
  id: string;
  sourceId: string;
  name: string;
  sourceStart: number;
  duration: number;
  volume: number;
  fit: 'contain' | 'cover';
  transition: Transition;
  transitionDuration: number;
  effect: 'none' | 'cinematic' | 'warm' | 'cool' | 'monochrome' | 'high-contrast' | 'soft' | 'sharpen';
  effectIntensity: number;
  motion: 'none' | 'zoom-in' | 'zoom-out' | 'pan-left' | 'pan-right';
};
type AudioTrack = {
  id: string;
  sourceId: string;
  name: string;
  startAt: number;
  sourceStart: number;
  duration: number;
  volume: number;
  fadeIn: number;
  fadeOut: number;
  muted: boolean;
};
type TextTrack = {
  id: string;
  text: string;
  startAt: number;
  duration: number;
  x: number;
  y: number;
  width: number;
  fontFamily: 'dejavu-sans' | 'ibm-plex-sans' | 'ibm-plex-condensed' | 'liberation-sans';
  fontSize: number;
  fontWeight: 'regular' | 'semibold' | 'bold';
  color: string;
  backgroundColor: string;
  backgroundOpacity: number;
  opacity: number;
  outlineColor: string;
  outlineWidth: number;
  shadowColor: string;
  shadowX: number;
  shadowY: number;
  align: 'left' | 'center' | 'right';
  animation: 'none' | 'fade' | 'rise' | 'slide-left' | 'slide-right';
};
type ImageTrack = {
  id: string;
  sourceId: string;
  name: string;
  startAt: number;
  duration: number;
  x: number;
  y: number;
  width: number;
  height: number;
  opacity: number;
  rotation: number;
  fit: 'contain' | 'cover';
  animation: 'none' | 'fade' | 'rise' | 'slide-left' | 'slide-right';
};
type EditorDocument = {
  version: 1;
  canvas: { aspectRatio: AspectRatio; backgroundColor: string; fps: 25 | 30 | 50 | 60 };
  clips: Clip[];
  audioTracks: AudioTrack[];
  textTracks: TextTrack[];
  imageTracks: ImageTrack[];
};
type Project = {
  id: string;
  name: string;
  description: string | null;
  document: EditorDocument;
  revision: number;
  status: 'draft' | 'queued' | 'rendering' | 'ready' | 'failed';
  duration_seconds: number;
  last_error: string | null;
  source_count?: number;
  render_count?: number;
  ready_render_count?: number;
  updated_at: string;
};
type EditorSource = {
  id: string;
  source_kind: 'youtube-url' | 'youtube-library' | 'media';
  youtube_video_id: string | null;
  title: string;
  channel_title: string | null;
  media_type: 'video' | 'audio' | 'image';
  duration_seconds: number;
  status: 'remote' | 'queued' | 'downloading' | 'ready' | 'error' | 'cancelled';
  error: string | null;
  download_progress: number;
  download_quality: 'best' | Quality | 'audio';
  download_mode: 'video' | 'audio';
  downloaded_size_bytes: number | null;
  download_metadata: Record<string, unknown>;
  fileUrl: string | null;
  thumbnailUrl: string | null;
  embedUrl: string | null;
};
type EditorRender = {
  id: string;
  quality: Quality;
  status: 'queued' | 'rendering' | 'ready' | 'failed' | 'cancelled';
  progress: number;
  size_bytes: number | null;
  duration_seconds: number | null;
  width: number | null;
  height: number | null;
  error: string | null;
  attempts: number;
  created_at: string;
  videoUrl: string | null;
  downloadUrl: string | null;
  thumbnailUrl: string | null;
};
type ProjectDetail = { project: Project; sources: EditorSource[]; renders: EditorRender[] };
type YoutubeLibraryItem = {
  id: string;
  title: string;
  channelTitle: string;
  durationSeconds: number;
  thumbnailUrl: string;
  categoryName: string | null;
};
type MediaLibraryItem = {
  id: string;
  filename: string;
  mime_type: string;
  duration_seconds: number;
  kind: 'video' | 'audio' | 'image';
  fileUrl: string;
  thumbnailUrl: string | null;
};
type Dashboard = {
  projects: Project[];
  library: { youtube: YoutubeLibraryItem[]; media: MediaLibraryItem[] };
  capabilities: {
    qualities: Quality[];
    downloadQualities: DownloadQuality[];
    downloadModes: Array<'video' | 'audio'>;
    formats: AspectRatio[];
    maxProjectSeconds: number;
    maxDownloadBytes: number;
    ytDlp: boolean;
    ffmpeg: boolean;
  };
};
type LayerSelection = { kind: 'clip' | 'audio' | 'text' | 'image'; id: string } | null;
type EditorTool = 'select' | 'razor' | 'ripple' | 'roll' | 'slip';

const statusLabels: Record<Project['status'], string> = {
  draft: 'Entwurf',
  queued: 'Warteschlange',
  rendering: 'Rendert',
  ready: 'Export bereit',
  failed: 'Fehler',
};
const renderStatusLabels: Record<EditorRender['status'], string> = {
  queued: 'Eingeplant',
  rendering: 'Wird gerendert',
  ready: 'Fertig',
  failed: 'Fehlgeschlagen',
  cancelled: 'Abgebrochen',
};

function uid(prefix: string) {
  return `${prefix}-${globalThis.crypto?.randomUUID?.() ?? `${Date.now()}-${Math.random().toString(16).slice(2)}`}`;
}

function duration(document: EditorDocument) {
  return timelineCutPoints(document.clips).at(-1) ?? 0;
}

function timecode(seconds: number, frames = false) {
  const value = Math.max(0, Number(seconds) || 0);
  const hours = Math.floor(value / 3600);
  const minutes = Math.floor((value % 3600) / 60);
  const wholeSeconds = Math.floor(value % 60);
  const base = `${hours ? `${String(hours).padStart(2, '0')}:` : ''}${String(minutes).padStart(2, '0')}:${String(wholeSeconds).padStart(2, '0')}`;
  return frames ? `${base}.${String(Math.floor((value % 1) * 100)).padStart(2, '0')}` : base;
}

function bytes(value: number | null) {
  if (!value) return '–';
  if (value >= 1024 ** 3) return `${(value / 1024 ** 3).toFixed(1)} GB`;
  return `${(value / 1024 ** 2).toFixed(1)} MB`;
}

function date(value: string) {
  return new Date(value).toLocaleString('de-DE', { dateStyle: 'medium', timeStyle: 'short' });
}

function bounded(value: string | number, min: number, max: number) {
  const number = Number(value);
  return Number.isFinite(number) ? Math.max(min, Math.min(max, number)) : min;
}

function cloneDocument(document: EditorDocument) {
  return structuredClone(document);
}

function activeClipAt(document: EditorDocument, playhead: number) {
  for (let index = document.clips.length - 1; index >= 0; index -= 1) {
    const clip = document.clips[index]!;
    const start = timelineClipStart(document.clips, clip.id) ?? 0;
    if (playhead >= start - 0.001 && playhead <= start + clip.duration + 0.001)
      return { clip, start, local: Math.max(0, playhead - start) };
  }
  return null;
}

function sourceResolution(source: EditorSource) {
  const width = Number(source.download_metadata?.width);
  const height = Number(source.download_metadata?.height);
  return width > 0 && height > 0 ? `${width}×${height}` : null;
}

function effectPreview(effect: Clip['effect'], intensity: number) {
  const strength = Math.max(0, Math.min(1, intensity));
  if (effect === 'warm') return `sepia(${strength * 0.3}) saturate(${1 + strength * 0.15})`;
  if (effect === 'cool') return `hue-rotate(${strength * 12}deg) saturate(${1 + strength * 0.08})`;
  if (effect === 'monochrome') return `grayscale(${strength})`;
  if (effect === 'high-contrast') return `contrast(${1 + strength * 0.35})`;
  if (effect === 'soft') return `blur(${strength * 1.6}px)`;
  if (effect === 'cinematic') return `contrast(${1 + strength * 0.16}) saturate(${1 - strength * 0.12})`;
  return 'none';
}

function colorWithAlpha(color: string, alpha: number) {
  const channel = Math.round(Math.max(0, Math.min(1, alpha)) * 255)
    .toString(16)
    .padStart(2, '0');
  return `${color}${channel}`;
}

function Field({ label, children, hint }: { label: string; children: React.ReactNode; hint?: string }) {
  return (
    <label className="video-editor-field">
      <span>{label}</span>
      {children}
      {hint && <small>{hint}</small>}
    </label>
  );
}

export function YoutubeVideoEditorPage({ user }: { user: SessionUser }) {
  const [dashboard, setDashboard] = useState<Dashboard | null>(null);
  const [selectedProjectId, setSelectedProjectId] = useState('');
  const [detail, setDetail] = useState<ProjectDetail | null>(null);
  const [loading, setLoading] = useState(true);
  const [working, setWorking] = useState('');
  const [error, setError] = useState('');
  const [message, setMessage] = useState('');
  const [dirty, setDirty] = useState(false);
  const [selection, setSelection] = useState<LayerSelection>(null);
  const [playhead, setPlayhead] = useState(0);
  const [playing, setPlaying] = useState(false);
  const [zoom, setZoom] = useState(5);
  const [projectSearch, setProjectSearch] = useState('');
  const [sourceSearch, setSourceSearch] = useState('');
  const [dialog, setDialog] = useState<'create' | 'import' | 'render' | null>(null);
  const [projectDraft, setProjectDraft] = useState({ name: '', description: '', aspectRatio: '16:9' as AspectRatio });
  const [urlDraft, setUrlDraft] = useState('');
  const [libraryTab, setLibraryTab] = useState<'youtube' | 'media'>('youtube');
  const [librarySearch, setLibrarySearch] = useState('');
  const [librarySelection, setLibrarySelection] = useState<Set<string>>(new Set());
  const [downloadQuality, setDownloadQuality] = useState<DownloadQuality>('1080p');
  const [downloadMode, setDownloadMode] = useState<'video' | 'audio'>('video');
  const [qualities, setQualities] = useState<Set<Quality>>(new Set(['1080p']));
  const [tool, setTool] = useState<EditorTool>('select');
  const [snapping, setSnapping] = useState(true);
  const [historyTick, setHistoryTick] = useState(0);
  const uploadRef = useRef<HTMLInputElement>(null);
  const previewVideoRef = useRef<HTMLVideoElement>(null);
  const previewCanvasRef = useRef<HTMLDivElement>(null);
  const timelineRef = useRef<HTMLDivElement>(null);
  const undoRef = useRef<EditorDocument[]>([]);
  const redoRef = useRef<EditorDocument[]>([]);
  const writeAllowed = can(user, 'broadcast:write');
  const document = detail?.project.document ?? null;
  const projectDuration = document ? duration(document) : 0;

  async function loadProject(projectId: string, preserveDraft = false) {
    const next = await api<ProjectDetail>(`/api/youtube-video-editor/projects/${projectId}`);
    setDetail((current) => {
      if (!preserveDraft || !current || current.project.id !== projectId || !dirty) return next;
      return {
        ...next,
        project: {
          ...next.project,
          document: current.project.document,
          name: current.project.name,
          description: current.project.description,
          duration_seconds: duration(current.project.document),
        },
      };
    });
    return next;
  }

  async function loadDashboard(preferredProjectId?: string) {
    const next = await api<Dashboard>('/api/youtube-video-editor');
    setDashboard(next);
    const current = preferredProjectId || selectedProjectId;
    const target = next.projects.some((project) => project.id === current) ? current : next.projects[0]?.id || '';
    setSelectedProjectId(target);
    if (target) await loadProject(target);
    else setDetail(null);
    return next;
  }

  useEffect(() => {
    void loadDashboard()
      .catch((requestError) => setError(requestError instanceof Error ? requestError.message : String(requestError)))
      .finally(() => setLoading(false));
  }, []);

  useEffect(() => {
    if (
      !detail?.renders.some((render) => render.status === 'queued' || render.status === 'rendering') &&
      !detail?.sources.some((source) => source.status === 'queued' || source.status === 'downloading')
    )
      return;
    const timer = window.setInterval(() => {
      void loadProject(detail.project.id, true).catch(() => undefined);
    }, 1_500);
    return () => window.clearInterval(timer);
  }, [
    detail?.project.id,
    detail?.renders.map((render) => `${render.id}:${render.status}:${render.progress}`).join('|'),
    detail?.sources.map((source) => `${source.id}:${source.status}:${source.download_progress}`).join('|'),
  ]);

  useEffect(() => {
    if (!playing || projectDuration <= 0) return;
    const started = performance.now();
    const initial = playhead;
    const timer = window.setInterval(() => {
      const next = initial + (performance.now() - started) / 1000;
      if (next >= projectDuration) {
        setPlayhead(projectDuration);
        setPlaying(false);
      } else setPlayhead(next);
    }, 100);
    return () => window.clearInterval(timer);
  }, [playing, projectDuration]);

  useEffect(() => {
    setPlayhead((value) => Math.min(value, Math.max(0, projectDuration)));
  }, [projectDuration]);

  const active = useMemo(() => (document ? activeClipAt(document, playhead) : null), [document, playhead]);
  const activeSource = detail?.sources.find((source) => source.id === active?.clip.sourceId) ?? null;
  const visibleTexts = document?.textTracks.filter(
    (track) => playhead >= track.startAt && playhead <= track.startAt + track.duration,
  );
  const visibleImages = document?.imageTracks.filter(
    (track) => playhead >= track.startAt && playhead <= track.startAt + track.duration,
  );

  useEffect(() => {
    const video = previewVideoRef.current;
    if (!video || !active || !activeSource?.fileUrl) return;
    const expected = active.clip.sourceStart + Math.max(0, active.local);
    if (Number.isFinite(video.duration) && Math.abs(video.currentTime - expected) > 0.65) video.currentTime = expected;
    video.volume = Math.min(1, active.clip.volume);
    video.muted = active.clip.volume <= 0;
    if (playing) void video.play().catch(() => undefined);
    else video.pause();
  }, [active?.clip.id, active?.local, activeSource?.fileUrl, playing]);

  useEffect(() => {
    const handleKey = (event: KeyboardEvent) => {
      const target = event.target as HTMLElement | null;
      if (target?.matches('input,textarea,select,[contenteditable=true]')) return;
      const key = event.key.toLowerCase();
      if ((event.ctrlKey || event.metaKey) && key === 'z') {
        event.preventDefault();
        if (event.shiftKey) redo();
        else undo();
      } else if ((event.ctrlKey || event.metaKey) && key === 's') {
        event.preventDefault();
        void saveProject();
      } else if (event.code === 'Space' && projectDuration > 0) {
        event.preventDefault();
        setPlaying((value) => !value);
      } else if (event.key === 'ArrowLeft' || event.key === 'ArrowRight') {
        event.preventDefault();
        const step = event.shiftKey ? 1 : 1 / (document?.canvas.fps ?? 30);
        setPlayhead((value) => bounded(value + (event.key === 'ArrowRight' ? step : -step), 0, projectDuration));
      } else if (key === 'v') setTool('select');
      else if (key === 'c') setTool('razor');
      else if (key === 'b') setTool('ripple');
      else if (key === 'r') setTool('roll');
      else if (key === 'y') setTool('slip');
      else if (key === 'n') setSnapping((value) => !value);
      else if (key === 's') splitAtPlayhead();
      else if ((event.key === 'Delete' || event.key === 'Backspace') && selection) {
        event.preventDefault();
        removeLayer(selection);
      }
    };
    window.addEventListener('keydown', handleKey);
    return () => window.removeEventListener('keydown', handleKey);
  });

  function pushHistory(value: EditorDocument) {
    undoRef.current = [...undoRef.current, cloneDocument(value)].slice(-80);
    redoRef.current = [];
    setHistoryTick((value) => value + 1);
  }

  function applyDocument(next: EditorDocument, record = true) {
    if (!detail) return;
    if (record) pushHistory(detail.project.document);
    setDetail({ ...detail, project: { ...detail.project, document: next, duration_seconds: duration(next) } });
    setDirty(true);
  }

  function mutateDocument(update: (next: EditorDocument) => void) {
    if (!detail) return;
    const next = cloneDocument(detail.project.document);
    update(next);
    pushHistory(detail.project.document);
    setDirty(true);
    setDetail({ ...detail, project: { ...detail.project, document: next, duration_seconds: duration(next) } });
  }

  function undo() {
    const previous = undoRef.current.pop();
    if (!previous || !detail) return;
    redoRef.current.push(cloneDocument(detail.project.document));
    applyDocument(previous, false);
    setHistoryTick((value) => value + 1);
  }

  function redo() {
    const next = redoRef.current.pop();
    if (!next || !detail) return;
    undoRef.current.push(cloneDocument(detail.project.document));
    applyDocument(next, false);
    setHistoryTick((value) => value + 1);
  }

  function updateProject(values: Partial<Pick<Project, 'name' | 'description'>>) {
    if (!detail) return;
    setDetail({ ...detail, project: { ...detail.project, ...values } });
    setDirty(true);
  }

  async function saveProject() {
    if (!detail || !dirty) return true;
    setWorking('save');
    setError('');
    try {
      const project = await api<Project>(`/api/youtube-video-editor/projects/${detail.project.id}`, {
        method: 'PATCH',
        body: JSON.stringify({
          name: detail.project.name,
          description: detail.project.description,
          document: detail.project.document,
          expectedRevision: detail.project.revision,
        }),
      });
      setDetail({ ...detail, project });
      setDirty(false);
      setMessage('Projekt gespeichert.');
      const next = await api<Dashboard>('/api/youtube-video-editor');
      setDashboard(next);
      return true;
    } catch (requestError) {
      setError(requestError instanceof Error ? requestError.message : String(requestError));
      return false;
    } finally {
      setWorking('');
    }
  }

  async function selectProject(id: string) {
    if (id === selectedProjectId) return;
    if (dirty && !window.confirm('Ungespeicherte Änderungen verwerfen und Projekt wechseln?')) return;
    setWorking('project');
    setError('');
    try {
      setSelectedProjectId(id);
      await loadProject(id);
      setDirty(false);
      setSelection(null);
      setPlayhead(0);
      setPlaying(false);
      undoRef.current = [];
      redoRef.current = [];
      setHistoryTick((value) => value + 1);
    } catch (requestError) {
      setError(requestError instanceof Error ? requestError.message : String(requestError));
    } finally {
      setWorking('');
    }
  }

  async function createProject() {
    setWorking('create');
    setError('');
    try {
      const project = await api<Project>('/api/youtube-video-editor/projects', {
        method: 'POST',
        body: JSON.stringify({
          name: projectDraft.name,
          description: projectDraft.description || null,
          aspectRatio: projectDraft.aspectRatio,
        }),
      });
      setDialog(null);
      setProjectDraft({ name: '', description: '', aspectRatio: '16:9' });
      setDirty(false);
      await loadDashboard(project.id);
      undoRef.current = [];
      redoRef.current = [];
      setHistoryTick((value) => value + 1);
      setMessage('Neues Video-Projekt angelegt.');
    } catch (requestError) {
      setError(requestError instanceof Error ? requestError.message : String(requestError));
    } finally {
      setWorking('');
    }
  }

  async function duplicateProject() {
    if (!detail) return;
    setWorking('duplicate');
    try {
      const project = await api<Project>(`/api/youtube-video-editor/projects/${detail.project.id}/duplicate`, {
        method: 'POST',
      });
      setDirty(false);
      await loadDashboard(project.id);
      setMessage('Projekt inklusive Quellen und Timeline dupliziert.');
    } catch (requestError) {
      setError(requestError instanceof Error ? requestError.message : String(requestError));
    } finally {
      setWorking('');
    }
  }

  async function deleteProject() {
    if (!detail || !window.confirm(`Projekt „${detail.project.name}“ samt Exporten wirklich löschen?`)) return;
    setWorking('delete-project');
    try {
      await api(`/api/youtube-video-editor/projects/${detail.project.id}`, { method: 'DELETE' });
      setDirty(false);
      setSelectedProjectId('');
      await loadDashboard();
      setMessage('Projekt gelöscht.');
    } catch (requestError) {
      setError(requestError instanceof Error ? requestError.message : String(requestError));
    } finally {
      setWorking('');
    }
  }

  async function reloadAfterSourceChange() {
    if (!detail) return;
    const next = await api<ProjectDetail>(`/api/youtube-video-editor/projects/${detail.project.id}`);
    setDetail(
      dirty
        ? {
            ...next,
            project: {
              ...next.project,
              name: detail.project.name,
              description: detail.project.description,
              document: detail.project.document,
              duration_seconds: duration(detail.project.document),
            },
          }
        : next,
    );
    const dashboardNext = await api<Dashboard>('/api/youtube-video-editor');
    setDashboard(dashboardNext);
  }

  async function importUrls() {
    if (!detail) return;
    const urls = [
      ...new Set(
        urlDraft
          .split(/[\n,]+/)
          .map((value) => value.trim())
          .filter(Boolean),
      ),
    ];
    setWorking('import-url');
    setError('');
    try {
      const result = await api<{ imported: number; failed: number }>(
        `/api/youtube-video-editor/projects/${detail.project.id}/sources/youtube`,
        {
          method: 'POST',
          body: JSON.stringify({ urls, quality: downloadQuality, audioOnly: downloadMode === 'audio' }),
        },
      );
      await reloadAfterSourceChange();
      setUrlDraft('');
      setDialog(null);
      setMessage(
        `${result.imported} YouTube-Quelle${result.imported === 1 ? '' : 'n'} übernommen. Der lokale ${downloadMode === 'audio' ? 'Audio-' : ''}Download läuft im Hintergrund${result.failed ? `; ${result.failed} Link${result.failed === 1 ? '' : 's'} nicht erkannt` : ''}.`,
      );
    } catch (requestError) {
      setError(requestError instanceof Error ? requestError.message : String(requestError));
    } finally {
      setWorking('');
    }
  }

  async function importLibrary() {
    if (!detail || !librarySelection.size) return;
    const youtubeIds = libraryTab === 'youtube' ? [...librarySelection] : [];
    const mediaIds = libraryTab === 'media' ? [...librarySelection] : [];
    setWorking('import-library');
    setError('');
    try {
      const result = await api<{ imported: number }>(
        `/api/youtube-video-editor/projects/${detail.project.id}/sources/library`,
        {
          method: 'POST',
          body: JSON.stringify({
            youtubeVideoIds: youtubeIds,
            mediaAssetIds: mediaIds,
            quality: downloadQuality,
            audioOnly: libraryTab === 'youtube' && downloadMode === 'audio',
          }),
        },
      );
      await reloadAfterSourceChange();
      setLibrarySelection(new Set());
      setDialog(null);
      setMessage(`${result.imported} Mediathek-Datei${result.imported === 1 ? '' : 'en'} übernommen.`);
    } catch (requestError) {
      setError(requestError instanceof Error ? requestError.message : String(requestError));
    } finally {
      setWorking('');
    }
  }

  async function uploadSource(file: File) {
    if (!detail) return;
    const body = new FormData();
    body.set('file', file);
    setWorking('upload');
    setError('');
    try {
      await api(`/api/youtube-video-editor/projects/${detail.project.id}/sources/upload`, { method: 'POST', body });
      await reloadAfterSourceChange();
      setMessage(`„${file.name}“ wurde in die Produktion übernommen.`);
    } catch (requestError) {
      setError(requestError instanceof Error ? requestError.message : String(requestError));
    } finally {
      setWorking('');
      if (uploadRef.current) uploadRef.current.value = '';
    }
  }

  function addSourceToTimeline(source: EditorSource) {
    if (source.status !== 'ready') {
      setError(
        source.status === 'error'
          ? `„${source.title}“ konnte noch nicht lokal geladen werden. Starte den Download erneut.`
          : `„${source.title}“ wird zuerst lokal geladen (${source.download_progress} %).`,
      );
      return;
    }
    if (source.media_type === 'audio') {
      if (!document || projectDuration < 0.25) {
        setError('Lege zuerst mindestens einen Videoclip an, damit die Audiospur eine Timeline besitzt.');
        return;
      }
      const id = uid('audio');
      mutateDocument((next) =>
        next.audioTracks.push({
          id,
          sourceId: source.id,
          name: source.title,
          startAt: 0,
          sourceStart: 0,
          duration: Math.min(Number(source.duration_seconds), duration(next)),
          volume: 0.7,
          fadeIn: 0,
          fadeOut: 0,
          muted: false,
        }),
      );
      setSelection({ kind: 'audio', id });
      return;
    }
    if (source.media_type === 'image') {
      if (!document || projectDuration < 0.25) {
        setError('Lege zuerst mindestens einen Videoclip an, damit die Grafik eine Timeline besitzt.');
        return;
      }
      const id = uid('image');
      mutateDocument((next) =>
        next.imageTracks.push({
          id,
          sourceId: source.id,
          name: source.title,
          startAt: Math.min(playhead, Math.max(0, duration(next) - 0.25)),
          duration: Math.min(8, Math.max(0.25, duration(next) - playhead)),
          x: 700,
          y: 70,
          width: 240,
          height: 240,
          opacity: 1,
          rotation: 0,
          fit: 'contain',
          animation: 'fade',
        }),
      );
      setSelection({ kind: 'image', id });
      return;
    }
    const id = uid('clip');
    mutateDocument((next) =>
      next.clips.push({
        id,
        sourceId: source.id,
        name: source.title,
        sourceStart: 0,
        duration: Math.min(Number(source.duration_seconds), 21_600 - duration(next)),
        volume: 1,
        fit: 'cover',
        transition: next.clips.length ? 'dissolve' : 'cut',
        transitionDuration: 0.45,
        effect: 'none',
        effectIntensity: 0.6,
        motion: 'none',
      }),
    );
    setSelection({ kind: 'clip', id });
  }

  function addText() {
    if (!document || projectDuration < 0.25) {
      setError('Lege zuerst mindestens einen Videoclip an.');
      return;
    }
    const id = uid('text');
    mutateDocument((next) =>
      next.textTracks.push({
        id,
        text: 'Dein Text',
        startAt: Math.min(playhead, Math.max(0, duration(next) - 0.25)),
        duration: Math.min(5, Math.max(0.25, duration(next) - playhead)),
        x: 500,
        y: 850,
        width: 820,
        fontFamily: 'ibm-plex-sans',
        fontSize: 54,
        fontWeight: 'bold',
        color: '#ffffff',
        backgroundColor: '#050810',
        backgroundOpacity: 0.78,
        opacity: 1,
        outlineColor: '#000000',
        outlineWidth: 0,
        shadowColor: '#000000',
        shadowX: 0,
        shadowY: 3,
        align: 'center',
        animation: 'fade',
      }),
    );
    setSelection({ kind: 'text', id });
  }

  function removeLayer(selected: NonNullable<LayerSelection>) {
    mutateDocument((next) => {
      if (selected.kind === 'clip') next.clips = next.clips.filter((item) => item.id !== selected.id);
      if (selected.kind === 'audio') next.audioTracks = next.audioTracks.filter((item) => item.id !== selected.id);
      if (selected.kind === 'text') next.textTracks = next.textTracks.filter((item) => item.id !== selected.id);
      if (selected.kind === 'image') next.imageTracks = next.imageTracks.filter((item) => item.id !== selected.id);
    });
    setSelection(null);
    setPlayhead((value) => Math.min(value, Math.max(0, projectDuration)));
  }

  async function removeSource(source: EditorSource) {
    if (!detail || !window.confirm(`Quelle „${source.title}“ aus diesem Projekt entfernen?`)) return;
    setWorking(`source-${source.id}`);
    try {
      await api(`/api/youtube-video-editor/projects/${detail.project.id}/sources/${source.id}`, { method: 'DELETE' });
      await reloadAfterSourceChange();
    } catch (requestError) {
      setError(requestError instanceof Error ? requestError.message : String(requestError));
    } finally {
      setWorking('');
    }
  }

  async function retrySourceDownload(source: EditorSource) {
    setWorking(`download-${source.id}`);
    setError('');
    try {
      await api(`/api/youtube-video-editor/sources/${source.id}/download`, {
        method: 'POST',
        body: JSON.stringify({
          quality: source.download_quality === 'audio' ? downloadQuality : source.download_quality,
          audioOnly: source.download_mode === 'audio',
        }),
      });
      if (detail) await loadProject(detail.project.id, true);
      setMessage(`Download von „${source.title}“ wurde neu eingeplant.`);
    } catch (requestError) {
      setError(requestError instanceof Error ? requestError.message : String(requestError));
    } finally {
      setWorking('');
    }
  }

  async function cancelSourceDownload(source: EditorSource) {
    setWorking(`download-cancel-${source.id}`);
    setError('');
    try {
      await api(`/api/youtube-video-editor/sources/${source.id}/cancel-download`, { method: 'POST' });
      if (detail) await loadProject(detail.project.id, true);
      setMessage(`Download von „${source.title}“ wird sicher abgebrochen.`);
    } catch (requestError) {
      setError(requestError instanceof Error ? requestError.message : String(requestError));
    } finally {
      setWorking('');
    }
  }

  async function deleteLocalSourceFile(source: EditorSource) {
    if (!window.confirm(`Lokale Download-Datei von „${source.title}“ löschen? Die Quelle bleibt im Projekt.`)) return;
    setWorking(`download-delete-${source.id}`);
    try {
      await api(`/api/youtube-video-editor/sources/${source.id}/local-file`, { method: 'DELETE' });
      if (detail) await loadProject(detail.project.id, true);
      setMessage('Lokale Originaldatei gelöscht. Sie kann jederzeit erneut geladen werden.');
    } catch (requestError) {
      setError(requestError instanceof Error ? requestError.message : String(requestError));
    } finally {
      setWorking('');
    }
  }

  function setGestureDocument(next: EditorDocument) {
    setDetail((current) =>
      current
        ? { ...current, project: { ...current.project, document: next, duration_seconds: duration(next) } }
        : current,
    );
    setDirty(true);
  }

  function finishGesture(base: EditorDocument, latest: EditorDocument) {
    if (JSON.stringify(base) === JSON.stringify(latest)) return;
    pushHistory(base);
  }

  function splitClip(clipId: string, offsetSeconds: number) {
    if (!document) return;
    const result = splitTimelineClip({
      clips: document.clips,
      clipId,
      offsetSeconds,
      newClipId: uid('clip'),
    });
    if (!result.split) {
      setError('Der Schnitt muss mindestens 0,25 Sekunden von beiden Clip-Enden entfernt liegen.');
      return;
    }
    mutateDocument((next) => {
      next.clips = result.clips;
    });
    const created = result.clips[document.clips.findIndex((clip) => clip.id === clipId) + 1];
    if (created) setSelection({ kind: 'clip', id: created.id });
  }

  function splitAtPlayhead() {
    if (!active) return;
    splitClip(active.clip.id, playhead - active.start);
  }

  function beginClipGesture(
    event: React.PointerEvent<HTMLElement>,
    clip: Clip,
    action: 'trim-start' | 'trim-end' | 'slip' | 'roll',
  ) {
    if (!document || !writeAllowed) return;
    event.preventDefault();
    event.stopPropagation();
    setSelection({ kind: 'clip', id: clip.id });
    const base = cloneDocument(document);
    const startX = event.clientX;
    const source = detail?.sources.find((item) => item.id === clip.sourceId);
    const sourceDuration = Number(source?.duration_seconds ?? clip.sourceStart + clip.duration);
    const oldProjectDuration = duration(base);
    const oldStart = timelineClipStart(base.clips, clip.id) ?? 0;
    const oldEnd = oldStart + clip.duration;
    let latest = base;
    const onMove = (moveEvent: PointerEvent) => {
      let delta = (moveEvent.clientX - startX) / Math.max(1, zoom);
      if (snapping && action !== 'slip' && action !== 'roll') {
        const proposed = action === 'trim-start' ? oldEnd - delta : oldEnd + delta;
        const targets = [...timelineCutPoints(base.clips), playhead].filter(
          (target) => Math.abs(target - oldEnd) > 0.001,
        );
        const snapped = snapTimelineTime(proposed, targets, 8 / Math.max(1, zoom), base.canvas.fps);
        delta = action === 'trim-start' ? oldEnd - snapped : snapped - oldEnd;
      }
      const next = cloneDocument(base);
      if (action === 'trim-start' || action === 'trim-end') {
        const result = trimTimelineClip({
          clips: base.clips,
          clipId: clip.id,
          edge: action === 'trim-start' ? 'start' : 'end',
          deltaSeconds: delta,
          sourceDuration,
        });
        next.clips = result.clips;
        if (tool === 'ripple') {
          const timelineDelta = duration(next) - oldProjectDuration;
          next.textTracks = rippleTimedLayers(base.textTracks, oldEnd, timelineDelta);
          next.imageTracks = rippleTimedLayers(base.imageTracks, oldEnd, timelineDelta);
          next.audioTracks = rippleTimedLayers(base.audioTracks, oldEnd, timelineDelta);
        }
      } else if (action === 'slip') {
        next.clips = slipTimelineClip({
          clips: base.clips,
          clipId: clip.id,
          deltaSeconds: delta,
          sourceDuration,
        }).clips;
      } else {
        next.clips = rollTimelineCut({
          clips: base.clips,
          leftClipId: clip.id,
          deltaSeconds: delta,
          leftSourceDuration: sourceDuration,
        }).clips;
      }
      latest = next;
      setGestureDocument(next);
    };
    const onUp = () => {
      window.removeEventListener('pointermove', onMove);
      window.removeEventListener('pointerup', onUp);
      finishGesture(base, latest);
    };
    window.addEventListener('pointermove', onMove);
    window.addEventListener('pointerup', onUp, { once: true });
  }

  function beginVisualGesture(
    event: React.PointerEvent<HTMLElement>,
    selected: Exclude<LayerSelection, null> & { kind: 'text' | 'image' },
    mode: 'move' | 'resize',
  ) {
    if (!document || !writeAllowed) return;
    const stage = previewCanvasRef.current;
    if (!stage) return;
    event.preventDefault();
    event.stopPropagation();
    setSelection(selected);
    const base = cloneDocument(document);
    const rect = stage.getBoundingClientRect();
    const startX = event.clientX;
    const startY = event.clientY;
    let latest = base;
    const onMove = (moveEvent: PointerEvent) => {
      const deltaX = ((moveEvent.clientX - startX) / Math.max(1, rect.width)) * 1_000;
      const deltaY = ((moveEvent.clientY - startY) / Math.max(1, rect.height)) * 1_000;
      const next = cloneDocument(base);
      if (selected.kind === 'text') {
        const track = next.textTracks.find((item) => item.id === selected.id);
        const original = base.textTracks.find((item) => item.id === selected.id);
        if (track && original) {
          if (mode === 'move') {
            track.x = bounded(original.x + deltaX, 0, 1_000);
            track.y = bounded(original.y + deltaY, 0, 1_000);
          } else {
            track.width = bounded(original.width + deltaX, 80, 1_000);
            track.fontSize = Math.round(bounded(original.fontSize + deltaY * 0.15, 16, 180));
          }
        }
      } else {
        const track = next.imageTracks.find((item) => item.id === selected.id);
        const original = base.imageTracks.find((item) => item.id === selected.id);
        if (track && original) {
          if (mode === 'move') {
            track.x = bounded(original.x + deltaX, 0, 1_000);
            track.y = bounded(original.y + deltaY, 0, 1_000);
          } else {
            track.width = bounded(original.width + deltaX, 20, 1_000);
            track.height = bounded(original.height + deltaY, 20, 1_000);
          }
        }
      }
      latest = next;
      setGestureDocument(next);
    };
    const onUp = () => {
      window.removeEventListener('pointermove', onMove);
      window.removeEventListener('pointerup', onUp);
      finishGesture(base, latest);
    };
    window.addEventListener('pointermove', onMove);
    window.addEventListener('pointerup', onUp, { once: true });
  }

  function reorderClip(sourceId: string, targetId: string) {
    if (sourceId === targetId) return;
    mutateDocument((next) => {
      const sourceIndex = next.clips.findIndex((clip) => clip.id === sourceId);
      const targetIndex = next.clips.findIndex((clip) => clip.id === targetId);
      if (sourceIndex < 0 || targetIndex < 0) return;
      const [clip] = next.clips.splice(sourceIndex, 1);
      next.clips.splice(targetIndex, 0, clip!);
    });
  }

  function seekTimeline(event: React.MouseEvent<HTMLDivElement>) {
    if (!projectDuration) return;
    const rect = event.currentTarget.getBoundingClientRect();
    const position = (event.clientX - rect.left + event.currentTarget.scrollLeft - 77) / Math.max(1, zoom);
    setPlayhead(bounded(position, 0, projectDuration));
  }

  async function queueRender() {
    if (!detail || !qualities.size) return;
    if (!(await saveProject())) return;
    setWorking('render');
    setError('');
    try {
      await api(`/api/youtube-video-editor/projects/${detail.project.id}/render`, {
        method: 'POST',
        body: JSON.stringify({ qualities: [...qualities] }),
      });
      await loadProject(detail.project.id);
      setDialog(null);
      setMessage('Renderauftrag wurde an den lokalen Worker übergeben.');
    } catch (requestError) {
      setError(requestError instanceof Error ? requestError.message : String(requestError));
    } finally {
      setWorking('');
    }
  }

  async function renderAction(render: EditorRender, action: 'retry' | 'cancel') {
    setWorking(`render-${render.id}`);
    try {
      await api(`/api/youtube-video-editor/renders/${render.id}/${action}`, { method: 'POST' });
      if (detail) await loadProject(detail.project.id, true);
    } catch (requestError) {
      setError(requestError instanceof Error ? requestError.message : String(requestError));
    } finally {
      setWorking('');
    }
  }

  const selectedLayer = useMemo(() => {
    if (!selection || !document) return null;
    if (selection.kind === 'clip') return document.clips.find((item) => item.id === selection.id) ?? null;
    if (selection.kind === 'audio') return document.audioTracks.find((item) => item.id === selection.id) ?? null;
    if (selection.kind === 'text') return document.textTracks.find((item) => item.id === selection.id) ?? null;
    return document.imageTracks.find((item) => item.id === selection.id) ?? null;
  }, [selection, document]);
  const filteredProjects = dashboard?.projects.filter((project) =>
    `${project.name} ${project.description ?? ''}`
      .toLocaleLowerCase('de-DE')
      .includes(projectSearch.toLocaleLowerCase('de-DE')),
  );
  const filteredSources = detail?.sources.filter((source) =>
    `${source.title} ${source.channel_title ?? ''}`
      .toLocaleLowerCase('de-DE')
      .includes(sourceSearch.toLocaleLowerCase('de-DE')),
  );
  const libraryItems = libraryTab === 'youtube' ? (dashboard?.library.youtube ?? []) : (dashboard?.library.media ?? []);
  const filteredLibrary = libraryItems.filter((item) =>
    ('title' in item ? `${item.title} ${item.channelTitle}` : item.filename)
      .toLocaleLowerCase('de-DE')
      .includes(librarySearch.toLocaleLowerCase('de-DE')),
  );

  if (loading) return <Loading label="Video-Studio wird vorbereitet …" />;
  if (!dashboard) return <ErrorBox message={error || 'Der Video-Editor konnte nicht geladen werden.'} />;

  return (
    <main className="youtube-video-editor-page">
      <header className="video-editor-hero">
        <div>
          <p className="eyebrow">SHORTS & CLIPS · POSTPRODUKTION</p>
          <h2>
            <Clapperboard size={31} /> YouTube Video Studio
          </h2>
          <p>Mehrere Quellen schneiden, Ton und Typografie gestalten und lokal als sendefertige MP4 exportieren.</p>
        </div>
        <div className="page-actions">
          <button className="ghost-button" onClick={() => setDialog('import')} disabled={!detail || !writeAllowed}>
            <FolderOpen size={17} /> Quellen
          </button>
          <button onClick={() => uploadRef.current?.click()} disabled={!detail || !writeAllowed || Boolean(working)}>
            <Upload size={17} /> Datei hochladen
          </button>
          <input
            ref={uploadRef}
            type="file"
            hidden
            accept="video/mp4,video/webm,video/quicktime,audio/mpeg,audio/mp4,audio/wav,audio/ogg,audio/webm,image/png,image/jpeg,image/webp"
            onChange={(event) => event.target.files?.[0] && void uploadSource(event.target.files[0])}
          />
          <button
            className="primary-button"
            onClick={() => void saveProject()}
            disabled={!dirty || !writeAllowed || Boolean(working)}
          >
            {working === 'save' ? <LoaderCircle className="spin" size={17} /> : <Save size={17} />} Speichern
          </button>
          <button
            className="video-editor-export-button"
            onClick={() => setDialog('render')}
            disabled={!document?.clips.length || !writeAllowed}
          >
            <Sparkles size={17} /> Exportieren
          </button>
        </div>
      </header>

      {(error || message) && (
        <div className={`video-editor-toast ${error ? 'error' : 'success'}`} role={error ? 'alert' : 'status'}>
          {error ? <AlertTriangle size={18} /> : <Check size={18} />}
          <span>{error || message}</span>
          <button
            className="icon-button ghost-button"
            aria-label="Meldung schließen"
            onClick={() => {
              setError('');
              setMessage('');
            }}
          >
            <X size={16} />
          </button>
        </div>
      )}

      <section className="video-editor-shell">
        <aside className="video-editor-projects">
          <div className="video-editor-panel-title">
            <div>
              <Layers3 size={17} />
              <strong>Projekte</strong>
            </div>
            <button
              className="icon-button"
              aria-label="Neues Projekt"
              onClick={() => setDialog('create')}
              disabled={!writeAllowed}
            >
              <Plus size={17} />
            </button>
          </div>
          <label className="video-editor-search">
            <Search size={15} />
            <input
              value={projectSearch}
              onChange={(event) => setProjectSearch(event.target.value)}
              placeholder="Projekte suchen"
            />
          </label>
          <div className="video-editor-project-list">
            {filteredProjects?.map((project) => (
              <button
                key={project.id}
                className={project.id === selectedProjectId ? 'active' : ''}
                onClick={() => void selectProject(project.id)}
              >
                <span className={`video-editor-status-dot ${project.status}`} />
                <span>
                  <strong>{project.name}</strong>
                  <small>
                    {timecode(Number(project.duration_seconds))} · {statusLabels[project.status]}
                  </small>
                </span>
                <ChevronRight size={15} />
              </button>
            ))}
            {!filteredProjects?.length && (
              <div className="video-editor-empty compact">
                <Film size={22} />
                <span>Noch kein Projekt</span>
              </div>
            )}
          </div>
          <button className="video-editor-new-project" onClick={() => setDialog('create')} disabled={!writeAllowed}>
            <CirclePlus size={17} /> Neues Video-Projekt
          </button>
        </aside>

        {!detail || !document ? (
          <section className="video-editor-welcome">
            <div>
              <ImagePlay size={52} />
              <p className="eyebrow">NEUE PRODUKTION</p>
              <h3>Aus Quellen wird ein fertiges Video</h3>
              <p>
                Lege ein Projekt an, importiere mehrere YouTube-Links oder Medien und arrangiere alles auf der Timeline.
              </p>
              <button className="primary-button" onClick={() => setDialog('create')}>
                <Plus size={18} /> Erstes Projekt anlegen
              </button>
            </div>
          </section>
        ) : (
          <div className="video-editor-workspace">
            <section className="video-editor-project-bar">
              <div className="video-editor-title-fields">
                <input
                  aria-label="Projektname"
                  value={detail.project.name}
                  onChange={(event) => updateProject({ name: event.target.value })}
                  disabled={!writeAllowed}
                />
                <input
                  aria-label="Projektbeschreibung"
                  value={detail.project.description ?? ''}
                  onChange={(event) => updateProject({ description: event.target.value || null })}
                  placeholder="Kurze Beschreibung der Produktion"
                  disabled={!writeAllowed}
                />
              </div>
              <div className="video-editor-project-meta">
                <span className={dirty ? 'dirty' : ''}>
                  {dirty ? 'Ungespeichert' : `Revision ${detail.project.revision}`}
                </span>
                <span>
                  <Clock3 size={14} /> {timecode(projectDuration, true)}
                </span>
                <button
                  className="icon-button ghost-button"
                  title="Projekt duplizieren"
                  onClick={() => void duplicateProject()}
                  disabled={!writeAllowed}
                >
                  <Copy size={16} />
                </button>
                <button
                  className="icon-button ghost-button"
                  title="Projekt löschen"
                  onClick={() => void deleteProject()}
                  disabled={!writeAllowed}
                >
                  <Trash2 size={16} />
                </button>
              </div>
            </section>

            <div className="video-editor-upper-grid">
              <section className="video-editor-source-bin">
                <div className="video-editor-panel-title">
                  <div>
                    <FolderOpen size={17} />
                    <strong>Quellen</strong>
                    <span>{detail.sources.length}</span>
                  </div>
                  <button className="icon-button" onClick={() => setDialog('import')} title="Quellen importieren">
                    <Plus size={16} />
                  </button>
                </div>
                <label className="video-editor-search">
                  <Search size={15} />
                  <input
                    value={sourceSearch}
                    onChange={(event) => setSourceSearch(event.target.value)}
                    placeholder="Quellen filtern"
                  />
                </label>
                <div className="video-editor-source-list">
                  {filteredSources?.map((source) => (
                    <article key={source.id}>
                      <div className="video-editor-source-thumb">
                        {source.thumbnailUrl ? (
                          <img src={source.thumbnailUrl} alt="" />
                        ) : source.media_type === 'audio' ? (
                          <Music2 />
                        ) : source.media_type === 'image' ? (
                          <Image />
                        ) : (
                          <Video />
                        )}
                        <span>
                          {source.media_type === 'audio'
                            ? 'AUDIO'
                            : source.media_type === 'image'
                              ? 'BILD'
                              : source.source_kind.startsWith('youtube')
                                ? 'YT'
                                : 'VIDEO'}
                        </span>
                      </div>
                      <div>
                        <strong title={source.title}>{source.title}</strong>
                        <small>
                          {source.channel_title || 'Eigene Mediathek'} · {timecode(Number(source.duration_seconds))}
                        </small>
                        {source.source_kind !== 'media' && (
                          <small className={`video-editor-source-status ${source.status}`}>
                            {source.status === 'ready'
                              ? `Lokal · ${sourceResolution(source) || source.download_quality} · ${bytes(Number(source.downloaded_size_bytes))}`
                              : source.status === 'downloading'
                                ? `Download ${source.download_progress} %`
                                : source.status === 'queued'
                                  ? 'Download wartet'
                                  : source.status === 'error' || source.status === 'cancelled'
                                    ? source.error || 'Download fehlgeschlagen'
                                    : 'Nur als Link vorhanden'}
                          </small>
                        )}
                        {(source.status === 'queued' || source.status === 'downloading') && (
                          <div className="video-editor-progress source-progress">
                            <i style={{ width: `${source.download_progress}%` }} />
                            <span>{source.download_progress}%</span>
                          </div>
                        )}
                      </div>
                      <div className="video-editor-source-actions">
                        <button
                          className="icon-button"
                          title="Zur Timeline"
                          onClick={() => addSourceToTimeline(source)}
                          disabled={!writeAllowed || source.status !== 'ready'}
                        >
                          <Plus size={15} />
                        </button>
                        {source.source_kind !== 'media' && source.status === 'ready' && source.fileUrl && (
                          <a
                            className="icon-button ghost-button"
                            title="Lokale Originaldatei öffnen"
                            href={source.fileUrl}
                          >
                            <HardDrive size={14} />
                          </a>
                        )}
                        {source.source_kind !== 'media' &&
                          (source.status === 'error' ||
                            source.status === 'cancelled' ||
                            source.status === 'remote') && (
                            <button
                              className="icon-button ghost-button"
                              title="Download erneut starten"
                              onClick={() => void retrySourceDownload(source)}
                              disabled={!writeAllowed || Boolean(working)}
                            >
                              <RotateCcw size={14} />
                            </button>
                          )}
                        {source.source_kind !== 'media' &&
                          (source.status === 'queued' || source.status === 'downloading') && (
                            <button
                              className="icon-button ghost-button"
                              title="Download abbrechen"
                              onClick={() => void cancelSourceDownload(source)}
                              disabled={!writeAllowed || Boolean(working)}
                            >
                              <X size={14} />
                            </button>
                          )}
                        {source.source_kind !== 'media' && source.status === 'ready' && (
                          <button
                            className="icon-button ghost-button"
                            title="Lokale Originaldatei löschen"
                            onClick={() => void deleteLocalSourceFile(source)}
                            disabled={!writeAllowed || Boolean(working)}
                          >
                            <Trash2 size={14} />
                          </button>
                        )}
                        <button
                          className="icon-button ghost-button"
                          title="Quelle entfernen"
                          onClick={() => void removeSource(source)}
                          disabled={!writeAllowed}
                        >
                          <Trash2 size={14} />
                        </button>
                      </div>
                    </article>
                  ))}
                  {!filteredSources?.length && (
                    <div className="video-editor-empty compact">
                      <FolderOpen size={22} />
                      <span>YouTube-Links oder Medien hinzufügen</span>
                    </div>
                  )}
                </div>
              </section>

              <section className="video-editor-preview-panel">
                <div className="video-editor-preview-toolbar">
                  <span>
                    <span className="preview-led" /> PROGRAMMVORSCHAU
                  </span>
                  <span>
                    {document.canvas.aspectRatio} · {document.canvas.fps} FPS
                  </span>
                  <button
                    className="icon-button ghost-button"
                    title="Vorschau vergrößern"
                    onClick={() =>
                      globalThis.document.querySelector<HTMLDivElement>('.video-editor-canvas')?.requestFullscreen?.()
                    }
                  >
                    <Maximize2 size={15} />
                  </button>
                </div>
                <div
                  ref={previewCanvasRef}
                  className={`video-editor-canvas ratio-${document.canvas.aspectRatio.replace(':', '-')}`}
                  style={{ backgroundColor: document.canvas.backgroundColor }}
                >
                  {active && activeSource?.fileUrl ? (
                    <video
                      ref={previewVideoRef}
                      key={active.clip.id}
                      src={activeSource.fileUrl}
                      playsInline
                      muted={active.clip.volume === 0}
                      className={`motion-${active.clip.motion} transition-${active.clip.transition}`}
                      style={{
                        objectFit: active.clip.fit,
                        filter: effectPreview(active.clip.effect, active.clip.effectIntensity),
                      }}
                    />
                  ) : active && activeSource ? (
                    <div className="video-editor-preview-empty download-state">
                      {activeSource.thumbnailUrl ? <img src={activeSource.thumbnailUrl} alt="" /> : <LoaderCircle />}
                      <strong>
                        {activeSource.status === 'error' || activeSource.status === 'cancelled'
                          ? 'Lokaler Download fehlgeschlagen'
                          : 'Quelle wird lokal geladen'}
                      </strong>
                      <span>
                        {activeSource.status === 'error' || activeSource.status === 'cancelled'
                          ? activeSource.error
                          : `${activeSource.download_progress} % · Danach steht der echte Editor-Player bereit.`}
                      </span>
                    </div>
                  ) : (
                    <div className="video-editor-preview-empty">
                      <Clapperboard size={44} />
                      <strong>Timeline ist noch leer</strong>
                      <span>Ziehe Quellen in die Videospur.</span>
                    </div>
                  )}
                  {visibleImages?.map((track) => {
                    const source = detail.sources.find((item) => item.id === track.sourceId);
                    if (!source?.fileUrl && !source?.thumbnailUrl) return null;
                    const selected = selection?.kind === 'image' && selection.id === track.id;
                    return (
                      <div
                        key={track.id}
                        className={`video-editor-preview-image animation-${track.animation}${selected ? ' selected' : ''}`}
                        style={{
                          left: `${track.x / 10}%`,
                          top: `${track.y / 10}%`,
                          width: `${track.width / 10}%`,
                          height: `${track.height / 10}%`,
                          opacity: track.opacity,
                          transform: `rotate(${track.rotation}deg)`,
                        }}
                        onPointerDown={(event) => beginVisualGesture(event, { kind: 'image', id: track.id }, 'move')}
                      >
                        <img
                          src={source.fileUrl || source.thumbnailUrl || ''}
                          alt={track.name}
                          style={{ objectFit: track.fit }}
                        />
                        {selected && (
                          <button
                            aria-label="Grafikgröße ändern"
                            className="video-editor-visual-resize"
                            onPointerDown={(event) =>
                              beginVisualGesture(event, { kind: 'image', id: track.id }, 'resize')
                            }
                          />
                        )}
                      </div>
                    );
                  })}
                  {visibleTexts?.map((track) => (
                    <div
                      key={track.id}
                      className={`video-editor-preview-text animation-${track.animation}${selection?.kind === 'text' && selection.id === track.id ? ' selected' : ''}`}
                      style={{
                        left: `${track.x / 10}%`,
                        top: `${track.y / 10}%`,
                        color: track.color,
                        width: `${track.width / 10}%`,
                        backgroundColor: colorWithAlpha(track.backgroundColor, track.backgroundOpacity),
                        opacity: track.opacity,
                        fontSize: `${Math.max(12, track.fontSize * 0.36)}px`,
                        fontFamily: track.fontFamily.includes('condensed')
                          ? 'Arial Narrow, sans-serif'
                          : 'Inter, sans-serif',
                        fontWeight: track.fontWeight === 'regular' ? 400 : track.fontWeight === 'semibold' ? 600 : 800,
                        transform: `translate(${track.align === 'left' ? '0' : track.align === 'right' ? '-100%' : '-50%'}, -50%)`,
                        textAlign: track.align,
                        WebkitTextStroke: track.outlineWidth
                          ? `${Math.max(0.4, track.outlineWidth * 0.25)}px ${track.outlineColor}`
                          : undefined,
                        textShadow: `${track.shadowX * 0.25}px ${track.shadowY * 0.25}px 4px ${track.shadowColor}`,
                      }}
                      onPointerDown={(event) => beginVisualGesture(event, { kind: 'text', id: track.id }, 'move')}
                    >
                      {track.text}
                      {selection?.kind === 'text' && selection.id === track.id && (
                        <button
                          aria-label="Textgröße ändern"
                          className="video-editor-visual-resize"
                          onPointerDown={(event) => beginVisualGesture(event, { kind: 'text', id: track.id }, 'resize')}
                        />
                      )}
                    </div>
                  ))}
                  <span className="video-editor-preview-time">{timecode(playhead, true)}</span>
                </div>
                {document.audioTracks.map((track) => {
                  const source = detail.sources.find((item) => item.id === track.sourceId);
                  return source?.fileUrl ? (
                    <AudioPreview
                      key={track.id}
                      track={track}
                      sourceUrl={source.fileUrl}
                      playhead={playhead}
                      playing={playing}
                    />
                  ) : null;
                })}
                <div className="video-editor-transport">
                  <button className="icon-button" onClick={() => setPlayhead(0)} title="Zum Anfang">
                    <Redo2 size={16} />
                  </button>
                  <button
                    className="video-editor-play"
                    onClick={() => setPlaying((value) => !value)}
                    disabled={!projectDuration}
                  >
                    {playing ? <Pause size={19} /> : <Play size={19} />}
                  </button>
                  <span>
                    {timecode(playhead, true)} <i>/</i> {timecode(projectDuration, true)}
                  </span>
                  <input
                    type="range"
                    min="0"
                    max={Math.max(0.1, projectDuration)}
                    step="0.05"
                    value={Math.min(playhead, projectDuration)}
                    onChange={(event) => setPlayhead(Number(event.target.value))}
                  />
                </div>
              </section>

              <section className="video-editor-inspector">
                <div className="video-editor-panel-title">
                  <div>
                    <SlidersHorizontal size={17} />
                    <strong>Inspector</strong>
                  </div>
                  {selection && (
                    <button className="icon-button ghost-button" onClick={() => removeLayer(selection)}>
                      <Trash2 size={15} />
                    </button>
                  )}
                </div>
                {!selection || !selectedLayer ? (
                  <div className="video-editor-inspector-empty">
                    <SlidersHorizontal size={26} />
                    <strong>Element auswählen</strong>
                    <span>Clip, Ton- oder Textspur anklicken, um Eigenschaften zu bearbeiten.</span>
                  </div>
                ) : selection.kind === 'clip' ? (
                  <ClipInspector
                    clip={selectedLayer as Clip}
                    source={detail.sources.find((item) => item.id === (selectedLayer as Clip).sourceId)}
                    onChange={(values) =>
                      mutateDocument((next) => {
                        next.clips = next.clips.map((clip) =>
                          clip.id === selection.id ? { ...clip, ...values } : clip,
                        );
                      })
                    }
                  />
                ) : selection.kind === 'audio' ? (
                  <AudioInspector
                    track={selectedLayer as AudioTrack}
                    projectDuration={projectDuration}
                    source={detail.sources.find((item) => item.id === (selectedLayer as AudioTrack).sourceId)}
                    onChange={(values) =>
                      mutateDocument((next) => {
                        next.audioTracks = next.audioTracks.map((track) =>
                          track.id === selection.id ? { ...track, ...values } : track,
                        );
                      })
                    }
                  />
                ) : selection.kind === 'text' ? (
                  <TextInspector
                    track={selectedLayer as TextTrack}
                    projectDuration={projectDuration}
                    onChange={(values) =>
                      mutateDocument((next) => {
                        next.textTracks = next.textTracks.map((track) =>
                          track.id === selection.id ? { ...track, ...values } : track,
                        );
                      })
                    }
                  />
                ) : (
                  <ImageInspector
                    track={selectedLayer as ImageTrack}
                    projectDuration={projectDuration}
                    source={detail.sources.find((item) => item.id === (selectedLayer as ImageTrack).sourceId)}
                    onChange={(values) =>
                      mutateDocument((next) => {
                        next.imageTracks = next.imageTracks.map((track) =>
                          track.id === selection.id ? { ...track, ...values } : track,
                        );
                      })
                    }
                  />
                )}
              </section>
            </div>

            <section className="video-editor-timeline-panel">
              <div className="video-editor-timeline-toolbar">
                <div>
                  <Scissors size={17} />
                  <strong>Timeline</strong>
                  <span>
                    {document.clips.length} Clips · {document.audioTracks.length} Tonspuren ·{' '}
                    {document.textTracks.length} Texte · {document.imageTracks.length} Grafiken
                  </span>
                </div>
                <div className="video-editor-timeline-actions">
                  <div className="video-editor-tool-group" role="toolbar" aria-label="Schnittwerkzeuge">
                    {(
                      [
                        ['select', 'Auswahl (V)', MousePointer2],
                        ['razor', 'Rasierklinge (C)', Scissors],
                        ['ripple', 'Ripple-Trim (B)', MoveHorizontal],
                        ['roll', 'Rollschnitt (R)', Split],
                        ['slip', 'Clipinhalt verschieben (Y)', GripVertical],
                      ] as const
                    ).map(([value, label, Icon]) => (
                      <button
                        key={value}
                        className={tool === value ? 'active' : ''}
                        title={label}
                        aria-label={label}
                        onClick={() => setTool(value)}
                      >
                        <Icon size={15} />
                      </button>
                    ))}
                  </div>
                  <button
                    className={snapping ? 'active' : ''}
                    title="Magnetisches Einrasten (N)"
                    onClick={() => setSnapping((value) => !value)}
                  >
                    <WandSparkles size={15} /> Snap
                  </button>
                  <button
                    title="Rückgängig (Strg+Z)"
                    onClick={undo}
                    disabled={!undoRef.current.length}
                    data-history={historyTick}
                  >
                    <RotateCcw size={15} />
                  </button>
                  <button title="Wiederholen (Strg+Shift+Z)" onClick={redo} disabled={!redoRef.current.length}>
                    <Redo2 size={15} />
                  </button>
                  <button
                    onClick={splitAtPlayhead}
                    disabled={!active || !writeAllowed}
                    title="Am Abspielkopf teilen (S)"
                  >
                    <Scissors size={15} /> Teilen
                  </button>
                  <button onClick={addText} disabled={!writeAllowed}>
                    <Type size={15} /> Text
                  </button>
                  <label>
                    Zoom{' '}
                    <input
                      type="range"
                      min="1"
                      max="20"
                      value={zoom}
                      onChange={(event) => setZoom(Number(event.target.value))}
                    />
                  </label>
                </div>
              </div>
              <div className="video-editor-timeline-scroll" ref={timelineRef} onClick={seekTimeline}>
                <div
                  className="video-editor-time-ruler"
                  style={{ width: `${Math.max(760, projectDuration * zoom)}px` }}
                >
                  {Array.from(
                    { length: Math.max(2, Math.ceil(projectDuration / Math.max(5, 100 / zoom)) + 1) },
                    (_, index) => {
                      const step = Math.max(5, 100 / zoom);
                      return (
                        <span key={index} style={{ left: `${((index * step) / Math.max(projectDuration, 1)) * 100}%` }}>
                          {timecode(index * step)}
                        </span>
                      );
                    },
                  )}
                </div>
                <div
                  className="video-editor-track-area"
                  style={{ width: `${Math.max(760, projectDuration * zoom)}px` }}
                >
                  <div className="video-editor-playhead" style={{ left: `${38 + playhead * zoom}px` }}>
                    <i />
                  </div>
                  <div className="video-editor-track video-track">
                    <b>V1</b>
                    <div className="video-editor-clip-lane">
                      {document.clips.map((clip, index) => (
                        <button
                          key={clip.id}
                          draggable={tool === 'select'}
                          onDragStart={(event) => event.dataTransfer.setData('text/clip-id', clip.id)}
                          onDragOver={(event) => event.preventDefault()}
                          onDrop={(event) => {
                            event.preventDefault();
                            reorderClip(event.dataTransfer.getData('text/clip-id'), clip.id);
                          }}
                          onPointerDown={(event) => {
                            event.stopPropagation();
                            if ((event.target as HTMLElement).closest('.clip-trim-handle,.clip-roll-handle')) return;
                            if (tool === 'razor') {
                              const rect = event.currentTarget.getBoundingClientRect();
                              splitClip(
                                clip.id,
                                bounded(
                                  ((event.clientX - rect.left) / Math.max(1, rect.width)) * clip.duration,
                                  0,
                                  clip.duration,
                                ),
                              );
                              return;
                            }
                            if (tool === 'slip') {
                              beginClipGesture(event, clip, 'slip');
                              return;
                            }
                            if (tool === 'roll' && index < document.clips.length - 1) {
                              beginClipGesture(event, clip, 'roll');
                              return;
                            }
                            setSelection({ kind: 'clip', id: clip.id });
                          }}
                          className={`${selection?.kind === 'clip' && selection.id === clip.id ? 'selected' : ''} tool-${tool}`}
                          style={{
                            left: `${(timelineClipStart(document.clips, clip.id) ?? 0) * zoom}px`,
                            width: `${Math.max(56, clip.duration * zoom)}px`,
                          }}
                        >
                          <span
                            className="clip-trim-handle start"
                            onPointerDown={(event) => beginClipGesture(event, clip, 'trim-start')}
                          />
                          <GripVertical size={13} />
                          <span>
                            <strong>{clip.name}</strong>
                            <small>
                              {timecode(clip.sourceStart)} – {timecode(clip.sourceStart + clip.duration)}
                            </small>
                          </span>
                          {clip.transition !== 'cut' && <i>{clip.transition.toUpperCase()}</i>}
                          <span
                            className="clip-trim-handle end"
                            onPointerDown={(event) => beginClipGesture(event, clip, 'trim-end')}
                          />
                          {index < document.clips.length - 1 && (
                            <span
                              className="clip-roll-handle"
                              title="Rollschnitt"
                              onPointerDown={(event) => beginClipGesture(event, clip, 'roll')}
                            />
                          )}
                        </button>
                      ))}
                      {!document.clips.length && (
                        <span className="video-editor-track-hint">Quellen mit + zur Timeline hinzufügen</span>
                      )}
                    </div>
                  </div>
                  <div className="video-editor-track text-track">
                    <b>T1</b>
                    <div className="video-editor-overlay-lane">
                      {document.textTracks.map((track) => (
                        <button
                          key={track.id}
                          onClick={(event) => {
                            event.stopPropagation();
                            setSelection({ kind: 'text', id: track.id });
                          }}
                          className={selection?.kind === 'text' && selection.id === track.id ? 'selected' : ''}
                          style={{
                            left: `${track.startAt * zoom}px`,
                            width: `${Math.max(44, track.duration * zoom)}px`,
                          }}
                        >
                          <Type size={12} />
                          <span>{track.text}</span>
                        </button>
                      ))}
                    </div>
                  </div>
                  <div className="video-editor-track image-track">
                    <b>I1</b>
                    <div className="video-editor-overlay-lane">
                      {document.imageTracks.map((track) => (
                        <button
                          key={track.id}
                          onClick={(event) => {
                            event.stopPropagation();
                            setSelection({ kind: 'image', id: track.id });
                          }}
                          className={selection?.kind === 'image' && selection.id === track.id ? 'selected' : ''}
                          style={{
                            left: `${track.startAt * zoom}px`,
                            width: `${Math.max(44, track.duration * zoom)}px`,
                          }}
                        >
                          <Image size={12} />
                          <span>{track.name}</span>
                        </button>
                      ))}
                    </div>
                  </div>
                  <div className="video-editor-track audio-track">
                    <b>A1</b>
                    <div className="video-editor-overlay-lane">
                      {document.audioTracks.map((track) => (
                        <button
                          key={track.id}
                          onClick={(event) => {
                            event.stopPropagation();
                            setSelection({ kind: 'audio', id: track.id });
                          }}
                          className={selection?.kind === 'audio' && selection.id === track.id ? 'selected' : ''}
                          style={{
                            left: `${track.startAt * zoom}px`,
                            width: `${Math.max(44, track.duration * zoom)}px`,
                          }}
                        >
                          <Volume2 size={12} />
                          <span>{track.name}</span>
                          {track.muted && <i>MUTE</i>}
                        </button>
                      ))}
                    </div>
                  </div>
                </div>
              </div>
            </section>

            <section className="video-editor-render-center">
              <div className="video-editor-section-heading">
                <div>
                  <Sparkles size={19} />
                  <span>
                    <p className="eyebrow">LOKALE AUSGABE</p>
                    <h3>Renderzentrale</h3>
                  </span>
                </div>
                <button
                  className="primary-button"
                  onClick={() => setDialog('render')}
                  disabled={!document.clips.length || !writeAllowed}
                >
                  <Film size={16} /> Neue MP4 rendern
                </button>
              </div>
              <div className="video-editor-render-grid">
                {detail.renders.map((render) => (
                  <article key={render.id} className={`video-editor-render-card ${render.status}`}>
                    <div className="video-editor-render-thumb">
                      {render.thumbnailUrl ? <img src={render.thumbnailUrl} alt="" /> : <Film size={30} />}
                      <span>{render.quality}</span>
                    </div>
                    <div className="video-editor-render-info">
                      <div>
                        <strong>{render.quality} · MP4</strong>
                        <span>{renderStatusLabels[render.status]}</span>
                      </div>
                      <small>
                        {render.width ? `${render.width}×${render.height}` : 'Wird vorbereitet'} ·{' '}
                        {bytes(render.size_bytes)} · {date(render.created_at)}
                      </small>
                      {(render.status === 'queued' || render.status === 'rendering') && (
                        <div className="video-editor-progress">
                          <i style={{ width: `${render.progress}%` }} />
                          <span>{render.progress}%</span>
                        </div>
                      )}
                      {render.error && <p>{render.error}</p>}
                    </div>
                    <div className="video-editor-render-actions">
                      {render.videoUrl && (
                        <a className="button ghost-button" href={render.videoUrl} target="_blank" rel="noreferrer">
                          <Play size={15} /> Ansehen
                        </a>
                      )}
                      {render.downloadUrl && (
                        <a className="button primary-button" href={render.downloadUrl}>
                          <Download size={15} /> MP4
                        </a>
                      )}
                      {(render.status === 'failed' || render.status === 'cancelled') && (
                        <button onClick={() => void renderAction(render, 'retry')}>
                          <Redo2 size={15} /> Erneut
                        </button>
                      )}
                      {render.status === 'queued' && (
                        <button className="ghost-button" onClick={() => void renderAction(render, 'cancel')}>
                          <X size={15} /> Abbrechen
                        </button>
                      )}
                    </div>
                  </article>
                ))}
                {!detail.renders.length && (
                  <div className="video-editor-empty">
                    <Film size={28} />
                    <strong>Noch kein Export</strong>
                    <span>Wähle 720p, Full HD oder 1440p und rendere lokal.</span>
                  </div>
                )}
              </div>
            </section>
          </div>
        )}
      </section>

      {dialog === 'create' && (
        <div className="modal-backdrop" role="dialog" aria-modal="true" onMouseDown={() => setDialog(null)}>
          <div className="modal-card video-editor-dialog compact" onMouseDown={(event) => event.stopPropagation()}>
            <div className="modal-header">
              <div>
                <p className="eyebrow">NEUE PRODUKTION</p>
                <h3>
                  <Clapperboard size={20} /> Video-Projekt anlegen
                </h3>
              </div>
              <button className="icon-button ghost-button" onClick={() => setDialog(null)}>
                <X />
              </button>
            </div>
            <Field label="Projektname">
              <input
                autoFocus
                value={projectDraft.name}
                onChange={(event) => setProjectDraft({ ...projectDraft, name: event.target.value })}
                placeholder="z. B. Wochenrückblick Juli"
              />
            </Field>
            <Field label="Beschreibung">
              <textarea
                value={projectDraft.description}
                onChange={(event) => setProjectDraft({ ...projectDraft, description: event.target.value })}
                placeholder="Worum geht es in dieser Produktion?"
              />
            </Field>
            <Field label="Bildformat">
              <div className="video-editor-format-options">
                {(['16:9', '9:16', '1:1'] as AspectRatio[]).map((format) => (
                  <button
                    key={format}
                    className={projectDraft.aspectRatio === format ? 'selected' : ''}
                    onClick={() => setProjectDraft({ ...projectDraft, aspectRatio: format })}
                  >
                    <span className={`format-shape shape-${format.replace(':', '-')}`} /> <strong>{format}</strong>
                    <small>{format === '16:9' ? 'YouTube' : format === '9:16' ? 'Vertical' : 'Quadratisch'}</small>
                  </button>
                ))}
              </div>
            </Field>
            <div className="modal-actions">
              <button className="ghost-button" onClick={() => setDialog(null)}>
                Abbrechen
              </button>
              <button
                className="primary-button"
                onClick={() => void createProject()}
                disabled={projectDraft.name.trim().length < 2 || Boolean(working)}
              >
                {working === 'create' ? <LoaderCircle className="spin" /> : <Plus />} Projekt anlegen
              </button>
            </div>
          </div>
        </div>
      )}

      {dialog === 'import' && detail && (
        <div className="modal-backdrop" role="dialog" aria-modal="true" onMouseDown={() => setDialog(null)}>
          <div
            className="modal-card video-editor-dialog source-dialog"
            onMouseDown={(event) => event.stopPropagation()}
          >
            <div className="modal-header">
              <div>
                <p className="eyebrow">QUELLENBROWSER</p>
                <h3>
                  <FolderOpen size={20} /> Material hinzufügen
                </h3>
                <p>Mehrere YouTube-URLs auf einmal oder bereits vorhandene Studio-Medien auswählen.</p>
              </div>
              <button className="icon-button ghost-button" onClick={() => setDialog(null)}>
                <X />
              </button>
            </div>
            <section className="video-editor-url-import">
              <div>
                <Video size={22} />
                <span>
                  <strong>YouTube-Links importieren</strong>
                  <small>Ein Link pro Zeile, bis zu 20 Videos gleichzeitig.</small>
                </span>
              </div>
              <textarea
                value={urlDraft}
                onChange={(event) => setUrlDraft(event.target.value)}
                placeholder={'https://www.youtube.com/watch?v=…\nhttps://youtu.be/…'}
              />
              <div className="video-editor-download-options">
                <Field label="Downloadtyp">
                  <select
                    value={downloadMode}
                    onChange={(event) => setDownloadMode(event.target.value as 'video' | 'audio')}
                  >
                    <option value="video">Video und Audio</option>
                    <option value="audio">Nur Audio</option>
                  </select>
                </Field>
                <Field label="Qualität">
                  <select
                    value={downloadQuality}
                    onChange={(event) => setDownloadQuality(event.target.value as DownloadQuality)}
                    disabled={downloadMode === 'audio'}
                  >
                    <option value="best">Beste verfügbar</option>
                    <option value="720p">Bis 720p</option>
                    <option value="1080p">Bis 1080p</option>
                    <option value="1440p">Bis 1440p</option>
                  </select>
                </Field>
                <span>
                  <HardDrive size={15} /> yt-dlp lädt lokal; FFmpeg führt Video und Ton automatisch zusammen.
                </span>
              </div>
              <button
                className="primary-button"
                onClick={() => void importUrls()}
                disabled={!urlDraft.trim() || Boolean(working)}
              >
                {working === 'import-url' ? <LoaderCircle className="spin" /> : <Download />} Prüfen & lokal laden
              </button>
            </section>
            <div className="video-editor-library-tabs">
              <button
                className={libraryTab === 'youtube' ? 'active' : ''}
                onClick={() => {
                  setLibraryTab('youtube');
                  setLibrarySelection(new Set());
                }}
              >
                <Video size={16} /> YouTube-Mediathek <span>{dashboard.library.youtube.length}</span>
              </button>
              <button
                className={libraryTab === 'media' ? 'active' : ''}
                onClick={() => {
                  setLibraryTab('media');
                  setLibrarySelection(new Set());
                }}
              >
                <Film size={16} /> Lokale Mediathek <span>{dashboard.library.media.length}</span>
              </button>
            </div>
            <label className="video-editor-search wide">
              <Search size={16} />
              <input
                value={librarySearch}
                onChange={(event) => setLibrarySearch(event.target.value)}
                placeholder="Titel, Kanal oder Datei suchen"
              />
            </label>
            <div className="video-editor-library-grid">
              {filteredLibrary.map((item) => {
                const title = 'title' in item ? item.title : item.filename;
                const subtitle =
                  'title' in item
                    ? `${item.channelTitle}${item.categoryName ? ` · ${item.categoryName}` : ''}`
                    : item.mime_type;
                const thumbnail = item.thumbnailUrl;
                return (
                  <button
                    key={item.id}
                    className={librarySelection.has(item.id) ? 'selected' : ''}
                    onClick={() =>
                      setLibrarySelection((current) => {
                        const next = new Set(current);
                        if (next.has(item.id)) next.delete(item.id);
                        else next.add(item.id);
                        return next;
                      })
                    }
                  >
                    <div>
                      {thumbnail ? (
                        <img src={thumbnail} alt="" />
                      ) : 'kind' in item && item.kind === 'audio' ? (
                        <Music2 />
                      ) : 'kind' in item && item.kind === 'image' ? (
                        <Image />
                      ) : (
                        <Film />
                      )}
                      <span>{timecode('durationSeconds' in item ? item.durationSeconds : item.duration_seconds)}</span>
                      {librarySelection.has(item.id) && (
                        <i>
                          <Check size={15} />
                        </i>
                      )}
                    </div>
                    <strong>{title}</strong>
                    <small>{subtitle}</small>
                  </button>
                );
              })}
              {!filteredLibrary.length && (
                <div className="video-editor-empty">
                  <Search size={25} />
                  <strong>Keine Treffer</strong>
                </div>
              )}
            </div>
            <div className="modal-actions">
              <span>{librarySelection.size} ausgewählt</span>
              <button className="ghost-button" onClick={() => setDialog(null)}>
                Schließen
              </button>
              <button
                className="primary-button"
                disabled={!librarySelection.size || Boolean(working)}
                onClick={() => void importLibrary()}
              >
                {working === 'import-library' ? <LoaderCircle className="spin" /> : <Plus />} Auswahl übernehmen
              </button>
            </div>
          </div>
        </div>
      )}

      {dialog === 'render' && detail && document && (
        <div className="modal-backdrop" role="dialog" aria-modal="true" onMouseDown={() => setDialog(null)}>
          <div className="modal-card video-editor-dialog compact" onMouseDown={(event) => event.stopPropagation()}>
            <div className="modal-header">
              <div>
                <p className="eyebrow">LOKALER EXPORT</p>
                <h3>
                  <Sparkles size={20} /> MP4-Qualität wählen
                </h3>
                <p>Mehrere Qualitätsstufen können in einem Auftrag nacheinander gerendert werden.</p>
              </div>
              <button className="icon-button ghost-button" onClick={() => setDialog(null)}>
                <X />
              </button>
            </div>
            <div className="video-editor-quality-grid">
              {(['720p', '1080p', '1440p'] as Quality[]).map((quality) => (
                <button
                  key={quality}
                  className={qualities.has(quality) ? 'selected' : ''}
                  onClick={() =>
                    setQualities((current) => {
                      const next = new Set(current);
                      if (next.has(quality)) next.delete(quality);
                      else next.add(quality);
                      return next;
                    })
                  }
                >
                  <span>{quality === '720p' ? 'HD' : quality === '1080p' ? 'FULL HD' : '2K'}</span>
                  <strong>{quality}</strong>
                  <small>
                    {document.canvas.aspectRatio === '16:9'
                      ? quality === '720p'
                        ? '1280 × 720'
                        : quality === '1080p'
                          ? '1920 × 1080'
                          : '2560 × 1440'
                      : `optimiert für ${document.canvas.aspectRatio}`}
                  </small>
                  {qualities.has(quality) && (
                    <i>
                      <Check size={16} />
                    </i>
                  )}
                </button>
              ))}
            </div>
            <div className="video-editor-render-summary">
              <Film size={19} />
              <span>
                <strong>{timecode(projectDuration)} Programmlänge</strong>
                <small>
                  {document.clips.length} Videoclips, {document.audioTracks.length} zusätzliche Tonspuren,{' '}
                  {document.textTracks.length} Texteinblendungen · CPU-Rendering im Hintergrund
                </small>
              </span>
            </div>
            <div className="modal-actions">
              <button className="ghost-button" onClick={() => setDialog(null)}>
                Abbrechen
              </button>
              <button
                className="video-editor-export-button"
                disabled={!qualities.size || Boolean(working)}
                onClick={() => void queueRender()}
              >
                {working === 'render' ? <LoaderCircle className="spin" /> : <Sparkles />} {qualities.size} MP4
                {qualities.size === 1 ? '' : 's'} rendern
              </button>
            </div>
          </div>
        </div>
      )}
    </main>
  );
}

function ClipInspector({
  clip,
  source,
  onChange,
}: {
  clip: Clip;
  source?: EditorSource;
  onChange: (values: Partial<Clip>) => void;
}) {
  const maximum = Number(source?.duration_seconds ?? clip.sourceStart + clip.duration);
  return (
    <div className="video-editor-inspector-form">
      <div className="inspector-kind">
        <Film size={17} />
        <span>
          <strong>Videoclip</strong>
          <small>{source?.channel_title || 'Lokale Quelle'}</small>
        </span>
      </div>
      <Field label="Clipname">
        <input value={clip.name} onChange={(event) => onChange({ name: event.target.value })} />
      </Field>
      <div className="video-editor-field-row">
        <Field label="Start in Quelle">
          <input
            type="number"
            min="0"
            max={maximum - 0.25}
            step="0.1"
            value={clip.sourceStart}
            onChange={(event) => {
              const sourceStart = bounded(event.target.value, 0, maximum - 0.25);
              onChange({ sourceStart, duration: Math.min(clip.duration, maximum - sourceStart) });
            }}
          />
        </Field>
        <Field label="Länge">
          <input
            type="number"
            min="0.25"
            max={maximum - clip.sourceStart}
            step="0.1"
            value={clip.duration}
            onChange={(event) => onChange({ duration: bounded(event.target.value, 0.25, maximum - clip.sourceStart) })}
          />
        </Field>
      </div>
      <Field label={`Originalton ${Math.round(clip.volume * 100)} %`}>
        <input
          type="range"
          min="0"
          max="2"
          step="0.05"
          value={clip.volume}
          onChange={(event) => onChange({ volume: Number(event.target.value) })}
        />
      </Field>
      <Field label="Bildanpassung">
        <select value={clip.fit} onChange={(event) => onChange({ fit: event.target.value as Clip['fit'] })}>
          <option value="cover">Fläche ausfüllen</option>
          <option value="contain">Ganzes Bild zeigen</option>
        </select>
      </Field>
      <Field label="Übergang">
        <select
          value={clip.transition}
          onChange={(event) => onChange({ transition: event.target.value as Clip['transition'] })}
        >
          <option value="cut">Harter Schnitt</option>
          <option value="fade">Kreuzblende</option>
          <option value="dissolve">Weiche Überblendung</option>
          <option value="fadeblack">Über Schwarz</option>
          <option value="wipeleft">Wischen nach links</option>
          <option value="wiperight">Wischen nach rechts</option>
          <option value="slideleft">Schieben nach links</option>
          <option value="slideright">Schieben nach rechts</option>
          <option value="smoothleft">Sanft nach links</option>
          <option value="smoothright">Sanft nach rechts</option>
          <option value="circleopen">Kreisblende</option>
          <option value="pixelize">Pixelblende</option>
        </select>
      </Field>
      {clip.transition !== 'cut' && (
        <Field label={`Übergangsdauer ${clip.transitionDuration.toFixed(2)} s`}>
          <input
            type="range"
            min="0.1"
            max={Math.min(3, clip.duration - 0.25)}
            step="0.05"
            value={clip.transitionDuration}
            onChange={(event) => onChange({ transitionDuration: Number(event.target.value) })}
          />
        </Field>
      )}
      <Field label="Farblook / Effekt">
        <select value={clip.effect} onChange={(event) => onChange({ effect: event.target.value as Clip['effect'] })}>
          <option value="none">Original</option>
          <option value="cinematic">Kino</option>
          <option value="warm">Warm</option>
          <option value="cool">Kühl</option>
          <option value="monochrome">Schwarzweiß</option>
          <option value="high-contrast">Hoher Kontrast</option>
          <option value="soft">Weichzeichner</option>
          <option value="sharpen">Schärfen</option>
        </select>
      </Field>
      {clip.effect !== 'none' && (
        <Field label={`Effektstärke ${Math.round(clip.effectIntensity * 100)} %`}>
          <input
            type="range"
            min="0"
            max="1"
            step="0.05"
            value={clip.effectIntensity}
            onChange={(event) => onChange({ effectIntensity: Number(event.target.value) })}
          />
        </Field>
      )}
      <Field label="Bewegung">
        <select value={clip.motion} onChange={(event) => onChange({ motion: event.target.value as Clip['motion'] })}>
          <option value="none">Keine</option>
          <option value="zoom-in">Langsam hineinzoomen</option>
          <option value="zoom-out">Langsam herauszoomen</option>
          <option value="pan-left">Nach links schwenken</option>
          <option value="pan-right">Nach rechts schwenken</option>
        </select>
      </Field>
    </div>
  );
}

function AudioInspector({
  track,
  source,
  projectDuration,
  onChange,
}: {
  track: AudioTrack;
  source?: EditorSource;
  projectDuration: number;
  onChange: (values: Partial<AudioTrack>) => void;
}) {
  const maximum = Number(source?.duration_seconds ?? track.sourceStart + track.duration);
  return (
    <div className="video-editor-inspector-form">
      <div className="inspector-kind audio">
        <Music2 size={17} />
        <span>
          <strong>Audiospur</strong>
          <small>{source?.title}</small>
        </span>
      </div>
      <Field label="Spurname">
        <input value={track.name} onChange={(event) => onChange({ name: event.target.value })} />
      </Field>
      <label className="video-editor-check">
        <input type="checkbox" checked={track.muted} onChange={(event) => onChange({ muted: event.target.checked })} />
        <span>
          <strong>Spur stummschalten</strong>
          <small>Bleibt in der Timeline, wird aber nicht gerendert.</small>
        </span>
      </label>
      <div className="video-editor-field-row">
        <Field label="Start Timeline">
          <input
            type="number"
            min="0"
            max={projectDuration - 0.25}
            step="0.1"
            value={track.startAt}
            onChange={(event) => onChange({ startAt: bounded(event.target.value, 0, projectDuration - 0.25) })}
          />
        </Field>
        <Field label="Start Quelle">
          <input
            type="number"
            min="0"
            max={maximum - 0.25}
            step="0.1"
            value={track.sourceStart}
            onChange={(event) => onChange({ sourceStart: bounded(event.target.value, 0, maximum - 0.25) })}
          />
        </Field>
      </div>
      <Field label="Länge">
        <input
          type="number"
          min="0.25"
          max={Math.min(maximum - track.sourceStart, projectDuration - track.startAt)}
          step="0.1"
          value={track.duration}
          onChange={(event) =>
            onChange({
              duration: bounded(
                event.target.value,
                0.25,
                Math.min(maximum - track.sourceStart, projectDuration - track.startAt),
              ),
            })
          }
        />
      </Field>
      <Field label={`Lautstärke ${Math.round(track.volume * 100)} %`}>
        <input
          type="range"
          min="0"
          max="2"
          step="0.05"
          value={track.volume}
          onChange={(event) => onChange({ volume: Number(event.target.value) })}
        />
      </Field>
      <div className="video-editor-field-row">
        <Field label="Einblenden">
          <input
            type="number"
            min="0"
            max="10"
            step="0.1"
            value={track.fadeIn}
            onChange={(event) => onChange({ fadeIn: bounded(event.target.value, 0, 10) })}
          />
        </Field>
        <Field label="Ausblenden">
          <input
            type="number"
            min="0"
            max="10"
            step="0.1"
            value={track.fadeOut}
            onChange={(event) => onChange({ fadeOut: bounded(event.target.value, 0, 10) })}
          />
        </Field>
      </div>
    </div>
  );
}

function TextInspector({
  track,
  projectDuration,
  onChange,
}: {
  track: TextTrack;
  projectDuration: number;
  onChange: (values: Partial<TextTrack>) => void;
}) {
  return (
    <div className="video-editor-inspector-form">
      <div className="inspector-kind text">
        <Type size={17} />
        <span>
          <strong>Textspur</strong>
          <small>Direkt im finalen Video gerendert</small>
        </span>
      </div>
      <Field label="Text">
        <textarea value={track.text} onChange={(event) => onChange({ text: event.target.value })} />
      </Field>
      <div className="video-editor-field-row">
        <Field label="Start">
          <input
            type="number"
            min="0"
            max={projectDuration - 0.25}
            step="0.1"
            value={track.startAt}
            onChange={(event) => onChange({ startAt: bounded(event.target.value, 0, projectDuration - 0.25) })}
          />
        </Field>
        <Field label="Dauer">
          <input
            type="number"
            min="0.25"
            max={projectDuration - track.startAt}
            step="0.1"
            value={track.duration}
            onChange={(event) =>
              onChange({ duration: bounded(event.target.value, 0.25, projectDuration - track.startAt) })
            }
          />
        </Field>
      </div>
      <Field label="Schrift">
        <select
          value={track.fontFamily}
          onChange={(event) => onChange({ fontFamily: event.target.value as TextTrack['fontFamily'] })}
        >
          <option value="ibm-plex-sans">IBM Plex Sans</option>
          <option value="ibm-plex-condensed">IBM Plex Condensed</option>
          <option value="dejavu-sans">DejaVu Sans</option>
          <option value="liberation-sans">Liberation Sans</option>
        </select>
      </Field>
      <div className="video-editor-field-row">
        <Field label="Größe">
          <input
            type="number"
            min="16"
            max="180"
            value={track.fontSize}
            onChange={(event) => onChange({ fontSize: Math.round(bounded(event.target.value, 16, 180)) })}
          />
        </Field>
        <Field label="Schnitt">
          <select
            value={track.fontWeight}
            onChange={(event) => onChange({ fontWeight: event.target.value as TextTrack['fontWeight'] })}
          >
            <option value="regular">Normal</option>
            <option value="semibold">Halbfett</option>
            <option value="bold">Fett</option>
          </select>
        </Field>
      </div>
      <div className="video-editor-color-row">
        <Field label="Textfarbe">
          <input type="color" value={track.color} onChange={(event) => onChange({ color: event.target.value })} />
        </Field>
        <Field label="Hintergrund">
          <input
            type="color"
            value={track.backgroundColor}
            onChange={(event) => onChange({ backgroundColor: event.target.value })}
          />
        </Field>
        <Field label="Kontur">
          <input
            type="color"
            value={track.outlineColor}
            onChange={(event) => onChange({ outlineColor: event.target.value })}
          />
        </Field>
        <Field label="Schatten">
          <input
            type="color"
            value={track.shadowColor}
            onChange={(event) => onChange({ shadowColor: event.target.value })}
          />
        </Field>
      </div>
      <Field label={`Textfeldbreite ${Math.round(track.width / 10)} %`}>
        <input
          type="range"
          min="80"
          max="1000"
          value={track.width}
          onChange={(event) => onChange({ width: Number(event.target.value) })}
        />
      </Field>
      <div className="video-editor-field-row">
        <Field label={`Deckkraft ${Math.round(track.opacity * 100)} %`}>
          <input
            type="range"
            min="0"
            max="1"
            step="0.05"
            value={track.opacity}
            onChange={(event) => onChange({ opacity: Number(event.target.value) })}
          />
        </Field>
        <Field label={`Hintergrund ${Math.round(track.backgroundOpacity * 100)} %`}>
          <input
            type="range"
            min="0"
            max="1"
            step="0.05"
            value={track.backgroundOpacity}
            onChange={(event) => onChange({ backgroundOpacity: Number(event.target.value) })}
          />
        </Field>
      </div>
      <div className="video-editor-field-row">
        <Field label={`Kontur ${track.outlineWidth}px`}>
          <input
            type="range"
            min="0"
            max="12"
            value={track.outlineWidth}
            onChange={(event) => onChange({ outlineWidth: Number(event.target.value) })}
          />
        </Field>
        <Field label="Schattenversatz X / Y">
          <div className="video-editor-mini-pair">
            <input
              type="number"
              min="-30"
              max="30"
              value={track.shadowX}
              onChange={(event) => onChange({ shadowX: bounded(event.target.value, -30, 30) })}
            />
            <input
              type="number"
              min="-30"
              max="30"
              value={track.shadowY}
              onChange={(event) => onChange({ shadowY: bounded(event.target.value, -30, 30) })}
            />
          </div>
        </Field>
      </div>
      <div className="video-editor-field-row">
        <Field label="X-Position">
          <input
            type="range"
            min="0"
            max="1000"
            value={track.x}
            onChange={(event) => onChange({ x: Number(event.target.value) })}
          />
        </Field>
        <Field label="Y-Position">
          <input
            type="range"
            min="0"
            max="1000"
            value={track.y}
            onChange={(event) => onChange({ y: Number(event.target.value) })}
          />
        </Field>
      </div>
      <Field label="Ausrichtung">
        <select value={track.align} onChange={(event) => onChange({ align: event.target.value as TextTrack['align'] })}>
          <option value="left">Links</option>
          <option value="center">Zentriert</option>
          <option value="right">Rechts</option>
        </select>
      </Field>
      <Field label="Animation">
        <select
          value={track.animation}
          onChange={(event) => onChange({ animation: event.target.value as TextTrack['animation'] })}
        >
          <option value="fade">Sanft einblenden</option>
          <option value="rise">Von unten einfahren</option>
          <option value="slide-left">Von links einfahren</option>
          <option value="slide-right">Von rechts einfahren</option>
          <option value="none">Ohne Animation</option>
        </select>
      </Field>
    </div>
  );
}

function ImageInspector({
  track,
  source,
  projectDuration,
  onChange,
}: {
  track: ImageTrack;
  source?: EditorSource;
  projectDuration: number;
  onChange: (values: Partial<ImageTrack>) => void;
}) {
  return (
    <div className="video-editor-inspector-form">
      <div className="inspector-kind image">
        <Image size={17} />
        <span>
          <strong>Bild-Overlay</strong>
          <small>{source?.title || track.name}</small>
        </span>
      </div>
      <Field label="Ebenenname">
        <input value={track.name} onChange={(event) => onChange({ name: event.target.value })} />
      </Field>
      <div className="video-editor-field-row">
        <Field label="Start">
          <input
            type="number"
            min="0"
            max={Math.max(0, projectDuration - 0.25)}
            step="0.1"
            value={track.startAt}
            onChange={(event) => onChange({ startAt: bounded(event.target.value, 0, projectDuration - 0.25) })}
          />
        </Field>
        <Field label="Dauer">
          <input
            type="number"
            min="0.25"
            max={projectDuration - track.startAt}
            step="0.1"
            value={track.duration}
            onChange={(event) =>
              onChange({ duration: bounded(event.target.value, 0.25, projectDuration - track.startAt) })
            }
          />
        </Field>
      </div>
      <div className="video-editor-field-row">
        <Field label={`Breite ${Math.round(track.width / 10)} %`}>
          <input
            type="range"
            min="20"
            max="1000"
            value={track.width}
            onChange={(event) => onChange({ width: Number(event.target.value) })}
          />
        </Field>
        <Field label={`Höhe ${Math.round(track.height / 10)} %`}>
          <input
            type="range"
            min="20"
            max="1000"
            value={track.height}
            onChange={(event) => onChange({ height: Number(event.target.value) })}
          />
        </Field>
      </div>
      <div className="video-editor-field-row">
        <Field label="X-Position">
          <input
            type="range"
            min="0"
            max="1000"
            value={track.x}
            onChange={(event) => onChange({ x: Number(event.target.value) })}
          />
        </Field>
        <Field label="Y-Position">
          <input
            type="range"
            min="0"
            max="1000"
            value={track.y}
            onChange={(event) => onChange({ y: Number(event.target.value) })}
          />
        </Field>
      </div>
      <Field label={`Deckkraft ${Math.round(track.opacity * 100)} %`}>
        <input
          type="range"
          min="0"
          max="1"
          step="0.05"
          value={track.opacity}
          onChange={(event) => onChange({ opacity: Number(event.target.value) })}
        />
      </Field>
      <div className="video-editor-field-row">
        <Field label="Bildanpassung">
          <select value={track.fit} onChange={(event) => onChange({ fit: event.target.value as ImageTrack['fit'] })}>
            <option value="contain">Ganz zeigen</option>
            <option value="cover">Fläche füllen</option>
          </select>
        </Field>
        <Field label="Drehung">
          <input
            type="number"
            min="-180"
            max="180"
            value={track.rotation}
            onChange={(event) => onChange({ rotation: bounded(event.target.value, -180, 180) })}
          />
        </Field>
      </div>
      <Field label="Animation">
        <select
          value={track.animation}
          onChange={(event) => onChange({ animation: event.target.value as ImageTrack['animation'] })}
        >
          <option value="fade">Sanft einblenden</option>
          <option value="rise">Von unten einfahren</option>
          <option value="slide-left">Von links einfahren</option>
          <option value="slide-right">Von rechts einfahren</option>
          <option value="none">Ohne Animation</option>
        </select>
      </Field>
      <p className="video-editor-inspector-tip">
        Im Vorschaubild direkt ziehen; der Griff unten rechts ändert die Größe.
      </p>
    </div>
  );
}

function AudioPreview({
  track,
  sourceUrl,
  playhead,
  playing,
}: {
  track: AudioTrack;
  sourceUrl: string;
  playhead: number;
  playing: boolean;
}) {
  const ref = useRef<HTMLAudioElement>(null);
  const active = playhead >= track.startAt && playhead <= track.startAt + track.duration;
  useEffect(() => {
    const audio = ref.current;
    if (!audio) return;
    const expected = track.sourceStart + Math.max(0, playhead - track.startAt);
    if (active && Math.abs(audio.currentTime - expected) > 0.6) audio.currentTime = expected;
    audio.volume = Math.min(1, track.volume);
    audio.muted = track.muted || !active;
    if (playing && active && !track.muted) void audio.play().catch(() => undefined);
    else audio.pause();
  }, [active, playhead, playing, track.muted, track.sourceStart, track.startAt, track.volume]);
  return <audio ref={ref} src={sourceUrl} preload="metadata" />;
}
