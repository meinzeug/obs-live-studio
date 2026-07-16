import type { FastifyInstance, FastifyReply, FastifyRequest } from 'fastify';
import { spawn } from 'node:child_process';
import { randomUUID } from 'node:crypto';
import { inspectBackupHealth, type BackupHealth } from './backup-health.js';
import type { WritePermission } from '@ans/security/auth';

export type BackupJob = {
  id: string;
  status: 'running' | 'completed' | 'failed';
  startedAt: string;
  completedAt: string | null;
  error: string | null;
};

export type BackupOverview = {
  health: BackupHealth;
  job: BackupJob | null;
};

type BackupManagerDependencies = {
  inspectHealth: () => Promise<BackupHealth>;
  runBackup: () => Promise<void>;
  now: () => Date;
  randomId: () => string;
};

function runBackupProcess() {
  return new Promise<void>((resolve, reject) => {
    const child = spawn(process.execPath, ['--env-file=.env', 'scripts/studio-backup.mjs', '--json'], {
      cwd: process.cwd(),
      env: process.env,
      stdio: ['ignore', 'ignore', 'inherit'],
      shell: false,
    });
    child.once('error', reject);
    child.once('exit', (code, signal) => {
      if (code === 0) resolve();
      else reject(new Error(`Backup-Prozess beendet: ${code ?? signal ?? 'unbekannt'}`));
    });
  });
}

export class BackupManager {
  private job: BackupJob | null = null;

  constructor(
    private readonly dependencies: BackupManagerDependencies = {
      inspectHealth: () => inspectBackupHealth(),
      runBackup: runBackupProcess,
      now: () => new Date(),
      randomId: () => randomUUID(),
    },
  ) {}

  async overview(): Promise<BackupOverview> {
    return { health: await this.dependencies.inspectHealth(), job: this.job ? { ...this.job } : null };
  }

  start(): BackupJob | null {
    if (this.job?.status === 'running') return null;
    const started = this.dependencies.now();
    this.job = {
      id: this.dependencies.randomId(),
      status: 'running',
      startedAt: started.toISOString(),
      completedAt: null,
      error: null,
    };
    const jobId = this.job.id;
    void this.dependencies.runBackup().then(
      () => this.finish(jobId, 'completed'),
      () => this.finish(jobId, 'failed', 'Das Backup konnte nicht erstellt oder verifiziert werden.'),
    );
    return { ...this.job };
  }

  private finish(id: string, status: 'completed' | 'failed', error: string | null = null) {
    if (!this.job || this.job.id !== id) return;
    this.job = {
      ...this.job,
      status,
      completedAt: this.dependencies.now().toISOString(),
      error,
    };
  }
}

export function registerBackupManagementRoutes(
  app: FastifyInstance,
  manager: BackupManager,
  requirePermission: (req: FastifyRequest, reply: FastifyReply, permission: WritePermission) => void,
) {
  app.get('/api/admin/backups', async (req, reply) => {
    requirePermission(req, reply, 'users:write');
    return manager.overview();
  });

  app.post('/api/admin/backups', async (req, reply) => {
    requirePermission(req, reply, 'users:write');
    const job = manager.start();
    if (!job) return reply.code(409).send({ ok: false, error: 'Ein Backup wird bereits erstellt.' });
    return reply.code(202).send({ ok: true, job });
  });
}
