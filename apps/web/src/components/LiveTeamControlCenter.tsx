import { useEffect, useMemo, useState } from 'react';
import {
  Activity,
  AlertTriangle,
  AudioLines,
  CheckCircle2,
  Eye,
  EyeOff,
  Grid3X3,
  Maximize2,
  Megaphone,
  Mic,
  MicOff,
  MonitorPlay,
  PictureInPicture2,
  Radio,
  Send,
  Settings,
  ShieldAlert,
  SplitSquareHorizontal,
  Square,
  UserPlus,
  Video,
  Wifi,
  WifiOff,
} from 'lucide-react';
import type { SessionUser } from '../api/client.js';
import { LiveProductionChat } from './LiveProductionChat.js';

export type LiveTeamSource = {
  id: string;
  name: string;
  user: string | null;
  status: 'live' | 'connecting' | 'offline' | 'error';
  resolution: string | null;
  audioLevel: number | null;
  network: 'good' | 'unstable' | 'poor' | 'offline' | null;
  previewUrl: string | null;
  sourceType?: 'portal' | 'youtube';
  youtubeReady?: boolean;
  obs: null | {
    muted: boolean;
    hidden: boolean;
    index: number;
    inProgram: boolean;
  };
};

type TeamBroadcastState = 'live' | 'studio-only' | 'program-stream' | 'ready';

export function deriveTeamBroadcastState(liveActive: boolean, streamActive: boolean): TeamBroadcastState {
  if (liveActive && streamActive) return 'live';
  if (liveActive) return 'studio-only';
  if (streamActive) return 'program-stream';
  return 'ready';
}

const layoutOptions = [
  ['fullscreen', 'Vollbild', Maximize2],
  ['split', '2er-Split', SplitSquareHorizontal],
  ['grid', 'Raster', Grid3X3],
  ['pip', 'Bild-in-Bild', PictureInPicture2],
] as const;

const transitionOptions = [
  ['fade', 'Weich blenden'],
  ['slide', 'Seitlich fahren'],
  ['zoom', 'Zoom'],
  ['wipe', 'Grafik-Wipe'],
  ['cut', 'Harter Schnitt'],
] as const;

const stateCopy: Record<TeamBroadcastState, { kicker: string; title: string; detail: string }> = {
  live: {
    kicker: 'ON AIR',
    title: 'Live-Studio ist im Programm',
    detail: 'OBS sendet die Live-Szene. Zeitplan und Autopilot warten bis zur kontrollierten Rückkehr.',
  },
  'studio-only': {
    kicker: 'ACHTUNG',
    title: 'Live-Szene aktiv, Stream-Ausgabe aus',
    detail: 'Das Studio besitzt die Programmhoheit, wird aber derzeit nicht an die Streaming-Ziele ausgegeben.',
  },
  'program-stream': {
    kicker: 'PROGRAMM LIVE',
    title: 'Stream läuft – Live-Studio steht bereit',
    detail: 'Das geplante Programm bleibt on air, bis die Live-Regie bewusst übernimmt.',
  },
  ready: {
    kicker: 'BEREITSCHAFT',
    title: 'Live-Studio und Stream sind aus',
    detail: 'Quellen können vorbereitet werden, ohne das geplante Programm zu verändern.',
  },
};

function sourceStatus(source: LiveTeamSource) {
  if (source.obs?.inProgram && !source.obs.hidden) return 'PROGRAMM';
  if (source.obs && !source.obs.hidden) return 'IM BILD';
  if (source.obs) return 'BEREIT';
  if (source.status === 'live') return 'VERFÜGBAR';
  if (source.status === 'connecting') return 'VERBINDET';
  return source.status === 'error' ? 'FEHLER' : 'OFFLINE';
}

function SignalPreview({ source, empty }: { source: LiveTeamSource | null; empty: string }) {
  if (!source) {
    return (
      <div className="live-team-monitor-empty">
        <Video size={32} />
        <strong>{empty}</strong>
      </div>
    );
  }
  return (
    <>
      {source.previewUrl ? <img src={source.previewUrl} alt={`Vorschau ${source.name}`} /> : <Video size={36} />}
      <div className="live-team-monitor-label">
        <strong>{source.name}</strong>
        <span>
          {source.resolution || 'Auflösung unbekannt'} ·{' '}
          {source.user || (source.sourceType === 'youtube' ? 'YouTube' : 'Live-Portal')}
        </span>
      </div>
    </>
  );
}

export function LiveTeamControlCenter({
  user,
  sources,
  liveActive,
  streamActive,
  streamReconnecting,
  youtubeOutput,
  obsConnected,
  currentScene,
  currentTitle,
  currentItem,
  returnTitle,
  layout,
  sourceTransition,
  sourceDurationMs,
  sourceAutoLayout,
  busy,
  onGoLive,
  onEndLive,
  onStreamDetails,
  onPreviewScene,
  onTakeScene,
  onCue,
  onInvite,
  onOpenPrivate,
  onOpenSourceManager,
  onAddSource,
  onToggleVisible,
  onPreviewSource,
  onTakeSource,
  onToggleMute,
  onMuteAll,
  onLayout,
  onSourceTransition,
  onSourceDuration,
  onAutoLayout,
  onSaveSourceSettings,
}: {
  user: SessionUser;
  sources: LiveTeamSource[];
  liveActive: boolean;
  streamActive: boolean;
  streamReconnecting: boolean;
  youtubeOutput: {
    enabled: boolean;
    state: 'disabled' | 'idle' | 'waiting-input' | 'starting' | 'live' | 'error';
    error: string | null;
  } | null;
  obsConnected: boolean;
  currentScene: string;
  currentTitle: string;
  currentItem: string;
  returnTitle: string;
  layout: 'fullscreen' | 'split' | 'grid' | 'pip' | 'reaction' | 'talk';
  sourceTransition: 'cut' | 'fade' | 'slide' | 'zoom' | 'wipe';
  sourceDurationMs: number;
  sourceAutoLayout: boolean;
  busy: boolean;
  onGoLive: () => void;
  onEndLive: () => void;
  onStreamDetails: () => void;
  onPreviewScene: () => void;
  onTakeScene: () => void;
  onCue: () => void;
  onInvite: () => void;
  onOpenPrivate: (sourceId: string) => void;
  onOpenSourceManager: () => void;
  onAddSource: (sourceId: string) => void;
  onToggleVisible: (source: LiveTeamSource) => void;
  onPreviewSource: (sourceId: string) => void;
  onTakeSource: (sourceId: string) => void;
  onToggleMute: (source: LiveTeamSource) => void;
  onMuteAll: (muted: boolean) => void;
  onLayout: (layout: 'fullscreen' | 'split' | 'grid' | 'pip') => void;
  onSourceTransition: (transition: 'cut' | 'fade' | 'slide' | 'zoom' | 'wipe') => void;
  onSourceDuration: (durationMs: number) => void;
  onAutoLayout: (enabled: boolean) => void;
  onSaveSourceSettings: () => void;
}) {
  const programSource = useMemo(
    () =>
      sources.find((source) => source.obs?.inProgram && !source.obs.hidden) ??
      sources.find((source) => source.obs && !source.obs.hidden) ??
      null,
    [sources],
  );
  const [selectedSourceId, setSelectedSourceId] = useState('');
  const selectedSource =
    sources.find((source) => source.id === selectedSourceId) ??
    sources.find((source) => source.obs && !source.obs.hidden && !source.obs.inProgram) ??
    programSource ??
    null;
  const visibleSources = sources.filter((source) => source.obs && !source.obs.hidden);
  const audibleSources = visibleSources.filter((source) => !source.obs?.muted);
  const onlineSources = sources.filter((source) => source.status === 'live');
  const broadcastState = deriveTeamBroadcastState(liveActive, streamActive);
  const copy = stateCopy[broadcastState];

  useEffect(() => {
    if (selectedSourceId && sources.some((source) => source.id === selectedSourceId)) return;
    setSelectedSourceId(
      sources.find((source) => source.obs && !source.obs.hidden && !source.obs.inProgram)?.id ??
        programSource?.id ??
        sources[0]?.id ??
        '',
    );
  }, [programSource?.id, selectedSourceId, sources]);

  return (
    <section className="live-team-control-center" id="live-workspace-team">
      <header className={`live-team-on-air live-team-state-${broadcastState}`}>
        <div className="live-team-tally">
          <span>
            <i /> {copy.kicker}
          </span>
          <strong>{copy.title}</strong>
          <small>{copy.detail}</small>
        </div>
        <div className="live-team-on-air-facts">
          <span className={obsConnected ? 'ok' : 'error'}>
            <MonitorPlay size={15} /> OBS {obsConnected ? 'verbunden' : 'getrennt'}
          </span>
          <span className={streamActive ? 'live' : ''}>
            <Radio size={15} />{' '}
            {streamReconnecting ? 'OBS verbindet neu' : streamActive ? 'OBS-Ausgabe sendet' : 'OBS-Ausgabe aus'}
          </span>
          {youtubeOutput?.enabled && (
            <span
              className={youtubeOutput.state === 'live' ? 'ok' : youtubeOutput.state === 'error' ? 'error' : ''}
              title={youtubeOutput.error || 'Öffentlicher YouTube-Ausgang'}
            >
              {youtubeOutput.state === 'live' ? <CheckCircle2 size={15} /> : <AlertTriangle size={15} />}
              YouTube{' '}
              {
                {
                  disabled: 'aus',
                  idle: 'bereit',
                  'waiting-input': 'wartet',
                  starting: 'startet',
                  live: 'öffentlich live',
                  error: 'Fehler',
                }[youtubeOutput.state]
              }
            </span>
          )}
          <span>
            <Video size={15} /> {visibleSources.length} im Bild
          </span>
          <span>
            <AudioLines size={15} /> {audibleSources.length} hörbar
          </span>
        </div>
        <div className="live-team-on-air-actions">
          <button className="live-team-go-live" disabled={busy || (liveActive && streamActive)} onClick={onGoLive}>
            <Radio size={19} /> LIVE GEHEN
          </button>
          <button className="live-team-end-live" disabled={busy || !liveActive} onClick={onEndLive}>
            <Square size={18} /> LIVE BEENDEN
          </button>
          <button disabled={busy} onClick={onStreamDetails}>
            <Settings size={17} /> Ausgabe
          </button>
        </div>
      </header>

      <div className="live-team-context-strip">
        <div>
          <span>AKTUELLE PRODUKTION</span>
          <strong>{currentTitle}</strong>
          <small>{currentItem}</small>
        </div>
        <i />
        <div>
          <span>{liveActive ? 'RÜCKKEHRZIEL' : 'GEPLANTES PROGRAMM'}</span>
          <strong>{returnTitle}</strong>
          <small>Szene: {currentScene}</small>
        </div>
        {broadcastState === 'studio-only' && (
          <button onClick={onStreamDetails}>
            <AlertTriangle size={16} /> Ausgabe jetzt prüfen
          </button>
        )}
      </div>

      <div className="live-team-switcher">
        <section className="live-team-monitors">
          <article className="live-team-monitor preview">
            <header>
              <span>VORSCHAU</span>
              <small>ohne Auswirkung auf Zuschauer</small>
            </header>
            <div className="live-team-monitor-screen">
              <SignalPreview source={selectedSource} empty="Quelle auswählen" />
            </div>
            <div className="live-team-monitor-actions">
              <button disabled={busy} onClick={onPreviewScene}>
                <Eye size={16} /> Szene in OBS-Vorschau
              </button>
              <button
                className="live-team-take"
                disabled={busy || !liveActive || !selectedSource?.obs || Boolean(selectedSource.obs.hidden)}
                onClick={() => selectedSource && onTakeSource(selectedSource.id)}
              >
                <Send size={17} /> {liveActive ? 'QUELLE ÜBERNEHMEN' : 'ZUERST LIVE GEHEN'}
              </button>
            </div>
          </article>

          <article className="live-team-monitor program">
            <header>
              <span>PROGRAMM</span>
              <small>{liveActive ? 'für Zuschauer sichtbar' : 'Live-Szene vorbereitet'}</small>
            </header>
            <div className="live-team-monitor-screen">
              <SignalPreview source={programSource} empty="Noch keine Quelle im Programm" />
            </div>
            <div className="live-team-monitor-actions">
              <span>
                <i /> {liveActive ? 'LIVE-SZENE ON AIR' : 'NICHT ON AIR'}
              </span>
              <button className="live-team-take-scene" disabled={busy || !liveActive} onClick={onTakeScene}>
                <Send size={17} /> SZENE TAKE
              </button>
            </div>
          </article>
        </section>

        <aside className="live-team-quick-control">
          <header>
            <span>REGIE-DIREKTZUGRIFF</span>
            <strong>Bild, Ton & Einblendung</strong>
          </header>
          <div className="live-team-quick-grid">
            <button onClick={onCue} disabled={busy}>
              <Megaphone size={18} />
              <span>
                <strong>Soforteinblendung</strong>
                <small>Banner, Text, Bild oder Clip</small>
              </span>
            </button>
            <button onClick={() => onMuteAll(true)} disabled={busy || audibleSources.length === 0}>
              <ShieldAlert size={18} />
              <span>
                <strong>Alle stumm</strong>
                <small>Audio-Notfalltaste</small>
              </span>
            </button>
            <button onClick={() => onMuteAll(false)} disabled={busy || visibleSources.length === 0}>
              <AudioLines size={18} />
              <span>
                <strong>Audio frei</strong>
                <small>Sichtbare Quellen hörbar</small>
              </span>
            </button>
            <button onClick={onInvite} disabled={busy}>
              <UserPlus size={18} />
              <span>
                <strong>Gast einladen</strong>
                <small>Sicherer Portal-Zugang</small>
              </span>
            </button>
          </div>
          <div className="live-team-health">
            <span>
              <Wifi size={15} /> {onlineSources.length}/{sources.length} Quellen online
            </span>
            <span
              className={
                sources.some((source) => source.network === 'poor' || source.network === 'offline') ? 'warn' : ''
              }
            >
              <Activity size={15} />{' '}
              {sources.some((source) => source.network === 'poor' || source.network === 'offline')
                ? 'Signal prüfen'
                : 'Netzwerk stabil'}
            </span>
          </div>
        </aside>
      </div>

      <section className="live-team-source-board">
        <header>
          <div>
            <span className="eyebrow">Live-Komposition</span>
            <h2>Quellen wählen und überblenden</h2>
            <p>
              Eine Quelle zuerst auswählen, in die Vorschau legen und anschließend kontrolliert übernehmen. „Im Bild“
              fügt sie mit der eingestellten Animation zum Layout hinzu oder entfernt sie wieder.
            </p>
          </div>
          <button onClick={onOpenSourceManager}>
            <Settings size={16} /> Quellen vollständig verwalten
          </button>
        </header>

        <div className="live-team-source-grid">
          {sources.map((source) => {
            const selected = selectedSource?.id === source.id;
            const visible = Boolean(source.obs && !source.obs.hidden);
            const program = Boolean(source.obs?.inProgram && visible);
            const level = source.obs?.muted
              ? 0
              : Math.max(0, Math.min(100, Math.round((source.audioLevel ?? 0) * 100)));
            const unavailable = source.status !== 'live' && !source.obs;
            return (
              <article
                className={`${selected ? 'selected' : ''} ${program ? 'program' : ''} ${visible ? 'visible' : ''}`}
                key={source.id}
              >
                <button className="live-team-source-select" onClick={() => setSelectedSourceId(source.id)}>
                  <div className="live-team-source-preview">
                    {source.previewUrl ? <img src={source.previewUrl} alt="" /> : <Video size={27} />}
                    <span className={`live-team-source-state ${program ? 'program' : source.status}`}>
                      {sourceStatus(source)}
                    </span>
                  </div>
                  <span className="live-team-source-copy">
                    <strong>{source.name}</strong>
                    <small>
                      {source.sourceType === 'youtube' ? 'YouTube' : source.user || 'Außenstudio'} ·{' '}
                      {source.resolution || 'Signal wird geprüft'}
                    </small>
                  </span>
                </button>
                <div className="live-team-source-meter">
                  {source.obs?.muted ? <MicOff size={14} /> : <Mic size={14} />}
                  <i>
                    <b style={{ width: `${level}%` }} />
                  </i>
                  <span>{source.obs?.muted ? 'stumm' : `${level}%`}</span>
                  {source.network === 'offline' ? <WifiOff size={14} /> : <Wifi size={14} />}
                </div>
                {source.sourceType === 'youtube' && !source.youtubeReady && (
                  <span className="live-team-source-warning">
                    <AlertTriangle size={13} /> Wiedergabe noch nicht freigegeben
                  </span>
                )}
                <div className="live-team-source-actions">
                  {!source.obs ? (
                    <button
                      className="primary-button"
                      disabled={busy || unavailable}
                      onClick={() => onAddSource(source.id)}
                    >
                      <MonitorPlay size={15} /> In die Regie
                    </button>
                  ) : (
                    <>
                      <button
                        className={visible ? 'active' : ''}
                        disabled={busy || (source.sourceType === 'youtube' && !source.youtubeReady)}
                        onClick={() => onToggleVisible(source)}
                        title={visible ? 'Mit Animation aus dem Layout entfernen' : 'Mit Animation einblenden'}
                      >
                        {visible ? <Eye size={15} /> : <EyeOff size={15} />}
                        {visible ? 'Im Bild' : 'Einblenden'}
                      </button>
                      <button
                        className={selected ? 'preview-active' : ''}
                        disabled={busy}
                        onClick={() => {
                          setSelectedSourceId(source.id);
                          onPreviewSource(source.id);
                        }}
                      >
                        <Eye size={15} /> Vorschau
                      </button>
                      <button disabled={busy} onClick={() => onToggleMute(source)}>
                        {source.obs.muted ? <MicOff size={15} /> : <Mic size={15} />}
                      </button>
                    </>
                  )}
                </div>
              </article>
            );
          })}
          {sources.length === 0 && (
            <div className="live-team-no-sources">
              <WifiOff size={30} />
              <strong>Noch keine Live-Quelle verfügbar</strong>
              <span>Lade einen Außenmitarbeiter ein oder füge im Quellenbereich einen YouTube-Stream hinzu.</span>
              <button className="primary-button" onClick={onInvite}>
                <UserPlus size={15} /> Erste Quelle einladen
              </button>
            </div>
          )}
        </div>

        <footer className="live-team-composition-settings">
          <div className="live-team-layout-buttons">
            <span>Bildaufteilung</span>
            {layoutOptions.map(([value, label, Icon]) => (
              <button
                className={layout === value ? 'active' : ''}
                disabled={busy}
                key={value}
                onClick={() => onLayout(value)}
              >
                <Icon size={15} /> {label}
              </button>
            ))}
          </div>
          <label>
            <span>Quellenanimation</span>
            <select
              value={sourceTransition}
              onChange={(event) => onSourceTransition(event.target.value as typeof sourceTransition)}
            >
              {transitionOptions.map(([value, label]) => (
                <option value={value} key={value}>
                  {label}
                </option>
              ))}
            </select>
          </label>
          <label>
            <span>Blenddauer: {sourceTransition === 'cut' ? 0 : sourceDurationMs} ms</span>
            <input
              type="range"
              min={200}
              max={2000}
              step={50}
              disabled={sourceTransition === 'cut'}
              value={sourceDurationMs}
              onChange={(event) => onSourceDuration(Number(event.target.value))}
            />
          </label>
          <label className="live-team-auto-layout">
            <input
              type="checkbox"
              checked={sourceAutoLayout}
              onChange={(event) => onAutoLayout(event.target.checked)}
            />
            <span>
              <strong>Auto-Layout</strong>
              <small>passt Split und Raster automatisch an</small>
            </span>
          </label>
          <button className="primary-button" disabled={busy} onClick={onSaveSourceSettings}>
            <CheckCircle2 size={15} /> Wechsel speichern
          </button>
        </footer>
      </section>

      <div className="live-team-intercom">
        <LiveProductionChat user={user} onOpenPrivate={onOpenPrivate} onInvite={onInvite} />
      </div>
    </section>
  );
}
