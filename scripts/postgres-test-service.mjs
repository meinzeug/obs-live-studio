import { spawn, spawnSync } from 'node:child_process';
import { randomUUID } from 'node:crypto';

const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

function has(cmd) {
  return spawnSync(cmd, ['--version'], { stdio: 'ignore' }).status === 0;
}

function run(cmd, args, options = {}) {
  return new Promise((resolve, reject) => {
    const child = spawn(cmd, args, { stdio: 'inherit', env: process.env, ...options });
    child.on('exit', (code) =>
      code === 0 ? resolve() : reject(new Error(`${cmd} ${args.join(' ')} failed: ${code}`)),
    );
  });
}

function pgIsReadyArgs(databaseUrl) {
  const url = new URL(databaseUrl);
  const args = ['-h', url.hostname, '-p', url.port || '5432'];
  if (url.username) args.push('-U', decodeURIComponent(url.username));
  const db = url.pathname.replace(/^\//, '');
  if (db) args.push('-d', decodeURIComponent(db));
  return args;
}

async function waitForPgIsReady({ databaseUrl, containerName, timeoutMs = 60_000 }) {
  const deadline = Date.now() + timeoutMs;
  let lastStatus = null;
  while (Date.now() < deadline) {
    const ready = containerName
      ? spawnSync('docker', ['exec', containerName, 'pg_isready', '-U', 'ans', '-d', 'ans_test'], { stdio: 'ignore' })
      : spawnSync('pg_isready', pgIsReadyArgs(databaseUrl), { stdio: 'ignore' });
    lastStatus = ready.status;
    if (ready.status === 0) return;
    await sleep(1000);
  }
  throw new Error(`PostgreSQL was not ready before timeout (${timeoutMs}ms); last pg_isready status: ${lastStatus}`);
}

export async function setupPostgresTestService() {
  if (process.env.DATABASE_URL) {
    if (!has('pg_isready')) throw new Error('DATABASE_URL is set but pg_isready is unavailable');
    await waitForPgIsReady({ databaseUrl: process.env.DATABASE_URL });
    return { databaseUrl: process.env.DATABASE_URL, async cleanup() {} };
  }

  if (!has('docker')) throw new Error('DATABASE_URL is not set and Docker is unavailable to start PostgreSQL');

  const containerName = `obs-live-studio-test-${process.pid}-${randomUUID().slice(0, 8)}`;
  await run('docker', [
    'run',
    '--rm',
    '--name',
    containerName,
    '-e',
    'POSTGRES_USER=ans',
    '-e',
    'POSTGRES_PASSWORD=ans',
    '-e',
    'POSTGRES_DB=ans_test',
    '-p',
    '127.0.0.1::5432',
    '-d',
    'postgres:16',
  ]);

  const inspect = spawnSync('docker', ['port', containerName, '5432/tcp'], {
    encoding: 'utf8',
    stdio: ['ignore', 'pipe', 'pipe'],
  });
  if (inspect.status !== 0) {
    spawnSync('docker', ['stop', containerName], { stdio: 'inherit' });
    throw new Error(`Unable to inspect PostgreSQL test container port: ${inspect.stderr}`);
  }
  const hostPort = inspect.stdout.trim().match(/:(\d+)$/)?.[1];
  if (!hostPort) {
    spawnSync('docker', ['stop', containerName], { stdio: 'inherit' });
    throw new Error(`Unable to parse PostgreSQL test container port from: ${inspect.stdout}`);
  }

  process.env.DATABASE_URL = `postgres://ans:ans@127.0.0.1:${hostPort}/ans_test`;
  await waitForPgIsReady({ databaseUrl: process.env.DATABASE_URL, containerName });

  return {
    databaseUrl: process.env.DATABASE_URL,
    async cleanup() {
      spawnSync('docker', ['stop', containerName], { stdio: 'inherit' });
    },
  };
}
