import React, { useEffect, useMemo, useRef, useState } from 'react';
import {
  Badge,
  Clock3,
  Copy,
  Eye,
  EyeOff,
  Image,
  Layers3,
  Lock,
  LockOpen,
  Minus,
  PanelBottom,
  Plus,
  Redo2,
  Save,
  Send,
  Shapes,
  Trash2,
  Type,
  Undo2,
  type LucideIcon,
} from 'lucide-react';
import { useNavigate, useParams } from 'react-router-dom';
import { can, type SessionUser, api } from '../api/client.js';
import { routes } from '../navigation.js';
import { patchOverlayElement, SerialTaskQueue } from '../overlay-editor-state.js';

type El = {
  id: string;
  type: string;
  name: string;
  x: number;
  y: number;
  width: number;
  height: number;
  zIndex: number;
  locked: boolean;
  hidden: boolean;
  binding?: string;
  props: any;
  opacity: number;
  rotation: number;
};
type Doc = { schemaVersion: 1; template: string; width: number; height: number; elements: El[]; updatedAt?: string };

type DragState = {
  id: string;
  dx: number;
  dy: number;
  origin: Doc;
  moved: boolean;
};

const tools: Array<{ type: string; label: string; icon: LucideIcon }> = [
  { type: 'text', label: 'Text', icon: Type },
  { type: 'image', label: 'Bild', icon: Image },
  { type: 'shape', label: 'Form', icon: Shapes },
  { type: 'line', label: 'Linie', icon: Minus },
  { type: 'clock', label: 'Uhr', icon: Clock3 },
  { type: 'logo', label: 'Logo', icon: Badge },
  { type: 'ticker', label: 'Ticker', icon: PanelBottom },
];

function clone<T>(value: T): T {
  if (typeof structuredClone === 'function') return structuredClone(value);
  return JSON.parse(JSON.stringify(value)) as T;
}

export function OverlayEditorPage({ user }: { user: SessionUser }) {
  const { id: routeId } = useParams();
  const navigate = useNavigate();
  const allowed = can(user, 'obs:write');
  const [projects, setProjects] = useState<any[]>([]);
  const [current, setCurrent] = useState<any>();
  const [doc, setDoc] = useState<Doc | null>(null);
  const [selected, setSelected] = useState<string>('');
  const [history, setHistory] = useState<Doc[]>([]);
  const [future, setFuture] = useState<Doc[]>([]);
  const [message, setMessage] = useState('');
  const [working, setWorking] = useState('');
  const drag = useRef<DragState | null>(null);
  const saveQueue = useRef(new SerialTaskQueue());
  const currentProjectId = useRef('');
  const dirty = useRef(false);
  const editRevision = useRef(0);

  async function load() {
    const projectsResult = await api<any[]>('/api/overlays');
    setProjects(projectsResult);
    if (!projectsResult.length) {
      currentProjectId.current = '';
      dirty.current = false;
      setCurrent(undefined);
      setDoc(null);
      return;
    }
    const requested = routeId ? projectsResult.find((project) => project.id === routeId) : undefined;
    if (!requested) {
      const fallbackId = projectsResult[0].id;
      setMessage(routeId ? 'Das angeforderte Overlay existiert nicht mehr. Das erste verfügbare Overlay wurde geöffnet.' : '');
      navigate(`${routes.overlays}/${fallbackId}/edit`, { replace: true });
      return;
    }
    await open(requested.id);
  }

  async function open(id: string) {
    const result = await api<any>(`/api/overlays/${id}`);
    currentProjectId.current = id;
    dirty.current = false;
    editRevision.current = 0;
    drag.current = null;
    setCurrent(result);
    setDoc(result.draft?.snapshot ?? null);
    setSelected('');
    setHistory([]);
    setFuture([]);
  }

  useEffect(() => {
    void load().catch((error) => setMessage(error instanceof Error ? error.message : String(error)));
  }, [routeId]);

  useEffect(() => {
    if (!allowed || !current?.project?.id || !doc || !dirty.current) return;
    const snapshot = clone(doc);
    const projectId = current.project.id;
    const revision = editRevision.current;
    const timer = window.setTimeout(() => {
      void saveDraft(false, snapshot, projectId, revision);
    }, 900);
    return () => window.clearTimeout(timer);
  }, [allowed, current?.project?.id, doc]);

  function markChanged(next: Doc, previous?: Doc) {
    if (previous) setHistory((items) => [...items.slice(-30), clone(previous)]);
    setFuture([]);
    dirty.current = true;
    editRevision.current += 1;
    setDoc({ ...next, updatedAt: new Date().toISOString() });
  }

  function commit(next: Doc) {
    if (!doc || !allowed) return;
    markChanged(next, doc);
  }

  function add(type: string) {
    if (!doc || !allowed) return;
    const id = `${type}-${Date.now()}`;
    commit({
      ...doc,
      elements: [
        ...doc.elements,
        {
          id,
          type,
          name: type,
          x: 120,
          y: 120,
          width: 360,
          height: 100,
          zIndex: doc.elements.length,
          locked: false,
          hidden: false,
          opacity: 1,
          rotation: 0,
          props: {
            text: type === 'text' ? 'Neuer Text' : '',
            fontSize: 42,
            fontWeight: '700',
            color: '#ffffff',
            background: 'transparent',
            borderColor: 'transparent',
            borderWidth: 0,
            borderRadius: 0,
            padding: 0,
            align: 'left',
            fontFamily: 'Inter',
            objectFit: 'contain',
            animation: type === 'ticker' ? 'ticker' : 'none',
          },
        },
      ],
    });
    setSelected(id);
  }

  function update(id: string, patch: Partial<El>) {
    if (!doc || !allowed) return;
    commit({ ...doc, elements: patchOverlayElement(doc.elements, id, patch) });
  }

  function updateControl(id: string, patch: Partial<El>) {
    if (!doc || !allowed) return;
    commit({ ...doc, elements: patchOverlayElement(doc.elements, id, patch, { allowLocked: true }) });
  }

  function updateProps(id: string, props: any) {
    const element = doc?.elements.find((item) => item.id === id);
    if (element) update(id, { props: { ...element.props, ...props } });
  }

  function remove(id: string) {
    const element = doc?.elements.find((item) => item.id === id);
    if (!doc || !allowed || element?.locked) return;
    commit({ ...doc, elements: doc.elements.filter((item) => item.id !== id) });
    if (selected === id) setSelected('');
  }

  function duplicate(id: string) {
    const element = doc?.elements.find((item) => item.id === id);
    if (!doc || !allowed || !element || element.locked) return;
    commit({
      ...doc,
      elements: [
        ...doc.elements,
        {
          ...clone(element),
          id: `${element.id}-copy-${Date.now()}`,
          x: element.x + 30,
          y: element.y + 30,
          zIndex: Math.max(...doc.elements.map((item) => item.zIndex)) + 1,
          locked: false,
        },
      ],
    });
  }

  function undo() {
    const previous = history.at(-1);
    if (!allowed || !previous || !doc) return;
    setFuture((items) => [clone(doc), ...items]);
    setDoc(clone(previous));
    setHistory((items) => items.slice(0, -1));
    dirty.current = true;
    editRevision.current += 1;
  }

  function redo() {
    const next = future[0];
    if (!allowed || !next || !doc) return;
    setHistory((items) => [...items.slice(-30), clone(doc)]);
    setDoc(clone(next));
    setFuture((items) => items.slice(1));
    dirty.current = true;
    editRevision.current += 1;
  }

  async function saveDraft(
    show = true,
    snapshot = doc ? clone(doc) : null,
    projectId = current?.project?.id as string | undefined,
    revision = editRevision.current,
  ) {
    if (!snapshot || !projectId) return false;
    try {
      const result = await saveQueue.current.enqueue(() =>
        api<any>(`/api/overlays/${projectId}/draft`, {
          method: 'PUT',
          body: JSON.stringify(snapshot),
        }),
      );
      if (currentProjectId.current === projectId) {
        setCurrent((value: any) => ({ ...value, draft: result.draft }));
        if (revision === editRevision.current) dirty.current = false;
      }
      if (show) setMessage('Entwurf gespeichert');
      else if (revision === editRevision.current) {
        setMessage((value) => (value.startsWith('Speichern fehlgeschlagen:') ? '' : value));
      }
      return true;
    } catch (error) {
      setMessage(`Speichern fehlgeschlagen: ${error instanceof Error ? error.message : String(error)}`);
      return false;
    }
  }

  async function switchOverlay(id: string) {
    if (!id || id === current?.project?.id || working) return;
    if (dirty.current && !(await saveDraft(false))) return;
    navigate(`${routes.overlays}/${id}/edit`);
  }

  async function create(template = 'main-news') {
    if (!allowed || working) return;
    setWorking('create');
    try {
      if (dirty.current && !(await saveDraft(false))) return;
      const result = await api<any>('/api/overlays', {
        method: 'POST',
        body: JSON.stringify({
          name: `Overlay ${new Date().toLocaleTimeString()}`,
          template,
          width: 1920,
          height: 1080,
        }),
      });
      navigate(`${routes.overlays}/${result.project.id}/edit`);
    } catch (error) {
      setMessage(error instanceof Error ? error.message : String(error));
    } finally {
      setWorking('');
    }
  }

  async function manualSave() {
    if (!allowed || working) return;
    setWorking('save');
    try {
      await saveDraft(true);
    } finally {
      setWorking('');
    }
  }

  async function publish() {
    if (!allowed || !doc || !current?.project?.id || working) return;
    setWorking('publish');
    try {
      if (!(await saveDraft(false))) return;
      const fresh = await api<any>(`/api/overlays/${current.project.id}`);
      if (!fresh.draft?.id) throw new Error('Der gespeicherte Overlay-Entwurf fehlt.');
      await api(`/api/overlays/${current.project.id}/publish`, {
        method: 'POST',
        body: JSON.stringify({ versionId: fresh.draft.id }),
      });
      setMessage('Veröffentlicht und OBS-Browserquelle aktualisiert');
      await open(current.project.id);
    } catch (error) {
      setMessage(error instanceof Error ? error.message : String(error));
    } finally {
      setWorking('');
    }
  }

  function finishDrag() {
    const active = drag.current;
    drag.current = null;
    if (!active?.moved) return;
    setHistory((items) => [...items.slice(-30), active.origin]);
    setFuture([]);
  }

  const element = doc?.elements.find((item) => item.id === selected);
  const scale = useMemo(() => (doc ? Math.min(1, 760 / doc.width) : 1), [doc]);
  const propertyDisabled = !allowed || Boolean(element?.locked);

  return (
    <div className="editor-shell panel" id="Overlays">
      <div className="page-title">
        <div>
          <p className="eyebrow">Grafiksystem</p>
          <h2>{current?.project?.name ?? 'Overlay-Editor'}</h2>
          <p>Sendegrafik bearbeiten und als OBS-Browserquelle veröffentlichen.</p>
        </div>
        {current?.published && <span className="state-pill success">Veröffentlicht</span>}
      </div>
      {!allowed && <p className="forbidden">Keine Berechtigung: Editor ist schreibgeschützt.</p>}
      <div className="editor-toolbar">
        <select
          aria-label="Overlay auswählen"
          value={current?.project?.id ?? ''}
          disabled={Boolean(working)}
          onChange={(event) => void switchOverlay(event.target.value)}
        >
          {projects.map((project) => (
            <option key={project.id} value={project.id}>
              {project.name}
            </option>
          ))}
        </select>
        <button disabled={!allowed || Boolean(working)} onClick={() => void create('main-news')}>
          <Plus size={16} /> {working === 'create' ? 'Wird erstellt …' : 'Neu'}
        </button>
        <span className="editor-toolbar-divider" aria-hidden="true" />
        <button disabled={!allowed || !doc || Boolean(working)} onClick={() => void manualSave()}>
          <Save size={16} /> {working === 'save' ? 'Speichert …' : 'Speichern'}
        </button>
        <button
          className="primary-button"
          disabled={!allowed || !doc || Boolean(working)}
          onClick={() => void publish()}
        >
          <Send size={16} /> {working === 'publish' ? 'Veröffentlicht …' : 'Veröffentlichen'}
        </button>
        <span className="editor-toolbar-divider" aria-hidden="true" />
        <button
          className="icon-button"
          disabled={!allowed || !history.length || Boolean(working)}
          onClick={undo}
          title="Rückgängig"
          aria-label="Rückgängig"
        >
          <Undo2 size={17} />
        </button>
        <button
          className="icon-button"
          disabled={!allowed || !future.length || Boolean(working)}
          onClick={redo}
          title="Wiederholen"
          aria-label="Wiederholen"
        >
          <Redo2 size={17} />
        </button>
      </div>
      {message && <p role="status">{message}</p>}
      {doc && (
        <div className="editor-grid">
          <section className="editor-sidebar">
            <div className="tool-grid">
              {tools.map(({ type, label, icon: Icon }) => (
                <button
                  className="tool-button"
                  key={type}
                  disabled={!allowed || Boolean(working)}
                  onClick={() => add(type)}
                >
                  <Icon size={18} /> {label}
                </button>
              ))}
            </div>
            <p className="layers-heading">Ebenen</p>
            <div className="layer-list">
              {[...doc.elements]
                .sort((first, second) => second.zIndex - first.zIndex)
                .map((item) => (
                  <div key={item.id} className={selected === item.id ? 'selected layer' : 'layer'}>
                    <button className="layer-name" onClick={() => setSelected(item.id)} title={item.name}>
                      <Layers3 size={14} /> {item.name}
                    </button>
                    <button
                      className="icon-button ghost-button"
                      disabled={!allowed || Boolean(working)}
                      onClick={() => updateControl(item.id, { hidden: !item.hidden })}
                      title={item.hidden ? 'Einblenden' : 'Ausblenden'}
                      aria-label={item.hidden ? 'Einblenden' : 'Ausblenden'}
                    >
                      {item.hidden ? <EyeOff size={14} /> : <Eye size={14} />}
                    </button>
                    <button
                      className="icon-button ghost-button"
                      disabled={!allowed || Boolean(working)}
                      onClick={() => updateControl(item.id, { locked: !item.locked })}
                      title={item.locked ? 'Entsperren' : 'Sperren'}
                      aria-label={item.locked ? 'Entsperren' : 'Sperren'}
                    >
                      {item.locked ? <Lock size={14} /> : <LockOpen size={14} />}
                    </button>
                    <button
                      className="icon-button ghost-button"
                      disabled={!allowed || item.locked || Boolean(working)}
                      onClick={() => duplicate(item.id)}
                      title="Duplizieren"
                      aria-label="Duplizieren"
                    >
                      <Copy size={14} />
                    </button>
                    <button
                      className="icon-button ghost-button"
                      disabled={!allowed || item.locked || Boolean(working)}
                      onClick={() => remove(item.id)}
                      title="Löschen"
                      aria-label="Löschen"
                    >
                      <Trash2 size={14} />
                    </button>
                  </div>
                ))}
            </div>
          </section>
          <section className="editor-stage">
            <div
              className="canvas"
              style={{ width: doc.width * scale, height: doc.height * scale, background: '#111' }}
              onMouseMove={(event) => {
                const active = drag.current;
                if (!active || !doc || !allowed) return;
                const item = doc.elements.find((entry) => entry.id === active.id);
                if (!item || item.locked) return;
                const x = Math.round(event.nativeEvent.offsetX / scale - active.dx);
                const y = Math.round(event.nativeEvent.offsetY / scale - active.dy);
                if (item.x === x && item.y === y) return;
                active.moved = true;
                dirty.current = true;
                editRevision.current += 1;
                setDoc({
                  ...doc,
                  elements: patchOverlayElement(doc.elements, item.id, { x, y }),
                  updatedAt: new Date().toISOString(),
                });
              }}
              onMouseUp={finishDrag}
              onMouseLeave={finishDrag}
            >
              {doc.elements
                .filter((item) => !item.hidden)
                .sort((first, second) => first.zIndex - second.zIndex)
                .map((item) => (
                  <div
                    key={item.id}
                    onMouseDown={(event) => {
                      setSelected(item.id);
                      if (!allowed || item.locked || working) return;
                      drag.current = {
                        id: item.id,
                        dx: event.nativeEvent.offsetX / scale - item.x,
                        dy: event.nativeEvent.offsetY / scale - item.y,
                        origin: clone(doc),
                        moved: false,
                      };
                    }}
                    className={`overlay-el ${selected === item.id ? 'selected' : ''}`}
                    style={{
                      left: item.x * scale,
                      top: item.y * scale,
                      width: item.width * scale,
                      height: item.height * scale,
                      zIndex: item.zIndex,
                      opacity: item.opacity,
                      position: 'absolute',
                      color: item.props.color,
                      background: item.props.background,
                      border: `${item.props.borderWidth ?? 0}px solid ${item.props.borderColor ?? 'transparent'}`,
                      fontSize: (item.props.fontSize ?? 32) * scale,
                      fontWeight: item.props.fontWeight,
                      padding: (item.props.padding ?? 0) * scale,
                      overflow: 'hidden',
                    }}
                  >
                    {item.type === 'image' || item.type === 'logo' ? (
                      <span>Bild/Logo</span>
                    ) : (
                      <span>{item.binding ?? item.props.text ?? item.name}</span>
                    )}
                  </div>
                ))}
            </div>
            <p className="editor-stage-meta">
              Raster 10 px · Vorschau {doc.width} × {doc.height}
            </p>
          </section>
          <section className="editor-properties">
            <p className="properties-heading">Eigenschaften</p>
            {element ? (
              <div className="properties-form">
                {element.locked && <p className="muted">Die Ebene ist gesperrt. Entsperren Sie sie für Änderungen.</p>}
                <label>
                  Name
                  <input
                    disabled={propertyDisabled}
                    value={element.name}
                    onChange={(event) => update(element.id, { name: event.target.value })}
                  />
                </label>
                <div className="property-row">
                  <label>
                    X
                    <input
                      disabled={propertyDisabled}
                      type="number"
                      value={element.x}
                      onChange={(event) => update(element.id, { x: Number(event.target.value) })}
                    />
                  </label>
                  <label>
                    Y
                    <input
                      disabled={propertyDisabled}
                      type="number"
                      value={element.y}
                      onChange={(event) => update(element.id, { y: Number(event.target.value) })}
                    />
                  </label>
                </div>
                <div className="property-row">
                  <label>
                    Breite
                    <input
                      disabled={propertyDisabled}
                      type="number"
                      value={element.width}
                      onChange={(event) => update(element.id, { width: Number(event.target.value) })}
                    />
                  </label>
                  <label>
                    Höhe
                    <input
                      disabled={propertyDisabled}
                      type="number"
                      value={element.height}
                      onChange={(event) => update(element.id, { height: Number(event.target.value) })}
                    />
                  </label>
                </div>
                <label>
                  Bindung
                  <select
                    disabled={propertyDisabled}
                    value={element.binding ?? ''}
                    onChange={(event) => update(element.id, { binding: event.target.value || undefined })}
                  >
                    <option value="">Keine</option>
                    {[
                      'article.title',
                      'article.summary',
                      'article.source',
                      'article.category',
                      'article.region',
                      'playlist.current',
                      'clock.time',
                      'playback.status',
                    ].map((binding) => (
                      <option key={binding}>{binding}</option>
                    ))}
                  </select>
                </label>
                <label>
                  Text
                  <input
                    disabled={propertyDisabled}
                    value={element.props.text ?? ''}
                    onChange={(event) => updateProps(element.id, { text: event.target.value })}
                  />
                </label>
                <label>
                  Farbe
                  <input
                    disabled={propertyDisabled}
                    value={element.props.color ?? '#ffffff'}
                    onChange={(event) => updateProps(element.id, { color: event.target.value })}
                  />
                </label>
                <label>
                  Hintergrund
                  <input
                    disabled={propertyDisabled}
                    value={element.props.background ?? 'transparent'}
                    onChange={(event) => updateProps(element.id, { background: event.target.value })}
                  />
                </label>
                <label>
                  Schriftgröße
                  <input
                    disabled={propertyDisabled}
                    type="number"
                    value={element.props.fontSize ?? 42}
                    onChange={(event) => updateProps(element.id, { fontSize: Number(event.target.value) })}
                  />
                </label>
              </div>
            ) : (
              <p className="muted">Keine Ebene ausgewählt.</p>
            )}
          </section>
        </div>
      )}
      {!doc && (
        <div className="empty-state">
          <div>
            <Layers3 size={24} />
            <p>Kein Overlay geladen.</p>
          </div>
        </div>
      )}
    </div>
  );
}
