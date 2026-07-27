import { createHash } from 'node:crypto';
import { createReadStream } from 'node:fs';
import { spawn } from 'node:child_process';
import {
  chmod,
  lstat,
  mkdir,
  mkdtemp,
  open,
  readFile,
  readdir,
  realpath,
  rename,
  rm,
  stat,
  statfs,
  writeFile,
} from 'node:fs/promises';
import { basename, isAbsolute, join, relative, resolve, sep } from 'node:path';

const BACKUP_SCHEMA_VERSION = 1;
const DEFAULT_RETENTION_DAYS = 14;
const DEFAULT_MAX_COUNT = 2;
const DEFAULT_MIN_FREE_BYTES = 10 * 1024 ** 3;
const DEFAULT_DATABASE_ESTIMATE_BYTES = 1024 ** 3;
const ARCHIVE_ESTIMATE_FACTOR = 1.2;
const ARCHIVE_ESTIMATE_OVERHEAD_BYTES = 64 * 1024 ** 2;
const COMPLETE_BACKUP_PATTERN = /^studio-\d{8}T\d{6}Z$/;
const STAGING_BACKUP_PATTERN = /^\.studio-backup-/;

/**
 * Reconstructable dependencies and generated runtime output do not belong in
 * the durable application backup. Entries are GNU tar exclude patterns and
 * are also interpreted by estimateIncludedSourceBytes(), so the space check
 * and the actual archive always use the same policy.
 */
const DEFAULT_BACKUP_EXCLUDES = Object.freeze([
  '.git',
  'node_modules',
  '*/node_modules',
  'dist',
  '*/dist',
  'coverage',
  '*/coverage',
  '.cache',
  '*/.cache',
  '.vite',
  '*/.vite',
  'logs',
  '*/logs',
  'test-results',
  'playwright-report',
  'downloads',
  'var/*-venv',
  'var/*-venv/**',
  'var/models',
  'var/models/**',
  'var/tts',
  'var/tts/**',
  'var/yt-dlp',
  'var/yt-dlp/**',
  'var/bgutil-ytdlp-pot-provider',
  'var/bgutil-ytdlp-pot-provider/**',
  'var/pocket-tts',
  'var/pocket-tts/**',
  'var/cache',
  'var/cache/**',
  'var/logs',
  'var/logs/**',
  'var/render',
  'var/render/**',
  'var/renders',
  'var/renders/**',
  'var/tmp',
  'var/tmp/**',
  'var/temp',
  'var/temp/**',
  'var/downloads',
  'var/downloads/**',
]);

function parseBoolean(value, fallback, name) {
  if (value == null || value === '') return fallback;
  const normalized = String(value).trim().toLowerCase();
  if (['1', 'true', 'yes', 'on'].includes(normalized)) return true;
  if (['0', 'false', 'no', 'off'].includes(normalized)) return false;
  throw new Error(`${name} must be true or false`);
}

function parseNonNegativeInteger(value, fallback, name) {
  if (value == null || value === '') return fallback;
  const parsed = Number.parseInt(String(value), 10);
  if (!Number.isInteger(parsed) || parsed < 0) throw new Error(`${name} must be a non-negative integer`);
  return parsed;
}

function parseNonNegativeBytes(value, fallback, name) {
  if (value == null || value === '') return fallback;
  const parsed = Number(String(value).trim());
  if (!Number.isSafeInteger(parsed) || parsed < 0) throw new Error(`${name} must be a non-negative byte count`);
  return parsed;
}

function parsePathList(value, name) {
  if (value == null || String(value).trim() === '') return [];
  return [...new Set(
    String(value)
      .split(/[\n,;]+/u)
      .map((entry) => normalizeArchivePath(entry.trim()))
      .filter(Boolean)
      .map((entry) => {
        if (
          isAbsolute(entry) ||
          entry === '..' ||
          entry.startsWith('../') ||
          entry.includes('/../') ||
          entry.includes('\0')
        ) {
          throw new Error(`${name} entries must be safe paths relative to the studio root`);
        }
        return entry;
      }),
  )];
}

function resolveMinimumFreeBytes(env) {
  if (env.BACKUP_MIN_FREE_BYTES != null && env.BACKUP_MIN_FREE_BYTES !== '') {
    return parseNonNegativeBytes(env.BACKUP_MIN_FREE_BYTES, DEFAULT_MIN_FREE_BYTES, 'BACKUP_MIN_FREE_BYTES');
  }
  if (env.BACKUP_MIN_FREE_GB != null && env.BACKUP_MIN_FREE_GB !== '') {
    const value = Number(String(env.BACKUP_MIN_FREE_GB).trim());
    if (!Number.isFinite(value) || value < 0) throw new Error('BACKUP_MIN_FREE_GB must be a non-negative number');
    const bytes = Math.ceil(value * 1024 ** 3);
    if (!Number.isSafeInteger(bytes)) throw new Error('BACKUP_MIN_FREE_GB is too large');
    return bytes;
  }
  return DEFAULT_MIN_FREE_BYTES;
}

function assertInsideRoot(root, candidate, label) {
  const rel = relative(root, candidate);
  if (rel === '' || (!rel.startsWith(`..${sep}`) && rel !== '..' && !isAbsolute(rel))) return rel;
  throw new Error(`${label} must be inside the studio root: ${candidate}`);
}

function modeBits(stats) {
  return stats.mode & 0o777;
}

function isSecureMode(stats) {
  return (modeBits(stats) & 0o077) === 0;
}

function normalizeArchivePath(value) {
  return value.split(sep).join('/').replace(/^\.\//, '').replace(/\/$/, '');
}

function wildcardPattern(pattern) {
  const escaped = pattern.replace(/[.+^${}()|[\]\\]/g, '\\$&').replace(/\*\*/g, '\0').replace(/\*/g, '[^/]*');
  return new RegExp(`^${escaped.replace(/\0/g, '.*')}(?:/.*)?$`, 'u');
}

function exclusionMatches(path, pattern) {
  const normalized = normalizeArchivePath(path);
  const candidate = normalizeArchivePath(pattern);
  if (candidate.startsWith('*/') && !candidate.slice(2).includes('*')) {
    const suffix = candidate.slice(2);
    return normalized === suffix || normalized.endsWith(`/${suffix}`) || normalized.includes(`/${suffix}/`);
  }
  if (!candidate.includes('*')) {
    return normalized === candidate || normalized.startsWith(`${candidate}/`);
  }
  return wildcardPattern(candidate).test(normalized);
}

function backupExclusions({ extraIncludes = [], extraExcludes = [] } = {}) {
  const includes = new Set(extraIncludes.map(normalizeArchivePath));
  const defaults = DEFAULT_BACKUP_EXCLUDES.filter((pattern) => {
    const candidate = normalizeArchivePath(pattern);
    const candidateRoot = candidate.replace(/\/\*\*$/u, '');
    return ![...includes].some(
      (include) =>
        candidate === include ||
        candidate === `${include}/**` ||
        exclusionMatches(include, candidate) ||
        exclusionMatches(include, candidateRoot),
    );
  });
  return [...new Set([...defaults, ...extraExcludes.map(normalizeArchivePath)])];
}

function isExcludedArchivePath(path, exclusions) {
  return exclusions.some((pattern) => exclusionMatches(path, pattern));
}

function safeTimestamp(date = new Date()) {
  return date
    .toISOString()
    .replace(/[-:]/g, '')
    .replace(/\.\d{3}Z$/, 'Z');
}

async function sha256File(path) {
  const hash = createHash('sha256');
  const file = createReadStream(path);
  await new Promise((resolvePromise, reject) => {
    file.on('data', (chunk) => hash.update(chunk));
    file.on('error', reject);
    file.on('end', resolvePromise);
  });
  return hash.digest('hex');
}

async function runCommand(command, args, options = {}) {
  await new Promise((resolvePromise, reject) => {
    const child = spawn(command, args, {
      cwd: options.cwd,
      env: options.env ?? process.env,
      stdio: options.stdio ?? ['ignore', 'inherit', 'inherit'],
      shell: false,
    });
    child.once('error', reject);
    child.once('exit', (code, signal) => {
      if (code === 0) resolvePromise();
      else reject(new Error(`${command} failed with ${code ?? signal ?? 'unknown status'}`));
    });
  });
}

function postgresDumpInvocation(databaseUrl, outputPath, env = process.env) {
  let url;
  try {
    url = new URL(databaseUrl);
  } catch {
    throw new Error('DATABASE_URL is not a valid PostgreSQL URL');
  }
  if (!['postgres:', 'postgresql:'].includes(url.protocol)) {
    throw new Error('DATABASE_URL must use postgres:// or postgresql://');
  }

  const databaseName = decodeURIComponent(url.pathname.replace(/^\//, ''));
  if (!databaseName) throw new Error('DATABASE_URL must include a database name');

  const args = ['--format=custom', '--file', outputPath, '--dbname', databaseName];
  if (url.hostname) args.push('--host', url.hostname);
  if (url.port) args.push('--port', url.port);
  if (url.username) args.push('--username', decodeURIComponent(url.username));

  const commandEnv = { ...env };
  if (url.password) commandEnv.PGPASSWORD = decodeURIComponent(url.password);
  for (const [key, value] of url.searchParams) {
    if (key === 'sslmode') commandEnv.PGSSLMODE = value;
  }

  return { command: 'pg_dump', args, env: commandEnv };
}

function buildTarArguments({
  root,
  outputPath,
  backupDirectory,
  mediaDirectory,
  includeMedia = true,
  extraIncludes = [],
  extraExcludes = [],
}) {
  const exclusions = backupExclusions({ extraIncludes, extraExcludes });
  const resolvedRoot = resolve(root);
  const resolvedBackupDirectory = resolve(backupDirectory);
  const backupRelative = relative(resolvedRoot, resolvedBackupDirectory);
  if (
    backupRelative &&
    !backupRelative.startsWith(`..${sep}`) &&
    backupRelative !== '..' &&
    !isAbsolute(backupRelative)
  ) {
    const normalized = normalizeArchivePath(backupRelative);
    exclusions.push(normalized, `./${normalized}`, `${normalized}/**`, `./${normalized}/**`);
  }

  if (!includeMedia && mediaDirectory) {
    const resolvedMedia = resolve(root, mediaDirectory);
    const mediaRelative = assertInsideRoot(resolvedRoot, resolvedMedia, 'MEDIA_DIRECTORY');
    if (mediaRelative) {
      const normalized = normalizeArchivePath(mediaRelative);
      exclusions.push(normalized, `./${normalized}`, `${normalized}/**`, `./${normalized}/**`);
    }
  }

  return [
    '--create',
    '--gzip',
    '--ignore-failed-read',
    '--warning=no-file-changed',
    '--warning=no-file-removed',
    '--file',
    outputPath,
    '--directory',
    resolvedRoot,
    ...exclusions.flatMap((entry) => [`--exclude=${entry}`]),
    '.',
  ];
}

async function directoryByteSize(path) {
  let bytes = 0;
  async function walk(candidate) {
    let metadata;
    try {
      metadata = await lstat(candidate);
    } catch (error) {
      if (['ENOENT', 'EACCES'].includes(error?.code)) return;
      throw error;
    }
    if (!metadata.isDirectory()) {
      bytes += metadata.size;
      return;
    }
    for (const entry of await readdir(candidate, { withFileTypes: true })) {
      await walk(join(candidate, entry.name));
    }
  }
  await walk(path);
  return bytes;
}

async function estimateIncludedSourceBytes({
  root,
  backupDirectory,
  mediaDirectory,
  includeMedia,
  extraIncludes = [],
  extraExcludes = [],
}) {
  const resolvedRoot = resolve(root);
  const exclusions = backupExclusions({ extraIncludes, extraExcludes });
  const backupRelative = normalizeArchivePath(relative(resolvedRoot, resolve(backupDirectory)));
  if (backupRelative) exclusions.push(backupRelative);
  if (!includeMedia && mediaDirectory) {
    const mediaRelative = normalizeArchivePath(
      assertInsideRoot(resolvedRoot, resolve(resolvedRoot, mediaDirectory), 'MEDIA_DIRECTORY'),
    );
    if (mediaRelative) exclusions.push(mediaRelative);
  }
  let bytes = 0;
  let files = 0;
  async function walk(directory, archiveDirectory = '') {
    let entries;
    try {
      entries = await readdir(directory, { withFileTypes: true });
    } catch (error) {
      if (['ENOENT', 'EACCES'].includes(error?.code)) return;
      throw error;
    }
    for (const entry of entries) {
      const archivePath = normalizeArchivePath(join(archiveDirectory, entry.name));
      if (isExcludedArchivePath(archivePath, exclusions)) continue;
      const path = join(directory, entry.name);
      const metadata = await lstat(path);
      if (metadata.isDirectory()) await walk(path, archivePath);
      else {
        files += 1;
        bytes += metadata.size;
      }
    }
  }
  await walk(resolvedRoot);
  return { bytes, files, exclusions };
}

function estimatedArchiveBytes(sourceBytes) {
  return Math.ceil(sourceBytes * ARCHIVE_ESTIMATE_FACTOR) + ARCHIVE_ESTIMATE_OVERHEAD_BYTES;
}

async function availableFilesystemBytes(path, statfsFn = statfs) {
  const filesystem = await statfsFn(path);
  const blockSize = Number(filesystem.bsize);
  const availableBlocks = Number(filesystem.bavail);
  const bytes = blockSize * availableBlocks;
  if (!Number.isSafeInteger(bytes) || bytes < 0) throw new Error('Could not determine available backup filesystem space');
  return bytes;
}

function formatBytes(value) {
  const units = ['B', 'KiB', 'MiB', 'GiB', 'TiB'];
  let amount = Math.max(0, Number(value) || 0);
  let unit = 0;
  while (amount >= 1024 && unit < units.length - 1) {
    amount /= 1024;
    unit += 1;
  }
  return `${amount.toFixed(unit === 0 ? 0 : 2)} ${units[unit]}`;
}

async function artifactMetadata(path) {
  const stats = await stat(path);
  return {
    file: basename(path),
    bytes: stats.size,
    sha256: await sha256File(path),
    mode: modeBits(stats).toString(8).padStart(4, '0'),
  };
}

async function backupCandidates(backupDirectory) {
  const entries = await readdir(backupDirectory, { withFileTypes: true });
  const candidates = [];
  for (const entry of entries) {
    if (!entry.isDirectory() || !COMPLETE_BACKUP_PATTERN.test(entry.name)) continue;
    const path = join(backupDirectory, entry.name);
    let metadata;
    try {
      metadata = await stat(path);
    } catch {
      continue;
    }
    candidates.push({ name: entry.name, path, mtimeMs: metadata.mtimeMs, bytes: await directoryByteSize(path) });
  }
  return candidates.sort((left, right) => right.name.localeCompare(left.name));
}

async function latestVerifiedBackup(candidates) {
  for (const candidate of candidates) {
    try {
      const verification = await verifyStudioBackup(candidate.path);
      if (verification.ok) return candidate;
    } catch {
      // Damaged/partial complete-looking directories are never auto-deleted.
    }
  }
  return null;
}

async function applyBackupRetentionPolicy(
  backupDirectory,
  policyOrRetentionDays,
  now = new Date(),
) {
  const policy =
    typeof policyOrRetentionDays === 'number'
      ? { retentionDays: policyOrRetentionDays, maxCount: 0, maxTotalBytes: 0 }
      : {
          retentionDays: policyOrRetentionDays?.retentionDays ?? DEFAULT_RETENTION_DAYS,
          maxCount: policyOrRetentionDays?.maxCount ?? DEFAULT_MAX_COUNT,
          maxTotalBytes: policyOrRetentionDays?.maxTotalBytes ?? 0,
        };
  const cutoff = now.getTime() - policy.retentionDays * 24 * 60 * 60 * 1000;
  const candidates = await backupCandidates(backupDirectory);
  const protectedBackup = await latestVerifiedBackup(candidates);
  let totalBytes = candidates.reduce((sum, candidate) => sum + candidate.bytes, 0);
  let remainingCount = candidates.length;
  const removed = [];
  for (const candidate of [...candidates].reverse()) {
    if (candidate.path === protectedBackup?.path) continue;
    const expired = policy.retentionDays > 0 && candidate.mtimeMs < cutoff;
    const aboveCount = policy.maxCount > 0 && remainingCount > policy.maxCount;
    const aboveBytes = policy.maxTotalBytes > 0 && totalBytes > policy.maxTotalBytes;
    if (!expired && !aboveCount && !aboveBytes) continue;
    try {
      const verification = await verifyStudioBackup(candidate.path);
      if (!verification.ok) continue;
    } catch {
      continue;
    }
    await rm(candidate.path, { recursive: true, force: true });
    removed.push(candidate.path);
    totalBytes -= candidate.bytes;
    remainingCount -= 1;
  }
  return {
    removed,
    protectedBackup: protectedBackup?.path ?? null,
    remainingBytes: totalBytes,
    remainingCount,
  };
}

async function pruneBackups(backupDirectory, policyOrRetentionDays, now = new Date()) {
  return (await applyBackupRetentionPolicy(backupDirectory, policyOrRetentionDays, now)).removed;
}

async function cleanupStagingDirectories(backupDirectory) {
  const removed = [];
  for (const entry of await readdir(backupDirectory, { withFileTypes: true })) {
    if (!entry.isDirectory() || !STAGING_BACKUP_PATTERN.test(entry.name)) continue;
    const path = join(backupDirectory, entry.name);
    await rm(path, { recursive: true, force: true });
    removed.push(path);
  }
  return removed;
}

async function latestDatabaseEstimate(backupDirectory) {
  const candidates = await backupCandidates(backupDirectory);
  for (const candidate of candidates) {
    try {
      const manifest = JSON.parse(await readFile(join(candidate.path, 'manifest.json'), 'utf8'));
      const dump = Array.isArray(manifest.artifacts)
        ? manifest.artifacts.find((artifact) => artifact?.file === 'database.dump')
        : null;
      if (Number.isSafeInteger(dump?.bytes) && dump.bytes > 0) return Math.ceil(dump.bytes * ARCHIVE_ESTIMATE_FACTOR);
    } catch {
      // Try an older complete backup.
    }
  }
  return DEFAULT_DATABASE_ESTIMATE_BYTES;
}

function processIsRunning(pid) {
  if (!Number.isSafeInteger(pid) || pid <= 0) return false;
  try {
    process.kill(pid, 0);
    return true;
  } catch (error) {
    return error?.code !== 'ESRCH';
  }
}

async function acquireBackupLock(lockPath, isProcessRunning = processIsRunning) {
  for (let attempt = 0; attempt < 2; attempt += 1) {
    let lock;
    try {
      lock = await open(lockPath, 'wx', 0o600);
      await lock.writeFile(`${process.pid}\n`);
      return lock;
    } catch (error) {
      await lock?.close().catch(() => undefined);
      if (error?.code !== 'EEXIST') {
        await rm(lockPath, { force: true }).catch(() => undefined);
        throw error;
      }
      let ownerPid = Number.NaN;
      try {
        ownerPid = Number.parseInt((await readFile(lockPath, 'utf8')).trim(), 10);
      } catch {
        // A malformed lock left by a terminated process can be recovered.
      }
      if (isProcessRunning(ownerPid)) {
        throw new Error(`Another studio backup is already running (PID ${ownerPid})`);
      }
      await rm(lockPath, { force: true });
    }
  }
  throw new Error('Could not acquire the studio backup lock');
}

async function createStudioBackup(options = {}) {
  const configuredRoot = resolve(options.root ?? process.cwd());
  const root = await realpath(configuredRoot);
  const env = options.env ?? process.env;
  const configuredBackupDirectory = resolve(root, env.BACKUP_DIRECTORY || './var/backups');

  const includeMedia = parseBoolean(env.BACKUP_INCLUDE_MEDIA, true, 'BACKUP_INCLUDE_MEDIA');
  const retentionDays = parseNonNegativeInteger(
    env.BACKUP_RETENTION_DAYS,
    DEFAULT_RETENTION_DAYS,
    'BACKUP_RETENTION_DAYS',
  );
  const maxCount = parseNonNegativeInteger(env.BACKUP_MAX_COUNT, DEFAULT_MAX_COUNT, 'BACKUP_MAX_COUNT');
  const maxTotalBytes = parseNonNegativeBytes(env.BACKUP_MAX_TOTAL_BYTES, 0, 'BACKUP_MAX_TOTAL_BYTES');
  const minimumFreeBytes = resolveMinimumFreeBytes(env);
  const extraIncludes = parsePathList(env.BACKUP_EXTRA_INCLUDE_PATHS, 'BACKUP_EXTRA_INCLUDE_PATHS');
  const extraExcludes = parsePathList(env.BACKUP_EXTRA_EXCLUDE_PATHS, 'BACKUP_EXTRA_EXCLUDE_PATHS');
  const timestamp = safeTimestamp(options.now ?? new Date());
  const commandRunner = options.commandRunner ?? runCommand;

  await mkdir(configuredBackupDirectory, { recursive: true, mode: 0o700 });
  const backupDirectory = await realpath(configuredBackupDirectory);
  if (backupDirectory === root) throw new Error('BACKUP_DIRECTORY must not be the studio root');
  const finalDirectory = join(backupDirectory, `studio-${timestamp}`);
  await chmod(backupDirectory, 0o700);
  try {
    await lstat(finalDirectory);
    throw new Error(`Backup already exists: ${finalDirectory}`);
  } catch (error) {
    if (error?.code !== 'ENOENT') throw error;
  }

  const lockPath = join(backupDirectory, '.studio-backup.lock');
  const lock = await acquireBackupLock(lockPath, options.isProcessRunning ?? processIsRunning);
  let stagingDirectory = null;
  let published = false;

  try {
    const staleStagingRemoved = await cleanupStagingDirectories(backupDirectory);
    const sourceEstimate =
      options.estimateProvider == null
        ? await estimateIncludedSourceBytes({
            root,
            backupDirectory,
            mediaDirectory: env.MEDIA_DIRECTORY || './var/media',
            includeMedia,
            extraIncludes,
            extraExcludes,
          })
        : await options.estimateProvider();
    const appEstimateBytes = estimatedArchiveBytes(sourceEstimate.bytes);
    const databaseEstimateBytes = env.DATABASE_URL
      ? await latestDatabaseEstimate(backupDirectory)
      : 0;
    const estimatedBytes = appEstimateBytes + databaseEstimateBytes;

    const preCleanup = await applyBackupRetentionPolicy(
      backupDirectory,
      {
        retentionDays,
        maxCount: maxCount > 0 ? Math.max(1, maxCount - 1) : 0,
        maxTotalBytes:
          maxTotalBytes > 0 ? Math.max(1, maxTotalBytes - estimatedBytes) : 0,
      },
      options.now ?? new Date(),
    );
    if (maxTotalBytes > 0 && preCleanup.remainingBytes + estimatedBytes > maxTotalBytes) {
      throw new Error(
        `Backup size policy prevents creation: existing=${formatBytes(preCleanup.remainingBytes)}, ` +
          `estimated=${formatBytes(estimatedBytes)}, maximum=${formatBytes(maxTotalBytes)}; ` +
          'the newest verified backup was retained.',
      );
    }
    const availableBytes = await availableFilesystemBytes(backupDirectory, options.statfsFn ?? statfs);
    const requiredBytes = estimatedBytes + minimumFreeBytes;
    if (availableBytes < requiredBytes) {
      throw new Error(
        `Insufficient backup filesystem space: free=${formatBytes(availableBytes)}, ` +
          `estimated backup=${formatBytes(estimatedBytes)}, reserved=${formatBytes(minimumFreeBytes)}, ` +
          `required=${formatBytes(requiredBytes)}. No archive was started.`,
      );
    }

    stagingDirectory = await mkdtemp(join(backupDirectory, '.studio-backup-'));
    await chmod(stagingDirectory, 0o700);
    const appArchive = join(stagingDirectory, 'app.tar.gz');
    const tarArgs = buildTarArguments({
      root,
      outputPath: appArchive,
      backupDirectory,
      mediaDirectory: env.MEDIA_DIRECTORY || './var/media',
      includeMedia,
      extraIncludes,
      extraExcludes,
    });
    await commandRunner('tar', tarArgs, { cwd: root, env });
    await chmod(appArchive, 0o600);

    const artifacts = [await artifactMetadata(appArchive)];
    if (env.DATABASE_URL) {
      const databaseDump = join(stagingDirectory, 'database.dump');
      const invocation = postgresDumpInvocation(env.DATABASE_URL, databaseDump, env);
      await commandRunner(invocation.command, invocation.args, {
        cwd: root,
        env: invocation.env,
      });
      await chmod(databaseDump, 0o600);
      artifacts.push(await artifactMetadata(databaseDump));
    }

    const manifest = {
      schemaVersion: BACKUP_SCHEMA_VERSION,
      createdAt: new Date(options.now ?? Date.now()).toISOString(),
      includeMedia,
      databaseIncluded: Boolean(env.DATABASE_URL),
      backupPolicy: {
        excluded: sourceEstimate.exclusions,
        extraIncludes,
        extraExcludes,
      },
      artifacts,
    };
    const manifestPath = join(stagingDirectory, 'manifest.json');
    await writeFile(manifestPath, `${JSON.stringify(manifest, null, 2)}\n`, {
      mode: 0o600,
    });
    await chmod(manifestPath, 0o600);

    const stagingVerification = await verifyStudioBackup(stagingDirectory);
    if (!stagingVerification.ok) {
      throw new Error(`Generated backup failed verification: ${stagingVerification.errors.join('; ')}`);
    }

    await rename(stagingDirectory, finalDirectory);
    published = true;
    await chmod(finalDirectory, 0o700);
    const verification = await verifyStudioBackup(finalDirectory);
    if (!verification.ok) throw new Error(`Published backup failed verification: ${verification.errors.join('; ')}`);

    const warnings = [];
    let removed = [];
    try {
      removed = await pruneBackups(
        backupDirectory,
        { retentionDays, maxCount, maxTotalBytes },
        options.now ?? new Date(),
      );
    } catch (error) {
      warnings.push(`Expired backups could not be pruned: ${error.message}`);
    }
    return {
      directory: finalDirectory,
      manifest,
      verification,
      preRemoved: preCleanup.removed,
      removed,
      staleStagingRemoved,
      space: {
        availableBytes,
        estimatedBytes,
        minimumFreeBytes,
        requiredBytes,
      },
      warnings,
    };
  } catch (error) {
    if (stagingDirectory) await rm(stagingDirectory, { recursive: true, force: true });
    if (published) await rm(finalDirectory, { recursive: true, force: true });
    throw error;
  } finally {
    await lock?.close().catch(() => undefined);
    await rm(lockPath, { force: true });
  }
}

async function verifyStudioBackup(directory) {
  const resolvedDirectory = resolve(directory);
  const directoryStats = await lstat(resolvedDirectory);
  if (!directoryStats.isDirectory()) throw new Error('Backup path is not a directory');

  const errors = [];
  if (!isSecureMode(directoryStats))
    errors.push(`Backup directory mode is too permissive: ${modeBits(directoryStats).toString(8)}`);

  const manifestPath = join(resolvedDirectory, 'manifest.json');
  const manifestStats = await lstat(manifestPath);
  if (!manifestStats.isFile()) errors.push('manifest.json is not a regular file');
  if (!isSecureMode(manifestStats))
    errors.push(`manifest.json mode is too permissive: ${modeBits(manifestStats).toString(8)}`);

  let manifest;
  try {
    manifest = JSON.parse(await readFile(manifestPath, 'utf8'));
  } catch (error) {
    throw new Error(`Invalid backup manifest: ${error.message}`);
  }
  if (manifest.schemaVersion !== BACKUP_SCHEMA_VERSION) {
    errors.push(`Unsupported backup schema version: ${manifest.schemaVersion}`);
  }
  if (!Array.isArray(manifest.artifacts) || manifest.artifacts.length === 0) {
    errors.push('Backup manifest contains no artifacts');
  }

  const checkedArtifacts = [];
  for (const artifact of manifest.artifacts ?? []) {
    if (!artifact || typeof artifact.file !== 'string' || basename(artifact.file) !== artifact.file) {
      errors.push('Backup manifest contains an unsafe artifact path');
      continue;
    }
    const artifactPath = join(resolvedDirectory, artifact.file);
    try {
      const artifactStats = await lstat(artifactPath);
      if (!artifactStats.isFile()) {
        errors.push(`${artifact.file} is not a regular file`);
        continue;
      }
      if (!isSecureMode(artifactStats)) {
        errors.push(`${artifact.file} mode is too permissive: ${modeBits(artifactStats).toString(8)}`);
      }
      if (artifactStats.size !== artifact.bytes) {
        errors.push(`${artifact.file} size mismatch`);
      }
      const sha256 = await sha256File(artifactPath);
      if (sha256 !== artifact.sha256) errors.push(`${artifact.file} checksum mismatch`);
      checkedArtifacts.push({
        file: artifact.file,
        bytes: artifactStats.size,
        sha256,
      });
    } catch (error) {
      errors.push(`${artifact.file} cannot be read: ${error.message}`);
    }
  }

  return {
    ok: errors.length === 0,
    directory: resolvedDirectory,
    errors,
    artifacts: checkedArtifacts,
    manifest,
  };
}

export {
  BACKUP_SCHEMA_VERSION,
  DEFAULT_BACKUP_EXCLUDES,
  acquireBackupLock,
  applyBackupRetentionPolicy,
  availableFilesystemBytes,
  backupExclusions,
  buildTarArguments,
  cleanupStagingDirectories,
  createStudioBackup,
  estimateIncludedSourceBytes,
  estimatedArchiveBytes,
  formatBytes,
  isExcludedArchivePath,
  postgresDumpInvocation,
  pruneBackups,
  safeTimestamp,
  sha256File,
  verifyStudioBackup,
};
