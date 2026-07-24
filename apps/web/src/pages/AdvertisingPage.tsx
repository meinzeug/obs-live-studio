import React, { useEffect, useMemo, useState } from 'react';
import {
  BadgeEuro,
  CalendarClock,
  ChartNoAxesColumnIncreasing,
  CirclePlay,
  Clock3,
  Edit3,
  Film,
  ImageIcon,
  Megaphone,
  Plus,
  Radio,
  RefreshCw,
  Save,
  TimerReset,
  Trash2,
  Upload,
  X,
} from 'lucide-react';
import { api, can, type SessionUser } from '../api/client.js';

type Dashboard = {
  campaigns: any[];
  creatives: any[];
  schedules: any[];
  active: any | null;
  recent: any[];
  media: any[];
  stats: { today: number; last_hour: number; on_air: number };
};
type Tab = 'campaigns' | 'creatives' | 'schedules' | 'history';
type Modal = 'campaign' | 'creative' | 'schedule' | null;

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
function displayDate(value: string | null | undefined) {
  if (!value) return 'offen';
  const date = new Date(value);
  return Number.isNaN(date.getTime()) ? value : date.toLocaleString('de-DE');
}
function secondsLabel(value: number) {
  if (value < 60) return `${value} Sekunden`;
  return `${Math.round(value / 60)} Minuten`;
}

function AdvertisingModal({ title, children, onClose }: React.PropsWithChildren<{ title: string; onClose: () => void }>) {
  return (
    <div className="modal-backdrop" role="dialog" aria-modal="true">
      <div className="modal-card advertising-modal">
        <div className="modal-header">
          <div>
            <p className="eyebrow">Werbeverwaltung</p>
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
  const [dashboard, setDashboard] = useState<Dashboard>({
    campaigns: [],
    creatives: [],
    schedules: [],
    active: null,
    recent: [],
    media: [],
    stats: { today: 0, last_hour: 0, on_air: 0 },
  });
  const [tab, setTab] = useState<Tab>('campaigns');
  const [modal, setModal] = useState<Modal>(null);
  const [editingId, setEditingId] = useState('');
  const [campaign, setCampaign] = useState<any>(emptyCampaign);
  const [creative, setCreative] = useState<any>(emptyCreative);
  const [schedule, setSchedule] = useState<any>(emptySchedule);
  const [message, setMessage] = useState('');
  const [busy, setBusy] = useState(false);
  const [uploading, setUploading] = useState(false);
  const writable = can(user, 'broadcast:write');

  async function load() {
    try {
      setDashboard(await api<Dashboard>('/api/advertising'));
    } catch (error) {
      setMessage(error instanceof Error ? error.message : String(error));
    }
  }
  useEffect(() => {
    void load();
    const timer = window.setInterval(() => void load(), 5000);
    return () => window.clearInterval(timer);
  }, []);

  const activeCampaigns = dashboard.campaigns.filter((item) => item.status === 'active');
  const readyCreatives = dashboard.creatives.filter(
    (item) => item.active && dashboard.campaigns.some((campaignItem) => campaignItem.id === item.campaign_id && campaignItem.status === 'active'),
  );
  const campaignCreatives = useMemo(
    () => dashboard.creatives.filter((item) => item.campaign_id === schedule.campaignId),
    [dashboard.creatives, schedule.campaignId],
  );

  function toggleWeekday(draft: any, setDraft: (value: any) => void, day: number) {
    const selected = draft.weekdays.includes(day)
      ? draft.weekdays.filter((value: number) => value !== day)
      : [...draft.weekdays, day].sort();
    if (selected.length) setDraft({ ...draft, weekdays: selected });
  }
  function openCampaign(item?: any) {
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
            notes: item.notes,
          }
        : { ...emptyCampaign, weekdays: [...allWeekdays] },
    );
    setMessage('');
    setModal('campaign');
  }
  function openCreative(item?: any) {
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
  function openSchedule(item?: any) {
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

  async function saveCampaign() {
    setBusy(true);
    try {
      const body = { ...campaign, startsAt: iso(campaign.startsAt), endsAt: iso(campaign.endsAt) };
      await api(editingId ? `/api/advertising/campaigns/${editingId}` : '/api/advertising/campaigns', {
        method: editingId ? 'PUT' : 'POST',
        body: JSON.stringify(body),
      });
      setModal(null);
      setMessage(editingId ? 'Kampagne wurde aktualisiert.' : 'Kampagne wurde angelegt.');
      await load();
    } catch (error) {
      setMessage(error instanceof Error ? error.message : String(error));
    } finally {
      setBusy(false);
    }
  }
  async function saveCreative() {
    setBusy(true);
    try {
      await api(editingId ? `/api/advertising/creatives/${editingId}` : '/api/advertising/creatives', {
        method: editingId ? 'PUT' : 'POST',
        body: JSON.stringify({ ...creative, mediaId: creative.mediaId || null }),
      });
      setModal(null);
      setMessage(editingId ? 'Werbemittel wurde aktualisiert.' : 'Werbemittel wurde angelegt.');
      await load();
    } catch (error) {
      setMessage(error instanceof Error ? error.message : String(error));
    } finally {
      setBusy(false);
    }
  }
  async function saveSchedule() {
    setBusy(true);
    try {
      await api(editingId ? `/api/advertising/schedules/${editingId}` : '/api/advertising/schedules', {
        method: editingId ? 'PUT' : 'POST',
        body: JSON.stringify({
          ...schedule,
          creativeId: schedule.creativeId || null,
          startsAt: iso(schedule.startsAt),
          endsAt: iso(schedule.endsAt),
          nextRunAt: iso(schedule.nextRunAt),
        }),
      });
      setModal(null);
      setMessage(editingId ? 'Zeitregel wurde aktualisiert.' : 'Zeitregel wurde angelegt.');
      await load();
    } catch (error) {
      setMessage(error instanceof Error ? error.message : String(error));
    } finally {
      setBusy(false);
    }
  }
  async function uploadAsset(file?: File) {
    if (!file) return;
    setUploading(true);
    try {
      const form = new FormData();
      form.append('file', file);
      const media = await api<any>('/api/advertising/assets', { method: 'POST', body: form });
      setCreative({ ...creative, mediaId: media.id, creativeType: file.type.startsWith('video/') ? 'video' : 'image' });
      setMessage(`„${file.name}“ wurde sicher in die Werbemediathek geladen.`);
      await load();
    } catch (error) {
      setMessage(error instanceof Error ? error.message : String(error));
    } finally {
      setUploading(false);
    }
  }
  async function play(creativeId: string) {
    setBusy(true);
    try {
      await api(`/api/advertising/creatives/${creativeId}/play`, { method: 'POST' });
      setMessage('Werbemittel ist jetzt im laufenden Programm eingeblendet.');
      await load();
    } catch (error) {
      setMessage(error instanceof Error ? error.message : String(error));
    } finally {
      setBusy(false);
    }
  }
  async function stop() {
    if (!dashboard.active) return;
    await api(`/api/advertising/playouts/${dashboard.active.id}`, { method: 'DELETE' });
    setMessage('Werbeeinblendung wurde beendet.');
    await load();
  }
  async function remove(kind: 'campaigns' | 'creatives' | 'schedules', id: string, name: string) {
    if (!window.confirm(`„${name}“ wirklich ${kind === 'campaigns' ? 'archivieren' : 'löschen'}?`)) return;
    try {
      await api(`/api/advertising/${kind}/${id}`, { method: 'DELETE' });
      setMessage('Änderung wurde gespeichert.');
      await load();
    } catch (error) {
      setMessage(error instanceof Error ? error.message : String(error));
    }
  }

  return (
    <section className="panel advertising-page">
      <div className="page-title">
        <div>
          <p className="eyebrow">Vermarktung &amp; Ausspielung</p>
          <h2>Werbung</h2>
          <p>Kampagnen planen, Werbeclips und Banner rotieren und kontrolliert direkt in OBS ausspielen.</p>
        </div>
        <button className="ghost-button" onClick={() => void load()}>
          <RefreshCw size={16} /> Aktualisieren
        </button>
      </div>

      <div className="advertising-status-grid">
        <article className={dashboard.active ? 'live' : ''}>
          <span className="stat-icon live"><Radio size={20} /></span>
          <div>
            <small>Jetzt im Programm</small>
            <strong>{dashboard.active?.creative_name ?? 'Keine Werbung'}</strong>
            <span>{dashboard.active ? `bis ${displayDate(dashboard.active.expires_at)}` : 'Overlay transparent'}</span>
          </div>
          {dashboard.active && <button className="danger" disabled={!writable} onClick={() => void stop()}>Ausblenden</button>}
        </article>
        <article>
          <span className="stat-icon"><BadgeEuro size={20} /></span>
          <div><small>Aktive Kampagnen</small><strong>{activeCampaigns.length}</strong><span>{dashboard.campaigns.length} insgesamt</span></div>
        </article>
        <article>
          <span className="stat-icon"><ChartNoAxesColumnIncreasing size={20} /></span>
          <div><small>Ausspielungen heute</small><strong>{dashboard.stats.today}</strong><span>{dashboard.stats.last_hour} in der letzten Stunde</span></div>
        </article>
        <article>
          <span className="stat-icon"><CalendarClock size={20} /></span>
          <div><small>Nächste Ausspielung</small><strong>{displayDate(dashboard.schedules.filter((item) => item.enabled)[0]?.next_run_at)}</strong><span>{dashboard.schedules.filter((item) => item.enabled).length} Regeln aktiv</span></div>
        </article>
      </div>

      <div className="advertising-quick-actions">
        <button className="primary-button" disabled={!writable} onClick={() => openCampaign()}><Plus size={16} /> Kampagne</button>
        <button disabled={!writable || !dashboard.campaigns.length} onClick={() => openCreative()}><Megaphone size={16} /> Werbemittel</button>
        <button disabled={!writable || !activeCampaigns.length} onClick={() => openSchedule()}><Clock3 size={16} /> Zeitregel</button>
        <span>OBS: <strong>ANS_AD_OVERLAY</strong> · Szene: <strong>20_ADVERTISING</strong></span>
      </div>
      {message && <p className="notice">{message}</p>}

      <nav className="advertising-tabs">
        {([
          ['campaigns', 'Kampagnen', dashboard.campaigns.length],
          ['creatives', 'Werbemittel', dashboard.creatives.length],
          ['schedules', 'Zeit & Rotation', dashboard.schedules.length],
          ['history', 'Ausspielprotokoll', dashboard.recent.length],
        ] as const).map(([value, label, count]) => (
          <button className={tab === value ? 'active' : ''} key={value} onClick={() => setTab(value)}>
            {label}<span>{count}</span>
          </button>
        ))}
      </nav>

      {tab === 'campaigns' && (
        <div className="advertising-card-grid">
          {dashboard.campaigns.map((item) => (
            <article key={item.id} className="advertising-campaign-card">
              <div className="advertising-card-header">
                <span className={`state-pill ${item.status === 'active' ? 'success' : ''}`}>{item.status}</span>
                <span>Priorität {item.priority}</span>
              </div>
              <h3>{item.name}</h3><p>{item.advertiser || 'Eigenwerbung'}</p>
              <dl>
                <div><dt>Laufzeit</dt><dd>{displayDate(item.starts_at)} – {displayDate(item.ends_at)}</dd></div>
                <div><dt>Frequenzschutz</dt><dd>max. {item.max_per_hour}/h · Abstand {secondsLabel(item.minimum_gap_seconds)}</dd></div>
                <div><dt>Werbemittel</dt><dd>{dashboard.creatives.filter((creativeItem) => creativeItem.campaign_id === item.id).length}</dd></div>
              </dl>
              <div className="advertising-card-actions">
                <button className="ghost-button" onClick={() => openCampaign(item)}><Edit3 size={15} /> Bearbeiten</button>
                <button className="ghost-button danger-text" disabled={!writable} onClick={() => void remove('campaigns', item.id, item.name)}><Trash2 size={15} /> Archivieren</button>
              </div>
            </article>
          ))}
          {!dashboard.campaigns.length && <div className="empty-state">Lege zuerst eine Kampagne für Eigenwerbung oder einen Werbepartner an.</div>}
        </div>
      )}

      {tab === 'creatives' && (
        <div className="advertising-creative-list">
          {dashboard.creatives.map((item) => (
            <article key={item.id}>
              <span className={`advertising-creative-icon ${item.creative_type}`}>
                {item.creative_type === 'video' ? <Film /> : item.creative_type === 'image' ? <ImageIcon /> : <Megaphone />}
              </span>
              <span><strong>{item.name}</strong><small>{item.campaign_name} · {item.creative_type} · {item.placement}</small><small>{item.headline || item.filename}</small></span>
              <span><strong>{item.play_count}×</strong><small>zuletzt {displayDate(item.last_played_at)}</small></span>
              <div>
                <button className="primary-button" disabled={!writable || busy || !readyCreatives.some((ready) => ready.id === item.id)} onClick={() => void play(item.id)}><CirclePlay size={15} /> Jetzt</button>
                <button className="ghost-button icon-button" onClick={() => openCreative(item)} title="Bearbeiten"><Edit3 size={15} /></button>
                <button className="ghost-button icon-button danger-text" disabled={!writable} onClick={() => void remove('creatives', item.id, item.name)} title="Löschen"><Trash2 size={15} /></button>
              </div>
            </article>
          ))}
        </div>
      )}

      {tab === 'schedules' && (
        <div className="advertising-schedule-list">
          {dashboard.schedules.map((item) => (
            <article key={item.id}>
              <span className={`stat-icon ${item.enabled ? 'success' : ''}`}>{item.schedule_type === 'fixed' ? <CalendarClock size={18} /> : <TimerReset size={18} />}</span>
              <span><strong>{item.name}</strong><small>{item.campaign_name} · {item.creative_name || 'gewichtete Rotation'}</small></span>
              <span><strong>{item.schedule_type === 'fixed' ? 'Einmalig' : `alle ${item.interval_minutes} Min.`}</strong><small>Nächster Lauf: {displayDate(item.next_run_at)}</small></span>
              <span className={`state-pill ${item.enabled ? 'success' : ''}`}>{item.enabled ? 'aktiv' : 'pausiert'}</span>
              <div><button className="ghost-button icon-button" onClick={() => openSchedule(item)}><Edit3 size={15} /></button><button className="ghost-button icon-button danger-text" disabled={!writable} onClick={() => void remove('schedules', item.id, item.name)}><Trash2 size={15} /></button></div>
            </article>
          ))}
        </div>
      )}

      {tab === 'history' && (
        <div className="advertising-history">
          {dashboard.recent.map((item) => (
            <article key={item.id}>
              <span className={`state-pill ${item.status === 'completed' ? 'success' : item.status === 'on_air' ? 'live' : ''}`}>{item.status}</span>
              <span><strong>{item.creative_name}</strong><small>{item.campaign_name} · {item.trigger_type === 'manual' ? 'manuelle Regie' : 'Zeitplan'}</small></span>
              <time>{displayDate(item.started_at)}</time>
            </article>
          ))}
        </div>
      )}

      {modal === 'campaign' && (
        <AdvertisingModal title={editingId ? 'Kampagne bearbeiten' : 'Neue Kampagne'} onClose={() => setModal(null)}>
          <div className="settings-grid">
            <label className="settings-option"><span>Kampagnenname</span><input value={campaign.name} onChange={(e) => setCampaign({ ...campaign, name: e.target.value })} /></label>
            <label className="settings-option"><span>Werbepartner / Sponsor</span><input value={campaign.advertiser} onChange={(e) => setCampaign({ ...campaign, advertiser: e.target.value })} placeholder="Leer = Eigenwerbung" /></label>
            <label className="settings-option"><span>Status</span><select value={campaign.status} onChange={(e) => setCampaign({ ...campaign, status: e.target.value })}><option value="draft">Entwurf</option><option value="active">Aktiv</option><option value="paused">Pausiert</option><option value="completed">Abgeschlossen</option></select></label>
            <label className="settings-option"><span>Priorität: {campaign.priority}</span><input type="range" min="0" max="100" value={campaign.priority} onChange={(e) => setCampaign({ ...campaign, priority: Number(e.target.value) })} /></label>
            <label className="settings-option"><span>Startdatum</span><input type="datetime-local" value={campaign.startsAt} onChange={(e) => setCampaign({ ...campaign, startsAt: e.target.value })} /></label>
            <label className="settings-option"><span>Enddatum</span><input type="datetime-local" value={campaign.endsAt} onChange={(e) => setCampaign({ ...campaign, endsAt: e.target.value })} /></label>
            <label className="settings-option"><span>Täglich frühestens</span><input type="time" value={campaign.dailyStart} onChange={(e) => setCampaign({ ...campaign, dailyStart: e.target.value })} /></label>
            <label className="settings-option"><span>Täglich spätestens</span><input type="time" value={campaign.dailyEnd} onChange={(e) => setCampaign({ ...campaign, dailyEnd: e.target.value })} /></label>
            <label className="settings-option"><span>Maximal pro Stunde</span><input type="number" min="1" max="60" value={campaign.maxPerHour} onChange={(e) => setCampaign({ ...campaign, maxPerHour: Number(e.target.value) })} /></label>
            <label className="settings-option"><span>Mindestabstand (Sekunden)</span><input type="number" min="10" value={campaign.minimumGapSeconds} onChange={(e) => setCampaign({ ...campaign, minimumGapSeconds: Number(e.target.value) })} /></label>
          </div>
          <div className="weekday-picker">{weekdayLabels.map((label, index) => <button type="button" className={campaign.weekdays.includes(index + 1) ? 'active' : ''} key={label} onClick={() => toggleWeekday(campaign, setCampaign, index + 1)}>{label}</button>)}</div>
          <label className="settings-option"><span>Interne Notizen</span><textarea rows={3} value={campaign.notes} onChange={(e) => setCampaign({ ...campaign, notes: e.target.value })} /></label>
          <div className="modal-actions"><button className="ghost-button" onClick={() => setModal(null)}>Abbrechen</button><button className="primary-button" disabled={busy || !campaign.name.trim()} onClick={() => void saveCampaign()}><Save size={16} /> Speichern</button></div>
        </AdvertisingModal>
      )}

      {modal === 'creative' && (
        <AdvertisingModal title={editingId ? 'Werbemittel bearbeiten' : 'Neues Werbemittel'} onClose={() => setModal(null)}>
          <div className="advertising-type-picker">
            {['text', 'banner', 'image', 'video'].map((value) => <button key={value} className={creative.creativeType === value ? 'active' : ''} onClick={() => setCreative({ ...creative, creativeType: value })}>{value === 'video' ? <Film size={17} /> : value === 'image' ? <ImageIcon size={17} /> : <Megaphone size={17} />}{value}</button>)}
          </div>
          <div className="settings-grid">
            <label className="settings-option"><span>Kampagne</span><select value={creative.campaignId} onChange={(e) => setCreative({ ...creative, campaignId: e.target.value })}><option value="">Auswählen …</option>{dashboard.campaigns.map((item) => <option value={item.id} key={item.id}>{item.name}</option>)}</select></label>
            <label className="settings-option"><span>Interner Name</span><input value={creative.name} onChange={(e) => setCreative({ ...creative, name: e.target.value })} /></label>
            <label className="settings-option"><span>Überschrift</span><input value={creative.headline} onChange={(e) => setCreative({ ...creative, headline: e.target.value })} /></label>
            <label className="settings-option"><span>Call-to-Action</span><input value={creative.callToAction} onChange={(e) => setCreative({ ...creative, callToAction: e.target.value })} placeholder="Jetzt informieren" /></label>
          </div>
          <label className="settings-option"><span>Werbetext</span><textarea rows={3} value={creative.body} onChange={(e) => setCreative({ ...creative, body: e.target.value })} /></label>
          {(creative.creativeType === 'image' || creative.creativeType === 'video') && <div className="advertising-media-picker"><label className="settings-option"><span>Mediathek</span><select value={creative.mediaId} onChange={(e) => setCreative({ ...creative, mediaId: e.target.value })}><option value="">Datei auswählen …</option>{dashboard.media.filter((item) => String(item.mime_type).startsWith(creative.creativeType === 'video' ? 'video/' : 'image/')).map((item) => <option key={item.id} value={item.id}>{item.filename}</option>)}</select></label><label className="ghost-button advertising-upload"><Upload size={16} /> {uploading ? 'Wird geprüft …' : 'Neue Datei hochladen'}<input type="file" hidden accept={creative.creativeType === 'video' ? 'video/mp4,video/webm,video/quicktime' : 'image/png,image/jpeg,image/webp'} disabled={uploading} onChange={(e) => void uploadAsset(e.target.files?.[0])} /></label></div>}
          <div className="settings-grid">
            <label className="settings-option"><span>Platzierung</span><select value={creative.placement} onChange={(e) => setCreative({ ...creative, placement: e.target.value })}><option value="lower-third">Bauchbinde</option><option value="top">Oben</option><option value="bottom-right">Rechts unten</option><option value="fullscreen">Vollbild</option></select></label>
            <label className="settings-option"><span>Design</span><select value={creative.style} onChange={(e) => setCreative({ ...creative, style: e.target.value })}><option value="studio">Studio</option><option value="light">Hell</option><option value="bold">Signalstark</option><option value="minimal">Minimal</option></select></label>
            <label className="settings-option"><span>Animation</span><select value={creative.transition} onChange={(e) => setCreative({ ...creative, transition: e.target.value })}><option value="fade">Einblenden</option><option value="slide">Hereinfahren</option><option value="zoom">Aufzoomen</option><option value="cut">Schnitt</option></select></label>
            <label className="settings-option"><span>Dauer: {creative.durationSeconds}s</span><input type="range" min="2" max="120" value={creative.durationSeconds} onChange={(e) => setCreative({ ...creative, durationSeconds: Number(e.target.value) })} /></label>
            <label className="settings-option"><span>Rotationsgewicht: {creative.weight}</span><input type="range" min="1" max="100" value={creative.weight} onChange={(e) => setCreative({ ...creative, weight: Number(e.target.value) })} /></label>
            <label className="settings-option"><span><input type="checkbox" checked={creative.active} onChange={(e) => setCreative({ ...creative, active: e.target.checked })} /> Werbemittel aktiv</span></label>
          </div>
          <div className={`advertising-preview ${creative.style}`}><span>WERBUNG</span><strong>{creative.headline || creative.name || 'Werbeüberschrift'}</strong><small>{creative.body || 'Werbetext in der Programmvorschau'}</small></div>
          <div className="modal-actions"><button className="ghost-button" onClick={() => setModal(null)}>Abbrechen</button><button className="primary-button" disabled={busy || !creative.name.trim() || !creative.campaignId} onClick={() => void saveCreative()}><Save size={16} /> Speichern</button></div>
        </AdvertisingModal>
      )}

      {modal === 'schedule' && (
        <AdvertisingModal title={editingId ? 'Zeitregel bearbeiten' : 'Neue Zeitregel'} onClose={() => setModal(null)}>
          <div className="settings-grid">
            <label className="settings-option"><span>Kampagne</span><select value={schedule.campaignId} onChange={(e) => setSchedule({ ...schedule, campaignId: e.target.value, creativeId: '' })}><option value="">Auswählen …</option>{dashboard.campaigns.map((item) => <option value={item.id} key={item.id}>{item.name}</option>)}</select></label>
            <label className="settings-option"><span>Name der Regel</span><input value={schedule.name} onChange={(e) => setSchedule({ ...schedule, name: e.target.value })} /></label>
            <label className="settings-option"><span>Werbemittel</span><select value={schedule.creativeId} onChange={(e) => setSchedule({ ...schedule, creativeId: e.target.value })}><option value="">Automatisch rotieren</option>{campaignCreatives.map((item) => <option value={item.id} key={item.id}>{item.name}</option>)}</select></label>
            <label className="settings-option"><span>Ausspielart</span><select value={schedule.scheduleType} onChange={(e) => setSchedule({ ...schedule, scheduleType: e.target.value })}><option value="interval">Wiederkehrendes Intervall</option><option value="daypart">Tageszeit-Rotation</option><option value="fixed">Einmalig</option></select></label>
            <label className="settings-option"><span>Nächste Ausspielung</span><input type="datetime-local" value={schedule.nextRunAt} onChange={(e) => setSchedule({ ...schedule, nextRunAt: e.target.value })} /></label>
            <label className="settings-option"><span>Intervall in Minuten</span><input type="number" min="1" max="1440" disabled={schedule.scheduleType === 'fixed'} value={schedule.intervalMinutes} onChange={(e) => setSchedule({ ...schedule, intervalMinutes: Number(e.target.value) })} /></label>
            <label className="settings-option"><span>Gültig ab</span><input type="datetime-local" value={schedule.startsAt} onChange={(e) => setSchedule({ ...schedule, startsAt: e.target.value })} /></label>
            <label className="settings-option"><span>Gültig bis</span><input type="datetime-local" value={schedule.endsAt} onChange={(e) => setSchedule({ ...schedule, endsAt: e.target.value })} /></label>
            <label className="settings-option"><span>Täglich ab</span><input type="time" value={schedule.dailyStart} onChange={(e) => setSchedule({ ...schedule, dailyStart: e.target.value })} /></label>
            <label className="settings-option"><span>Täglich bis</span><input type="time" value={schedule.dailyEnd} onChange={(e) => setSchedule({ ...schedule, dailyEnd: e.target.value })} /></label>
          </div>
          <div className="weekday-picker">{weekdayLabels.map((label, index) => <button type="button" className={schedule.weekdays.includes(index + 1) ? 'active' : ''} key={label} onClick={() => toggleWeekday(schedule, setSchedule, index + 1)}>{label}</button>)}</div>
          <label className="settings-option"><span><input type="checkbox" checked={schedule.enabled} onChange={(e) => setSchedule({ ...schedule, enabled: e.target.checked })} /> Zeitregel aktiv schalten</span></label>
          <div className="modal-actions"><button className="ghost-button" onClick={() => setModal(null)}>Abbrechen</button><button className="primary-button" disabled={busy || !schedule.name.trim() || !schedule.campaignId || !schedule.nextRunAt} onClick={() => void saveSchedule()}><Save size={16} /> Speichern</button></div>
        </AdvertisingModal>
      )}
    </section>
  );
}
