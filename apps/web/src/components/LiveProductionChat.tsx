import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import {
  AlertTriangle,
  CheckCircle2,
  MessageSquareText,
  Radio,
  RefreshCw,
  Send,
  UserPlus,
  Users,
  Wifi,
  WifiOff,
} from 'lucide-react';
import { api, type SessionUser } from '../api/client.js';

type ProductionParticipant = {
  id: string;
  name: string;
  user: string | null;
  status: 'live' | 'connecting' | 'offline' | 'error';
  network: 'good' | 'unstable' | 'poor' | 'offline' | null;
  resolution: string | null;
  control: {
    tally: 'offline' | 'standby' | 'preview' | 'program';
    muted: boolean;
    instruction: string | null;
  } | null;
  unread: { streamer: number; editorial: number };
  available: boolean;
  error: string | null;
};

type ProductionMessage = {
  id: string;
  sourceId: string;
  sourceName: string;
  sourceUser: string | null;
  senderSide: 'streamer' | 'editorial' | 'system';
  senderName: string;
  kind: 'chat' | 'cue' | 'status';
  priority: 'normal' | 'important' | 'urgent';
  body: string;
  createdAt: string;
};

type ProductionChat = {
  participants: ProductionParticipant[];
  messages: ProductionMessage[];
  unreadEditorial: number;
  serverTime: string;
};

const quickCues = [
  ['Noch 30 Sekunden', 'Noch 30 Sekunden bis zur Zuschaltung. Bitte bereit halten.', 'important'],
  ['Jetzt live', 'Du bist jetzt live im Programm.', 'urgent'],
  ['Bitte abschließen', 'Bitte den Gedanken kurz abschließen.', 'important'],
  ['Technik halten', 'Bitte Position halten, die Technik prüft gerade das Signal.', 'urgent'],
] as const;

export function LiveProductionChat({
  user,
  onOpenPrivate,
  onInvite,
}: {
  user: SessionUser;
  onOpenPrivate: (sourceId: string) => void;
  onInvite: () => void;
}) {
  const [data, setData] = useState<ProductionChat | null>(null);
  const [target, setTarget] = useState<'all' | string>('all');
  const [body, setBody] = useState('');
  const [priority, setPriority] = useState<'normal' | 'important' | 'urgent'>('normal');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const inFlight = useRef(false);
  const endRef = useRef<HTMLDivElement>(null);

  const load = useCallback(async () => {
    if (inFlight.current) return;
    inFlight.current = true;
    try {
      const next = await api<ProductionChat>('/api/live/communications');
      setData(next);
      setError('');
      if (next.unreadEditorial > 0) {
        await api('/api/live/messages/read', { method: 'POST', body: JSON.stringify({}) });
      }
    } catch (requestError) {
      setError(requestError instanceof Error ? requestError.message : String(requestError));
    } finally {
      inFlight.current = false;
    }
  }, []);

  useEffect(() => {
    void load();
    const timer = window.setInterval(() => void load(), 3_000);
    return () => window.clearInterval(timer);
  }, [load]);

  const shownMessages = useMemo(
    () =>
      target === 'all'
        ? (data?.messages ?? [])
        : (data?.messages ?? []).filter((message) => message.sourceId === target),
    [data?.messages, target],
  );

  useEffect(() => {
    endRef.current?.scrollIntoView({ behavior: 'smooth' });
  }, [shownMessages.length]);

  async function sendMessage(
    text = body,
    options: { kind?: 'chat' | 'cue'; priority?: 'normal' | 'important' | 'urgent' } = {},
  ) {
    if (!text.trim() || busy) return;
    setBusy(true);
    setError('');
    try {
      await api('/api/live/messages', {
        method: 'POST',
        body: JSON.stringify({
          sourceIds: target === 'all' ? undefined : [target],
          body: text.trim(),
          kind: options.kind ?? 'chat',
          priority: options.priority ?? priority,
        }),
      });
      setBody('');
      setPriority('normal');
      await load();
    } catch (requestError) {
      setError(requestError instanceof Error ? requestError.message : String(requestError));
    } finally {
      setBusy(false);
    }
  }

  const online = data?.participants.filter((participant) => participant.status === 'live').length ?? 0;
  const selected = target === 'all' ? null : data?.participants.find((participant) => participant.id === target);

  return (
    <section className="live-production-chat">
      <header className="live-section-heading">
        <div>
          <p className="eyebrow">Produktionsleitung & Außenstudio</p>
          <h2>
            <MessageSquareText size={21} /> Zentraler Produktionschat
          </h2>
        </div>
        <div className="live-production-chat-actions">
          <span className={online > 0 ? 'is-live' : ''}>
            <Radio size={14} /> {online} live · {data?.participants.length ?? 0} angemeldet
          </span>
          <button onClick={() => void load()} disabled={busy} title="Chat aktualisieren">
            <RefreshCw size={15} /> Aktualisieren
          </button>
          <button className="primary-button" onClick={onInvite}>
            <UserPlus size={15} /> Außenmitarbeiter einladen
          </button>
        </div>
      </header>

      <div className="live-production-chat-grid">
        <aside className="live-production-participants">
          <button className={target === 'all' ? 'active' : ''} onClick={() => setTarget('all')}>
            <span className="live-production-avatar">
              <Users size={17} />
            </span>
            <span>
              <strong>Alle Außenstudios</strong>
              <small>Gemeinsame Regieleitung</small>
            </span>
            <em>{data?.participants.reduce((sum, entry) => sum + entry.unread.editorial, 0) || ''}</em>
          </button>
          {(data?.participants ?? []).map((participant) => (
            <button
              className={target === participant.id ? 'active' : ''}
              key={participant.id}
              onClick={() => setTarget(participant.id)}
            >
              <span className={`live-production-avatar ${participant.status}`}>
                {participant.network === 'offline' ? <WifiOff size={16} /> : <Wifi size={16} />}
              </span>
              <span>
                <strong>{participant.name}</strong>
                <small>
                  {participant.user || 'Außenmitarbeiter'} · {participant.control?.tally || participant.status}
                </small>
              </span>
              <em>{participant.unread.editorial || ''}</em>
            </button>
          ))}
          {!data?.participants.length && (
            <div className="live-production-empty">
              <WifiOff size={24} />
              <strong>Noch niemand zugeschaltet</strong>
              <span>Erstelle eine sichere Einladung für das nächste Außenstudio.</span>
            </div>
          )}
        </aside>

        <div className="live-production-conversation">
          <header>
            <div>
              <strong>{selected?.name ?? 'Gemeinsame Produktionsleitung'}</strong>
              <span>
                {selected
                  ? `${selected.user || 'Außenmitarbeiter'} · ${selected.resolution || 'Signal wird geprüft'}`
                  : 'Nachrichten an alle senden oder alle Direktleitungen gemeinsam verfolgen'}
              </span>
            </div>
            {selected && (
              <button onClick={() => onOpenPrivate(selected.id)}>
                <MessageSquareText size={15} /> Direktleitung öffnen
              </button>
            )}
          </header>

          <div className="live-production-messages" aria-live="polite">
            {!shownMessages.length && <p>Noch keine Produktionsnachrichten in diesem Kanal.</p>}
            {shownMessages.map((message) => (
              <article
                className={`${message.senderSide} ${message.priority}`}
                key={`${message.sourceId}-${message.id}`}
              >
                <header>
                  <strong>{message.senderName}</strong>
                  <span>{message.sourceName}</span>
                  <time>
                    {new Date(message.createdAt).toLocaleTimeString('de-DE', { hour: '2-digit', minute: '2-digit' })}
                  </time>
                </header>
                <p>{message.body}</p>
                {message.kind === 'cue' && <small>REGIE-CUE</small>}
              </article>
            ))}
            <div ref={endRef} />
          </div>

          <div className="live-production-quick-cues">
            {quickCues.map(([label, text, cuePriority]) => (
              <button
                className={cuePriority === 'urgent' ? 'urgent' : ''}
                disabled={busy || !data?.participants.length}
                key={label}
                onClick={() => void sendMessage(text, { kind: 'cue', priority: cuePriority })}
              >
                {cuePriority === 'urgent' && <AlertTriangle size={13} />} {label}
              </button>
            ))}
          </div>

          {error && (
            <div className="live-production-chat-error">
              <AlertTriangle size={15} /> {error}
            </div>
          )}
          <form
            className="live-production-compose"
            onSubmit={(event) => {
              event.preventDefault();
              void sendMessage();
            }}
          >
            <label>
              <span>
                Nachricht von {user.display_name} an {selected?.name ?? 'alle Außenstudios'}
              </span>
              <textarea
                rows={3}
                maxLength={2000}
                value={body}
                onChange={(event) => setBody(event.target.value)}
                placeholder={
                  selected ? `Private Produktionsnachricht an ${selected.name} …` : 'Nachricht an das ganze Live-Team …'
                }
              />
            </label>
            <div>
              <select value={priority} onChange={(event) => setPriority(event.target.value as typeof priority)}>
                <option value="normal">Normal</option>
                <option value="important">Wichtig</option>
                <option value="urgent">Dringend</option>
              </select>
              <span>
                <CheckCircle2 size={14} /> Serverintern und geschützt
              </span>
              <button className="primary-button" disabled={busy || !body.trim() || !data?.participants.length}>
                <Send size={15} /> {busy ? 'Sendet …' : target === 'all' ? 'An alle senden' : 'Privat senden'}
              </button>
            </div>
          </form>
        </div>
      </div>
    </section>
  );
}
