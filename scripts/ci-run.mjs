import { spawn, spawnSync } from 'node:child_process';
import { mkdir, writeFile } from 'node:fs/promises';
import { setupPostgresTestService } from './postgres-test-service.mjs';

if (!process.env.DESKTOP_AGENT_TOKEN)
  process.env.DESKTOP_AGENT_TOKEN = 'ci-desktop-agent-token-000000000000000000000000';
process.env.OBS_HOST ??= '127.0.0.1';
process.env.OBS_PORT ??= '4455';
process.env.OBS_MOCK_STATUS_PORT ??= '4456';
process.env.PLAYWRIGHT_BASE_URL ??= 'http://127.0.0.1:12001';
if (!process.env.PLAYWRIGHT_CHROMIUM_EXECUTABLE) {
  const chrome = spawnSync('which', ['google-chrome'], { encoding: 'utf8' });
  if (chrome.status === 0) process.env.PLAYWRIGHT_CHROMIUM_EXECUTABLE = chrome.stdout.trim();
}
const procs = [];
const logsDir = 'logs';
await mkdir(logsDir, { recursive: true });
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
let failedProcess = null;
let shuttingDown = false;
let postgresService = null;
function run(cmd, args, logName, opts = {}) {
  const out = spawn(cmd, args, {
    stdio: ['ignore', 'pipe', 'pipe'],
    shell: false,
    env: { ...process.env, ...opts.env },
  });
  const chunks = [];
  out.stdout.on('data', (d) => chunks.push(d));
  out.stderr.on('data', (d) => chunks.push(d));
  out.on('exit', (code, signal) => {
    if (shuttingDown && (signal === 'SIGTERM' || signal === 'SIGKILL')) return;
    if (code !== 0 && failedProcess == null) failedProcess = { logName, code, signal };
  });
  procs.push({ out, logName, chunks });
  return out;
}
function assertBackgroundProcesses() {
  if (failedProcess)
    throw new Error(
      `Background process ${failedProcess.logName} exited early: ${failedProcess.code ?? failedProcess.signal}`,
    );
}
async function waitUrl(url, name, tries = 120) {
  for (let i = 0; i < tries; i += 1) {
    assertBackgroundProcesses();
    try {
      const res = await fetch(url);
      if (res.ok) return;
    } catch {}
    await sleep(1000);
  }
  throw new Error(`${name} not ready at ${url}`);
}
async function command(cmd, args) {
  assertBackgroundProcesses();
  await new Promise((resolve, reject) => {
    const p = spawn(cmd, args, { stdio: 'inherit', env: process.env });
    p.on('exit', (code) => {
      if (code === 0) {
        resolve();
      } else reject(new Error(`${cmd} ${args.join(' ')} failed: ${code}`));
    });
  });
}
async function flushLogs() {
  await Promise.all(procs.map((p) => writeFile(`${logsDir}/${p.logName}`, Buffer.concat(p.chunks).toString())));
}
async function waitForExit(proc, timeoutMs) {
  if (proc.exitCode != null || proc.signalCode != null) return true;
  return await new Promise((resolve) => {
    const timer = setTimeout(() => resolve(false), timeoutMs);
    proc.once('exit', () => {
      clearTimeout(timer);
      resolve(true);
    });
  });
}
async function stopAll() {
  shuttingDown = true;
  for (const { out } of [...procs].reverse()) if (out.exitCode == null && out.signalCode == null) out.kill('SIGTERM');
  const termResults = await Promise.all(procs.map(({ out }) => waitForExit(out, 1500)));
  for (const [index, { out }] of procs.entries()) {
    if (!termResults[index] && out.exitCode == null && out.signalCode == null) out.kill('SIGKILL');
  }
  await Promise.all(procs.map(({ out }) => waitForExit(out, 5000)));
  await flushLogs();
}
process.on('SIGINT', () => void stopAll().finally(() => process.exit(130)));
process.on('SIGTERM', () => void stopAll().finally(() => process.exit(143)));

try {
  await command('npm', ['run', 'format:check']);
  await command('npm', ['run', 'lint']);
  await command('npm', ['run', 'typecheck']);
  await command('npm', ['run', 'build']);
  postgresService = await setupPostgresTestService();
  await command('node', ['packages/database/dist/migrate.js']);
  await command('npm', ['test']);
  await command('npm', ['run', 'test:integration']);
  run('npm', ['run', 'obs:mock'], 'obs-mock.log');
  await waitUrl(`http://127.0.0.1:${process.env.OBS_MOCK_STATUS_PORT ?? 4456}/ready`, 'obs mock');
  run('npm', ['run', 'start', '-w', '@ans/api'], 'api.log');
  await waitUrl('http://127.0.0.1:12000/health', 'api');
  run('npm', ['run', 'start', '-w', '@ans/web'], 'web.log');
  await waitUrl(process.env.PLAYWRIGHT_BASE_URL ?? 'http://127.0.0.1:12001', 'web');
  run('npm', ['run', 'start', '-w', '@ans/broadcast-runner'], 'broadcast-runner.log');
  await waitUrl(`http://127.0.0.1:${process.env.BROADCAST_RUNNER_STATUS_PORT ?? 12100}/ready`, 'broadcast runner');
  await command('npm', ['run', 'test:e2e']);
} finally {
  await stopAll();
  await postgresService?.cleanup();
}
process.exit(0);
