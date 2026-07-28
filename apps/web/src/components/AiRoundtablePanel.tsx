import React, { useEffect, useMemo, useState } from 'react';
import {
  CheckCircle2,
  LoaderCircle,
  MessageCircle,
  Pause,
  Play,
  RadioTower,
  RefreshCw,
  Save,
  SkipForward,
  Square,
  UsersRound,
} from 'lucide-react';
import { api } from '../api/client.js';

type Participant = {
  id: string;
  display_name: string;
  job_title: string;
  accent_color: string;
  idleVideoUrl: string | null;
  speakingVideoUrl: string | null;
};
type RoundtableState = {
  settings: {
    status: 'standby' | 'preparing' | 'live' | 'paused' | 'ended' | 'error';
    preset: 'studio-rundtisch' | 'fakten-duell' | 'publikumsforum';
    topic: string;
    moderator_id: string;
    participant_ids: string[];
    current_speaker_id: string | null;
    current_turn_index: number;
    turn_duration_seconds: number;
    max_rounds: number;
    chat_enabled: boolean;
    fact_check_enabled: boolean;
    audience_prompt: string;
    introduction_complete: boolean;
    production_settings: {
      introductionsEnabled?: boolean;
      showAllParticipants?: boolean;
      autoDiscussVideos?: boolean;
      videoLayout?: 'video-left' | 'panel-grid';
      fallbackMode?: 'local-editorial';
      minimumParticipants?: number;
      humorLevel?: 'off' | 'subtle' | 'lively';
      banterEnabled?: boolean;
      duckYoutubeAudio?: boolean;
      youtubeDuckVolume?: number;
    };
    video_context?: { title?: string; channel?: string };
  };
  design: { title: string; kicker: string; accent: string };
  participants: Participant[];
  availableParticipants: Participant[];
  turn: {
    id: string;
    speaker_id: string;
    display_name: string;
    round_number: number;
    headline: string;
    text: string;
    tier: 'free' | 'paid' | 'codex' | 'local' | null;
  } | null;
  audience: Array<{ provider: string; author_name: string; message: string }>;
  runtime: { running: boolean; busy: boolean; lastError: string | null };
};

const presetDescriptions = {
  'studio-rundtisch': 'Ausgewogene Runde mit Eröffnung, Positionen, Gegenfragen und Fazit.',
  'fakten-duell': 'Kontroverse Aussagen werden sichtbar in Behauptung, Beleg und offenen Punkt getrennt.',
  publikumsforum: 'YouTube- und Twitch-Impulse bestimmen die Agenda der virtuellen Zuschauerarena.',
} as const;

export function AiRoundtablePanel() {
  const [state, setState] = useState<RoundtableState>();
  const [draft, setDraft] = useState<RoundtableState['settings']>();
  const [working, setWorking] = useState('');
  const [message, setMessage] = useState('');
  const [error, setError] = useState('');

  async function load(keepDraft = true) {
    try {
      const next = await api<RoundtableState>('/api/ai-roundtable');
      setState(next);
      if (!keepDraft || !draft) setDraft(next.settings);
      setError('');
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : String(cause));
    }
  }

  useEffect(() => {
    void load(false);
    const timer = window.setInterval(() => void load(true), 3_000);
    return () => window.clearInterval(timer);
  }, []);

  const selectedParticipants = useMemo(() => new Set(draft?.participant_ids ?? []), [draft?.participant_ids]);

  async function save() {
    if (!draft) return;
    setWorking('save');
    setError('');
    try {
      const next = await api<RoundtableState>('/api/ai-roundtable', {
        method: 'PATCH',
        body: JSON.stringify({
          preset: draft.preset,
          topic: draft.topic,
          moderatorId: draft.moderator_id,
          participantIds: draft.participant_ids,
          turnDurationSeconds: draft.turn_duration_seconds,
          maxRounds: draft.max_rounds,
          chatEnabled: draft.chat_enabled,
          factCheckEnabled: draft.fact_check_enabled,
          audiencePrompt: draft.audience_prompt,
          productionSettings: draft.production_settings,
        }),
      });
      setState(next);
      setDraft(next.settings);
      setMessage('Rundenregie gespeichert.');
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : String(cause));
    } finally {
      setWorking('');
    }
  }

  async function start(takeProgram: boolean) {
    if (!draft) return;
    setWorking(takeProgram ? 'start-program' : 'start-preview');
    setError('');
    try {
      const next = await api<RoundtableState>('/api/ai-roundtable/start', {
        method: 'POST',
        body: JSON.stringify({
          preset: draft.preset,
          topic: draft.topic,
          moderatorId: draft.moderator_id,
          participantIds: draft.participant_ids,
          turnDurationSeconds: draft.turn_duration_seconds,
          maxRounds: draft.max_rounds,
          chatEnabled: draft.chat_enabled,
          factCheckEnabled: draft.fact_check_enabled,
          audiencePrompt: draft.audience_prompt,
          productionSettings: draft.production_settings,
          takeProgram,
        }),
      });
      setState(next);
      setDraft(next.settings);
      setMessage(takeProgram ? 'KI-Runde ist im OBS-Programm.' : 'KI-Runde läuft in der Vorschau.');
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : String(cause));
    } finally {
      setWorking('');
    }
  }

  async function control(action: 'pause' | 'resume' | 'next' | 'stop' | 'take') {
    setWorking(action);
    setError('');
    try {
      const next = await api<RoundtableState>(`/api/ai-roundtable/${action}`, { method: 'POST' });
      setState(next);
      setDraft((current) => (current ? { ...current, ...next.settings } : next.settings));
      setMessage(
        action === 'take'
          ? 'KI-Runde ins Programm übernommen.'
          : action === 'next'
            ? 'Nächste Wortmeldung angefordert.'
            : 'Rundenstatus aktualisiert.',
      );
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : String(cause));
    } finally {
      setWorking('');
    }
  }

  function toggleParticipant(id: string) {
    if (!draft) return;
    const ids = selectedParticipants.has(id)
      ? draft.participant_ids.filter((participantId) => participantId !== id)
      : [...draft.participant_ids, id].slice(0, 6);
    if (ids.length < 2) return;
    setDraft({
      ...draft,
      participant_ids: ids,
      moderator_id: ids.includes(draft.moderator_id) ? draft.moderator_id : ids[0]!,
    });
  }

  return (
    <section className="hub-panel ai-roundtable-panel" style={{ '--roundtable-accent': state?.design.accent } as React.CSSProperties}>
      <header className="ai-roundtable-header">
        <div>
          <p className="eyebrow">Virtuelle Live-Produktion</p>
          <h2>
            <UsersRound size={24} /> KI-Diskussionsrunden
          </h2>
          <p>Sechs On-Air-Agenten diskutieren, prüfen und beziehen echte Chatbeiträge als Publikum ein.</p>
        </div>
        <div className={`roundtable-live-state ${state?.settings.status ?? 'standby'}`}>
          <i />
          {state?.settings.status === 'live'
            ? 'Runde live'
            : state?.settings.status === 'paused'
              ? 'Runde pausiert'
              : 'Bereit'}
        </div>
      </header>

      {message && (
        <div className="inline-success">
          <CheckCircle2 size={16} /> {message}
        </div>
      )}
      {error && (
        <div className="inline-error">
          {error}{' '}
          <button onClick={() => void load(false)}>
            <RefreshCw size={14} /> Neu laden
          </button>
        </div>
      )}

      {draft && state && (
        <div className="ai-roundtable-layout">
          <div className="roundtable-setup">
            <div className="roundtable-presets">
              {(Object.keys(presetDescriptions) as Array<keyof typeof presetDescriptions>).map((preset) => (
                <button
                  type="button"
                  key={preset}
                  className={draft.preset === preset ? 'selected' : ''}
                  onClick={() => setDraft({ ...draft, preset })}
                >
                  <strong>
                    {preset === 'studio-rundtisch'
                      ? 'KI Studio Runde'
                      : preset === 'fakten-duell'
                        ? 'Fakten-Duell'
                        : 'Publikumsforum'}
                  </strong>
                  <small>{presetDescriptions[preset]}</small>
                </button>
              ))}
            </div>

            <label className="roundtable-topic">
              <span>Heutiges Diskussionsthema</span>
              <textarea
                rows={3}
                value={draft.topic}
                onChange={(event) => setDraft({ ...draft, topic: event.target.value })}
              />
            </label>

            <div className="roundtable-participants">
              {state.availableParticipants.map((participant) => (
                <button
                  type="button"
                  key={participant.id}
                  className={selectedParticipants.has(participant.id) ? 'selected' : ''}
                  style={{ '--person-accent': participant.accent_color } as React.CSSProperties}
                  onClick={() => toggleParticipant(participant.id)}
                >
                  <span>{participant.display_name.slice(0, 1)}</span>
                  <div>
                    <strong>{participant.display_name}</strong>
                    <small>{participant.job_title}</small>
                    <em>
                      {participant.idleVideoUrl && participant.speakingVideoUrl
                        ? 'Avatar komplett'
                        : 'MP4 kann nachgeliefert werden'}
                    </em>
                  </div>
                </button>
              ))}
            </div>

            <div className="roundtable-options">
              <label>
                Gesprächsleitung
                <select
                  value={draft.moderator_id}
                  onChange={(event) => setDraft({ ...draft, moderator_id: event.target.value })}
                >
                  {state.availableParticipants
                    .filter((participant) => selectedParticipants.has(participant.id))
                    .map((participant) => (
                      <option value={participant.id} key={participant.id}>
                        {participant.display_name}
                      </option>
                    ))}
                </select>
              </label>
              <label>
                Runden
                <select
                  value={draft.max_rounds}
                  onChange={(event) => setDraft({ ...draft, max_rounds: Number(event.target.value) })}
                >
                  {[1, 2, 3, 4, 5, 6].map((round) => (
                    <option value={round} key={round}>
                      {round}
                    </option>
                  ))}
                </select>
              </label>
              <label>
                Mindestlänge je Wortmeldung
                <select
                  value={draft.turn_duration_seconds}
                  onChange={(event) => setDraft({ ...draft, turn_duration_seconds: Number(event.target.value) })}
                >
                  {[20, 30, 35, 45, 60, 90].map((seconds) => (
                    <option value={seconds} key={seconds}>
                      {seconds} Sekunden
                    </option>
                  ))}
                </select>
              </label>
            </div>
            <div className="roundtable-toggles">
              <label>
                <input
                  type="checkbox"
                  checked={draft.chat_enabled}
                  onChange={(event) => setDraft({ ...draft, chat_enabled: event.target.checked })}
                />
                <span>
                  <strong>YouTube + Twitch als Studiopublikum</strong>
                  <small>Sam clustert echte Beiträge; die Runde greift sie mit Namen auf.</small>
                </span>
              </label>
              <label>
                <input
                  type="checkbox"
                  checked={draft.fact_check_enabled}
                  onChange={(event) => setDraft({ ...draft, fact_check_enabled: event.target.checked })}
                />
                <span>
                  <strong>Faktenprüfer in die Dramaturgie einbauen</strong>
                  <small>Beleg, Interpretation und offene Punkte bleiben sichtbar getrennt.</small>
                </span>
              </label>
              <label>
                <input
                  type="checkbox"
                  checked={draft.production_settings?.introductionsEnabled !== false}
                  onChange={(event) =>
                    setDraft({
                      ...draft,
                      production_settings: {
                        ...(draft.production_settings ?? {}),
                        introductionsEnabled: event.target.checked,
                      },
                    })
                  }
                />
                <span>
                  <strong>Vorstellungsrunde vor dem ersten Video</strong>
                  <small>Alle sechs Personen stellen Rolle und Blickwinkel vor; das Video wartet dabei am ersten Bild.</small>
                </span>
              </label>
              <label>
                <input
                  type="checkbox"
                  checked={draft.production_settings?.autoDiscussVideos !== false}
                  onChange={(event) =>
                    setDraft({
                      ...draft,
                      production_settings: {
                        ...(draft.production_settings ?? {}),
                        autoDiscussVideos: event.target.checked,
                      },
                    })
                  }
                />
                <span>
                  <strong>Videos automatisch gemeinsam einordnen</strong>
                  <small>Die Regie verteilt Transkript, Quellenkarten und Chatimpulse auf die sechs Rollen.</small>
                </span>
              </label>
            </div>
            <div className="roundtable-options">
              <label>
                Studiolayout
                <select
                  value={draft.production_settings?.videoLayout ?? 'video-left'}
                  onChange={(event) =>
                    setDraft({
                      ...draft,
                      production_settings: {
                        ...(draft.production_settings ?? {}),
                        videoLayout: event.target.value as 'video-left' | 'panel-grid',
                      },
                    })
                  }
                >
                  <option value="video-left">Video groß links · sechs Hosts rechts</option>
                  <option value="panel-grid">Sechs Hosts im Studiogitter</option>
                </select>
              </label>
              <label>
                KI-Ausfallbetrieb
                <select value="local-editorial" disabled>
                  <option value="local-editorial">Lokale Redaktionsregie · Sendung läuft weiter</option>
                </select>
              </label>
              <label>
                Humor und Schlagabtausch
                <select
                  value={draft.production_settings?.humorLevel ?? 'lively'}
                  onChange={(event) =>
                    setDraft({
                      ...draft,
                      production_settings: {
                        ...(draft.production_settings ?? {}),
                        humorLevel: event.target.value as 'off' | 'subtle' | 'lively',
                      },
                    })
                  }
                >
                  <option value="off">Sachlich · ohne Pointen</option>
                  <option value="subtle">Subtil · gelegentlich trocken</option>
                  <option value="lively">Lebendig · kurze passende Pointen</option>
                </select>
              </label>
              <label>
                YouTube-Pegel während Wortmeldungen
                <select
                  value={draft.production_settings?.youtubeDuckVolume ?? 0.22}
                  disabled={draft.production_settings?.duckYoutubeAudio === false}
                  onChange={(event) =>
                    setDraft({
                      ...draft,
                      production_settings: {
                        ...(draft.production_settings ?? {}),
                        youtubeDuckVolume: Number(event.target.value),
                      },
                    })
                  }
                >
                  <option value={0.12}>Sehr leise · 12 %</option>
                  <option value={0.22}>Leise · 22 %</option>
                  <option value={0.35}>Hintergrund · 35 %</option>
                  <option value={0.5}>Halbe Lautstärke · 50 %</option>
                </select>
              </label>
            </div>
            <div className="roundtable-toggles">
              <label>
                <input
                  type="checkbox"
                  checked={draft.production_settings?.banterEnabled !== false}
                  onChange={(event) =>
                    setDraft({
                      ...draft,
                      production_settings: {
                        ...(draft.production_settings ?? {}),
                        banterEnabled: event.target.checked,
                      },
                    })
                  }
                />
                <span>
                  <strong>Lebendigen Schlagabtausch zulassen</strong>
                  <small>Die Regie wechselt zwischen Zustimmung, Gegenrede, Rückfrage und Pointe.</small>
                </span>
              </label>
              <label>
                <input
                  type="checkbox"
                  checked={draft.production_settings?.duckYoutubeAudio !== false}
                  onChange={(event) =>
                    setDraft({
                      ...draft,
                      production_settings: {
                        ...(draft.production_settings ?? {}),
                        duckYoutubeAudio: event.target.checked,
                      },
                    })
                  }
                />
                <span>
                  <strong>Video automatisch leiser regeln</strong>
                  <small>OBS senkt den YouTube-Ton während einer Host-Wortmeldung und stellt ihn danach wieder her.</small>
                </span>
              </label>
            </div>
            <label>
              Publikumsfrage
              <input
                value={draft.audience_prompt}
                onChange={(event) => setDraft({ ...draft, audience_prompt: event.target.value })}
              />
            </label>
          </div>

          <aside className="roundtable-control">
            <div className="roundtable-preview">
              <span>{state.design.kicker}</span>
              <strong>{state.design.title}</strong>
              <p>{state.settings.topic}</p>
              <small>
                {state.participants.length}/6 Hosts ·{' '}
                {state.runtime.lastError ? 'lokaler Fallback aktiv' : 'KI-Regie bereit'}
              </small>
              <div className="roundtable-preview-people">
                {state.participants.map((participant) => (
                  <i
                    key={participant.id}
                    className={participant.id === state.turn?.speaker_id ? 'speaking' : ''}
                    style={{ '--person-accent': participant.accent_color } as React.CSSProperties}
                    title={participant.display_name}
                  >
                    {participant.display_name[0]}
                  </i>
                ))}
              </div>
            </div>
            <article className="roundtable-current-turn">
              <small>AKTUELLE WORTMELDUNG</small>
              <strong>{state.turn?.display_name ?? 'Regie wartet'}</strong>
              <h3>{state.turn?.headline ?? 'Noch nicht gestartet'}</h3>
              <p>{state.turn?.text ?? 'Thema und Besetzung speichern, danach Vorschau oder Programm starten.'}</p>
              {state.turn?.tier && (
                <em>
                  Modellstufe:{' '}
                  {state.turn.tier === 'local'
                    ? 'lokaler Fallback'
                    : state.turn.tier === 'codex'
                      ? 'Codex CLI'
                      : state.turn.tier}
                </em>
              )}
            </article>
            <div className="roundtable-audience-status">
              <MessageCircle size={17} />
              <span>
                <strong>{state.audience.length} aktuelle Publikumsimpulse</strong>
                <small>YouTube und Twitch werden gemeinsam dargestellt.</small>
              </span>
            </div>
            <div className="roundtable-actions">
              <button onClick={() => void save()} disabled={Boolean(working)}>
                {working === 'save' ? <LoaderCircle className="spin" size={16} /> : <Save size={16} />} Speichern
              </button>
              <button onClick={() => void start(false)} disabled={Boolean(working)}>
                <Play size={16} /> Vorschau starten
              </button>
              <button className="primary-button" onClick={() => void start(true)} disabled={Boolean(working)}>
                <RadioTower size={16} /> Im Programm starten
              </button>
              {state.settings.status === 'paused' ? (
                <button onClick={() => void control('resume')} disabled={Boolean(working)}>
                  <Play size={16} /> Fortsetzen
                </button>
              ) : (
                <button onClick={() => void control('pause')} disabled={Boolean(working) || state.settings.status !== 'live'}>
                  <Pause size={16} /> Pause
                </button>
              )}
              <button onClick={() => void control('next')} disabled={Boolean(working) || state.settings.status !== 'live'}>
                <SkipForward size={16} /> Nächste Stimme
              </button>
              <button onClick={() => void control('take')} disabled={Boolean(working)}>
                <RadioTower size={16} /> Take
              </button>
              <button className="danger-button" onClick={() => void control('stop')} disabled={Boolean(working)}>
                <Square size={16} /> Beenden
              </button>
            </div>
          </aside>
        </div>
      )}
    </section>
  );
}
