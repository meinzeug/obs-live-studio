import { chmod, mkdir, mkdtemp, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';
import { inspectBackupHealth } from '../apps/api/src/backup-health.js';

const temporaryDirectories: string[] = [];

async function createRoot() {
  const root = await mkdtemp(join(tmpdir(), 'backup-health-'));
  temporaryDirectories.push(root);
  const backupRoot = join(root, 'var/backups');
  await mkdir(backupRoot, { recursive: true, mode: 0o700 });
  await chmod(backupRoot, 0o700);
  return { root, backupRoot };
}

async function writeBackup(backupRoot: string, name: string, createdAt: string, mode = 0o600) {
  const directory = join(backupRoot, name);
  await mkdir(directory, { mode: 0o700 });
  await writeFile(
    join(directory, 'manifest.json'),
    `${JSON.stringify({ schemaVersion: 1, createdAt, databaseIncluded: true, artifacts: [] })}\n`,
    { mode },
  );
  await chmod(join(directory, 'manifest.json'), mode);
  return directory;
}

async function writeRehearsal(
  backupRoot: string,
  values: { ok: boolean; completedAt: string; backupDirectory?: string },
  mode = 0o600,
) {
  const directory = join(backupRoot, 'rehearsals');
  await mkdir(directory, { mode: 0o700 });
  await writeFile(join(directory, 'latest.json'), `${JSON.stringify(values)}\n`, { mode });
  await chmod(join(directory, 'latest.json'), mode);
}

afterEach(async () => {
  await Promise.all(temporaryDirectories.splice(0).map((path) => rm(path, { recursive: true, force: true })));
});

describe('backup health inspection', () => {
  it('reports fresh backups and successful restore rehearsals as ready', async () => {
    const { root, backupRoot } = await createRoot();
    const backup = await writeBackup(backupRoot, 'studio-20260714T100000Z', '2026-07-14T10:00:00.000Z');
    await writeRehearsal(backupRoot, {
      ok: true,
      completedAt: '2026-07-13T05:30:00.000Z',
      backupDirectory: backup,
    });

    const report = await inspectBackupHealth(
      { BACKUP_DIRECTORY: './var/backups' },
      { root, now: new Date('2026-07-14T12:00:00.000Z') },
    );

    expect(report.ready).toBe(true);
    expect(report.status).toBe('ready');
    expect(report.backup).toMatchObject({
      present: true,
      name: 'studio-20260714T100000Z',
      stale: false,
      databaseIncluded: true,
      secure: true,
    });
    expect(report.rehearsal).toMatchObject({ present: true, ok: true, stale: false, secure: true });
  });

  it('reports a missing backup as an error without leaking local paths', async () => {
    const { root } = await createRoot();
    const report = await inspectBackupHealth(
      { BACKUP_DIRECTORY: './var/backups' },
      { root, now: new Date('2026-07-14T12:00:00.000Z') },
    );

    expect(report.status).toBe('error');
    expect(report.backup.present).toBe(false);
    expect(JSON.stringify(report)).not.toContain(root);
    expect(report.checks).toEqual(
      expect.arrayContaining([expect.objectContaining({ id: 'latest-backup', status: 'error' })]),
    );
  });

  it('marks an overdue backup as an error', async () => {
    const { root, backupRoot } = await createRoot();
    await writeBackup(backupRoot, 'studio-20260710T000000Z', '2026-07-10T00:00:00.000Z');

    const report = await inspectBackupHealth(
      { BACKUP_DIRECTORY: './var/backups', BACKUP_MAX_AGE_HOURS: '36' },
      { root, now: new Date('2026-07-14T12:00:00.000Z') },
    );

    expect(report.status).toBe('error');
    expect(report.backup.stale).toBe(true);
  });

  it('uses a warning while no restore rehearsal exists yet', async () => {
    const { root, backupRoot } = await createRoot();
    await writeBackup(backupRoot, 'studio-20260714T100000Z', '2026-07-14T10:00:00.000Z');

    const report = await inspectBackupHealth(
      { BACKUP_DIRECTORY: './var/backups' },
      { root, now: new Date('2026-07-14T12:00:00.000Z') },
    );

    expect(report.status).toBe('warning');
    expect(report.rehearsal.present).toBe(false);
    expect(report.checks).toEqual(
      expect.arrayContaining([expect.objectContaining({ id: 'restore-rehearsal', status: 'warning' })]),
    );
  });

  it('marks an overdue restore rehearsal as an error', async () => {
    const { root, backupRoot } = await createRoot();
    const backup = await writeBackup(backupRoot, 'studio-20260714T100000Z', '2026-07-14T10:00:00.000Z');
    await writeRehearsal(backupRoot, {
      ok: true,
      completedAt: '2026-07-01T05:30:00.000Z',
      backupDirectory: backup,
    });

    const report = await inspectBackupHealth(
      { BACKUP_DIRECTORY: './var/backups', BACKUP_REHEARSAL_MAX_AGE_HOURS: '216' },
      { root, now: new Date('2026-07-14T12:00:00.000Z') },
    );

    expect(report.status).toBe('error');
    expect(report.rehearsal).toMatchObject({ present: true, ok: true, stale: true });
    expect(report.checks).toEqual(
      expect.arrayContaining([expect.objectContaining({ id: 'restore-rehearsal', status: 'error' })]),
    );
  });

  it('reports failed or insecure rehearsal reports as errors', async () => {
    const { root, backupRoot } = await createRoot();
    const backup = await writeBackup(backupRoot, 'studio-20260714T100000Z', '2026-07-14T10:00:00.000Z');
    await writeRehearsal(
      backupRoot,
      { ok: false, completedAt: '2026-07-14T11:00:00.000Z', backupDirectory: backup },
      0o644,
    );

    const report = await inspectBackupHealth(
      { BACKUP_DIRECTORY: './var/backups' },
      { root, now: new Date('2026-07-14T12:00:00.000Z') },
    );

    expect(report.status).toBe('error');
    expect(report.rehearsal).toMatchObject({ present: true, ok: false, secure: false });
    expect(report.checks).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ id: 'restore-rehearsal', status: 'error' }),
        expect.objectContaining({ id: 'restore-rehearsal-permissions', status: 'error' }),
      ]),
    );
  });
});
