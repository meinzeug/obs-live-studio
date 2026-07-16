import { inspectBackupHealth } from './backup-health.js';
import { inspectMultistreamRuntime, installMultistreamPreflight } from './multistream-preflight.js';

export interface AgentResponse {
  ok?: boolean;
  status?: unknown;
  error?: string;
}

export class DesktopAgentRequestError extends Error {
  constructor(
    message: string,
    public readonly statusCode: number,
  ) {
    super(message);
    this.name = 'DesktopAgentRequestError';
  }
}

installMultistreamPreflight();

const base = process.env.DESKTOP_AGENT_URL ?? 'http://127.0.0.1:12090';
const token = process.env.DESKTOP_AGENT_TOKEN;
if (!token || token.length < 32)
  throw new Error('DESKTOP_AGENT_TOKEN muss konfiguriert sein und mindestens 32 Zeichen haben');

export async function agentRequest(path: string, method = 'GET') {
  let r: Response;
  try {
    r = await fetch(`${base}${path}`, { method, headers: { authorization: `Bearer ${token}` } });
  } catch {
    throw new DesktopAgentRequestError(
      'Der OBS-Desktop-Agent ist nicht erreichbar. Bitte den Dienst obs-live-studio-desktop-agent.service prüfen.',
      503,
    );
  }
  const text = await r.text();
  let data: AgentResponse = {};
  try {
    data = text ? (JSON.parse(text) as AgentResponse) : {};
  } catch {
    throw new DesktopAgentRequestError('Der OBS-Desktop-Agent hat eine ungültige Antwort geliefert.', 502);
  }
  if (!r.ok) {
    throw new DesktopAgentRequestError(data.error ?? `Desktop-Agent Fehler ${r.status}`, r.status >= 500 ? 503 : 502);
  }
  return data;
}

export async function obsProcessStatus() {
  let status: unknown;
  try {
    status = (await agentRequest('/status')).status;
  } catch (error) {
    status = {
      state: 'unavailable',
      pid: null,
      startedAt: null,
      stoppedAt: null,
      lastExitCode: null,
      lastError: error instanceof Error ? error.message : 'Der OBS-Desktop-Agent ist nicht erreichbar.',
      graphics: null,
    };
  }
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
