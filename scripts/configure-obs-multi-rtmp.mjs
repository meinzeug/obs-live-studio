import { randomUUID } from 'node:crypto';
import { chmod, readFile, rename, rm, writeFile } from 'node:fs/promises';
import { homedir } from 'node:os';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { resolvePrimaryStreamTarget } from '../packages/streaming-platforms/index.mjs';
import { commitPrivateObsConfiguration, ensurePrivateDirectory } from './obs-config-files.mjs';
import { publicMultistreamStatus, updateMultiRtmpConfig } from './obs-multi-rtmp-config.mjs';

const root = resolve(process.env.OBS_LIVE_STUDIO_ROOT ?? resolve(dirname(fileURLToPath(import.meta.url)), '..'));
const profileName = process.env.OBS_PROFILE_NAME ?? 'Open TV Studio';
const safeProfile = profileName.replace(/[^A-Za-z0-9_-]+/g, '_');
const configRoot = join(process.env.XDG_CONFIG_HOME ?? join(homedir(), '.config'), 'obs-studio');
const profileDir = join(configRoot, 'basic', 'profiles', safeProfile);
const configFile = join(profileDir, 'obs-multi-rtmp.json');
const envFile = resolve(root, '.env');

async function readJson(path) {
  try {
    const content = await readFile(path, 'utf8');
    try {
      return { value: JSON.parse(content.replace(/^\uFEFF/, '')), malformed: false, exists: true };
    } catch {
      return { value: null, malformed: true, exists: true };
    }
  } catch (error) {
    if (error?.code === 'ENOENT') return { value: null, malformed: false, exists: false };
    throw error;
  }
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
    const temporary = `${envFile}.tmp-${process.pid}-${randomUUID()}`;
    try {
      await writeFile(temporary, updated, { mode: 0o600, flag: 'wx' });
      await chmod(temporary, 0o600);
      await rename(temporary, envFile);
      await chmod(envFile, 0o600);
    } finally {
      await rm(temporary, { force: true }).catch(() => undefined);
    }
  }
}

await ensurePrivateDirectory(profileDir);

const existingDocument = await readJson(configFile);
const existing = existingDocument.value;
const status = publicMultistreamStatus(process.env);
if (!status.enabled && !existingDocument.exists) {
  await updateEnvironmentMarker(false);
  console.log('Keine zusätzlichen Streaming-Ziele aktiviert; keine Plugin-Konfiguration vorhanden.');
  process.exit(0);
}

const updated = updateMultiRtmpConfig(existing, process.env);
const transaction = await commitPrivateObsConfiguration({
  root,
  configRoot,
  entries: [{ path: configFile, content: `${JSON.stringify(updated, null, 2)}\n` }],
});
await updateEnvironmentMarker(status.enabled);

if (existingDocument.malformed) {
  console.warn(
    `Eine beschädigte obs-multi-rtmp-Konfiguration wurde gesichert und repariert.${
      transaction.backupDirectory ? ` Sicherung: ${transaction.backupDirectory}` : ''
    }`,
  );
}

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
