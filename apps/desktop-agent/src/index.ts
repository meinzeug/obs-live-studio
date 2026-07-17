import { execFile, execFileSync, spawn, ChildProcessWithoutNullStreams } from 'node:child_process';
import { timingSafeEqual } from 'node:crypto';
import { existsSync, readFileSync, readlinkSync, realpathSync } from 'node:fs';
import { createServer, IncomingMessage, ServerResponse } from 'node:http';
import { homedir } from 'node:os';
import { basename, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { promisify } from 'node:util';
import { cleanupStaleObsArtifacts, clearPrivatePidFile, writePrivatePidFile } from './obs-runtime-files.js';

const execFileAsync = promisify(execFile);
const resetYouTubeAuthScript = fileURLToPath(new URL('../../../scripts/reset-obs-youtube-auth.mjs', import.meta.url));

export type ObsProcessState = 'stopped' | 'starting' | 'running' | 'crashed';
export interface ObsProcessStatus {
  state: ObsProcessState;
  pid: number | null;
  startedAt: string | null;
  stoppedAt: string | null;
  lastExitCode: number | null;
  lastError: string | null;
  graphics: ReturnType<typeof checkGraphicsSession>;
}
function pidFilePath() {
  return process.env.DESKTOP_AGENT_PID_FILE ?? `${process.env.XDG_RUNTIME_DIR ?? '/tmp'}/obs-live-studio/obs.pid`;
}
let child: ChildProcessWithoutNullStreams | null = null;
let state: ObsProcessState = 'stopped';
let startedAt: string | null = null;
let stoppedAt: string | null = null;
let lastExitCode: number | null = null;
let lastError: string | null = null;
let restartTimer: NodeJS.Timeout | null = null;
const expectedStops = new Set<number>();
function boundedMilliseconds(value: unknown, fallback: number, minimum: number, maximum: number) {
  const parsed = Number(value);
  if (!Number.isFinite(parsed)) return fallback;
  return Math.max(minimum, Math.min(maximum, Math.round(parsed)));
}
function log(event: string, details: Record<string, unknown> = {}) {
  console.log(JSON.stringify({ time: new Date().toISOString(), component: 'desktop-agent', event, ...details }));
}
function alive(pid: number) {
  try {
    process.kill(pid, 0);
    return true;
  } catch {
    return false;
  }
}
function expectedObsExecutable(pid: number, executable = process.env.OBS_EXECUTABLE ?? '/usr/bin/obs') {
  if (!Number.isInteger(pid) || pid <= 0 || !alive(pid)) return false;
  try {
    const expected = realpathSync(executable);
    const actual = readlinkSync(`/proc/${pid}/exe`).replace(/ \(deleted\)$/, '');
    return actual === expected;
  } catch {
    return false;
  }
}
function writePid(pid: number) {
  writePrivatePidFile(pidFilePath(), pid);
}
function readPid() {
  try {
    const pid = Number(readFileSync(pidFilePath(), 'utf8'));
    return Number.isInteger(pid) && pid > 0 ? pid : null;
  } catch {
    return null;
  }
}
function clearPid() {
  clearPrivatePidFile(pidFilePath());
}
function discoverUserObsPids(executable = process.env.OBS_EXECUTABLE ?? '/usr/bin/obs') {
  if (typeof process.getuid !== 'function') return [];
  try {
    const stdout = execFileSync('pgrep', ['-u', String(process.getuid()), '-x', basename(executable)], {
      encoding: 'utf8',
      stdio: ['ignore', 'pipe', 'ignore'],
    });
    return stdout
      .split(/\s+/)
      .map(Number)
      .filter((pid) => Number.isInteger(pid) && pid > 0 && alive(pid));
  } catch {
    return [];
  }
}
function clearStaleObsRuntime(runningObsPids: number[] = []) {
  if (process.env.OBS_CLEAR_CRASH_SENTINELS === 'false') return;
  const configRoot =
    process.env.OBS_CONFIG_ROOT ?? join(process.env.XDG_CONFIG_HOME ?? join(homedir(), '.config'), 'obs-studio');
  const cleanup = cleanupStaleObsArtifacts({
    configRoot,
    runningObsPids,
    minimumAgeMs: boundedMilliseconds(process.env.OBS_STALE_ARTIFACT_MIN_AGE_MS, 1000, 0, 60_000),
  });
  if (cleanup.removed.length || cleanup.skippedFresh.length || cleanup.skippedBecauseObsRuns) {
    log('obs_runtime_cleanup', {
      removed: cleanup.removed.length,
      skippedFresh: cleanup.skippedFresh.length,
      skippedBecauseObsRuns: cleanup.skippedBecauseObsRuns,
    });
  }
}
function discoverObsPid(executable = process.env.OBS_EXECUTABLE ?? '/usr/bin/obs') {
  const saved = readPid();
  if (saved && expectedObsExecutable(saved, executable)) return saved;
  if (saved) {
    clearPid();
    log('stale_obs_pid_rejected', { pid: saved });
  }
  return null;
}
export function checkGraphicsSession() {
  return {
    display: process.env.DISPLAY,
    wayland: process.env.WAYLAND_DISPLAY,
    xdgRuntimeDir: process.env.XDG_RUNTIME_DIR,
    canStartObs: Boolean(process.env.DISPLAY || process.env.WAYLAND_DISPLAY),
  };
}
export function obsLaunchArguments(env: NodeJS.ProcessEnv = process.env) {
  if (!env.OBS_PASSWORD) throw new Error('OBS_PASSWORD fehlt für den OBS-WebSocket-Start');
  const websocketPort = boundedMilliseconds(env.OBS_PORT, 4455, 1, 65_535);
  const configuredArguments = env.OBS_ARGS_JSON
    ? JSON.parse(env.OBS_ARGS_JSON)
    : [
        '--disable-shutdown-check',
        '--disable-missing-files-check',
        '--profile',
        env.OBS_PROFILE_NAME ?? 'Automated News Studio',
        '--collection',
        env.OBS_SCENE_COLLECTION ?? 'Automated News Studio',
        '--websocket_ipv4_only',
        '--websocket_port',
        String(websocketPort),
        '--websocket_password',
        env.OBS_PASSWORD,
      ];
  if (!Array.isArray(configuredArguments) || !configuredArguments.every((argument) => typeof argument === 'string')) {
    throw new Error('OBS_ARGS_JSON muss ein JSON-Array aus Strings sein');
  }
  const args: string[] = [];
  for (let index = 0; index < configuredArguments.length; index++) {
    const argument = configuredArguments[index];
    if (argument === '--websocket_password' || argument === '--websocket_port') {
      index++;
      continue;
    }
    if (argument.startsWith('--websocket_password=') || argument.startsWith('--websocket_port=')) continue;
    args.push(argument);
  }
  args.push('--websocket_port', String(websocketPort), '--websocket_password', env.OBS_PASSWORD);
  return args;
}

function cancelPendingObsRestart() {
  if (!restartTimer) return;
  clearTimeout(restartTimer);
  restartTimer = null;
  log('obs_restart_cancelled');
}
export function obsStatus(): ObsProcessStatus {
  const pid = child?.pid ?? discoverObsPid();
  if (pid && alive(pid) && state !== 'starting') state = 'running';
  if (!pid && state === 'running') state = 'crashed';
  return { state, pid: pid ?? null, startedAt, stoppedAt, lastExitCode, lastError, graphics: checkGraphicsSession() };
}
export function startObs() {
  const current = obsStatus();
  if (current.pid && current.state === 'running') return current;
  const exe = process.env.OBS_EXECUTABLE ?? '/usr/bin/obs';
  if (!existsSync(exe)) throw new Error(`OBS nicht gefunden: ${exe}`);
  const externalPids = discoverUserObsPids(exe);
  if (externalPids.length) {
    throw new Error(`OBS läuft bereits außerhalb des Desktop-Agenten (PID ${externalPids.join(', ')}).`);
  }
  clearStaleObsRuntime(externalPids);
  state = 'starting';
  lastError = null;
  const args = obsLaunchArguments();
  const cp = spawn(exe, args, { detached: true, stdio: 'ignore' });
  child = cp as ChildProcessWithoutNullStreams;
  startedAt = new Date().toISOString();
  stoppedAt = null;
  state = 'running';
  if (cp.pid) writePid(cp.pid);
  log('obs_started', { pid: cp.pid });
  cp.once('error', (e) => {
    if (child?.pid === cp.pid) {
      state = 'crashed';
      lastError = e.message;
      child = null;
      clearPid();
    }
    log('obs_error', { error: e.message });
  });
  cp.once('exit', (code, signal) => {
    const pid = cp.pid ?? -1;
    const expected = expectedStops.delete(pid);
    lastExitCode = code;
    stoppedAt = new Date().toISOString();
    if (child?.pid === cp.pid) {
      state = expected || code === 0 ? 'stopped' : 'crashed';
      child = null;
      clearPid();
    }
    log('obs_exit', { code, signal, expected });
    if (!expected && process.env.OBS_AUTO_RESTART === 'true' && !restartTimer) {
      restartTimer = setTimeout(
        () => {
          restartTimer = null;
          try {
            startObs();
          } catch (e) {
            lastError = e instanceof Error ? e.message : String(e);
            log('obs_restart_failed', { error: lastError });
          }
        },
        boundedMilliseconds(process.env.OBS_RESTART_DELAY_MS, 3000, 250, 60_000),
      );
    }
  });
  cp.unref();
  return obsStatus();
}
async function waitForExit(pid: number, timeoutMs: number) {
  const end = Date.now() + timeoutMs;
  while (Date.now() < end) {
    if (!alive(pid)) return true;
    await new Promise((r) => setTimeout(r, 100));
  }
  return !alive(pid);
}
export async function stopObsGracefully(timeoutMs = Number(process.env.OBS_STOP_TIMEOUT_MS ?? 5000)) {
  cancelPendingObsRestart();
  const pid = obsStatus().pid;
  if (!pid) {
    state = 'stopped';
    stoppedAt = new Date().toISOString();
    return obsStatus();
  }
  const managedChild = child?.pid === pid;
  const safeTimeoutMs = boundedMilliseconds(timeoutMs, 5000, 250, 60_000);
  expectedStops.add(pid);
  try {
    try {
      process.kill(pid, 'SIGTERM');
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code !== 'ESRCH') throw error;
    }
    if (!(await waitForExit(pid, safeTimeoutMs))) {
      try {
        process.kill(pid, 'SIGKILL');
        lastError = 'OBS musste nach Timeout beendet werden';
        log('obs_kill_fallback', { pid, timeoutMs: safeTimeoutMs });
      } catch (error) {
        if ((error as NodeJS.ErrnoException).code !== 'ESRCH') throw error;
      }
    }
  } finally {
    if (!managedChild) expectedStops.delete(pid);
  }
  state = 'stopped';
  stoppedAt = new Date().toISOString();
  child = null;
  clearPid();
  return obsStatus();
}
export function stopObs(signal: NodeJS.Signals = 'SIGTERM') {
  cancelPendingObsRestart();
  const pid = obsStatus().pid;
  if (!pid) {
    state = 'stopped';
    stoppedAt = new Date().toISOString();
    return obsStatus();
  }
  const managedChild = child?.pid === pid;
  expectedStops.add(pid);
  try {
    process.kill(pid, signal);
  } catch (error) {
    if (!managedChild) expectedStops.delete(pid);
    if ((error as NodeJS.ErrnoException).code !== 'ESRCH') throw error;
  }
  state = 'stopped';
  stoppedAt = new Date().toISOString();
  child = null;
  clearPid();
  if (!managedChild) expectedStops.delete(pid);
  return obsStatus();
}
export async function restartObs() {
  await stopObsGracefully();
  return startObs();
}
export async function resetYouTubeAuth() {
  await stopObsGracefully();
  try {
    const { stdout } = await execFileAsync(process.execPath, [resetYouTubeAuthScript], {
      env: process.env,
      timeout: 30_000,
    });
    const reset = JSON.parse(stdout.trim());
    const status = startObs();
    log('youtube_auth_reset', { profile: reset.profile, backupDir: reset.backupDir });
    return { reset, status };
  } catch (error) {
    lastError = error instanceof Error ? error.message : String(error);
    log('youtube_auth_reset_failed', { error: lastError });
    try {
      startObs();
    } catch (restartError) {
      log('obs_restart_failed', {
        error: restartError instanceof Error ? restartError.message : String(restartError),
      });
    }
    throw error;
  }
}
function safeBearer(actual: string | undefined, expected: string) {
  if (!actual?.startsWith('Bearer ')) return false;
  const a = Buffer.from(actual.slice(7));
  const b = Buffer.from(expected);
  return a.length === b.length && timingSafeEqual(a, b);
}
function configuredToken() {
  const token = process.env.DESKTOP_AGENT_TOKEN;
  if (!token || token.length < 32)
    throw new Error('DESKTOP_AGENT_TOKEN muss konfiguriert sein und mindestens 32 Zeichen haben');
  return token;
}
function unauthorized(req: IncomingMessage, res: ServerResponse) {
  let token: string;
  try {
    token = configuredToken();
  } catch (e) {
    res.writeHead(503, { 'content-type': 'application/json' });
    res.end(JSON.stringify({ error: e instanceof Error ? e.message : String(e) }));
    return true;
  }
  if (!safeBearer(req.headers.authorization, token)) {
    res.writeHead(401, { 'content-type': 'application/json' });
    res.end(JSON.stringify({ error: 'unauthorized' }));
    return true;
  }
  return false;
}
export function startIpcServer(
  port = Number(process.env.DESKTOP_AGENT_PORT ?? 12090),
  host = process.env.DESKTOP_AGENT_HOST ?? '127.0.0.1',
) {
  const server = createServer(async (req, res) => {
    res.setHeader('content-type', 'application/json');
    if (unauthorized(req, res)) return;
    try {
      if (req.method === 'GET' && req.url === '/status') res.end(JSON.stringify({ ok: true, status: obsStatus() }));
      else if (req.method === 'POST' && req.url === '/obs/start')
        res.end(JSON.stringify({ ok: true, status: startObs() }));
      else if (req.method === 'POST' && req.url === '/obs/stop')
        res.end(JSON.stringify({ ok: true, status: await stopObsGracefully() }));
      else if (req.method === 'POST' && req.url === '/obs/restart')
        res.end(JSON.stringify({ ok: true, status: await restartObs() }));
      else if (req.method === 'POST' && req.url === '/obs/youtube/reset')
        res.end(JSON.stringify({ ok: true, ...(await resetYouTubeAuth()) }));
      else {
        res.writeHead(404);
        res.end(JSON.stringify({ error: 'not found' }));
      }
    } catch (e) {
      res.writeHead(500);
      res.end(JSON.stringify({ error: e instanceof Error ? e.message : String(e) }));
    }
  });
  server.listen(port, host, () => {
    log('ipc_listening', { host, port, pidFile: pidFilePath() });
    if (process.env.OBS_AUTO_START === 'true') {
      try {
        startObs();
      } catch (e) {
        lastError = e instanceof Error ? e.message : String(e);
        log('obs_autostart_failed', { error: lastError });
      }
    }
  });
  return server;
}
if (import.meta.url === `file://${process.argv[1]}`) startIpcServer();
