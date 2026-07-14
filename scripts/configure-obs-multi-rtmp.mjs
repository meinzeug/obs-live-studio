import { chmod, copyFile, mkdir, readFile, rename, writeFile } from 'node:fs/promises';
import { homedir } from 'node:os';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { resolvePrimaryStreamTarget } from '../packages/streaming-platforms/index.mjs';
import { publicMultistreamStatus, updateMultiRtmpConfig } from './obs-multi-rtmp-config.mjs';

const root = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const profileName = process.env.OBS_PROFILE_NAME ?? 'Open TV Studio';
const safeProfile = profileName.replace(/[^A-Za-z0-9_-]+/g, '_');
const configRoot = join(process.env.XDG_CONFIG_HOME ?? join(homedir(), '.config'), 'obs-studio');
const profileDir = join(configRoot, 'basic', 'profiles', safeProfile);
const configFile = join(profileDir, 'obs-multi-rtmp.json');
const envFile = resolve(root, '.env');
const backupDir = resolve(root, 'var', 'backups');

async function readJson(path) {
  try {
    return JSON.parse(await readFile(path, 'utf8'));
  } catch (error) {
    if (error?.code === 'ENOENT') return null;
    throw new Error(`obs-multi-rtmp-Konfiguration ist ungültig: ${error.message}`);
  }
}

async function writeAtomic(path, value) {
  const temporary = `${path}.tmp-${process.pid}`;
  await writeFile(temporary, `${JSON.stringify(value, null, 2)}\n`, { mode: 0o600 });
  await chmod(temporary, 0o600);
  await rename(temporary, path);
}

async function updateEnvironmentMarker(multistreamEnabled) {
  let content;
  try {
    content = await readFile(envFile, 'utf8');
  } catch (error) {
    if (error?.code === 'ENOENT') return;
    throw error;
  }
  const primary = resolvePrimaryStreamTarget(process.env);
  const value = multistreamEnabled ? `${primary.platform}+multistream` : primary.platform;
  const line = `STREAM_SERVICE=${value}`;
  const updated = /^STREAM_SERVICE=.*$/m.test(content)
    ? content.replace(/^STREAM_SERVICE=.*$/m, line)
    : `${content.replace(/\s*$/, '\n')}${line}\n`;
  if (updated !== content) {
    const temporary = `${envFile}.tmp-${process.pid}`;
    await writeFile(temporary, updated, { mode: 0o600 });
    await chmod(temporary, 0o600);
    await rename(temporary, envFile);
  }
}

await mkdir(profileDir, { recursive: true });
await mkdir(backupDir, { recursive: true, mode: 0o700 });
await chmod(backupDir, 0o700);

const existing = await readJson(configFile);
const status = publicMultistreamStatus(process.env);
if (!status.enabled && !existing) {
  await updateEnvironmentMarker(false);
  console.log('Keine zusätzlichen Streaming-Ziele aktiviert; keine Plugin-Konfiguration vorhanden.');
  process.exit(0);
}

if (existing) {
  const stamp = new Date().toISOString().replaceAll(':', '-');
  const backupFile = join(backupDir, `obs-multi-rtmp-${stamp}.json`);
  await copyFile(configFile, backupFile);
  await chmod(backupFile, 0o600);
}

const updated = updateMultiRtmpConfig(existing, process.env);
await writeAtomic(configFile, updated);
await updateEnvironmentMarker(status.enabled);

const activeTargets = status.targets.filter((target) => target.enabled);
if (activeTargets.length) {
  console.log(
    `${activeTargets.length} zusätzliches Streaming-Ziel wurde synchron konfiguriert: ${activeTargets
      .map((target) => target.name)
      .join(', ')}.`,
  );
} else {
  console.log('Alle vom Studio verwalteten zusätzlichen Streaming-Ziele wurden entfernt.');
}
