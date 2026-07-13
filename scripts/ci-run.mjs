import { spawn } from 'node:child_process';
import { mkdir, writeFile } from 'node:fs/promises';

const procs = [];
const logsDir = 'logs';
await mkdir(logsDir, { recursive: true });
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
let failedProcess = null;
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
        assertBackgroundProcesses();
        resolve();
      } else reject(new Error(`${cmd} ${args.join(' ')} failed: ${code}`));
    });
  });
}
async function flushLogs() {
  await Promise.all(procs.map((p) => writeFile(`${logsDir}/${p.logName}`, Buffer.concat(p.chunks).toString())));
}
async function stopAll() {
  for (const { out } of procs.reverse()) if (out.exitCode == null) out.kill('SIGTERM');
  await sleep(1500);
  for (const { out } of procs) if (out.exitCode == null) out.kill('SIGKILL');
  await flushLogs();
}
process.on('SIGINT', () => void stopAll().finally(() => process.exit(130)));
process.on('SIGTERM', () => void stopAll().finally(() => process.exit(143)));

try {
  await waitUrl('http://postgres:5432', 'postgres', 1).catch(() => undefined);
  await command('npm', ['run', 'build', '-w', '@ans/database']);
  await command('npm', ['run', 'build', '-w', '@ans/api']);
  await command('npm', ['run', 'build', '-w', '@ans/web']);
  await command('npm', ['run', 'build', '-w', '@ans/broadcast-runner']);
  await command('npm', ['run', 'db:migrate']);
  run('npm', ['run', 'obs:mock'], 'obs-mock.log');
  await waitUrl(`http://127.0.0.1:${process.env.OBS_MOCK_STATUS_PORT ?? 4456}/ready`, 'obs mock');
  run('npm', ['run', 'start', '-w', '@ans/api'], 'api.log');
  await waitUrl('http://127.0.0.1:12000/health', 'api');
  run('npm', ['run', 'start', '-w', '@ans/web'], 'web.log');
  await waitUrl(process.env.PLAYWRIGHT_BASE_URL ?? 'http://127.0.0.1:4173', 'web');
  run('npm', ['run', 'start', '-w', '@ans/broadcast-runner'], 'broadcast-runner.log');
  await waitUrl(`http://127.0.0.1:${process.env.BROADCAST_RUNNER_STATUS_PORT ?? 12100}/ready`, 'broadcast runner');
  await command('npm', ['run', 'test:integration']);
  await command('npm', ['run', 'test:e2e']);
} finally {
  await stopAll();
}
