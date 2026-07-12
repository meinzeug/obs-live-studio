import React, { useEffect, useMemo, useRef, useState } from 'react';
import { can, type SessionUser, api } from '../api/client.js';
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
const tools = ['text', 'image', 'shape', 'line', 'clock', 'logo', 'ticker'];
function clone<T>(v: T): T {
  return JSON.parse(JSON.stringify(v));
}
export function OverlayEditorPage({ user }: { user: SessionUser }) {
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
    if (ps[0]) await open(ps[0].id);
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
  }, []);
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
    await load();
    await open(r.project.id);
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
    <div className="panel" id="Overlays">
      <h3>Overlay-Editor</h3>
      {!allowed && <p className="forbidden">Keine Berechtigung: Editor ist schreibgeschützt.</p>}
      <div className="toolbar">
        <button disabled={!allowed} onClick={() => create('main-news')}>
          Neu
        </button>
        {projects.map((p) => (
          <button key={p.id} onClick={() => open(p.id)}>
            {p.name}
          </button>
        ))}
        <button disabled={!allowed || !doc} onClick={() => saveDraft()}>
          Speichern
        </button>
        <button disabled={!allowed || !doc} onClick={publish}>
          Veröffentlichen
        </button>
        <button disabled={!history.length} onClick={undo}>
          Undo
        </button>
        <button disabled={!future.length} onClick={redo}>
          Redo
        </button>
      </div>
      {message && (
        <p>
          <b>{message}</b>
        </p>
      )}
      {doc && (
        <div className="editor-grid">
          <aside>
            {tools.map((t) => (
              <button key={t} disabled={!allowed} onClick={() => add(t)}>
                {t}
              </button>
            ))}
            <h4>Ebenen</h4>
            {[...doc.elements]
              .sort((a, b) => b.zIndex - a.zIndex)
              .map((e) => (
                <div key={e.id} className={selected === e.id ? 'selected layer' : 'layer'}>
                  <button onClick={() => setSelected(e.id)}>
                    {e.hidden ? '🙈' : '👁'} {e.locked ? '🔒' : ''} {e.name}
                  </button>
                  <button disabled={!allowed} onClick={() => update(e.id, { hidden: !e.hidden })}>
                    Sicht
                  </button>
                  <button disabled={!allowed} onClick={() => update(e.id, { locked: !e.locked })}>
                    Lock
                  </button>
                  <button disabled={!allowed} onClick={() => duplicate(e.id)}>
                    Dupl.
                  </button>
                  <button disabled={!allowed} onClick={() => remove(e.id)}>
                    Löschen
                  </button>
                </div>
              ))}
          </aside>
          <main>
            <div
              className="canvas"
              style={{ width: doc.width * scale, height: doc.height * scale, background: '#111' }}
              onMouseMove={(ev) => {
                if (!drag.current || !doc) return;
                const e = doc.elements.find((x) => x.id === drag.current!.id);
                if (e)
                  update(e.id, {
                    x: Math.round(ev.nativeEvent.offsetX / scale - drag.current.dx),
                    y: Math.round(ev.nativeEvent.offsetY / scale - drag.current.dy),
                  });
              }}
              onMouseUp={() => (drag.current = null)}
            >
              {doc.elements
                .filter((e) => !e.hidden)
                .sort((a, b) => a.zIndex - b.zIndex)
                .map((e) => (
                  <div
                    key={e.id}
                    onMouseDown={(ev) => {
                      setSelected(e.id);
                      drag.current = {
                        id: e.id,
                        dx: ev.nativeEvent.offsetX / scale - e.x,
                        dy: ev.nativeEvent.offsetY / scale - e.y,
                      };
                    }}
                    className={'overlay-el ' + (selected === e.id ? 'selected' : '')}
                    style={{
                      left: e.x * scale,
                      top: e.y * scale,
                      width: e.width * scale,
                      height: e.height * scale,
                      zIndex: e.zIndex,
                      opacity: e.opacity,
                      position: 'absolute',
                      color: e.props.color,
                      background: e.props.background,
                      border: `${e.props.borderWidth ?? 0}px solid ${e.props.borderColor ?? 'transparent'}`,
                      fontSize: (e.props.fontSize ?? 32) * scale,
                      fontWeight: e.props.fontWeight,
                      padding: (e.props.padding ?? 0) * scale,
                      overflow: 'hidden',
                    }}
                  >
                    {e.type === 'image' || e.type === 'logo' ? (
                      <span>Bild/Logo</span>
                    ) : (
                      <span>{e.binding ?? e.props.text ?? e.name}</span>
                    )}
                  </div>
                ))}
            </div>
            <p>
              Raster 10 px · Vorschau {doc.width}×{doc.height}
            </p>
          </main>
          <aside>
            {el && (
              <>
                <h4>Eigenschaften</h4>
                <label>
                  Name
                  <input
                    disabled={!allowed}
                    value={el.name}
                    onChange={(e) => update(el.id, { name: e.target.value })}
                  />
                </label>
                <label>
                  X
                  <input
                    disabled={!allowed}
                    type="number"
                    value={el.x}
                    onChange={(e) => update(el.id, { x: Number(e.target.value) })}
                  />
                </label>
                <label>
                  Y
                  <input
                    disabled={!allowed}
                    type="number"
                    value={el.y}
                    onChange={(e) => update(el.id, { y: Number(e.target.value) })}
                  />
                </label>
                <label>
                  Breite
                  <input
                    disabled={!allowed}
                    type="number"
                    value={el.width}
                    onChange={(e) => update(el.id, { width: Number(e.target.value) })}
                  />
                </label>
                <label>
                  Höhe
                  <input
                    disabled={!allowed}
                    type="number"
                    value={el.height}
                    onChange={(e) => update(el.id, { height: Number(e.target.value) })}
                  />
                </label>
                <label>
                  Bindung
                  <select
                    disabled={!allowed}
                    value={el.binding ?? ''}
                    onChange={(e) => update(el.id, { binding: e.target.value || undefined })}
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
                    ].map((b) => (
                      <option key={b}>{b}</option>
                    ))}
                  </select>
                </label>
                <label>
                  Text
                  <input
                    disabled={!allowed}
                    value={el.props.text ?? ''}
                    onChange={(e) => updateProps(el.id, { text: e.target.value })}
                  />
                </label>
                <label>
                  Farbe
                  <input
                    disabled={!allowed}
                    value={el.props.color ?? '#ffffff'}
                    onChange={(e) => updateProps(el.id, { color: e.target.value })}
                  />
                </label>
                <label>
                  Hintergrund
                  <input
                    disabled={!allowed}
                    value={el.props.background ?? 'transparent'}
                    onChange={(e) => updateProps(el.id, { background: e.target.value })}
                  />
                </label>
                <label>
                  Schriftgröße
                  <input
                    disabled={!allowed}
                    type="number"
                    value={el.props.fontSize ?? 42}
                    onChange={(e) => updateProps(el.id, { fontSize: Number(e.target.value) })}
                  />
                </label>
              </>
            )}
          </aside>
        </div>
      )}
    </div>
  );
}
