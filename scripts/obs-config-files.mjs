import { createHash, randomUUID } from 'node:crypto';
import { chmod, lstat, mkdir, readFile, rename, rm, writeFile } from 'node:fs/promises';
import { basename, dirname, isAbsolute, join, relative, resolve, sep } from 'node:path';

const PRIVATE_FILE_MODE = 0o600;
const PRIVATE_DIRECTORY_MODE = 0o700;

function ownerOnly(mode) {
  return (mode & 0o077) === 0;
}

function backupTimestamp(date) {
  return date.toISOString().replace(/[-:.]/g, '');
}

function repositoryRelativePath(configRoot, path) {
  const value = relative(configRoot, path);
  if (!value || isAbsolute(value) || value === '..' || value.startsWith(`..${sep}`)) {
    throw new Error(`OBS-Konfigurationsdatei liegt außerhalb des Konfigurationsverzeichnisses: ${path}`);
  }
  return value;
}

export async function ensurePrivateDirectory(path) {
  await mkdir(path, { recursive: true, mode: PRIVATE_DIRECTORY_MODE });
  await chmod(path, PRIVATE_DIRECTORY_MODE);
}

export async function inspectPrivateFileChange(path, content) {
  const desired = Buffer.isBuffer(content) ? content : Buffer.from(String(content));
  try {
    const metadata = await lstat(path);
    if (!metadata.isFile()) throw new Error(`Verwalteter OBS-Pfad ist keine reguläre Datei: ${path}`);
    const original = await readFile(path);
    const contentChanged = !original.equals(desired);
    const modeChanged = !ownerOnly(metadata.mode) || (metadata.mode & 0o777) !== PRIVATE_FILE_MODE;
    return {
      path,
      desired,
      original,
      exists: true,
      originalMode: metadata.mode & 0o777,
      contentChanged,
      modeChanged,
      changed: contentChanged || modeChanged,
    };
  } catch (error) {
    if (error?.code !== 'ENOENT') throw error;
    return {
      path,
      desired,
      original: null,
      exists: false,
      originalMode: null,
      contentChanged: true,
      modeChanged: true,
      changed: true,
    };
  }
}

async function writePrivateAtomic(path, content) {
  await ensurePrivateDirectory(dirname(path));
  const temporary = join(dirname(path), `.${basename(path)}.${process.pid}.${randomUUID()}.tmp`);
  try {
    await writeFile(temporary, content, { mode: PRIVATE_FILE_MODE, flag: 'wx' });
    await chmod(temporary, PRIVATE_FILE_MODE);
    await rename(temporary, path);
    await chmod(path, PRIVATE_FILE_MODE);
  } finally {
    await rm(temporary, { force: true }).catch(() => undefined);
  }
}

async function createBackup({ root, configRoot, changes, now }) {
  const existing = changes.filter((change) => change.exists && change.changed);
  if (!existing.length) return null;

  const backupRoot = resolve(root, 'var', 'backups');
  await ensurePrivateDirectory(backupRoot);
  const backupDirectory = join(backupRoot, `obs-config-${backupTimestamp(now)}-${randomUUID().slice(0, 8)}`);
  await ensurePrivateDirectory(backupDirectory);
  const manifest = {
    schemaVersion: 1,
    createdAt: now.toISOString(),
    files: [],
  };

  for (const change of existing) {
    const relativePath = repositoryRelativePath(configRoot, change.path);
    const destination = join(backupDirectory, 'files', relativePath);
    await writePrivateAtomic(destination, change.original);
    manifest.files.push({
      path: relativePath.split(sep).join('/'),
      size: change.original.length,
      sha256: createHash('sha256').update(change.original).digest('hex'),
      mode: change.originalMode,
    });
  }

  await writePrivateAtomic(join(backupDirectory, 'manifest.json'), `${JSON.stringify(manifest, null, 2)}\n`);
  return backupDirectory;
}

export async function commitPrivateObsConfiguration({ root, configRoot, entries, now = new Date() }) {
  const normalizedRoot = resolve(root);
  const normalizedConfigRoot = resolve(configRoot);
  const unique = new Set();
  const changes = [];

  for (const entry of entries) {
    const path = resolve(entry.path);
    repositoryRelativePath(normalizedConfigRoot, path);
    if (unique.has(path)) throw new Error(`OBS-Konfigurationsdatei wurde doppelt geplant: ${path}`);
    unique.add(path);
    changes.push(await inspectPrivateFileChange(path, entry.content));
  }

  const changed = changes.filter((change) => change.changed);
  const backupDirectory = await createBackup({
    root: normalizedRoot,
    configRoot: normalizedConfigRoot,
    changes,
    now,
  });

  for (const change of changed) {
    if (change.contentChanged) await writePrivateAtomic(change.path, change.desired);
    else await chmod(change.path, PRIVATE_FILE_MODE);
  }

  return {
    changed: changed.map((change) => repositoryRelativePath(normalizedConfigRoot, change.path).split(sep).join('/')),
    backupDirectory,
  };
}

export { PRIVATE_DIRECTORY_MODE, PRIVATE_FILE_MODE };
