import React, { useEffect, useMemo, useState } from 'react';
import { CheckCircle2, LoaderCircle, Mic2, Play, RefreshCw, Save, Trash2, Upload, Video } from 'lucide-react';
import { api } from '../api/client.js';

type PresenterMediaState = 'idle' | 'speaking';
type PresenterMedia = {
  id: string;
  state: PresenterMediaState;
  original_filename: string;
  mime_type: string;
  sha256: string;
  width: number | null;
  height: number | null;
  duration_seconds: number | null;
  green_screen: boolean;
  videoUrl: string;
};
type Presenter = {
  staff_member_id: string;
  display_name: string;
  job_title: string;
  role: string;
  enabled: boolean;
  accent_color: string;
  tts_voice: string;
  media: Partial<Record<PresenterMediaState, PresenterMedia>>;
};
type PresenterSettings = {
  provider: string;
  voiceOptions: Array<{ id: string; label: string }>;
  presenters: Presenter[];
};
type VoiceTest = {
  engine: string;
  configuredEngine: string;
  voice: string;
  durationSeconds: number;
  audioUrl: string;
};

const stateLabels: Record<PresenterMediaState, { title: string; description: string }> = {
  idle: {
    title: 'Ruhevideo',
    description: 'Läuft in einer Einordnungssendung, solange der Agent nicht spricht.',
  },
  speaking: {
    title: 'Sprechvideo',
    description: 'Wird synchron zur TTS-Ausgabe in allen Sendungen dieses Agenten verwendet.',
  },
};

function seconds(value: number | null) {
  return value == null ? '' : `${value.toLocaleString('de-DE', { maximumFractionDigits: 1 })} Sek.`;
}

export function AgentPresenterSettings({ disabled = false }: { disabled?: boolean }) {
  const [settings, setSettings] = useState<PresenterSettings>();
  const [voices, setVoices] = useState<Record<string, string>>({});
  const [greenScreen, setGreenScreen] = useState<Record<string, boolean>>({});
  const [busy, setBusy] = useState('');
  const [message, setMessage] = useState('');
  const [error, setError] = useState('');
  const [voiceTests, setVoiceTests] = useState<Record<string, VoiceTest>>({});
  const testText = useMemo(() => 'Hallo, ich bin Teil des interaktiven Senderteams von Open TV Studio.', []);

  function apply(next: PresenterSettings) {
    setSettings(next);
    setVoices(Object.fromEntries(next.presenters.map((presenter) => [presenter.staff_member_id, presenter.tts_voice])));
    setGreenScreen((current) => ({
      ...Object.fromEntries(
        next.presenters.flatMap((presenter) => [
          [`${presenter.staff_member_id}:idle`, presenter.media.idle?.green_screen ?? true],
          [`${presenter.staff_member_id}:speaking`, presenter.media.speaking?.green_screen ?? true],
        ]),
      ),
      ...current,
    }));
  }

  async function load() {
    setError('');
    try {
      apply(await api<PresenterSettings>('/api/ai-presenters'));
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : String(cause));
    }
  }

  useEffect(() => {
    void load();
  }, []);

  async function saveVoice(presenter: Presenter) {
    const key = `${presenter.staff_member_id}:voice`;
    setBusy(key);
    setError('');
    try {
      const next = await api<PresenterSettings>(`/api/ai-presenters/${presenter.staff_member_id}`, {
        method: 'PATCH',
        body: JSON.stringify({ voice: voices[presenter.staff_member_id] }),
      });
      apply(next);
      setMessage(`Stimme für ${presenter.display_name} gespeichert.`);
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : String(cause));
    } finally {
      setBusy('');
    }
  }

  async function testVoice(presenter: Presenter) {
    const key = `${presenter.staff_member_id}:test`;
    setBusy(key);
    setError('');
    try {
      if ((voices[presenter.staff_member_id] ?? '').trim() !== presenter.tts_voice) {
        const next = await api<PresenterSettings>(`/api/ai-presenters/${presenter.staff_member_id}`, {
          method: 'PATCH',
          body: JSON.stringify({ voice: voices[presenter.staff_member_id] }),
        });
        apply(next);
      }
      const result = await api<VoiceTest>(`/api/ai-presenters/${presenter.staff_member_id}/test-voice`, {
        method: 'POST',
        body: JSON.stringify({ text: testText }),
      });
      setVoiceTests((current) => ({ ...current, [presenter.staff_member_id]: result }));
      setMessage(`Stimmprobe für ${presenter.display_name} wurde erzeugt.`);
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : String(cause));
    } finally {
      setBusy('');
    }
  }

  async function uploadMedia(presenter: Presenter, state: PresenterMediaState, file: File | undefined) {
    if (!file) return;
    const key = `${presenter.staff_member_id}:${state}`;
    setBusy(key);
    setError('');
    const form = new FormData();
    form.set('file', file);
    try {
      const next = await api<PresenterSettings>(
        `/api/ai-presenters/${presenter.staff_member_id}/media/${state}?greenScreen=${greenScreen[key] !== false}`,
        { method: 'POST', body: form },
      );
      apply(next);
      setMessage(`${stateLabels[state].title} für ${presenter.display_name} wurde konvertiert und aktiviert.`);
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : String(cause));
    } finally {
      setBusy('');
    }
  }

  async function removeMedia(presenter: Presenter, state: PresenterMediaState) {
    if (!window.confirm(`${stateLabels[state].title} von ${presenter.display_name} wirklich entfernen?`)) return;
    const key = `${presenter.staff_member_id}:${state}`;
    setBusy(key);
    setError('');
    try {
      const next = await api<PresenterSettings>(`/api/ai-presenters/${presenter.staff_member_id}/media/${state}`, {
        method: 'DELETE',
      });
      apply(next);
      setMessage(`${stateLabels[state].title} für ${presenter.display_name} wurde entfernt.`);
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : String(cause));
    } finally {
      setBusy('');
    }
  }

  return (
    <div className="agent-presenter-settings">
      <div className="agent-presenter-heading">
        <div>
          <p className="eyebrow">On-Air-Agenten</p>
          <h4>Stimmen und Avatar-Videos</h4>
          <p>
            Jeder Moderator erhält eine feste Stimme und getrennte Clips für Zuhören und Sprechen. Uploads werden als
            sendefertiges VP9-WebM konvertiert und mit Metadaten in der Mediathek-Datenbank registriert.
          </p>
        </div>
        <div className="agent-presenter-provider">
          <Mic2 size={16} /> Zentrale Engine: <strong>{settings?.provider ?? 'wird geladen'}</strong>
        </div>
      </div>

      {message && (
        <div className="inline-success" role="status">
          <CheckCircle2 size={16} /> {message}
        </div>
      )}
      {error && (
        <div className="inline-error" role="alert">
          {error}{' '}
          <button onClick={() => void load()}>
            <RefreshCw size={14} /> Neu laden
          </button>
        </div>
      )}

      <div className="agent-presenter-grid">
        {settings?.presenters.map((presenter) => (
          <article
            className="agent-presenter-card"
            key={presenter.staff_member_id}
            style={{ '--presenter-accent': presenter.accent_color } as React.CSSProperties}
          >
            <header>
              <span className="agent-presenter-avatar">
                <Video size={20} />
              </span>
              <div>
                <h5>{presenter.display_name}</h5>
                <p>{presenter.job_title}</p>
              </div>
              <span className={`state-pill ${presenter.enabled ? 'success' : 'warning'}`}>
                {presenter.enabled ? 'On Air bereit' : 'Pausiert'}
              </span>
            </header>

            <div className="agent-presenter-voice">
              <label>
                <span>TTS-Stimme in allen Sendungen</span>
                <input
                  list={`voice-options-${presenter.staff_member_id}`}
                  value={voices[presenter.staff_member_id] ?? ''}
                  onChange={(event) =>
                    setVoices((current) => ({ ...current, [presenter.staff_member_id]: event.target.value }))
                  }
                  disabled={disabled || Boolean(busy)}
                />
                <datalist id={`voice-options-${presenter.staff_member_id}`}>
                  {settings.voiceOptions.map((option) => (
                    <option key={option.id} value={option.id} label={option.label} />
                  ))}
                </datalist>
              </label>
              <div className="agent-presenter-actions">
                <button
                  disabled={disabled || Boolean(busy) || !(voices[presenter.staff_member_id] ?? '').trim()}
                  onClick={() => void saveVoice(presenter)}
                >
                  {busy === `${presenter.staff_member_id}:voice` ? (
                    <LoaderCircle className="spin" size={15} />
                  ) : (
                    <Save size={15} />
                  )}{' '}
                  Speichern
                </button>
                <button disabled={disabled || Boolean(busy)} onClick={() => void testVoice(presenter)}>
                  {busy === `${presenter.staff_member_id}:test` ? (
                    <LoaderCircle className="spin" size={15} />
                  ) : (
                    <Play size={15} />
                  )}{' '}
                  Probehören
                </button>
              </div>
              {voiceTests[presenter.staff_member_id] && (
                <audio controls src={voiceTests[presenter.staff_member_id]!.audioUrl}>
                  Deine Browser-Version unterstützt keine Audio-Wiedergabe.
                </audio>
              )}
            </div>

            <div className="agent-presenter-media-grid">
              {(['idle', 'speaking'] as const).map((state) => {
                const media = presenter.media[state];
                const key = `${presenter.staff_member_id}:${state}`;
                return (
                  <section className="agent-presenter-media" key={state}>
                    <div className="agent-presenter-preview">
                      {media ? (
                        <video key={media.videoUrl} src={media.videoUrl} autoPlay loop muted playsInline />
                      ) : (
                        <div>
                          <Video size={25} />
                          <span>Kein Video</span>
                        </div>
                      )}
                    </div>
                    <div>
                      <strong>{stateLabels[state].title}</strong>
                      <small>{stateLabels[state].description}</small>
                      {media && (
                        <small>
                          {media.original_filename} · {seconds(media.duration_seconds)}
                        </small>
                      )}
                    </div>
                    <label className="agent-presenter-chroma">
                      <input
                        type="checkbox"
                        checked={greenScreen[key] !== false}
                        onChange={(event) => setGreenScreen((current) => ({ ...current, [key]: event.target.checked }))}
                        disabled={disabled || Boolean(busy)}
                      />
                      Greenscreen freistellen
                    </label>
                    <div className="agent-presenter-actions">
                      <label className="button-like">
                        {busy === key ? <LoaderCircle className="spin" size={15} /> : <Upload size={15} />}
                        {media ? 'Ersetzen' : 'Hochladen'}
                        <input
                          type="file"
                          accept="video/mp4,video/quicktime,video/webm"
                          disabled={disabled || Boolean(busy)}
                          onChange={(event) => {
                            void uploadMedia(presenter, state, event.target.files?.[0]);
                            event.currentTarget.value = '';
                          }}
                        />
                      </label>
                      {media && (
                        <button
                          className="danger-button"
                          disabled={disabled || Boolean(busy)}
                          onClick={() => void removeMedia(presenter, state)}
                        >
                          <Trash2 size={15} /> Entfernen
                        </button>
                      )}
                    </div>
                  </section>
                );
              })}
            </div>
          </article>
        ))}
      </div>
      {!settings && !error && <p className="muted">On-Air-Agenten werden geladen …</p>}
    </div>
  );
}
