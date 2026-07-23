import React, { useEffect, useMemo, useState } from 'react';
import {
  AlertTriangle,
  ArrowRight,
  Bot,
  CalendarClock,
  CheckCircle2,
  ChevronDown,
  Clock3,
  ListVideo,
  LoaderCircle,
  Newspaper,
  Pause,
  Play,
  Plus,
  RefreshCw,
  Save,
  Settings2,
  Sparkles,
  Trash2,
  Video,
} from 'lucide-react';
import { Link } from 'react-router-dom';
import { api, can, type SessionUser } from '../api/client.js';
import { routes } from '../navigation.js';
import { useStudioStatus } from '../studio-status.js';

type ContentMode = 'news' | 'youtube' | 'mixed' | 'youtube-news-sidebar' | 'youtube-context';
type DailyFormat = {
  id: string;
  name: string;
  startTime: string;
  durationMinutes: number;
  contentMode: ContentMode;
  formatSystemKey?: string | null;
  youtubeCategoryIds: string[];
  sourceIds: string[];
  enabled: boolean;
};
type Autopilot = {
  enabled: boolean;
  contentMode: ContentMode;
  minimumTrust: number;
  requireStream: boolean;
  requireVideo: boolean;
  showItemCount: number;
  pauseSeconds: number;
  pauseBetweenShowsSeconds: number;
  sidebarRotationSeconds: number;
  sourceIds: string[];
  youtubeCategoryIds: string[];
  dailyFormats: DailyFormat[];
  scanLimit: number;
};

const modeOptions: Array<{ id: ContentMode; label: string; description: string; icon: typeof Newspaper }> = [
  {
    id: 'news',
    label: 'Nur Nachrichten',
    description: 'Klassische Nachrichtenbeiträge mit Sprecher-Audio.',
    icon: Newspaper,
  },
  { id: 'youtube', label: 'Nur YouTube', description: 'Videos aus der kuratierten YouTube-Mediathek.', icon: Video },
  {
    id: 'mixed',
    label: 'Abwechselnd',
    description: 'Nachrichten und YouTube-Videos als eigene Beiträge.',
    icon: ListVideo,
  },
  {
    id: 'youtube-news-sidebar',
    label: 'Newsboard + Video',
    description: 'Nachrichten links, YouTube mit Audio rechts.',
    icon: Sparkles,
  },
  {
    id: 'youtube-context',
    label: 'YouTube-Einordnung',
    description: 'AVA moderiert dauerhaft, die KI-Redaktion ordnet das Transkript ein.',
    icon: Bot,
  },
];

function newFormat(index: number): DailyFormat {
  return {
    id: `format-${Date.now()}-${index}`,
    name: 'Neues Sendeformat',
    startTime: `${String((8 + index * 2) % 24).padStart(2, '0')}:00`,
    durationMinutes: 60,
    contentMode: 'mixed',
    youtubeCategoryIds: [],
    sourceIds: [],
    enabled: true,
  };
}

export function AutomationPage({ user }: { user: SessionUser }) {
  const { dashboard, refresh: refreshDashboard } = useStudioStatus();
  const [config, setConfig] = useState<Autopilot | null>(null);
  const [sources, setSources] = useState<Array<{ id: string; name: string; active: boolean }>>([]);
  const [categories, setCategories] = useState<Array<{ id: string; name: string }>>([]);
  const [virtualTeam, setVirtualTeam] = useState<{
    settings: { enabled: boolean };
    runtime: { running: boolean };
    session: unknown | null;
  } | null>(null);
  const [expandedFormat, setExpandedFormat] = useState<string | null>(null);
  const [working, setWorking] = useState('');
  const [message, setMessage] = useState('');
  const [error, setError] = useState('');
  const allowed = can(user, 'broadcast:write');

  async function load() {
    setError('');
    try {
      const [nextConfig, nextSources, youtube, team] = await Promise.all([
        api<Autopilot>('/api/autopilot'),
        api<Array<{ id: string; name: string; active: boolean }>>('/api/sources'),
        api<{ categories: Array<{ id: string; name: string }> }>('/api/youtube-videos'),
        api<{ settings: { enabled: boolean }; runtime: { running: boolean }; session: unknown | null }>(
          '/api/ai-host/status',
        ),
      ]);
      setConfig(nextConfig);
      setSources(nextSources);
      setCategories(youtube.categories ?? []);
      setVirtualTeam(team);
    } catch (requestError) {
      setError(requestError instanceof Error ? requestError.message : String(requestError));
    }
  }

  useEffect(() => {
    void load();
  }, []);

  async function save() {
    if (!config || !allowed) return;
    setWorking('save');
    setError('');
    setMessage('');
    try {
      const saved = await api<Autopilot>('/api/autopilot', { method: 'POST', body: JSON.stringify(config) });
      setConfig(saved);
      setMessage('Autopilot-Regeln gespeichert und sofort übernommen.');
      await refreshDashboard();
    } catch (requestError) {
      setError(requestError instanceof Error ? requestError.message : String(requestError));
    } finally {
      setWorking('');
    }
  }

  async function plan24Hours() {
    if (!config || !allowed) return;
    setWorking('plan');
    setError('');
    setMessage('');
    try {
      await api('/api/autopilot', { method: 'POST', body: JSON.stringify(config) });
      const result = await api<{ created: unknown[]; skipped: unknown[] }>('/api/autopilot/plan-24h', {
        method: 'POST',
        body: JSON.stringify({ replaceExisting: false }),
      });
      setMessage(
        `${result.created.length} neue Sendungen geplant; ${result.skipped.length} bestehende Zeitfenster geschützt.`,
      );
      await refreshDashboard();
    } catch (requestError) {
      setError(requestError instanceof Error ? requestError.message : String(requestError));
    } finally {
      setWorking('');
    }
  }

  function updateFormat(id: string, patch: Partial<DailyFormat>) {
    if (!config) return;
    setConfig({
      ...config,
      dailyFormats: config.dailyFormats.map((format) => (format.id === id ? { ...format, ...patch } : format)),
    });
  }

  const sortedFormats = useMemo(
    () => [...(config?.dailyFormats ?? [])].sort((a, b) => a.startTime.localeCompare(b.startTime)),
    [config?.dailyFormats],
  );

  return (
    <section className="workspace-hub automation-page">
      <header className="workspace-page-header">
        <div>
          <p className="eyebrow">Das Gehirn des Senders</p>
          <h1>Automation</h1>
          <p>Autopilot, Inhaltsregeln und Tagesformate verständlich steuern.</p>
        </div>
        <div className="workspace-header-actions">
          <button onClick={() => void load()}>
            <RefreshCw size={17} /> Neu laden
          </button>
          <button
            className="primary-button"
            disabled={!allowed || !config || Boolean(working)}
            onClick={() => void save()}
          >
            {working === 'save' ? <LoaderCircle size={17} className="spin" /> : <Save size={17} />} Änderungen speichern
          </button>
        </div>
      </header>
      {message && (
        <div className="overview-notice">
          <CheckCircle2 size={16} />
          {message}
        </div>
      )}
      {error && (
        <div className="overview-notice error">
          <AlertTriangle size={16} />
          {error}
        </div>
      )}

      {config && (
        <>
          <section className={`autopilot-master-card ${config.enabled ? 'active' : ''}`}>
            <div className="autopilot-master-visual">
              <span>
                <Bot size={34} />
              </span>
              <i />
            </div>
            <div>
              <p className="eyebrow">24/7 Sendebetrieb</p>
              <h2>Autopilot ist {config.enabled ? 'aktiv' : 'pausiert'}</h2>
              <p>
                {config.enabled
                  ? 'Neue Inhalte werden ausgewählt, Sendungen geplant und der Sendeablauf automatisch fortgeführt.'
                  : 'Der aktuelle Plan bleibt erhalten, neue Sendungen werden nicht automatisch erzeugt.'}
              </p>
            </div>
            <button
              className={config.enabled ? 'pause-button' : 'primary-button'}
              disabled={!allowed}
              onClick={() => setConfig({ ...config, enabled: !config.enabled })}
            >
              {config.enabled ? (
                <>
                  <Pause size={17} /> Pausieren
                </>
              ) : (
                <>
                  <Play size={17} /> Aktivieren
                </>
              )}
            </button>
          </section>

          <div className="automation-kpis">
            <article>
              <span>
                <CalendarClock />
              </span>
              <div>
                <small>Vorausplanung</small>
                <strong>24 Stunden</strong>
                <p>{dashboard?.schedule.length ?? 0} sichtbare Sendungen</p>
              </div>
            </article>
            <article>
              <span>
                <ListVideo />
              </span>
              <div>
                <small>Sendungsgröße</small>
                <strong>{config.showItemCount} Beiträge</strong>
                <p>pro automatisch geplanter Sendung</p>
              </div>
            </article>
            <article>
              <span>
                <Clock3 />
              </span>
              <div>
                <small>Pausen</small>
                <strong>{config.pauseSeconds} Sekunden</strong>
                <p>zwischen Beiträgen</p>
              </div>
            </article>
            <article>
              <span>
                <Sparkles />
              </span>
              <div>
                <small>Auswahl</small>
                <strong>Neueste zuerst</strong>
                <p>Wiederholung erst bei erschöpftem Pool</p>
              </div>
            </article>
            <Link to={routes.aiStudio}>
              <span>
                <Bot />
              </span>
              <div>
                <small>Virtuelles Senderteam</small>
                <strong>{virtualTeam?.settings.enabled ? 'Aktiv' : 'Pausiert'}</strong>
                <p>{virtualTeam?.session ? 'moderiert die laufende Sendung' : 'bereit für den nächsten Einsatz'}</p>
              </div>
              <ArrowRight size={16} />
            </Link>
          </div>

          <section className="hub-panel station-autonomy-panel">
            <header>
              <div>
                <p className="eyebrow">Kompletter TV-Sender</p>
                <h2>Autonome Produktionskette</h2>
                <p>
                  Jeder Schritt besitzt Fallbacks und läuft auch weiter, wenn ein externer KI-Dienst vorübergehend
                  ausfällt.
                </p>
              </div>
              <span className="integration-status good">
                <i />
                24/7
              </span>
            </header>
            <div className="station-autonomy-flow">
              <article>
                <Newspaper />
                <strong>Ingest</strong>
                <span>Quellen & Live-Signale</span>
              </article>
              <i />
              <article>
                <Sparkles />
                <strong>Redaktion</strong>
                <span>Text, Fakten, Medien</span>
              </article>
              <i />
              <article>
                <CalendarClock />
                <strong>Planung</strong>
                <span>24 Stunden voraus</span>
              </article>
              <i />
              <article>
                <Play />
                <strong>Ausgabe</strong>
                <span>OBS, Audio, Overlays</span>
              </article>
              <i />
              <article>
                <Bot />
                <strong>Moderation</strong>
                <span>Avatar & Livechat</span>
              </article>
            </div>
            <footer>
              <span>
                <CheckCircle2 /> Selbstheilender Streamstart und abwechslungsbasierte Inhaltsauswahl aktiv.
              </span>
              <Link to={routes.analytics}>
                Wachstumsloop öffnen <ArrowRight size={15} />
              </Link>
            </footer>
          </section>

          <section className="hub-panel automation-mode-panel">
            <header>
              <div>
                <p className="eyebrow">Standardprogramm</p>
                <h2>Welche Inhalte laufen?</h2>
              </div>
              <Settings2 size={19} />
            </header>
            <div className="automation-mode-grid">
              {modeOptions.map((mode) => {
                const Icon = mode.icon;
                return (
                  <button
                    key={mode.id}
                    className={config.contentMode === mode.id ? 'selected' : ''}
                    onClick={() => setConfig({ ...config, contentMode: mode.id })}
                  >
                    <span>
                      <Icon size={21} />
                    </span>
                    <div>
                      <strong>{mode.label}</strong>
                      <p>{mode.description}</p>
                    </div>
                    {config.contentMode === mode.id && <CheckCircle2 size={17} />}
                  </button>
                );
              })}
            </div>
          </section>

          <div className="automation-settings-grid">
            <section className="hub-panel automation-rule-panel">
              <header>
                <div>
                  <p className="eyebrow">Auswahlregeln</p>
                  <h2>Qualität und Umfang</h2>
                </div>
              </header>
              <div className="friendly-settings-grid">
                <label>
                  <span>
                    Beiträge pro Sendung<small>Wie viele Inhalte ein Block enthält.</small>
                  </span>
                  <input
                    type="number"
                    min="1"
                    max="20"
                    value={config.showItemCount}
                    onChange={(event) => setConfig({ ...config, showItemCount: Number(event.target.value) })}
                  />
                </label>
                <label>
                  <span>
                    Mindestvertrauen<small>Nur Quellen ab diesem Qualitätswert.</small>
                  </span>
                  <div className="range-field">
                    <input
                      type="range"
                      min="0"
                      max="100"
                      value={config.minimumTrust}
                      onChange={(event) => setConfig({ ...config, minimumTrust: Number(event.target.value) })}
                    />
                    <strong>{config.minimumTrust}%</strong>
                  </div>
                </label>
                <label>
                  <span>
                    Beitragspause<small>Ruhezeit zwischen zwei Inhalten.</small>
                  </span>
                  <div className="unit-input">
                    <input
                      type="number"
                      min="0"
                      max="600"
                      value={config.pauseSeconds}
                      onChange={(event) => setConfig({ ...config, pauseSeconds: Number(event.target.value) })}
                    />
                    <em>Sek.</em>
                  </div>
                </label>
                <label>
                  <span>
                    Sendungspause<small>Abstand zwischen zwei Sendungen.</small>
                  </span>
                  <div className="unit-input">
                    <input
                      type="number"
                      min="0"
                      max="3600"
                      value={config.pauseBetweenShowsSeconds}
                      onChange={(event) =>
                        setConfig({ ...config, pauseBetweenShowsSeconds: Number(event.target.value) })
                      }
                    />
                    <em>Sek.</em>
                  </div>
                </label>
                <label>
                  <span>
                    Newsboard-Wechsel<small>Wie lange eine Nachricht links sichtbar ist.</small>
                  </span>
                  <div className="unit-input">
                    <input
                      type="number"
                      min="3"
                      max="120"
                      value={config.sidebarRotationSeconds}
                      onChange={(event) => setConfig({ ...config, sidebarRotationSeconds: Number(event.target.value) })}
                    />
                    <em>Sek.</em>
                  </div>
                </label>
                <label>
                  <span>
                    Kandidaten prüfen<small>Größe des Pools für abwechslungsreiche Auswahl.</small>
                  </span>
                  <input
                    type="number"
                    min="1"
                    max="500"
                    value={config.scanLimit}
                    onChange={(event) => setConfig({ ...config, scanLimit: Number(event.target.value) })}
                  />
                </label>
              </div>
              <div className="automation-toggles">
                <label>
                  <input
                    type="checkbox"
                    checked={config.requireStream}
                    onChange={(event) => setConfig({ ...config, requireStream: event.target.checked })}
                  />
                  <span>
                    <strong>Nur bei aktivem Stream abspielen</strong>
                    <small>Planung läuft weiter, Ausgabe wartet auf den Stream.</small>
                  </span>
                </label>
                <label>
                  <input
                    type="checkbox"
                    checked={config.requireVideo}
                    onChange={(event) => setConfig({ ...config, requireVideo: event.target.checked })}
                  />
                  <span>
                    <strong>Nachrichten nur mit geprüftem Bildmaterial</strong>
                    <small>Verhindert leere visuelle Beiträge.</small>
                  </span>
                </label>
              </div>
            </section>

            <section className="hub-panel automation-source-panel">
              <header>
                <div>
                  <p className="eyebrow">Inhaltspool</p>
                  <h2>Erlaubte Quellen</h2>
                </div>
              </header>
              <p className="panel-intro">Ohne Auswahl verwendet der Autopilot alle aktiven Quellen und Kategorien.</p>
              <div className="source-chip-picker">
                <h3>
                  Nachrichtenquellen <span>{config.sourceIds.length || 'alle'}</span>
                </h3>
                <div>
                  {sources
                    .filter((source) => source.active)
                    .map((source) => (
                      <label key={source.id} className={config.sourceIds.includes(source.id) ? 'selected' : ''}>
                        <input
                          type="checkbox"
                          checked={config.sourceIds.includes(source.id)}
                          onChange={(event) =>
                            setConfig({
                              ...config,
                              sourceIds: event.target.checked
                                ? [...config.sourceIds, source.id]
                                : config.sourceIds.filter((id) => id !== source.id),
                            })
                          }
                        />
                        {source.name}
                      </label>
                    ))}
                </div>
              </div>
              <div className="source-chip-picker">
                <h3>
                  YouTube-Kategorien <span>{config.youtubeCategoryIds.length || 'alle'}</span>
                </h3>
                <div>
                  {categories.map((category) => (
                    <label
                      key={category.id}
                      className={config.youtubeCategoryIds.includes(category.id) ? 'selected' : ''}
                    >
                      <input
                        type="checkbox"
                        checked={config.youtubeCategoryIds.includes(category.id)}
                        onChange={(event) =>
                          setConfig({
                            ...config,
                            youtubeCategoryIds: event.target.checked
                              ? [...config.youtubeCategoryIds, category.id]
                              : config.youtubeCategoryIds.filter((id) => id !== category.id),
                          })
                        }
                      />
                      {category.name}
                    </label>
                  ))}
                </div>
              </div>
            </section>
          </div>

          <section className="hub-panel daily-formats-panel">
            <header>
              <div>
                <p className="eyebrow">Tagesstruktur</p>
                <h2>Feste Sendeformate</h2>
                <p>Formate setzen Zeitkanten. Dazwischen füllt der Standard-Autopilot das Programm.</p>
              </div>
              <button
                onClick={() => {
                  const item = newFormat(config.dailyFormats.length);
                  setConfig({ ...config, dailyFormats: [...config.dailyFormats, item] });
                  setExpandedFormat(item.id);
                }}
              >
                <Plus size={16} /> Format hinzufügen
              </button>
            </header>
            <div className="format-timeline">
              {sortedFormats.length > 0 ? (
                sortedFormats.map((format) => (
                  <article
                    key={format.id}
                    className={`${format.enabled ? '' : 'disabled'} ${expandedFormat === format.id ? 'expanded' : ''}`}
                  >
                    <button
                      className="format-summary"
                      onClick={() => setExpandedFormat(expandedFormat === format.id ? null : format.id)}
                    >
                      <time>{format.startTime}</time>
                      <span className="format-track">
                        <i />
                      </span>
                      <span>
                        <strong>{format.name}</strong>
                        <small>
                          {modeOptions.find((mode) => mode.id === format.contentMode)?.label} · {format.durationMinutes}{' '}
                          Minuten
                        </small>
                      </span>
                      <span className={`state-pill ${format.enabled ? 'success' : ''}`}>
                        {format.enabled ? 'Aktiv' : 'Aus'}
                      </span>
                      <ChevronDown size={16} />
                    </button>
                    {expandedFormat === format.id && (
                      <div className="format-editor">
                        <div className="wizard-form-grid">
                          <label>
                            Name
                            <input
                              value={format.name}
                              onChange={(event) => updateFormat(format.id, { name: event.target.value })}
                            />
                          </label>
                          <label>
                            Startzeit
                            <input
                              type="time"
                              value={format.startTime}
                              onChange={(event) => updateFormat(format.id, { startTime: event.target.value })}
                            />
                          </label>
                          <label>
                            Dauer in Minuten
                            <input
                              type="number"
                              min="5"
                              max="1440"
                              value={format.durationMinutes}
                              onChange={(event) =>
                                updateFormat(format.id, { durationMinutes: Number(event.target.value) })
                              }
                            />
                          </label>
                          <label>
                            Inhaltsmodus
                            <select
                              value={format.contentMode}
                              onChange={(event) =>
                                updateFormat(format.id, { contentMode: event.target.value as ContentMode })
                              }
                            >
                              {modeOptions.map((mode) => (
                                <option key={mode.id} value={mode.id}>
                                  {mode.label}
                                </option>
                              ))}
                            </select>
                          </label>
                        </div>
                        <div className="format-actions">
                          <label className="toggle-row">
                            <input
                              type="checkbox"
                              checked={format.enabled}
                              onChange={(event) => updateFormat(format.id, { enabled: event.target.checked })}
                            />{' '}
                            Format täglich einplanen
                          </label>
                          <button
                            className="ghost-button danger-text"
                            onClick={() =>
                              setConfig({
                                ...config,
                                dailyFormats: config.dailyFormats.filter((item) => item.id !== format.id),
                              })
                            }
                          >
                            <Trash2 size={15} /> Löschen
                          </button>
                        </div>
                      </div>
                    )}
                  </article>
                ))
              ) : (
                <div className="hub-empty">
                  <CalendarClock size={24} />
                  <strong>Noch keine Zeitkanten</strong>
                  <span>Das Studio plant mit den Standardregeln durchgehend weiter.</span>
                </div>
              )}
            </div>
          </section>

          <section className="automation-plan-callout">
            <span>
              <CalendarClock size={28} />
            </span>
            <div>
              <strong>Programm für die nächsten 24 Stunden aktualisieren</strong>
              <p>
                Vorhandene Sendungen werden geschützt. Freie Zeitfenster füllt der Autopilot mit möglichst neuen und
                abwechslungsreichen Inhalten.
              </p>
            </div>
            <button
              className="primary-button"
              disabled={!allowed || Boolean(working)}
              onClick={() => void plan24Hours()}
            >
              {working === 'plan' ? <LoaderCircle size={17} className="spin" /> : <Sparkles size={17} />} Jetzt 24
              Stunden planen
            </button>
          </section>
          <footer className="automation-footer">
            <span>Änderungen werden erst mit „Änderungen speichern“ aktiv.</span>
            <Link to={routes.broadcast}>
              Zum Programmplan <ArrowRight size={15} />
            </Link>
          </footer>
        </>
      )}
    </section>
  );
}
