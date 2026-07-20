import React, { useEffect, useMemo, useRef, useState } from 'react';
import {
  AlertTriangle,
  Copy,
  Edit3,
  ExternalLink,
  Layers3,
  MonitorCheck,
  Plus,
  Search,
  Settings2,
  Trash2,
} from 'lucide-react';
import { Link } from 'react-router-dom';
import { api, can, type SessionUser } from '../api/client.js';
import {
  OverlayProjectDialog,
  overlayTemplateLabel,
  overlayTemplates,
  type OverlayProjectInput,
} from '../components/OverlayProjectDialog.js';
import { overlayEditorRoute } from '../navigation.js';

type OverlayProject = {
  id: string;
  name: string;
  template: string;
  width: number;
  height: number;
  version: number;
  draft_version?: number | null;
  published_version?: number | null;
  obs_configured_url?: string | null;
  created_at: string;
  updated_at?: string;
};

type Filter = 'all' | 'published' | 'obs' | 'draft';
type Sort = 'updated' | 'name' | 'created';

function formatDate(value?: string) {
  if (!value) return '–';
  return new Intl.DateTimeFormat('de-DE', { dateStyle: 'medium', timeStyle: 'short' }).format(new Date(value));
}

export function OverlaysPage({ user }: { user: SessionUser }) {
  const allowed = can(user, 'obs:write');
  const [items, setItems] = useState<OverlayProject[]>([]);
  const [loading, setLoading] = useState(true);
  const [dialog, setDialog] = useState<'create' | 'edit' | null>(null);
  const [editing, setEditing] = useState<OverlayProject>();
  const [busy, setBusy] = useState(false);
  const [actionBusy, setActionBusy] = useState('');
  const [error, setError] = useState('');
  const [dialogError, setDialogError] = useState('');
  const [query, setQuery] = useState('');
  const [template, setTemplate] = useState('all');
  const [filter, setFilter] = useState<Filter>('all');
  const [sort, setSort] = useState<Sort>('updated');
  const loadRevision = useRef(0);

  async function load() {
    const revision = ++loadRevision.current;
    setLoading(true);
    try {
      const next = await api<OverlayProject[]>('/api/overlays');
      if (revision !== loadRevision.current) return;
      setItems(next);
      setError('');
    } catch (requestError) {
      if (revision === loadRevision.current)
        setError(requestError instanceof Error ? requestError.message : String(requestError));
    } finally {
      if (revision === loadRevision.current) setLoading(false);
    }
  }

  useEffect(() => {
    void load();
    return () => {
      loadRevision.current++;
    };
  }, []);

  const filtered = useMemo(() => {
    const normalized = query.trim().toLocaleLowerCase('de');
    return items
      .filter(
        (item) =>
          !normalized || `${item.name} ${overlayTemplateLabel(item.template)}`.toLowerCase().includes(normalized),
      )
      .filter((item) => template === 'all' || item.template === template)
      .filter((item) => {
        if (filter === 'published') return Boolean(item.published_version);
        if (filter === 'obs') return Boolean(item.obs_configured_url);
        if (filter === 'draft') return !item.published_version || item.draft_version !== item.published_version;
        return true;
      })
      .sort((a, b) => {
        if (sort === 'name') return a.name.localeCompare(b.name, 'de');
        const left = sort === 'created' ? a.created_at : (a.updated_at ?? a.created_at);
        const right = sort === 'created' ? b.created_at : (b.updated_at ?? b.created_at);
        return new Date(right).getTime() - new Date(left).getTime();
      });
  }, [filter, items, query, sort, template]);

  const stats = useMemo(
    () => ({
      total: items.length,
      published: items.filter((item) => item.published_version).length,
      obs: items.filter((item) => item.obs_configured_url).length,
      drafts: items.filter((item) => !item.published_version || item.draft_version !== item.published_version).length,
    }),
    [items],
  );

  function openCreate() {
    setDialogError('');
    setEditing(undefined);
    setDialog('create');
  }

  function openEdit(project: OverlayProject) {
    setDialogError('');
    setEditing(project);
    setDialog('edit');
  }

  async function submitProject(input: OverlayProjectInput) {
    if (busy) return;
    setBusy(true);
    setDialogError('');
    try {
      if (dialog === 'edit' && editing) {
        await api(`/api/overlays/${editing.id}`, {
          method: 'PATCH',
          body: JSON.stringify({ name: input.name }),
        });
      } else {
        await api('/api/overlays', { method: 'POST', body: JSON.stringify(input) });
      }
      setDialog(null);
      await load();
    } catch (requestError) {
      setDialogError(requestError instanceof Error ? requestError.message : String(requestError));
    } finally {
      setBusy(false);
    }
  }

  async function duplicate(project: OverlayProject) {
    if (actionBusy) return;
    setActionBusy(project.id);
    try {
      await api(`/api/overlays/${project.id}/duplicate`, {
        method: 'POST',
        body: JSON.stringify({ name: `${project.name} – Kopie` }),
      });
      await load();
    } catch (requestError) {
      setError(requestError instanceof Error ? requestError.message : String(requestError));
    } finally {
      setActionBusy('');
    }
  }

  async function remove(project: OverlayProject) {
    if (
      actionBusy ||
      !window.confirm(
        `Overlay „${project.name}“ wirklich löschen? Veröffentlichte oder in OBS verwendete Overlays sollten vorher ersetzt werden.`,
      )
    )
      return;
    setActionBusy(project.id);
    try {
      await api(`/api/overlays/${project.id}`, { method: 'DELETE' });
      await load();
    } catch (requestError) {
      setError(requestError instanceof Error ? requestError.message : String(requestError));
    } finally {
      setActionBusy('');
    }
  }

  return (
    <section className="panel overlay-library">
      <div className="page-title">
        <div>
          <p className="eyebrow">Grafiksystem</p>
          <h2>Overlay-Bibliothek</h2>
          <p>Sendegrafiken organisieren, direkt prüfen, bearbeiten und für OBS veröffentlichen.</p>
        </div>
        <div className="page-title-actions">
          <button className="primary-button" disabled={!allowed} onClick={openCreate}>
            <Plus size={17} /> Neues Overlay
          </button>
        </div>
      </div>

      <div className="overlay-library-stats" aria-label="Overlay-Übersicht">
        <button className={filter === 'all' ? 'active' : ''} onClick={() => setFilter('all')}>
          <span>Gesamt</span>
          <strong>{stats.total}</strong>
        </button>
        <button className={filter === 'published' ? 'active' : ''} onClick={() => setFilter('published')}>
          <span>Veröffentlicht</span>
          <strong>{stats.published}</strong>
        </button>
        <button className={filter === 'obs' ? 'active' : ''} onClick={() => setFilter('obs')}>
          <span>In OBS aktiv</span>
          <strong>{stats.obs}</strong>
        </button>
        <button className={filter === 'draft' ? 'active' : ''} onClick={() => setFilter('draft')}>
          <span>Mit Entwurf</span>
          <strong>{stats.drafts}</strong>
        </button>
      </div>

      <div className="overlay-library-controls">
        <label className="overlay-search">
          <Search size={16} />
          <input
            aria-label="Overlays durchsuchen"
            placeholder="Overlays durchsuchen …"
            value={query}
            onChange={(event) => setQuery(event.target.value)}
          />
        </label>
        <select
          aria-label="Nach Vorlage filtern"
          value={template}
          onChange={(event) => setTemplate(event.target.value)}
        >
          <option value="all">Alle Vorlagen</option>
          {overlayTemplates.map((item) => (
            <option key={item.id} value={item.id}>
              {item.label}
            </option>
          ))}
        </select>
        <select aria-label="Overlays sortieren" value={sort} onChange={(event) => setSort(event.target.value as Sort)}>
          <option value="updated">Zuletzt bearbeitet</option>
          <option value="created">Zuletzt erstellt</option>
          <option value="name">Name A–Z</option>
        </select>
      </div>

      {error && (
        <div className="status-message status-error" role="alert">
          <AlertTriangle size={19} />
          <div>
            <strong>Overlays konnten nicht aktualisiert werden</strong>
            <p>{error}</p>
          </div>
        </div>
      )}

      {loading ? (
        <p className="muted">Overlays werden geladen …</p>
      ) : filtered.length > 0 ? (
        <div className="overlay-grid overlay-library-grid">
          {filtered.map((overlay) => (
            <article className="overlay-card overlay-library-card" key={overlay.id}>
              <div className={`overlay-card-preview ${overlay.width < overlay.height ? 'portrait' : ''}`}>
                <iframe
                  title={`Vorschau ${overlay.name}`}
                  src={`/overlay/preview/${encodeURIComponent(overlay.id)}`}
                  loading="lazy"
                  tabIndex={-1}
                />
                <div className="overlay-preview-badges">
                  <span>{overlayTemplateLabel(overlay.template)}</span>
                  <span>
                    {overlay.width} × {overlay.height}
                  </span>
                </div>
              </div>
              <div className="overlay-card-body">
                <div className="card-header">
                  <div>
                    <h3>{overlay.name}</h3>
                    <p className="card-meta">Bearbeitet {formatDate(overlay.updated_at ?? overlay.created_at)}</p>
                  </div>
                  <span className={`state-pill ${overlay.obs_configured_url ? 'success' : 'warning'}`}>
                    <MonitorCheck size={12} /> {overlay.obs_configured_url ? 'OBS aktiv' : 'Nicht aktiv'}
                  </span>
                </div>
                <div className="overlay-version-row">
                  <span className={`state-pill ${overlay.published_version ? 'success' : ''}`}>
                    {overlay.published_version ? `Live v${overlay.published_version}` : 'Unveröffentlicht'}
                  </span>
                  {overlay.draft_version && <span className="state-pill">Entwurf v{overlay.draft_version}</span>}
                </div>
                <div className="overlay-card-actions">
                  <Link className="primary-button" to={overlayEditorRoute(overlay.id)}>
                    <Edit3 size={16} /> Editor öffnen
                  </Link>
                  <a
                    className="button icon-button"
                    href={`/overlay/preview/${overlay.id}`}
                    target="_blank"
                    rel="noreferrer"
                    title="Vorschau öffnen"
                    aria-label="Vorschau öffnen"
                  >
                    <ExternalLink size={16} />
                  </a>
                  <button
                    className="icon-button"
                    disabled={!allowed || actionBusy === overlay.id}
                    onClick={() => openEdit(overlay)}
                    title="Einstellungen"
                    aria-label="Overlay-Einstellungen"
                  >
                    <Settings2 size={16} />
                  </button>
                  <button
                    className="icon-button"
                    disabled={!allowed || actionBusy === overlay.id}
                    onClick={() => void duplicate(overlay)}
                    title="Duplizieren"
                    aria-label="Overlay duplizieren"
                  >
                    <Copy size={16} />
                  </button>
                  <button
                    className="icon-button danger-button"
                    disabled={!allowed || actionBusy === overlay.id}
                    onClick={() => void remove(overlay)}
                    title="Löschen"
                    aria-label="Overlay löschen"
                  >
                    <Trash2 size={16} />
                  </button>
                </div>
              </div>
            </article>
          ))}
        </div>
      ) : (
        <div className="empty-state">
          <div>
            <Layers3 size={24} />
            <p>
              {items.length ? 'Keine Overlays entsprechen den aktuellen Filtern.' : 'Noch keine Overlays angelegt.'}
            </p>
            {!items.length && allowed && (
              <button className="primary-button" onClick={openCreate}>
                <Plus size={16} /> Erstes Overlay erstellen
              </button>
            )}
          </div>
        </div>
      )}

      {dialog && (
        <OverlayProjectDialog
          mode={dialog}
          busy={busy}
          error={dialogError}
          initial={
            editing
              ? {
                  name: editing.name,
                  template: editing.template as OverlayProjectInput['template'],
                  width: editing.width as 1920 | 1080,
                  height: editing.height as 1080 | 1920,
                }
              : undefined
          }
          onClose={() => !busy && setDialog(null)}
          onSubmit={submitProject}
        />
      )}
    </section>
  );
}
