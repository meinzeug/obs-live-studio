import React, { useEffect, useMemo, useState } from 'react';
import { Edit3, FolderPlus, PlayCircle, Plus, Save, Search, Settings2, Tags, Trash2, Video, X } from 'lucide-react';
import { api, can, type SessionUser } from '../api/client.js';

type YoutubeCategory = {
  id: string;
  name: string;
  description: string | null;
  color: string;
  sort_order: number;
};
type YoutubeVideo = {
  id: string;
  category_id: string | null;
  category_name?: string | null;
  category_color?: string | null;
  title: string;
  url: string;
  video_id: string;
  description: string | null;
  duration_seconds: number;
  enabled: boolean;
  last_scheduled_at: string | null;
  created_at: string;
};
type AutopilotFormat = {
  id: string;
  name: string;
  startTime: string;
  durationMinutes: number;
  contentMode: 'news' | 'youtube' | 'mixed';
  youtubeCategoryIds: string[];
  sourceIds: string[];
  enabled: boolean;
};
type AutopilotSettings = {
  enabled: boolean;
  contentMode: 'news' | 'youtube' | 'mixed';
  youtubeCategoryIds: string[];
  dailyFormats: AutopilotFormat[];
};

const emptyVideo = {
  title: '',
  url: '',
  categoryId: '',
  description: '',
  enabled: true,
};
const emptyCategory = { name: '', description: '', color: '#ef4444', sortOrder: 0 };

function formatDuration(seconds: number) {
  const minutes = Math.max(1, Math.round(seconds / 60));
  return minutes >= 60 ? `${Math.floor(minutes / 60)} h ${minutes % 60} min` : `${minutes} min`;
}

function localDate(value: string | null) {
  if (!value) return 'Noch nicht geplant';
  const date = new Date(value);
  return Number.isNaN(date.getTime()) ? 'Noch nicht geplant' : date.toLocaleString('de-DE');
}

export function YoutubeVideosPage({ user }: { user: SessionUser }) {
  const [categories, setCategories] = useState<YoutubeCategory[]>([]);
  const [videos, setVideos] = useState<YoutubeVideo[]>([]);
  const [autopilot, setAutopilot] = useState<AutopilotSettings>();
  const [selectedCategory, setSelectedCategory] = useState('');
  const [query, setQuery] = useState('');
  const [message, setMessage] = useState('');
  const [error, setError] = useState('');
  const [working, setWorking] = useState(false);
  const [videoModal, setVideoModal] = useState<YoutubeVideo | 'new' | null>(null);
  const [settingsOpen, setSettingsOpen] = useState(false);
  const [videoDraft, setVideoDraft] = useState(emptyVideo);
  const [categoryDraft, setCategoryDraft] = useState(emptyCategory);
  const allowedWrite = can(user, 'broadcast:write');

  async function load() {
    try {
      const [library, nextAutopilot] = await Promise.all([
        api<{ categories: YoutubeCategory[]; videos: YoutubeVideo[] }>('/api/youtube-videos'),
        api<AutopilotSettings>('/api/autopilot'),
      ]);
      setCategories(library.categories);
      setVideos(library.videos);
      setAutopilot(nextAutopilot);
      setError('');
    } catch (requestError) {
      setError(requestError instanceof Error ? requestError.message : String(requestError));
    }
  }

  useEffect(() => {
    void load();
  }, []);

  function openVideo(video?: YoutubeVideo) {
    setVideoModal(video ?? 'new');
    setVideoDraft(
      video
        ? {
            title: video.title,
            url: video.url,
            categoryId: video.category_id ?? '',
            description: video.description ?? '',
            enabled: video.enabled,
          }
        : emptyVideo,
    );
  }

  async function saveVideo() {
    if (!allowedWrite || working) return;
    setWorking(true);
    setError('');
    try {
      const body = {
        ...videoDraft,
        categoryId: videoDraft.categoryId || null,
        description: videoDraft.description || null,
      };
      if (videoModal && videoModal !== 'new') {
        await api(`/api/youtube-videos/${videoModal.id}`, { method: 'PUT', body: JSON.stringify(body) });
        setMessage('YouTube-Video gespeichert.');
      } else {
        await api('/api/youtube-videos', { method: 'POST', body: JSON.stringify(body) });
        setMessage('YouTube-Video hinzugefügt.');
      }
      setVideoModal(null);
      await load();
    } catch (requestError) {
      setError(requestError instanceof Error ? requestError.message : String(requestError));
    } finally {
      setWorking(false);
    }
  }

  async function removeVideo(video: YoutubeVideo) {
    if (!allowedWrite || !window.confirm(`„${video.title}“ entfernen?`)) return;
    await api(`/api/youtube-videos/${video.id}`, { method: 'DELETE' });
    setMessage('YouTube-Video entfernt.');
    await load();
  }

  async function saveCategory() {
    if (!allowedWrite || working || !categoryDraft.name.trim()) return;
    setWorking(true);
    try {
      await api('/api/youtube-videos/categories', {
        method: 'POST',
        body: JSON.stringify(categoryDraft),
      });
      setCategoryDraft(emptyCategory);
      setMessage('Kategorie erstellt.');
      await load();
    } catch (requestError) {
      setError(requestError instanceof Error ? requestError.message : String(requestError));
    } finally {
      setWorking(false);
    }
  }

  async function removeCategory(category: YoutubeCategory) {
    if (!allowedWrite || !window.confirm(`Kategorie „${category.name}“ löschen? Videos bleiben erhalten.`)) return;
    await api(`/api/youtube-videos/categories/${category.id}`, { method: 'DELETE' });
    await load();
  }

  async function saveAutopilot(next = autopilot) {
    if (!allowedWrite || working || !next) return;
    setWorking(true);
    try {
      const saved = await api<AutopilotSettings>('/api/autopilot', {
        method: 'POST',
        body: JSON.stringify(next),
      });
      setAutopilot(saved);
      setMessage('Autopilot-YouTube-Einstellungen gespeichert.');
    } catch (requestError) {
      setError(requestError instanceof Error ? requestError.message : String(requestError));
    } finally {
      setWorking(false);
    }
  }

  async function plan24h() {
    if (!allowedWrite || working) return;
    setWorking(true);
    try {
      const result = await api<{ created: unknown[]; skipped: unknown[] }>('/api/autopilot/plan-24h', {
        method: 'POST',
      });
      setMessage(`${result.created.length} Sendungen geplant, ${result.skipped.length} Slots übersprungen.`);
      await load();
    } catch (requestError) {
      setError(requestError instanceof Error ? requestError.message : String(requestError));
    } finally {
      setWorking(false);
    }
  }

  const visibleVideos = useMemo(() => {
    const term = query.trim().toLocaleLowerCase('de');
    return videos.filter((video) => {
      if (selectedCategory && video.category_id !== selectedCategory) return false;
      if (!term) return true;
      return `${video.title} ${video.description ?? ''} ${video.category_name ?? ''}`
        .toLocaleLowerCase('de')
        .includes(term);
    });
  }, [videos, selectedCategory, query]);

  function updateFormat(index: number, patch: Partial<AutopilotFormat>) {
    if (!autopilot) return;
    const dailyFormats = autopilot.dailyFormats.map((format, currentIndex) =>
      currentIndex === index ? { ...format, ...patch } : format,
    );
    setAutopilot({ ...autopilot, dailyFormats });
  }

  function addFormat() {
    if (!autopilot) return;
    setAutopilot({
      ...autopilot,
      dailyFormats: [
        ...autopilot.dailyFormats,
        {
          id: `format-${Date.now()}`,
          name: 'Dokumentationen',
          startTime: '20:15',
          durationMinutes: 90,
          contentMode: 'youtube',
          youtubeCategoryIds: [],
          sourceIds: [],
          enabled: true,
        },
      ],
    });
  }

  return (
    <section className="panel youtube-videos-page">
      <div className="page-title">
        <div>
          <p className="eyebrow">Videothek und Autopilot</p>
          <h2>YouTube Videos</h2>
          <p>Links verwalten, kategorisieren und automatisch in den Sendeplan einplanen.</p>
        </div>
        <div className="page-actions">
          <button className="ghost-button" onClick={() => setSettingsOpen(true)}>
            <Settings2 size={17} /> Einstellungen
          </button>
          <button className="primary-button" disabled={!allowedWrite} onClick={() => openVideo()}>
            <Plus size={17} /> Video hinzufügen
          </button>
        </div>
      </div>

      {(message || error) && <div className={`settings-message ${error ? 'error' : ''}`}>{error || message}</div>}

      <div className="youtube-toolbar">
        <label className="settings-search">
          <Search size={16} />
          <span className="visually-hidden">YouTube-Videos suchen</span>
          <input
            value={query}
            onChange={(event) => setQuery(event.target.value)}
            placeholder="Titel, Kategorie, Notiz"
          />
        </label>
        <div className="youtube-category-tabs">
          <button className={!selectedCategory ? 'active' : ''} onClick={() => setSelectedCategory('')}>
            Alle
          </button>
          {categories.map((category) => (
            <button
              key={category.id}
              className={selectedCategory === category.id ? 'active' : ''}
              onClick={() => setSelectedCategory(category.id)}
            >
              <span style={{ background: category.color }} />
              {category.name}
            </button>
          ))}
        </div>
      </div>

      <div className="youtube-video-grid">
        {visibleVideos.map((video) => (
          <article className={`youtube-video-card ${video.enabled ? '' : 'disabled'}`} key={video.id}>
            <div className="youtube-thumb">
              <img src={`https://i.ytimg.com/vi/${video.video_id}/hqdefault.jpg`} alt="" loading="lazy" />
              <span>
                <Video size={16} /> {formatDuration(video.duration_seconds)}
              </span>
            </div>
            <div className="youtube-video-body">
              <div>
                <span className="youtube-category-pill" style={{ borderColor: video.category_color ?? '#ef4444' }}>
                  {video.category_name ?? 'Ohne Kategorie'}
                </span>
                <h3>{video.title}</h3>
                <p>{video.description || 'Keine Notiz hinterlegt.'}</p>
              </div>
              <small>Zuletzt geplant: {localDate(video.last_scheduled_at)}</small>
              <div className="youtube-card-actions">
                <a className="ghost-button" href={video.url} target="_blank" rel="noreferrer">
                  <PlayCircle size={16} /> Öffnen
                </a>
                <button className="ghost-button" disabled={!allowedWrite} onClick={() => openVideo(video)}>
                  <Edit3 size={16} /> Bearbeiten
                </button>
                <button className="danger-button" disabled={!allowedWrite} onClick={() => void removeVideo(video)}>
                  <Trash2 size={16} /> Entfernen
                </button>
              </div>
            </div>
          </article>
        ))}
      </div>

      {!visibleVideos.length && <p className="muted">Keine YouTube-Videos für diese Auswahl vorhanden.</p>}

      {videoModal && (
        <div className="modal-backdrop" role="dialog" aria-modal="true">
          <div className="modal-card youtube-modal-card">
            <div className="modal-header">
              <div>
                <p className="eyebrow">YouTube Bibliothek</p>
                <h3>{videoModal === 'new' ? 'Video hinzufügen' : 'Video bearbeiten'}</h3>
              </div>
              <button className="ghost-button icon-button" onClick={() => setVideoModal(null)} aria-label="Schließen">
                <X size={17} />
              </button>
            </div>
            <div className="settings-automation-grid">
              <label className="settings-option stream-target-wide">
                <span>YouTube-Link</span>
                <input
                  value={videoDraft.url}
                  onChange={(event) => setVideoDraft({ ...videoDraft, url: event.target.value })}
                />
              </label>
              <label className="settings-option">
                <span>Titel</span>
                <input
                  value={videoDraft.title}
                  onChange={(event) => setVideoDraft({ ...videoDraft, title: event.target.value })}
                />
              </label>
              <label className="settings-option">
                <span>Kategorie</span>
                <select
                  value={videoDraft.categoryId}
                  onChange={(event) => setVideoDraft({ ...videoDraft, categoryId: event.target.value })}
                >
                  <option value="">Ohne Kategorie</option>
                  {categories.map((category) => (
                    <option key={category.id} value={category.id}>
                      {category.name}
                    </option>
                  ))}
                </select>
              </label>
              <label className="settings-option">
                <span>Laufzeit</span>
                <small>
                  {videoModal !== 'new'
                    ? `${formatDuration(videoModal.duration_seconds)} gespeichert. Bei geänderter URL wird die Laufzeit neu ermittelt.`
                    : 'Wird beim Speichern automatisch über YouTube ermittelt.'}
                </small>
              </label>
              <label className="settings-option settings-toggle-option">
                <span>Aktiv</span>
                <span className="toggle-row">
                  <input
                    type="checkbox"
                    checked={videoDraft.enabled}
                    onChange={(event) => setVideoDraft({ ...videoDraft, enabled: event.target.checked })}
                  />
                  Für Autopilot verwenden
                </span>
              </label>
              <label className="settings-option stream-target-wide">
                <span>Notiz</span>
                <textarea
                  value={videoDraft.description}
                  onChange={(event) => setVideoDraft({ ...videoDraft, description: event.target.value })}
                />
              </label>
            </div>
            <div className="modal-actions">
              <button className="ghost-button" onClick={() => setVideoModal(null)}>
                Abbrechen
              </button>
              <button className="primary-button" disabled={!allowedWrite || working} onClick={() => void saveVideo()}>
                <Save size={17} /> Speichern
              </button>
            </div>
          </div>
        </div>
      )}

      {settingsOpen && autopilot && (
        <div className="modal-backdrop" role="dialog" aria-modal="true">
          <div className="modal-card youtube-settings-card">
            <div className="modal-header">
              <div>
                <p className="eyebrow">Autopilot</p>
                <h3>Video-Kategorien und Tagesformate</h3>
              </div>
              <button
                className="ghost-button icon-button"
                onClick={() => setSettingsOpen(false)}
                aria-label="Schließen"
              >
                <X size={17} />
              </button>
            </div>
            <div className="youtube-settings-layout">
              <section>
                <h4>
                  <Tags size={17} /> Kategorien
                </h4>
                <div className="youtube-category-editor">
                  <input
                    placeholder="Neue Kategorie"
                    value={categoryDraft.name}
                    onChange={(event) => setCategoryDraft({ ...categoryDraft, name: event.target.value })}
                  />
                  <input
                    type="color"
                    value={categoryDraft.color}
                    onChange={(event) => setCategoryDraft({ ...categoryDraft, color: event.target.value })}
                  />
                  <button
                    className="ghost-button"
                    disabled={!allowedWrite || working}
                    onClick={() => void saveCategory()}
                  >
                    <FolderPlus size={16} /> Anlegen
                  </button>
                </div>
                <div className="youtube-category-list">
                  {categories.map((category) => (
                    <div key={category.id}>
                      <span style={{ background: category.color }} />
                      <strong>{category.name}</strong>
                      <button
                        className="ghost-button icon-button"
                        disabled={!allowedWrite}
                        onClick={() => void removeCategory(category)}
                      >
                        <Trash2 size={15} />
                      </button>
                    </div>
                  ))}
                </div>
              </section>
              <section>
                <h4>
                  <Settings2 size={17} /> Autopilot-Inhalte
                </h4>
                <label className="settings-option">
                  <span>Sendemodus</span>
                  <select
                    value={autopilot.contentMode}
                    onChange={(event) => setAutopilot({ ...autopilot, contentMode: event.target.value as any })}
                  >
                    <option value="news">Nur Nachrichten</option>
                    <option value="youtube">Nur YouTube Videos</option>
                    <option value="mixed">Nachrichten und YouTube gemischt</option>
                  </select>
                </label>
                <div className="youtube-format-list">
                  {autopilot.dailyFormats.map((format, index) => (
                    <div className="youtube-format-row" key={format.id}>
                      <input
                        value={format.name}
                        onChange={(event) => updateFormat(index, { name: event.target.value })}
                      />
                      <input
                        type="time"
                        value={format.startTime}
                        onChange={(event) => updateFormat(index, { startTime: event.target.value })}
                      />
                      <input
                        type="number"
                        min="5"
                        max="1440"
                        value={format.durationMinutes}
                        onChange={(event) => updateFormat(index, { durationMinutes: Number(event.target.value) })}
                      />
                      <select
                        value={format.contentMode}
                        onChange={(event) => updateFormat(index, { contentMode: event.target.value as any })}
                      >
                        <option value="news">Nachrichten</option>
                        <option value="youtube">YouTube</option>
                        <option value="mixed">Gemischt</option>
                      </select>
                      <select
                        multiple
                        value={format.youtubeCategoryIds}
                        onChange={(event) =>
                          updateFormat(index, {
                            youtubeCategoryIds: Array.from(event.currentTarget.selectedOptions).map(
                              (option) => option.value,
                            ),
                          })
                        }
                      >
                        {categories.map((category) => (
                          <option key={category.id} value={category.id}>
                            {category.name}
                          </option>
                        ))}
                      </select>
                      <label className="toggle-row compact">
                        <input
                          type="checkbox"
                          checked={format.enabled}
                          onChange={(event) => updateFormat(index, { enabled: event.target.checked })}
                        />
                        Aktiv
                      </label>
                      <button
                        className="ghost-button icon-button"
                        onClick={() =>
                          setAutopilot({
                            ...autopilot,
                            dailyFormats: autopilot.dailyFormats.filter((_, currentIndex) => currentIndex !== index),
                          })
                        }
                      >
                        <Trash2 size={15} />
                      </button>
                    </div>
                  ))}
                </div>
                <div className="modal-actions">
                  <button className="ghost-button" onClick={addFormat}>
                    <Plus size={16} /> Format
                  </button>
                  <button className="ghost-button" disabled={!allowedWrite || working} onClick={() => void plan24h()}>
                    <PlayCircle size={16} /> 24h planen
                  </button>
                  <button
                    className="primary-button"
                    disabled={!allowedWrite || working}
                    onClick={() => void saveAutopilot()}
                  >
                    <Save size={16} /> Speichern
                  </button>
                </div>
              </section>
            </div>
          </div>
        </div>
      )}
    </section>
  );
}
