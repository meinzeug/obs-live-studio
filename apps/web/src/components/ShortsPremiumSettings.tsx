import React, { useEffect, useMemo, useState } from 'react';
import {
  AlertTriangle,
  BadgeDollarSign,
  CheckCircle2,
  ExternalLink,
  Headphones,
  LoaderCircle,
  Save,
  ShieldCheck,
  Sparkles,
  Volume2,
} from 'lucide-react';
import { api } from '../api/client.js';

type PremiumSettings = {
  elevenlabs_enabled: boolean;
  elevenlabs_voice_id: string;
  elevenlabs_voice_name: string;
  elevenlabs_model_id: string;
  elevenlabs_output_format: 'mp3_44100_128' | 'mp3_44100_192';
  elevenlabs_stability: number;
  elevenlabs_similarity_boost: number;
  elevenlabs_style: number;
  elevenlabs_speaker_boost: boolean;
  local_tts_fallback: boolean;
  paid_llm_enabled: boolean;
  paid_llm_model_strategy: 'automatic' | 'fixed';
  paid_llm_model: string;
  paid_llm_max_request_usd: number;
  paid_llm_daily_budget_usd: number;
  editorial_instructions: string;
  narration_target_seconds: number;
  speak_video_title: boolean;
};

type PremiumDashboard = {
  settings: PremiumSettings;
  connections: {
    elevenlabs: { configured: boolean; apiKeyHint: string };
    openrouter: { configured: boolean; apiKeyHint: string };
  };
  budget: {
    dailyLimitUsd: number;
    requestLimitUsd: number;
    spentUsd: number;
    reservedUsd: number;
    remainingUsd: number;
    paidRequests: number;
    lastPaidModel: string | null;
  };
  qualityUpgrade: {
    youtube: { waiting: number; queued: number; upgraded: number };
    tiktok: { waiting: number; queued: number; upgraded: number };
  };
  docs: { elevenlabsTts: string; elevenlabsVoices: string; openrouterModels: string };
};

type Voice = {
  id: string;
  name: string;
  category: string;
  description: string;
  previewUrl: string;
  labels: Record<string, unknown>;
};

type Diagnostic = {
  connected: boolean;
  capabilities: Record<
    'subscription' | 'voices' | 'models',
    {
      available: boolean;
      state: 'ready' | 'permission-required' | 'unavailable';
      permission: string;
      message: string;
    }
  >;
  warnings: string[];
  subscription: { tier: string; status: string; characterCount: number; characterLimit: number };
  voices: Voice[];
  models: Array<{ id: string; name: string; languages: string[] }>;
};

type Draft = {
  elevenlabsEnabled: boolean;
  elevenlabsApiKey: string;
  clearElevenlabsApiKey: boolean;
  elevenlabsVoiceId: string;
  elevenlabsVoiceName: string;
  elevenlabsModelId: string;
  elevenlabsOutputFormat: 'mp3_44100_128' | 'mp3_44100_192';
  elevenlabsStability: number;
  elevenlabsSimilarityBoost: number;
  elevenlabsStyle: number;
  elevenlabsSpeakerBoost: boolean;
  localTtsFallback: boolean;
  paidLlmEnabled: true;
  paidLlmModelStrategy: 'automatic' | 'fixed';
  paidLlmModel: string;
  paidLlmMaxRequestUsd: number;
  paidLlmDailyBudgetUsd: number;
  editorialInstructions: string;
  narrationTargetSeconds: number;
  speakVideoTitle: boolean;
};

function toDraft(settings: PremiumSettings): Draft {
  return {
    elevenlabsEnabled: settings.elevenlabs_enabled,
    elevenlabsApiKey: '',
    clearElevenlabsApiKey: false,
    elevenlabsVoiceId: settings.elevenlabs_voice_id,
    elevenlabsVoiceName: settings.elevenlabs_voice_name,
    elevenlabsModelId: settings.elevenlabs_model_id,
    elevenlabsOutputFormat: settings.elevenlabs_output_format,
    elevenlabsStability: settings.elevenlabs_stability,
    elevenlabsSimilarityBoost: settings.elevenlabs_similarity_boost,
    elevenlabsStyle: settings.elevenlabs_style,
    elevenlabsSpeakerBoost: settings.elevenlabs_speaker_boost,
    localTtsFallback: settings.local_tts_fallback,
    paidLlmEnabled: true,
    paidLlmModelStrategy: settings.paid_llm_model_strategy,
    paidLlmModel: settings.paid_llm_model,
    paidLlmMaxRequestUsd: settings.paid_llm_max_request_usd,
    paidLlmDailyBudgetUsd: settings.paid_llm_daily_budget_usd,
    editorialInstructions: settings.editorial_instructions,
    narrationTargetSeconds: settings.narration_target_seconds,
    speakVideoTitle: settings.speak_video_title,
  };
}

function labelValue(voice: Voice, key: string) {
  const value = voice.labels[key];
  return typeof value === 'string' ? value : '';
}

function femaleGermanScore(voice: Voice) {
  const text = `${voice.name} ${voice.description} ${Object.values(voice.labels).join(' ')}`.toLowerCase();
  let score = 0;
  if (/female|weiblich|woman/.test(text)) score += 20;
  if (/german|deutsch|de-de/.test(text)) score += 12;
  if (/professional|narration|news|warm|natural/.test(text)) score += 3;
  return score;
}

export function ShortsPremiumSettings({ canAdmin }: { canAdmin: boolean }) {
  const [dashboard, setDashboard] = useState<PremiumDashboard | null>(null);
  const [draft, setDraft] = useState<Draft | null>(null);
  const [diagnostic, setDiagnostic] = useState<Diagnostic | null>(null);
  const [working, setWorking] = useState('');
  const [error, setError] = useState('');
  const [message, setMessage] = useState('');
  const [testText, setTestText] = useState(
    'Willkommen bei Zeitkante. AVA ordnet die wichtigsten Aussagen dieses Videos sachlich und verständlich ein.',
  );
  const [testAudio, setTestAudio] = useState('');

  async function load() {
    const next = await api<PremiumDashboard>('/api/shorts-premium');
    setDashboard(next);
    setDraft(toDraft(next.settings));
  }

  useEffect(() => {
    void load().catch((requestError) =>
      setError(requestError instanceof Error ? requestError.message : String(requestError)),
    );
  }, []);

  const voices = useMemo(
    () => [...(diagnostic?.voices ?? [])].sort((left, right) => femaleGermanScore(right) - femaleGermanScore(left)),
    [diagnostic],
  );

  async function save() {
    if (!draft || !canAdmin || working) return;
    setWorking('save');
    setError('');
    setMessage('');
    try {
      const result = await api<{
        qualityUpgrade?: { state: 'unchanged' | 'waiting' | 'queued'; message: string };
      }>('/api/shorts-premium/settings', { method: 'PATCH', body: JSON.stringify(draft) });
      await load();
      setMessage(result.qualityUpgrade?.message || 'Premium-Produktion für YouTube und TikTok wurde gespeichert.');
    } catch (requestError) {
      setError(requestError instanceof Error ? requestError.message : String(requestError));
    } finally {
      setWorking('');
    }
  }

  async function diagnose() {
    if (!draft || !canAdmin || working) return;
    setWorking('diagnose');
    setError('');
    try {
      if (draft.elevenlabsApiKey || draft.clearElevenlabsApiKey) {
        await api('/api/shorts-premium/settings', {
          method: 'PATCH',
          body: JSON.stringify({
            elevenlabsApiKey: draft.elevenlabsApiKey,
            clearElevenlabsApiKey: draft.clearElevenlabsApiKey,
          }),
        });
      }
      const result = await api<Diagnostic>('/api/shorts-premium/elevenlabs/diagnose', { method: 'POST' });
      setDiagnostic(result);
      const recommended = [...result.voices].sort(
        (left, right) => femaleGermanScore(right) - femaleGermanScore(left),
      )[0];
      const refreshed = await api<PremiumDashboard>('/api/shorts-premium');
      setDashboard(refreshed);
      setDraft((current) =>
        current && !current.elevenlabsVoiceId && recommended
          ? {
              ...current,
              elevenlabsApiKey: '',
              clearElevenlabsApiKey: false,
              elevenlabsVoiceId: recommended.id,
              elevenlabsVoiceName: recommended.name,
            }
          : current
            ? { ...current, elevenlabsApiKey: '', clearElevenlabsApiKey: false }
            : current,
      );
      setMessage(
        result.warnings.length
          ? `ElevenLabs-Zugang erkannt. ${result.voices.length} Stimmen geladen; ${result.warnings.length} Leseberechtigungen fehlen.`
          : `${result.voices.length} ElevenLabs-Stimmen und ${result.models.length} TTS-Modelle gefunden.`,
      );
    } catch (requestError) {
      setError(requestError instanceof Error ? requestError.message : String(requestError));
    } finally {
      setWorking('');
    }
  }

  async function testVoice() {
    if (!draft || !canAdmin || working) return;
    setWorking('voice');
    setError('');
    try {
      await api('/api/shorts-premium/settings', {
        method: 'PATCH',
        body: JSON.stringify({
          elevenlabsVoiceId: draft.elevenlabsVoiceId,
          elevenlabsVoiceName: draft.elevenlabsVoiceName,
          elevenlabsModelId: draft.elevenlabsModelId,
          elevenlabsOutputFormat: draft.elevenlabsOutputFormat,
          elevenlabsStability: draft.elevenlabsStability,
          elevenlabsSimilarityBoost: draft.elevenlabsSimilarityBoost,
          elevenlabsStyle: draft.elevenlabsStyle,
          elevenlabsSpeakerBoost: draft.elevenlabsSpeakerBoost,
        }),
      });
      const result = await api<{ audioUrl: string }>('/api/shorts-premium/elevenlabs/test-voice', {
        method: 'POST',
        body: JSON.stringify({ text: testText, voiceId: draft.elevenlabsVoiceId }),
      });
      setTestAudio(`${result.audioUrl}?v=${Date.now()}`);
      setMessage('ElevenLabs-Testaudio wurde erzeugt.');
    } catch (requestError) {
      setError(requestError instanceof Error ? requestError.message : String(requestError));
    } finally {
      setWorking('');
    }
  }

  if (!dashboard || !draft)
    return (
      <section className="shorts-premium-section">
        <div className="shorts-loading">
          <LoaderCircle className="spin" /> Premium-Produktion wird geladen …
        </div>
      </section>
    );

  const selectedVoice = voices.find((voice) => voice.id === draft.elevenlabsVoiceId);
  return (
    <section className="shorts-premium-section">
      <div className="shorts-premium-heading">
        <div>
          <p className="eyebrow">Gemeinsam für YouTube & TikTok</p>
          <h4>
            <Sparkles size={18} /> Premium-Redaktion und ElevenLabs
          </h4>
          <p>Ein Paid-SOTA-Modell plant Inhalt und Veröffentlichung. ElevenLabs spricht AVAs sendefertigen Text.</p>
        </div>
        <div className="shorts-premium-badges">
          <span className={dashboard.connections.openrouter.configured ? 'ready' : 'attention'}>
            <BadgeDollarSign size={14} /> OpenRouter Paid
          </span>
          <span className={dashboard.connections.elevenlabs.configured ? 'ready' : 'attention'}>
            <Headphones size={14} /> ElevenLabs
          </span>
        </div>
      </div>

      <div className="shorts-premium-columns">
        <div className="shorts-premium-panel">
          <h5>
            <BadgeDollarSign size={17} /> Paid-LLM für den gesamten Short
          </h5>
          <div className="shorts-premium-state ready">
            <CheckCircle2 size={18} />
            <div>
              <strong>Keine Free-Modelle</strong>
              <span>
                AVA-Text, Hook, Titel, Beschreibung, Tags und Veröffentlichungsplanung werden in einem Paid-Lauf
                erzeugt.
              </span>
            </div>
          </div>
          <label className="settings-option">
            <span>Modellwahl</span>
            <select
              value={draft.paidLlmModelStrategy}
              onChange={(event) =>
                setDraft({ ...draft, paidLlmModelStrategy: event.target.value as Draft['paidLlmModelStrategy'] })
              }
            >
              <option value="automatic">Automatisch · bestes aktuelles SOTA-Modell im Budget</option>
              <option value="fixed">Feste OpenRouter Model-ID</option>
            </select>
          </label>
          {draft.paidLlmModelStrategy === 'fixed' && (
            <label className="settings-option">
              <span>OpenRouter Model-ID</span>
              <input
                value={draft.paidLlmModel}
                onChange={(event) => setDraft({ ...draft, paidLlmModel: event.target.value })}
                placeholder="z. B. anthropic/…"
              />
            </label>
          )}
          <div className="shorts-premium-budget-grid">
            <label className="settings-option">
              <span>Maximal je Short (USD)</span>
              <input
                type="number"
                min="0.01"
                max="25"
                step="0.01"
                value={draft.paidLlmMaxRequestUsd}
                onChange={(event) => setDraft({ ...draft, paidLlmMaxRequestUsd: Number(event.target.value) })}
              />
            </label>
            <label className="settings-option">
              <span>Tagesbudget (USD)</span>
              <input
                type="number"
                min="0.01"
                max="1000"
                step="0.1"
                value={draft.paidLlmDailyBudgetUsd}
                onChange={(event) => setDraft({ ...draft, paidLlmDailyBudgetUsd: Number(event.target.value) })}
              />
            </label>
          </div>
          <label className="settings-option">
            <span>Redaktionelle Vorgaben</span>
            <textarea
              rows={4}
              value={draft.editorialInstructions}
              onChange={(event) => setDraft({ ...draft, editorialInstructions: event.target.value })}
            />
          </label>
          <label className="settings-option">
            <span>Länge von AVAs gesprochener Einordnung</span>
            <select
              value={draft.narrationTargetSeconds}
              onChange={(event) => setDraft({ ...draft, narrationTargetSeconds: Number(event.target.value) })}
            >
              <option value="15">15 Sekunden · sehr kurz</option>
              <option value="20">20 Sekunden · kurz</option>
              <option value="25">25 Sekunden · kompakt</option>
              <option value="30">30 Sekunden · Standard</option>
              <option value="35">35 Sekunden · ausführlich</option>
              <option value="40">40 Sekunden · vertieft</option>
              <option value="45">45 Sekunden · maximal</option>
            </select>
            <small>
              Die Paid-Redaktion passt Wortzahl und TTS-Text an; der Originalausschnitt behält den Rest des Shorts.
            </small>
          </label>
          <label className="settings-option">
            <span>Originaltitel am Anfang vorlesen</span>
            <select
              value={draft.speakVideoTitle ? 'yes' : 'no'}
              onChange={(event) => setDraft({ ...draft, speakVideoTitle: event.target.value === 'yes' })}
            >
              <option value="no">Nein · direkt mit AVAs Einordnung beginnen</option>
              <option value="yes">Ja · echten Videotitel zuerst sprechen</option>
            </select>
            <small>Der Titel wird bei aktivierter Option in die gewählte Sprechdauer eingerechnet.</small>
          </label>
          <div className="shorts-budget-meter">
            <i
              style={{
                width: `${Math.min(100, ((dashboard.budget.spentUsd + dashboard.budget.reservedUsd) / Math.max(0.01, dashboard.budget.dailyLimitUsd)) * 100)}%`,
              }}
            />
          </div>
          <small>
            {dashboard.budget.spentUsd.toFixed(4)} USD verbraucht · {dashboard.budget.remainingUsd.toFixed(4)} USD
            verfügbar · {dashboard.budget.paidRequests} Paid-Aufträge
            {dashboard.budget.lastPaidModel ? ` · zuletzt ${dashboard.budget.lastPaidModel}` : ''}
          </small>
          <a href={dashboard.docs.openrouterModels} target="_blank" rel="noreferrer">
            Aktuelle OpenRouter-Modelle <ExternalLink size={12} />
          </a>
        </div>

        <div className="shorts-premium-panel">
          <h5>
            <Volume2 size={17} /> ElevenLabs High Quality
          </h5>
          <label className="settings-option settings-toggle-option">
            <span>Premium-Stimme</span>
            <span className="toggle-row">
              <input
                type="checkbox"
                checked={draft.elevenlabsEnabled}
                onChange={(event) => setDraft({ ...draft, elevenlabsEnabled: event.target.checked })}
              />{' '}
              ElevenLabs für beide Shorts-Pipelines verwenden
            </span>
          </label>
          <label className="settings-option">
            <span>ElevenLabs API-Key</span>
            <input
              type="password"
              autoComplete="new-password"
              value={draft.elevenlabsApiKey}
              disabled={!canAdmin}
              onChange={(event) =>
                setDraft({ ...draft, elevenlabsApiKey: event.target.value, clearElevenlabsApiKey: false })
              }
              placeholder={dashboard.connections.elevenlabs.apiKeyHint || 'xi-api-key nur serverseitig speichern'}
            />
          </label>
          {dashboard.connections.elevenlabs.configured && (
            <label className="settings-option settings-toggle-option">
              <span>Zugang entfernen</span>
              <span className="toggle-row">
                <input
                  type="checkbox"
                  checked={draft.clearElevenlabsApiKey}
                  onChange={(event) =>
                    setDraft({ ...draft, clearElevenlabsApiKey: event.target.checked, elevenlabsApiKey: '' })
                  }
                />{' '}
                Gespeicherten Key beim Speichern löschen
              </span>
            </label>
          )}
          <div className="shorts-oauth-actions">
            <button className="ghost-button" disabled={!canAdmin || Boolean(working)} onClick={() => void diagnose()}>
              {working === 'diagnose' ? <LoaderCircle className="spin" size={15} /> : <ShieldCheck size={15} />}{' '}
              Verbindung prüfen & Stimmen laden
            </button>
          </div>
          {diagnostic?.warnings.length ? (
            <div className="shorts-premium-state attention">
              <AlertTriangle size={18} />
              <div>
                <strong>API-Key erkannt · Leserechte ergänzen</strong>
                <span>
                  {diagnostic.warnings.join(' ')} Aktiviere diese Rechte unter ElevenLabs → Developers → API Keys, damit
                  die WebUI Stimmen und Modelle laden kann.
                </span>
              </div>
            </div>
          ) : null}
          {voices.length > 0 && (
            <label className="settings-option">
              <span>Natürliche Stimme</span>
              <select
                value={draft.elevenlabsVoiceId}
                onChange={(event) => {
                  const voice = voices.find((candidate) => candidate.id === event.target.value);
                  setDraft({ ...draft, elevenlabsVoiceId: event.target.value, elevenlabsVoiceName: voice?.name ?? '' });
                }}
              >
                <option value="">Stimme auswählen</option>
                {voices.map((voice) => (
                  <option key={voice.id} value={voice.id}>
                    {voice.name}
                    {labelValue(voice, 'gender') ? ` · ${labelValue(voice, 'gender')}` : ''}
                    {labelValue(voice, 'language') ? ` · ${labelValue(voice, 'language')}` : ''}
                  </option>
                ))}
              </select>
              <small>
                {selectedVoice?.description ||
                  'Deutsch/weiblich markierte Stimmen werden nach der Diagnose zuerst angeboten.'}
              </small>
            </label>
          )}
          <label className="settings-option">
            <span>ElevenLabs Voice-ID direkt eingeben</span>
            <input
              value={draft.elevenlabsVoiceId}
              autoComplete="off"
              spellCheck={false}
              onChange={(event) => {
                const voiceId = event.target.value.trim();
                const voice = voices.find((candidate) => candidate.id === voiceId);
                setDraft({
                  ...draft,
                  elevenlabsVoiceId: voiceId,
                  elevenlabsVoiceName: voice?.name ?? '',
                });
              }}
              placeholder="z. B. 21m00Tcm4TlvDq8ikWAM"
            />
            <small>
              Funktioniert auch ohne Stimmen-Leserecht. Die ID wird gemeinsam für YouTube- und TikTok-Shorts gespeichert
              und beim Test direkt gegen ElevenLabs geprüft.
            </small>
          </label>
          <div className="shorts-premium-budget-grid">
            <label className="settings-option">
              <span>Modell</span>
              <input
                value={draft.elevenlabsModelId}
                onChange={(event) => setDraft({ ...draft, elevenlabsModelId: event.target.value })}
              />
            </label>
            <label className="settings-option">
              <span>Qualität</span>
              <select
                value={draft.elevenlabsOutputFormat}
                onChange={(event) =>
                  setDraft({ ...draft, elevenlabsOutputFormat: event.target.value as Draft['elevenlabsOutputFormat'] })
                }
              >
                <option value="mp3_44100_128">44,1 kHz · 128 kbps</option>
                <option value="mp3_44100_192">44,1 kHz · 192 kbps</option>
              </select>
            </label>
          </div>
          <label className="settings-option">
            <span>Stabilität: {draft.elevenlabsStability.toFixed(2)}</span>
            <input
              type="range"
              min="0"
              max="1"
              step="0.01"
              value={draft.elevenlabsStability}
              onChange={(event) => setDraft({ ...draft, elevenlabsStability: Number(event.target.value) })}
            />
          </label>
          <label className="settings-option">
            <span>Stimmähnlichkeit: {draft.elevenlabsSimilarityBoost.toFixed(2)}</span>
            <input
              type="range"
              min="0"
              max="1"
              step="0.01"
              value={draft.elevenlabsSimilarityBoost}
              onChange={(event) => setDraft({ ...draft, elevenlabsSimilarityBoost: Number(event.target.value) })}
            />
          </label>
          <label className="settings-option">
            <span>Stil: {draft.elevenlabsStyle.toFixed(2)}</span>
            <input
              type="range"
              min="0"
              max="1"
              step="0.01"
              value={draft.elevenlabsStyle}
              onChange={(event) => setDraft({ ...draft, elevenlabsStyle: Number(event.target.value) })}
            />
          </label>
          <label className="settings-option settings-toggle-option">
            <span>Ausfallsicherheit</span>
            <span className="toggle-row">
              <input
                type="checkbox"
                checked={draft.localTtsFallback}
                onChange={(event) => setDraft({ ...draft, localTtsFallback: event.target.checked })}
              />{' '}
              Lokales Studio-TTS verwenden, falls ElevenLabs ausfällt
            </span>
          </label>
          <label className="settings-option">
            <span>Testtext</span>
            <textarea rows={3} maxLength={600} value={testText} onChange={(event) => setTestText(event.target.value)} />
          </label>
          <div className="shorts-oauth-actions">
            <button
              className="ghost-button"
              disabled={!canAdmin || !draft.elevenlabsVoiceId || Boolean(working)}
              onClick={() => void testVoice()}
            >
              {working === 'voice' ? <LoaderCircle className="spin" size={15} /> : <Volume2 size={15} />} Stimme
              erzeugen & abspielen
            </button>
          </div>
          {testAudio && <audio className="shorts-premium-audio" src={testAudio} controls autoPlay />}
        </div>
      </div>

      <div className="shorts-premium-state ready">
        <strong>Automatische Qualitätsnachrüstung</strong>
        <span>
          YouTube: {dashboard.qualityUpgrade.youtube.queued} in Arbeit, {dashboard.qualityUpgrade.youtube.waiting}{' '}
          warten · TikTok: {dashboard.qualityUpgrade.tiktok.queued} in Arbeit, {dashboard.qualityUpgrade.tiktok.waiting}{' '}
          warten. Bereits hochwertige Clips:{' '}
          {dashboard.qualityUpgrade.youtube.upgraded + dashboard.qualityUpgrade.tiktok.upgraded}.
        </span>
      </div>

      {error && <div className="short-error">{error}</div>}
      {message && (
        <div className="shorts-premium-message">
          <CheckCircle2 size={15} /> {message}
        </div>
      )}
      <div className="shorts-premium-actions">
        <span>
          <ShieldCheck size={14} /> Keys bleiben in der geschützten Server-Environment.
        </span>
        <button className="primary-button" disabled={!canAdmin || Boolean(working)} onClick={() => void save()}>
          {working === 'save' ? <LoaderCircle className="spin" size={16} /> : <Save size={16} />} Premium-Produktion
          speichern
        </button>
      </div>
    </section>
  );
}
