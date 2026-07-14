import { spawn } from 'node:child_process';
import {
  chmod,
  lstat,
  mkdir,
  mkdtemp,
  readFile,
  readdir,
  readlink,
  realpath,
  rename,
  rm,
  writeFile,
} from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { basename, dirname, isAbsolute, join, relative, resolve, sep } from 'node:path';
import { verifyStudioBackup } from './studio-backup-lib.mjs';

const REHEARSAL_SCHEMA_VERSION = 1;
const COMPLETE_BACKUP_PATTERN = /^studio-\d{8}T\d{6}Z$/;
const MAX_COMMAND_OUTPUT_BYTES = 2 * 1024 * 1024;

function pathIsInside(root, candidate) {
  const rel = relative(root, candidate);
  return rel === '' || (!rel.startsWith(`..${sep}`) && rel !== '..' && !isAbsolute(rel));
}

function errorMessage(error) {
  return (error instanceof Error ? error.message : String(error)).slice(0, 2000);
}

async function runCommandCapture(command, args, options = {}) {
  return await new Promise((resolvePromise, reject) => {
    const child = spawn(command, args, {
      cwd: options.cwd,
      env: options.env ?? process.env,
      stdio: ['ignore', 'pipe', 'pipe'],
      shell: false,
    });
    const stdout = [];
    const stderr = [];
    let outputBytes = 0;
    let exceededLimit = false;

    const collect = (target) => (chunk) => {
      outputBytes += chunk.length;
      if (outputBytes > MAX_COMMAND_OUTPUT_BYTES) {
        exceededLimit = true;
        child.kill('SIGKILL');
        return;
      }
      target.push(chunk);
    };

    child.stdout.on('data', collect(stdout));
    child.stderr.on('data', collect(stderr));
    child.once('error', reject);
    child.once('exit', (code, signal) => {
      if (exceededLimit) {
        reject(new Error(`${command} produced more than ${MAX_COMMAND_OUTPUT_BYTES} bytes of output`));
        return;
      }
      const result = {
        stdout: Buffer.concat(stdout).toString('utf8'),
        stderr: Buffer.concat(stderr).toString('utf8'),
      };
      if (code === 0) resolvePromise(result);
      else {
        const detail = result.stderr.trim().slice(0, 1000);
        reject(new Error(`${command} failed with ${code ?? signal ?? 'unknown status'}${detail ? `: ${detail}` : ''}`));
      }
    });
  });
}

async function findLatestBackup(backupRoot) {
  const entries = await readdir(backupRoot, { withFileTypes: true });
  const candidates = entries
    .filter((entry) => entry.isDirectory() && COMPLETE_BACKUP_PATTERN.test(entry.name))
    .map((entry) => entry.name)
    .sort()
    .reverse();
  if (candidates.length === 0) throw new Error(`No complete studio backup found in ${backupRoot}`);
  return join(backupRoot, candidates[0]);
}

async function inspectExtractedTree(root) {
  const counts = { files: 0, directories: 0, symlinks: 0, bytes: 0 };

  async function walk(directory) {
    const entries = await readdir(directory, { withFileTypes: true });
    for (const entry of entries) {
      const path = join(directory, entry.name);
      const metadata = await lstat(path);
      if (metadata.isDirectory()) {
        counts.directories += 1;
        await walk(path);
      } else if (metadata.isFile()) {
        counts.files += 1;
        counts.bytes += metadata.size;
      } else if (metadata.isSymbolicLink()) {
        counts.symlinks += 1;
        const target = await readlink(path);
        if (isAbsolute(target) || !pathIsInside(root, resolve(dirname(path), target))) {
          throw new Error(`Extracted archive contains an unsafe symlink: ${relative(root, path)}`);
        }
      } else {
        throw new Error(`Extracted archive contains an unsupported special file: ${relative(root, path)}`);
      }
    }
  }

  await walk(root);
  return counts;
}

async function writeJsonAtomically(path, value) {
  const directory = dirname(path);
  await mkdir(directory, { recursive: true, mode: 0o700 });
  await chmod(directory, 0o700);
  const temporaryPath = join(directory, `.${basename(path)}.${process.pid}.${Date.now()}.tmp`);
  await writeFile(temporaryPath, `${JSON.stringify(value, null, 2)}\n`, { mode: 0o600 });
  await chmod(temporaryPath, 0o600);
  await rename(temporaryPath, path);
  await chmod(path, 0o600);
}

async function persistRehearsalReport(backupRoot, report) {
  const reportsDirectory = join(backupRoot, 'rehearsals');
  const backupName = report.backupDirectory ? basename(report.backupDirectory) : 'unknown-backup';
  await writeJsonAtomically(join(reportsDirectory, `${backupName}.json`), report);
  await writeJsonAtomically(join(reportsDirectory, 'latest.json'), report);
}

async function rehearseStudioBackup(options = {}) {
  const startedAt = options.now ?? new Date();
  const startedMs = startedAt.getTime();
  const root = await realpath(resolve(options.root ?? process.cwd()));
  const env = options.env ?? process.env;
  const backupRoot = await realpath(resolve(root, env.BACKUP_DIRECTORY || './var/backups'));
  const explicitBackup = options.backupDirectory ? await realpath(resolve(options.backupDirectory)) : null;
  const backupDirectory = explicitBackup ?? (await findLatestBackup(backupRoot));
  if (!pathIsInside(backupRoot, backupDirectory) || backupDirectory === backupRoot) {
    throw new Error(`Backup must be a child of configured BACKUP_DIRECTORY: ${backupDirectory}`);
  }

  const commandRunner = options.commandRunner ?? runCommandCapture;
  const workspace = await mkdtemp(join(options.temporaryRoot ?? tmpdir(), 'obs-live-studio-restore-'));
  await chmod(workspace, 0o700);
  const extractionDirectory = join(workspace, 'app');
  await mkdir(extractionDirectory, { mode: 0o700 });
  const report = {
    schemaVersion: REHEARSAL_SCHEMA_VERSION,
    ok: false,
    backupDirectory,
    startedAt: startedAt.toISOString(),
    completedAt: null,
    durationMs: null,
    verification: null,
    application: null,
    database: null,
    workspace: options.keepWorkspace ? workspace : null,
    errors: [],
  };

  try {
    const verification = await verifyStudioBackup(backupDirectory);
    report.verification = {
      ok: verification.ok,
      artifacts: verification.artifacts.map((artifact) => artifact.file),
    };
    if (!verification.ok) throw new Error(`Backup verification failed: ${verification.errors.join('; ')}`);

    const appArchive = join(backupDirectory, 'app.tar.gz');
    await commandRunner(
      'tar',
      [
        '--extract',
        '--gzip',
        '--file',
        appArchive,
        '--directory',
        extractionDirectory,
        '--no-same-owner',
        '--no-same-permissions',
        '--delay-directory-restore',
      ],
      { cwd: root, env },
    );

    const packagePath = join(extractionDirectory, 'package.json');
    const packageMetadata = JSON.parse(await readFile(packagePath, 'utf8'));
    if (!packageMetadata?.name || typeof packageMetadata.name !== 'string') {
      throw new Error('Restored application archive has no valid package name');
    }
    const tree = await inspectExtractedTree(extractionDirectory);
    report.application = {
      archiveReadable: true,
      packageName: packageMetadata.name,
      ...tree,
    };

    if (verification.manifest.databaseIncluded) {
      const databaseDump = join(backupDirectory, 'database.dump');
      const result = await commandRunner('pg_restore', ['--list', databaseDump], { cwd: root, env });
      const tocEntries = result.stdout
        .split(/\r?\n/)
        .map((line) => line.trim())
        .filter((line) => line && !line.startsWith(';')).length;
      if (tocEntries === 0) throw new Error('PostgreSQL backup contains no restore entries');
      report.database = { included: true, archiveReadable: true, tocEntries };
    } else {
      report.database = { included: false, archiveReadable: null, tocEntries: 0 };
    }

    report.ok = true;
  } catch (error) {
    report.errors.push(errorMessage(error));
  } finally {
    if (!options.keepWorkspace) await rm(workspace, { recursive: true, force: true });
  }

  const completedAt = options.completedAt ?? new Date();
  report.completedAt = completedAt.toISOString();
  report.durationMs = Math.max(0, completedAt.getTime() - startedMs);
  try {
    await persistRehearsalReport(backupRoot, report);
  } catch (error) {
    report.ok = false;
    report.errors.push(`Rehearsal report could not be persisted: ${errorMessage(error)}`);
  }
  return report;
}

export {
  REHEARSAL_SCHEMA_VERSION,
  findLatestBackup,
  inspectExtractedTree,
  persistRehearsalReport,
  rehearseStudioBackup,
  runCommandCapture,
};
