import React, { useEffect, useMemo, useState } from 'react';
import {
  AlertTriangle,
  ArchiveRestore,
  BrainCircuit,
  CheckCircle2,
  ChevronRight,
  Database,
  HardDrive,
  HeartPulse,
  LoaderCircle,
  MonitorCog,
  RefreshCw,
  Server,
  Settings2,
  ShieldCheck,
  Users,
  Video,
  Wrench,
} from 'lucide-react';
import { Link } from 'react-router-dom';
import { api, can, type SessionUser } from '../api/client.js';
import { routes } from '../navigation.js';

type Diagnostic = {
  status: 'ok' | 'warning' | 'error';
  checkedAt: string;
  resources: {
    cpu: { percent: number };
    memory: { percent: number };
    disk: { percent: number } | null;
    gpu: { available: boolean; name: string | null; percent: number | null };
  };
  checks: Array<{
    id: string;
    label: string;
    status: 'ok' | 'warning' | 'error';
    summary: string;
    detail?: string;
    repairAction?: 'obs-reconnect' | 'obs-setup' | 'restore-overlays';
  }>;
};
const groups = [
  {
    title: 'Sender & Ausgabe',
    items: [
      { label: 'Senderprofil', description: 'Name, Logo und Corporate Design', to: routes.settings, icon: Video },
      { label: 'OBS & Streaming', description: 'Szenen, Ziele und Verbindung', to: routes.obs, icon: MonitorCog },
      {
        label: 'Medien-Engine',
        description: 'FFmpeg, Recherche und Formate',
        to: routes.mediaSettings,
        icon: HardDrive,
      },
    ],
  },
  {
    title: 'Intelligenz & Automation',
    items: [
      { label: 'KI und Sprache', description: 'Modelle, API und TTS', to: routes.aiStudio, icon: BrainCircuit },
      { label: 'Autopilot', description: '24/7 Regeln und Zeitformate', to: routes.automation, icon: Settings2 },
    ],
  },
  {
    title: 'Sicherheit & Betrieb',
    items: [
      { label: 'Benutzer & Rollen', description: 'Konten und Berechtigungen', to: routes.adminUsers, icon: Users },
      { label: 'Sitzungen', description: 'Zugriffe und aktive Geräte', to: routes.adminSessions, icon: ShieldCheck },
      {
        label: 'Backup & Wartung',
        description: 'Sicherung, Restore und Updates',
        to: routes.settings,
        icon: ArchiveRestore,
      },
    ],
  },
];
export function SystemPage({ user }: { user: SessionUser }) {
  const [data, setData] = useState<Diagnostic | null>(null),
    [loading, setLoading] = useState(true),
    [working, setWorking] = useState(''),
    [error, setError] = useState('');
  const allowed = can(user, 'users:write');
  async function load() {
    if (!allowed) return;
    setLoading(true);
    setError('');
    try {
      setData(await api<Diagnostic>('/api/system/diagnostics'));
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    } finally {
      setLoading(false);
    }
  }
  useEffect(() => {
    void load();
  }, [allowed]);
  async function repair(action: NonNullable<Diagnostic['checks'][number]['repairAction']>) {
    setWorking(action);
    try {
      await api('/api/system/repair', { method: 'POST', body: JSON.stringify({ action }) });
      await load();
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    } finally {
      setWorking('');
    }
  }
  const health = useMemo(() => data?.checks.filter((check) => check.status === 'ok').length ?? 0, [data]);
  if (!allowed)
    return (
      <section className="workspace-hub">
        <div className="hub-empty">
          <ShieldCheck />
          <strong>Administratorzugriff erforderlich</strong>
          <span>Systemdiagnosen enthalten geschützte Betriebsinformationen.</span>
        </div>
      </section>
    );
  return (
    <section className="workspace-hub system-page">
      <header className="workspace-page-header">
        <div>
          <p className="eyebrow">Zentrales Control Center</p>
          <h1>System</h1>
          <p>Konfiguration, Diagnose, Sicherheit und Wartung an einer Stelle.</p>
        </div>
        <button onClick={() => void load()} disabled={loading}>
          <RefreshCw size={17} className={loading ? 'spin' : ''} />
          Alles prüfen
        </button>
      </header>
      {error && (
        <div className="overview-notice error">
          <AlertTriangle size={16} />
          {error}
        </div>
      )}
      <section className={`system-health-hero ${data?.status ?? 'warning'}`}>
        <span>
          {loading ? <LoaderCircle className="spin" /> : data?.status === 'ok' ? <CheckCircle2 /> : <AlertTriangle />}
        </span>
        <div>
          <p className="eyebrow">Automatische Diagnose</p>
          <h2>
            {data?.status === 'ok'
              ? 'Alle Kernsysteme bereit'
              : data?.status === 'error'
                ? 'Handlungsbedarf erkannt'
                : 'Studio läuft mit Hinweisen'}
          </h2>
          <p>
            {health} von {data?.checks.length ?? 0} Prüfungen ohne Befund ·{' '}
            {data ? `Stand ${new Date(data.checkedAt).toLocaleTimeString('de-DE')}` : 'wird geprüft'}
          </p>
        </div>
        <div className="system-resource-mini">
          <span>
            CPU <strong>{data?.resources.cpu.percent ?? 0}%</strong>
          </span>
          <span>
            RAM <strong>{data?.resources.memory.percent ?? 0}%</strong>
          </span>
          <span>
            Disk <strong>{data?.resources.disk?.percent ?? 0}%</strong>
          </span>
        </div>
      </section>
      <div className="system-control-grid">
        {groups.map((group) => (
          <section className="hub-panel" key={group.title}>
            <header>
              <div>
                <p className="eyebrow">Control Center</p>
                <h2>{group.title}</h2>
              </div>
            </header>
            <div className="control-center-links">
              {group.items.map((item) => {
                const Icon = item.icon;
                return (
                  <Link to={item.to} key={item.label}>
                    <span>
                      <Icon />
                    </span>
                    <div>
                      <strong>{item.label}</strong>
                      <small>{item.description}</small>
                    </div>
                    <ChevronRight />
                  </Link>
                );
              })}
            </div>
          </section>
        ))}
      </div>
      <section className="hub-panel diagnostics-panel">
        <header>
          <div>
            <p className="eyebrow">Live-Prüfungen</p>
            <h2>Systemdiagnose</h2>
          </div>
          <HeartPulse />
        </header>
        <div className="diagnostic-grid">
          {data?.checks.map((check) => (
            <article className={check.status} key={check.id}>
              <span>
                {check.id === 'database' ? (
                  <Database />
                ) : check.id === 'api' ? (
                  <Server />
                ) : check.status === 'ok' ? (
                  <CheckCircle2 />
                ) : (
                  <AlertTriangle />
                )}
              </span>
              <div>
                <strong>{check.label}</strong>
                <p>{check.summary}</p>
                {check.detail && <small>{check.detail}</small>}
              </div>
              {check.repairAction && (
                <button onClick={() => void repair(check.repairAction!)} disabled={Boolean(working)}>
                  {working === check.repairAction ? <LoaderCircle className="spin" /> : <Wrench />} Reparieren
                </button>
              )}
            </article>
          ))}
        </div>
      </section>
    </section>
  );
}
