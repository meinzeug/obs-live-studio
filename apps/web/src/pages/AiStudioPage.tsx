import React, { useEffect, useState } from 'react';
import {
  AlertTriangle,
  ArrowRight,
  AudioLines,
  Bot,
  BrainCircuit,
  CheckCircle2,
  Cpu,
  ExternalLink,
  FileAudio,
  Gauge,
  KeyRound,
  Languages,
  LoaderCircle,
  Mic2,
  RefreshCw,
  Save,
  Sparkles,
  WandSparkles,
} from 'lucide-react';
import { Link } from 'react-router-dom';
import { api, can, type SessionUser } from '../api/client.js';
import { routes } from '../navigation.js';
import { AiTeamPanel } from '../components/AiTeamPanel.js';

type AiSettings = {
  provider: 'openrouter';
  configured: boolean;
  apiKeyHint: string;
  freeFirst: true;
  freeModel: string;
  paidFallback: boolean;
  autoProcessIngest: boolean;
  dataCollection: 'allow' | 'deny';
  freeChatDataCollection: 'allow' | 'deny';
  taskPolicies: Array<{
    id: string;
    label: string;
    purpose: string;
    freeOnly: boolean;
    paidModels: string[];
    maxPromptPrice: number;
    maxCompletionPrice: number;
  }>;
};

type TtsSettings = {
  presetId: string;
  selected: TtsPreset;
  presets: TtsPreset[];
  note: string;
  job: {
    status: 'idle' | 'running' | 'completed' | 'failed';
    message: string;
    error: string | null;
    log: string[];
  } | null;
};

type TtsPreset = {
  id: string;
  label: string;
  description: string;
  engine: 'piper' | 'espeak-ng' | 'qwen3-tts';
  voice: string;
  size: string;
  audioReady: boolean;
  installed: boolean;
  license?: string;
  licenseUrl?: string;
  commercialUse?: boolean;
};

export function AiStudioPage({ user }: { user: SessionUser }) {
  const [settings, setSettings] = useState<AiSettings | null>(null);
  const [tts, setTts] = useState<TtsSettings | null>(null);
  const [apiKey, setApiKey] = useState('');
  const [loading, setLoading] = useState(true);
  const [working, setWorking] = useState('');
  const [message, setMessage] = useState('');
  const [error, setError] = useState('');
  const allowed = can(user, 'users:write');

  async function load() {
    if (!allowed) return;
    setLoading(true);
    setError('');
    try {
      const [nextSettings, nextTts] = await Promise.all([
        api<AiSettings>('/api/ai/settings'),
        api<TtsSettings>('/api/tts/settings'),
      ]);
      setSettings(nextSettings);
      setTts(nextTts);
    } catch (requestError) {
      setError(requestError instanceof Error ? requestError.message : String(requestError));
    } finally {
      setLoading(false);
    }
  }

  useEffect(() => {
    void load();
  }, [allowed]);

  useEffect(() => {
    if (tts?.job?.status !== 'running') return;
    const timer = window.setInterval(() => void load(), 2_500);
    return () => window.clearInterval(timer);
  }, [tts?.job?.status]);

  async function saveAi(test = false) {
    if (!settings) return;
    setWorking(test ? 'test-ai' : 'save-ai');
    setError('');
    setMessage('');
    try {
      const saved = await api<AiSettings>('/api/ai/settings', {
        method: 'POST',
        body: JSON.stringify({
          apiKey: apiKey.trim() || undefined,
          paidFallback: settings.paidFallback,
          autoProcessIngest: settings.autoProcessIngest,
          dataCollection: settings.dataCollection,
          freeChatDataCollection: settings.freeChatDataCollection,
        }),
      });
      setSettings(saved);
      setApiKey('');
      if (test) {
        const result = await api<{ key: { label: string; limitRemaining: number | null } }>('/api/ai/settings/test', {
          method: 'POST',
        });
        setMessage(
          `Verbindung erfolgreich: ${result.key.label}${result.key.limitRemaining === null ? '' : ` · Restguthaben ${result.key.limitRemaining}`}`,
        );
      } else setMessage('KI-Konfiguration gespeichert.');
    } catch (requestError) {
      setError(requestError instanceof Error ? requestError.message : String(requestError));
    } finally {
      setWorking('');
    }
  }

  async function saveTts() {
    if (!tts) return;
    setWorking('tts');
    setError('');
    setMessage('');
    try {
      const saved = await api<TtsSettings>('/api/tts/settings', {
        method: 'POST',
        body: JSON.stringify({ presetId: tts.presetId }),
      });
      setTts(saved);
      setMessage(
        saved.selected.installed ? 'Sprachmodell ist einsatzbereit.' : 'Installation wurde automatisch gestartet.',
      );
    } catch (requestError) {
      setError(requestError instanceof Error ? requestError.message : String(requestError));
    } finally {
      setWorking('');
    }
  }

  if (!allowed)
    return (
      <section className="workspace-hub">
        <div className="hub-empty">
          <AlertTriangle size={24} />
          <strong>Administratorzugriff erforderlich</strong>
          <span>KI-Anbieter und lokale Modelle können nur von Administratoren verwaltet werden.</span>
        </div>
      </section>
    );

  return (
    <section className="workspace-hub ai-studio-page">
      <header className="workspace-page-header">
        <div>
          <p className="eyebrow">Kreativ- und Automationszentrale</p>
          <h1>KI Studio</h1>
          <p>Modelle, redaktionelle Aufgaben und Sprachausgabe transparent an einem Ort verwalten.</p>
        </div>
        <div className="workspace-header-actions">
          <button onClick={() => void load()} disabled={loading}>
            <RefreshCw size={17} className={loading ? 'spin' : ''} /> Status prüfen
          </button>
        </div>
      </header>
      {message && (
        <div className="overview-notice">
          <CheckCircle2 size={16} />
          {message}
        </div>
      )}
      {error && (
        <div className="overview-notice error">
          <AlertTriangle size={16} />
          {error}
        </div>
      )}

      <div className="ai-status-grid">
        <article className={settings?.configured ? 'connected' : 'warning'}>
          <span>
            <BrainCircuit />
          </span>
          <div>
            <small>Redaktionelle KI</small>
            <strong>{settings?.configured ? 'Verbunden' : 'Nicht eingerichtet'}</strong>
            <p>{settings?.configured ? `OpenRouter · ${settings.apiKeyHint}` : 'API-Zugang ergänzen'}</p>
          </div>
          <i />
        </article>
        <article className={tts?.selected.installed ? 'connected' : 'warning'}>
          <span>
            <AudioLines />
          </span>
          <div>
            <small>Sprachausgabe</small>
            <strong>{tts?.selected.installed ? 'Einsatzbereit' : 'Installation nötig'}</strong>
            <p>{tts?.selected.label ?? 'Modell wird geladen'}</p>
          </div>
          <i />
        </article>
        <article className="connected">
          <span>
            <Sparkles />
          </span>
          <div>
            <small>Modellstrategie</small>
            <strong>Free first</strong>
            <p>{settings?.freeModel ?? 'openrouter/free'}</p>
          </div>
          <i />
        </article>
        <article className={settings?.autoProcessIngest ? 'connected' : ''}>
          <span>
            <Bot />
          </span>
          <div>
            <small>Automatische Redaktion</small>
            <strong>{settings?.autoProcessIngest ? 'Aktiv' : 'Manuell'}</strong>
            <p>Neue Beiträge verarbeiten</p>
          </div>
          <i />
        </article>
      </div>

      <div className="ai-main-grid">
        <section className="hub-panel ai-provider-panel">
          <header>
            <div>
              <p className="eyebrow">Cloud-Modelle</p>
              <h2>OpenRouter</h2>
            </div>
            <span className={`integration-status ${settings?.configured ? 'good' : 'warning'}`}>
              <i />
              {settings?.configured ? 'Verbunden' : 'Einrichtung fehlt'}
            </span>
          </header>
          <p className="panel-intro">
            Ein Zugang für OpenAI-, Anthropic-, Gemini- und freie Modelle. Aufgabenlimits werden zentral gesteuert.
          </p>
          {settings && (
            <>
              <label className="ai-key-field">
                <span>OpenRouter Schlüssel</span>
                <div>
                  <KeyRound size={17} />
                  <input
                    type="password"
                    value={apiKey}
                    onChange={(event) => setApiKey(event.target.value)}
                    placeholder={
                      settings.configured ? `${settings.apiKeyHint} · leer lassen zum Beibehalten` : 'sk-or-v1-…'
                    }
                  />
                </div>
                <small>Der Schlüssel wird serverseitig gespeichert und niemals an den Browser zurückgegeben.</small>
              </label>
              <div className="ai-choice-grid">
                <label className="choice-card">
                  <input
                    type="checkbox"
                    checked={settings.paidFallback}
                    onChange={(event) => setSettings({ ...settings, paidFallback: event.target.checked })}
                  />
                  <span>
                    <strong>Bezahlte Modelle als Fallback</strong>
                    <small>Nur wenn kein geeignetes Gratis-Modell verfügbar ist.</small>
                  </span>
                </label>
                <label className="choice-card">
                  <input
                    type="checkbox"
                    checked={settings.autoProcessIngest}
                    onChange={(event) => setSettings({ ...settings, autoProcessIngest: event.target.checked })}
                  />
                  <span>
                    <strong>Neue Beiträge automatisch bearbeiten</strong>
                    <small>Startet den KI-Workflow direkt nach dem Abruf.</small>
                  </span>
                </label>
              </div>
              <label>
                Datennutzung
                <select
                  value={settings.dataCollection}
                  onChange={(event) =>
                    setSettings({ ...settings, dataCollection: event.target.value as AiSettings['dataCollection'] })
                  }
                >
                  <option value="deny">Datenweitergabe ablehnen</option>
                  <option value="allow">Anbieter dürfen Daten gemäß Richtlinie nutzen</option>
                </select>
              </label>
              <label>
                Ava · kostenlose Chatmodelle
                <select
                  value={settings.freeChatDataCollection}
                  onChange={(event) =>
                    setSettings({
                      ...settings,
                      freeChatDataCollection: event.target.value as AiSettings['freeChatDataCollection'],
                    })
                  }
                >
                  <option value="allow">Free-Anbieter für öffentliche Chatfragen zulassen</option>
                  <option value="deny">Datennutzung sperren (Free-Antworten können ausfallen)</option>
                </select>
                <small>
                  Ava nutzt weiterhin ausschließlich OpenRouter Free. Übergeben werden die öffentliche Frage und das vom
                  Senderteam geprüfte Quellenpaket.
                </small>
              </label>
              <div className="panel-actions">
                <a className="button" href="https://openrouter.ai/settings/keys" target="_blank" rel="noreferrer">
                  Schlüssel verwalten <ExternalLink size={14} />
                </a>
                <button onClick={() => void saveAi(false)} disabled={Boolean(working)}>
                  <Save size={16} /> Speichern
                </button>
                <button
                  className="primary-button"
                  onClick={() => void saveAi(true)}
                  disabled={Boolean(working) || (!settings.configured && !apiKey.trim())}
                >
                  {working === 'test-ai' ? <LoaderCircle className="spin" size={16} /> : <Gauge size={16} />} Verbindung
                  testen
                </button>
              </div>
            </>
          )}
        </section>

        <section className="hub-panel voice-panel">
          <header>
            <div>
              <p className="eyebrow">Lokale Stimme</p>
              <h2>Text-to-Speech</h2>
            </div>
            <Mic2 size={20} />
          </header>
          <p className="panel-intro">
            Wähle eine Stimme. Fehlende Laufzeit und Modelle installiert das Studio automatisch.
          </p>
          {tts && (
            <>
              <div className="voice-list">
                {tts.presets.map((preset) => (
                  <button
                    key={preset.id}
                    className={tts.presetId === preset.id ? 'selected' : ''}
                    onClick={() => setTts({ ...tts, presetId: preset.id })}
                  >
                    <span className={`voice-engine ${preset.engine}`}>
                      <FileAudio size={18} />
                    </span>
                    <span>
                      <strong>{preset.label}</strong>
                      <small>{preset.description}</small>
                      <em>
                        {preset.engine} · {preset.size}
                        {preset.license ? ` · ${preset.license}` : ''}
                        {preset.commercialUse === false ? ' · nicht kommerziell' : ''}
                      </em>
                    </span>
                    {preset.installed ? <CheckCircle2 size={17} className="good-text" /> : <Cpu size={17} />}
                  </button>
                ))}
              </div>
              {tts.job && (
                <div className={`model-install-progress ${tts.job.status}`}>
                  <span>
                    {tts.job.status === 'running' ? (
                      <LoaderCircle size={17} className="spin" />
                    ) : (
                      <CheckCircle2 size={17} />
                    )}
                  </span>
                  <div>
                    <strong>{tts.job.message}</strong>
                    <small>
                      {tts.job.error ||
                        (tts.job.status === 'running'
                          ? 'Die Seite aktualisiert den Fortschritt automatisch.'
                          : 'Letzter Installationsstatus')}
                    </small>
                  </div>
                </div>
              )}
              <button
                className="primary-button voice-save"
                onClick={() => void saveTts()}
                disabled={Boolean(working) || tts.job?.status === 'running'}
              >
                <Volume2Icon />{' '}
                {tts.presets.find((preset) => preset.id === tts.presetId)?.installed
                  ? 'Stimme verwenden'
                  : 'Auswählen und installieren'}
              </button>
            </>
          )}
        </section>
      </div>

      <AiTeamPanel />

      <section className="hub-panel ai-task-panel">
        <header>
          <div>
            <p className="eyebrow">Aufgaben-Routing</p>
            <h2>Welche KI macht was?</h2>
          </div>
          <WandSparkles size={20} />
        </header>
        <div className="ai-task-grid">
          {settings?.taskPolicies.map((policy, index) => (
            <article key={policy.id}>
              <span>
                {index === 0 ? <NewspaperTaskIcon /> : index === 1 ? <Languages size={18} /> : <Sparkles size={18} />}
              </span>
              <div>
                <strong>{policy.label}</strong>
                <p>{policy.purpose}</p>
                <small>
                  {policy.freeOnly
                    ? 'Ausschließlich OpenRouter-Free · kein Paid-Fallback'
                    : `Fallback: ${policy.paidModels.slice(0, 2).join(' · ') || 'nur freie Modelle'}`}
                </small>
              </div>
            </article>
          ))}
        </div>
      </section>

      <footer className="ai-page-footer">
        <span>
          <CheckCircle2 size={15} /> Modelle werden pro Aufgabe gewählt; freie Modelle haben Vorrang.
        </span>
        <Link to={routes.mediaSettings}>
          Medien-KI konfigurieren <ArrowRight size={15} />
        </Link>
      </footer>
    </section>
  );
}

function Volume2Icon() {
  return <AudioLines size={16} />;
}

function NewspaperTaskIcon() {
  return <WandSparkles size={18} />;
}
