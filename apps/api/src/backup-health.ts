import { lstat, readFile, readdir } from 'node:fs/promises';
import { basename, join, resolve } from 'node:path';
import { PROJECT_ROOT } from './project-root.js';

const COMPLETE_BACKUP_PATTERN = /^studio-\d{8}T\d{6}Z$/;
const DEFAULT_BACKUP_MAX_AGE_HOURS = 36;
const DEFAULT_REHEARSAL_MAX_AGE_HOURS = 9 * 24;
const MAX_STATUS_FILE_BYTES = 1024 * 1024;

export type BackupHealthCheck = {
  id: string;
  status: 'ok' | 'warning' | 'error';
  message: string;
};

export type BackupHealth = {
  ready: boolean;
  status: 'ready' | 'warning' | 'error';
  backup: {
    present: boolean;
    name: string | null;
    createdAt: string | null;
    ageHours: number | null;
    stale: boolean | null;
    databaseIncluded: boolean | null;
    secure: boolean | null;
  };
  rehearsal: {
    present: boolean;
    ok: boolean | null;
    backupName: string | null;
    completedAt: string | null;
    ageHours: number | null;
    stale: boolean | null;
    secure: boolean | null;
  };
  checks: BackupHealthCheck[];
};

type BackupHealthOptions = {
  root?: string;
  now?: Date;
};

function positiveNumber(value: string | undefined, fallback: number, name: string) {
  if (value == null || value.trim() === '') return fallback;
  const parsed = Number(value);
  if (!Number.isFinite(parsed) || parsed <= 0) throw new Error(`${name} muss eine positive Zahl sein.`);
  return parsed;
}

function privateMode(mode: number) {
  return (mode & 0o077) === 0;
}

function parsedDate(value: unknown) {
  if (typeof value !== 'string') return null;
  const date = new Date(value);
  return Number.isFinite(date.getTime()) ? date : null;
}

function ageHours(now: Date, date: Date) {
  return Math.max(0, (now.getTime() - date.getTime()) / (60 * 60 * 1000));
}

async function readSmallJson(path: string) {
  const metadata = await lstat(path);
  if (!metadata.isFile()) throw new Error('Statusdatei ist keine reguläre Datei.');
  if (metadata.size > MAX_STATUS_FILE_BYTES) throw new Error('Statusdatei ist unerwartet groß.');
  return { value: JSON.parse(await readFile(path, 'utf8')), metadata };
}

export async function inspectBackupHealth(
  env: NodeJS.ProcessEnv = process.env,
  options: BackupHealthOptions = {},
): Promise<BackupHealth> {
  const now = options.now ?? new Date();
  const root = resolve(options.root ?? PROJECT_ROOT);
  const backupRoot = resolve(root, env.BACKUP_DIRECTORY || './var/backups');
  const backupMaxAgeHours = positiveNumber(
    env.BACKUP_MAX_AGE_HOURS,
    DEFAULT_BACKUP_MAX_AGE_HOURS,
    'BACKUP_MAX_AGE_HOURS',
  );
  const rehearsalMaxAgeHours = positiveNumber(
    env.BACKUP_REHEARSAL_MAX_AGE_HOURS,
    DEFAULT_REHEARSAL_MAX_AGE_HOURS,
    'BACKUP_REHEARSAL_MAX_AGE_HOURS',
  );
  const checks: BackupHealthCheck[] = [];
  const add = (id: string, status: BackupHealthCheck['status'], message: string) =>
    checks.push({ id, status, message });

  const backup: BackupHealth['backup'] = {
    present: false,
    name: null,
    createdAt: null,
    ageHours: null,
    stale: null,
    databaseIncluded: null,
    secure: null,
  };
  const rehearsal: BackupHealth['rehearsal'] = {
    present: false,
    ok: null,
    backupName: null,
    completedAt: null,
    ageHours: null,
    stale: null,
    secure: null,
  };

  try {
    const rootMetadata = await lstat(backupRoot);
    if (!rootMetadata.isDirectory()) throw new Error('Das konfigurierte Backup-Ziel ist kein Verzeichnis.');
    if (!privateMode(rootMetadata.mode))
      add('backup-root-permissions', 'error', 'Das Backup-Verzeichnis ist für andere Benutzer zugänglich.');
    else add('backup-root-permissions', 'ok', 'Das Backup-Verzeichnis ist nur für den Eigentümer zugänglich.');

    const names = (await readdir(backupRoot, { withFileTypes: true }))
      .filter((entry) => entry.isDirectory() && COMPLETE_BACKUP_PATTERN.test(entry.name))
      .map((entry) => entry.name)
      .sort()
      .reverse();
    const latestName = names[0];
    if (!latestName) {
      add('latest-backup', 'error', 'Es wurde noch kein vollständiges Studio-Backup gefunden.');
    } else {
      const backupDirectory = join(backupRoot, latestName);
      const directoryMetadata = await lstat(backupDirectory);
      const manifest = await readSmallJson(join(backupDirectory, 'manifest.json'));
      const created = parsedDate(manifest.value?.createdAt);
      if (!created) throw new Error('Das Manifest des neuesten Backups enthält keinen gültigen Zeitstempel.');
      const age = ageHours(now, created);
      const stale = age > backupMaxAgeHours;
      const secure = privateMode(directoryMetadata.mode) && privateMode(manifest.metadata.mode);
      backup.present = true;
      backup.name = latestName;
      backup.createdAt = created.toISOString();
      backup.ageHours = age;
      backup.stale = stale;
      backup.databaseIncluded = manifest.value?.databaseIncluded === true;
      backup.secure = secure;
      add(
        'latest-backup',
        stale ? 'error' : 'ok',
        stale
          ? `Das neueste Backup ist älter als ${backupMaxAgeHours} Stunden.`
          : `Das neueste Backup ist ${Math.round(age)} Stunden alt.`,
      );
      add(
        'latest-backup-permissions',
        secure ? 'ok' : 'error',
        secure
          ? 'Backup-Verzeichnis und Manifest besitzen restriktive Dateirechte.'
          : 'Backup-Verzeichnis oder Manifest ist für andere Benutzer zugänglich.',
      );
    }
  } catch (error) {
    add(
      'backup-inspection',
      'error',
      error instanceof Error && 'code' in error && error.code === 'ENOENT'
        ? 'Das konfigurierte Backup-Verzeichnis oder Manifest fehlt.'
        : 'Der Backup-Zustand konnte nicht sicher gelesen werden.',
    );
  }

  try {
    const report = await readSmallJson(join(backupRoot, 'rehearsals', 'latest.json'));
    const completed = parsedDate(report.value?.completedAt);
    if (!completed) throw new Error('Die Wiederherstellungsprobe enthält keinen gültigen Zeitstempel.');
    const age = ageHours(now, completed);
    const stale = age > rehearsalMaxAgeHours;
    const successful = report.value?.ok === true;
    const secure = privateMode(report.metadata.mode);
    rehearsal.present = true;
    rehearsal.ok = successful;
    rehearsal.backupName =
      typeof report.value?.backupDirectory === 'string' ? basename(report.value.backupDirectory) : null;
    rehearsal.completedAt = completed.toISOString();
    rehearsal.ageHours = age;
    rehearsal.stale = stale;
    rehearsal.secure = secure;
    add(
      'restore-rehearsal',
      !successful || stale ? 'error' : 'ok',
      !successful
        ? 'Die letzte Wiederherstellungsprobe ist fehlgeschlagen.'
        : stale
          ? `Die letzte Wiederherstellungsprobe ist älter als ${rehearsalMaxAgeHours} Stunden.`
          : `Die letzte Wiederherstellungsprobe war vor ${Math.round(age)} Stunden erfolgreich.`,
    );
    add(
      'restore-rehearsal-permissions',
      secure ? 'ok' : 'error',
      secure
        ? 'Der Bericht der Wiederherstellungsprobe besitzt restriktive Dateirechte.'
        : 'Der Bericht der Wiederherstellungsprobe ist für andere Benutzer zugänglich.',
    );
  } catch (error) {
    const missing = error instanceof Error && 'code' in error && error.code === 'ENOENT';
    add(
      'restore-rehearsal',
      missing ? 'warning' : 'error',
      missing
        ? 'Es liegt noch keine Wiederherstellungsprobe vor.'
        : 'Der Bericht der Wiederherstellungsprobe konnte nicht sicher gelesen werden.',
    );
  }

  const status = checks.some((check) => check.status === 'error')
    ? 'error'
    : checks.some((check) => check.status === 'warning')
      ? 'warning'
      : 'ready';
  return { ready: status === 'ready', status, backup, rehearsal, checks };
}
