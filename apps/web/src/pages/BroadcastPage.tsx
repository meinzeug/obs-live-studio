import React, { useEffect, useMemo, useRef, useState } from 'react';
import {
  CalendarClock,
  ChevronDown,
  ChevronUp,
  CirclePlay,
  Clapperboard,
  Clock3,
  Cpu,
  Edit3,
  Film,
  Layers3,
  ListChecks,
  ListPlus,
  ListVideo,
  MonitorUp,
  Pause,
  Play,
  Plus,
  Radio,
  Save,
  Scissors,
  Search,
  Settings2,
  Shuffle,
  SkipForward,
  Sparkles,
  Square,
  Trash2,
  WandSparkles,
  X,
} from 'lucide-react';
import { useSearchParams } from 'react-router-dom';
import { api, can, type SessionUser } from '../api/client.js';

const controllable: Record<string, string[]> = {
  idle: [],
  preparing: ['pause', 'skip', 'stop'],
  playing: ['pause', 'skip', 'stop'],
  paused: ['resume', 'skip', 'stop'],
  pausing: ['resume', 'skip', 'stop'],
  resuming: ['pause', 'skip', 'stop'],
  skipping: ['stop'],
  stopping: [],
  ended: [],
  error: [],
  interrupted: [],
};
const controls = [
  { action: 'pause', label: 'Pause', icon: Pause },
  { action: 'resume', label: 'Fortsetzen', icon: Play },
  { action: 'skip', label: 'Überspringen', icon: SkipForward },
  { action: 'stop', label: 'Stoppen', icon: Square },
];

type PlaylistSettings = {
  pauseSeconds?: number;
  transition?: 'clean' | 'fade' | 'headline' | 'bumper';
  repeatPolicy?: 'none' | 'recent-published' | 'loop';
  targetRuntimeMinutes?: number;
  notes?: string;
};
type PlaylistDraft = {
  name: string;
  description: string;
  scheduledAt: string;
  kind: 'playlist' | 'show' | 'hour' | 'special';
  overlayProjectId: string;
  settings: Required<Omit<PlaylistSettings, 'notes'>> & { notes: string };
};
const defaultDraft: PlaylistDraft = {
  name: `Nachrichtensendung ${new Date().toLocaleDateString('de-DE')}`,
  description: '',
  scheduledAt: '',
  kind: 'show',
  overlayProjectId: '',
  settings: { pauseSeconds: 5, transition: 'fade', repeatPolicy: 'recent-published', targetRuntimeMinutes: 30, notes: '' },
};

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
function playlistToDraft(playlist: any): PlaylistDraft {
  const settings = playlist?.settings ?? {};
  return {
    name: playlist?.name ?? defaultDraft.name,
    description: playlist?.description ?? '',
    scheduledAt: toLocalInput(playlist?.scheduled_at),
    kind: ['playlist', 'show', 'hour', 'special'].includes(playlist?.kind) ? playlist.kind : 'show',
    overlayProjectId: playlist?.overlay_project_id ?? '',
    settings: {
      pauseSeconds: Number(settings.pauseSeconds ?? 5),
      transition: ['clean', 'fade', 'headline', 'bumper'].includes(settings.transition) ? settings.transition : 'fade',
      repeatPolicy: ['none', 'recent-published', 'loop'].includes(settings.repeatPolicy)
        ? settings.repeatPolicy
        : 'recent-published',
      targetRuntimeMinutes: Number(settings.targetRuntimeMinutes ?? 30),
      notes: String(settings.notes ?? ''),
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
  const [searchParams] = useSearchParams();
  const view = searchParams.get('view') ?? '';
  const [status, setStatus] = useState<any>();
  const [playlists, setPlaylists] = useState<any[]>([]);
  const [articles, setArticles] = useState<any[]>([]);
  const [overlays, setOverlays] = useState<any[]>([]);
  const [showAllPlaylists, setShowAllPlaylists] = useState(view === 'planned');
  const [message, setMessage] = useState('');
  const [aiPlanning, setAiPlanning] = useState(false);
  const [modal, setModal] = useState<'create' | 'edit' | null>(null);
  const [draft, setDraft] = useState<PlaylistDraft>(defaultDraft);
  const [selectedArticleIds, setSelectedArticleIds] = useState<string[]>([]);
  const [editing, setEditing] = useState<any>();
  const [editingItems, setEditingItems] = useState<any[]>([]);
  const [query, setQuery] = useState('');
  const [modalError, setModalError] = useState('');
  const [planView, setPlanView] = useState<'grid' | 'list' | 'timeline'>('grid');
  const [scheduleDate, setScheduleDate] = useState(() => new Date().toISOString().slice(0, 10));
  const [draggingPlaylistId, setDraggingPlaylistId] = useState<string | null>(null);
  const loadRevision = useRef(0);
  const allowedWrite = can(user, 'broadcast:write');

  async function load() {
    const revision = ++loadRevision.current;
    try {
      const [nextStatus, nextPlaylists, nextArticles, nextOverlays] = await Promise.all([
        api('/api/broadcast/status'),
        api<any[]>('/api/broadcast/playlists'),
        api<any[]>('/api/broadcast/articles?limit=160'),
        api<any[]>('/api/overlays'),
      ]);
      if (revision !== loadRevision.current) return;
      setStatus(nextStatus);
      setPlaylists(nextPlaylists);
      setArticles(nextArticles);
      setOverlays(nextOverlays);
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

  async function control(action: string) {
    try {
      const result = await api<{ commandId: string; sequence: number; expectedState: string }>('/api/broadcast/control', {
        method: 'POST',
        body: JSON.stringify({ action, idempotencyKey: `${action}-${Date.now()}` }),
      });
      setMessage(`Befehl ${result.commandId} gespeichert, Sequenz ${result.sequence}, Ziel ${result.expectedState}`);
      await load();
    } catch (e) {
      setMessage(e instanceof Error ? e.message : String(e));
    }
  }
  async function start(id: string) {
    try {
      await api(`/api/broadcast/playlists/${id}/start`, { method: 'POST' });
      setMessage('Sendung gestartet');
      await load();
    } catch (error) {
      setMessage(error instanceof Error ? error.message : String(error));
    }
  }
  async function createAiPlan() {
    setAiPlanning(true);
    try {
      const result = await api<any>('/api/ai/broadcast-plan', {
        method: 'POST',
        body: JSON.stringify({ maximumItems: 8 }),
      });
      setMessage(
        `KI-Sendung „${result.playlist.name}“ erstellt · ${result.ai?.model ?? 'OpenRouter'} (${result.ai?.tier === 'free' ? 'kostenlos' : 'bezahlt'}). ${result.rationale}`,
      );
      setShowAllPlaylists(true);
      await load();
    } catch (error) {
      setMessage(error instanceof Error ? error.message : String(error));
    } finally {
      setAiPlanning(false);
    }
  }
  function openCreate() {
    setDraft({ ...defaultDraft, name: `Sendung ${new Date().toLocaleString('de-DE', { dateStyle: 'short', timeStyle: 'short' })}` });
    setSelectedArticleIds([]);
    setEditing(undefined);
    setEditingItems([]);
    setModalError('');
    setModal('create');
  }
  async function openEdit(playlist: any) {
    const detail = await api<any>(`/api/broadcast/playlists/${playlist.id}`);
    setEditing(detail.playlist);
    setEditingItems(detail.items ?? []);
    setDraft(playlistToDraft(detail.playlist));
    setSelectedArticleIds([]);
    setModalError('');
    setModal('edit');
  }
  function requestBody() {
    return {
      name: draft.name,
      description: draft.description || null,
      scheduledAt: fromLocalInput(draft.scheduledAt),
      kind: draft.kind,
      overlayProjectId: draft.overlayProjectId || null,
      settings: draft.settings,
    };
  }
  async function saveCreate() {
    setModalError('');
    try {
      await api('/api/broadcast/playlists', {
        method: 'POST',
        body: JSON.stringify({ ...requestBody(), articleIds: selectedArticleIds }),
      });
      setModal(null);
      setShowAllPlaylists(true);
      setMessage('Sendung erstellt.');
      await load();
    } catch (error) {
      setModalError(error instanceof Error ? error.message : String(error));
    }
  }
  async function saveEdit() {
    if (!editing) return;
    setModalError('');
    try {
      await api(`/api/broadcast/playlists/${editing.id}`, { method: 'PUT', body: JSON.stringify(requestBody()) });
      for (const articleId of selectedArticleIds) {
        await api(`/api/broadcast/playlists/${editing.id}/items`, {
          method: 'POST',
          body: JSON.stringify({ articleId }),
        });
      }
      setSelectedArticleIds([]);
      await openEdit(editing);
      await load();
      setMessage('Sendung gespeichert.');
    } catch (error) {
      setModalError(error instanceof Error ? error.message : String(error));
    }
  }
  async function deletePlaylist(id: string) {
    if (!window.confirm('Diese Sendung inklusive Ablauf wirklich löschen?')) return;
    await api(`/api/broadcast/playlists/${id}`, { method: 'DELETE' });
    setModal(null);
    setMessage('Sendung gelöscht.');
    await load();
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
  const allowed = useMemo(() => new Set(controllable[playback.status] ?? []), [playback.status]);
  const items = status?.items ?? [];
  const visiblePlaylists = planView === 'timeline' || showAllPlaylists ? playlists : playlists.slice(0, 12);
  const normalizedQuery = query.trim().toLocaleLowerCase('de');
  const selectableArticles = articles.filter((article) => {
    if (editingItems.some((item) => item.article_id === article.id) || selectedArticleIds.includes(article.id)) return false;
    if (!normalizedQuery) return true;
    return `${article.title} ${article.source_name ?? ''} ${article.category ?? ''}`.toLocaleLowerCase('de').includes(normalizedQuery);
  });
  const selectedDuration = articles
    .filter((article) => selectedArticleIds.includes(article.id))
    .reduce((sum, article) => sum + Number(article.audio_duration_seconds ?? 60), 0);

  function DraftFields() {
    return (
      <div className="settings-automation-grid broadcast-form-grid">
        <label className="settings-option">
          <span>Sendungstitel</span>
          <small>Der Name der ganzen Sendung oder Playlist.</small>
          <input value={draft.name} onChange={(event) => setDraft({ ...draft, name: event.target.value })} />
        </label>
        <label className="settings-option">
          <span>Format</span>
          <small>Definiert, ob es eine volle Sendung, Stunde oder Spezialausgabe ist.</small>
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
          <input type="datetime-local" value={draft.scheduledAt} onChange={(event) => setDraft({ ...draft, scheduledAt: event.target.value })} />
        </label>
        <label className="settings-option">
          <span>Overlay-Set</span>
          <small>Sendung mit einem bestehenden Overlay-Projekt verknüpfen.</small>
          <select value={draft.overlayProjectId} onChange={(event) => setDraft({ ...draft, overlayProjectId: event.target.value })}>
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
          <input type="number" min="0" max="600" value={draft.settings.pauseSeconds} onChange={(event) => setDraft({ ...draft, settings: { ...draft.settings, pauseSeconds: Number(event.target.value) } })} />
        </label>
        <label className="settings-option">
          <span>Übergang</span>
          <small>Visueller Stil für den Wechsel zwischen Beiträgen.</small>
          <select value={draft.settings.transition} onChange={(event) => setDraft({ ...draft, settings: { ...draft.settings, transition: event.target.value as any } })}>
            <option value="fade">Weiche Blende</option>
            <option value="headline">Headline-Bridge</option>
            <option value="bumper">Kurzer Bumper</option>
            <option value="clean">Direkt sauber</option>
          </select>
        </label>
        <label className="settings-option">
          <span>Wiederholung</span>
          <small>Was passiert, wenn neue Beiträge fehlen.</small>
          <select value={draft.settings.repeatPolicy} onChange={(event) => setDraft({ ...draft, settings: { ...draft.settings, repeatPolicy: event.target.value as any } })}>
            <option value="recent-published">Published der letzten 3 Tage</option>
            <option value="loop">Sendung wiederholen</option>
            <option value="none">Nicht wiederholen</option>
          </select>
        </label>
        <label className="settings-option">
          <span>Ziel-Laufzeit</span>
          <small>Planwert in Minuten für eine volle Sendung.</small>
          <input type="number" min="1" max="1440" value={draft.settings.targetRuntimeMinutes} onChange={(event) => setDraft({ ...draft, settings: { ...draft.settings, targetRuntimeMinutes: Number(event.target.value) } })} />
        </label>
        <label className="settings-option stream-target-wide">
          <span>Regie-Notizen</span>
          <small>Interne Hinweise für Moderation, Übergänge oder Quellenlage.</small>
          <textarea value={draft.settings.notes} onChange={(event) => setDraft({ ...draft, settings: { ...draft.settings, notes: event.target.value } })} />
        </label>
        <label className="settings-option stream-target-wide">
          <span>Beschreibung</span>
          <small>Öffentliche Kurzbeschreibung dieser Sendung.</small>
          <textarea value={draft.description} onChange={(event) => setDraft({ ...draft, description: event.target.value })} />
        </label>
      </div>
    );
  }

  function ArticlePicker() {
    return (
      <section className="broadcast-modal-section">
        <div className="section-heading compact-heading">
          <div>
            <p className="eyebrow">Beitragsauswahl</p>
            <h4>Beiträge in die Sendung ziehen</h4>
          </div>
          <span className="state-pill">
            {selectedArticleIds.length} ausgewählt · {Math.round(selectedDuration / 60)} Min.
          </span>
        </div>
        <label className="settings-search broadcast-search">
          <Search size={16} aria-hidden="true" />
          <span className="visually-hidden">Beiträge suchen</span>
          <input value={query} placeholder="Beitrag, Quelle oder Ressort suchen …" onChange={(event) => setQuery(event.target.value)} />
        </label>
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
                  {article.source_name ?? 'Quelle'} · {article.status} · {Math.round(Number(article.audio_duration_seconds ?? 60))}s
                </small>
              </span>
            </button>
          ))}
        </div>
        {selectedArticleIds.length > 0 && (
          <div className="selected-chip-row">
            {selectedArticleIds.map((id) => {
              const article = articles.find((candidate) => candidate.id === id);
              return (
                <button key={id} className="state-pill" onClick={() => setSelectedArticleIds((current) => current.filter((candidate) => candidate !== id))}>
                  <X size={12} /> {article?.title?.slice(0, 38) ?? id}
                </button>
              );
            })}
          </div>
        )}
      </section>
    );
  }

  function scrollToSection(id: string) {
    document.getElementById(id)?.scrollIntoView({ behavior: 'smooth', block: 'start' });
  }

  function PlaylistCard({ playlist, compact = false }: { playlist: any; compact?: boolean }) {
    const settings = playlist.settings ?? {};
    const overlay = overlays.find((candidate) => candidate.id === playlist.overlay_project_id);
    return (
      <article
        className={`playlist-row show-card ${compact ? 'compact-show-card' : ''} ${draggingPlaylistId === playlist.id ? 'dragging' : ''}`}
        draggable={allowedWrite}
        onDragStart={() => setDraggingPlaylistId(playlist.id)}
        onDragEnd={() => setDraggingPlaylistId(null)}
        onDragOver={(event) => event.preventDefault()}
        onDrop={() => void dropPlaylistNear(playlist)}
        title="Sendung per Drag-and-drop im Sendeplan verschieben"
      >
        <div className="show-card-main">
          <span className="show-kind-icon">
            {playlist.kind === 'show' ? <Clapperboard size={18} /> : playlist.kind === 'hour' ? <Clock3 size={18} /> : <Film size={18} />}
          </span>
          <div>
            <strong>{playlist.name}</strong>
            <p>{playlist.description || 'Keine Beschreibung hinterlegt.'}</p>
            <small>
              {playlist.status} · {playlist.kind ?? 'playlist'} · geplant {formatTime(playlist.scheduled_at)}
            </small>
          </div>
        </div>
        <div className="show-meta-strip">
          <span className="state-pill"><Scissors size={12} /> {settings.transition ?? 'fade'}</span>
          <span className="state-pill"><Clock3 size={12} /> {settings.pauseSeconds ?? 5}s Pause</span>
          <span className="state-pill"><Shuffle size={12} /> {settings.repeatPolicy ?? 'recent-published'}</span>
          <span className="state-pill"><Layers3 size={12} /> {overlay?.name ?? 'Standard'}</span>
        </div>
        <div className="show-card-actions">
          <button disabled={!allowedWrite} onClick={() => void openEdit(playlist)}>
            <Edit3 size={16} /> Bearbeiten
          </button>
          <button className="primary-button" disabled={!allowedWrite || status?.run} onClick={() => start(playlist.id)}>
            <Play size={17} /> Starten
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
          <span className="state-pill"><CalendarClock size={12} /> {scheduledInDay.length} geplante Slots</span>
          <span className="state-pill"><Shuffle size={12} /> {unscheduled.length} ohne feste Uhrzeit</span>
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
                    <span className="drop-hint">Sendung hier ablegen</span>
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
              {unscheduled.map((playlist) => <TimelineShowCard playlist={playlist} key={playlist.id} />)}
            </div>
          </section>
        )}
      </div>
    );
  }

  function TimelineShowCard({ playlist }: { playlist: any }) {
    const settings = playlist.settings ?? {};
    return (
      <article
        className={`timeline-show-card ${draggingPlaylistId === playlist.id ? 'dragging' : ''}`}
        draggable={allowedWrite}
        onDragStart={() => setDraggingPlaylistId(playlist.id)}
        onDragEnd={() => setDraggingPlaylistId(null)}
        onDragOver={(event) => event.preventDefault()}
        onDrop={() => void dropPlaylistNear(playlist)}
      >
        <div>
          <p className="eyebrow">{playlist.kind ?? 'playlist'} · {playlist.status}</p>
          <h4>{playlist.name}</h4>
          <p>{playlist.description || 'Keine Beschreibung hinterlegt.'}</p>
          <div className="show-meta-strip">
            <span className="state-pill"><Clock3 size={12} /> {settings.pauseSeconds ?? 5}s</span>
            <span className="state-pill"><Scissors size={12} /> {settings.transition ?? 'fade'}</span>
            <span className="state-pill"><Sparkles size={12} /> {settings.targetRuntimeMinutes ?? 30} Min Ziel</span>
          </div>
        </div>
        <div className="show-card-actions">
          <button disabled={!allowedWrite} onClick={() => void openEdit(playlist)}>
            <Edit3 size={16} /> Bearbeiten
          </button>
          <button className="primary-button" disabled={!allowedWrite || status?.run} onClick={() => start(playlist.id)}>
            <Play size={17} /> Starten
          </button>
        </div>
      </article>
    );
  }

  return (
    <section className="panel broadcast-page">
      <div className="page-title">
        <div>
          <p className="eyebrow">Senderegie</p>
          <h2>Broadcast Control Room</h2>
          <p>Live-Ablauf, echte Sendungen, Sendeplan, Playlists, Overlays und Übergänge zentral steuern.</p>
        </div>
        <span className={`state-pill ${playback.status === 'playing' ? 'live' : ''}`}>
          <Radio size={12} /> {playback.status ?? 'idle'}
        </span>
      </div>

      <div className="broadcast-hero-grid">
        <button className="broadcast-hero-card live-card hero-action-card" id="broadcast-active" onClick={() => scrollToSection('broadcast-active')}>
          <span className="stat-icon live">
            <CirclePlay size={21} />
          </span>
          <div>
            <p className="eyebrow">Jetzt on air</p>
            <h3>{playback.status === 'playing' ? 'Beitrag läuft' : 'Regie bereit'}</h3>
            <p>
              Beitrag {playback.articleId ?? '-'} · Position {playback.position ?? '-'} · Revision{' '}
              {playback.stateRevision ?? status?.lease?.last_state_revision ?? 0}
            </p>
          </div>
        </button>
        <button className="broadcast-hero-card hero-action-card" onClick={() => scrollToSection('broadcast-active')}>
          <span className={`stat-icon ${status?.lease?.runner_id ? 'success' : ''}`}>
            <Cpu size={21} />
          </span>
          <div>
            <p className="eyebrow">Runner</p>
            <h3>{status?.lease?.runner_id ? 'aktiv' : 'bereit'}</h3>
            <p>Lease bis {formatTime(status?.lease?.lease_expires_at)}</p>
          </div>
        </button>
        <button className="broadcast-hero-card hero-action-card" onClick={() => scrollToSection('broadcast-planned')}>
          <span className="stat-icon">
            <CalendarClock size={21} />
          </span>
          <div>
            <p className="eyebrow">Sendeplan</p>
            <h3>{playlists.filter((playlist) => playlist.scheduled_at).length} geplant</h3>
            <p>{playlists.length} Sendungen und Playlists verfügbar</p>
          </div>
        </button>
        <button className="broadcast-hero-card hero-action-card" onClick={openCreate}>
          <span className="stat-icon">
            <Layers3 size={21} />
          </span>
          <div>
            <p className="eyebrow">Overlay</p>
            <h3>{overlays.length} Sets</h3>
            <p>Pro Sendung auswählbar, Standard bleibt das veröffentlichte Main-Overlay.</p>
          </div>
        </button>
      </div>

      <div className="control-surface broadcast-command-deck">
        <div className="control-group">
          <span className="control-label">Transport</span>
          {controls.map(({ action, label, icon: Icon }) => (
            <button
              className={action === 'resume' ? 'primary-button' : action === 'stop' ? 'danger' : ''}
              key={action}
              disabled={!allowedWrite || !allowed.has(action)}
              onClick={() => control(action)}
            >
              <Icon size={17} /> {label}
            </button>
          ))}
        </div>
        <div className="control-group">
          <span className="control-label">Sendung bauen</span>
          <button className="primary-button" disabled={!allowedWrite} onClick={openCreate}>
            <Clapperboard size={17} /> Neue Sendung
          </button>
          <button disabled={!allowedWrite || aiPlanning || Boolean(status?.run)} onClick={() => void createAiPlan()}>
            <WandSparkles size={17} /> {aiPlanning ? 'KI plant …' : 'KI-Plan'}
          </button>
        </div>
        {message && (
          <p className="notice" role="status">
            {message}
          </p>
        )}
      </div>

      <div className="broadcast-layout enhanced-broadcast-layout">
        <section className="broadcast-panel">
          <h3>
            <ListChecks size={18} /> Aktuelle Sendung
          </h3>
          <ol className="broadcast-list">
            {items.length ? (
              items.map((item: any, index: number) => (
                <li key={item.id} className={item.article_id === playback.articleId ? 'active-row' : ''}>
                  <span className="list-index">{index + 1}</span>
                  <span>
                    <strong>{item.title}</strong>
                    <small>{Math.round(Number(item.audio_duration_seconds ?? 0)) || '-'}s Sprecher-Audio</small>
                  </span>
                  <span className={`state-pill ${item.status === 'playing' ? 'live' : item.status === 'played' ? 'success' : ''}`}>
                    {item.status}
                  </span>
                </li>
              ))
            ) : (
              <li>
                <span className="list-index">-</span>
                <span>Keine laufende Sendung</span>
                <span />
              </li>
            )}
          </ol>
        </section>
        <section className="broadcast-panel">
          <h3>
            <Settings2 size={18} /> Regie-Protokoll
          </h3>
          <ol className="timeline-list">
            {(status?.commands ?? []).length ? (
              (status?.commands ?? []).map((command: any) => (
                <li key={command.id}>
                  <span className="list-index">{command.sequence}</span>
                  <span>
                    {command.command} {command.error_details?.reason ?? ''}
                  </span>
                  <span className={`state-pill ${command.status === 'completed' ? 'success' : ''}`}>{command.status}</span>
                </li>
              ))
            ) : (
              <li>
                <span className="list-index">-</span>
                <span>Noch keine Befehle</span>
                <span />
              </li>
            )}
          </ol>
        </section>
      </div>

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
          <button className="primary-button" disabled={!allowedWrite} onClick={openCreate}>
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

      {modal === 'create' && (
        <BroadcastModal title="Neue Sendung erstellen" icon={Clapperboard} onClose={() => setModal(null)}>
          <DraftFields />
          <ArticlePicker />
          {modalError && <p className="settings-permission-note">{modalError}</p>}
          <div className="modal-actions">
            <button className="ghost-button" onClick={() => setModal(null)}>Abbrechen</button>
            <button className="primary-button" disabled={!allowedWrite || !draft.name.trim()} onClick={() => void saveCreate()}>
              <Save size={17} /> Sendung erstellen
            </button>
          </div>
        </BroadcastModal>
      )}
      {modal === 'edit' && editing && (
        <BroadcastModal title="Sendung bearbeiten" icon={Edit3} onClose={() => setModal(null)}>
          <DraftFields />
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
                    <small>{item.status} · {Math.round(Number(item.audio_duration_seconds ?? 0)) || '-'}s</small>
                  </span>
                  <span className="rundown-actions">
                    <button className="ghost-button icon-button" disabled={index === 0} onClick={() => void moveItem(item.id, -1)}><ChevronUp size={15} /></button>
                    <button className="ghost-button icon-button" disabled={index === editingItems.length - 1} onClick={() => void moveItem(item.id, 1)}><ChevronDown size={15} /></button>
                    <button className="ghost-button icon-button danger-text" onClick={() => void removeItem(item.id)}><Trash2 size={15} /></button>
                  </span>
                </li>
              ))}
            </ol>
          </section>
          <ArticlePicker />
          {modalError && <p className="settings-permission-note">{modalError}</p>}
          <div className="modal-actions split-actions">
            <button className="danger" disabled={!allowedWrite} onClick={() => void deletePlaylist(editing.id)}>
              <Trash2 size={17} /> Sendung löschen
            </button>
            <span />
            <button className="ghost-button" onClick={() => setModal(null)}>Schließen</button>
            <button className="primary-button" disabled={!allowedWrite || !draft.name.trim()} onClick={() => void saveEdit()}>
              <Save size={17} /> Änderungen speichern
            </button>
          </div>
        </BroadcastModal>
      )}
    </section>
  );
}
