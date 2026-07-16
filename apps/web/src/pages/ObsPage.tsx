import React, { useEffect, useRef, useState } from 'react';
import {
  AlertTriangle,
  CircleStop,
  Clock3,
  ExternalLink,
  Gauge,
  Link2,
  MonitorUp,
  Play,
  Plus,
  Power,
  RadioTower,
  RefreshCw,
  Save,
  Settings2,
  ShieldCheck,
  Trash2,
  UserRoundCog,
} from 'lucide-react';
import {
  api,
  can,
  type PublicStreamTarget,
  type SessionUser,
  type StreamingPlatformId,
  type StudioProfile,
} from '../api/client.js';

type EditableStreamTarget = Omit<PublicStreamTarget, 'managedId' | 'obsServiceName'> & {
  keyConfigured: boolean;
  key: string;
};

type StreamTargetSettings = {
  primary: EditableStreamTarget;
  additionalTargets: EditableStreamTarget[];
  supportedPlatforms: StudioProfile['supportedPlatforms'];
};

type TargetFieldsProps = {
  target: EditableStreamTarget;
  platforms: StudioProfile['supportedPlatforms'];
  disabled: boolean;
  onChange: (patch: Partial<EditableStreamTarget>) => void;
};

function TargetFields({ target, platforms, disabled, onChange }: TargetFieldsProps) {
  const selectedPlatform = platforms.find((candidate) => candidate.id === target.platform);

  function changePlatform(platform: StreamingPlatformId) {
    const definition = platforms.find((candidate) => candidate.id === platform);
    const previousDefinition = platforms.find((candidate) => candidate.id === target.platform);
    onChange({
      platform,
      name: !target.name || target.name === previousDefinition?.label ? definition?.label || '' : target.name,
      server: definition?.defaultServer ?? '',
      key: '',
      keyConfigured: false,
    });
  }

  return (
    <div className="stream-target-fields">
      <label>
        <span>Name</span>
        <input
          disabled={disabled}
          maxLength={100}
          value={target.name}
          placeholder="z. B. Twitch Hauptkanal"
          onChange={(event) => onChange({ name: event.target.value })}
        />
      </label>
      <label>
        <span>Plattform</span>
        <select
          disabled={disabled}
          value={target.platform}
          onChange={(event) => changePlatform(event.target.value as StreamingPlatformId)}
        >
          {platforms.map((platform) => (
            <option value={platform.id} key={platform.id}>
              {platform.label}
            </option>
          ))}
        </select>
        {selectedPlatform?.setupUrl && (
          <a href={selectedPlatform.setupUrl} target="_blank" rel="noreferrer">
            Stream-Dashboard öffnen <ExternalLink size={12} />
          </a>
        )}
      </label>
      <label className="stream-target-wide">
        <span>RTMP-/RTMPS-Server</span>
        <input
          disabled={disabled}
          inputMode="url"
          value={target.server}
          placeholder="rtmps://stream.example/live"
          onChange={(event) => onChange({ server: event.target.value })}
        />
      </label>
      <label>
        <span>Streamschlüssel</span>
        <input
          disabled={disabled}
          type="password"
          autoComplete="new-password"
          value={target.key}
          placeholder={target.keyConfigured ? 'Gespeichert – leer lassen zum Beibehalten' : 'Streamschlüssel eingeben'}
          onChange={(event) => onChange({ key: event.target.value })}
        />
      </label>
      <label>
        <span>Kanal-URL (optional)</span>
        <input
          disabled={disabled}
          inputMode="url"
          value={target.channelUrl}
          placeholder="https://…"
          onChange={(event) => onChange({ channelUrl: event.target.value })}
        />
      </label>
    </div>
  );
}

export function ObsPage({
  user,
  studio,
  onStudioChange,
}: {
  user: SessionUser;
  studio: StudioProfile;
  onStudioChange: (studio: StudioProfile) => void;
}) {
  const [obs, setObs] = useState<any>();
  const [obsError, setObsError] = useState('');
  const [message, setMessage] = useState('');
  const [targetSettings, setTargetSettings] = useState<StreamTargetSettings>();
  const [targetLoading, setTargetLoading] = useState(false);
  const [targetError, setTargetError] = useState('');
  const [savingTargets, setSavingTargets] = useState(false);
  const obsLoadRevision = useRef(0);
  const allowed = can(user, 'obs:write');

  async function load() {
    const revision = ++obsLoadRevision.current;
    try {
      const next = await api('/api/obs/status');
      if (revision !== obsLoadRevision.current) return;
      setObs(next);
      setObsError('');
    } catch (error) {
      if (revision === obsLoadRevision.current) setObsError(error instanceof Error ? error.message : String(error));
    }
  }

  async function loadTargetSettings() {
    if (!allowed) return;
    setTargetLoading(true);
    setTargetError('');
    try {
      setTargetSettings(await api<StreamTargetSettings>('/api/stream-targets'));
    } catch (error) {
      setTargetError(error instanceof Error ? error.message : String(error));
    } finally {
      setTargetLoading(false);
    }
  }

  useEffect(() => {
    void load();
    const timer = window.setInterval(() => void load(), 5000);
    return () => {
      obsLoadRevision.current++;
      window.clearInterval(timer);
    };
  }, []);

  useEffect(() => {
    void loadTargetSettings();
  }, [allowed]);

  async function post(path: string, successMessage = 'Ausgeführt') {
    try {
      await api(path, { method: 'POST' });
      setMessage(successMessage);
      await load();
    } catch (error) {
      setMessage(error instanceof Error ? error.message : String(error));
      await load().catch(() => undefined);
    }
  }

  const live = Boolean(obs?.stream?.outputActive);
  const processRunning = obs?.process?.state === 'running';
  const connected = obs?.status === 'connected';
  const activeAdditionalTargets = studio.additionalTargets.filter((target) => target.enabled);
  const multistream = obs?.process?.multistream;
  const multistreamEnabled = activeAdditionalTargets.length > 0;
  const multistreamReady = !multistreamEnabled || multistream?.ready === true;
  const multistreamErrors = Array.isArray(multistream?.checks)
    ? multistream.checks.filter((check: any) => check?.status === 'error')
    : [];
  const destinationNames = [studio.primary.name, ...activeAdditionalTargets.map((target) => target.name)];
  const destinationLabel = destinationNames.join(' + ');
  const backups = obs?.process?.backups;
  const backupStatus = backups?.status ?? 'error';
  const backupReady = backupStatus === 'ready';
  const backupLabel = backupReady ? 'bereit' : backupStatus === 'warning' ? 'prüfen' : 'gestört';
  const backupProblems = Array.isArray(backups?.checks)
    ? backups.checks.filter((check: any) => check?.status !== 'ok')
    : [];
  const backupDetail = backups?.backup?.name
    ? backups?.rehearsal?.ok === true
      ? 'Backup und Wiederherstellungsprobe geprüft'
      : 'Backup vorhanden, Wiederherstellungsprobe offen'
    : 'Kein aktuelles Backup erkannt';

  async function resetYouTubeAccount() {
    if (!window.confirm('Aktuelle YouTube-Anmeldung aus OBS entfernen und OBS neu starten?')) return;
    await post('/api/obs/youtube/reset', 'YouTube-Konto getrennt; OBS wurde neu gestartet.');
  }

  function updatePrimary(patch: Partial<EditableStreamTarget>) {
    setTargetSettings((current) => (current ? { ...current, primary: { ...current.primary, ...patch } } : current));
  }

  function updateAdditional(id: string, patch: Partial<EditableStreamTarget>) {
    setTargetSettings((current) =>
      current
        ? {
            ...current,
            additionalTargets: current.additionalTargets.map((target) =>
              target.id === id ? { ...target, ...patch } : target,
            ),
          }
        : current,
    );
  }

  function addAdditionalTarget() {
    setTargetSettings((current) => {
      if (!current || current.additionalTargets.length >= 8) return current;
      const preferredPlatform = current.primary.platform === 'twitch' ? 'youtube' : 'twitch';
      const definition = current.supportedPlatforms.find((platform) => platform.id === preferredPlatform);
      const id = `target-${Date.now().toString(36)}`;
      const target: EditableStreamTarget = {
        id,
        name: definition?.label ?? 'Neues Streaming-Ziel',
        platform: preferredPlatform,
        server: definition?.defaultServer ?? '',
        channelUrl: '',
        enabled: false,
        configured: false,
        secure: true,
        syncStart: true,
        syncStop: true,
        keyConfigured: false,
        key: '',
      };
      return { ...current, additionalTargets: [...current.additionalTargets, target] };
    });
  }

  async function saveTargetSettings() {
    if (!targetSettings) return;
    setSavingTargets(true);
    setMessage('');
    try {
      const response = await api<{ settings: StreamTargetSettings; studio: StudioProfile }>('/api/stream-targets', {
        method: 'POST',
        body: JSON.stringify({
          primary: {
            name: targetSettings.primary.name,
            platform: targetSettings.primary.platform,
            server: targetSettings.primary.server,
            channelUrl: targetSettings.primary.channelUrl,
            key: targetSettings.primary.key,
          },
          additionalTargets: targetSettings.additionalTargets.map((target) => ({
            id: target.id,
            name: target.name,
            platform: target.platform,
            server: target.server,
            channelUrl: target.channelUrl,
            enabled: target.enabled,
            syncStart: target.syncStart,
            syncStop: target.syncStop,
            key: target.key,
          })),
        }),
      });
      setTargetSettings(response.settings);
      onStudioChange(response.studio);
      setMessage('Streaming-Ziele gespeichert und auf OBS angewendet.');
      await load();
    } catch (error) {
      setMessage(error instanceof Error ? error.message : String(error));
      await load().catch(() => undefined);
    } finally {
      setSavingTargets(false);
    }
  }

  return (
    <section className="panel">
      <div className="page-title">
        <div>
          <p className="eyebrow">Ausgabe</p>
          <h2>OBS und Livestream</h2>
          <p>
            Studio-Prozess, Szenenverbindung und Ausgabe für {destinationLabel || 'das konfigurierte Streaming-Ziel'}
            zentral steuern.
          </p>
        </div>
        <div className="page-title-actions">
          <span className={`state-pill ${live ? 'live' : ''}`}>
            <RadioTower size={12} /> {live ? `${destinationLabel} Live` : 'Offline'}
          </span>
          {studio.channelUrl && (
            <a className="button" href={studio.channelUrl} target="_blank" rel="noreferrer">
              {studio.channelName} <ExternalLink size={15} />
            </a>
          )}
        </div>
      </div>

      {obsError && (
        <div className="status-message status-error" role="alert">
          <AlertTriangle size={19} />
          <div>
            <strong>OBS-Status kann derzeit nicht aktualisiert werden</strong>
            <p>{obsError}</p>
          </div>
        </div>
      )}

      <div className="stats-grid">
        <article className="stat">
          <div>
            <span>Hauptziel</span>
            <strong>{studio.primary.name}</strong>
            <small>
              {studio.primary.configured ? 'Server und Schlüssel konfiguriert' : 'Konfiguration unvollständig'}
            </small>
          </div>
          <span className={`stat-icon ${studio.primary.configured ? 'success' : 'warning'}`}>
            {studio.primary.configured ? <ShieldCheck size={18} /> : <AlertTriangle size={18} />}
          </span>
        </article>
        <article className="stat">
          <div>
            <span>OBS-Verbindung</span>
            <strong>{obs?.status ?? 'unbekannt'}</strong>
            <small>WebSocket-Steuerung</small>
          </div>
          <span className={`stat-icon ${connected ? 'success' : 'warning'}`}>
            <MonitorUp size={18} />
          </span>
        </article>
        <article className="stat">
          <div>
            <span>Prozess</span>
            <strong>{obs?.process?.state ?? 'unbekannt'}</strong>
            <small>{obs?.process?.pid ? `PID ${obs.process.pid}` : 'Kein Prozess'}</small>
          </div>
          <span className={`stat-icon ${processRunning ? 'success' : 'warning'}`}>
            <Power size={18} />
          </span>
        </article>
        <article className="stat">
          <div>
            <span>Laufzeit</span>
            <strong>{obs?.stream?.outputTimecode ?? '00:00:00'}</strong>
            <small>{obs?.stream?.outputSkippedFrames ?? 0} ausgelassene Frames</small>
          </div>
          <span className={`stat-icon ${live ? 'live' : ''}`}>
            <Clock3 size={18} />
          </span>
        </article>
        <article className="stat">
          <div>
            <span>Auslastung</span>
            <strong>{Math.round((obs?.stream?.outputCongestion ?? 0) * 100)} %</strong>
            <small>Netzwerküberlastung</small>
          </div>
          <span className="stat-icon">
            <Gauge size={18} />
          </span>
        </article>
        {multistreamEnabled && (
          <article className="stat">
            <div>
              <span>Zusätzliche Ziele</span>
              <strong>{multistreamReady ? 'bereit' : 'blockiert'}</strong>
              <small>
                {multistreamReady
                  ? `${activeAdditionalTargets.length} Ziel(e) synchron geprüft`
                  : `${multistreamErrors.length || 1} Konfigurationsfehler`}
              </small>
            </div>
            <span className={`stat-icon ${multistreamReady ? 'success' : 'warning'}`}>
              {multistreamReady ? <ShieldCheck size={18} /> : <AlertTriangle size={18} />}
            </span>
          </article>
        )}
        <article className="stat">
          <div>
            <span>Datensicherung</span>
            <strong>{backupLabel}</strong>
            <small>{backupDetail}</small>
          </div>
          <span className={`stat-icon ${backupReady ? 'success' : 'warning'}`}>
            {backupReady ? <ShieldCheck size={18} /> : <AlertTriangle size={18} />}
          </span>
        </article>
      </div>

      <section className="stream-target-editor" aria-labelledby="stream-target-settings-title">
        <div className="settings-section-header">
          <div>
            <p className="eyebrow">Ausgabeziele</p>
            <h3 id="stream-target-settings-title">Streaming-Ziele konfigurieren</h3>
            <p>
              Ein Hauptziel und bis zu acht parallele Ziele über das OBS-Multi-RTMP-Plugin. Für weitere Anbieter
              „Benutzerdefiniertes RTMP-Ziel“ wählen.
            </p>
          </div>
          <RadioTower size={19} aria-hidden="true" />
        </div>

        {!allowed ? (
          <p className="settings-permission-note">Für Änderungen fehlt die Berechtigung „obs:write“.</p>
        ) : targetLoading ? (
          <p className="muted">Streaming-Ziele werden geladen …</p>
        ) : targetError ? (
          <div className="settings-load-error" role="alert">
            <div>
              <strong>Streaming-Ziele konnten nicht geladen werden.</strong>
              <span>{targetError}</span>
            </div>
            <button className="ghost-button" onClick={() => void loadTargetSettings()}>
              <RefreshCw size={16} /> Erneut versuchen
            </button>
          </div>
        ) : targetSettings ? (
          <form
            className="stream-target-form"
            onSubmit={(event) => {
              event.preventDefault();
              void saveTargetSettings();
            }}
          >
            <fieldset disabled={savingTargets || live}>
              <article className="stream-target-card">
                <div className="stream-target-card-header">
                  <div>
                    <span className="eyebrow">Hauptziel</span>
                    <h4>{targetSettings.primary.name || 'Primäres Streaming-Ziel'}</h4>
                  </div>
                  <span
                    className={`state-pill ${targetSettings.primary.keyConfigured || targetSettings.primary.key ? 'success' : 'warning'}`}
                  >
                    {targetSettings.primary.keyConfigured || targetSettings.primary.key
                      ? 'Schlüssel hinterlegt'
                      : 'Schlüssel fehlt'}
                  </span>
                </div>
                <TargetFields
                  target={targetSettings.primary}
                  platforms={targetSettings.supportedPlatforms}
                  disabled={savingTargets || live}
                  onChange={updatePrimary}
                />
              </article>

              {targetSettings.additionalTargets.map((target) => (
                <article className="stream-target-card" key={target.id}>
                  <div className="stream-target-card-header">
                    <div>
                      <span className="eyebrow">Paralleles Ziel</span>
                      <h4>{target.name || 'Zusätzliches Streaming-Ziel'}</h4>
                    </div>
                    <button
                      className="ghost-button icon-button"
                      type="button"
                      title="Ziel entfernen"
                      aria-label={`${target.name || 'Streaming-Ziel'} entfernen`}
                      onClick={() =>
                        setTargetSettings((current) =>
                          current
                            ? {
                                ...current,
                                additionalTargets: current.additionalTargets.filter(
                                  (candidate) => candidate.id !== target.id,
                                ),
                              }
                            : current,
                        )
                      }
                    >
                      <Trash2 size={16} />
                    </button>
                  </div>
                  <div className="stream-target-toggles">
                    <label className="toggle-row">
                      <input
                        type="checkbox"
                        checked={target.enabled}
                        onChange={(event) => updateAdditional(target.id, { enabled: event.target.checked })}
                      />
                      Ziel aktiv
                    </label>
                    <label className="toggle-row">
                      <input
                        type="checkbox"
                        checked={target.syncStart}
                        onChange={(event) => updateAdditional(target.id, { syncStart: event.target.checked })}
                      />
                      Synchron starten
                    </label>
                    <label className="toggle-row">
                      <input
                        type="checkbox"
                        checked={target.syncStop}
                        onChange={(event) => updateAdditional(target.id, { syncStop: event.target.checked })}
                      />
                      Synchron stoppen
                    </label>
                  </div>
                  <TargetFields
                    target={target}
                    platforms={targetSettings.supportedPlatforms}
                    disabled={savingTargets || live}
                    onChange={(patch) => updateAdditional(target.id, patch)}
                  />
                </article>
              ))}
            </fieldset>

            <div className="stream-target-actions">
              <button
                type="button"
                disabled={savingTargets || live || targetSettings.additionalTargets.length >= 8}
                onClick={addAdditionalTarget}
              >
                <Plus size={16} /> Zusätzliches Ziel
              </button>
              <button className="primary-button" type="submit" disabled={savingTargets || live}>
                <Save size={16} /> {savingTargets ? 'Wird angewendet …' : 'Ziele speichern und anwenden'}
              </button>
            </div>
            <p className="stream-target-help">
              Gespeicherte Schlüssel bleiben verborgen. Das leere Schlüssel-Feld behält den vorhandenen Schlüssel bei.
              Bei einem Plattformwechsel muss ein neuer Schlüssel eingetragen werden.
            </p>
            {live && (
              <p className="settings-permission-note">
                Während einer laufenden Sendung können Streaming-Ziele nicht geändert werden.
              </p>
            )}
          </form>
        ) : null}
      </section>

      {activeAdditionalTargets.length > 0 && (
        <div className="detail-grid">
          {activeAdditionalTargets.map((target) => (
            <article className="detail-card" key={target.id}>
              <strong>{target.name}</strong>
              <span>{target.platform}</span>
              <p>{target.configured ? 'Zusätzliches Ziel ist konfiguriert.' : 'Server oder Streamschlüssel fehlt.'}</p>
              {target.channelUrl && (
                <a href={target.channelUrl} target="_blank" rel="noreferrer">
                  Kanal öffnen <ExternalLink size={14} />
                </a>
              )}
            </article>
          ))}
        </div>
      )}

      <div className="control-surface">
        <div className="control-group">
          <span className="control-label">OBS-Prozess</span>
          <button disabled={!allowed || processRunning} onClick={() => post('/api/obs/process/start')}>
            <Power size={16} /> Starten
          </button>
          <button disabled={!allowed || !processRunning} onClick={() => post('/api/obs/process/restart')}>
            <RefreshCw size={16} /> Neu starten
          </button>
        </div>
        <div className="control-group">
          <span className="control-label">Studio</span>
          <button disabled={!allowed || connected} onClick={() => post('/api/obs/connect')}>
            <Link2 size={16} /> Verbinden
          </button>
          <button disabled={!allowed || !connected} onClick={() => post('/api/obs/setup')}>
            <Settings2 size={16} /> Szenen wiederherstellen
          </button>
          {studio.primary.platform === 'youtube' && (
            <button disabled={!allowed || live} onClick={() => void resetYouTubeAccount()}>
              <UserRoundCog size={16} /> YouTube-Konto wechseln
            </button>
          )}
        </div>
        <div className="control-group">
          <span className="control-label">Livestream-Ziele</span>
          <button
            className="primary-button"
            disabled={!allowed || live || !connected || !studio.primary.configured || !multistreamReady}
            title={!multistreamReady ? 'Alle zusätzlichen Ziele müssen zuerst erfolgreich geprüft werden.' : undefined}
            onClick={() => post('/api/stream/start')}
          >
            <Play size={16} /> {multistreamEnabled ? 'Mehrfachstream starten' : 'Livestream starten'}
          </button>
          <button className="danger" disabled={!allowed || !live} onClick={() => post('/api/stream/stop')}>
            <CircleStop size={16} /> {multistreamEnabled ? 'Mehrfachstream stoppen' : 'Livestream stoppen'}
          </button>
        </div>
      </div>

      {message && <p role="status">{message}</p>}
      {backups && !backupReady && (
        <div className={`status-message ${backupStatus === 'error' ? 'status-error' : ''}`} role="alert">
          <AlertTriangle size={19} />
          <div>
            <strong>Datensicherung benötigt Aufmerksamkeit</strong>
            <p>
              Das Studio hat ein fehlendes, veraltetes oder fehlerhaft geprüftes Backup beziehungsweise eine offene
              Wiederherstellungsprobe erkannt.
            </p>
            {backupProblems.map((check: any) => (
              <p key={check.id}>• {check.message}</p>
            ))}
          </div>
        </div>
      )}
      {multistreamEnabled && !multistreamReady && (
        <div className="status-message status-error" role="alert">
          <AlertTriangle size={19} />
          <div>
            <strong>Zusätzliche Streaming-Ziele sind nicht bereit</strong>
            <p>
              Der Sendestart bleibt blockiert, bis Plugin, Ziele, Synchronisierung, Streamschlüssel und Encoder-Sharing
              korrekt geprüft wurden.
            </p>
            {multistreamErrors.map((check: any) => (
              <p key={check.id}>• {check.message}</p>
            ))}
          </div>
        </div>
      )}
      {obs?.streamSupervisor?.supervisorLastError && (
        <div className="status-message status-error">
          <RadioTower size={19} />
          <div>
            <strong>Streamstart fehlgeschlagen</strong>
            <p>{obs.streamSupervisor.supervisorLastError}</p>
          </div>
        </div>
      )}
    </section>
  );
}
