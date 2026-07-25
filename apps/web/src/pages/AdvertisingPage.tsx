import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import {
  Activity,
  Archive,
  BadgeEuro,
  CalendarClock,
  ChartNoAxesColumnIncreasing,
  CheckCircle2,
  CirclePause,
  CirclePlay,
  Clock3,
  Copy,
  Edit3,
  Eye,
  Film,
  Gauge,
  ImageIcon,
  Megaphone,
  Pause,
  Play,
  Plus,
  Radio,
  RefreshCw,
  RotateCcw,
  Save,
  Search,
  ShieldCheck,
  Sparkles,
  TimerReset,
  Trash2,
  TriangleAlert,
  Upload,
  X,
} from 'lucide-react';
import { api, can, type SessionUser } from '../api/client.js';

type Campaign = {
  id: string;
  name: string;
  advertiser: string;
  status: 'draft' | 'active' | 'paused' | 'completed' | 'archived';
  starts_at?: string | null;
  ends_at?: string | null;
  daily_start?: string | null;
  daily_end?: string | null;
  weekdays: number[];
  timezone: string;
  priority: number;
  max_per_hour: number;
  minimum_gap_seconds: number;
  target_playouts: number;
  target_daily_playouts: number;
  notes: string;
  creative_count: number;
  active_creative_count: number;
  schedule_count: number;
  enabled_schedule_count: number;
  playout_count: number;
  playouts_today: number;
  playouts_7d: number;
  playouts_30d: number;
  completed_playouts: number;
  cancelled_playouts: number;
  failed_playouts: number;
  airtime_seconds: number;
  last_playout_at?: string | null;
};

type Creative = {
  id: string;
  campaign_id: string;
  campaign_name: string;
  name: string;
  creative_type: 'text' | 'banner' | 'image' | 'video';
  headline: string;
  body: string;
  call_to_action: string;
  destination_url: string;
  media_id?: string | null;
  filename?: string | null;
  mime_type?: string | null;
  placement: 'fullscreen' | 'top' | 'lower-third' | 'bottom-right';
  style: 'studio' | 'light' | 'bold' | 'minimal';
  transition: 'fade' | 'slide' | 'zoom' | 'cut';
  duration_seconds: number;
  weight: number;
  active: boolean;
  play_count: number;
  playout_count: number;
  playouts_today: number;
  playouts_7d: number;
  completed_playouts: number;
  last_played_at?: string | null;
};

type Schedule = {
  id: string;
  campaign_id: string;
  campaign_name: string;
  campaign_status: Campaign['status'];
  creative_id?: string | null;
  creative_name?: string | null;
  name: string;
  schedule_type: 'fixed' | 'interval' | 'daypart';
  starts_at?: string | null;
  ends_at?: string | null;
  weekdays: number[];
  daily_start?: string | null;
  daily_end?: string | null;
  interval_minutes: number;
  next_run_at: string;
  enabled: boolean;
  delivery_state: string;
  playout_count: number;
  last_playout_at?: string | null;
};

type Playout = {
  id: string;
  campaign_name: string;
  creative_name: string;
  creative_type: string;
  trigger_type: 'manual' | 'schedule';
  status: 'on_air' | 'completed' | 'cancelled' | 'failed';
  started_at: string;
  ended_at?: string | null;
  expires_at: string;
};

type DeliveryStatus = {
  ready: boolean;
  connected: boolean;
  inputExists?: boolean;
  inputName?: string;
  sceneName?: string;
  currentScene?: string | null;
  currentSceneAttached?: boolean;
  currentSceneVisible?: boolean;
  attachedScenes?: number;
  audioMuted?: boolean;
  volume?: number;
  monitorType?: string;
  urlMatches?: boolean;
  error?: string | null;
};

type Dashboard = {
  campaigns: Campaign[];
  archivedCampaigns: Campaign[];
  creatives: Creative[];
  schedules: Schedule[];
  active: (Playout & Creative & { advertiser?: string }) | null;
  recent: Playout[];
  media: Array<{ id: string; filename: string; mime_type: string }>;
  stats: {
    today: number;
    last_hour: number;
    last_7d: number;
    last_30d: number;
    on_air: number;
    completed_30d: number;
    cancelled_30d: number;
    failed_30d: number;
    avg_duration_seconds: number;
    airtime_seconds_30d: number;
  };
  analytics: {
    daily: Array<{ date: string; total: number; scheduled: number; manual: number; completed: number }>;
    dueSchedules: number;
    readySchedules: number;
    blockedSchedules: number;
  };
  delivery?: DeliveryStatus;
  serverTime?: string;
};

type Tab = 'overview' | 'campaigns' | 'creatives' | 'schedules' | 'analytics' | 'history' | 'archive';
type Modal = 'campaign' | 'creative' | 'schedule' | 'preview' | null;

const allWeekdays = [1, 2, 3, 4, 5, 6, 7];
const weekdayLabels = ['Mo', 'Di', 'Mi', 'Do', 'Fr', 'Sa', 'So'];
const emptyCampaign = {
  name: '',
  advertiser: '',
  status: 'draft',
  startsAt: '',
  endsAt: '',
  dailyStart: '',
  dailyEnd: '',
  weekdays: allWeekdays,
  timezone: 'Europe/Berlin',
  priority: 50,
  maxPerHour: 6,
  minimumGapSeconds: 300,
  targetPlayouts: 0,
  targetDailyPlayouts: 0,
  notes: '',
};
const emptyCreative = {
  campaignId: '',
  name: '',
  creativeType: 'banner',
  headline: '',
  body: '',
  callToAction: '',
  destinationUrl: '',
  mediaId: '',
  placement: 'lower-third',
  style: 'studio',
  transition: 'fade',
  durationSeconds: 10,
  weight: 10,
  active: true,
};
const emptySchedule = {
  campaignId: '',
  creativeId: '',
  name: '',
  scheduleType: 'interval',
  startsAt: '',
  endsAt: '',
  weekdays: allWeekdays,
  dailyStart: '',
  dailyEnd: '',
  intervalMinutes: 30,
  nextRunAt: new Date().toISOString().slice(0, 16),
  enabled: true,
};

const emptyDashboard: Dashboard = {
  campaigns: [],
  archivedCampaigns: [],
  creatives: [],
  schedules: [],
  active: null,
  recent: [],
  media: [],
  stats: {
    today: 0,
    last_hour: 0,
    last_7d: 0,
    last_30d: 0,
    on_air: 0,
    completed_30d: 0,
    cancelled_30d: 0,
    failed_30d: 0,
    avg_duration_seconds: 0,
    airtime_seconds_30d: 0,
  },
  analytics: { daily: [], dueSchedules: 0, readySchedules: 0, blockedSchedules: 0 },
};

const campaignStatusLabels: Record<Campaign['status'], string> = {
  draft: 'Entwurf',
  active: 'Aktiv',
  paused: 'Pausiert',
  completed: 'Abgeschlossen',
  archived: 'Archiviert',
};
const deliveryLabels: Record<string, { label: string; tone: string; detail: string }> = {
  ready: { label: 'Bereit', tone: 'success', detail: 'Die Regel kann bei Fälligkeit ausgespielt werden.' },
  scheduled: { label: 'Eingeplant', tone: 'info', detail: 'Der nächste Zeitpunkt liegt in der Zukunft.' },
  paused: { label: 'Pausiert', tone: '', detail: 'Die Zeitregel ist ausgeschaltet.' },
  'campaign-inactive': { label: 'Kampagne pausiert', tone: 'warning', detail: 'Aktiviere zuerst die Kampagne.' },
  'not-started': {
    label: 'Noch nicht gültig',
    tone: 'info',
    detail: 'Der Gültigkeitszeitraum hat noch nicht begonnen.',
  },
  expired: { label: 'Abgelaufen', tone: 'warning', detail: 'Der Gültigkeitszeitraum ist beendet.' },
  'missing-creative': {
    label: 'Werbemittel fehlt',
    tone: 'danger',
    detail: 'Es gibt kein aktives, sendefähiges Werbemittel.',
  },
  'frequency-cap': { label: 'Frequenzschutz', tone: 'warning', detail: 'Das Stundenlimit der Kampagne ist erreicht.' },
  'minimum-gap': {
    label: 'Mindestabstand',
    tone: 'warning',
    detail: 'Die nächste Ausspielung wartet auf den Mindestabstand.',
  },
};

function localInput(value: string | null | undefined) {
  if (!value) return '';
  const date = new Date(value);
  return Number.isNaN(date.getTime())
    ? ''
    : new Date(date.getTime() - date.getTimezoneOffset() * 60_000).toISOString().slice(0, 16);
}
function iso(value: string) {
  return value ? new Date(value).toISOString() : null;
}
function displayDate(value: string | null | undefined, compact = false) {
  if (!value) return 'offen';
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return value;
  return date.toLocaleString('de-DE', compact ? { dateStyle: 'short', timeStyle: 'short' } : undefined);
}
function secondsLabel(value: number) {
  if (value < 60) return `${value} Sek.`;
  if (value < 3600) return `${Math.round(value / 60)} Min.`;
  return `${(value / 3600).toFixed(1)} Std.`;
}
function remainingLabel(milliseconds: number) {
  const seconds = Math.max(0, Math.ceil(milliseconds / 1000));
  return `${String(Math.floor(seconds / 60)).padStart(2, '0')}:${String(seconds % 60).padStart(2, '0')}`;
}
function campaignReadiness(item: Campaign) {
  if (!item.active_creative_count) return { label: 'Werbemittel fehlt', tone: 'danger' };
  if (!item.enabled_schedule_count) return { label: 'Zeitregel fehlt', tone: 'warning' };
  if (item.failed_playouts) return { label: 'Fehler prüfen', tone: 'warning' };
  return { label: 'Sendefähig', tone: 'success' };
}
function matchesSearch(values: Array<unknown>, query: string) {
  if (!query) return true;
  return values.some((value) =>
    String(value ?? '')
      .toLocaleLowerCase('de')
      .includes(query),
  );
}

function AdvertisingModal({
  title,
  children,
  onClose,
  wide = false,
}: React.PropsWithChildren<{ title: string; onClose: () => void; wide?: boolean }>) {
  return (
    <div className="modal-backdrop" role="dialog" aria-modal="true">
      <div className={`modal-card advertising-modal ${wide ? 'wide' : ''}`}>
        <div className="modal-header">
          <div>
            <p className="eyebrow">Werbestudio</p>
            <h3>{title}</h3>
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

export function AdvertisingPage({ user }: { user: SessionUser }) {
  const [dashboard, setDashboard] = useState<Dashboard>(emptyDashboard);
  const [tab, setTab] = useState<Tab>('overview');
  const [modal, setModal] = useState<Modal>(null);
  const [editingId, setEditingId] = useState('');
  const [previewCreative, setPreviewCreative] = useState<Creative | null>(null);
  const [campaign, setCampaign] = useState<any>(emptyCampaign);
  const [creative, setCreative] = useState<any>(emptyCreative);
  const [schedule, setSchedule] = useState<any>(emptySchedule);
  const [message, setMessage] = useState('');
  const [search, setSearch] = useState('');
  const [statusFilter, setStatusFilter] = useState('all');
  const [busy, setBusy] = useState(false);
  const [uploading, setUploading] = useState(false);
  const [now, setNow] = useState(Date.now());
  const loadingRef = useRef<Promise<void> | null>(null);
  const writable = can(user, 'broadcast:write');

  const load = useCallback(async () => {
    if (loadingRef.current) return loadingRef.current;
    const request = (async () => {
      try {
        setDashboard(await api<Dashboard>('/api/advertising'));
      } catch (error) {
        setMessage(error instanceof Error ? error.message : String(error));
      }
    })().finally(() => {
      loadingRef.current = null;
    });
    loadingRef.current = request;
    return request;
  }, []);

  useEffect(() => {
    void load();
    const clock = window.setInterval(() => setNow(Date.now()), 1000);
    const fallback = window.setInterval(() => {
      if (document.visibilityState === 'visible') void load();
    }, 20_000);
    const events = 'EventSource' in window ? new EventSource('/api/events/internal', { withCredentials: true }) : null;
    const refresh = () => void load();
    events?.addEventListener('advertising-started', refresh);
    events?.addEventListener('advertising-ended', refresh);
    events?.addEventListener('advertising-updated', refresh);
    return () => {
      window.clearInterval(clock);
      window.clearInterval(fallback);
      events?.close();
    };
  }, [load]);

  const activeCampaigns = dashboard.campaigns.filter((item) => item.status === 'active');
  const readyCreatives = dashboard.creatives.filter(
    (item) =>
      item.active &&
      dashboard.campaigns.some(
        (campaignItem) => campaignItem.id === item.campaign_id && campaignItem.status === 'active',
      ),
  );
  const campaignCreatives = useMemo(
    () => dashboard.creatives.filter((item) => item.campaign_id === schedule.campaignId),
    [dashboard.creatives, schedule.campaignId],
  );
  const normalizedSearch = search.trim().toLocaleLowerCase('de');
  const visibleCampaigns = dashboard.campaigns.filter(
    (item) =>
      (statusFilter === 'all' || item.status === statusFilter) &&
      matchesSearch([item.name, item.advertiser, item.notes], normalizedSearch),
  );
  const visibleCreatives = dashboard.creatives.filter((item) =>
    matchesSearch([item.name, item.campaign_name, item.headline, item.body, item.filename], normalizedSearch),
  );
  const visibleSchedules = dashboard.schedules.filter((item) =>
    matchesSearch([item.name, item.campaign_name, item.creative_name, item.delivery_state], normalizedSearch),
  );
  const nextSchedules = [...dashboard.schedules]
    .filter(
      (item) => item.enabled && !['expired', 'campaign-inactive', 'missing-creative'].includes(item.delivery_state),
    )
    .sort((a, b) => new Date(a.next_run_at).getTime() - new Date(b.next_run_at).getTime());
  const maxDaily = Math.max(1, ...dashboard.analytics.daily.map((item) => item.total));
  const completionRate = dashboard.stats.last_30d
    ? Math.round((dashboard.stats.completed_30d / dashboard.stats.last_30d) * 100)
    : 100;

  function toggleWeekday(draft: any, setDraft: (value: any) => void, day: number) {
    const selected = draft.weekdays.includes(day)
      ? draft.weekdays.filter((value: number) => value !== day)
      : [...draft.weekdays, day].sort();
    if (selected.length) setDraft({ ...draft, weekdays: selected });
  }
  function openCampaign(item?: Campaign) {
    setEditingId(item?.id ?? '');
    setCampaign(
      item
        ? {
            name: item.name,
            advertiser: item.advertiser,
            status: item.status,
            startsAt: localInput(item.starts_at),
            endsAt: localInput(item.ends_at),
            dailyStart: item.daily_start?.slice(0, 5) ?? '',
            dailyEnd: item.daily_end?.slice(0, 5) ?? '',
            weekdays: item.weekdays ?? allWeekdays,
            timezone: item.timezone,
            priority: item.priority,
            maxPerHour: item.max_per_hour,
            minimumGapSeconds: item.minimum_gap_seconds,
            targetPlayouts: item.target_playouts ?? 0,
            targetDailyPlayouts: item.target_daily_playouts ?? 0,
            notes: item.notes,
          }
        : { ...emptyCampaign, weekdays: [...allWeekdays] },
    );
    setMessage('');
    setModal('campaign');
  }
  function openCreative(item?: Creative) {
    setEditingId(item?.id ?? '');
    setCreative(
      item
        ? {
            campaignId: item.campaign_id,
            name: item.name,
            creativeType: item.creative_type,
            headline: item.headline,
            body: item.body,
            callToAction: item.call_to_action,
            destinationUrl: item.destination_url,
            mediaId: item.media_id ?? '',
            placement: item.placement,
            style: item.style,
            transition: item.transition,
            durationSeconds: item.duration_seconds,
            weight: item.weight,
            active: item.active,
          }
        : { ...emptyCreative, campaignId: dashboard.campaigns[0]?.id ?? '' },
    );
    setMessage('');
    setModal('creative');
  }
  function openSchedule(item?: Schedule) {
    setEditingId(item?.id ?? '');
    setSchedule(
      item
        ? {
            campaignId: item.campaign_id,
            creativeId: item.creative_id ?? '',
            name: item.name,
            scheduleType: item.schedule_type,
            startsAt: localInput(item.starts_at),
            endsAt: localInput(item.ends_at),
            weekdays: item.weekdays ?? allWeekdays,
            dailyStart: item.daily_start?.slice(0, 5) ?? '',
            dailyEnd: item.daily_end?.slice(0, 5) ?? '',
            intervalMinutes: item.interval_minutes,
            nextRunAt: localInput(item.next_run_at),
            enabled: item.enabled,
          }
        : {
            ...emptySchedule,
            campaignId: activeCampaigns[0]?.id ?? dashboard.campaigns[0]?.id ?? '',
            weekdays: [...allWeekdays],
            nextRunAt: localInput(new Date().toISOString()),
          },
    );
    setMessage('');
    setModal('schedule');
  }
  function openPreview(item: Creative) {
    setPreviewCreative(item);
    setModal('preview');
  }

  async function runAction(action: () => Promise<unknown>, success: string) {
    setBusy(true);
    try {
      await action();
      setMessage(success);
      await load();
      return true;
    } catch (error) {
      setMessage(error instanceof Error ? error.message : String(error));
      return false;
    } finally {
      setBusy(false);
    }
  }
  async function saveCampaign() {
    const saved = await runAction(
      () =>
        api(editingId ? `/api/advertising/campaigns/${editingId}` : '/api/advertising/campaigns', {
          method: editingId ? 'PUT' : 'POST',
          body: JSON.stringify({
            ...campaign,
            startsAt: iso(campaign.startsAt),
            endsAt: iso(campaign.endsAt),
          }),
        }),
      editingId ? 'Kampagne wurde aktualisiert.' : 'Kampagne wurde angelegt.',
    );
    if (saved) setModal(null);
  }
  async function saveCreative() {
    const saved = await runAction(
      () =>
        api(editingId ? `/api/advertising/creatives/${editingId}` : '/api/advertising/creatives', {
          method: editingId ? 'PUT' : 'POST',
          body: JSON.stringify({ ...creative, mediaId: creative.mediaId || null }),
        }),
      editingId ? 'Werbemittel wurde aktualisiert.' : 'Werbemittel wurde angelegt.',
    );
    if (saved) setModal(null);
  }
  async function saveSchedule() {
    const saved = await runAction(
      () =>
        api(editingId ? `/api/advertising/schedules/${editingId}` : '/api/advertising/schedules', {
          method: editingId ? 'PUT' : 'POST',
          body: JSON.stringify({
            ...schedule,
            creativeId: schedule.creativeId || null,
            startsAt: iso(schedule.startsAt),
            endsAt: iso(schedule.endsAt),
            nextRunAt: iso(schedule.nextRunAt),
          }),
        }),
      editingId ? 'Zeitregel wurde aktualisiert.' : 'Zeitregel wurde angelegt.',
    );
    if (saved) setModal(null);
  }
  async function uploadAsset(file?: File) {
    if (!file) return;
    setUploading(true);
    try {
      const form = new FormData();
      form.append('file', file);
      const media = await api<{ id: string }>('/api/advertising/assets', { method: 'POST', body: form });
      setCreative({
        ...creative,
        mediaId: media.id,
        creativeType: file.type.startsWith('video/') ? 'video' : 'image',
      });
      setMessage(`„${file.name}“ wurde geprüft und in die Werbemediathek geladen.`);
      await load();
    } catch (error) {
      setMessage(error instanceof Error ? error.message : String(error));
    } finally {
      setUploading(false);
    }
  }
  function play(creativeId: string) {
    return runAction(
      () => api(`/api/advertising/creatives/${creativeId}/play`, { method: 'POST' }),
      'Werbemittel ist jetzt im laufenden Programm eingeblendet.',
    );
  }
  function stop() {
    if (!dashboard.active) return Promise.resolve();
    return runAction(
      () => api(`/api/advertising/playouts/${dashboard.active!.id}`, { method: 'DELETE' }),
      'Werbeeinblendung wurde beendet.',
    );
  }
  function setCampaignStatus(item: Campaign, status: 'active' | 'paused' | 'completed') {
    return runAction(
      () =>
        api(`/api/advertising/campaigns/${item.id}/status`, {
          method: 'PATCH',
          body: JSON.stringify({ status }),
        }),
      status === 'active' ? `„${item.name}“ ist aktiv.` : `„${item.name}“ wurde pausiert.`,
    );
  }
  function duplicateCampaign(item: Campaign) {
    return runAction(
      () => api(`/api/advertising/campaigns/${item.id}/duplicate`, { method: 'POST' }),
      `„${item.name}“ wurde als deaktivierter Entwurf dupliziert.`,
    );
  }
  function toggleCreative(item: Creative) {
    return runAction(
      () =>
        api(`/api/advertising/creatives/${item.id}/active`, {
          method: 'PATCH',
          body: JSON.stringify({ active: !item.active }),
        }),
      item.active ? 'Werbemittel wurde pausiert.' : 'Werbemittel wurde aktiviert.',
    );
  }
  function toggleSchedule(item: Schedule) {
    return runAction(
      () =>
        api(`/api/advertising/schedules/${item.id}/enabled`, {
          method: 'PATCH',
          body: JSON.stringify({ enabled: !item.enabled }),
        }),
      item.enabled ? 'Zeitregel wurde pausiert.' : 'Zeitregel wurde aktiviert und neu eingeplant.',
    );
  }
  async function remove(kind: 'campaigns' | 'creatives' | 'schedules', id: string, name: string) {
    const detail =
      kind === 'campaigns'
        ? 'Die Kampagne wird archiviert; das Ausspielprotokoll bleibt für Analytics erhalten.'
        : 'Das Element wird entfernt; vorhandene Ausspielstatistiken bleiben erhalten.';
    if (!window.confirm(`„${name}“ löschen?\n\n${detail}`)) return;
    await runAction(
      () => api(`/api/advertising/${kind}/${id}`, { method: 'DELETE' }),
      kind === 'campaigns' ? 'Kampagne wurde sicher archiviert.' : 'Element wurde gelöscht.',
    );
  }
  function restore(item: Campaign) {
    return runAction(
      () => api(`/api/advertising/campaigns/${item.id}/restore`, { method: 'POST' }),
      `„${item.name}“ wurde pausiert wiederhergestellt.`,
    );
  }
  function repairDelivery() {
    return runAction(
      () => api('/api/advertising/diagnostics/repair', { method: 'POST' }),
      'OBS-Werbequelle wurde geprüft und repariert.',
    );
  }

  return (
    <section className="panel advertising-page">
      <div className="page-title advertising-title">
        <div>
          <p className="eyebrow">Vermarktung · Kampagnen · Ausspielung</p>
          <h2>Werbestudio</h2>
          <p>Werbung sendefertig planen, live kontrollieren und mit belastbaren Ausspielungsdaten auswerten.</p>
        </div>
        <div className="advertising-title-actions">
          <button className="ghost-button" onClick={() => void load()}>
            <RefreshCw size={16} /> Aktualisieren
          </button>
          <button className="primary-button" disabled={!writable} onClick={() => openCampaign()}>
            <Plus size={16} /> Neue Kampagne
          </button>
        </div>
      </div>

      <div className="advertising-status-grid advertising-status-grid-modern">
        <button className={dashboard.active ? 'live' : ''} onClick={() => setTab('overview')}>
          <span className="stat-icon live">
            <Radio size={20} />
          </span>
          <span>
            <small>Jetzt im Programm</small>
            <strong>{dashboard.active?.creative_name ?? 'Keine Werbung'}</strong>
            <em>
              {dashboard.active
                ? `noch ${remainingLabel(new Date(dashboard.active.expires_at).getTime() - now)}`
                : 'Overlay ist transparent'}
            </em>
          </span>
        </button>
        <button onClick={() => setTab('campaigns')}>
          <span className="stat-icon">
            <BadgeEuro size={20} />
          </span>
          <span>
            <small>Aktive Kampagnen</small>
            <strong>{activeCampaigns.length}</strong>
            <em>{dashboard.campaigns.length} verwaltet</em>
          </span>
        </button>
        <button onClick={() => setTab('analytics')}>
          <span className="stat-icon">
            <ChartNoAxesColumnIncreasing size={20} />
          </span>
          <span>
            <small>Ausspielungen heute</small>
            <strong>{dashboard.stats.today}</strong>
            <em>{dashboard.stats.last_hour} in der letzten Stunde</em>
          </span>
        </button>
        <button onClick={() => setTab('schedules')}>
          <span className="stat-icon">
            <CalendarClock size={20} />
          </span>
          <span>
            <small>Nächste Ausspielung</small>
            <strong>{nextSchedules[0] ? displayDate(nextSchedules[0].next_run_at, true) : 'Nicht geplant'}</strong>
            <em>{nextSchedules.length} Regeln aktiv</em>
          </span>
        </button>
        <button className={dashboard.delivery?.ready ? 'ready' : 'warning'} onClick={() => setTab('overview')}>
          <span className="stat-icon">
            <ShieldCheck size={20} />
          </span>
          <span>
            <small>OBS-Ausspielweg</small>
            <strong>{dashboard.delivery?.ready ? 'Sendebereit' : 'Prüfung nötig'}</strong>
            <em>{dashboard.delivery?.currentScene ?? 'OBS nicht erreichbar'}</em>
          </span>
        </button>
      </div>

      <div className="advertising-toolbar">
        <nav className="advertising-tabs">
          {(
            [
              ['overview', 'Cockpit', Activity, 0],
              ['campaigns', 'Kampagnen', BadgeEuro, dashboard.campaigns.length],
              ['creatives', 'Werbemittel', Megaphone, dashboard.creatives.length],
              ['schedules', 'Zeit & Rotation', CalendarClock, dashboard.schedules.length],
              ['analytics', 'Analytics', ChartNoAxesColumnIncreasing, dashboard.stats.last_30d],
              ['history', 'Protokoll', Clock3, dashboard.recent.length],
              ['archive', 'Archiv', Archive, dashboard.archivedCampaigns.length],
            ] as const
          ).map(([value, label, Icon, count]) => (
            <button className={tab === value ? 'active' : ''} key={value} onClick={() => setTab(value)}>
              <Icon size={15} /> {label}
              {count > 0 && <span>{count}</span>}
            </button>
          ))}
        </nav>
        <label className="advertising-search">
          <Search size={16} />
          <input
            value={search}
            onChange={(event) => setSearch(event.target.value)}
            placeholder="Kampagne, Text oder Regel suchen …"
          />
          {search && (
            <button className="icon-button" onClick={() => setSearch('')} aria-label="Suche leeren">
              <X size={14} />
            </button>
          )}
        </label>
      </div>
      {message && <p className="notice">{message}</p>}

      {tab === 'overview' && (
        <div className="advertising-cockpit">
          <article className={`advertising-onair ${dashboard.active ? 'active' : ''}`}>
            <header>
              <span>
                <Radio size={17} /> On-Air-Steuerung
              </span>
              <span className={`state-pill ${dashboard.active ? 'live' : 'success'}`}>
                {dashboard.active ? 'WERBUNG LÄUFT' : 'PROGRAMM FREI'}
              </span>
            </header>
            {dashboard.active ? (
              <div className="advertising-onair-content">
                <span className={`advertising-creative-icon ${dashboard.active.creative_type}`}>
                  {dashboard.active.creative_type === 'video' ? <Film /> : <Megaphone />}
                </span>
                <div>
                  <p>{dashboard.active.campaign_name}</p>
                  <h3>{dashboard.active.creative_name}</h3>
                  <span>{dashboard.active.headline || dashboard.active.body}</span>
                </div>
                <strong>{remainingLabel(new Date(dashboard.active.expires_at).getTime() - now)}</strong>
                <button className="danger" disabled={!writable || busy} onClick={() => void stop()}>
                  <X size={15} /> Sofort ausblenden
                </button>
              </div>
            ) : (
              <div className="advertising-empty-onair">
                <CheckCircle2 size={32} />
                <div>
                  <strong>Keine Werbeeinblendung aktiv</strong>
                  <span>Das Werbe-Overlay bleibt transparent über dem laufenden Programm.</span>
                </div>
              </div>
            )}
          </article>

          <article className={`advertising-diagnostic ${dashboard.delivery?.ready ? 'ready' : 'warning'}`}>
            <header>
              <span>
                <ShieldCheck size={17} /> Ausspielweg zu OBS
              </span>
              <span className={`state-pill ${dashboard.delivery?.ready ? 'success' : 'warning'}`}>
                {dashboard.delivery?.ready ? 'bereit' : 'prüfen'}
              </span>
            </header>
            <div className="advertising-diagnostic-grid">
              <span>
                <small>Verbindung</small>
                <strong>{dashboard.delivery?.connected ? 'Verbunden' : 'Getrennt'}</strong>
              </span>
              <span>
                <small>Browserquelle</small>
                <strong>{dashboard.delivery?.inputExists ? 'Vorhanden' : 'Fehlt'}</strong>
              </span>
              <span>
                <small>Aktuelle Szene</small>
                <strong>{dashboard.delivery?.currentSceneAttached ? 'Eingebunden' : 'Nicht eingebunden'}</strong>
              </span>
              <span>
                <small>Audio</small>
                <strong>
                  {dashboard.delivery?.audioMuted
                    ? 'Stumm'
                    : `${Math.round((dashboard.delivery?.volume ?? 0) * 100)} %`}
                </strong>
              </span>
            </div>
            {!dashboard.delivery?.ready && (
              <div className="advertising-diagnostic-action">
                <TriangleAlert size={17} />
                <span>
                  {dashboard.delivery?.error ||
                    'Die Werbequelle ist in der aktuellen OBS-Szene noch nicht vollständig sendefähig.'}
                </span>
                <button disabled={!writable || busy} onClick={() => void repairDelivery()}>
                  <Sparkles size={15} /> Automatisch reparieren
                </button>
              </div>
            )}
            <details>
              <summary>Technische Details</summary>
              <code>
                {dashboard.delivery?.inputName ?? 'ANS_AD_OVERLAY'} ·{' '}
                {dashboard.delivery?.sceneName ?? '20_ADVERTISING'} · {dashboard.delivery?.attachedScenes ?? 0} Szenen
              </code>
            </details>
          </article>

          <article className="advertising-next-card">
            <header>
              <span>
                <CalendarClock size={17} /> Als Nächstes
              </span>
              <button className="link-button" onClick={() => setTab('schedules')}>
                Alle Zeitregeln
              </button>
            </header>
            <div className="advertising-next-list">
              {nextSchedules.slice(0, 4).map((item) => {
                const state = deliveryLabels[item.delivery_state] ?? deliveryLabels.scheduled;
                return (
                  <button key={item.id} onClick={() => openSchedule(item)}>
                    <time>
                      {new Date(item.next_run_at).toLocaleTimeString('de-DE', { hour: '2-digit', minute: '2-digit' })}
                    </time>
                    <span>
                      <strong>{item.name}</strong>
                      <small>
                        {item.campaign_name} · {item.creative_name || 'Rotation'}
                      </small>
                    </span>
                    <em className={`state-pill ${state.tone}`}>{state.label}</em>
                  </button>
                );
              })}
              {!nextSchedules.length && <div className="empty-state">Keine sendefähige Ausspielung eingeplant.</div>}
            </div>
          </article>

          <article className="advertising-performance-card">
            <header>
              <span>
                <Gauge size={17} /> Leistung, letzte 30 Tage
              </span>
              <button className="link-button" onClick={() => setTab('analytics')}>
                Details
              </button>
            </header>
            <div className="advertising-kpi-row">
              <span>
                <strong>{dashboard.stats.last_30d}</strong>
                <small>Ausspielungen</small>
              </span>
              <span>
                <strong>{completionRate} %</strong>
                <small>vollständig</small>
              </span>
              <span>
                <strong>{secondsLabel(dashboard.stats.airtime_seconds_30d)}</strong>
                <small>Werbezeit</small>
              </span>
              <span>
                <strong>{secondsLabel(dashboard.stats.avg_duration_seconds)}</strong>
                <small>Ø Dauer</small>
              </span>
            </div>
          </article>

          <article className="advertising-quick-panel">
            <header>
              <span>
                <Sparkles size={17} /> Schnell erstellen
              </span>
            </header>
            <div>
              <button className="primary-button" disabled={!writable} onClick={() => openCampaign()}>
                <Plus size={16} /> Kampagne
              </button>
              <button disabled={!writable || !dashboard.campaigns.length} onClick={() => openCreative()}>
                <Megaphone size={16} /> Werbemittel
              </button>
              <button disabled={!writable || !activeCampaigns.length} onClick={() => openSchedule()}>
                <TimerReset size={16} /> Zeitregel
              </button>
            </div>
            <p>
              Eine Kampagne ist erst sendefähig, wenn mindestens ein aktives Werbemittel und eine aktive Zeitregel
              vorhanden sind.
            </p>
          </article>
        </div>
      )}

      {tab === 'campaigns' && (
        <>
          <div className="advertising-section-head">
            <div>
              <h3>Kampagnen</h3>
              <p>Ziele, Freigabe, Frequenzschutz und Ausspielung an einem Ort.</p>
            </div>
            <label>
              Status{' '}
              <select value={statusFilter} onChange={(event) => setStatusFilter(event.target.value)}>
                <option value="all">Alle</option>
                <option value="active">Aktiv</option>
                <option value="paused">Pausiert</option>
                <option value="draft">Entwurf</option>
                <option value="completed">Abgeschlossen</option>
              </select>
            </label>
          </div>
          <div className="advertising-card-grid">
            {visibleCampaigns.map((item) => {
              const readiness = campaignReadiness(item);
              const target = item.target_playouts || 0;
              const progress = target ? Math.min(100, Math.round((item.playout_count / target) * 100)) : 0;
              return (
                <article key={item.id} className={`advertising-campaign-card ${item.status}`}>
                  <div className="advertising-card-header">
                    <span className={`state-pill ${item.status === 'active' ? 'success' : ''}`}>
                      {campaignStatusLabels[item.status]}
                    </span>
                    <span className={`state-pill ${readiness.tone}`}>{readiness.label}</span>
                  </div>
                  <div className="advertising-campaign-title">
                    <span className="stat-icon">
                      <BadgeEuro size={18} />
                    </span>
                    <div>
                      <h3>{item.name}</h3>
                      <p>{item.advertiser || 'Eigenwerbung'}</p>
                    </div>
                  </div>
                  <div className="advertising-mini-kpis">
                    <span>
                      <strong>{item.playouts_today}</strong>
                      <small>heute</small>
                    </span>
                    <span>
                      <strong>{item.playouts_7d}</strong>
                      <small>7 Tage</small>
                    </span>
                    <span>
                      <strong>
                        {item.active_creative_count}/{item.creative_count}
                      </strong>
                      <small>Werbemittel</small>
                    </span>
                    <span>
                      <strong>
                        {item.enabled_schedule_count}/{item.schedule_count}
                      </strong>
                      <small>Zeitregeln</small>
                    </span>
                  </div>
                  {target > 0 && (
                    <div className="advertising-progress">
                      <span>
                        <small>Kampagnenziel</small>
                        <strong>
                          {item.playout_count} / {target}
                        </strong>
                      </span>
                      <i>
                        <b style={{ width: `${progress}%` }} />
                      </i>
                    </div>
                  )}
                  <dl>
                    <div>
                      <dt>Zeitraum</dt>
                      <dd>
                        {displayDate(item.starts_at, true)} – {displayDate(item.ends_at, true)}
                      </dd>
                    </div>
                    <div>
                      <dt>Frequenzschutz</dt>
                      <dd>
                        max. {item.max_per_hour}/h · {secondsLabel(item.minimum_gap_seconds)} Abstand
                      </dd>
                    </div>
                    <div>
                      <dt>Letzte Ausspielung</dt>
                      <dd>{displayDate(item.last_playout_at, true)}</dd>
                    </div>
                  </dl>
                  <div className="advertising-card-actions advertising-action-wrap">
                    <button
                      className={item.status === 'active' ? 'warning-button' : 'primary-button'}
                      disabled={!writable || busy}
                      onClick={() => void setCampaignStatus(item, item.status === 'active' ? 'paused' : 'active')}
                    >
                      {item.status === 'active' ? <Pause size={15} /> : <Play size={15} />}{' '}
                      {item.status === 'active' ? 'Pausieren' : 'Aktivieren'}
                    </button>
                    <button className="ghost-button icon-button" onClick={() => openCampaign(item)} title="Bearbeiten">
                      <Edit3 size={15} />
                    </button>
                    <button
                      className="ghost-button icon-button"
                      disabled={!writable || busy}
                      onClick={() => void duplicateCampaign(item)}
                      title="Duplizieren"
                    >
                      <Copy size={15} />
                    </button>
                    <button
                      className="ghost-button icon-button danger-text"
                      disabled={!writable || busy}
                      onClick={() => void remove('campaigns', item.id, item.name)}
                      title="Löschen und archivieren"
                    >
                      <Trash2 size={15} />
                    </button>
                  </div>
                </article>
              );
            })}
            {!visibleCampaigns.length && <div className="empty-state">Keine Kampagne entspricht der Auswahl.</div>}
          </div>
        </>
      )}

      {tab === 'creatives' && (
        <>
          <div className="advertising-section-head">
            <div>
              <h3>Werbemittel</h3>
              <p>Clips, Bilder, Banner und Texte vorab prüfen und gezielt ins laufende Programm übernehmen.</p>
            </div>
            <button
              className="primary-button"
              disabled={!writable || !dashboard.campaigns.length}
              onClick={() => openCreative()}
            >
              <Plus size={15} /> Werbemittel
            </button>
          </div>
          <div className="advertising-creative-list">
            {visibleCreatives.map((item) => (
              <article key={item.id} className={!item.active ? 'disabled' : ''}>
                <button
                  className={`advertising-creative-icon ${item.creative_type}`}
                  onClick={() => openPreview(item)}
                  title="Vorschau"
                >
                  {item.creative_type === 'video' ? (
                    <Film />
                  ) : item.creative_type === 'image' ? (
                    <ImageIcon />
                  ) : (
                    <Megaphone />
                  )}
                </button>
                <span>
                  <strong>{item.name}</strong>
                  <small>
                    {item.campaign_name} · {item.creative_type} · {item.placement}
                  </small>
                  <small>{item.headline || item.filename || item.body}</small>
                </span>
                <span>
                  <strong>{item.playouts_7d}×</strong>
                  <small>7 Tage · {item.playouts_today} heute</small>
                </span>
                <span className={`state-pill ${item.active ? 'success' : ''}`}>
                  {item.active ? 'aktiv' : 'pausiert'}
                </span>
                <div>
                  <button
                    className="primary-button"
                    disabled={!writable || busy || !readyCreatives.some((ready) => ready.id === item.id)}
                    onClick={() => void play(item.id)}
                  >
                    <CirclePlay size={15} /> Jetzt
                  </button>
                  <button className="ghost-button icon-button" onClick={() => openPreview(item)} title="Vorschau">
                    <Eye size={15} />
                  </button>
                  <button
                    className="ghost-button icon-button"
                    disabled={!writable || busy}
                    onClick={() => void toggleCreative(item)}
                    title={item.active ? 'Pausieren' : 'Aktivieren'}
                  >
                    {item.active ? <CirclePause size={15} /> : <CirclePlay size={15} />}
                  </button>
                  <button className="ghost-button icon-button" onClick={() => openCreative(item)} title="Bearbeiten">
                    <Edit3 size={15} />
                  </button>
                  <button
                    className="ghost-button icon-button danger-text"
                    disabled={!writable || busy}
                    onClick={() => void remove('creatives', item.id, item.name)}
                    title="Löschen"
                  >
                    <Trash2 size={15} />
                  </button>
                </div>
              </article>
            ))}
            {!visibleCreatives.length && <div className="empty-state">Keine Werbemittel gefunden.</div>}
          </div>
        </>
      )}

      {tab === 'schedules' && (
        <>
          <div className="advertising-section-head">
            <div>
              <h3>Zeit &amp; Rotation</h3>
              <p>Jede Regel zeigt, ob sie bereit ist oder warum die nächste Ausspielung noch wartet.</p>
            </div>
            <button
              className="primary-button"
              disabled={!writable || !activeCampaigns.length}
              onClick={() => openSchedule()}
            >
              <Plus size={15} /> Zeitregel
            </button>
          </div>
          <div className="advertising-schedule-list">
            {visibleSchedules.map((item) => {
              const state = deliveryLabels[item.delivery_state] ?? deliveryLabels.scheduled;
              return (
                <article key={item.id} className={!item.enabled ? 'disabled' : ''}>
                  <span className={`stat-icon ${item.enabled ? 'success' : ''}`}>
                    {item.schedule_type === 'fixed' ? <CalendarClock size={18} /> : <TimerReset size={18} />}
                  </span>
                  <span>
                    <strong>{item.name}</strong>
                    <small>
                      {item.campaign_name} · {item.creative_name || 'gewichtete Rotation'}
                    </small>
                    <small>{state.detail}</small>
                  </span>
                  <span>
                    <strong>
                      {item.schedule_type === 'fixed' ? 'Einmalig' : `alle ${item.interval_minutes} Min.`}
                    </strong>
                    <small>Nächster Lauf: {displayDate(item.next_run_at, true)}</small>
                  </span>
                  <span className={`state-pill ${state.tone}`}>{state.label}</span>
                  <div>
                    <button
                      className="ghost-button icon-button"
                      disabled={!writable || busy}
                      onClick={() => void toggleSchedule(item)}
                      title={item.enabled ? 'Pausieren' : 'Aktivieren'}
                    >
                      {item.enabled ? <CirclePause size={15} /> : <CirclePlay size={15} />}
                    </button>
                    <button className="ghost-button icon-button" onClick={() => openSchedule(item)} title="Bearbeiten">
                      <Edit3 size={15} />
                    </button>
                    <button
                      className="ghost-button icon-button danger-text"
                      disabled={!writable || busy}
                      onClick={() => void remove('schedules', item.id, item.name)}
                      title="Löschen"
                    >
                      <Trash2 size={15} />
                    </button>
                  </div>
                </article>
              );
            })}
            {!visibleSchedules.length && <div className="empty-state">Keine Zeitregeln gefunden.</div>}
          </div>
        </>
      )}

      {tab === 'analytics' && (
        <div className="advertising-analytics">
          <div className="advertising-analytics-kpis">
            <article>
              <span>
                <ChartNoAxesColumnIncreasing />
              </span>
              <div>
                <small>30 Tage</small>
                <strong>{dashboard.stats.last_30d}</strong>
                <em>Ausspielungen</em>
              </div>
            </article>
            <article>
              <span>
                <CheckCircle2 />
              </span>
              <div>
                <small>Erfolgsquote</small>
                <strong>{completionRate} %</strong>
                <em>{dashboard.stats.failed_30d} fehlgeschlagen</em>
              </div>
            </article>
            <article>
              <span>
                <Clock3 />
              </span>
              <div>
                <small>Werbezeit</small>
                <strong>{secondsLabel(dashboard.stats.airtime_seconds_30d)}</strong>
                <em>Ø {secondsLabel(dashboard.stats.avg_duration_seconds)}</em>
              </div>
            </article>
            <article>
              <span>
                <Gauge />
              </span>
              <div>
                <small>Planstatus</small>
                <strong>{dashboard.analytics.readySchedules}</strong>
                <em>
                  {dashboard.analytics.dueSchedules} fällig · {dashboard.analytics.blockedSchedules} blockiert
                </em>
              </div>
            </article>
          </div>
          <article className="advertising-chart-card">
            <header>
              <div>
                <h3>Ausspielungen der letzten 14 Tage</h3>
                <p>Tatsächlich gestartete Einblendungen, getrennt nach Zeitplan und manueller Regie.</p>
              </div>
            </header>
            <div className="advertising-bar-chart">
              {dashboard.analytics.daily.map((item) => (
                <div key={item.date} title={`${item.total} Ausspielungen`}>
                  <span className="advertising-bar-value">{item.total || ''}</span>
                  <i style={{ height: `${Math.max(item.total ? 7 : 1, (item.total / maxDaily) * 100)}%` }}>
                    <b style={{ height: `${item.total ? (item.scheduled / item.total) * 100 : 0}%` }} />
                  </i>
                  <small>
                    {new Date(`${item.date}T12:00:00`).toLocaleDateString('de-DE', {
                      day: '2-digit',
                      month: '2-digit',
                    })}
                  </small>
                </div>
              ))}
            </div>
            <footer>
              <span>
                <i className="scheduled" /> Zeitplan
              </span>
              <span>
                <i className="manual" /> Manuelle Regie
              </span>
            </footer>
          </article>
          <article className="advertising-campaign-report">
            <header>
              <h3>Kampagnenleistung</h3>
              <p>Ausspielungen sind technische Playouts – keine erfundene Reichweite oder Klickzahl.</p>
            </header>
            <div className="advertising-report-table">
              <div className="head">
                <span>Kampagne</span>
                <span>Heute</span>
                <span>7 Tage</span>
                <span>Gesamt</span>
                <span>Werbezeit</span>
                <span>Status</span>
              </div>
              {dashboard.campaigns.map((item) => (
                <div key={item.id}>
                  <span>
                    <strong>{item.name}</strong>
                    <small>{item.advertiser || 'Eigenwerbung'}</small>
                  </span>
                  <span>{item.playouts_today}</span>
                  <span>{item.playouts_7d}</span>
                  <span>{item.playout_count}</span>
                  <span>{secondsLabel(item.airtime_seconds)}</span>
                  <span className={`state-pill ${item.status === 'active' ? 'success' : ''}`}>
                    {campaignStatusLabels[item.status]}
                  </span>
                </div>
              ))}
            </div>
          </article>
        </div>
      )}

      {tab === 'history' && (
        <div className="advertising-history">
          {dashboard.recent.map((item) => (
            <article key={item.id}>
              <span
                className={`state-pill ${item.status === 'completed' ? 'success' : item.status === 'on_air' ? 'live' : item.status === 'failed' ? 'danger' : ''}`}
              >
                {item.status === 'completed' ? 'vollständig' : item.status === 'on_air' ? 'on air' : item.status}
              </span>
              <span>
                <strong>{item.creative_name}</strong>
                <small>
                  {item.campaign_name} · {item.trigger_type === 'manual' ? 'manuelle Regie' : 'Zeitplan'}
                </small>
              </span>
              <span>
                <strong>
                  {secondsLabel(
                    Math.max(
                      0,
                      (new Date(item.ended_at ?? item.expires_at).getTime() - new Date(item.started_at).getTime()) /
                        1000,
                    ),
                  )}
                </strong>
                <small>Dauer</small>
              </span>
              <time>{displayDate(item.started_at)}</time>
            </article>
          ))}
          {!dashboard.recent.length && <div className="empty-state">Noch keine Ausspielungen protokolliert.</div>}
        </div>
      )}

      {tab === 'archive' && (
        <div className="advertising-archive">
          <div className="advertising-section-head">
            <div>
              <h3>Archiv</h3>
              <p>Gelöschte Kampagnen bleiben mit ihrer Ausspielhistorie wiederherstellbar.</p>
            </div>
          </div>
          {dashboard.archivedCampaigns.map((item) => (
            <article key={item.id}>
              <span className="stat-icon">
                <Archive size={18} />
              </span>
              <span>
                <strong>{item.name}</strong>
                <small>
                  {item.advertiser || 'Eigenwerbung'} · {item.playout_count} Ausspielungen
                </small>
              </span>
              <time>{displayDate(item.last_playout_at)}</time>
              <button disabled={!writable || busy} onClick={() => void restore(item)}>
                <RotateCcw size={15} /> Wiederherstellen
              </button>
            </article>
          ))}
          {!dashboard.archivedCampaigns.length && <div className="empty-state">Das Kampagnenarchiv ist leer.</div>}
        </div>
      )}

      {modal === 'campaign' && (
        <AdvertisingModal title={editingId ? 'Kampagne bearbeiten' : 'Neue Kampagne'} onClose={() => setModal(null)}>
          <div className="settings-grid">
            <label className="settings-option">
              <span>Kampagnenname</span>
              <input
                value={campaign.name}
                onChange={(event) => setCampaign({ ...campaign, name: event.target.value })}
              />
            </label>
            <label className="settings-option">
              <span>Werbepartner / Sponsor</span>
              <input
                value={campaign.advertiser}
                onChange={(event) => setCampaign({ ...campaign, advertiser: event.target.value })}
                placeholder="Leer = Eigenwerbung"
              />
            </label>
            <label className="settings-option">
              <span>Status</span>
              <select
                value={campaign.status}
                onChange={(event) => setCampaign({ ...campaign, status: event.target.value })}
              >
                <option value="draft">Entwurf</option>
                <option value="active">Aktiv</option>
                <option value="paused">Pausiert</option>
                <option value="completed">Abgeschlossen</option>
              </select>
            </label>
            <label className="settings-option">
              <span>Priorität: {campaign.priority}</span>
              <input
                type="range"
                min="0"
                max="100"
                value={campaign.priority}
                onChange={(event) => setCampaign({ ...campaign, priority: Number(event.target.value) })}
              />
            </label>
            <label className="settings-option">
              <span>Startdatum</span>
              <input
                type="datetime-local"
                value={campaign.startsAt}
                onChange={(event) => setCampaign({ ...campaign, startsAt: event.target.value })}
              />
            </label>
            <label className="settings-option">
              <span>Enddatum</span>
              <input
                type="datetime-local"
                value={campaign.endsAt}
                onChange={(event) => setCampaign({ ...campaign, endsAt: event.target.value })}
              />
            </label>
            <label className="settings-option">
              <span>Täglich frühestens</span>
              <input
                type="time"
                value={campaign.dailyStart}
                onChange={(event) => setCampaign({ ...campaign, dailyStart: event.target.value })}
              />
            </label>
            <label className="settings-option">
              <span>Täglich spätestens</span>
              <input
                type="time"
                value={campaign.dailyEnd}
                onChange={(event) => setCampaign({ ...campaign, dailyEnd: event.target.value })}
              />
            </label>
            <label className="settings-option">
              <span>Maximal pro Stunde</span>
              <input
                type="number"
                min="1"
                max="60"
                value={campaign.maxPerHour}
                onChange={(event) => setCampaign({ ...campaign, maxPerHour: Number(event.target.value) })}
              />
            </label>
            <label className="settings-option">
              <span>Mindestabstand (Sekunden)</span>
              <input
                type="number"
                min="10"
                max="86400"
                value={campaign.minimumGapSeconds}
                onChange={(event) => setCampaign({ ...campaign, minimumGapSeconds: Number(event.target.value) })}
              />
            </label>
            <label className="settings-option">
              <span>Gesamtziel (optional)</span>
              <input
                type="number"
                min="0"
                value={campaign.targetPlayouts}
                onChange={(event) => setCampaign({ ...campaign, targetPlayouts: Number(event.target.value) })}
              />
            </label>
            <label className="settings-option">
              <span>Tagesziel (optional)</span>
              <input
                type="number"
                min="0"
                value={campaign.targetDailyPlayouts}
                onChange={(event) => setCampaign({ ...campaign, targetDailyPlayouts: Number(event.target.value) })}
              />
            </label>
          </div>
          <div className="weekday-picker">
            {weekdayLabels.map((label, index) => (
              <button
                type="button"
                className={campaign.weekdays.includes(index + 1) ? 'active' : ''}
                key={label}
                onClick={() => toggleWeekday(campaign, setCampaign, index + 1)}
              >
                {label}
              </button>
            ))}
          </div>
          <label className="settings-option">
            <span>Interne Notizen</span>
            <textarea
              rows={3}
              value={campaign.notes}
              onChange={(event) => setCampaign({ ...campaign, notes: event.target.value })}
            />
          </label>
          <div className="modal-actions">
            <button className="ghost-button" onClick={() => setModal(null)}>
              Abbrechen
            </button>
            <button
              className="primary-button"
              disabled={busy || !campaign.name.trim()}
              onClick={() => void saveCampaign()}
            >
              <Save size={16} /> Speichern
            </button>
          </div>
        </AdvertisingModal>
      )}

      {modal === 'creative' && (
        <AdvertisingModal
          title={editingId ? 'Werbemittel bearbeiten' : 'Neues Werbemittel'}
          onClose={() => setModal(null)}
        >
          <div className="advertising-type-picker">
            {(['text', 'banner', 'image', 'video'] as const).map((value) => (
              <button
                type="button"
                key={value}
                className={creative.creativeType === value ? 'active' : ''}
                onClick={() => setCreative({ ...creative, creativeType: value })}
              >
                {value === 'video' ? (
                  <Film size={17} />
                ) : value === 'image' ? (
                  <ImageIcon size={17} />
                ) : (
                  <Megaphone size={17} />
                )}
                {value}
              </button>
            ))}
          </div>
          <div className="settings-grid">
            <label className="settings-option">
              <span>Kampagne</span>
              <select
                value={creative.campaignId}
                onChange={(event) => setCreative({ ...creative, campaignId: event.target.value })}
              >
                <option value="">Auswählen …</option>
                {dashboard.campaigns.map((item) => (
                  <option value={item.id} key={item.id}>
                    {item.name}
                  </option>
                ))}
              </select>
            </label>
            <label className="settings-option">
              <span>Interner Name</span>
              <input
                value={creative.name}
                onChange={(event) => setCreative({ ...creative, name: event.target.value })}
              />
            </label>
            <label className="settings-option">
              <span>Überschrift</span>
              <input
                value={creative.headline}
                onChange={(event) => setCreative({ ...creative, headline: event.target.value })}
              />
            </label>
            <label className="settings-option">
              <span>Call-to-Action</span>
              <input
                value={creative.callToAction}
                onChange={(event) => setCreative({ ...creative, callToAction: event.target.value })}
                placeholder="Jetzt informieren"
              />
            </label>
            <label className="settings-option">
              <span>Ziel-URL</span>
              <input
                type="url"
                value={creative.destinationUrl}
                onChange={(event) => setCreative({ ...creative, destinationUrl: event.target.value })}
                placeholder="https://…"
              />
            </label>
          </div>
          <label className="settings-option">
            <span>Werbetext</span>
            <textarea
              rows={3}
              value={creative.body}
              onChange={(event) => setCreative({ ...creative, body: event.target.value })}
            />
          </label>
          {(creative.creativeType === 'image' || creative.creativeType === 'video') && (
            <div className="advertising-media-picker">
              <label className="settings-option">
                <span>Mediathek</span>
                <select
                  value={creative.mediaId}
                  onChange={(event) => setCreative({ ...creative, mediaId: event.target.value })}
                >
                  <option value="">Datei auswählen …</option>
                  {dashboard.media
                    .filter((item) =>
                      item.mime_type.startsWith(creative.creativeType === 'video' ? 'video/' : 'image/'),
                    )
                    .map((item) => (
                      <option key={item.id} value={item.id}>
                        {item.filename}
                      </option>
                    ))}
                </select>
              </label>
              <label className="ghost-button advertising-upload">
                <Upload size={16} /> {uploading ? 'Wird geprüft …' : 'Neue Datei hochladen'}
                <input
                  type="file"
                  hidden
                  accept={
                    creative.creativeType === 'video'
                      ? 'video/mp4,video/webm,video/quicktime'
                      : 'image/png,image/jpeg,image/webp'
                  }
                  disabled={uploading}
                  onChange={(event) => void uploadAsset(event.target.files?.[0])}
                />
              </label>
            </div>
          )}
          <div className="settings-grid">
            <label className="settings-option">
              <span>Platzierung</span>
              <select
                value={creative.placement}
                onChange={(event) => setCreative({ ...creative, placement: event.target.value })}
              >
                <option value="lower-third">Bauchbinde</option>
                <option value="top">Oben</option>
                <option value="bottom-right">Rechts unten</option>
                <option value="fullscreen">Vollbild</option>
              </select>
            </label>
            <label className="settings-option">
              <span>Design</span>
              <select
                value={creative.style}
                onChange={(event) => setCreative({ ...creative, style: event.target.value })}
              >
                <option value="studio">Studio</option>
                <option value="light">Hell</option>
                <option value="bold">Signalstark</option>
                <option value="minimal">Minimal</option>
              </select>
            </label>
            <label className="settings-option">
              <span>Animation</span>
              <select
                value={creative.transition}
                onChange={(event) => setCreative({ ...creative, transition: event.target.value })}
              >
                <option value="fade">Einblenden</option>
                <option value="slide">Hereinfahren</option>
                <option value="zoom">Aufzoomen</option>
                <option value="cut">Schnitt</option>
              </select>
            </label>
            <label className="settings-option">
              <span>Dauer: {creative.durationSeconds}s</span>
              <input
                type="range"
                min="2"
                max="300"
                value={creative.durationSeconds}
                onChange={(event) => setCreative({ ...creative, durationSeconds: Number(event.target.value) })}
              />
            </label>
            <label className="settings-option">
              <span>Rotationsgewicht: {creative.weight}</span>
              <input
                type="range"
                min="1"
                max="100"
                value={creative.weight}
                onChange={(event) => setCreative({ ...creative, weight: Number(event.target.value) })}
              />
            </label>
            <label className="settings-option">
              <span>
                <input
                  type="checkbox"
                  checked={creative.active}
                  onChange={(event) => setCreative({ ...creative, active: event.target.checked })}
                />{' '}
                Werbemittel aktiv
              </span>
            </label>
          </div>
          <div className={`advertising-preview ${creative.style}`}>
            <span>WERBUNG</span>
            <strong>{creative.headline || creative.name || 'Werbeüberschrift'}</strong>
            <small>{creative.body || 'Werbetext in der Programmvorschau'}</small>
          </div>
          <div className="modal-actions">
            <button className="ghost-button" onClick={() => setModal(null)}>
              Abbrechen
            </button>
            <button
              className="primary-button"
              disabled={busy || !creative.name.trim() || !creative.campaignId}
              onClick={() => void saveCreative()}
            >
              <Save size={16} /> Speichern
            </button>
          </div>
        </AdvertisingModal>
      )}

      {modal === 'schedule' && (
        <AdvertisingModal title={editingId ? 'Zeitregel bearbeiten' : 'Neue Zeitregel'} onClose={() => setModal(null)}>
          <div className="settings-grid">
            <label className="settings-option">
              <span>Kampagne</span>
              <select
                value={schedule.campaignId}
                onChange={(event) => setSchedule({ ...schedule, campaignId: event.target.value, creativeId: '' })}
              >
                <option value="">Auswählen …</option>
                {dashboard.campaigns.map((item) => (
                  <option value={item.id} key={item.id}>
                    {item.name}
                  </option>
                ))}
              </select>
            </label>
            <label className="settings-option">
              <span>Name der Regel</span>
              <input
                value={schedule.name}
                onChange={(event) => setSchedule({ ...schedule, name: event.target.value })}
              />
            </label>
            <label className="settings-option">
              <span>Werbemittel</span>
              <select
                value={schedule.creativeId}
                onChange={(event) => setSchedule({ ...schedule, creativeId: event.target.value })}
              >
                <option value="">Automatisch rotieren</option>
                {campaignCreatives.map((item) => (
                  <option value={item.id} key={item.id}>
                    {item.name}
                  </option>
                ))}
              </select>
            </label>
            <label className="settings-option">
              <span>Ausspielart</span>
              <select
                value={schedule.scheduleType}
                onChange={(event) => setSchedule({ ...schedule, scheduleType: event.target.value })}
              >
                <option value="interval">Wiederkehrendes Intervall</option>
                <option value="daypart">Tageszeit-Rotation</option>
                <option value="fixed">Einmalig</option>
              </select>
            </label>
            <label className="settings-option">
              <span>Nächste Ausspielung</span>
              <input
                type="datetime-local"
                value={schedule.nextRunAt}
                onChange={(event) => setSchedule({ ...schedule, nextRunAt: event.target.value })}
              />
            </label>
            <label className="settings-option">
              <span>Intervall in Minuten</span>
              <input
                type="number"
                min="1"
                max="1440"
                disabled={schedule.scheduleType === 'fixed'}
                value={schedule.intervalMinutes}
                onChange={(event) => setSchedule({ ...schedule, intervalMinutes: Number(event.target.value) })}
              />
            </label>
            <label className="settings-option">
              <span>Gültig ab</span>
              <input
                type="datetime-local"
                value={schedule.startsAt}
                onChange={(event) => setSchedule({ ...schedule, startsAt: event.target.value })}
              />
            </label>
            <label className="settings-option">
              <span>Gültig bis</span>
              <input
                type="datetime-local"
                value={schedule.endsAt}
                onChange={(event) => setSchedule({ ...schedule, endsAt: event.target.value })}
              />
            </label>
            <label className="settings-option">
              <span>Täglich ab</span>
              <input
                type="time"
                value={schedule.dailyStart}
                onChange={(event) => setSchedule({ ...schedule, dailyStart: event.target.value })}
              />
            </label>
            <label className="settings-option">
              <span>Täglich bis</span>
              <input
                type="time"
                value={schedule.dailyEnd}
                onChange={(event) => setSchedule({ ...schedule, dailyEnd: event.target.value })}
              />
            </label>
          </div>
          <div className="weekday-picker">
            {weekdayLabels.map((label, index) => (
              <button
                type="button"
                className={schedule.weekdays.includes(index + 1) ? 'active' : ''}
                key={label}
                onClick={() => toggleWeekday(schedule, setSchedule, index + 1)}
              >
                {label}
              </button>
            ))}
          </div>
          <label className="settings-option">
            <span>
              <input
                type="checkbox"
                checked={schedule.enabled}
                onChange={(event) => setSchedule({ ...schedule, enabled: event.target.checked })}
              />{' '}
              Zeitregel aktiv schalten
            </span>
          </label>
          <div className="modal-actions">
            <button className="ghost-button" onClick={() => setModal(null)}>
              Abbrechen
            </button>
            <button
              className="primary-button"
              disabled={busy || !schedule.name.trim() || !schedule.campaignId || !schedule.nextRunAt}
              onClick={() => void saveSchedule()}
            >
              <Save size={16} /> Speichern
            </button>
          </div>
        </AdvertisingModal>
      )}

      {modal === 'preview' && previewCreative && (
        <AdvertisingModal title={`Vorschau · ${previewCreative.name}`} onClose={() => setModal(null)} wide>
          <div className={`advertising-render-preview ${previewCreative.placement} ${previewCreative.style}`}>
            {(previewCreative.creative_type === 'image' || previewCreative.creative_type === 'video') &&
              (previewCreative.creative_type === 'video' ? (
                <video src={`/api/advertising/creatives/${previewCreative.id}/media`} controls autoPlay muted />
              ) : (
                <img src={`/api/advertising/creatives/${previewCreative.id}/media`} alt="" />
              ))}
            <div>
              <span>WERBUNG · {previewCreative.campaign_name}</span>
              <h3>{previewCreative.headline || previewCreative.name}</h3>
              <p>{previewCreative.body}</p>
              {previewCreative.call_to_action && <strong>{previewCreative.call_to_action}</strong>}
            </div>
          </div>
          <div className="modal-actions">
            <button className="ghost-button" onClick={() => setModal(null)}>
              Schließen
            </button>
            <button
              className="primary-button"
              disabled={!writable || busy || !readyCreatives.some((item) => item.id === previewCreative.id)}
              onClick={() => {
                setModal(null);
                void play(previewCreative.id);
              }}
            >
              <CirclePlay size={16} /> Jetzt ausspielen
            </button>
          </div>
        </AdvertisingModal>
      )}
    </section>
  );
}
