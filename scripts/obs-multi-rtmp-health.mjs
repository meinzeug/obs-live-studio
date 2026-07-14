import { timingSafeEqual } from 'node:crypto';
import { constants } from 'node:fs';
import { access, readFile, stat } from 'node:fs/promises';
import { homedir } from 'node:os';
import { join } from 'node:path';
import { resolveAdditionalStreamTargets } from '../packages/streaming-platforms/index.mjs';

const MAIN_ENCODER_REFERENCES = new Set([undefined, null, '', '<OBS_STREAMING_ENCODER>']);

function safeProfileName(value) {
  return String(value ?? 'Open TV Studio').replace(/[^A-Za-z0-9_-]+/g, '_');
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

function secureOwnerOnly(metadata) {
  const currentUid = typeof process.getuid === 'function' ? process.getuid() : null;
  const ownedByCurrentUser = currentUid === null || metadata.uid === currentUid;
  return (metadata.mode & 0o077) === 0 && ownedByCurrentUser;
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

function targetHealth(expected, document, add) {
  const target = Array.isArray(document?.targets)
    ? document.targets.find((item) => item?.id === expected.managedId)
    : null;
  add(
    `${expected.id}-target`,
    target ? 'ok' : 'error',
    target ? `${expected.name}: verwaltetes Ziel ist vorhanden.` : `${expected.name}: verwaltetes Ziel fehlt.`,
  );
  const syncStart = target?.['sync-start'] === true;
  const syncStop = target?.['sync-stop'] === true;
  const sharesMainEncoders =
    Boolean(target) &&
    MAIN_ENCODER_REFERENCES.has(target?.['video-config']) &&
    MAIN_ENCODER_REFERENCES.has(target?.['audio-config']);
  let matchesEnvironment = false;
  if (target) {
    try {
      matchesEnvironment =
        normalizeServer(target?.['service-param']?.server) === normalizeServer(expected.server) &&
        secretsEqual(target?.['service-param']?.key, expected.key);
    } catch {
      matchesEnvironment = false;
    }
    add(
      `${expected.id}-credentials`,
      matchesEnvironment ? 'ok' : 'error',
      matchesEnvironment
        ? `${expected.name}: Server und Streamschlüssel stimmen mit der Umgebung überein.`
        : `${expected.name}: Server oder Streamschlüssel stimmen nicht mit der Umgebung überein.`,
    );
    add(
      `${expected.id}-sync-start`,
      syncStart ? 'ok' : 'error',
      syncStart ? `${expected.name}: startet synchron.` : `${expected.name}: synchroner Start ist deaktiviert.`,
    );
    add(
      `${expected.id}-sync-stop`,
      syncStop ? 'ok' : 'error',
      syncStop ? `${expected.name}: stoppt synchron.` : `${expected.name}: synchroner Stopp ist deaktiviert.`,
    );
    add(
      `${expected.id}-encoder-sharing`,
      sharesMainEncoders ? 'ok' : 'error',
      sharesMainEncoders
        ? `${expected.name}: teilt die OBS-Hauptencoder.`
        : `${expected.name}: verwendet abweichende Encoder und kann zusätzliche Last erzeugen.`,
    );
  }
  return {
    id: expected.id,
    name: expected.name,
    platform: expected.platform,
    present: Boolean(target),
    matchesEnvironment,
    syncStart,
    syncStop,
    sharesMainEncoders,
    ready: Boolean(target) && matchesEnvironment && syncStart && syncStop && sharesMainEncoders,
  };
}

export async function inspectObsMultiRtmp(env = process.env, options = {}) {
  const paths = obsMultiRtmpPaths(env, options);
  const checks = [];
  const add = (id, status, message) => checks.push({ id, status, message });
  let expectedTargets = [];
  try {
    expectedTargets = resolveAdditionalStreamTargets(env, { requireConfigured: true });
  } catch (error) {
    add('multistream-environment', 'error', error instanceof Error ? error.message : String(error));
  }

  const enabled = expectedTargets.length > 0 || checks.some((check) => check.status === 'error');
  if (!enabled) {
    add('multistream-enabled', 'disabled', 'Zusätzliche Streaming-Ziele sind deaktiviert.');
    return {
      enabled: false,
      ready: true,
      status: 'disabled',
      plugin: { installed: false, path: null },
      configuration: { path: paths.configFile, exists: false, secure: null },
      targets: [],
      checks,
    };
  }

  if (expectedTargets.length) {
    add('multistream-environment', 'ok', `${expectedTargets.length} zusätzliches Streaming-Ziel ist gültig.`);
  }
  const pluginPath = await firstReadable(paths.pluginCandidates);
  add(
    'plugin-installed',
    pluginPath ? 'ok' : 'error',
    pluginPath ? 'obs-multi-rtmp ist installiert.' : 'obs-multi-rtmp wurde in keinem erwarteten Plugin-Pfad gefunden.',
  );

  let document = null;
  let configMetadata = null;
  try {
    document = JSON.parse(await readFile(paths.configFile, 'utf8'));
    configMetadata = await stat(paths.configFile);
    add('plugin-config', 'ok', 'Die obs-multi-rtmp-Konfiguration ist lesbar.');
  } catch (error) {
    add(
      'plugin-config',
      'error',
      error?.code === 'ENOENT'
        ? 'Die obs-multi-rtmp-Konfiguration fehlt.'
        : 'Die obs-multi-rtmp-Konfiguration ist ungültig.',
    );
  }

  const secure = configMetadata === null ? null : secureOwnerOnly(configMetadata);
  if (secure !== null) {
    add(
      'plugin-config-permissions',
      secure ? 'ok' : 'error',
      secure
        ? 'Die Plugin-Konfiguration ist nur für den Dienstbenutzer lesbar.'
        : 'Die Plugin-Konfiguration besitzt unsichere Rechte oder einen falschen Eigentümer.',
    );
  }

  const targets = expectedTargets.map((target) => targetHealth(target, document, add));
  const ready = checks.every((check) => check.status !== 'error');
  return {
    enabled: true,
    ready,
    status: ready ? 'ready' : 'degraded',
    plugin: { installed: Boolean(pluginPath), path: pluginPath },
    configuration: { path: paths.configFile, exists: Boolean(document), secure },
    targets,
    checks,
  };
}

export async function assertObsMultiRtmpReady(env = process.env, options = {}) {
  const report = await inspectObsMultiRtmp(env, options);
  if (!report.ready) {
    const errors = report.checks.filter((check) => check.status === 'error').map((check) => check.message);
    throw new Error(`Multistream-Vorabprüfung fehlgeschlagen: ${errors.join(' ')}`);
  }
  return report;
}
