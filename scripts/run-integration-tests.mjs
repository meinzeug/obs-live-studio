import { spawn, spawnSync } from 'node:child_process';

function run(cmd, args, options = {}) {
  return new Promise((resolve, reject) => {
    const child = spawn(cmd, args, { stdio: 'inherit', env: process.env, ...options });
    child.on('exit', (code) =>
      code === 0 ? resolve() : reject(new Error(`${cmd} ${args.join(' ')} failed: ${code}`)),
    );
  });
}
function has(cmd) {
  return spawnSync(cmd, ['--version'], { stdio: 'ignore' }).status === 0;
}

let container;
if (!process.env.DATABASE_URL) {
  if (!has('docker')) throw new Error('DATABASE_URL is not set and Docker is unavailable to start PostgreSQL');
  const name = `obs-live-studio-integration-${process.pid}`;
  process.env.DATABASE_URL = 'postgres://ans:ans@127.0.0.1:55432/ans_test';
  await run('docker', [
    'run',
    '--rm',
    '--name',
    name,
    '-e',
    'POSTGRES_USER=ans',
    '-e',
    'POSTGRES_PASSWORD=ans',
    '-e',
    'POSTGRES_DB=ans_test',
    '-p',
    '55432:5432',
    '-d',
    'postgres:16',
  ]);
  container = name;
  for (let i = 0; i < 60; i += 1) {
    const ready = spawnSync('docker', ['exec', name, 'pg_isready', '-U', 'ans', '-d', 'ans_test'], { stdio: 'ignore' });
    if (ready.status === 0) break;
    await new Promise((resolve) => setTimeout(resolve, 1000));
  }
}
try {
  await run('vitest', ['run', 'tests/integration'], { env: { ...process.env, VITEST_INCLUDE_INTEGRATION: 'true' } });
} finally {
  if (container) spawnSync('docker', ['stop', container], { stdio: 'inherit' });
}
