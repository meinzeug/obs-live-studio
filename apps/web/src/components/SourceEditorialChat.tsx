import { useCallback, useEffect, useRef, useState } from 'react';
import { AlertTriangle, CheckCircle2, MessageSquare, Send, X } from 'lucide-react';
import { api, type SessionUser } from '../api/client.js';

type Message = {
  id: string;
  senderSide: 'streamer' | 'editorial' | 'system';
  senderName: string;
  kind: 'chat' | 'cue' | 'status';
  priority: 'normal' | 'important' | 'urgent';
  body: string;
  streamerReadAt: string | null;
  editorialReadAt: string | null;
  createdAt: string;
};

type Communication = {
  messages: Message[];
  control: {
    tally: 'offline' | 'standby' | 'preview' | 'program';
    muted: boolean;
    instruction: string | null;
  };
  unread: { streamer: number; editorial: number };
};

const cuePresets = [
  ['Gleich live', 'Du bist in 30 Sekunden live. Bitte in die Kamera schauen.', 'important'],
  ['Jetzt live', 'Du bist jetzt auf Sendung.', 'urgent'],
  ['Lauter sprechen', 'Bitte etwas lauter und näher am Mikrofon sprechen.', 'important'],
  ['Langsamer', 'Bitte etwas langsamer sprechen.', 'normal'],
  ['Zum Ende kommen', 'Bitte den Gedanken abschließen – wir gehen gleich aus der Zuschaltung.', 'important'],
  ['Technik halten', 'Bitte kurz nichts verändern. Die Technik prüft deine Verbindung.', 'urgent'],
] as const;

const desktopChatQuery = '(min-width: 1180px)';

function useDesktopChatDock() {
  const [docked, setDocked] = useState(
    () => typeof window !== 'undefined' && window.matchMedia(desktopChatQuery).matches,
  );

  useEffect(() => {
    const media = window.matchMedia(desktopChatQuery);
    const update = () => setDocked(media.matches);
    update();
    media.addEventListener('change', update);
    return () => media.removeEventListener('change', update);
  }, []);

  return docked;
}

export function SourceEditorialChat({
  source,
  user,
  onClose,
  onUpdated,
}: {
  source: { id: string; name: string; user: string | null };
  user: SessionUser;
  onClose: () => void;
  onUpdated: () => void;
}) {
  const [communication, setCommunication] = useState<Communication | null>(null);
  const [body, setBody] = useState('');
  const [priority, setPriority] = useState<'normal' | 'important' | 'urgent'>('normal');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const endRef = useRef<HTMLDivElement>(null);
  const requestInFlight = useRef(false);
  const desktopDocked = useDesktopChatDock();

  const load = useCallback(async () => {
    if (requestInFlight.current) return;
    requestInFlight.current = true;
    try {
      const result = await api<Communication>(`/api/live/sources/${encodeURIComponent(source.id)}/communication`);
      setCommunication(result);
      if (result.unread.editorial > 0) {
        await api(`/api/live/sources/${encodeURIComponent(source.id)}/messages/read`, { method: 'POST' });
        onUpdated();
      }
    } catch (requestError) {
      setError(requestError instanceof Error ? requestError.message : String(requestError));
    } finally {
      requestInFlight.current = false;
    }
  }, [onUpdated, source.id]);

  useEffect(() => {
    void load();
    const timer = window.setInterval(() => void load(), 2_500);
    return () => window.clearInterval(timer);
  }, [load]);

  useEffect(() => {
    const closeOnEscape = (event: KeyboardEvent) => {
      if (event.key === 'Escape') onClose();
    };
    window.addEventListener('keydown', closeOnEscape);
    return () => window.removeEventListener('keydown', closeOnEscape);
  }, [onClose]);

  useEffect(() => {
    if (!desktopDocked) return;
    document.body.classList.add('source-chat-docked');
    return () => document.body.classList.remove('source-chat-docked');
  }, [desktopDocked]);

  useEffect(() => {
    endRef.current?.scrollIntoView({ behavior: 'smooth' });
  }, [communication?.messages.length]);

  async function sendMessage(
    text = body,
    options: { kind?: 'chat' | 'cue'; priority?: 'normal' | 'important' | 'urgent' } = {},
  ) {
    if (!text.trim() || busy) return;
    setBusy(true);
    setError('');
    try {
      await api(`/api/live/sources/${encodeURIComponent(source.id)}/messages`, {
        method: 'POST',
        body: JSON.stringify({
          body: text.trim(),
          kind: options.kind ?? 'chat',
          priority: options.priority ?? priority,
        }),
      });
      setBody('');
      setPriority('normal');
      await load();
      onUpdated();
    } catch (requestError) {
      setError(requestError instanceof Error ? requestError.message : String(requestError));
    } finally {
      setBusy(false);
    }
  }

  return (
    <div
      className={`source-chat-backdrop ${desktopDocked ? 'is-docked' : 'is-modal'}`}
      role="presentation"
      onMouseDown={() => {
        if (!desktopDocked) onClose();
      }}
    >
      <aside
        className="source-chat-drawer"
        role={desktopDocked ? 'complementary' : 'dialog'}
        aria-modal={desktopDocked ? undefined : true}
        aria-labelledby="source-chat-title"
        onMouseDown={(event) => event.stopPropagation()}
      >
        <header className="source-chat-head">
          <div>
            <p className="eyebrow">Direktleitung zur Zuschaltung</p>
            <h2 id="source-chat-title">
              <MessageSquare size={21} /> {source.name}
            </h2>
            <span>
              {source.user || 'Streamer vor Ort'} · Redaktion: {user.display_name}
            </span>
            {desktopDocked && (
              <span className="source-chat-dock-hint">Angedockt · Regie bleibt vollständig bedienbar</span>
            )}
          </div>
          <button className="icon-button" onClick={onClose} aria-label="Chat schließen">
            <X size={18} />
          </button>
        </header>

        <section className="source-cue-presets">
          <strong>Schnelle Regiehinweise</strong>
          <div>
            {cuePresets.map(([label, text, cuePriority]) => (
              <button
                key={label}
                className={cuePriority === 'urgent' ? 'urgent' : ''}
                disabled={busy}
                onClick={() => void sendMessage(text, { kind: 'cue', priority: cuePriority })}
              >
                {cuePriority === 'urgent' && <AlertTriangle size={14} />} {label}
              </button>
            ))}
          </div>
        </section>

        <div className="source-chat-messages" aria-live="polite">
          {!communication?.messages.length && <p className="muted">Noch keine Nachrichten in dieser Direktleitung.</p>}
          {communication?.messages.map((message) => (
            <article className={`source-chat-message ${message.senderSide} ${message.priority}`} key={message.id}>
              <header>
                <strong>{message.senderName}</strong>
                <time>
                  {new Date(message.createdAt).toLocaleTimeString('de-DE', { hour: '2-digit', minute: '2-digit' })}
                </time>
              </header>
              <p>{message.body}</p>
              {message.senderSide === 'streamer' && message.editorialReadAt && (
                <small>
                  <CheckCircle2 size={12} /> gelesen
                </small>
              )}
              {message.senderSide === 'editorial' && message.streamerReadAt && (
                <small>
                  <CheckCircle2 size={12} /> beim Streamer angekommen
                </small>
              )}
            </article>
          ))}
          <div ref={endRef} />
        </div>

        {error && <p className="source-chat-error">{error}</p>}
        <form
          className="source-chat-compose"
          onSubmit={(event) => {
            event.preventDefault();
            void sendMessage();
          }}
        >
          <textarea
            autoFocus
            rows={3}
            maxLength={2000}
            value={body}
            placeholder="Nachricht an den Streamer …"
            onChange={(event) => setBody(event.target.value)}
          />
          <div>
            <select value={priority} onChange={(event) => setPriority(event.target.value as typeof priority)}>
              <option value="normal">Normal</option>
              <option value="important">Wichtig</option>
              <option value="urgent">Dringend</option>
            </select>
            <button className="primary-button" disabled={busy || !body.trim()}>
              <Send size={15} /> {busy ? 'Sendet …' : 'Senden'}
            </button>
          </div>
        </form>
      </aside>
    </div>
  );
}
