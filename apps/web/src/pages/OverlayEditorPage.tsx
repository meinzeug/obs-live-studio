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
import {
  appendUndoSnapshot,
  cloneOverlayValue,
  moveOverlayElement,
  patchOverlayElement,
  SerialTaskQueue,
  type OverlayDocument as Doc,
  type OverlayElement as El,
} from '../overlay-editor-utils.js';

const tools: Array<{ type: string; label: string; icon: LucideIcon }> = [
  { type: 'text', label: 'Text', icon: Type },
  { type: 'image', label: 'Bild', icon: Image },
  { type: 'shape', label: 'Form', icon: Shapes },
  { type: 'line', label: 'Linie', icon: Minus },
  { type: 'clock', label: 'Uhr', icon: Clock3 },
  { type: 'logo', label: 'Logo', icon: Badge },
  { type: 'ticker', label: 'Ticker', icon: PanelBottom },
];

type DragState = {
  id: string;
  dx: number;
  dy: number;
  before: Doc;
  moved: boolean;
};

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
  const [saving, setSaving] = useState(false);
  const [publishing, setPublishing] = useState(false);
  const drag = useRef<DragState | null>(null);
  const autosaveTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const saveQueue = useRef(new SerialTaskQueue());
  const activeProjectId = useRef('');
  const manualSaveRunning = useRef(false);
  const publishRunning = useRef(false);
  const editable = allowed && !publishing;

  function clearAutosave() {
    if (!autosaveTimer.current) return;
    clearTimeout(autosaveTimer.current);
    autosaveTimer.current = null;
  }

  async function load() {
    const ps = await api<any[]>('/api/overlays');
    setProjects(ps);
    if (!ps.length) {
      activeProjectId.current = '';
      setCurrent(undefined);
      setDoc(null);
      return;
    }
    const requested = routeId ? ps.find((project) => project.id === routeId) : undefined;
    if (!requested) {
      const fallbackId = ps[0].id;
      setMessage(
        routeId ? 'Das angeforderte Overlay existiert nicht mehr. Das erste verfügbare Overlay wurde geöffnet.' : '',
      );
      navigate(`${routes.overlays}/${fallbackId}/edit`, { replace: true });
      return;
    }
    await open(requested.id);
  }

  async function open(id: string) {
    clearAutosave();
    activeProjectId.current = id;
    const r = await api<any>(`/api/overlays/${id}`);
    if (activeProjectId.current !== id) return;
    setCurrent(r);
    setDoc(r.draft?.snapshot);
    setSelected('');
    setHistory([]);
    setFuture([]);
  }

  useEffect(() => {
    load().catch((e) => setMessage(e.message));
  }, [routeId]);

  async function enqueueDraft(projectId: string, snapshot: Doc, show: boolean) {
    return saveQueue.current.enqueue(async () => {
      const r = await api<any>(`/api/overlays/${projectId}/draft`, {
        method: 'PUT',
        body: JSON.stringify(snapshot),
      });
      if (activeProjectId.current === projectId) {
        setCurrent((value: any) => (value?.project?.id === projectId ? { ...value, draft: r.draft } : value));
        if (show) setMessage('Entwurf gespeichert');
      }
      return r;
    });
  }

  useEffect(() => {
    if (!allowed || !current?.project?.id || !doc || drag.current) return;
    clearAutosave();
    const projectId = current.project.id;
    const snapshot = cloneOverlayValue(doc);
    const timer = setTimeout(() => {
      if (autosaveTimer.current === timer) autosaveTimer.current = null;
      void enqueueDraft(projectId, snapshot, false).catch((error) =>
        setMessage(error instanceof Error ? error.message : String(error)),
      );
    }, 900);
    autosaveTimer.current = timer;
    return () => {
      if (autosaveTimer.current === timer) {
        clearTimeout(timer);
        autosaveTimer.current = null;
      }
    };
  }, [allowed, current?.project?.id, doc]);

  function commit(next: Doc) {
    if (doc) setHistory((value) => appendUndoSnapshot(value, doc, next));
    setFuture([]);
    setDoc({ ...next, updatedAt: new Date().toISOString() });
  }

  function add(type: string) {
    if (!doc || !editable) return;
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
    if (!doc || !editable) return;
    commit(patchOverlayElement(doc, id, patch));
  }

  function setLocked(id: string, locked: boolean) {
    if (!doc || !editable) return;
    commit(patchOverlayElement(doc, id, { locked }, true));
  }

  function updateProps(id: string, props: any) {
    const element = doc?.elements.find((item) => item.id === id);
    if (element) update(id, { props: { ...element.props, ...props } });
  }

  function remove(id: string) {
    if (!doc || !editable) return;
    commit({ ...doc, elements: doc.elements.filter((element) => element.id !== id) });
  }

  function duplicate(id: string) {
    const element = doc?.elements.find((item) => item.id === id);
    if (!doc || !element || !editable) return;
    commit({
      ...doc,
      elements: [
        ...doc.elements,
        {
          ...cloneOverlayValue(element),
          id: `${element.id}-copy-${Date.now()}`,
          x: element.x + 30,
          y: element.y + 30,
          zIndex: Math.max(...doc.elements.map((item) => item.zIndex)) + 1,
        },
      ],
    });
  }

  function undo() {
    const previous = history.at(-1);
    if (previous && doc && editable) {
      setFuture((value) => [doc, ...value]);
      setDoc(previous);
      setHistory((value) => value.slice(0, -1));
    }
  }

  function redo() {
    const next = future[0];
    if (next && doc && editable) {
      setHistory((value) => [...value, doc]);
      setDoc(next);
      setFuture((value) => value.slice(1));
    }
  }

  async function saveDraft(show = true) {
    if (!doc || !current?.project?.id) return undefined;
    clearAutosave();
    return enqueueDraft(current.project.id, cloneOverlayValue(doc), show);
  }

  async function manualSave() {
    if (manualSaveRunning.current || publishRunning.current) return;
    manualSaveRunning.current = true;
    setSaving(true);
    try {
      await saveDraft(true);
    } catch (error) {
      setMessage(error instanceof Error ? error.message : String(error));
    } finally {
      manualSaveRunning.current = false;
      setSaving(false);
    }
  }

  async function create(template = 'main-news') {
    const r = await api<any>('/api/overlays', {
      method: 'POST',
      body: JSON.stringify({ name: `Overlay ${new Date().toLocaleTimeString()}`, template, width: 1920, height: 1080 }),
    });
    navigate(`${routes.overlays}/${r.project.id}/edit`);
  }

  async function publish() {
    if (publishRunning.current || !current?.project?.id) return;
    publishRunning.current = true;
    setPublishing(true);
    const projectId = current.project.id;
    try {
      await saveDraft(false);
      await saveQueue.current.idle();
      const fresh = await api<any>(`/api/overlays/${projectId}`);
      await api(`/api/overlays/${projectId}/publish`, {
        method: 'POST',
        body: JSON.stringify({ versionId: fresh.draft.id }),
      });
      setMessage('Veröffentlicht und OBS-Browserquelle aktualisiert');
      if (activeProjectId.current === projectId) await open(projectId);
    } catch (error) {
      setMessage(error instanceof Error ? error.message : String(error));
    } finally {
      publishRunning.current = false;
      setPublishing(false);
    }
  }

  function finishDrag() {
    const active = drag.current;
    drag.current = null;
    if (!active?.moved || !doc) return;
    setHistory((value) => appendUndoSnapshot(value, active.before, doc));
    setFuture([]);
    setDoc({ ...doc, updatedAt: new Date().toISOString() });
  }

  const el = doc?.elements.find((element) => element.id === selected);
  const scale = useMemo(() => (doc ? Math.min(1, 760 / doc.width) : 1), [doc]);
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
          disabled={publishing}
          value={current?.project?.id ?? ''}
          onChange={(event) => navigate(`${routes.overlays}/${event.target.value}/edit`)}
        >
          {projects.map((project) => (
            <option key={project.id} value={project.id}>
              {project.name}
            </option>
          ))}
        </select>
        <button disabled={!editable} onClick={() => create('main-news')}>
          <Plus size={16} /> Neu
        </button>
        <span className="editor-toolbar-divider" aria-hidden="true" />
        <button disabled={!editable || !doc || saving} onClick={() => void manualSave()}>
          <Save size={16} /> {saving ? 'Speichert …' : 'Speichern'}
        </button>
        <button className="primary-button" disabled={!editable || !doc} onClick={() => void publish()}>
          <Send size={16} /> {publishing ? 'Veröffentlichen …' : 'Veröffentlichen'}
        </button>
        <span className="editor-toolbar-divider" aria-hidden="true" />
        <button
          className="icon-button"
          disabled={!editable || !history.length}
          onClick={undo}
          title="Rückgängig"
          aria-label="Rückgängig"
        >
          <Undo2 size={17} />
        </button>
        <button
          className="icon-button"
          disabled={!editable || !future.length}
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
                <button className="tool-button" key={type} disabled={!editable} onClick={() => add(type)}>
                  <Icon size={18} /> {label}
                </button>
              ))}
            </div>
            <p className="layers-heading">Ebenen</p>
            <div className="layer-list">
              {[...doc.elements]
                .sort((a, b) => b.zIndex - a.zIndex)
                .map((element) => (
                  <div key={element.id} className={selected === element.id ? 'selected layer' : 'layer'}>
                    <button className="layer-name" onClick={() => setSelected(element.id)} title={element.name}>
                      <Layers3 size={14} /> {element.name}
                    </button>
                    <button
                      className="icon-button ghost-button"
                      disabled={!editable}
                      onClick={() => update(element.id, { hidden: !element.hidden })}
                      title={element.hidden ? 'Einblenden' : 'Ausblenden'}
                      aria-label={element.hidden ? 'Einblenden' : 'Ausblenden'}
                    >
                      {element.hidden ? <EyeOff size={14} /> : <Eye size={14} />}
                    </button>
                    <button
                      className="icon-button ghost-button"
                      disabled={!editable}
                      onClick={() => setLocked(element.id, !element.locked)}
                      title={element.locked ? 'Entsperren' : 'Sperren'}
                      aria-label={element.locked ? 'Entsperren' : 'Sperren'}
                    >
                      {element.locked ? <Lock size={14} /> : <LockOpen size={14} />}
                    </button>
                    <button
                      className="icon-button ghost-button"
                      disabled={!editable}
                      onClick={() => duplicate(element.id)}
                      title="Duplizieren"
                      aria-label="Duplizieren"
                    >
                      <Copy size={14} />
                    </button>
                    <button
                      className="icon-button ghost-button"
                      disabled={!editable}
                      onClick={() => remove(element.id)}
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
                if (!drag.current || !doc || !editable) return;
                const bounds = event.currentTarget.getBoundingClientRect();
                const x = Math.round((event.clientX - bounds.left) / scale - drag.current.dx);
                const y = Math.round((event.clientY - bounds.top) / scale - drag.current.dy);
                const element = doc.elements.find((item) => item.id === drag.current!.id);
                if (!element || (element.x === x && element.y === y)) return;
                drag.current.moved = true;
                setDoc({ ...moveOverlayElement(doc, element.id, { x, y }), updatedAt: new Date().toISOString() });
              }}
              onMouseUp={finishDrag}
              onMouseLeave={finishDrag}
            >
              {doc.elements
                .filter((element) => !element.hidden)
                .sort((a, b) => a.zIndex - b.zIndex)
                .map((element) => (
                  <div
                    key={element.id}
                    onMouseDown={(event) => {
                      setSelected(element.id);
                      if (!editable || element.locked) return;
                      const canvas = event.currentTarget.parentElement;
                      if (!canvas) return;
                      const bounds = canvas.getBoundingClientRect();
                      drag.current = {
                        id: element.id,
                        dx: (event.clientX - bounds.left) / scale - element.x,
                        dy: (event.clientY - bounds.top) / scale - element.y,
                        before: cloneOverlayValue(doc),
                        moved: false,
                      };
                    }}
                    className={`overlay-el ${selected === element.id ? 'selected' : ''}`}
                    style={{
                      left: element.x * scale,
                      top: element.y * scale,
                      width: element.width * scale,
                      height: element.height * scale,
                      zIndex: element.zIndex,
                      opacity: element.opacity,
                      position: 'absolute',
                      color: element.props.color,
                      background: element.props.background,
                      border: `${element.props.borderWidth ?? 0}px solid ${element.props.borderColor ?? 'transparent'}`,
                      fontSize: (element.props.fontSize ?? 32) * scale,
                      fontWeight: element.props.fontWeight,
                      padding: (element.props.padding ?? 0) * scale,
                      overflow: 'hidden',
                    }}
                  >
                    {element.type === 'image' || element.type === 'logo' ? (
                      <span>Bild/Logo</span>
                    ) : (
                      <span>{element.binding ?? element.props.text ?? element.name}</span>
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
            {el ? (
              <div className="properties-form">
                <label>
                  Name
                  <input
                    disabled={!editable}
                    value={el.name}
                    onChange={(event) => update(el.id, { name: event.target.value })}
                  />
                </label>
                <div className="property-row">
                  <label>
                    X
                    <input
                      disabled={!editable}
                      type="number"
                      value={el.x}
                      onChange={(event) => update(el.id, { x: Number(event.target.value) })}
                    />
                  </label>
                  <label>
                    Y
                    <input
                      disabled={!editable}
                      type="number"
                      value={el.y}
                      onChange={(event) => update(el.id, { y: Number(event.target.value) })}
                    />
                  </label>
                </div>
                <div className="property-row">
                  <label>
                    Breite
                    <input
                      disabled={!editable}
                      type="number"
                      value={el.width}
                      onChange={(event) => update(el.id, { width: Number(event.target.value) })}
                    />
                  </label>
                  <label>
                    Höhe
                    <input
                      disabled={!editable}
                      type="number"
                      value={el.height}
                      onChange={(event) => update(el.id, { height: Number(event.target.value) })}
                    />
                  </label>
                </div>
                <label>
                  Bindung
                  <select
                    disabled={!editable}
                    value={el.binding ?? ''}
                    onChange={(event) => update(el.id, { binding: event.target.value || undefined })}
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
                    disabled={!editable}
                    value={el.props.text ?? ''}
                    onChange={(event) => updateProps(el.id, { text: event.target.value })}
                  />
                </label>
                <label>
                  Farbe
                  <input
                    disabled={!editable}
                    value={el.props.color ?? '#ffffff'}
                    onChange={(event) => updateProps(el.id, { color: event.target.value })}
                  />
                </label>
                <label>
                  Hintergrund
                  <input
                    disabled={!editable}
                    value={el.props.background ?? 'transparent'}
                    onChange={(event) => updateProps(el.id, { background: event.target.value })}
                  />
                </label>
                <label>
                  Schriftgröße
                  <input
                    disabled={!editable}
                    type="number"
                    value={el.props.fontSize ?? 42}
                    onChange={(event) => updateProps(el.id, { fontSize: Number(event.target.value) })}
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
