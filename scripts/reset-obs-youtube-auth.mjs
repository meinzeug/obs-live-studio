import { access, chmod, copyFile, mkdir, readFile, readdir, rename, writeFile } from 'node:fs/promises';
import { constants } from 'node:fs';
import { homedir } from 'node:os';
import { join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = resolve(fileURLToPath(new URL('..', import.meta.url)));
const profileName = process.env.OBS_PROFILE_NAME ?? 'Automated News Studio';
const safeProfile = profileName.replace(/[^A-Za-z0-9_-]+/g, '_');
const configRoot = join(process.env.XDG_CONFIG_HOME ?? join(homedir(), '.config'), 'obs-studio');
const profileDir = join(configRoot, 'basic', 'profiles', safeProfile);
const profileFile = join(profileDir, 'basic.ini');
const serviceFile = join(profileDir, 'service.json');
const cookieDir = join(configRoot, 'plugin_config', 'obs-browser', 'obs_profile_cookies');
const runtimeDir = process.env.XDG_RUNTIME_DIR ?? `/run/user/${process.getuid()}`;
const pidFile = join(runtimeDir, 'obs-live-studio', 'obs.pid');
const backupRoot = resolve(process.env.OBS_AUTH_BACKUP_ROOT ?? join(root, 'var', 'backups'));
const procRoot = process.env.OBS_PROC_ROOT ?? '/proc';

async function exists(path) {
  try {
    await access(path, constants.F_OK);
    return true;
  } catch {
    return false;
  }
}

async function processIsObs(pid) {
  try {
    const command = (await readFile(join(procRoot, String(pid), 'comm'), 'utf8')).trim();
    return command === 'obs';
  } catch {
    return false;
  }
}

async function obsIsRunning() {
  try {
    const pid = Number((await readFile(pidFile, 'utf8')).trim());
    if (Number.isInteger(pid) && pid > 0 && (await processIsObs(pid))) return true;
  } catch {}
  try {
    const processes = await readdir(procRoot);
    for (const entry of processes) {
      if (/^\d+$/.test(entry) && (await processIsObs(Number(entry)))) return true;
    }
  } catch {}
  return false;
}

function removeIniSections(source, names) {
  let remove = false;
  const removed = new Set();
  const kept = [];
  for (const line of source.split(/\r?\n/)) {
    const section = line.match(/^\s*\[([^\]]+)]\s*$/)?.[1];
    if (section) {
      remove = names.has(section);
      if (remove) removed.add(section);
    }
    if (!remove) kept.push(line);
  }
  return { source: `${kept.join('\n').trim()}\n`, removed: [...removed] };
}

if (await obsIsRunning()) {
  throw new Error('OBS läuft noch. Stoppe zuerst obs-live-studio-desktop-agent.service');
}
if (!(await exists(profileFile))) throw new Error(`OBS-Profil fehlt: ${profileFile}`);

const timestamp = new Date().toISOString().replace(/[:.]/g, '-');
const backupDir = join(backupRoot, `obs-youtube-auth-${timestamp}`);
await mkdir(backupDir, { recursive: true, mode: 0o700 });
const profileBackup = join(backupDir, 'basic.ini');
await copyFile(profileFile, profileBackup);
await chmod(profileBackup, 0o600);
if (await exists(serviceFile)) {
  const serviceBackup = join(backupDir, 'service.json');
  await copyFile(serviceFile, serviceBackup);
  await chmod(serviceBackup, 0o600);
}

const profile = await readFile(profileFile, 'utf8');
const cleaned = removeIniSections(profile, new Set(['YouTube', 'Auth', 'YouTube - RTMPS', 'YouTube - RTMP']));
await writeFile(profileFile, cleaned.source, { mode: 0o600 });
await chmod(profileFile, 0o600);

await writeFile(
  serviceFile,
  `${JSON.stringify({
    type: 'rtmp_common',
    settings: {
      service: 'YouTube - RTMPS',
      server: process.env.STREAM_SERVER || 'rtmps://a.rtmps.youtube.com:443/live2',
      key: '',
      bwtest: false,
      use_auth: false,
    },
  })}\n`,
  { mode: 0o600 },
);
await chmod(serviceFile, 0o600);

let cookiesReset = false;
if (await exists(cookieDir)) {
  await rename(cookieDir, join(backupDir, 'obs_profile_cookies'));
  cookiesReset = true;
}
await mkdir(cookieDir, { recursive: true, mode: 0o700 });

console.log(
  JSON.stringify({
    ok: true,
    profile: profileName,
    removedSections: cleaned.removed,
    cookiesReset,
    streamService: 'YouTube - RTMPS',
    streamKeyConfigured: false,
    backupDir,
  }),
);
