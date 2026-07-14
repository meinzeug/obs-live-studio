import { execFile, spawn, ChildProcessWithoutNullStreams } from 'node:child_process';
import { timingSafeEqual } from 'node:crypto';
import { existsSync, readFileSync, writeFileSync, rmSync, mkdirSync, readdirSync } from 'node:fs';
import { createServer, IncomingMessage, ServerResponse } from 'node:http';
import { homedir } from 'node:os';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { promisify } from 'node:util';

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
function writePid(pid: number) {
  const pidFile = pidFilePath();
  mkdirSync(dirname(pidFile), { recursive: true });
  writeFileSync(pidFile, String(pid));
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
  try {
    rmSync(pidFilePath(), { force: true });
  } catch {}
}
function clearStaleObsRuntime() {
  if (process.env.OBS_CLEAR_CRASH_SENTINELS === 'false') return;
  const configRoot =
    process.env.OBS_CONFIG_ROOT ?? join(process.env.XDG_CONFIG_HOME ?? join(homedir(), '.config'), 'obs-studio');
  const sentinelDir = join(configRoot, '.sentinel');
  try {
    for (const entry of readdirSync(sentinelDir)) {
      if (entry.startsWith('run_')) rmSync(join(sentinelDir, entry), { force: true });
    }
  } catch {}
  for (const entry of ['SingletonCookie', 'SingletonLock', 'SingletonSocket']) {
    try {
      rmSync(join(configRoot, 'plugin_config', 'obs-browser', entry), { force: true });
    } catch {}
  }
}
function discoverObsPid() {
  const saved = readPid();
  if (saved && alive(saved)) return saved;
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
  clearStaleObsRuntime();
  state = 'starting';
  lastError = null;
  const args = process.env.OBS_ARGS_JSON
    ? JSON.parse(process.env.OBS_ARGS_JSON)
    : [
        '--disable-shutdown-check',
        '--disable-missing-files-check',
        '--profile',
        process.env.OBS_PROFILE_NAME ?? 'Automated News Studio',
        '--collection',
        process.env.OBS_SCENE_COLLECTION ?? 'Automated News Studio',
        '--websocket_ipv4_only',
        '--websocket_port',
        String(process.env.OBS_PORT ?? 4455),
      ];
  if (!Array.isArray(args) || !args.every((a) => typeof a === 'string'))
    throw new Error('OBS_ARGS_JSON muss ein JSON-Array aus Strings sein');
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
        Number(process.env.OBS_RESTART_DELAY_MS ?? 3000),
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
  const pid = obsStatus().pid;
  if (!pid) return obsStatus();
  expectedStops.add(pid);
  process.kill(pid, 'SIGTERM');
  if (!(await waitForExit(pid, timeoutMs))) {
    process.kill(pid, 'SIGKILL');
    lastError = 'OBS musste nach Timeout beendet werden';
    log('obs_kill_fallback', { pid, timeoutMs });
  }
  state = 'stopped';
  stoppedAt = new Date().toISOString();
  child = null;
  clearPid();
  return obsStatus();
}
export function stopObs(signal: NodeJS.Signals = 'SIGTERM') {
  const pid = obsStatus().pid;
  if (!pid) return obsStatus();
  expectedStops.add(pid);
  process.kill(pid, signal);
  state = 'stopped';
  stoppedAt = new Date().toISOString();
  child = null;
  clearPid();
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
