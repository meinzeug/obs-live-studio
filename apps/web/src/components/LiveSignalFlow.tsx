import {
  Activity,
  Bot,
  Eye,
  Layers3,
  MessageSquareText,
  MonitorPlay,
  Radio,
  Video,
  Wifi,
} from 'lucide-react';

type SignalTone = 'ok' | 'live' | 'warning' | 'muted';

function SignalNode({
  icon: Icon,
  eyebrow,
  value,
  detail,
  tone,
  onClick,
}: {
  icon: typeof Video;
  eyebrow: string;
  value: string;
  detail: string;
  tone: SignalTone;
  onClick: () => void;
}) {
  return (
    <button className={`live-signal-node ${tone}`} onClick={onClick}>
      <span className="live-signal-node-icon">
        <Icon size={19} />
        <i />
      </span>
      <span>
        <small>{eyebrow}</small>
        <strong>{value}</strong>
        <em>{detail}</em>
      </span>
    </button>
  );
}

function Connector({ active }: { active: boolean }) {
  return (
    <span className={`live-signal-connector ${active ? 'active' : ''}`} aria-hidden="true">
      <i />
      <b>›</b>
    </span>
  );
}

export function LiveSignalFlow({
  sourceCount,
  previewName,
  programName,
  sceneName,
  modeName,
  obsConnected,
  streamActive,
  reconnecting,
  autopilotEnabled,
  overlayVisible,
  chatVisible,
  onSources,
  onPreview,
  onProgram,
  onStream,
  onAutopilot,
  onOverlay,
  onChat,
}: {
  sourceCount: number;
  previewName: string;
  programName: string;
  sceneName: string;
  modeName: string;
  obsConnected: boolean;
  streamActive: boolean;
  reconnecting: boolean;
  autopilotEnabled: boolean;
  overlayVisible: boolean;
  chatVisible: boolean;
  onSources: () => void;
  onPreview: () => void;
  onProgram: () => void;
  onStream: () => void;
  onAutopilot: () => void;
  onOverlay: () => void;
  onChat: () => void;
}) {
  return (
    <section className="live-signal-flow" aria-label="Signalweg der Live-Regie">
      <header>
        <div>
          <p className="eyebrow">Signalweg</p>
          <h2>Von der Quelle bis zum Zuschauer</h2>
        </div>
        <span className={streamActive && obsConnected ? 'ok' : 'warning'}>
          <Activity size={14} />
          {streamActive && obsConnected ? 'Signalkette aktiv' : 'Ausgabe nicht vollständig aktiv'}
        </span>
      </header>

      <div className="live-signal-track">
        <SignalNode
          icon={Video}
          eyebrow="1 · Quellen"
          value={`${sourceCount} sendebereit`}
          detail="Kameras, Portal und YouTube"
          tone={sourceCount > 0 ? 'ok' : 'muted'}
          onClick={onSources}
        />
        <Connector active={sourceCount > 0} />
        <SignalNode
          icon={Eye}
          eyebrow="2 · Vorschau"
          value={previewName}
          detail="Nächster kontrollierter Take"
          tone={previewName === 'Nicht belegt' ? 'muted' : 'warning'}
          onClick={onPreview}
        />
        <Connector active={previewName !== 'Nicht belegt'} />
        <SignalNode
          icon={MonitorPlay}
          eyebrow="3 · Programm"
          value={programName}
          detail={`${modeName} · ${sceneName}`}
          tone={programName === 'Bereitschaft' ? 'muted' : 'live'}
          onClick={onProgram}
        />
        <Connector active={obsConnected} />
        <SignalNode
          icon={Wifi}
          eyebrow="4 · OBS"
          value={obsConnected ? 'Verbunden' : 'Getrennt'}
          detail={sceneName}
          tone={obsConnected ? 'ok' : 'warning'}
          onClick={onProgram}
        />
        <Connector active={streamActive} />
        <SignalNode
          icon={Radio}
          eyebrow="5 · Zuschauer"
          value={streamActive ? 'ON AIR' : reconnecting ? 'Verbindet neu' : 'Stream aus'}
          detail="Streaming-Ziele und Auslastung"
          tone={streamActive ? 'live' : reconnecting ? 'warning' : 'muted'}
          onClick={onStream}
        />
      </div>

      <div className="live-signal-services" aria-label="Begleitende Sendesysteme">
        <button className={autopilotEnabled ? 'active' : ''} onClick={onAutopilot}>
          <Bot size={15} />
          <span>Autopilot</span>
          <strong>{autopilotEnabled ? 'aktiv' : 'pausiert'}</strong>
        </button>
        <button className={overlayVisible ? 'active' : ''} onClick={onOverlay}>
          <Layers3 size={15} />
          <span>Grafik</span>
          <strong>{overlayVisible ? 'im Bild' : 'Clean Feed'}</strong>
        </button>
        <button className={chatVisible ? 'active' : ''} onClick={onChat}>
          <MessageSquareText size={15} />
          <span>Chat</span>
          <strong>{chatVisible ? 'eingeblendet' : 'aus'}</strong>
        </button>
      </div>
    </section>
  );
}
