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
  // Diese Tests teilen absichtlich globale Broadcast-/Playback-Tabellen. Eine
  // serielle Dateiausführung verhindert gegenseitige Testinterferenzen. Reale
  // PostgreSQL-Transaktionen dürfen auf belasteten Entwicklungsrechnern etwas
  // länger als das für reine Unit-Tests sinnvolle Fünf-Sekunden-Limit dauern.
  await run(
    'vitest',
    [
      'run',
      'tests/integration',
      '--maxWorkers=1',
      '--no-file-parallelism',
      '--testTimeout=15000',
      '--hookTimeout=15000',
    ],
    {
      env: { ...process.env, VITEST_INCLUDE_INTEGRATION: 'true' },
    },
  );
} finally {
  await postgresService.cleanup();
}
