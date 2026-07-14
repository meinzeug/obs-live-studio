import { chmod, mkdir, mkdtemp, rm, stat, utimes, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';
import {
  buildTarArguments,
  createStudioBackup,
  postgresDumpInvocation,
  pruneBackups,
  sha256File,
  verifyStudioBackup,
} from '../scripts/studio-backup-lib.mjs';

const temporaryDirectories = [];

async function temporaryDirectory() {
  const directory = await mkdtemp(join(tmpdir(), 'studio-backup-test-'));
  temporaryDirectories.push(directory);
  return directory;
}

async function createVerifiedBackup(root, mode = 0o600) {
  const directory = join(root, 'studio-20260714T120000Z');
  await mkdir(directory, { mode: 0o700 });
  const artifactPath = join(directory, 'app.tar.gz');
  await writeFile(artifactPath, 'archive data', { mode });
  await chmod(artifactPath, mode);
  const artifactStats = await stat(artifactPath);
  const manifest = {
    schemaVersion: 1,
    createdAt: '2026-07-14T12:00:00.000Z',
    includeMedia: true,
    databaseIncluded: false,
    artifacts: [
      {
        file: 'app.tar.gz',
        bytes: artifactStats.size,
        sha256: await sha256File(artifactPath),
        mode: mode.toString(8).padStart(4, '0'),
      },
    ],
  };
  await writeFile(join(directory, 'manifest.json'), `${JSON.stringify(manifest, null, 2)}\n`, { mode: 0o600 });
  return { directory, artifactPath };
}

afterEach(async () => {
  await Promise.all(temporaryDirectories.splice(0).map((directory) => rm(directory, { recursive: true, force: true })));
});

describe('studio backup safety', () => {
  it('excludes the backup directory itself and generated build trees', async () => {
    const root = await temporaryDirectory();
    const args = buildTarArguments({
      root,
      outputPath: join(root, 'var/backups/staging/app.tar.gz'),
      backupDirectory: join(root, 'var/backups'),
      mediaDirectory: './var/media',
      includeMedia: true,
    });

    expect(args).toContain('--exclude=var/backups');
    expect(args).toContain('--exclude=*/node_modules');
    expect(args).toContain('--exclude=*/dist');
  });

  it('does not expose the database password in pg_dump arguments', () => {
    const invocation = postgresDumpInvocation(
      'postgresql://studio-user:very-secret@localhost:5432/newsstudio?sslmode=require',
      '/tmp/database.dump',
      {},
    );

    expect(invocation.args.join(' ')).not.toContain('very-secret');
    expect(invocation.env.PGPASSWORD).toBe('very-secret');
    expect(invocation.env.PGSSLMODE).toBe('require');
  });

  it('creates an atomic verified backup and keeps credentials out of command arguments', async () => {
    const root = await temporaryDirectory();
    await writeFile(join(root, '.env'), 'SESSION_SECRET=hidden\n', { mode: 0o600 });
    const invocations = [];
    const commandRunner = async (command, args) => {
      invocations.push({ command, args });
      const outputPath = args[args.indexOf('--file') + 1];
      await writeFile(outputPath, command === 'tar' ? 'archive' : 'database', { mode: 0o600 });
    };

    const result = await createStudioBackup({
      root,
      env: {
        BACKUP_DIRECTORY: './var/backups',
        BACKUP_RETENTION_DAYS: '14',
        BACKUP_INCLUDE_MEDIA: 'true',
        DATABASE_URL: 'postgresql://studio-user:very-secret@localhost:5432/newsstudio',
      },
      now: new Date('2026-07-14T12:00:00Z'),
      commandRunner,
    });

    expect(result.verification.ok).toBe(true);
    expect(result.warnings).toEqual([]);
    expect(invocations).toHaveLength(2);
    expect(invocations[1].args.join(' ')).not.toContain('very-secret');
    expect((await stat(result.directory)).mode & 0o777).toBe(0o700);
    expect((await stat(join(result.directory, 'app.tar.gz'))).mode & 0o777).toBe(0o600);
  });

  it('rejects ambiguous media backup flags', async () => {
    const root = await temporaryDirectory();
    await expect(
      createStudioBackup({
        root,
        env: { BACKUP_INCLUDE_MEDIA: 'sometimes' },
        commandRunner: async () => undefined,
      }),
    ).rejects.toThrow('BACKUP_INCLUDE_MEDIA must be true or false');
  });

  it('accepts an intact backup with private permissions', async () => {
    const root = await temporaryDirectory();
    const { directory } = await createVerifiedBackup(root);
    const report = await verifyStudioBackup(directory);
    expect(report.ok).toBe(true);
    expect(report.errors).toEqual([]);
  });

  it('detects checksum tampering without exposing file contents', async () => {
    const root = await temporaryDirectory();
    const { directory, artifactPath } = await createVerifiedBackup(root);
    await writeFile(artifactPath, 'tampered archive', { mode: 0o600 });
    const report = await verifyStudioBackup(directory);
    expect(report.ok).toBe(false);
    expect(report.errors).toEqual(expect.arrayContaining([expect.stringContaining('checksum mismatch')]));
  });

  it('rejects backup artifacts readable by other users', async () => {
    const root = await temporaryDirectory();
    const { directory } = await createVerifiedBackup(root, 0o644);
    const report = await verifyStudioBackup(directory);
    expect(report.ok).toBe(false);
    expect(report.errors).toEqual(expect.arrayContaining([expect.stringContaining('mode is too permissive')]));
  });

  it('prunes only complete expired backup directories', async () => {
    const root = await temporaryDirectory();
    const oldBackup = join(root, 'studio-20260101T000000Z');
    const recentBackup = join(root, 'studio-20260714T120000Z');
    const staging = join(root, '.studio-backup-incomplete');
    await Promise.all([mkdir(oldBackup), mkdir(recentBackup), mkdir(staging)]);
    await Promise.all([
      writeFile(join(oldBackup, 'manifest.json'), '{}', { mode: 0o600 }),
      writeFile(join(recentBackup, 'manifest.json'), '{}', { mode: 0o600 }),
    ]);
    const oldDate = new Date('2026-01-01T00:00:00Z');
    await utimes(oldBackup, oldDate, oldDate);
    const now = new Date('2026-07-14T12:00:00Z');
    await utimes(recentBackup, now, now);
    await utimes(staging, oldDate, oldDate);

    const removed = await pruneBackups(root, 14, now);
    expect(removed).toEqual([oldBackup]);
    await expect(stat(recentBackup)).resolves.toBeTruthy();
    await expect(stat(staging)).resolves.toBeTruthy();
  });
});
