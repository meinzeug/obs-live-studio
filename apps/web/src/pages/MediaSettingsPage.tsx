import React, { useEffect, useState } from 'react';
import { Activity, ExternalLink, Image, KeyRound, RotateCw, Save, WandSparkles } from 'lucide-react';
import { api, can, type SessionUser } from '../api/client.js';

type MediaSettings = {
  commonsEnabled: boolean;
  wikimediaUserAgent: string;
  pexelsConfigured: boolean;
  pexelsApiKeyHint: string;
  pixabayConfigured: boolean;
  pixabayApiKeyHint: string;
  youtubeConfigured: boolean;
  youtubeDataApiKeyHint: string;
  aiEnabled: boolean;
  autoImportVideo: boolean;
  autoImportGraphic: boolean;
  discoveryMaxCandidates: number;
  maxVideoDurationSeconds: number;
};

export function MediaSettingsPage({ user }: { user: SessionUser }) {
  const [settings, setSettings] = useState<MediaSettings>();
  const [pexelsApiKey, setPexelsApiKey] = useState('');
  const [pixabayApiKey, setPixabayApiKey] = useState('');
  const [youtubeDataApiKey, setYoutubeDataApiKey] = useState('');
  const [clearPexelsApiKey, setClearPexelsApiKey] = useState(false);
  const [clearPixabayApiKey, setClearPixabayApiKey] = useState(false);
  const [clearYoutubeDataApiKey, setClearYoutubeDataApiKey] = useState(false);
  const [error, setError] = useState('');
  const [message, setMessage] = useState('');
  const [working, setWorking] = useState(false);
  const [testingProvider, setTestingProvider] = useState('');
  const [providerChecks, setProviderChecks] = useState<Record<string, string>>({});
  const allowed = can(user, 'users:write');

  async function load() {
    setError('');
    try {
      setSettings(await api<MediaSettings>('/api/media/settings'));
    } catch (error) {
      setError(error instanceof Error ? error.message : String(error));
    }
  }

  useEffect(() => {
    void load();
  }, []);

  async function save() {
    if (!settings || !allowed || working) return;
    setWorking(true);
    setError('');
    try {
      const saved = await api<MediaSettings>('/api/media/settings', {
        method: 'POST',
        body: JSON.stringify({
          commonsEnabled: settings.commonsEnabled,
          wikimediaUserAgent: settings.wikimediaUserAgent,
          pexelsApiKey: pexelsApiKey || undefined,
          clearPexelsApiKey,
          pixabayApiKey: pixabayApiKey || undefined,
          clearPixabayApiKey,
          youtubeDataApiKey: youtubeDataApiKey || undefined,
          clearYoutubeDataApiKey,
          aiEnabled: settings.aiEnabled,
          autoImportVideo: settings.autoImportVideo,
          autoImportGraphic: settings.autoImportGraphic,
          discoveryMaxCandidates: settings.discoveryMaxCandidates,
          maxVideoDurationSeconds: settings.maxVideoDurationSeconds,
        }),
      });
      setSettings(saved);
      setPexelsApiKey('');
      setPixabayApiKey('');
      setYoutubeDataApiKey('');
      setClearPexelsApiKey(false);
      setClearPixabayApiKey(false);
      setClearYoutubeDataApiKey(false);
      setMessage('Video- und Medienrecherche-Einstellungen gespeichert. Der Worker verwendet sie beim nächsten Lauf.');
    } catch (error) {
      setError(error instanceof Error ? error.message : String(error));
    } finally {
      setWorking(false);
    }
  }

  async function testProvider(provider: 'wikimedia' | 'pexels' | 'pixabay' | 'youtube') {
    if (testingProvider) return;
    setTestingProvider(provider);
    setError('');
    try {
      const result = await api<{ message: string; checkedAt: string }>('/api/media/settings/test', {
        method: 'POST',
        body: JSON.stringify({ provider }),
      });
      setProviderChecks((current) => ({
        ...current,
        [provider]: `${result.message} ${new Date(result.checkedAt).toLocaleTimeString('de-DE')}`,
      }));
    } catch (error) {
      setProviderChecks((current) => ({
        ...current,
        [provider]: error instanceof Error ? error.message : String(error),
      }));
    } finally {
      setTestingProvider('');
    }
  }

  function keyField(
    label: string,
    hint: string,
    configured: boolean,
    value: string,
    setValue: (value: string) => void,
    clear: boolean,
    setClear: (value: boolean) => void,
    url: string,
    provider: 'pexels' | 'pixabay' | 'youtube',
  ) {
    return (
      <article className="settings-option ai-key-option">
        <span>{label}</span>
        <small>
          {configured
            ? `Gespeichert: ${hint}. Leer lassen zum Beibehalten.`
            : 'API-Key eintragen, falls dieser Anbieter genutzt werden soll.'}
        </small>
        <span className="ai-key-input">
          <KeyRound size={16} aria-hidden="true" />
          <input
            aria-label={label}
            type="password"
            autoComplete="off"
            disabled={!allowed || working}
            value={value}
            onChange={(event) => setValue(event.target.value)}
          />
        </span>
        <label className="toggle-row">
          <input
            type="checkbox"
            disabled={!allowed || working}
            checked={clear}
            onChange={(event) => setClear(event.target.checked)}
          />
          Gespeicherten Key entfernen
        </label>
        <button
          disabled={!allowed || !configured || Boolean(testingProvider)}
          onClick={() => void testProvider(provider)}
          type="button"
        >
          <Activity size={15} /> {testingProvider === provider ? 'Prüft …' : 'Verbindung prüfen'}
        </button>
        {providerChecks[provider] && <small className="provider-check-result">{providerChecks[provider]}</small>}
        <a href={url} target="_blank" rel="noreferrer">
          Anbieter-Key verwalten <ExternalLink size={13} />
        </a>
      </article>
    );
  }

  return (
    <section className="panel settings-page">
      <div className="page-title">
        <div>
          <p className="eyebrow">Medienrecherche</p>
          <h2>Video- und Nachrichtenmedien</h2>
          <p>Provider-Keys, automatische Medienauswahl und KI-gestützte Suchbegriffe für Beitragsvideos verwalten.</p>
        </div>
        <span className="settings-title-icon" aria-hidden="true">
          <Image size={21} />
        </span>
      </div>

      {!allowed && <p className="settings-permission-note">Für Änderungen fehlt die Berechtigung „users:write“.</p>}
      {error && (
        <div className="settings-load-error" role="alert">
          <div>
            <strong>Medien-Einstellungen konnten nicht geladen oder gespeichert werden.</strong>
            <span>{error}</span>
          </div>
          <button className="ghost-button" onClick={() => void load()}>
            <RotateCw size={16} /> Erneut versuchen
          </button>
        </div>
      )}

      {settings ? (
        <>
          <section className="settings-section" aria-labelledby="media-provider-settings-title">
            <div className="settings-section-header">
              <div>
                <p className="eyebrow">Provider</p>
                <h3 id="media-provider-settings-title">API-Keys für Video- und Bildsuche</h3>
                <p>Wikimedia Commons läuft ohne Key; Pexels, Pixabay und YouTube benötigen eigene Schlüssel.</p>
              </div>
              <KeyRound size={19} aria-hidden="true" />
            </div>
            <div className="settings-automation-grid">
              {keyField(
                'Pexels API-Key',
                settings.pexelsApiKeyHint,
                settings.pexelsConfigured,
                pexelsApiKey,
                setPexelsApiKey,
                clearPexelsApiKey,
                setClearPexelsApiKey,
                'https://www.pexels.com/api/',
                'pexels',
              )}
              {keyField(
                'Pixabay API-Key',
                settings.pixabayApiKeyHint,
                settings.pixabayConfigured,
                pixabayApiKey,
                setPixabayApiKey,
                clearPixabayApiKey,
                setClearPixabayApiKey,
                'https://pixabay.com/api/docs/',
                'pixabay',
              )}
              {keyField(
                'YouTube Data API-Key',
                settings.youtubeDataApiKeyHint,
                settings.youtubeConfigured,
                youtubeDataApiKey,
                setYoutubeDataApiKey,
                clearYoutubeDataApiKey,
                setClearYoutubeDataApiKey,
                'https://console.cloud.google.com/apis/library/youtube.googleapis.com',
                'youtube',
              )}
              <div className="settings-option settings-toggle-option">
                <span>Wikimedia Commons</span>
                <small>Lizenzierte öffentliche Videos und Bilder ohne API-Key durchsuchen.</small>
                <label className="toggle-row">
                  <input
                    disabled={!allowed || working}
                    type="checkbox"
                    checked={settings.commonsEnabled}
                    onChange={(event) => setSettings({ ...settings, commonsEnabled: event.target.checked })}
                  />
                  Commons aktiv
                </label>
                <label>
                  Kontaktfähiger API-User-Agent
                  <input
                    disabled={!allowed || working}
                    value={settings.wikimediaUserAgent}
                    onChange={(event) => setSettings({ ...settings, wikimediaUserAgent: event.target.value })}
                  />
                </label>
                <button
                  disabled={!settings.commonsEnabled || Boolean(testingProvider)}
                  onClick={() => void testProvider('wikimedia')}
                >
                  <Activity size={15} /> {testingProvider === 'wikimedia' ? 'Prüft …' : 'Verbindung prüfen'}
                </button>
                {providerChecks.wikimedia && (
                  <small className="provider-check-result">{providerChecks.wikimedia}</small>
                )}
                <a href="https://api.wikimedia.org/wiki/Documentation" target="_blank" rel="noreferrer">
                  Wikimedia-API-Dokumentation <ExternalLink size={13} />
                </a>
              </div>
            </div>
            <p className="settings-permission-note">
              YouTube wird für Creative-Commons-Referenzen und Vorschauen durchsucht. Der Data-API-Key selbst erlaubt
              keinen Datei-Download; automatische lokale Downloads erfolgen nur bei Anbietern mit direkter, lizenzierter
              Mediendatei wie Wikimedia, Pexels oder Pixabay.
            </p>
          </section>

          <section className="settings-section" aria-labelledby="media-automation-settings-title">
            <div className="settings-section-header">
              <div>
                <p className="eyebrow">Automatik</p>
                <h3 id="media-automation-settings-title">Videoerstellung und Medienauswahl</h3>
                <p>OpenRouter kann passende Suchbegriffe erzeugen; Import und Grenzen bleiben lokal abgesichert.</p>
              </div>
              <WandSparkles size={19} aria-hidden="true" />
            </div>
            <div className="settings-automation-grid">
              <label className="settings-option settings-toggle-option">
                <span>OpenRouter für Videoerstellung</span>
                <small>
                  KI erzeugt Suchbegriffe für Beitragsvideos; vorhandene Medienpipeline importiert nur lizenzsichere
                  Treffer.
                </small>
                <span className="toggle-row">
                  <input
                    disabled={!allowed || working}
                    type="checkbox"
                    checked={settings.aiEnabled}
                    onChange={(event) => setSettings({ ...settings, aiEnabled: event.target.checked })}
                  />
                  KI-Suchbegriffe aktivieren
                </span>
              </label>
              <label className="settings-option settings-toggle-option">
                <span>Video automatisch importieren</span>
                <small>Bestes geprüftes Video direkt lokal speichern und für Sendungen freigeben.</small>
                <span className="toggle-row">
                  <input
                    disabled={!allowed || working}
                    type="checkbox"
                    checked={settings.autoImportVideo}
                    onChange={(event) => setSettings({ ...settings, autoImportVideo: event.target.checked })}
                  />
                  Automatischer Videoimport
                </span>
              </label>
              <label className="settings-option settings-toggle-option">
                <span>Grafik automatisch importieren</span>
                <small>Zahlenkarten oder Bilder zusätzlich als Beitragseinblendung bereitstellen.</small>
                <span className="toggle-row">
                  <input
                    disabled={!allowed || working}
                    type="checkbox"
                    checked={settings.autoImportGraphic}
                    onChange={(event) => setSettings({ ...settings, autoImportGraphic: event.target.checked })}
                  />
                  Automatischer Grafikimport
                </span>
              </label>
              <label className="settings-option">
                <span>Maximale Treffer</span>
                <small>Wie viele Medienkandidaten pro Beitrag behalten werden.</small>
                <input
                  disabled={!allowed || working}
                  type="number"
                  min="1"
                  max="100"
                  value={settings.discoveryMaxCandidates}
                  onChange={(event) => setSettings({ ...settings, discoveryMaxCandidates: Number(event.target.value) })}
                />
              </label>
              <label className="settings-option">
                <span>Maximale Videolänge</span>
                <small>Automatisch importierte Videos dürfen höchstens so viele Sekunden lang sein.</small>
                <input
                  disabled={!allowed || working}
                  type="number"
                  min="5"
                  max={6 * 60 * 60}
                  value={settings.maxVideoDurationSeconds}
                  onChange={(event) =>
                    setSettings({ ...settings, maxVideoDurationSeconds: Number(event.target.value) })
                  }
                />
              </label>
              <button
                className="primary-button settings-save-button"
                disabled={!allowed || working}
                onClick={() => void save()}
              >
                {working ? <Activity size={17} /> : <Save size={17} />}{' '}
                {working ? 'Wird gespeichert …' : 'Medien-Einstellungen speichern'}
              </button>
            </div>
          </section>
        </>
      ) : !error ? (
        <p className="muted">Medien-Einstellungen werden geladen …</p>
      ) : null}

      {message && (
        <p className="settings-status" role="status">
          {message}
        </p>
      )}
    </section>
  );
}
