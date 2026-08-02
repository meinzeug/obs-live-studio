import { execFile } from 'node:child_process';
import { mkdir, readFile, rename, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { promisify } from 'node:util';

const execFileAsync = promisify(execFile);
const LOOPBACK_HOSTS = new Set(['localhost', '127.0.0.1', '::1', '[::1]']);
const STATION_TARGET = 'obs-live-studio.target';

function boundedInteger(value, fallback, minimum, maximum) {
  const parsed = Number(value);
  return Number.isInteger(parsed) ? Math.max(minimum, Math.min(maximum, parsed)) : fallback;
}

function localUrl(value, fallback) {
  const url = new URL(String(value || fallback));
  if (url.protocol !== 'http:' || url.username || url.password || !LOOPBACK_HOSTS.has(url.hostname)) {
    throw new Error('Core-Health-Endpunkte müssen lokale HTTP-URLs ohne Zugangsdaten sein.');
  }
  return url.toString();
}

export function coreServiceHealthChecks(env = process.env) {
  return [
    {
      id: 'api',
      unit: 'obs-live-studio-api.service',
      url: localUrl(env.CORE_HEALTH_API_URL, 'http://127.0.0.1:12000/health'),
      bodyReady: (body) => body?.status === 'online',
    },
    {
      id: 'broadcast-runner',
      unit: 'obs-live-studio-broadcast-runner.service',
      url: localUrl(env.CORE_HEALTH_BROADCAST_RUNNER_URL, 'http://127.0.0.1:12100/ready'),
      bodyReady: (body) => body?.ready === true,
      repairWhen: (body) => body?.restartRecommended === true,
    },
    {
      id: 'worker',
      unit: 'obs-live-studio-worker.service',
      url: localUrl(env.CORE_HEALTH_WORKER_URL, 'http://127.0.0.1:12101/health'),
      bodyReady: (body) => body?.status === 'online',
    },
    {
      id: 'desktop-agent',
      unit: 'obs-live-studio-desktop-agent.service',
      url: localUrl(env.CORE_HEALTH_DESKTOP_AGENT_URL, 'http://127.0.0.1:12090/status'),
      acceptedStatuses: new Set([200, 401]),
    },
    {
      id: 'pocket-tts',
      unit: 'obs-live-studio-pocket-tts.service',
      url: localUrl(env.CORE_HEALTH_POCKET_TTS_URL, 'http://127.0.0.1:8000/health'),
      bodyReady: (body) => body?.status === 'healthy',
    },
    {
      id: 'web',
      unit: 'obs-live-studio-web.service',
      url: localUrl(env.CORE_HEALTH_WEB_URL, 'http://127.0.0.1:12001/'),
    },
    {
      id: 'overlay-renderer',
      unit: 'obs-live-studio-overlay-renderer.service',
      url: localUrl(env.CORE_HEALTH_OVERLAY_URL, 'http://127.0.0.1:12002/health'),
      bodyReady: (body) => body?.status === 'online',
    },
  ];
}

function compactError(error) {
  return (error instanceof Error ? `${error.name}: ${error.message}` : String(error))
    .replace(/\s+/g, ' ')
    .slice(0, 500);
}

async function responseBody(response) {
  const contentType = response.headers.get('content-type') ?? '';
  if (!contentType.includes('application/json')) return null;
  return response.json().catch(() => null);
}

export async function probeCoreService(check, options = {}) {
  const fetchImpl = options.fetchImpl ?? fetch;
  const timeoutMs = boundedInteger(options.timeoutMs, 5000, 500, 30_000);
  try {
    const response = await fetchImpl(check.url, {
      method: 'GET',
      redirect: 'error',
      headers: { 'user-agent': 'obs-live-studio-core-health/1' },
      signal: AbortSignal.timeout(timeoutMs),
    });
    const acceptedStatus = check.acceptedStatuses
      ? check.acceptedStatuses.has(response.status)
      : response.status >= 200 && response.status < 400;
    const body = check.bodyReady ? await responseBody(response) : null;
    const applicationReady = acceptedStatus && (!check.bodyReady || check.bodyReady(body));
    const repairRecommended = Boolean(check.repairWhen?.(body));
    return {
      reachable: true,
      applicationReady,
      repairRecommended,
      httpStatus: response.status,
      error: null,
    };
  } catch (error) {
    return {
      reachable: false,
      applicationReady: false,
      repairRecommended: false,
      httpStatus: null,
      error: compactError(error),
    };
  }
}

export function evaluateCoreServiceRepair(previous = {}, observation, options = {}) {
  const nowMs = Number(options.nowMs ?? Date.now());
  const failureThreshold = boundedInteger(options.failureThreshold, 2, 1, 10);
  const cooldownMs = boundedInteger(options.cooldownMs, 15 * 60_000, 60_000, 24 * 60 * 60_000);
  const transportHealthy = observation.processActive && observation.reachable && observation.repairRecommended !== true;
  if (transportHealthy) {
    return {
      state: { failures: 0, lastRestartAt: previous.lastRestartAt ?? null },
      shouldRestart: false,
    };
  }
  const failures = boundedInteger(previous.failures, 0, 0, 1_000_000) + 1;
  const lastRestartMs = Date.parse(previous.lastRestartAt ?? '');
  const cooldownElapsed = !Number.isFinite(lastRestartMs) || nowMs - lastRestartMs >= cooldownMs;
  return {
    state: { failures, lastRestartAt: previous.lastRestartAt ?? null },
    shouldRestart: failures >= failureThreshold && cooldownElapsed,
  };
}

function stateFilePath(env = process.env) {
  const runtimeRoot =
    env.XDG_RUNTIME_DIR || (typeof process.getuid === 'function' ? `/run/user/${process.getuid()}` : tmpdir());
  return join(runtimeRoot, 'obs-live-studio', 'core-health-watchdog.json');
}

async function readState(path) {
  try {
    const parsed = JSON.parse(await readFile(path, 'utf8'));
    return parsed && typeof parsed === 'object' && parsed.services && typeof parsed.services === 'object'
      ? parsed
      : { version: 1, services: {} };
  } catch {
    return { version: 1, services: {} };
  }
}

async function writeState(path, state) {
  await mkdir(dirname(path), { recursive: true, mode: 0o700 });
  const temporaryPath = `${path}.${process.pid}.tmp`;
  await writeFile(temporaryPath, `${JSON.stringify(state)}\n`, { mode: 0o600 });
  await rename(temporaryPath, path);
}

async function unitActive(unit, exec = execFileAsync) {
  try {
    const { stdout } = await exec('systemctl', ['--user', 'is-active', unit], { timeout: 5000 });
    return stdout.trim() === 'active';
  } catch {
    return false;
  }
}

async function restartUnit(unit, exec = execFileAsync) {
  await exec('systemctl', ['--user', 'restart', unit], { timeout: 30_000 });
}

export async function runCoreServiceHealthWatchdog(options = {}) {
  const env = options.env ?? process.env;
  const checks = options.checks ?? coreServiceHealthChecks(env);
  const nowMs = Number(options.nowMs ?? Date.now());
  const path = options.stateFile ?? stateFilePath(env);
  const state = await readState(path);
  const repairRequested = options.repair === true;
  const stationTargetActive = repairRequested ? await (options.unitActive ?? unitActive)(STATION_TARGET) : null;
  const repairEnabled = repairRequested && stationTargetActive;
  const maximumRestarts = boundedInteger(env.CORE_HEALTH_MAX_RESTARTS_PER_RUN, 1, 1, checks.length);
  let restartCount = 0;
  const observations = await Promise.all(
    checks.map(async (check) => {
      const [processActive, probe] = await Promise.all([
        (options.unitActive ?? unitActive)(check.unit),
        probeCoreService(check, {
          fetchImpl: options.fetchImpl,
          timeoutMs: boundedInteger(env.CORE_HEALTH_TIMEOUT_MS, 5000, 500, 30_000),
        }),
      ]);
      return { check, processActive, ...probe };
    }),
  );
  const results = [];
  for (const observation of observations) {
    const previous = state.services[observation.check.id] ?? {};
    const decision =
      stationTargetActive === false
        ? {
            state: { failures: 0, lastRestartAt: previous.lastRestartAt ?? null },
            shouldRestart: false,
          }
        : evaluateCoreServiceRepair(previous, observation, {
            nowMs,
            failureThreshold: boundedInteger(env.CORE_HEALTH_FAILURE_THRESHOLD, 2, 1, 10),
            cooldownMs: boundedInteger(env.CORE_HEALTH_RESTART_COOLDOWN_MS, 15 * 60_000, 60_000, 24 * 60 * 60_000),
          });
    let action = 'none';
    let actionError = null;
    if (repairEnabled && decision.shouldRestart && restartCount < maximumRestarts) {
      restartCount += 1;
      try {
        await (options.restartUnit ?? restartUnit)(observation.check.unit);
        action = 'restarted';
        decision.state.failures = 0;
        decision.state.lastRestartAt = new Date(nowMs).toISOString();
      } catch (error) {
        action = 'restart-failed';
        actionError = compactError(error);
      }
    } else if (repairEnabled && decision.shouldRestart) {
      action = 'deferred';
    } else if (repairRequested && stationTargetActive === false && !observation.processActive) {
      action = 'suppressed-target-inactive';
    }
    state.services[observation.check.id] = decision.state;
    results.push({
      id: observation.check.id,
      unit: observation.check.unit,
      status:
        observation.processActive && observation.reachable
          ? observation.applicationReady
            ? 'healthy'
            : 'degraded'
          : 'unreachable',
      processActive: observation.processActive,
      reachable: observation.reachable,
      httpStatus: observation.httpStatus,
      consecutiveFailures: decision.state.failures,
      action,
      error: actionError ?? observation.error,
    });
  }
  state.version = 1;
  state.checkedAt = new Date(nowMs).toISOString();
  await writeState(path, state);
  return {
    ok: results.every((result) => result.status !== 'unreachable'),
    checkedAt: state.checkedAt,
    repair: repairEnabled,
    repairRequested,
    stationTargetActive,
    results,
  };
}

if (import.meta.url === `file://${process.argv[1]}`) {
  runCoreServiceHealthWatchdog({ repair: process.argv.includes('--repair') })
    .then((report) => console.log(JSON.stringify(report)))
    .catch((error) => {
      console.error(JSON.stringify({ ok: false, error: compactError(error) }));
      process.exitCode = 1;
    });
}
