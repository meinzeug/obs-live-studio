import React, { useEffect, useMemo, useState } from 'react';
import {
  ArrowRight,
  CalendarDays,
  CheckCircle2,
  Clock3,
  ExternalLink,
  Eye,
  Landmark,
  Menu,
  MessageCircleMore,
  Radio,
  Scale,
  ShieldCheck,
  Sparkles,
  Users,
  X,
} from 'lucide-react';

type PublicChannelSnapshot = {
  identity: {
    channelName: string;
    studioName: string;
    logoConfigured: boolean;
    logoUrl: string;
  };
  live: {
    streamActive: boolean;
    broadcastActive: boolean;
    mode: string;
    currentTitle: string;
    currentShow: string | null;
    nextTitle: string | null;
    nextAt: string | null;
  };
  links: {
    channel: string | null;
    youtube: string | null;
    twitch: string | null;
  };
  articles: Array<{
    id: string;
    title: string;
    summary: string;
    sourceName: string;
    sourceUrl: string | null;
    category: string | null;
    publishedAt: string;
  }>;
  schedule: Array<{
    id: string;
    name: string;
    description: string | null;
    scheduledAt: string;
    kind: string;
    itemCount: number;
    durationSeconds: number;
  }>;
  editorial: {
    label: string;
    mission: string;
  };
  serverTime: string;
};

const principles = [
  {
    icon: Users,
    title: 'Der Mensch vor dem Apparat',
    text: 'Individuelle Freiheit, Würde und Eigenverantwortung stehen vor Institutionen, Ideologien und Automatisierung.',
  },
  {
    icon: MessageCircleMore,
    title: 'Freie Rede, echte Debatte',
    text: 'Widerspruch ist kein Störfall. Wir wollen Argumente prüfen, Gegenpositionen sichtbar machen und niemanden bevormunden.',
  },
  {
    icon: Scale,
    title: 'Macht braucht Grenzen',
    text: 'Rechtsstaat, Gewaltenteilung, Datenschutz und kontrollierbare Entscheidungen schützen Freiheit dauerhaft.',
  },
  {
    icon: Landmark,
    title: 'Subsidiarität statt Zentralismus',
    text: 'Entscheidungen gehören so nah wie möglich zu den Menschen, die ihre Folgen tragen.',
  },
  {
    icon: Sparkles,
    title: 'Freiwillige Kooperation',
    text: 'Offene Märkte, Innovation und freie Zusammenschlüsse schaffen Raum für vielfältige Lösungen.',
  },
  {
    icon: Eye,
    title: 'Transparenz statt Verkündung',
    text: 'Quelle, Nachricht, Einordnung und Meinung werden erkennbar getrennt. Fehler werden sichtbar korrigiert.',
  },
] as const;

function formatDuration(seconds: number) {
  const totalMinutes = Math.max(0, Math.round(seconds / 60));
  const hours = Math.floor(totalMinutes / 60);
  const minutes = totalMinutes % 60;
  return hours ? `${hours} Std. ${minutes ? `${minutes} Min.` : ''}`.trim() : `${minutes} Min.`;
}

function modeLabel(mode: string) {
  if (mode === 'autopilot') return 'Automatisches Programm';
  if (mode === 'manual') return 'Redaktionelle Sendung';
  if (mode === 'live') return 'Live aus dem Studio';
  if (mode === 'breaking') return 'Sondersendung';
  return 'Sendebereit';
}

export function PublicChannelPage() {
  const [snapshot, setSnapshot] = useState<PublicChannelSnapshot | null>(null);
  const [connection, setConnection] = useState<'connecting' | 'live' | 'offline'>('connecting');
  const [error, setError] = useState('');
  const [menuOpen, setMenuOpen] = useState(false);

  useEffect(() => {
    let stopped = false;
    let source: EventSource | null = null;
    const load = async () => {
      try {
        const response = await fetch('/api/public/channel', { credentials: 'same-origin', cache: 'no-store' });
        if (!response.ok) throw new Error('Die Senderdaten sind vorübergehend nicht erreichbar.');
        const next = (await response.json()) as PublicChannelSnapshot;
        if (!stopped) {
          setSnapshot(next);
          setError('');
        }
      } catch (requestError) {
        if (!stopped) setError(requestError instanceof Error ? requestError.message : String(requestError));
      }
    };
    const connect = () => {
      source?.close();
      source = new EventSource('/api/public/channel/events');
      source.onopen = () => {
        if (!stopped) setConnection('live');
      };
      source.addEventListener('channel-snapshot', (event) => {
        if (stopped) return;
        try {
          setSnapshot(JSON.parse((event as MessageEvent).data) as PublicChannelSnapshot);
          setConnection('live');
          setError('');
        } catch {
          setError('Die Live-Daten werden neu verbunden.');
        }
      });
      source.addEventListener('channel-error', () => {
        if (!stopped) setConnection('connecting');
      });
      source.onerror = () => {
        if (stopped) return;
        setConnection(navigator.onLine ? 'connecting' : 'offline');
      };
    };
    void load();
    connect();
    const online = () => connect();
    const offline = () => setConnection('offline');
    window.addEventListener('online', online);
    window.addEventListener('offline', offline);
    return () => {
      stopped = true;
      source?.close();
      window.removeEventListener('online', online);
      window.removeEventListener('offline', offline);
    };
  }, []);

  const primaryLiveLink = snapshot?.links.channel ?? snapshot?.links.youtube ?? snapshot?.links.twitch;
  const featured = snapshot?.articles[0] ?? null;
  const remainingArticles = snapshot?.articles.slice(1) ?? [];
  const nextShow = snapshot?.schedule[0] ?? null;
  const currentTime = useMemo(
    () =>
      new Date(snapshot?.serverTime ?? Date.now()).toLocaleTimeString('de-DE', {
        hour: '2-digit',
        minute: '2-digit',
      }),
    [snapshot?.serverTime],
  );

  return (
    <div className="public-channel">
      <header className="public-channel-header">
        <a className="public-channel-brand" href="#top" aria-label="Zur Startseite">
          {snapshot?.identity.logoConfigured ? <img src={snapshot.identity.logoUrl} alt="" /> : <span>ZK</span>}
          <div>
            <strong>{snapshot?.identity.channelName ?? 'Zeitkante'}</strong>
            <small>Freiheit braucht Öffentlichkeit</small>
          </div>
        </a>
        <button
          className="public-mobile-menu"
          type="button"
          aria-label={menuOpen ? 'Navigation schließen' : 'Navigation öffnen'}
          aria-expanded={menuOpen}
          onClick={() => setMenuOpen((open) => !open)}
        >
          {menuOpen ? <X /> : <Menu />}
        </button>
        <nav className={menuOpen ? 'is-open' : ''} aria-label="Hauptnavigation">
          <a href="#live" onClick={() => setMenuOpen(false)}>
            Live
          </a>
          <a href="#aktuell" onClick={() => setMenuOpen(false)}>
            Aktuell
          </a>
          <a href="#programm" onClick={() => setMenuOpen(false)}>
            Programm
          </a>
          <a href="#haltung" onClick={() => setMenuOpen(false)}>
            Unsere Haltung
          </a>
          <a href="#transparenz" onClick={() => setMenuOpen(false)}>
            Transparenz
          </a>
        </nav>
        <a className="public-studio-login" href="/#/overview">
          Studio-Login
        </a>
      </header>

      <main id="top">
        <section className="public-hero">
          <div className="public-hero-copy">
            <p className="public-kicker">{snapshot?.editorial.label ?? 'Freiheitlich · unabhängig · transparent'}</p>
            <h1>
              Nachrichten für Menschen, die <em>selbst denken.</em>
            </h1>
            <p className="public-hero-lead">
              {snapshot?.editorial.mission ??
                'Zeitkante betrachtet Politik und Gesellschaft aus einer freiheitlichen Perspektive – offen für Widerspruch und nachvollziehbar in den Quellen.'}
            </p>
            <div className="public-hero-actions">
              <a className="public-button primary" href="#live">
                <Radio size={18} /> Jetzt einschalten
              </a>
              <a className="public-button" href="#haltung">
                Wofür wir stehen <ArrowRight size={17} />
              </a>
            </div>
            <div className="public-trust-line">
              <span>
                <CheckCircle2 size={15} /> Quellen sichtbar
              </span>
              <span>
                <CheckCircle2 size={15} /> Meinung gekennzeichnet
              </span>
              <span>
                <CheckCircle2 size={15} /> KI transparent eingesetzt
              </span>
            </div>
          </div>
          <div className="public-hero-visual" aria-label="Zeitkante Live-Status">
            <span className="public-hero-grid" />
            <div className="public-signal-orbit one" />
            <div className="public-signal-orbit two" />
            {snapshot?.identity.logoConfigured && <img src={snapshot.identity.logoUrl} alt="" />}
            <div className={`public-on-air ${snapshot?.live.streamActive ? 'active' : ''}`}>
              <i />
              {snapshot?.live.streamActive ? 'ON AIR' : 'SENDEBEREIT'}
            </div>
            <div className="public-hero-now">
              <small>{modeLabel(snapshot?.live.mode ?? 'standby')}</small>
              <strong>{snapshot?.live.currentShow ?? snapshot?.live.currentTitle ?? 'Zeitkante'}</strong>
              <span>{snapshot?.live.currentShow ? snapshot.live.currentTitle : 'Das Programm wird vorbereitet.'}</span>
            </div>
            <time>{currentTime}</time>
          </div>
        </section>

        <section className="public-live-section" id="live">
          <div className="public-section-heading">
            <div>
              <p className="public-kicker">24/7 Online-TV</p>
              <h2>Gerade bei Zeitkante</h2>
            </div>
            <span className={`public-live-connection ${connection}`}>
              <i />
              {connection === 'live' ? 'Live verbunden' : connection === 'offline' ? 'Offline' : 'Verbindet'}
            </span>
          </div>
          <div className="public-live-card">
            <div className="public-live-stage">
              <span className="public-live-beam" />
              <Radio size={56} />
              <small>{modeLabel(snapshot?.live.mode ?? 'standby')}</small>
              <h3>{snapshot?.live.currentTitle ?? 'Das nächste Programm wird vorbereitet'}</h3>
              {primaryLiveLink ? (
                <a href={primaryLiveLink} target="_blank" rel="noreferrer">
                  Livestream öffnen <ExternalLink size={16} />
                </a>
              ) : (
                <span className="public-live-ready">
                  {snapshot?.live.streamActive
                    ? 'Der Stream wird gerade ausgespielt.'
                    : 'Nächster Sendestart laut Programm.'}
                </span>
              )}
            </div>
            <aside>
              <p className="public-kicker">Als Nächstes</p>
              <time>
                {snapshot?.live.nextAt
                  ? new Date(snapshot.live.nextAt).toLocaleTimeString('de-DE', {
                      hour: '2-digit',
                      minute: '2-digit',
                    })
                  : nextShow
                    ? new Date(nextShow.scheduledAt).toLocaleTimeString('de-DE', {
                        hour: '2-digit',
                        minute: '2-digit',
                      })
                    : '--:--'}
              </time>
              <h3>{snapshot?.live.nextTitle ?? nextShow?.name ?? 'Programm folgt'}</h3>
              <p>
                {nextShow
                  ? `${nextShow.itemCount} Beiträge · ${formatDuration(nextShow.durationSeconds)}`
                  : 'Der nächste Programmblock wird gerade vorbereitet.'}
              </p>
              <a href="#programm">
                Zum Sendeplan <ArrowRight size={15} />
              </a>
            </aside>
          </div>
          {error && <p className="public-data-notice">{error}</p>}
        </section>

        <section className="public-news-section" id="aktuell">
          <div className="public-section-heading">
            <div>
              <p className="public-kicker">Redaktion</p>
              <h2>Aktuell eingeordnet</h2>
            </div>
            <p>Nachrichten, Hintergründe und Originalquellen – ohne künstliche Empörung.</p>
          </div>
          {featured && (
            <article className="public-featured-story">
              <div className="public-featured-art">
                <span>{featured.category ?? 'Aktuell'}</span>
                <strong>{new Date(featured.publishedAt).getDate().toString().padStart(2, '0')}</strong>
                <small>
                  {new Date(featured.publishedAt).toLocaleDateString('de-DE', { month: 'short', year: 'numeric' })}
                </small>
              </div>
              <div>
                <p className="public-story-meta">
                  {featured.category ?? 'Nachrichten'} · {featured.sourceName}
                </p>
                <h3>{featured.title}</h3>
                <p>{featured.summary}</p>
                {featured.sourceUrl && (
                  <a href={featured.sourceUrl} target="_blank" rel="noreferrer">
                    Originalquelle lesen <ExternalLink size={15} />
                  </a>
                )}
              </div>
            </article>
          )}
          <div className="public-story-grid">
            {remainingArticles.map((article) => (
              <article key={article.id}>
                <p className="public-story-meta">
                  {article.category ?? 'Aktuell'} ·{' '}
                  {new Date(article.publishedAt).toLocaleDateString('de-DE', {
                    day: '2-digit',
                    month: '2-digit',
                    year: '2-digit',
                  })}
                </p>
                <h3>{article.title}</h3>
                <p>{article.summary}</p>
                <footer>
                  <span>{article.sourceName}</span>
                  {article.sourceUrl && (
                    <a href={article.sourceUrl} target="_blank" rel="noreferrer" aria-label="Originalquelle öffnen">
                      <ExternalLink size={15} />
                    </a>
                  )}
                </footer>
              </article>
            ))}
          </div>
          {!snapshot?.articles.length && <div className="public-empty">Neue Beiträge werden gerade vorbereitet.</div>}
        </section>

        <section className="public-principles-section" id="haltung">
          <div className="public-principles-intro">
            <p className="public-kicker">Unsere Haltung</p>
            <h2>Freiheit ist kein Zuschauerplatz.</h2>
            <p>
              Zeitkante berichtet mit erkennbarer freiheitlicher Perspektive. Das ist keine Behauptung von Neutralität,
              sondern ein offenes redaktionelles Versprechen: Wir legen Maßstäbe offen, zeigen Quellen und lassen
              Gegenargumente zu.
            </p>
          </div>
          <div className="public-principles-grid">
            {principles.map(({ icon: Icon, title, text }, index) => (
              <article key={title}>
                <span>{String(index + 1).padStart(2, '0')}</span>
                <Icon size={23} />
                <h3>{title}</h3>
                <p>{text}</p>
              </article>
            ))}
          </div>
        </section>

        <section className="public-schedule-section" id="programm">
          <div className="public-section-heading">
            <div>
              <p className="public-kicker">Sendeplan</p>
              <h2>Was als Nächstes läuft</h2>
            </div>
            <CalendarDays size={29} />
          </div>
          <div className="public-schedule-list">
            {(snapshot?.schedule ?? []).map((show, index) => (
              <article className={index === 0 ? 'is-next' : ''} key={show.id}>
                <time>
                  <strong>
                    {new Date(show.scheduledAt).toLocaleTimeString('de-DE', {
                      hour: '2-digit',
                      minute: '2-digit',
                    })}
                  </strong>
                  <small>
                    {new Date(show.scheduledAt).toLocaleDateString('de-DE', {
                      weekday: 'short',
                      day: '2-digit',
                      month: '2-digit',
                    })}
                  </small>
                </time>
                <span className="public-schedule-rail">
                  <i />
                </span>
                <div>
                  <strong>{show.name}</strong>
                  <p>{show.description || 'Einordnung, Quellen und Publikumsfragen im laufenden Programm.'}</p>
                </div>
                <span>
                  <Clock3 size={14} /> {formatDuration(show.durationSeconds)}
                </span>
              </article>
            ))}
          </div>
          {!snapshot?.schedule.length && <div className="public-empty">Der nächste Sendetag wird gerade geplant.</div>}
        </section>

        <section className="public-transparency-section" id="transparenz">
          <div>
            <p className="public-kicker">Redaktionelles Versprechen</p>
            <h2>Haltung zeigen. Fakten prüfen. Widerspruch aushalten.</h2>
          </div>
          <div className="public-transparency-cards">
            <article>
              <ShieldCheck />
              <strong>Quellen vor Behauptungen</strong>
              <p>Wo immer möglich, verlinken wir die Originalquelle statt nur über sie zu sprechen.</p>
            </article>
            <article>
              <Eye />
              <strong>KI bleibt erkennbar</strong>
              <p>Automatisierte Moderation und Einordnung ersetzen keine menschliche Verantwortung.</p>
            </article>
            <article>
              <MessageCircleMore />
              <strong>Publikum als Gegenüber</strong>
              <p>Fragen und Einwände aus dem Chat sind Teil der Sendung – nicht nur Dekoration.</p>
            </article>
          </div>
        </section>
      </main>

      <footer className="public-channel-footer">
        <a className="public-channel-brand" href="#top">
          {snapshot?.identity.logoConfigured ? <img src={snapshot.identity.logoUrl} alt="" /> : <span>ZK</span>}
          <div>
            <strong>{snapshot?.identity.channelName ?? 'Zeitkante'}</strong>
            <small>{snapshot?.identity.studioName ?? 'Open TV Studio'}</small>
          </div>
        </a>
        <p>
          Ein freiheitlicher Online-TV-Sender mit transparentem KI-Einsatz, sichtbaren Quellen und menschlicher
          Letztverantwortung.
        </p>
        <nav>
          <a href="#aktuell">Aktuell</a>
          <a href="#programm">Programm</a>
          <a href="#haltung">Haltung</a>
          <a href="/#/overview">Studio</a>
        </nav>
      </footer>
    </div>
  );
}
