import { createHash } from 'node:crypto';
import { createReadStream } from 'node:fs';
import { spawn } from 'node:child_process';
import {
  chmod,
  lstat,
  mkdir,
  mkdtemp,
  readFile,
  readdir,
  realpath,
  rename,
  rm,
  stat,
  writeFile,
} from 'node:fs/promises';
import { basename, isAbsolute, join, relative, resolve, sep } from 'node:path';

const BACKUP_SCHEMA_VERSION = 1;
const DEFAULT_RETENTION_DAYS = 14;
const COMPLETE_BACKUP_PATTERN = /^studio-\d{8}T\d{6}Z$/;

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

function buildTarArguments({ root, outputPath, backupDirectory, mediaDirectory, includeMedia = true }) {
  const exclusions = [
    '.git',
    'node_modules',
    '*/node_modules',
    'dist',
    '*/dist',
    'logs',
    'test-results',
    'playwright-report',
  ];
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

async function artifactMetadata(path) {
  const stats = await stat(path);
  return {
    file: basename(path),
    bytes: stats.size,
    sha256: await sha256File(path),
    mode: modeBits(stats).toString(8).padStart(4, '0'),
  };
}

async function pruneBackups(backupDirectory, retentionDays, now = new Date()) {
  if (retentionDays === 0) return [];
  const cutoff = now.getTime() - retentionDays * 24 * 60 * 60 * 1000;
  const removed = [];
  const entries = await readdir(backupDirectory, { withFileTypes: true });
  for (const entry of entries) {
    if (!entry.isDirectory() || !COMPLETE_BACKUP_PATTERN.test(entry.name)) continue;
    const path = join(backupDirectory, entry.name);
    const manifestPath = join(path, 'manifest.json');
    try {
      const [backupStats, manifestStats] = await Promise.all([stat(path), lstat(manifestPath)]);
      if (!manifestStats.isFile() || backupStats.mtimeMs >= cutoff) continue;
    } catch {
      continue;
    }
    await rm(path, { recursive: true, force: true });
    removed.push(path);
  }
  return removed;
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

  const stagingDirectory = await mkdtemp(join(backupDirectory, '.studio-backup-'));
  await chmod(stagingDirectory, 0o700);
  let published = false;

  try {
    const appArchive = join(stagingDirectory, 'app.tar.gz');
    const tarArgs = buildTarArguments({
      root,
      outputPath: appArchive,
      backupDirectory,
      mediaDirectory: env.MEDIA_DIRECTORY || './var/media',
      includeMedia,
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
      removed = await pruneBackups(backupDirectory, retentionDays, options.now ?? new Date());
    } catch (error) {
      warnings.push(`Expired backups could not be pruned: ${error.message}`);
    }
    return { directory: finalDirectory, manifest, verification, removed, warnings };
  } catch (error) {
    await rm(stagingDirectory, { recursive: true, force: true });
    if (published) await rm(finalDirectory, { recursive: true, force: true });
    throw error;
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
  buildTarArguments,
  createStudioBackup,
  postgresDumpInvocation,
  pruneBackups,
  safeTimestamp,
  sha256File,
  verifyStudioBackup,
};
