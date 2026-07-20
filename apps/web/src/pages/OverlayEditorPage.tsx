import React, { useEffect, useMemo, useRef, useState } from 'react';
import {
  AlignCenterHorizontal,
  AlignCenterVertical,
  ArrowDownToLine,
  ArrowUpToLine,
  Badge,
  Clock3,
  Copy,
  Eye,
  EyeOff,
  ExternalLink,
  Grid3X3,
  History,
  Image,
  Layers3,
  Lock,
  LockOpen,
  Minus,
  PanelBottom,
  Plus,
  Redo2,
  RotateCcw,
  Save,
  Send,
  Settings2,
  Shapes,
  Trash2,
  Type,
  Undo2,
  WandSparkles,
  ZoomIn,
  ZoomOut,
  type LucideIcon,
} from 'lucide-react';
import { useNavigate, useParams } from 'react-router-dom';
import { can, type SessionUser, api } from '../api/client.js';
import { OverlayProjectDialog, type OverlayProjectInput } from '../components/OverlayProjectDialog.js';
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
  const [aiWorking, setAiWorking] = useState(false);
  const [projectDialog, setProjectDialog] = useState<'create' | 'edit' | null>(null);
  const [dialogError, setDialogError] = useState('');
  const [projectBusy, setProjectBusy] = useState(false);
  const [zoom, setZoom] = useState(1);
  const [snapToGrid, setSnapToGrid] = useState(true);
  const drag = useRef<DragState | null>(null);
  const autosaveTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const saveQueue = useRef(new SerialTaskQueue());
  const activeProjectId = useRef('');
  const manualSaveRunning = useRef(false);
  const publishRunning = useRef(false);
  const savedSnapshot = useRef('');
  const editable = allowed && !publishing && !aiWorking;

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
    savedSnapshot.current = JSON.stringify(r.draft?.snapshot ?? null);
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
        savedSnapshot.current = JSON.stringify(snapshot);
        setCurrent((value: any) => (value?.project?.id === projectId ? { ...value, draft: r.draft } : value));
        if (show) setMessage('Entwurf gespeichert');
      }
      return r;
    });
  }

  useEffect(() => {
    if (!allowed || !current?.project?.id || !doc || drag.current || JSON.stringify(doc) === savedSnapshot.current)
      return;
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
    const names: Record<string, string> = {
      text: 'Text',
      image: 'Bild',
      shape: 'Form',
      line: 'Linie',
      clock: 'Uhrzeit',
      logo: 'Logo',
      ticker: 'Laufband',
    };
    const isVisual = type === 'image' || type === 'logo';
    const isLine = type === 'line';
    commit({
      ...doc,
      elements: [
        ...doc.elements,
        {
          id,
          type,
          name: names[type] ?? type,
          x: 120,
          y: 120,
          width: isVisual ? 520 : 360,
          height: isVisual ? 280 : isLine ? 6 : 100,
          zIndex: Math.min(999, Math.max(0, ...doc.elements.map((item) => item.zIndex)) + 1),
          locked: false,
          hidden: false,
          opacity: 1,
          rotation: 0,
          binding: type === 'clock' ? 'clock.time' : undefined,
          props: {
            text: type === 'text' ? 'Neuer Text' : type === 'ticker' ? 'Neue Laufbandmeldung' : '',
            fontSize: 42,
            fontWeight: '700',
            color: '#ffffff',
            background: type === 'shape' ? '#287f75' : isLine ? '#ffffff' : 'transparent',
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

  async function submitProject(input: OverlayProjectInput) {
    if (projectBusy) return;
    setProjectBusy(true);
    setDialogError('');
    try {
      if (projectDialog === 'edit' && current?.project?.id) {
        const response = await api<any>(`/api/overlays/${current.project.id}`, {
          method: 'PATCH',
          body: JSON.stringify({ name: input.name }),
        });
        setCurrent((value: any) => ({ ...value, project: { ...value.project, ...response.project } }));
        setProjects((value) =>
          value.map((project) => (project.id === current.project.id ? { ...project, ...response.project } : project)),
        );
        setMessage('Overlay-Einstellungen gespeichert');
        setProjectDialog(null);
      } else {
        const response = await api<any>('/api/overlays', {
          method: 'POST',
          body: JSON.stringify(input),
        });
        setProjectDialog(null);
        navigate(`${routes.overlays}/${response.project.id}/edit`);
      }
    } catch (error) {
      setDialogError(error instanceof Error ? error.message : String(error));
    } finally {
      setProjectBusy(false);
    }
  }

  async function restoreVersion(versionId: string, version: number) {
    if (!editable || !current?.project?.id) return;
    if (!window.confirm(`Version ${version} als neuen Entwurf wiederherstellen?`)) return;
    try {
      await api(`/api/overlays/${current.project.id}/rollback`, {
        method: 'POST',
        body: JSON.stringify({ versionId }),
      });
      await open(current.project.id);
      setMessage(`Version ${version} wurde als neuer Entwurf wiederhergestellt`);
    } catch (error) {
      setMessage(error instanceof Error ? error.message : String(error));
    }
  }

  function bringToFront(id: string) {
    if (!doc || !editable) return;
    const top = Math.max(0, ...doc.elements.map((item) => item.zIndex));
    update(id, { zIndex: top + 1 });
  }

  function sendToBack(id: string) {
    if (!doc || !editable) return;
    const next = {
      ...doc,
      elements: doc.elements.map((item) =>
        item.id === id ? { ...item, zIndex: 0 } : { ...item, zIndex: Math.min(999, item.zIndex + 1) },
      ),
    };
    commit(next);
  }

  function alignElement(id: string, axis: 'horizontal' | 'vertical') {
    const element = doc?.elements.find((item) => item.id === id);
    if (!doc || !element || !editable) return;
    update(
      id,
      axis === 'horizontal'
        ? { x: Math.round((doc.width - element.width) / 2) }
        : { y: Math.round((doc.height - element.height) / 2) },
    );
  }

  useEffect(() => {
    function onKeyDown(event: KeyboardEvent) {
      const typing = ['INPUT', 'TEXTAREA', 'SELECT'].includes((event.target as HTMLElement)?.tagName);
      if ((event.ctrlKey || event.metaKey) && event.key.toLowerCase() === 's') {
        event.preventDefault();
        void manualSave();
        return;
      }
      if (typing || !selected || !editable) return;
      if ((event.ctrlKey || event.metaKey) && event.key.toLowerCase() === 'd') {
        event.preventDefault();
        duplicate(selected);
        return;
      }
      if (event.key === 'Delete' || event.key === 'Backspace') {
        event.preventDefault();
        remove(selected);
        setSelected('');
        return;
      }
      const element = doc?.elements.find((item) => item.id === selected);
      if (!element || element.locked || !['ArrowLeft', 'ArrowRight', 'ArrowUp', 'ArrowDown'].includes(event.key))
        return;
      event.preventDefault();
      const step = event.shiftKey ? 10 : 1;
      const x = Math.max(
        0,
        Math.min(
          doc!.width - element.width,
          element.x + (event.key === 'ArrowLeft' ? -step : event.key === 'ArrowRight' ? step : 0),
        ),
      );
      const y = Math.max(
        0,
        Math.min(
          doc!.height - element.height,
          element.y + (event.key === 'ArrowUp' ? -step : event.key === 'ArrowDown' ? step : 0),
        ),
      );
      update(selected, { x, y });
    }
    window.addEventListener('keydown', onKeyDown);
    return () => window.removeEventListener('keydown', onKeyDown);
  }, [doc, editable, selected]);

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

  async function improveSelectedText() {
    const element = doc?.elements.find((item) => item.id === selected);
    if (
      !element ||
      !doc ||
      aiWorking ||
      !editable ||
      element.locked ||
      element.binding ||
      !['text', 'ticker'].includes(element.type) ||
      !element.props.text?.trim()
    )
      return;
    setAiWorking(true);
    try {
      const result = await api<any>('/api/ai/overlay-copy', {
        method: 'POST',
        body: JSON.stringify({
          text: element.props.text,
          elementName: element.name,
          binding: element.binding,
          template: doc.template,
        }),
      });
      updateProps(element.id, { text: result.output.text });
      setMessage(
        `KI-Text übernommen · ${result.model} (${result.tier === 'free' ? 'kostenlos' : 'bezahlt'}): ${result.output.rationale}`,
      );
    } catch (error) {
      setMessage(error instanceof Error ? error.message : String(error));
    } finally {
      setAiWorking(false);
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
  const aiTextEligible = Boolean(
    el && !el.locked && !el.binding && ['text', 'ticker'].includes(el.type) && el.props.text?.trim(),
  );
  const baseScale = useMemo(() => (doc ? Math.min(1, 760 / doc.width) : 1), [doc]);
  const scale = baseScale * zoom;
  const publishedVersion = current?.versions?.find((version: any) => version.status === 'published');
  return (
    <div className="editor-shell panel" id="Overlays">
      <div className="page-title">
        <div>
          <p className="eyebrow">Grafiksystem</p>
          <h2>{current?.project?.name ?? 'Overlay-Editor'}</h2>
          <p>Sendegrafik bearbeiten und als OBS-Browserquelle veröffentlichen.</p>
        </div>
        <div className="page-title-actions">
          {publishedVersion && <span className="state-pill success">Live v{publishedVersion.version}</span>}
          <button
            disabled={!allowed || !current?.project}
            onClick={() => {
              setDialogError('');
              setProjectDialog('edit');
            }}
          >
            <Settings2 size={16} /> Name &amp; Einstellungen
          </button>
        </div>
      </div>
      {!allowed && <p className="forbidden">Keine Berechtigung: Editor ist schreibgeschützt.</p>}
      <div className="editor-toolbar">
        <select
          aria-label="Overlay auswählen"
          disabled={publishing || aiWorking}
          value={current?.project?.id ?? ''}
          onChange={(event) => navigate(`${routes.overlays}/${event.target.value}/edit`)}
        >
          {projects.map((project) => (
            <option key={project.id} value={project.id}>
              {project.name}
            </option>
          ))}
        </select>
        <button
          disabled={!editable}
          onClick={() => {
            setDialogError('');
            setProjectDialog('create');
          }}
        >
          <Plus size={16} /> Neu
        </button>
        {current?.project?.id && (
          <a className="button" href={`/overlay/preview/${current.project.id}`} target="_blank" rel="noreferrer">
            <ExternalLink size={16} /> Vorschau
          </a>
        )}
        <span className="editor-toolbar-divider" aria-hidden="true" />
        <button disabled={!editable || !doc || saving} onClick={() => void manualSave()}>
          <Save size={16} /> {saving ? 'Speichert …' : 'Speichern'}
        </button>
        <button className="primary-button" disabled={!editable || !doc} onClick={() => void publish()}>
          <Send size={16} /> {publishing ? 'Veröffentlichen …' : 'Veröffentlichen'}
        </button>
        <button
          disabled={!editable || !aiTextEligible}
          onClick={() => void improveSelectedText()}
          title={
            el?.binding
              ? 'Dynamisch gebundene Texte werden aus dem Beitrag befüllt.'
              : el?.locked
                ? 'Entsperren Sie das Element zuerst.'
                : 'Ausgewählten statischen Text mit KI verbessern.'
          }
        >
          <WandSparkles size={16} /> {aiWorking ? 'KI formuliert …' : 'KI-Text'}
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
        <span className="editor-toolbar-divider" aria-hidden="true" />
        <button
          className="icon-button"
          disabled={zoom <= 0.5}
          onClick={() => setZoom((value) => Math.max(0.5, Number((value - 0.25).toFixed(2))))}
          title="Verkleinern"
          aria-label="Vorschau verkleinern"
        >
          <ZoomOut size={17} />
        </button>
        <button className="editor-zoom-value" onClick={() => setZoom(1)} title="Ansicht einpassen">
          {Math.round(zoom * 100)} %
        </button>
        <button
          className="icon-button"
          disabled={zoom >= 2}
          onClick={() => setZoom((value) => Math.min(2, Number((value + 0.25).toFixed(2))))}
          title="Vergrößern"
          aria-label="Vorschau vergrößern"
        >
          <ZoomIn size={17} />
        </button>
        <button className={snapToGrid ? 'active-toggle' : ''} onClick={() => setSnapToGrid((value) => !value)}>
          <Grid3X3 size={16} /> Raster {snapToGrid ? 'an' : 'aus'}
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
            {el && (
              <div className="layer-quick-actions" aria-label="Ausrichtung und Ebenenreihenfolge">
                <button
                  disabled={!editable || el.locked}
                  onClick={() => alignElement(el.id, 'horizontal')}
                  title="Horizontal zentrieren"
                  aria-label="Horizontal zentrieren"
                >
                  <AlignCenterHorizontal size={15} />
                </button>
                <button
                  disabled={!editable || el.locked}
                  onClick={() => alignElement(el.id, 'vertical')}
                  title="Vertikal zentrieren"
                  aria-label="Vertikal zentrieren"
                >
                  <AlignCenterVertical size={15} />
                </button>
                <button
                  disabled={!editable || el.locked}
                  onClick={() => bringToFront(el.id)}
                  title="Ganz nach vorne"
                  aria-label="Ganz nach vorne"
                >
                  <ArrowUpToLine size={15} />
                </button>
                <button
                  disabled={!editable || el.locked}
                  onClick={() => sendToBack(el.id)}
                  title="Ganz nach hinten"
                  aria-label="Ganz nach hinten"
                >
                  <ArrowDownToLine size={15} />
                </button>
              </div>
            )}
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
            {current?.versions?.length > 0 && (
              <div className="overlay-version-history">
                <p className="layers-heading">
                  <History size={13} /> Versionen
                </p>
                {current.versions.slice(0, 8).map((version: any) => (
                  <div className="overlay-version-entry" key={version.id}>
                    <span>
                      <strong>v{version.version}</strong>
                      <small>
                        {version.status === 'published' ? 'Live' : version.status === 'draft' ? 'Entwurf' : 'Archiv'}
                      </small>
                    </span>
                    <button
                      className="icon-button ghost-button"
                      disabled={!editable || version.id === current.draft?.id}
                      onClick={() => void restoreVersion(version.id, version.version)}
                      title="Diese Version wiederherstellen"
                      aria-label={`Version ${version.version} wiederherstellen`}
                    >
                      <RotateCcw size={14} />
                    </button>
                  </div>
                ))}
              </div>
            )}
          </section>
          <section className="editor-stage">
            <div
              className="canvas"
              style={{ width: doc.width * scale, height: doc.height * scale, background: '#111' }}
              onMouseMove={(event) => {
                if (!drag.current || !doc || !editable) return;
                const bounds = event.currentTarget.getBoundingClientRect();
                const element = doc.elements.find((item) => item.id === drag.current!.id);
                if (!element) return;
                const rawX = (event.clientX - bounds.left) / scale - drag.current.dx;
                const rawY = (event.clientY - bounds.top) / scale - drag.current.dy;
                const step = snapToGrid ? 10 : 1;
                const x = Math.max(0, Math.min(doc.width - element.width, Math.round(rawX / step) * step));
                const y = Math.max(0, Math.min(doc.height - element.height, Math.round(rawY / step) * step));
                if (element.x === x && element.y === y) return;
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
                      transform: `rotate(${element.rotation ?? 0}deg)`,
                      position: 'absolute',
                      color: element.props.color,
                      background: element.props.background,
                      border: `${element.props.borderWidth ?? 0}px solid ${element.props.borderColor ?? 'transparent'}`,
                      borderRadius:
                        element.type === 'shape' && element.props.shape === 'ellipse'
                          ? '50%'
                          : (element.props.borderRadius ?? 0) * scale,
                      fontSize: (element.props.fontSize ?? 32) * scale,
                      fontWeight: element.props.fontWeight,
                      fontFamily: element.props.fontFamily,
                      textAlign: element.props.align,
                      padding: (element.props.padding ?? 0) * scale,
                      overflow: 'hidden',
                    }}
                  >
                    {(element.type === 'image' || element.type === 'logo') && element.props.src ? (
                      <img
                        src={element.props.src}
                        alt=""
                        draggable={false}
                        style={{ width: '100%', height: '100%', objectFit: element.props.objectFit ?? 'contain' }}
                      />
                    ) : element.type === 'image' || element.type === 'logo' ? (
                      <span className="overlay-image-placeholder">
                        <Image size={18} /> Bildquelle wählen
                      </span>
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
                <div className="property-row">
                  <label>
                    Drehung
                    <input
                      disabled={!editable}
                      type="number"
                      min="-360"
                      max="360"
                      value={el.rotation ?? 0}
                      onChange={(event) => update(el.id, { rotation: Number(event.target.value) })}
                    />
                  </label>
                  <label>
                    Deckkraft
                    <input
                      disabled={!editable}
                      type="number"
                      min="0"
                      max="100"
                      value={Math.round((el.opacity ?? 1) * 100)}
                      onChange={(event) =>
                        update(el.id, { opacity: Math.max(0, Math.min(1, Number(event.target.value) / 100)) })
                      }
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
                      'article.publishedAt',
                      'article.publishedDate',
                      'article.category',
                      'article.region',
                      'playlist.current',
                      'clock.time',
                      'playback.status',
                      'channel.name',
                    ].map((binding) => (
                      <option key={binding}>{binding}</option>
                    ))}
                  </select>
                </label>
                {['text', 'ticker', 'clock'].includes(el.type) && (
                  <label>
                    Text
                    <textarea
                      disabled={!editable || Boolean(el.binding)}
                      rows={3}
                      value={el.props.text ?? ''}
                      onChange={(event) => updateProps(el.id, { text: event.target.value })}
                    />
                  </label>
                )}
                {['image', 'logo'].includes(el.type) && (
                  <>
                    <label>
                      Bild-URL
                      <input
                        disabled={!editable}
                        placeholder="/api/media/…/file oder https://…"
                        value={el.props.src ?? ''}
                        onChange={(event) => updateProps(el.id, { src: event.target.value || undefined })}
                      />
                    </label>
                    <label>
                      Bildanpassung
                      <select
                        disabled={!editable}
                        value={el.props.objectFit ?? 'contain'}
                        onChange={(event) => updateProps(el.id, { objectFit: event.target.value })}
                      >
                        <option value="contain">Einpassen</option>
                        <option value="cover">Ausfüllen</option>
                        <option value="fill">Strecken</option>
                      </select>
                    </label>
                  </>
                )}
                {el.type === 'shape' && (
                  <label>
                    Form
                    <select
                      disabled={!editable}
                      value={el.props.shape ?? 'rect'}
                      onChange={(event) => updateProps(el.id, { shape: event.target.value })}
                    >
                      <option value="rect">Rechteck</option>
                      <option value="ellipse">Ellipse</option>
                    </select>
                  </label>
                )}
                <div className="property-row">
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
                </div>
                {['text', 'ticker', 'clock'].includes(el.type) && (
                  <>
                    <div className="property-row">
                      <label>
                        Schriftart
                        <select
                          disabled={!editable}
                          value={el.props.fontFamily ?? 'Inter'}
                          onChange={(event) => updateProps(el.id, { fontFamily: event.target.value })}
                        >
                          {['Inter', 'Arial', 'Georgia', 'Roboto', 'system'].map((font) => (
                            <option key={font}>{font}</option>
                          ))}
                        </select>
                      </label>
                      <label>
                        Stärke
                        <select
                          disabled={!editable}
                          value={el.props.fontWeight ?? '700'}
                          onChange={(event) => updateProps(el.id, { fontWeight: event.target.value })}
                        >
                          {['300', '400', '500', '600', '700', '800', '900'].map((weight) => (
                            <option key={weight}>{weight}</option>
                          ))}
                        </select>
                      </label>
                    </div>
                    <div className="property-row">
                      <label>
                        Schriftgröße
                        <input
                          disabled={!editable}
                          type="number"
                          min="8"
                          max="220"
                          value={el.props.fontSize ?? 42}
                          onChange={(event) => updateProps(el.id, { fontSize: Number(event.target.value) })}
                        />
                      </label>
                      <label>
                        Ausrichtung
                        <select
                          disabled={!editable}
                          value={el.props.align ?? 'left'}
                          onChange={(event) => updateProps(el.id, { align: event.target.value })}
                        >
                          <option value="left">Links</option>
                          <option value="center">Zentriert</option>
                          <option value="right">Rechts</option>
                        </select>
                      </label>
                    </div>
                  </>
                )}
                <div className="property-row">
                  <label>
                    Rahmen
                    <input
                      disabled={!editable}
                      type="number"
                      min="0"
                      max="24"
                      value={el.props.borderWidth ?? 0}
                      onChange={(event) => updateProps(el.id, { borderWidth: Number(event.target.value) })}
                    />
                  </label>
                  <label>
                    Rahmenfarbe
                    <input
                      disabled={!editable}
                      value={el.props.borderColor ?? 'transparent'}
                      onChange={(event) => updateProps(el.id, { borderColor: event.target.value })}
                    />
                  </label>
                </div>
                <div className="property-row">
                  <label>
                    Eckenradius
                    <input
                      disabled={!editable}
                      type="number"
                      min="0"
                      max="128"
                      value={el.props.borderRadius ?? 0}
                      onChange={(event) => updateProps(el.id, { borderRadius: Number(event.target.value) })}
                    />
                  </label>
                  <label>
                    Innenabstand
                    <input
                      disabled={!editable}
                      type="number"
                      min="0"
                      max="128"
                      value={el.props.padding ?? 0}
                      onChange={(event) => updateProps(el.id, { padding: Number(event.target.value) })}
                    />
                  </label>
                </div>
                <label>
                  Animation
                  <select
                    disabled={!editable}
                    value={el.props.animation ?? 'none'}
                    onChange={(event) => updateProps(el.id, { animation: event.target.value })}
                  >
                    <option value="none">Keine</option>
                    <option value="fade">Einblenden</option>
                    <option value="slide">Hereinfahren</option>
                    <option value="ticker">Laufband</option>
                  </select>
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
      {projectDialog && (
        <OverlayProjectDialog
          mode={projectDialog}
          busy={projectBusy}
          error={dialogError}
          initial={
            projectDialog === 'edit' && current?.project
              ? {
                  name: current.project.name,
                  template: current.project.template,
                  width: current.project.width,
                  height: current.project.height,
                }
              : undefined
          }
          onClose={() => !projectBusy && setProjectDialog(null)}
          onSubmit={submitProject}
        />
      )}
    </div>
  );
}
