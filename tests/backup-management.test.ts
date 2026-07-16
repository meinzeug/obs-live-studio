import Fastify from 'fastify';
import { describe, expect, it, vi } from 'vitest';
import { BackupManager, registerBackupManagementRoutes } from '../apps/api/src/backup-management.js';
import type { BackupHealth } from '../apps/api/src/backup-health.js';
import { installApiErrorHandler } from '../apps/api/src/error-handler.js';

const health: BackupHealth = {
  ready: true,
  status: 'ready',
  backup: {
    present: true,
    name: 'studio-20260716T120000Z',
    createdAt: '2026-07-16T12:00:00.000Z',
    ageHours: 1,
    stale: false,
    databaseIncluded: true,
    secure: true,
  },
  rehearsal: {
    present: true,
    ok: true,
    backupName: 'studio-20260716T120000Z',
    completedAt: '2026-07-16T12:30:00.000Z',
    ageHours: 0.5,
    stale: false,
    secure: true,
  },
  checks: [],
};

function deferred() {
  let resolve!: () => void;
  let reject!: () => void;
  const promise = new Promise<void>((yes, no) => {
    resolve = yes;
    reject = no;
  });
  return { promise, resolve, reject };
}

describe('backup management', () => {
  it('allows only one backup job at a time and reports completion', async () => {
    const command = deferred();
    const manager = new BackupManager({
      inspectHealth: async () => health,
      runBackup: () => command.promise,
      now: () => new Date('2026-07-16T13:00:00.000Z'),
      randomId: () => 'job-1',
    });

    expect(manager.start()).toMatchObject({ id: 'job-1', status: 'running' });
    expect(manager.start()).toBeNull();
    command.resolve();
    await command.promise;
    await vi.waitFor(async () => expect((await manager.overview()).job?.status).toBe('completed'));
  });

  it('does not expose process errors in the API state', async () => {
    const manager = new BackupManager({
      inspectHealth: async () => health,
      runBackup: async () => {
        throw new Error('pg password=/secret/path');
      },
      now: () => new Date('2026-07-16T13:00:00.000Z'),
      randomId: () => 'job-2',
    });

    manager.start();
    await vi.waitFor(async () => expect((await manager.overview()).job?.status).toBe('failed'));
    expect((await manager.overview()).job?.error).toBe('Das Backup konnte nicht erstellt oder verifiziert werden.');
  });

  it('registers protected status and start routes', async () => {
    const app = Fastify();
    installApiErrorHandler(app);
    const manager = new BackupManager({
      inspectHealth: async () => health,
      runBackup: async () => undefined,
      now: () => new Date('2026-07-16T13:00:00.000Z'),
      randomId: () => 'job-3',
    });
    const requirePermission = vi.fn();
    registerBackupManagementRoutes(app, manager, requirePermission);

    const status = await app.inject({ method: 'GET', url: '/api/admin/backups' });
    const start = await app.inject({ method: 'POST', url: '/api/admin/backups' });

    expect(status.statusCode).toBe(200);
    expect(start.statusCode).toBe(202);
    expect(requirePermission).toHaveBeenCalledTimes(2);
    await app.close();
  });
});
