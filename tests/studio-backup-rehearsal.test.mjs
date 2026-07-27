import { chmod, lstat, mkdir, mkdtemp, readFile, rm, symlink, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { basename, join } from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';
import { createStudioBackup } from '../scripts/studio-backup-lib.mjs';
import { rehearseStudioBackup, runCommandCapture } from '../scripts/studio-backup-rehearsal-lib.mjs';

const temporaryDirectories = [];

async function createStudioRoot() {
  const root = await mkdtemp(join(tmpdir(), 'studio-rehearsal-test-'));
  temporaryDirectories.push(root);
  await writeFile(
    join(root, 'package.json'),
    `${JSON.stringify({ name: 'restore-rehearsal-fixture', private: true }, null, 2)}\n`,
    { mode: 0o600 },
  );
  await writeFile(join(root, 'application.txt'), 'recoverable application data\n', { mode: 0o600 });
  return root;
}

afterEach(async () => {
  await Promise.all(temporaryDirectories.splice(0).map((path) => rm(path, { recursive: true, force: true })));
});

describe('studio backup restore rehearsal', () => {
  it('keeps durable data but omits runtimes, models, generated TTS and optional media from the real archive', async () => {
    const root = await createStudioRoot();
    await Promise.all([
      mkdir(join(root, 'var/models'), { recursive: true }),
      mkdir(join(root, 'var/pocket-tts-venv'), { recursive: true }),
      mkdir(join(root, 'var/tts'), { recursive: true }),
      mkdir(join(root, 'var/cache'), { recursive: true }),
      mkdir(join(root, 'var/media'), { recursive: true }),
      mkdir(join(root, 'var/channel-branding'), { recursive: true }),
    ]);
    await Promise.all([
      writeFile(join(root, 'var/models/model.bin'), 'model'),
      writeFile(join(root, 'var/pocket-tts-venv/runtime.bin'), 'runtime'),
      writeFile(join(root, 'var/tts/generated.wav'), 'generated audio'),
      writeFile(join(root, 'var/cache/cache.bin'), 'cache'),
      writeFile(join(root, 'var/media/upload.mp4'), 'optional media'),
      writeFile(join(root, 'var/channel-branding/logo.png'), 'durable branding'),
    ]);
    const backup = await createStudioBackup({
      root,
      env: {
        BACKUP_DIRECTORY: './var/backups',
        BACKUP_INCLUDE_MEDIA: 'false',
        BACKUP_MIN_FREE_BYTES: '0',
      },
      now: new Date('2026-07-14T12:00:00Z'),
    });
    const listing = await runCommandCapture('tar', [
      '--list',
      '--gzip',
      '--file',
      join(backup.directory, 'app.tar.gz'),
    ]);
    expect(listing.stdout).toContain('./var/channel-branding/logo.png');
    expect(listing.stdout).not.toContain('./var/models/');
    expect(listing.stdout).not.toContain('./var/pocket-tts-venv/');
    expect(listing.stdout).not.toContain('./var/tts/');
    expect(listing.stdout).not.toContain('./var/cache/');
    expect(listing.stdout).not.toContain('./var/media/');
  });

  it('extracts and inspects the latest verified application backup', async () => {
    const root = await createStudioRoot();
    await createStudioBackup({
      root,
      env: {
        BACKUP_DIRECTORY: './var/backups',
        BACKUP_INCLUDE_MEDIA: 'false',
        BACKUP_MIN_FREE_BYTES: '0',
      },
      now: new Date('2026-07-13T12:00:00Z'),
    });
    const latest = await createStudioBackup({
      root,
      env: {
        BACKUP_DIRECTORY: './var/backups',
        BACKUP_INCLUDE_MEDIA: 'false',
        BACKUP_MIN_FREE_BYTES: '0',
      },
      now: new Date('2026-07-14T12:00:00Z'),
    });

    const report = await rehearseStudioBackup({
      root,
      env: { BACKUP_DIRECTORY: './var/backups', BACKUP_MIN_FREE_BYTES: '0' },
      now: new Date('2026-07-14T13:00:00Z'),
      completedAt: new Date('2026-07-14T13:00:01Z'),
    });

    expect(report.ok).toBe(true);
    expect(report.backupDirectory).toBe(latest.directory);
    expect(report.application.packageName).toBe('restore-rehearsal-fixture');
    expect(report.application.files).toBeGreaterThanOrEqual(2);
    expect(report.database).toEqual({ included: false, archiveReadable: null, tocEntries: 0 });
    expect(report.durationMs).toBe(1000);

    const statusPath = join(root, 'var/backups/rehearsals', `${basename(latest.directory)}.json`);
    const status = JSON.parse(await readFile(statusPath, 'utf8'));
    expect(status.ok).toBe(true);
    expect((await lstat(statusPath)).mode & 0o777).toBe(0o600);
  });

  it('rejects application archives with symlinks that escape the restored tree', async () => {
    const root = await createStudioRoot();
    await symlink('/etc/passwd', join(root, 'unsafe-link'));
    const backup = await createStudioBackup({
      root,
      env: { BACKUP_DIRECTORY: './var/backups', BACKUP_MIN_FREE_BYTES: '0' },
      now: new Date('2026-07-14T12:00:00Z'),
    });

    const report = await rehearseStudioBackup({
      root,
      env: { BACKUP_DIRECTORY: './var/backups' },
      backupDirectory: backup.directory,
    });

    expect(report.ok).toBe(false);
    expect(report.errors).toEqual(expect.arrayContaining([expect.stringContaining('unsafe symlink')]));
  });

  it('checks that a PostgreSQL custom dump has restore entries', async () => {
    const root = await createStudioRoot();
    const backupRunner = async (command, args, options) => {
      if (command === 'tar') return await runCommandCapture(command, args, options);
      if (command === 'pg_dump') {
        const outputPath = args[args.indexOf('--file') + 1];
        await writeFile(outputPath, 'synthetic PostgreSQL custom dump', { mode: 0o600 });
        await chmod(outputPath, 0o600);
        return;
      }
      throw new Error(`Unexpected command: ${command}`);
    };
    const backup = await createStudioBackup({
      root,
      env: {
        BACKUP_DIRECTORY: './var/backups',
        BACKUP_MIN_FREE_BYTES: '0',
        DATABASE_URL: 'postgresql://studio:secret@localhost:5432/studio',
      },
      now: new Date('2026-07-14T12:00:00Z'),
      commandRunner: backupRunner,
    });
    const rehearsalRunner = async (command, args, options) => {
      if (command === 'tar') return await runCommandCapture(command, args, options);
      if (command === 'pg_restore') {
        return { stdout: '; archive header\n1; 0 0 TABLE public broadcasts studio\n', stderr: '' };
      }
      throw new Error(`Unexpected command: ${command}`);
    };

    const report = await rehearseStudioBackup({
      root,
      env: { BACKUP_DIRECTORY: './var/backups', BACKUP_MIN_FREE_BYTES: '0' },
      backupDirectory: backup.directory,
      commandRunner: rehearsalRunner,
    });

    expect(report.ok).toBe(true);
    expect(report.database).toEqual({ included: true, archiveReadable: true, tocEntries: 1 });
  });

  it('fails when a database dump has no usable restore entries', async () => {
    const root = await createStudioRoot();
    const backupRunner = async (command, args, options) => {
      if (command === 'tar') return await runCommandCapture(command, args, options);
      const outputPath = args[args.indexOf('--file') + 1];
      await writeFile(outputPath, 'synthetic PostgreSQL custom dump', { mode: 0o600 });
    };
    const backup = await createStudioBackup({
      root,
      env: {
        BACKUP_DIRECTORY: './var/backups',
        BACKUP_MIN_FREE_BYTES: '0',
        DATABASE_URL: 'postgresql://studio:secret@localhost:5432/studio',
      },
      now: new Date('2026-07-14T12:00:00Z'),
      commandRunner: backupRunner,
    });

    const report = await rehearseStudioBackup({
      root,
      env: { BACKUP_DIRECTORY: './var/backups', BACKUP_MIN_FREE_BYTES: '0' },
      backupDirectory: backup.directory,
      commandRunner: async (command, args, options) =>
        command === 'tar'
          ? await runCommandCapture(command, args, options)
          : { stdout: '; comments only\n', stderr: '' },
    });

    expect(report.ok).toBe(false);
    expect(report.errors).toEqual(expect.arrayContaining([expect.stringContaining('no restore entries')]));
  });
});
