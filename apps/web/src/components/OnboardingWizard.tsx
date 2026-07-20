import React, { useEffect, useMemo, useRef, useState } from 'react';
import {
  ArrowLeft,
  ArrowRight,
  BrainCircuit,
  Check,
  CheckCircle2,
  KeyRound,
  MonitorUp,
  RadioTower,
  Rocket,
  Upload,
  Volume2,
  X,
} from 'lucide-react';
import { useNavigate } from 'react-router-dom';
import { api, type SessionUser, type StudioProfile } from '../api/client.js';
import { routes } from '../navigation.js';

type OnboardingResponse = {
  completed: boolean;
  currentStep: number;
  dismissedAt: string | null;
  required: boolean;
  readiness: { sender: boolean; streaming: boolean; obs: boolean; ai: boolean; speech: boolean };
};

type ChannelIdentity = {
  channelName: string;
  studioName: string;
  logoConfigured: boolean;
  logoUrl: string;
  logoEnabled: boolean;
  logoVisibility: 'always' | 'streaming' | 'broadcast' | 'streaming-or-broadcast';
  logoPosition: 'top-left' | 'top-right' | 'bottom-left' | 'bottom-right';
  logoWidth: number;
  logoOpacity: number;
  logoMargin: number;
};

type EditableTarget = {
  id: string;
  name: string;
  platform: 'youtube' | 'twitch' | 'x' | 'rumble' | 'kick' | 'facebook' | 'linkedin' | 'custom';
  server: string;
  channelUrl: string;
  enabled: boolean;
  syncStart: boolean;
  syncStop: boolean;
  configured: boolean;
  keyConfigured: boolean;
  key: string;
};

type TargetSettings = {
  primary: EditableTarget;
  additionalTargets: EditableTarget[];
  supportedPlatforms: Array<{ id: EditableTarget['platform']; label: string; defaultServer: string | null }>;
};

type AiSettings = {
  configured: boolean;
  apiKeyHint: string;
  paidFallback: boolean;
  autoProcessIngest: boolean;
  dataCollection: 'allow' | 'deny';
};

type TtsSettings = {
  presetId: string;
  selected: { installed: boolean; label: string };
  presets: Array<{ id: string; label: string; description: string; installed: boolean; size: string }>;
  job: { status: string; message: string } | null;
};

const steps = [
  { label: 'Sender', icon: RadioTower },
  { label: 'Streaming', icon: KeyRound },
  { label: 'OBS', icon: MonitorUp },
  { label: 'KI & Stimme', icon: BrainCircuit },
  { label: 'Startklar', icon: Rocket },
];

export function OnboardingWizard({
  open,
  user,
  studio,
  onOpenChange,
  onStudioChange,
}: {
  open: boolean;
  user: SessionUser;
  studio: StudioProfile;
  onOpenChange: (open: boolean) => void;
  onStudioChange: (studio: StudioProfile) => void;
}) {
  const navigate = useNavigate();
  const logoInput = useRef<HTMLInputElement>(null);
  const [state, setState] = useState<OnboardingResponse | null>(null);
  const [identity, setIdentity] = useState<ChannelIdentity | null>(null);
  const [targets, setTargets] = useState<TargetSettings | null>(null);
  const [aiSettings, setAiSettings] = useState<AiSettings | null>(null);
  const [ttsSettings, setTtsSettings] = useState<TtsSettings | null>(null);
  const [aiKey, setAiKey] = useState('');
  const [working, setWorking] = useState('');
  const [message, setMessage] = useState('');
  const [error, setError] = useState('');
  const admin = user.role === 'administrator' || user.permissions.includes('users:write');
  const step = Math.max(0, Math.min(steps.length - 1, state?.currentStep ?? 0));

  async function load() {
    const onboarding = await api<OnboardingResponse>('/api/studio/onboarding');
    setState(onboarding);
    if (onboarding.required && admin) onOpenChange(true);
    if (!admin) return;
    const [nextIdentity, nextTargets, nextAi, nextTts] = await Promise.all([
      api<ChannelIdentity>('/api/channel/settings'),
      api<TargetSettings>('/api/stream-targets'),
      api<AiSettings>('/api/ai/settings'),
      api<TtsSettings>('/api/tts/settings'),
    ]);
    setIdentity(nextIdentity);
    setTargets(nextTargets);
    setAiSettings(nextAi);
    setTtsSettings(nextTts);
  }

  useEffect(() => {
    if (!admin) return;
    void load().catch((requestError) => setError(requestError instanceof Error ? requestError.message : String(requestError)));
  }, [admin]);

  async function setStep(nextStep: number) {
    const next = await api<OnboardingResponse>('/api/studio/onboarding', {
      method: 'POST',
      body: JSON.stringify({ currentStep: nextStep, dismissed: false }),
    });
    setState((current) => ({ ...(current ?? next), ...next }));
    setMessage('');
    setError('');
  }

  async function saveSender() {
    if (!identity) return;
    setWorking('sender');
    setError('');
    try {
      const result = await api<{ settings: ChannelIdentity; studio: StudioProfile; warning?: string }>(
        '/api/channel/settings',
        { method: 'POST', body: JSON.stringify(identity) },
      );
      setIdentity(result.settings);
      onStudioChange(result.studio);
      setMessage(result.warning || 'Senderprofil gespeichert und an OBS übergeben.');
    } catch (requestError) {
      setError(requestError instanceof Error ? requestError.message : String(requestError));
    } finally {
      setWorking('');
    }
  }

  async function uploadLogo(files: FileList | null) {
    const file = files?.[0];
    if (!file) return;
    const form = new FormData();
    form.append('file', file);
    setWorking('logo');
    setError('');
    try {
      const result = await api<{ settings: ChannelIdentity }>('/api/channel/logo', { method: 'POST', body: form });
      setIdentity(result.settings);
      setMessage('Senderlogo hochgeladen und in OBS aktualisiert.');
    } catch (requestError) {
      setError(requestError instanceof Error ? requestError.message : String(requestError));
    } finally {
      setWorking('');
    }
  }

  async function saveStreaming() {
    if (!targets) return;
    setWorking('streaming');
    setError('');
    try {
      const body = {
        primary: {
          name: targets.primary.name,
          platform: targets.primary.platform,
          server: targets.primary.server,
          channelUrl: targets.primary.channelUrl,
          key: targets.primary.key,
        },
        additionalTargets: targets.additionalTargets.map(({ id, name, platform, server, channelUrl, enabled, syncStart, syncStop, key }) => ({
          id, name, platform, server, channelUrl, enabled, syncStart, syncStop, key,
        })),
      };
      const result = await api<{ settings: TargetSettings; studio: StudioProfile; warning?: string }>('/api/stream-targets', {
        method: 'POST',
        body: JSON.stringify(body),
      });
      setTargets(result.settings);
      onStudioChange(result.studio);
      setMessage(result.warning || 'Streaming-Ziel geprüft, gespeichert und an OBS übergeben.');
    } catch (requestError) {
      setError(requestError instanceof Error ? requestError.message : String(requestError));
    } finally {
      setWorking('');
    }
  }

  async function obsAction(path: '/api/obs/connect' | '/api/obs/setup') {
    setWorking(path);
    setError('');
    try {
      await api(path, { method: 'POST' });
      setMessage(path.endsWith('setup') ? 'OBS-Szenen und Overlays wurden eingerichtet.' : 'OBS-Verbindung ist aktiv.');
      const refreshed = await api<OnboardingResponse>('/api/studio/onboarding');
      setState(refreshed);
    } catch (requestError) {
      setError(requestError instanceof Error ? requestError.message : String(requestError));
    } finally {
      setWorking('');
    }
  }

  async function saveAi() {
    if (!aiSettings) return;
    setWorking('ai');
    setError('');
    try {
      const saved = await api<AiSettings>('/api/ai/settings', {
        method: 'POST',
        body: JSON.stringify({
          apiKey: aiKey || undefined,
          paidFallback: aiSettings.paidFallback,
          autoProcessIngest: aiSettings.autoProcessIngest,
          dataCollection: aiSettings.dataCollection,
        }),
      });
      setAiSettings(saved);
      setAiKey('');
      setMessage('KI-Zugang geprüft und gespeichert.');
    } catch (requestError) {
      setError(requestError instanceof Error ? requestError.message : String(requestError));
    } finally {
      setWorking('');
    }
  }

  async function saveTts() {
    if (!ttsSettings) return;
    setWorking('tts');
    setError('');
    try {
      const saved = await api<TtsSettings>('/api/tts/settings', {
        method: 'POST',
        body: JSON.stringify({ presetId: ttsSettings.presetId }),
      });
      setTtsSettings(saved);
      setMessage(saved.selected.installed ? 'Stimme ist einsatzbereit.' : 'Installation wurde automatisch gestartet.');
    } catch (requestError) {
      setError(requestError instanceof Error ? requestError.message : String(requestError));
    } finally {
      setWorking('');
    }
  }

  async function close() {
    await api('/api/studio/onboarding', { method: 'POST', body: JSON.stringify({ dismissed: true }) }).catch(() => undefined);
    onOpenChange(false);
  }

  async function complete() {
    await api('/api/studio/onboarding', {
      method: 'POST',
      body: JSON.stringify({ currentStep: 4, completed: true, dismissed: false }),
    });
    setState((current) => current ? { ...current, completed: true, required: false } : current);
    onOpenChange(false);
    navigate(routes.overview);
  }

  const readinessCount = useMemo(
    () => state ? Object.values(state.readiness).filter(Boolean).length : 0,
    [state],
  );

  if (!open || !admin) return null;
  const StepIcon = steps[step].icon;

  return (
    <div className="studio-modal-backdrop onboarding-backdrop" role="presentation">
      <section className="onboarding-wizard" role="dialog" aria-modal="true" aria-labelledby="onboarding-title">
        <aside className="onboarding-rail">
          <div className="onboarding-brand"><RadioTower size={22} /><span><strong>Open TV Studio</strong><small>Einrichtungsassistent</small></span></div>
          <ol>
            {steps.map((item, index) => {
              const Icon = item.icon;
              return <li key={item.label} className={index === step ? 'active' : index < step ? 'done' : ''}>
                <span>{index < step ? <Check size={14} /> : <Icon size={15} />}</span>
                <div><strong>{item.label}</strong><small>Schritt {index + 1}</small></div>
              </li>;
            })}
          </ol>
          <div className="onboarding-readiness"><span><CheckCircle2 size={15} /> {readinessCount}/5 bereit</span><div><i style={{ width: `${readinessCount * 20}%` }} /></div></div>
        </aside>
        <main className="onboarding-main">
          <header>
            <span className="onboarding-step-icon"><StepIcon size={22} /></span>
            <div><p className="eyebrow">Schritt {step + 1} von {steps.length}</p><h2 id="onboarding-title">{steps[step].label}</h2></div>
            <button className="icon-button ghost-button" onClick={() => void close()} aria-label="Einrichtung später fortsetzen"><X size={19} /></button>
          </header>

          <div className="onboarding-content">
            {step === 0 && identity && <div className="wizard-task">
              <div><h3>Gib deinem Sender eine Identität</h3><p>Name und Logo erscheinen im Studio und auf Wunsch dauerhaft im TV-Bild.</p></div>
              <div className="wizard-brand-preview">
                <span>{identity.logoUrl ? <img src={identity.logoUrl} alt="Senderlogo" /> : <RadioTower size={30} />}</span>
                <div><strong>{identity.channelName || 'Dein Sender'}</strong><small>{identity.studioName || 'Open TV Studio'}</small></div>
              </div>
              <div className="wizard-form-grid">
                <label>Sendername<input value={identity.channelName} onChange={(event) => setIdentity({ ...identity, channelName: event.target.value })} /></label>
                <label>Studioname<input value={identity.studioName} onChange={(event) => setIdentity({ ...identity, studioName: event.target.value })} /></label>
              </div>
              <div className="wizard-inline-actions">
                <button onClick={() => logoInput.current?.click()} disabled={Boolean(working)}><Upload size={16} /> {identity.logoConfigured ? 'Logo ersetzen' : 'Logo hochladen'}</button>
                <button className="primary-button" onClick={() => void saveSender()} disabled={Boolean(working) || !identity.channelName.trim()}>{working === 'sender' ? 'Speichert …' : 'Senderprofil speichern'}</button>
                <input ref={logoInput} hidden type="file" accept="image/png,image/jpeg,image/webp,image/svg+xml" onChange={(event) => void uploadLogo(event.target.files)} />
              </div>
            </div>}

            {step === 1 && targets && <div className="wizard-task">
              <div><h3>Wohin soll dein Programm gesendet werden?</h3><p>Wähle die Plattform. Der technische Server wird automatisch vorausgefüllt, sofern die Plattform ihn vorgibt.</p></div>
              <div className="platform-picker">
                {targets.supportedPlatforms.map((platform) => <button key={platform.id} className={targets.primary.platform === platform.id ? 'selected' : ''} onClick={() => setTargets({ ...targets, primary: { ...targets.primary, platform: platform.id, name: platform.label, server: platform.defaultServer ?? targets.primary.server, key: platform.id === targets.primary.platform ? targets.primary.key : '' } })}><RadioTower size={17} />{platform.label}</button>)}
              </div>
              <div className="wizard-form-grid">
                <label>Stream-Server<input value={targets.primary.server} placeholder="rtmps://…" onChange={(event) => setTargets({ ...targets, primary: { ...targets.primary, server: event.target.value } })} /></label>
                <label>Streamschlüssel<input type="password" value={targets.primary.key} placeholder={targets.primary.keyConfigured ? 'Gespeichert – leer lassen' : 'Schlüssel einfügen'} onChange={(event) => setTargets({ ...targets, primary: { ...targets.primary, key: event.target.value } })} /></label>
                <label className="wizard-wide">Kanal-URL (optional)<input value={targets.primary.channelUrl} placeholder="https://…" onChange={(event) => setTargets({ ...targets, primary: { ...targets.primary, channelUrl: event.target.value } })} /></label>
              </div>
              <button className="primary-button" onClick={() => void saveStreaming()} disabled={Boolean(working) || !targets.primary.server.trim()}>{working === 'streaming' ? 'Prüft und verbindet …' : 'Ziel prüfen und verbinden'}</button>
            </div>}

            {step === 2 && <div className="wizard-task wizard-centered-task">
              <span className={`wizard-device ${state?.readiness.obs ? 'ready' : ''}`}><MonitorUp size={46} /></span>
              <div><h3>{state?.readiness.obs ? 'OBS ist verbunden' : 'OBS automatisch verbinden'}</h3><p>Das Studio erkennt OBS über WebSocket und richtet alle benötigten Szenen und Browserquellen selbst ein.</p></div>
              <div className="wizard-check-list"><span className={state?.readiness.obs ? 'ready' : ''}><Check size={15} /> WebSocket-Verbindung</span><span><Check size={15} /> Szenen und Overlays</span><span><Check size={15} /> Audio- und Medienquellen</span></div>
              <div className="wizard-inline-actions"><button onClick={() => void obsAction('/api/obs/connect')} disabled={Boolean(working)}>Verbindung testen</button><button className="primary-button" onClick={() => void obsAction('/api/obs/setup')} disabled={Boolean(working)}>OBS vollständig einrichten</button></div>
            </div>}

            {step === 3 && aiSettings && ttsSettings && <div className="wizard-task">
              <div><h3>KI und Sprecher einrichten</h3><p>OpenRouter übernimmt redaktionelle Aufgaben; die Sprachausgabe läuft lokal auf deinem System.</p></div>
              <section className="wizard-integration-card"><BrainCircuit size={21} /><div><strong>OpenRouter</strong><small>{aiSettings.configured ? `Verbunden · ${aiSettings.apiKeyHint}` : 'Noch nicht verbunden'}</small></div><input type="password" value={aiKey} onChange={(event) => setAiKey(event.target.value)} placeholder={aiSettings.configured ? 'Schlüssel beibehalten' : 'OpenRouter Schlüssel'} /><button onClick={() => void saveAi()} disabled={Boolean(working) || (!aiSettings.configured && !aiKey)}>Prüfen</button></section>
              <section className="wizard-integration-card"><Volume2 size={21} /><div><strong>Sprachausgabe</strong><small>{ttsSettings.selected.installed ? 'Einsatzbereit' : ttsSettings.job?.message || 'Wird bei Auswahl installiert'}</small></div><select value={ttsSettings.presetId} onChange={(event) => setTtsSettings({ ...ttsSettings, presetId: event.target.value })}>{ttsSettings.presets.map((preset) => <option key={preset.id} value={preset.id}>{preset.label} · {preset.size}</option>)}</select><button onClick={() => void saveTts()} disabled={Boolean(working)}>Auswählen</button></section>
            </div>}

            {step === 4 && <div className="wizard-task wizard-finish">
              <span><Rocket size={42} /></span><div><p className="eyebrow">Dein Sender ist startklar</p><h3>{studio.channelName} kann auf Sendung gehen</h3><p>Die Übersicht führt dich zum Live-Status. Der Autopilot, die Regie und alle Arbeitsbereiche sind jederzeit über die linke Studioleiste erreichbar.</p></div>
              <div className="wizard-summary-grid"><span className={state?.readiness.sender ? 'ready' : ''}><CheckCircle2 />Sender</span><span className={state?.readiness.streaming ? 'ready' : ''}><CheckCircle2 />Streaming</span><span className={state?.readiness.obs ? 'ready' : ''}><CheckCircle2 />OBS</span><span className={state?.readiness.ai ? 'ready' : ''}><CheckCircle2 />KI</span><span className={state?.readiness.speech ? 'ready' : ''}><CheckCircle2 />Stimme</span></div>
              <button className="primary-button wizard-launch" onClick={() => void complete()}><Rocket size={17} /> Studio öffnen</button>
            </div>}
          </div>

          {(message || error) && <div className={`wizard-message ${error ? 'error' : 'success'}`}>{error || message}</div>}
          <footer>
            <button className="ghost-button" disabled={step === 0} onClick={() => void setStep(step - 1)}><ArrowLeft size={16} /> Zurück</button>
            <span>Du kannst den Assistenten jederzeit schließen und später fortsetzen.</span>
            {step < steps.length - 1 && <button className="primary-button" onClick={() => void setStep(step + 1)}>Weiter <ArrowRight size={16} /></button>}
          </footer>
        </main>
      </section>
    </div>
  );
}
