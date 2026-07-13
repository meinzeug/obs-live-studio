import { spawn } from 'node:child_process';
import { setupPostgresTestService } from './postgres-test-service.mjs';

function run(cmd, args, options = {}) {
  return new Promise((resolve, reject) => {
    const child = spawn(cmd, args, { stdio: 'inherit', env: process.env, ...options });
    child.on('exit', (code) =>
      code === 0 ? resolve() : reject(new Error(`${cmd} ${args.join(' ')} failed: ${code}`)),
    );
  });
}

const postgresService = await setupPostgresTestService();
try {
  await run('node', ['packages/database/dist/migrate.js']);
  await run('vitest', ['run', 'tests/integration'], { env: { ...process.env, VITEST_INCLUDE_INTEGRATION: 'true' } });
} finally {
  await postgresService.cleanup();
}
