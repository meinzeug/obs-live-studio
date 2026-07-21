import React, { useEffect, useState } from 'react';
import {
  AlertTriangle,
  BarChart3,
  CheckCircle2,
  ExternalLink,
  Flame,
  Gauge,
  Heart,
  LoaderCircle,
  MessageCircle,
  RefreshCw,
  Share2,
  Sparkles,
  TrendingUp,
} from 'lucide-react';
import { api, can, type SessionUser } from '../api/client.js';
import { useStudioStatus } from '../studio-status.js';

type Growth = {
  settings: {
    enabled: boolean;
    auto_detect: boolean;
    auto_create_social_pack: boolean;
    approval_required: boolean;
    minimum_score: number;
    minimum_chat_messages: number;
    participation_overlay: boolean;
    share_url: string | null;
    share_prompt: string;
    platforms: string[];
  };
  summary: { moments_24h: number; approved: number; published: number; average_score: number; chat_signals: number };
  moments: Array<{
    id: string;
    title: string;
    hook: string;
    reason: string;
    score: number;
    chat_count: number;
    status: string;
    social_pack: Record<string, unknown>;
    created_at: string;
  }>;
};
type HostStatus = {
  runtime: { running: boolean; lastError: string | null };
  session: { video_title: string; channel_title: string } | null;
  turn: { kind: string; headline: string } | null;
  recentTurns: unknown[];
  chatConfigured: boolean;
};

export function AnalyticsPage({ user }: { user: SessionUser }) {
  const { dashboard } = useStudioStatus();
  const [growth, setGrowth] = useState<Growth | null>(null);
  const [host, setHost] = useState<HostStatus | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const allowed = can(user, 'broadcast:write');
  const canConfigure = can(user, 'users:write');
  async function load() {
    setLoading(true);
    setError('');
    try {
      const [g, h] = await Promise.all([api<Growth>('/api/growth'), api<HostStatus>('/api/ai-host/status')]);
      setGrowth(g);
      setHost(h);
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    } finally {
      setLoading(false);
    }
  }
  useEffect(() => {
    void load();
    const timer = window.setInterval(() => void load(), 20_000);
    return () => window.clearInterval(timer);
  }, []);
  async function decide(id: string, action: 'approve' | 'reject') {
    await api(`/api/growth/moments/${id}/${action}`, { method: 'POST' });
    await load();
  }
  async function saveGrowth() {
    if (!growth) return;
    setLoading(true);
    try {
      await api('/api/growth/settings', {
        method: 'PATCH',
        body: JSON.stringify({
          enabled: growth.settings.enabled,
          autoDetect: growth.settings.auto_detect,
          autoCreateSocialPack: growth.settings.auto_create_social_pack,
          approvalRequired: growth.settings.approval_required,
          minimumScore: growth.settings.minimum_score,
          minimumChatMessages: growth.settings.minimum_chat_messages,
          participationOverlay: growth.settings.participation_overlay,
          shareUrl: growth.settings.share_url || null,
          sharePrompt: growth.settings.share_prompt,
          platforms: growth.settings.platforms,
        }),
      });
      await load();
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
      setLoading(false);
    }
  }
  const frames = dashboard?.stream?.outputTotalFrames ?? 0,
    dropped = dashboard?.stream?.outputSkippedFrames ?? 0;
  const quality = frames > 0 ? Math.max(0, 100 - (dropped / frames) * 100) : 100;
  return (
    <section className="workspace-hub analytics-page">
      <header className="workspace-page-header">
        <div>
          <p className="eyebrow">Reichweite und Lernschleife</p>
          <h1>Analytics & Wachstum</h1>
          <p>Echte Resonanz erkennen, starke Momente sichern und organische Verbreitung optimieren.</p>
        </div>
        <button onClick={() => void load()} disabled={loading}>
          <RefreshCw size={17} className={loading ? 'spin' : ''} />
          Aktualisieren
        </button>
      </header>
      {error && (
        <div className="overview-notice error">
          <AlertTriangle size={16} />
          {error}
        </div>
      )}
      <div className="analytics-kpi-grid">
        <article>
          <span>
            <Gauge />
          </span>
          <div>
            <small>Streamqualität</small>
            <strong>{quality.toFixed(1)}%</strong>
            <p>{dropped.toLocaleString('de-DE')} ausgelassene Frames</p>
          </div>
        </article>
        <article>
          <span>
            <MessageCircle />
          </span>
          <div>
            <small>Chat-Signale</small>
            <strong>{growth?.summary.chat_signals ?? 0}</strong>
            <p>in erkannten Diskussionsmomenten</p>
          </div>
        </article>
        <article>
          <span>
            <Flame />
          </span>
          <div>
            <small>Highlight-Kandidaten</small>
            <strong>{growth?.summary.moments_24h ?? 0}</strong>
            <p>in den letzten 24 Stunden</p>
          </div>
        </article>
        <article>
          <span>
            <TrendingUp />
          </span>
          <div>
            <small>Viralitätsscore</small>
            <strong>{growth?.summary.average_score ?? 0}/100</strong>
            <p>Durchschnitt aller Kandidaten</p>
          </div>
        </article>
      </div>
      <div className="analytics-main-grid">
        <section className="hub-panel growth-engine-panel">
          <header>
            <div>
              <p className="eyebrow">Organischer Wachstumsloop</p>
              <h2>Viralitätsmotor</h2>
            </div>
            <span className={`integration-status ${growth?.settings.enabled ? 'good' : 'warning'}`}>
              <i />
              {growth?.settings.enabled ? 'Aktiv' : 'Aus'}
            </span>
          </header>
          <div className="growth-loop">
            <article>
              <Sparkles />
              <strong>Erkennen</strong>
              <span>Chatdynamik und pointierte Moderationen</span>
            </article>
            <i />
            <article>
              <Heart />
              <strong>Bewerten</strong>
              <span>Relevanz, Resonanz und Quellenrisiko</span>
            </article>
            <i />
            <article>
              <Share2 />
              <strong>Verteilen</strong>
              <span>Shorts, Reels und teilbare Diskussionsfragen</span>
            </article>
          </div>
          <div className="growth-engine-state">
            <span className={host?.runtime.running ? 'good-text' : 'warning-text'}>
              {host?.runtime.running ? <CheckCircle2 /> : <AlertTriangle />}
              <strong>{host?.runtime.running ? 'KI-Team beobachtet die Sendung' : 'KI-Team nicht aktiv'}</strong>
            </span>
            <p>
              {host?.session
                ? `${host.session.video_title} · ${host.session.channel_title}`
                : 'Aktuell kein interaktiver YouTube-Beitrag'}
            </p>
          </div>
          <p className="panel-intro">
            Veröffentlichungen bleiben regelkonform: Quellenhinweis und Rechteprüfung sind Pflicht; Bots, gekaufte
            Interaktionen und automatischer Spam sind ausgeschlossen.
          </p>
        </section>
        <section className="hub-panel platform-reach-panel">
          <header>
            <div>
              <p className="eyebrow">Distribution</p>
              <h2>Formatmatrix</h2>
            </div>
            <BarChart3 size={19} />
          </header>
          <div className="platform-format-list">
            {['youtube-shorts', 'instagram-reels', 'tiktok'].map((platform) => (
              <button
                key={platform}
                disabled={!canConfigure || !growth}
                className={growth?.settings.platforms.includes(platform) ? 'active' : ''}
                onClick={() =>
                  growth &&
                  setGrowth({
                    ...growth,
                    settings: {
                      ...growth.settings,
                      platforms: growth.settings.platforms.includes(platform)
                        ? growth.settings.platforms.filter((item) => item !== platform)
                        : [...growth.settings.platforms, platform],
                    },
                  })
                }
              >
                <span>{platform === 'youtube-shorts' ? 'YT' : platform === 'instagram-reels' ? 'IG' : 'TT'}</span>
                <div>
                  <strong>{platform.replace('-', ' ')}</strong>
                  <small>9:16 · Hook · Untertitel · Quellenkarte</small>
                </div>
                <i>{growth?.settings.platforms.includes(platform) ? 'Im Workflow' : 'Aus'}</i>
              </button>
            ))}
          </div>
          {growth && (
            <div className="growth-quick-settings">
              <label>
                Öffentliche Sender-/Share-URL
                <input
                  value={growth.settings.share_url ?? ''}
                  onChange={(e) =>
                    setGrowth({ ...growth, settings: { ...growth.settings, share_url: e.target.value } })
                  }
                  placeholder="https://…"
                />
              </label>
              <label>
                Share-Aufruf
                <input
                  value={growth.settings.share_prompt}
                  onChange={(e) =>
                    setGrowth({ ...growth, settings: { ...growth.settings, share_prompt: e.target.value } })
                  }
                />
              </label>
              <div className="automation-toggles">
                <label>
                  <input
                    type="checkbox"
                    checked={growth.settings.participation_overlay}
                    onChange={(e) =>
                      setGrowth({
                        ...growth,
                        settings: { ...growth.settings, participation_overlay: e.target.checked },
                      })
                    }
                  />
                  <span>
                    <strong>Share-Aufruf im Liveoverlay</strong>
                    <small>Teilbar, aber nicht aufdringlich.</small>
                  </span>
                </label>
                <label>
                  <input
                    type="checkbox"
                    checked={growth.settings.approval_required}
                    onChange={(e) =>
                      setGrowth({ ...growth, settings: { ...growth.settings, approval_required: e.target.checked } })
                    }
                  />
                  <span>
                    <strong>Rechtefreigabe verlangen</strong>
                    <small>Empfohlen für fremde Quellen.</small>
                  </span>
                </label>
              </div>
              <button className="primary-button" disabled={!canConfigure || loading} onClick={() => void saveGrowth()}>
                Wachstumsregeln speichern
              </button>
            </div>
          )}
          <a className="button" href="#/system">
            Plattform-Verbindungen verwalten <ExternalLink size={14} />
          </a>
        </section>
      </div>
      <section className="hub-panel moment-queue-panel">
        <header>
          <div>
            <p className="eyebrow">Redaktionelle Highlight-Queue</p>
            <h2>Momente mit Verbreitungspotenzial</h2>
          </div>
          <span>{growth?.moments.length ?? 0} Kandidaten</span>
        </header>
        <div className="moment-list">
          {growth?.moments.length ? (
            growth.moments.map((moment) => (
              <article key={moment.id}>
                <div className="moment-score">
                  <strong>{moment.score}</strong>
                  <small>Score</small>
                </div>
                <div>
                  <span
                    className={`state-pill ${moment.status === 'approved' ? 'success' : moment.status === 'rejected' ? 'error' : ''}`}
                  >
                    {moment.status}
                  </span>
                  <h3>{moment.title}</h3>
                  <p>{moment.hook}</p>
                  <small>
                    {moment.reason} · {moment.chat_count} Chat-Signale ·{' '}
                    {new Date(moment.created_at).toLocaleString('de-DE')}
                  </small>
                </div>
                {allowed && moment.status === 'detected' && (
                  <div className="moment-actions">
                    <button onClick={() => void decide(moment.id, 'reject')}>Verwerfen</button>
                    <button className="primary-button" onClick={() => void decide(moment.id, 'approve')}>
                      Freigeben
                    </button>
                  </div>
                )}
              </article>
            ))
          ) : (
            <div className="hub-empty">
              {loading ? <LoaderCircle className="spin" /> : <Sparkles />}
              <strong>Noch kein starker Moment erkannt</strong>
              <span>
                Der Avatar erzeugt Kandidaten, sobald mehrere sichere Chatbeiträge ein gemeinsames Thema bilden.
              </span>
            </div>
          )}
        </div>
      </section>
    </section>
  );
}
