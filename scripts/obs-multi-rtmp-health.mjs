import { access, readFile, stat } from 'node:fs/promises';
import { constants } from 'node:fs';
import { homedir } from 'node:os';
import { join } from 'node:path';
import { timingSafeEqual } from 'node:crypto';
import { MANAGED_TARGET_ID, resolveTwitchTarget } from './obs-multi-rtmp-config.mjs';

const MAIN_ENCODER_REFERENCES = new Set([undefined, null, '', '<OBS_STREAMING_ENCODER>']);

function safeProfileName(value) {
  return String(value ?? 'Automated News Studio').replace(/[^A-Za-z0-9_-]+/g, '_');
}

function normalizeServer(value) {
  const url = new URL(String(value));
  return url.toString().replace(/\/$/, '');
}

function secretsEqual(left, right) {
  const a = Buffer.from(String(left ?? ''));
  const b = Buffer.from(String(right ?? ''));
  return a.length === b.length && timingSafeEqual(a, b);
}

function secureOwnerOnly(mode) {
  return (mode & 0o077) === 0;
}

export function obsMultiRtmpPaths(env = process.env, options = {}) {
  const home = options.homeDir ?? homedir();
  const configRoot = options.configRoot ?? env.XDG_CONFIG_HOME ?? join(home, '.config');
  const profile = safeProfileName(env.OBS_PROFILE_NAME);
  const configuredPlugin = String(env.OBS_MULTI_RTMP_PLUGIN_PATH ?? '').trim();
  const architectureDirectory = process.arch === 'arm64' ? 'aarch64-linux-gnu' : 'x86_64-linux-gnu';
  const defaultCandidates = [
    configuredPlugin,
    `/usr/lib/${architectureDirectory}/obs-plugins/obs-multi-rtmp.so`,
    '/usr/lib/obs-plugins/obs-multi-rtmp.so',
    '/usr/lib64/obs-plugins/obs-multi-rtmp.so',
    join(configRoot, 'obs-studio', 'plugins', 'obs-multi-rtmp', 'bin', '64bit', 'obs-multi-rtmp.so'),
  ].filter(Boolean);
  return {
    profile,
    configFile: join(configRoot, 'obs-studio', 'basic', 'profiles', profile, 'obs-multi-rtmp.json'),
    pluginCandidates: options.pluginCandidates ?? defaultCandidates,
  };
}

async function firstReadable(paths) {
  for (const path of paths) {
    try {
      await access(path, constants.R_OK);
      return path;
    } catch {}
  }
  return null;
}

export async function inspectObsMultiRtmp(env = process.env, options = {}) {
  const requested = env.TWITCH_ENABLED === 'true';
  const paths = obsMultiRtmpPaths(env, options);
  const checks = [];
  const add = (id, status, message) => checks.push({ id, status, message });

  if (!requested) {
    add('twitch-enabled', 'disabled', 'Twitch-Parallelstreaming ist deaktiviert.');
    return {
      requested,
      ready: true,
      status: 'disabled',
      plugin: { installed: false, path: null },
      configuration: {
        path: paths.configFile,
        exists: false,
        secure: null,
        targetPresent: false,
        targetMatchesEnvironment: false,
        syncStart: false,
        syncStop: false,
        sharesMainEncoders: false,
      },
      checks,
    };
  }

  let expectedTarget = null;
  try {
    expectedTarget = resolveTwitchTarget(env).target;
    add('twitch-environment', 'ok', 'Twitch-Ziel und Schlüssel sind syntaktisch gültig.');
  } catch (error) {
    add('twitch-environment', 'error', error instanceof Error ? error.message : String(error));
  }

  const pluginPath = await firstReadable(paths.pluginCandidates);
  add(
    'plugin-installed',
    pluginPath ? 'ok' : 'error',
    pluginPath ? 'obs-multi-rtmp ist installiert.' : 'obs-multi-rtmp wurde in keinem erwarteten Plugin-Pfad gefunden.',
  );

  let document = null;
  let configMode = null;
  try {
    document = JSON.parse(await readFile(paths.configFile, 'utf8'));
    configMode = (await stat(paths.configFile)).mode;
    add('plugin-config', 'ok', 'Die obs-multi-rtmp-Konfiguration ist lesbar.');
  } catch (error) {
    const message =
      error?.code === 'ENOENT'
        ? 'Die obs-multi-rtmp-Konfiguration fehlt.'
        : 'Die obs-multi-rtmp-Konfiguration ist ungültig.';
    add('plugin-config', 'error', message);
  }

  const secure = configMode === null ? null : secureOwnerOnly(configMode);
  if (secure !== null) {
    add(
      'plugin-config-permissions',
      secure ? 'ok' : 'error',
      secure
        ? 'Die Plugin-Konfiguration ist nur für den Eigentümer lesbar.'
        : 'Die Plugin-Konfiguration ist für andere Benutzer zugänglich.',
    );
  }

  const target = Array.isArray(document?.targets)
    ? document.targets.find((item) => item?.id === MANAGED_TARGET_ID)
    : null;
  add(
    'twitch-target',
    target ? 'ok' : 'error',
    target ? 'Das verwaltete Twitch-Ziel ist vorhanden.' : 'Das verwaltete Twitch-Ziel fehlt.',
  );

  const syncStart = target?.['sync-start'] === true;
  const syncStop = target?.['sync-stop'] === true;
  const sharesMainEncoders =
    Boolean(target) &&
    MAIN_ENCODER_REFERENCES.has(target?.['video-config']) &&
    MAIN_ENCODER_REFERENCES.has(target?.['audio-config']);
  let targetMatchesEnvironment = false;
  if (target && expectedTarget) {
    try {
      targetMatchesEnvironment =
        normalizeServer(target?.['service-param']?.server) === normalizeServer(expectedTarget['service-param'].server) &&
        secretsEqual(target?.['service-param']?.key, expectedTarget['service-param'].key);
    } catch {
      targetMatchesEnvironment = false;
    }
  }

  if (target) {
    add(
      'twitch-target-credentials',
      targetMatchesEnvironment ? 'ok' : 'error',
      targetMatchesEnvironment
        ? 'Twitch-Server und Streamschlüssel stimmen mit der Umgebung überein.'
        : 'Twitch-Server oder Streamschlüssel stimmen nicht mit der Umgebung überein.',
    );
    add(
      'twitch-sync-start',
      syncStart ? 'ok' : 'error',
      syncStart ? 'Twitch startet synchron.' : 'Synchroner Twitch-Start ist deaktiviert.',
    );
    add(
      'twitch-sync-stop',
      syncStop ? 'ok' : 'error',
      syncStop ? 'Twitch stoppt synchron.' : 'Synchroner Twitch-Stopp ist deaktiviert.',
    );
    add(
      'twitch-encoder-sharing',
      sharesMainEncoders ? 'ok' : 'error',
      sharesMainEncoders
        ? 'Twitch teilt die OBS-Hauptencoder.'
        : 'Twitch verwendet eine abweichende Encoder-Konfiguration und kann zusätzliche Last erzeugen.',
    );
  }

  const ready = checks.every((check) => check.status !== 'error');
  return {
    requested,
    ready,
    status: ready ? 'ready' : 'degraded',
    plugin: { installed: Boolean(pluginPath), path: pluginPath },
    configuration: {
      path: paths.configFile,
      exists: Boolean(document),
      secure,
      targetPresent: Boolean(target),
      targetMatchesEnvironment,
      syncStart,
      syncStop,
      sharesMainEncoders,
    },
    checks,
  };
}

export async function assertObsMultiRtmpReady(env = process.env, options = {}) {
  const report = await inspectObsMultiRtmp(env, options);
  if (!report.ready) {
    const errors = report.checks.filter((check) => check.status === 'error').map((check) => check.message);
    throw new Error(`Twitch-Vorabprüfung fehlgeschlagen: ${errors.join(' ')}`);
  }
  return report;
}
