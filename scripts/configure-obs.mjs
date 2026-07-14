import { randomUUID } from 'node:crypto';
import { chmod, mkdir, readFile, writeFile } from 'node:fs/promises';
import { homedir } from 'node:os';
import { join } from 'node:path';

const profileName = process.env.OBS_PROFILE_NAME ?? 'Automated News Studio';
const collectionName = process.env.OBS_SCENE_COLLECTION ?? 'Automated News Studio';
const browserHardwareAcceleration = process.env.OBS_BROWSER_HW_ACCEL === 'true';
const obsPassword = process.env.OBS_PASSWORD;
if (!obsPassword) throw new Error('OBS_PASSWORD fehlt in .env');

const configRoot = join(process.env.XDG_CONFIG_HOME ?? join(homedir(), '.config'), 'obs-studio');
const safeProfile = profileName.replace(/[^A-Za-z0-9_-]+/g, '_');
const safeCollection = collectionName.replace(/[^A-Za-z0-9_-]+/g, '_');
const profileDir = join(configRoot, 'basic', 'profiles', safeProfile);
const scenesDir = join(configRoot, 'basic', 'scenes');
await mkdir(profileDir, { recursive: true });
await mkdir(scenesDir, { recursive: true });

function setIniValue(source, section, key, value) {
  const lines = source ? source.split(/\r?\n/) : [];
  let sectionStart = lines.findIndex((line) => line.trim() === `[${section}]`);
  if (sectionStart < 0) {
    if (lines.length && lines.at(-1) !== '') lines.push('');
    lines.push(`[${section}]`, `${key}=${value}`);
    return lines.join('\n');
  }
  let sectionEnd = lines.findIndex((line, index) => index > sectionStart && /^\s*\[.+\]\s*$/.test(line));
  if (sectionEnd < 0) sectionEnd = lines.length;
  const keyIndex = lines.findIndex(
    (line, index) => index > sectionStart && index < sectionEnd && line.startsWith(`${key}=`),
  );
  if (keyIndex >= 0) lines[keyIndex] = `${key}=${value}`;
  else lines.splice(sectionEnd, 0, `${key}=${value}`);
  return lines.join('\n');
}

const globalFile = join(configRoot, 'global.ini');
let globalIni = '';
try {
  globalIni = await readFile(globalFile, 'utf8');
} catch {}
for (const [section, key, value] of [
  ['General', 'FirstRun', 'false'],
  ['General', 'ConfirmOnExit', 'false'],
  ['General', 'BrowserHWAccel', String(browserHardwareAcceleration)],
  ['Basic', 'Profile', profileName],
  ['Basic', 'ProfileDir', safeProfile],
  ['Basic', 'SceneCollection', collectionName],
  ['Basic', 'SceneCollectionFile', safeCollection],
  ['Basic', 'ConfigOnNewProfile', 'false'],
  ['OBSWebSocket', 'FirstLoad', 'false'],
  ['OBSWebSocket', 'ServerEnabled', 'true'],
  ['OBSWebSocket', 'ServerPort', String(process.env.OBS_PORT ?? 4455)],
  ['OBSWebSocket', 'AlertsEnabled', 'false'],
  ['OBSWebSocket', 'AuthRequired', 'true'],
  ['OBSWebSocket', 'ServerPassword', obsPassword],
]) {
  globalIni = setIniValue(globalIni, section, key, value);
}
await writeFile(globalFile, `${globalIni.trim()}\n`, { mode: 0o600 });
await chmod(globalFile, 0o600);

const userFile = join(configRoot, 'user.ini');
let userIni = '';
try {
  userIni = await readFile(userFile, 'utf8');
} catch {}
for (const [section, key, value] of [
  ['General', 'FirstRun', 'false'],
  ['General', 'ConfirmOnExit', 'false'],
  ['Basic', 'Profile', profileName],
  ['Basic', 'ProfileDir', safeProfile],
  ['Basic', 'SceneCollection', collectionName],
  ['Basic', 'SceneCollectionFile', `${safeCollection}.json`],
  ['Basic', 'ConfigOnNewProfile', 'false'],
]) {
  userIni = setIniValue(userIni, section, key, value);
}
await writeFile(userFile, `${userIni.trim()}\n`, { mode: 0o600 });
await chmod(userFile, 0o600);

const websocketDir = join(configRoot, 'plugin_config', 'obs-websocket');
await mkdir(websocketDir, { recursive: true });
await writeFile(
  join(websocketDir, 'config.json'),
  `${JSON.stringify(
    {
      alerts_enabled: false,
      auth_required: true,
      first_load: false,
      server_enabled: true,
      server_password: obsPassword,
      server_port: Number(process.env.OBS_PORT ?? 4455),
    },
    null,
    2,
  )}\n`,
  { mode: 0o600 },
);

const baseWidth = Number(process.env.VIDEO_BASE_WIDTH ?? 1920);
const baseHeight = Number(process.env.VIDEO_BASE_HEIGHT ?? 1080);
const outputWidth = Number(process.env.VIDEO_OUTPUT_WIDTH ?? 1920);
const outputHeight = Number(process.env.VIDEO_OUTPUT_HEIGHT ?? 1080);
const profileIni = `[General]
Name=${profileName}

[Output]
Mode=Simple
Reconnect=true
RetryDelay=2
MaxRetries=25

[SimpleOutput]
VBitrate=${Number(process.env.VIDEO_BITRATE_KBPS ?? 6000)}
StreamEncoder=x264
ABitrate=${Number(process.env.AUDIO_BITRATE_KBPS ?? 160)}
RecQuality=Stream
RecFormat2=mkv
Preset=veryfast

[Video]
BaseCX=${baseWidth}
BaseCY=${baseHeight}
OutputCX=${outputWidth}
OutputCY=${outputHeight}
FPSType=0
FPSCommon=${process.env.VIDEO_FPS ?? 30}
ScaleType=bicubic
ColorFormat=NV12
ColorSpace=709
ColorRange=Partial

[Audio]
SampleRate=48000
ChannelSetup=Stereo
`;
await writeFile(join(profileDir, 'basic.ini'), profileIni, { mode: 0o600 });

const streamService = {
  type: 'rtmp_common',
  settings: {
    service: 'YouTube - RTMPS',
    server: process.env.STREAM_SERVER || 'rtmps://a.rtmps.youtube.com:443/live2',
    key: process.env.STREAM_KEY || '',
    bwtest: false,
    use_auth: false,
  },
};
const serviceFile = join(profileDir, 'service.json');
let serviceConfig = streamService;
try {
  const existing = JSON.parse(await readFile(serviceFile, 'utf8'));
  if (existing?.settings?.service) serviceConfig = existing;
} catch {}
if (!serviceConfig.settings.key && process.env.STREAM_KEY) serviceConfig.settings.key = process.env.STREAM_KEY;
await writeFile(serviceFile, `${JSON.stringify(serviceConfig)}\n`, { mode: 0o600 });

const maintenanceScene = {
  prev_ver: 503316482,
  name: '10_MAINTENANCE',
  uuid: randomUUID(),
  id: 'scene',
  versioned_id: 'scene',
  settings: { id_counter: 0, custom_size: false, items: [] },
  mixers: 0,
  sync: 0,
  flags: 0,
  volume: 1,
  balance: 0.5,
  enabled: true,
  muted: false,
  'push-to-mute': false,
  'push-to-mute-delay': 0,
  'push-to-talk': false,
  'push-to-talk-delay': 0,
  hotkeys: { 'OBSBasic.SelectScene': [] },
  deinterlace_mode: 0,
  deinterlace_field_order: 0,
  monitoring_type: 0,
  private_settings: {},
};
const collection = {
  current_scene: maintenanceScene.name,
  current_program_scene: maintenanceScene.name,
  scene_order: [{ name: maintenanceScene.name }],
  name: collectionName,
  sources: [maintenanceScene],
  groups: [],
  quick_transitions: [
    { name: 'Cut', duration: 300, hotkeys: [], id: 1, fade_to_black: false },
    { name: 'Fade', duration: 300, hotkeys: [], id: 2, fade_to_black: false },
  ],
  transitions: [],
  saved_projectors: [],
  current_transition: 'Fade',
  transition_duration: 300,
  preview_locked: false,
  scaling_enabled: false,
  scaling_level: 0,
  scaling_off_x: 0,
  scaling_off_y: 0,
  'virtual-camera': { type2: 3 },
  modules: {},
};
const collectionFile = join(scenesDir, `${safeCollection}.json`);
let existingCollection = null;
try {
  existingCollection = JSON.parse(await readFile(collectionFile, 'utf8'));
} catch {}
if (!existingCollection?.sources?.length) {
  await writeFile(collectionFile, `${JSON.stringify(collection)}\n`, { mode: 0o600 });
}
console.log(`OBS-Profil und Szenensammlung '${collectionName}' sind konfiguriert.`);
