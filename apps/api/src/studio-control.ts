import { execFile } from 'node:child_process';
import { statfs } from 'node:fs/promises';
import { arch, cpus, freemem, loadavg, platform, totalmem, uptime } from 'node:os';
import { promisify } from 'node:util';
import type { FastifyInstance, FastifyReply, FastifyRequest } from 'fastify';
import { z } from 'zod';
import { getSetting, query, setSetting } from '@ans/database';
import type { WritePermission } from '@ans/security/auth';

const execFileAsync = promisify(execFile);
const ONBOARDING_KEY = 'studio.onboarding';

export type StudioResourceSnapshot = {
  cpu: { percent: number; cores: number; load: number[] };
  memory: { usedBytes: number; totalBytes: number; percent: number };
  disk: { usedBytes: number; totalBytes: number; freeBytes: number; percent: number } | null;
  gpu: {
    available: boolean;
    name: string | null;
    percent: number | null;
    memoryUsedMb: number | null;
    memoryTotalMb: number | null;
  };
  runtime: { node: string; platform: string; architecture: string; uptimeSeconds: number };
};

type DiagnosticStatus = 'ok' | 'warning' | 'error';
type DiagnosticCheck = {
  id: string;
  label: string;
  status: DiagnosticStatus;
  summary: string;
  detail?: string;
  repairAction?: 'obs-reconnect' | 'obs-setup' | 'restore-overlays';
};

type OnboardingState = {
  completed: boolean;
  currentStep: number;
  startedAt: string;
  completedAt: string | null;
  dismissedAt: string | null;
};

type StudioControlDependencies = {
  projectRoot: string;
  channelName: () => string;
  streamConfigured: () => boolean;
  obsState: () => { status?: string; lastError?: string | null };
  ttsConfigured: () => boolean;
  aiConfigured: () => boolean;
  reconnectObs: () => Promise<unknown>;
  setupObs: () => Promise<unknown>;
  restoreOverlays: () => Promise<unknown>;
};

let resourceCache: { expiresAt: number; value: StudioResourceSnapshot } | null = null;

function boundedPercent(value: number) {
  return Math.max(0, Math.min(100, Math.round(value * 10) / 10));
}

async function gpuSnapshot(): Promise<StudioResourceSnapshot['gpu']> {
  try {
    const result = await execFileAsync(
      'nvidia-smi',
      [
        '--query-gpu=name,utilization.gpu,memory.used,memory.total',
        '--format=csv,noheader,nounits',
      ],
      { timeout: 2_000, maxBuffer: 64 * 1024 },
    );
    const first = result.stdout.trim().split('\n')[0] ?? '';
    const [name, percent, memoryUsed, memoryTotal] = first.split(',').map((value) => value.trim());
    if (!name) throw new Error('Keine GPU gemeldet');
    return {
      available: true,
      name,
      percent: boundedPercent(Number(percent) || 0),
      memoryUsedMb: Number(memoryUsed) || 0,
      memoryTotalMb: Number(memoryTotal) || 0,
    };
  } catch {
    return { available: false, name: null, percent: null, memoryUsedMb: null, memoryTotalMb: null };
  }
}

export async function studioResourceSnapshot(projectRoot: string): Promise<StudioResourceSnapshot> {
  if (resourceCache && resourceCache.expiresAt > Date.now()) return resourceCache.value;
  const coreCount = Math.max(1, cpus().length);
  const loads = loadavg();
  const memoryTotal = totalmem();
  const memoryFree = freemem();
  const [diskResult, gpu] = await Promise.all([
    statfs(projectRoot).catch(() => null),
    gpuSnapshot(),
  ]);
  const disk = diskResult
    ? (() => {
        const totalBytes = Number(diskResult.blocks) * Number(diskResult.bsize);
        const freeBytes = Number(diskResult.bavail) * Number(diskResult.bsize);
        const usedBytes = Math.max(0, totalBytes - freeBytes);
        return {
          usedBytes,
          totalBytes,
          freeBytes,
          percent: totalBytes > 0 ? boundedPercent((usedBytes / totalBytes) * 100) : 0,
        };
      })()
    : null;
  const value: StudioResourceSnapshot = {
    cpu: {
      percent: boundedPercent((loads[0] / coreCount) * 100),
      cores: coreCount,
      load: loads.map((value) => Math.round(value * 100) / 100),
    },
    memory: {
      usedBytes: memoryTotal - memoryFree,
      totalBytes: memoryTotal,
      percent: memoryTotal > 0 ? boundedPercent(((memoryTotal - memoryFree) / memoryTotal) * 100) : 0,
    },
    disk,
    gpu,
    runtime: {
      node: process.version,
      platform: platform(),
      architecture: arch(),
      uptimeSeconds: Math.round(uptime()),
    },
  };
  resourceCache = { expiresAt: Date.now() + 15_000, value };
  return value;
}

async function commandAvailable(command: string, args: string[]) {
  try {
    const result = await execFileAsync(command, args, { timeout: 2_500, maxBuffer: 96 * 1024 });
    return { ok: true, output: `${result.stdout || result.stderr}`.trim().split('\n')[0]?.slice(0, 240) || 'verfügbar' };
  } catch (error) {
    return { ok: false, output: error instanceof Error ? error.message.slice(0, 240) : String(error).slice(0, 240) };
  }
}

async function serviceState(name: string) {
  const readState = async (args: string[]) => {
    const result = await execFileAsync('systemctl', args, { timeout: 2_500, maxBuffer: 16 * 1024 });
    return result.stdout.trim() || 'active';
  };
  try {
    return await readState(['--user', 'is-active', name]);
  } catch (userError) {
    try {
      return await readState(['is-active', name]);
    } catch (systemError) {
      const stderr = (systemError as { stderr?: string }).stderr?.trim() || (userError as { stderr?: string }).stderr?.trim();
      return stderr || 'inactive';
    }
  }
}

function defaultOnboardingState(): OnboardingState {
  return {
    completed: false,
    currentStep: 0,
    startedAt: new Date().toISOString(),
    completedAt: null,
    dismissedAt: null,
  };
}

async function onboardingState() {
  return (await getSetting<OnboardingState>(ONBOARDING_KEY)) ?? defaultOnboardingState();
}

export function registerStudioControlRoutes(
  app: FastifyInstance,
  dependencies: StudioControlDependencies,
  requirePermission: (req: FastifyRequest, reply: FastifyReply, permission: WritePermission) => void,
) {
  app.get('/api/studio/onboarding', async () => {
    const state = await onboardingState();
    const obs = dependencies.obsState();
    return {
      ...state,
      required: !state.completed && !state.dismissedAt,
      readiness: {
        sender: Boolean(dependencies.channelName().trim()),
        streaming: dependencies.streamConfigured(),
        obs: obs.status === 'connected',
        ai: dependencies.aiConfigured(),
        speech: dependencies.ttsConfigured(),
      },
    };
  });

  app.post('/api/studio/onboarding', async (req, reply) => {
    requirePermission(req, reply, 'users:write');
    const body = z
      .object({
        currentStep: z.number().int().min(0).max(5).optional(),
        completed: z.boolean().optional(),
        dismissed: z.boolean().optional(),
        reset: z.boolean().optional(),
      })
      .parse(req.body ?? {});
    const current = body.reset ? defaultOnboardingState() : await onboardingState();
    const completed = body.reset ? false : (body.completed ?? current.completed);
    const next: OnboardingState = {
      ...current,
      currentStep: body.currentStep ?? current.currentStep,
      completed,
      completedAt: completed ? current.completedAt ?? new Date().toISOString() : null,
      dismissedAt:
        body.dismissed === true
          ? new Date().toISOString()
          : body.dismissed === false || body.reset
            ? null
            : current.dismissedAt,
    };
    await setSetting(ONBOARDING_KEY, next);
    return { ...next, required: !next.completed && !next.dismissedAt };
  });

  app.get('/api/system/diagnostics', async (req, reply) => {
    requirePermission(req, reply, 'users:write');
    const obs = dependencies.obsState();
    const [database, ffmpeg, worker, renderer, resources] = await Promise.all([
      query('select 1 as ok')
        .then(() => ({ ok: true, output: 'PostgreSQL antwortet' }))
        .catch((error) => ({ ok: false, output: error instanceof Error ? error.message : String(error) })),
      commandAvailable('ffmpeg', ['-version']),
      serviceState('obs-live-studio-worker.service'),
      serviceState('obs-live-studio-overlay-renderer.service'),
      studioResourceSnapshot(dependencies.projectRoot),
    ]);
    const checks: DiagnosticCheck[] = [
      {
        id: 'api',
        label: 'Studio-Server',
        status: 'ok',
        summary: `Online · ${process.version}`,
      },
      {
        id: 'database',
        label: 'PostgreSQL',
        status: database.ok ? 'ok' : 'error',
        summary: database.ok ? 'Datenbank ist erreichbar' : 'Datenbank nicht erreichbar',
        detail: database.output,
      },
      {
        id: 'obs',
        label: 'OBS Studio',
        status: obs.status === 'connected' ? 'ok' : 'error',
        summary: obs.status === 'connected' ? 'WebSocket verbunden' : 'Keine Verbindung zu OBS',
        detail: obs.lastError ?? undefined,
        repairAction: obs.status === 'connected' ? undefined : 'obs-reconnect',
      },
      {
        id: 'worker',
        label: 'Automations-Worker',
        status: worker === 'active' ? 'ok' : 'warning',
        summary: worker === 'active' ? 'Worker läuft' : `Dienststatus: ${worker}`,
      },
      {
        id: 'renderer',
        label: 'Overlay-Renderer',
        status: renderer === 'active' ? 'ok' : 'warning',
        summary: renderer === 'active' ? 'Renderer läuft' : `Dienststatus: ${renderer}`,
        repairAction: renderer === 'active' ? undefined : 'restore-overlays',
      },
      {
        id: 'ffmpeg',
        label: 'Medien-Engine',
        status: ffmpeg.ok ? 'ok' : 'error',
        summary: ffmpeg.ok ? 'FFmpeg ist einsatzbereit' : 'FFmpeg wurde nicht gefunden',
        detail: ffmpeg.output,
      },
      {
        id: 'tts',
        label: 'Sprachausgabe',
        status: dependencies.ttsConfigured() ? 'ok' : 'warning',
        summary: dependencies.ttsConfigured() ? 'TTS ist eingerichtet' : 'TTS muss noch eingerichtet werden',
      },
      {
        id: 'storage',
        label: 'Speicherplatz',
        status: (resources.disk?.percent ?? 0) >= 92 ? 'error' : (resources.disk?.percent ?? 0) >= 80 ? 'warning' : 'ok',
        summary: resources.disk ? `${resources.disk.percent}% belegt` : 'Speicherstatus nicht verfügbar',
      },
    ];
    return {
      status: checks.some((check) => check.status === 'error')
        ? 'error'
        : checks.some((check) => check.status === 'warning')
          ? 'warning'
          : 'ok',
      checkedAt: new Date().toISOString(),
      resources,
      checks,
    };
  });

  app.post('/api/system/repair', async (req, reply) => {
    requirePermission(req, reply, 'users:write');
    const { action } = z
      .object({ action: z.enum(['obs-reconnect', 'obs-setup', 'restore-overlays']) })
      .parse(req.body ?? {});
    const result =
      action === 'obs-reconnect'
        ? await dependencies.reconnectObs()
        : action === 'obs-setup'
          ? await dependencies.setupObs()
          : await dependencies.restoreOverlays();
    return { ok: true, action, result, completedAt: new Date().toISOString() };
  });
}
