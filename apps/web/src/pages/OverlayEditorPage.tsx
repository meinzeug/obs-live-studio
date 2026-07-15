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
const tools: Array<{ type: string; label: string; icon: LucideIcon }> = [
  { type: 'text', label: 'Text', icon: Type },
  { type: 'image', label: 'Bild', icon: Image },
  { type: 'shape', label: 'Form', icon: Shapes },
  { type: 'line', label: 'Linie', icon: Minus },
  { type: 'clock', label: 'Uhr', icon: Clock3 },
  { type: 'logo', label: 'Logo', icon: Badge },
  { type: 'ticker', label: 'Ticker', icon: PanelBottom },
];
function clone<T>(v: T): T {
  return JSON.parse(JSON.stringify(v));
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
  const drag = useRef<{ id: string; dx: number; dy: number } | null>(null);
  async function load() {
    const ps = await api<any[]>('/api/overlays');
    setProjects(ps);
    if (!ps.length) {
      setCurrent(undefined);
      setDoc(null);
      return;
    }
    const requested = routeId ? ps.find((project) => project.id === routeId) : undefined;
    if (!requested) {
      const fallbackId = ps[0].id;
      setMessage(routeId ? 'Das angeforderte Overlay existiert nicht mehr. Das erste verfügbare Overlay wurde geöffnet.' : '');
      navigate(`${routes.overlays}/${fallbackId}/edit`, { replace: true });
      return;
    }
    await open(requested.id);
  }
  async function open(id: string) {
    const r = await api<any>(`/api/overlays/${id}`);
    setCurrent(r);
    setDoc(r.draft?.snapshot);
    setSelected('');
    setHistory([]);
    setFuture([]);
  }
  useEffect(() => {
    load().catch((e) => setMessage(e.message));
  }, [routeId]);
  useEffect(() => {
    if (!allowed || !current?.project?.id || !doc) return;
    const t = setTimeout(() => saveDraft(false), 900);
    return () => clearTimeout(t);
  }, [doc]);
  function commit(next: Doc) {
    if (doc) setHistory((h) => [...h.slice(-30), clone(doc)]);
    setFuture([]);
    setDoc({ ...next, updatedAt: new Date().toISOString() });
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
    commit({ ...doc, elements: doc.elements.map((e) => (e.id === id && !e.locked ? { ...e, ...patch } : e)) });
  }
  function updateProps(id: string, props: any) {
    const el = doc?.elements.find((e) => e.id === id);
    if (el) update(id, { props: { ...el.props, ...props } });
  }
  function remove(id: string) {
    if (doc) commit({ ...doc, elements: doc.elements.filter((e) => e.id !== id) });
  }
  function duplicate(id: string) {
    const el = doc?.elements.find((e) => e.id === id);
    if (doc && el)
      commit({
        ...doc,
        elements: [
          ...doc.elements,
          {
            ...clone(el),
            id: `${el.id}-copy-${Date.now()}`,
            x: el.x + 30,
            y: el.y + 30,
            zIndex: Math.max(...doc.elements.map((e) => e.zIndex)) + 1,
          },
        ],
      });
  }
  function undo() {
    const prev = history.at(-1);
    if (prev && doc) {
      setFuture((f) => [doc, ...f]);
      setDoc(prev);
      setHistory((h) => h.slice(0, -1));
    }
  }
  function redo() {
    const next = future[0];
    if (next && doc) {
      setHistory((h) => [...h, doc]);
      setDoc(next);
      setFuture((f) => f.slice(1));
    }
  }
  async function saveDraft(show = true) {
    if (!doc || !current?.project?.id) return;
    const r = await api<any>(`/api/overlays/${current.project.id}/draft`, { method: 'PUT', body: JSON.stringify(doc) });
    setCurrent((c: any) => ({ ...c, draft: r.draft }));
    if (show) setMessage('Entwurf gespeichert');
  }
  async function create(template = 'main-news') {
    const r = await api<any>('/api/overlays', {
      method: 'POST',
      body: JSON.stringify({ name: `Overlay ${new Date().toLocaleTimeString()}`, template, width: 1920, height: 1080 }),
    });
    navigate(`${routes.overlays}/${r.project.id}/edit`);
  }
  async function publish() {
    await saveDraft(false);
    const fresh = await api<any>(`/api/overlays/${current.project.id}`);
    await api(`/api/overlays/${current.project.id}/publish`, {
      method: 'POST',
      body: JSON.stringify({ versionId: fresh.draft.id }),
    });
    setMessage('Veröffentlicht und OBS-Browserquelle aktualisiert');
    await open(current.project.id);
  }
  const el = doc?.elements.find((e) => e.id === selected);
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
          value={current?.project?.id ?? ''}
          onChange={(event) => navigate(`${routes.overlays}/${event.target.value}/edit`)}
        >
          {projects.map((project) => (
            <option key={project.id} value={project.id}>
              {project.name}
            </option>
          ))}
        </select>
        <button disabled={!allowed} onClick={() => create('main-news')}>
          <Plus size={16} /> Neu
        </button>
        <span className="editor-toolbar-divider" aria-hidden="true" />
        <button disabled={!allowed || !doc} onClick={() => saveDraft()}>
          <Save size={16} /> Speichern
        </button>
        <button className="primary-button" disabled={!allowed || !doc} onClick={publish}>
          <Send size={16} /> Veröffentlichen
        </button>
        <span className="editor-toolbar-divider" aria-hidden="true" />
        <button
          className="icon-button"
          disabled={!history.length}
          onClick={undo}
          title="Rückgängig"
          aria-label="Rückgängig"
        >
          <Undo2 size={17} />
        </button>
        <button
          className="icon-button"
          disabled={!future.length}
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
                <button className="tool-button" key={type} disabled={!allowed} onClick={() => add(type)}>
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
                      disabled={!allowed}
                      onClick={() => update(element.id, { hidden: !element.hidden })}
                      title={element.hidden ? 'Einblenden' : 'Ausblenden'}
                      aria-label={element.hidden ? 'Einblenden' : 'Ausblenden'}
                    >
                      {element.hidden ? <EyeOff size={14} /> : <Eye size={14} />}
                    </button>
                    <button
                      className="icon-button ghost-button"
                      disabled={!allowed}
                      onClick={() => update(element.id, { locked: !element.locked })}
                      title={element.locked ? 'Entsperren' : 'Sperren'}
                      aria-label={element.locked ? 'Entsperren' : 'Sperren'}
                    >
                      {element.locked ? <Lock size={14} /> : <LockOpen size={14} />}
                    </button>
                    <button
                      className="icon-button ghost-button"
                      disabled={!allowed}
                      onClick={() => duplicate(element.id)}
                      title="Duplizieren"
                      aria-label="Duplizieren"
                    >
                      <Copy size={14} />
                    </button>
                    <button
                      className="icon-button ghost-button"
                      disabled={!allowed}
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
                if (!drag.current || !doc) return;
                const element = doc.elements.find((item) => item.id === drag.current!.id);
                if (element)
                  update(element.id, {
                    x: Math.round(event.nativeEvent.offsetX / scale - drag.current.dx),
                    y: Math.round(event.nativeEvent.offsetY / scale - drag.current.dy),
                  });
              }}
              onMouseUp={() => (drag.current = null)}
            >
              {doc.elements
                .filter((element) => !element.hidden)
                .sort((a, b) => a.zIndex - b.zIndex)
                .map((element) => (
                  <div
                    key={element.id}
                    onMouseDown={(event) => {
                      setSelected(element.id);
                      drag.current = {
                        id: element.id,
                        dx: event.nativeEvent.offsetX / scale - element.x,
                        dy: event.nativeEvent.offsetY / scale - element.y,
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
                    disabled={!allowed}
                    value={el.name}
                    onChange={(event) => update(el.id, { name: event.target.value })}
                  />
                </label>
                <div className="property-row">
                  <label>
                    X
                    <input
                      disabled={!allowed}
                      type="number"
                      value={el.x}
                      onChange={(event) => update(el.id, { x: Number(event.target.value) })}
                    />
                  </label>
                  <label>
                    Y
                    <input
                      disabled={!allowed}
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
                      disabled={!allowed}
                      type="number"
                      value={el.width}
                      onChange={(event) => update(el.id, { width: Number(event.target.value) })}
                    />
                  </label>
                  <label>
                    Höhe
                    <input
                      disabled={!allowed}
                      type="number"
                      value={el.height}
                      onChange={(event) => update(el.id, { height: Number(event.target.value) })}
                    />
                  </label>
                </div>
                <label>
                  Bindung
                  <select
                    disabled={!allowed}
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
                    disabled={!allowed}
                    value={el.props.text ?? ''}
                    onChange={(event) => updateProps(el.id, { text: event.target.value })}
                  />
                </label>
                <label>
                  Farbe
                  <input
                    disabled={!allowed}
                    value={el.props.color ?? '#ffffff'}
                    onChange={(event) => updateProps(el.id, { color: event.target.value })}
                  />
                </label>
                <label>
                  Hintergrund
                  <input
                    disabled={!allowed}
                    value={el.props.background ?? 'transparent'}
                    onChange={(event) => updateProps(el.id, { background: event.target.value })}
                  />
                </label>
                <label>
                  Schriftgröße
                  <input
                    disabled={!allowed}
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
