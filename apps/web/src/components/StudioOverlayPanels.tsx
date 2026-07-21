import React, { useEffect, useMemo, useRef, useState } from 'react';
import {
  ArrowRight,
  Command,
  FileSearch,
  HelpCircle,
  Keyboard,
  LoaderCircle,
  Search,
  Sparkles,
  Star,
  X,
} from 'lucide-react';
import { useNavigate } from 'react-router-dom';
import { api, type SessionUser } from '../api/client.js';
import { allWorkspaceCommands, type Workspace, type WorkspaceLink } from '../workspace-navigation.js';

export type QuickRoute = { to: string; label: string; visitedAt: string };

function routeAllowed(item: WorkspaceLink, user: SessionUser) {
  return !item.permission || user.role === 'administrator' || user.permissions.includes(item.permission);
}

type StudioSourceHit = {
  id: string;
  to: string;
  label: string;
  description: string;
  score: number;
  matchCount: number;
  sourceKinds: string[];
  matchedTerms: string[];
};

type PaletteEntry = WorkspaceLink & { sourceHit?: StudioSourceHit };

function sourceRouteAllowed(path: string, user: SessionUser) {
  if (!path.startsWith('/admin/')) return true;
  return user.role === 'administrator' || user.permissions.includes('users:write');
}

function searchText(value: string) {
  return value
    .normalize('NFKD')
    .replace(/[\u0300-\u036f]/g, '')
    .toLocaleLowerCase('de-DE')
    .trim();
}

export function CommandPalette({
  open,
  user,
  favorites,
  recents,
  onClose,
}: {
  open: boolean;
  user: SessionUser;
  favorites: string[];
  recents: QuickRoute[];
  onClose: () => void;
}) {
  const navigate = useNavigate();
  const [query, setQuery] = useState('');
  const [selected, setSelected] = useState(0);
  const [sourceHits, setSourceHits] = useState<StudioSourceHit[]>([]);
  const [sourceLoading, setSourceLoading] = useState(false);
  const [sourceError, setSourceError] = useState('');
  const [indexedFiles, setIndexedFiles] = useState(0);
  const inputRef = useRef<HTMLInputElement>(null);
  const commands = useMemo(
    () => [
      ...new Map(
        allWorkspaceCommands()
          .filter((item) => routeAllowed(item, user))
          .map((item) => [item.to, item]),
      ).values(),
    ],
    [user],
  );
  const visible = useMemo<PaletteEntry[]>(() => {
    const normalized = searchText(query);
    const terms = normalized.split(/\s+/).filter(Boolean);
    const ranked = commands
      .filter((item) =>
        terms.every((term) => searchText(`${item.label} ${item.description} ${item.keywords}`).includes(term)),
      )
      .sort((a, b) => Number(favorites.includes(b.to)) - Number(favorites.includes(a.to)));
    if (normalized) {
      const sourceByRoute = new Map(sourceHits.map((hit) => [hit.to, hit]));
      const merged = new Map<string, PaletteEntry>();
      for (const item of ranked) merged.set(item.to, { ...item, sourceHit: sourceByRoute.get(item.to) });
      for (const hit of sourceHits) {
        const command = commands.find((item) => item.to === hit.to);
        merged.set(hit.to, {
          ...(command ?? {
            id: hit.id,
            to: hit.to,
            label: hit.label,
            description: hit.description,
            keywords: hit.matchedTerms.join(' '),
            icon: FileSearch,
          }),
          sourceHit: hit,
        });
      }
      return [...merged.values()].slice(0, 15);
    }
    const recentCommands = recents
      .map((recent) => commands.find((command) => command.to === recent.to))
      .filter((item): item is WorkspaceLink => Boolean(item));
    return [...new Map([...recentCommands, ...ranked].map((item) => [item.to, item])).values()].slice(0, 12);
  }, [commands, favorites, query, recents, sourceHits]);

  useEffect(() => {
    if (!open) return;
    setQuery('');
    setSelected(0);
    setSourceHits([]);
    setSourceError('');
    window.setTimeout(() => inputRef.current?.focus(), 20);
  }, [open]);

  useEffect(() => setSelected(0), [query]);

  useEffect(() => {
    const value = query.trim();
    if (!open || value.length < 2) {
      setSourceHits([]);
      setSourceLoading(false);
      setSourceError('');
      return;
    }
    let cancelled = false;
    const controller = new AbortController();
    const timer = window.setTimeout(() => {
      setSourceLoading(true);
      setSourceError('');
      void api<{ results: StudioSourceHit[]; index: { files: number } }>(
        `/api/studio-search?q=${encodeURIComponent(value)}&limit=15`,
        { signal: controller.signal },
      )
        .then((result) => {
          if (cancelled) return;
          setSourceHits(result.results.filter((hit) => sourceRouteAllowed(hit.to, user)));
          setIndexedFiles(result.index.files);
        })
        .catch(() => {
          if (!cancelled) setSourceError('Die Quelltextsuche ist vorübergehend nicht verfügbar.');
        })
        .finally(() => {
          if (!cancelled) setSourceLoading(false);
        });
    }, 180);
    return () => {
      cancelled = true;
      controller.abort();
      window.clearTimeout(timer);
    };
  }, [open, query, user]);

  if (!open) return null;

  function openItem(item: WorkspaceLink | undefined) {
    if (!item) return;
    navigate(item.to);
    onClose();
  }

  return (
    <div className="studio-modal-backdrop" role="presentation" onMouseDown={onClose}>
      <section
        className="command-palette"
        role="dialog"
        aria-modal="true"
        aria-label="Studio durchsuchen"
        onMouseDown={(event) => event.stopPropagation()}
      >
        <div className="command-search">
          <Search size={20} />
          <input
            ref={inputRef}
            value={query}
            onChange={(event) => setQuery(event.target.value)}
            onKeyDown={(event) => {
              if (event.key === 'ArrowDown') {
                event.preventDefault();
                setSelected((value) => Math.min(visible.length - 1, value + 1));
              }
              if (event.key === 'ArrowUp') {
                event.preventDefault();
                setSelected((value) => Math.max(0, value - 1));
              }
              if (event.key === 'Enter') openItem(visible[selected]);
              if (event.key === 'Escape') onClose();
            }}
            placeholder="Seiten, Funktionen und Einstellungen suchen …"
            aria-label="Studio durchsuchen"
          />
          <kbd>ESC</kbd>
        </div>
        <div className="command-results">
          <div className="command-section-label">
            <span>{query ? 'Suchergebnisse' : 'Zuletzt benutzt und empfohlen'}</span>
            <span className="command-result-state">
              {sourceLoading && <LoaderCircle size={13} className="spin" />}
              {visible.length}
            </span>
          </div>
          {visible.map((item, index) => {
            const Icon = item.icon;
            return (
              <button
                key={`${item.id}-${item.to}`}
                className={selected === index ? 'selected' : ''}
                onMouseEnter={() => setSelected(index)}
                onClick={() => openItem(item)}
              >
                <span className="command-icon">
                  <Icon size={18} />
                </span>
                <span>
                  <strong>{item.label}</strong>
                  <small>{item.description}</small>
                  {item.sourceHit && (
                    <span className="command-source-meta">
                      <FileSearch size={12} /> Quelltext · {item.sourceHit.matchCount} Treffer ·{' '}
                      {item.sourceHit.sourceKinds.join(', ')}
                    </span>
                  )}
                </span>
                {favorites.includes(item.to) && <Star size={14} className="favorite-star" fill="currentColor" />}
                <ArrowRight size={16} />
              </button>
            );
          })}
          {visible.length === 0 && sourceLoading && (
            <div className="command-empty" aria-live="polite">
              <LoaderCircle size={22} className="spin" />
              <strong>Das gesamte Studio wird durchsucht</strong>
              <span>Navigation, Oberfläche, Backend, Dokumentation, Tests und Betriebsskripte werden ausgewertet.</span>
            </div>
          )}
          {visible.length === 0 && !sourceLoading && (
            <div className="command-empty">
              <Sparkles size={22} />
              <strong>Keine passende Funktion gefunden</strong>
              <span>{sourceError || 'Versuche einen allgemeineren Begriff wie „Stream“, „Quelle“ oder „OBS“.'}</span>
            </div>
          )}
        </div>
        <footer className="command-footer">
          <span>
            <kbd>↑</kbd>
            <kbd>↓</kbd> auswählen
          </span>
          <span>
            <kbd>↵</kbd> öffnen
          </span>
          <span>
            <Command size={13} /> K global öffnen
          </span>
          {indexedFiles > 0 && (
            <span className="command-index-state">
              <FileSearch size={13} /> {indexedFiles} Quelldateien indexiert
            </span>
          )}
        </footer>
      </section>
    </div>
  );
}

export function HelpDrawer({ open, workspace, onClose }: { open: boolean; workspace: Workspace; onClose: () => void }) {
  useEffect(() => {
    if (!open) return;
    const close = (event: KeyboardEvent) => {
      if (event.key === 'Escape') onClose();
    };
    document.addEventListener('keydown', close);
    return () => document.removeEventListener('keydown', close);
  }, [onClose, open]);

  if (!open) return null;
  return (
    <div className="drawer-backdrop" role="presentation" onMouseDown={onClose}>
      <aside
        className="studio-help-drawer"
        role="dialog"
        aria-modal="true"
        onMouseDown={(event) => event.stopPropagation()}
      >
        <header>
          <span className="drawer-icon">
            <HelpCircle size={20} />
          </span>
          <div>
            <p className="eyebrow">Kontexthilfe</p>
            <h2>{workspace.label}</h2>
          </div>
          <button className="icon-button ghost-button" onClick={onClose} aria-label="Hilfe schließen">
            <X size={18} />
          </button>
        </header>
        <section>
          <h3>Wofür ist dieser Bereich?</h3>
          <p>{workspace.description}. Alle zugehörigen Werkzeuge stehen direkt unter der Kopfleiste bereit.</p>
        </section>
        <section>
          <h3>Schnellzugriff</h3>
          <div className="help-link-list">
            {(workspace.children.length ? workspace.children : [workspace]).map((item) => {
              const Icon = item.icon;
              return (
                <div key={item.id}>
                  <Icon size={17} />
                  <span>
                    <strong>{item.label}</strong>
                    <small>{item.description}</small>
                  </span>
                </div>
              );
            })}
          </div>
        </section>
        <section>
          <h3>
            <Keyboard size={17} /> Tastaturkürzel
          </h3>
          <dl className="shortcut-list">
            <div>
              <dt>
                <kbd>Ctrl</kbd> <kbd>K</kbd>
              </dt>
              <dd>Studio durchsuchen</dd>
            </div>
            <div>
              <dt>
                <kbd>?</kbd>
              </dt>
              <dd>Diese Hilfe öffnen</dd>
            </div>
            <div>
              <dt>
                <kbd>G</kbd> <kbd>Ü</kbd>
              </dt>
              <dd>Zur Übersicht</dd>
            </div>
            <div>
              <dt>
                <kbd>G</kbd> <kbd>R</kbd>
              </dt>
              <dd>Direkt in die Regie</dd>
            </div>
          </dl>
        </section>
        <footer>
          <HelpCircle size={16} />
          <span>Die Hilfe berücksichtigt immer den aktuell geöffneten Arbeitsbereich.</span>
        </footer>
      </aside>
    </div>
  );
}
