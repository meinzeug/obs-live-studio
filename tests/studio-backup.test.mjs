import { chmod, mkdir, mkdtemp, readdir, rm, stat, utimes, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';
import {
  buildTarArguments,
  cleanupStagingDirectories,
  createStudioBackup,
  estimateIncludedSourceBytes,
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

async function createVerifiedBackup(root, name = 'studio-20260714T120000Z', mode = 0o600) {
  const directory = join(root, name);
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
  it('centrally excludes reconstructable runtimes, models, TTS output, caches and build trees', async () => {
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
    expect(args).toContain('--exclude=var/*-venv');
    expect(args).toContain('--exclude=var/models');
    expect(args).toContain('--exclude=var/tts');
    expect(args).toContain('--exclude=var/yt-dlp');
    expect(args).toContain('--exclude=var/bgutil-ytdlp-pot-provider');
    expect(args).toContain('--exclude=var/cache');
    expect(args).toContain('--exclude=var/renders');
  });

  it('uses the media switch and explicit extra include/exclude paths', async () => {
    const root = await temporaryDirectory();
    const withoutMedia = buildTarArguments({
      root,
      outputPath: join(root, 'var/backups/staging/app.tar.gz'),
      backupDirectory: join(root, 'var/backups'),
      mediaDirectory: './var/media',
      includeMedia: false,
      extraIncludes: ['var/models'],
      extraExcludes: ['var/custom-cache'],
    });
    expect(withoutMedia).toContain('--exclude=var/media');
    expect(withoutMedia).toContain('--exclude=var/custom-cache');
    expect(withoutMedia).not.toContain('--exclude=var/models');
    expect(withoutMedia).not.toContain('--exclude=var/models/**');

    const withMedia = buildTarArguments({
      root,
      outputPath: join(root, 'var/backups/staging/app.tar.gz'),
      backupDirectory: join(root, 'var/backups'),
      mediaDirectory: './var/media',
      includeMedia: true,
    });
    expect(withMedia).not.toContain('--exclude=var/media');

    const withNamedRuntime = buildTarArguments({
      root,
      outputPath: join(root, 'var/backups/staging/app.tar.gz'),
      backupDirectory: join(root, 'var/backups'),
      mediaDirectory: './var/media',
      includeMedia: false,
      extraIncludes: ['var/custom-venv'],
    });
    expect(withNamedRuntime).not.toContain('--exclude=var/*-venv');
    expect(withNamedRuntime).not.toContain('--exclude=var/*-venv/**');
  });

  it('uses the same exclusions for the non-writing source size estimate', async () => {
    const root = await temporaryDirectory();
    await mkdir(join(root, 'var/models'), { recursive: true });
    await mkdir(join(root, 'var/media'), { recursive: true });
    await mkdir(join(root, 'packages/example/node_modules/dependency'), { recursive: true });
    await writeFile(join(root, 'package.json'), 'durable');
    await writeFile(join(root, 'var/models/model.bin'), 'reconstructable model');
    await writeFile(join(root, 'var/media/clip.mp4'), 'persistent media');
    await writeFile(join(root, 'packages/example/node_modules/dependency/index.js'), 'dependency cache');
    const withoutMedia = await estimateIncludedSourceBytes({
      root,
      backupDirectory: join(root, 'var/backups'),
      mediaDirectory: './var/media',
      includeMedia: false,
    });
    const withMedia = await estimateIncludedSourceBytes({
      root,
      backupDirectory: join(root, 'var/backups'),
      mediaDirectory: './var/media',
      includeMedia: true,
    });
    expect(withoutMedia.bytes).toBe(Buffer.byteLength('durable'));
    expect(withMedia.bytes).toBe(Buffer.byteLength('durablepersistent media'));
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
        BACKUP_MAX_COUNT: '2',
        BACKUP_MIN_FREE_BYTES: '0',
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
    const { directory } = await createVerifiedBackup(root, 'studio-20260714T120000Z', 0o644);
    const report = await verifyStudioBackup(directory);
    expect(report.ok).toBe(false);
    expect(report.errors).toEqual(expect.arrayContaining([expect.stringContaining('mode is too permissive')]));
  });

  it('prunes only complete expired backup directories', async () => {
    const root = await temporaryDirectory();
    const { directory: oldBackup } = await createVerifiedBackup(root, 'studio-20260101T000000Z');
    const { directory: recentBackup } = await createVerifiedBackup(root, 'studio-20260714T120000Z');
    const staging = join(root, '.studio-backup-incomplete');
    await mkdir(staging);
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

  it('aborts before tar and before staging creation when space is insufficient', async () => {
    const root = await temporaryDirectory();
    const invocations = [];
    await expect(
      createStudioBackup({
        root,
        env: {
          BACKUP_DIRECTORY: './var/backups',
          BACKUP_MIN_FREE_BYTES: String(5 * 1024 ** 3),
          BACKUP_INCLUDE_MEDIA: 'false',
        },
        estimateProvider: async () => ({ bytes: 2 * 1024 ** 3, files: 10, exclusions: [] }),
        statfsFn: async () => ({ bsize: 4096, bavail: Math.floor((3 * 1024 ** 3) / 4096) }),
        commandRunner: async (...args) => invocations.push(args),
      }),
    ).rejects.toThrow(/free=.*estimated backup=.*reserved=.*No archive was started/u);
    expect(invocations).toEqual([]);
    const entries = await readdir(join(root, 'var/backups'));
    expect(entries.some((entry) => entry.startsWith('.studio-backup-'))).toBe(false);
  });

  it('cleans abandoned staging directories without touching complete backups', async () => {
    const root = await temporaryDirectory();
    const staging = join(root, '.studio-backup-abandoned');
    const complete = await createVerifiedBackup(root);
    await mkdir(staging);
    expect(await cleanupStagingDirectories(root)).toEqual([staging]);
    await expect(stat(staging)).rejects.toMatchObject({ code: 'ENOENT' });
    await expect(stat(complete.directory)).resolves.toBeTruthy();
  });

  it('pre-prunes to leave one protected backup slot and never removes the latest verified backup', async () => {
    const root = await temporaryDirectory();
    const backupRoot = join(root, 'var/backups');
    await mkdir(backupRoot, { recursive: true });
    const oldest = await createVerifiedBackup(backupRoot, 'studio-20260712T120000Z');
    const latest = await createVerifiedBackup(backupRoot, 'studio-20260713T120000Z');
    const commandRunner = async (command, args) => {
      const outputPath = args[args.indexOf('--file') + 1];
      await writeFile(outputPath, command === 'tar' ? 'new archive' : 'database', { mode: 0o600 });
    };
    const result = await createStudioBackup({
      root,
      env: {
        BACKUP_DIRECTORY: './var/backups',
        BACKUP_MAX_COUNT: '2',
        BACKUP_MIN_FREE_BYTES: '0',
        BACKUP_INCLUDE_MEDIA: 'false',
      },
      now: new Date('2026-07-14T12:00:00Z'),
      statfsFn: async () => ({ bsize: 4096, bavail: 10_000_000 }),
      commandRunner,
    });
    expect(result.preRemoved).toEqual([oldest.directory]);
    await expect(stat(oldest.directory)).rejects.toMatchObject({ code: 'ENOENT' });
    await expect(stat(latest.directory)).resolves.toBeTruthy();
    await expect(stat(result.directory)).resolves.toBeTruthy();
  });

  it('enforces BACKUP_MAX_COUNT while preserving the newest verified backup', async () => {
    const root = await temporaryDirectory();
    const first = await createVerifiedBackup(root, 'studio-20260711T120000Z');
    const second = await createVerifiedBackup(root, 'studio-20260712T120000Z');
    const newest = await createVerifiedBackup(root, 'studio-20260713T120000Z');
    const removed = await pruneBackups(root, { retentionDays: 0, maxCount: 2, maxTotalBytes: 0 });
    expect(removed).toEqual([first.directory]);
    await expect(stat(second.directory)).resolves.toBeTruthy();
    await expect(stat(newest.directory)).resolves.toBeTruthy();
  });

  it('enforces BACKUP_MAX_TOTAL_BYTES without deleting the latest valid backup', async () => {
    const root = await temporaryDirectory();
    const older = await createVerifiedBackup(root, 'studio-20260712T120000Z');
    const newest = await createVerifiedBackup(root, 'studio-20260713T120000Z');
    const newestBytes = (await stat(newest.artifactPath)).size +
      (await stat(join(newest.directory, 'manifest.json'))).size;
    const removed = await pruneBackups(root, {
      retentionDays: 0,
      maxCount: 0,
      maxTotalBytes: newestBytes,
    });
    expect(removed).toEqual([older.directory]);
    await expect(stat(newest.directory)).resolves.toBeTruthy();
  });
});
