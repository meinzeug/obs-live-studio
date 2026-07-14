import { inspectBackupHealth } from './backup-health.js';
import { inspectMultistreamRuntime, installMultistreamPreflight } from './multistream-preflight.js';

export interface AgentResponse {
  ok?: boolean;
  status?: unknown;
  error?: string;
}

installMultistreamPreflight();

const base = process.env.DESKTOP_AGENT_URL ?? 'http://127.0.0.1:12090';
const token = process.env.DESKTOP_AGENT_TOKEN;
if (!token || token.length < 32)
  throw new Error('DESKTOP_AGENT_TOKEN muss konfiguriert sein und mindestens 32 Zeichen haben');

export async function agentRequest(path: string, method = 'GET') {
  const r = await fetch(`${base}${path}`, { method, headers: { authorization: `Bearer ${token}` } });
  const text = await r.text();
  const data = text ? JSON.parse(text) : {};
  if (!r.ok) throw new Error(data.error ?? `Desktop-Agent Fehler ${r.status}`);
  return data;
}

export async function obsProcessStatus() {
  const status = (await agentRequest('/status')).status;
  const [multistream, backups] = await Promise.all([
    inspectMultistreamRuntime().catch((error) => ({
      enabled: true,
      ready: false,
      status: 'degraded',
      pluginInstalled: false,
      configurationPresent: false,
      configurationSecure: null,
      configurationOwnedByProcess: null,
      targets: [],
      checks: [
        {
          id: 'runtime-health',
          status: 'error',
          message: error instanceof Error ? error.message : String(error),
        },
      ],
    })),
    inspectBackupHealth().catch(() => ({
      ready: false,
      status: 'error',
      backup: {
        present: false,
        name: null,
        createdAt: null,
        ageHours: null,
        stale: null,
        databaseIncluded: null,
        secure: null,
      },
      rehearsal: {
        present: false,
        ok: null,
        backupName: null,
        completedAt: null,
        ageHours: null,
        stale: null,
        secure: null,
      },
      checks: [
        {
          id: 'backup-runtime-health',
          status: 'error',
          message: 'Der Backup-Status konnte nicht geprüft werden.',
        },
      ],
    })),
  ]);
  return { ...(status && typeof status === 'object' ? status : { state: status }), multistream, backups };
}

export async function startObsProcess() {
  return (await agentRequest('/obs/start', 'POST')).status;
}

export async function stopObsProcess() {
  return (await agentRequest('/obs/stop', 'POST')).status;
}

export async function restartObsProcess() {
  return (await agentRequest('/obs/restart', 'POST')).status;
}

export async function resetObsYouTubeAuth() {
  return await agentRequest('/obs/youtube/reset', 'POST');
}
