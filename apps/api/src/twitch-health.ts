import { timingSafeEqual } from 'node:crypto';
import { access, readFile, stat } from 'node:fs/promises';
import { constants } from 'node:fs';
import { homedir } from 'node:os';
import { join } from 'node:path';

const MANAGED_TARGET_ID = 'argumentationskette-twitch';
const TWITCH_KEY_PATTERN = /^[A-Za-z0-9_]{8,256}$/;
const MAIN_ENCODER_REFERENCES = new Set<unknown>([undefined, null, '', '<OBS_STREAMING_ENCODER>']);

export type TwitchHealthCheck = {
  id: string;
  status: 'ok' | 'error' | 'disabled';
  message: string;
};

export type TwitchRuntimeHealth = {
  enabled: boolean;
  ready: boolean;
  status: 'disabled' | 'ready' | 'degraded';
  pluginInstalled: boolean;
  configurationPresent: boolean;
  configurationSecure: boolean | null;
  targetPresent: boolean;
  targetMatchesEnvironment: boolean;
  syncStart: boolean;
  syncStop: boolean;
  sharesMainEncoders: boolean;
  checks: TwitchHealthCheck[];
};

type InspectOptions = {
  homeDir?: string;
  configRoot?: string;
  pluginCandidates?: string[];
};

function safeProfileName(value: string | undefined) {
  return String(value ?? 'Automated News Studio').replace(/[^A-Za-z0-9_-]+/g, '_');
}

function normalizeServer(value: unknown) {
  const url = new URL(String(value ?? ''));
  return url.toString().replace(/\/$/, '');
}

function secretMatches(left: unknown, right: unknown) {
  const first = Buffer.from(String(left ?? ''));
  const second = Buffer.from(String(right ?? ''));
  return first.length === second.length && timingSafeEqual(first, second);
}

function secureOwnerOnly(mode: number) {
  return (mode & 0o077) === 0;
}

function defaultPluginCandidates(configRoot: string, configuredPath: string | undefined) {
  const architectureDirectory = process.arch === 'arm64' ? 'aarch64-linux-gnu' : 'x86_64-linux-gnu';
  return [
    String(configuredPath ?? '').trim(),
    `/usr/lib/${architectureDirectory}/obs-plugins/obs-multi-rtmp.so`,
    '/usr/lib/obs-plugins/obs-multi-rtmp.so',
    '/usr/lib64/obs-plugins/obs-multi-rtmp.so',
    join(configRoot, 'obs-studio', 'plugins', 'obs-multi-rtmp', 'bin', '64bit', 'obs-multi-rtmp.so'),
  ].filter(Boolean);
}

async function firstReadable(paths: string[]) {
  for (const path of paths) {
    try {
      await access(path, constants.R_OK);
      return path;
    } catch {}
  }
  return null;
}

function expectedTarget(env: NodeJS.ProcessEnv) {
  const server = String(env.TWITCH_STREAM_SERVER ?? 'rtmps://live.twitch.tv:443/app').trim();
  const url = new URL(server);
  if (url.protocol !== 'rtmps:') throw new Error('TWITCH_STREAM_SERVER muss verschlüsseltes rtmps:// verwenden.');
  if (url.username || url.password || url.search || url.hash || !url.pathname.replaceAll('/', '')) {
    throw new Error('TWITCH_STREAM_SERVER enthält unzulässige Bestandteile.');
  }
  const key = String(env.TWITCH_STREAM_KEY ?? '').trim();
  if (!TWITCH_KEY_PATTERN.test(key)) {
    throw new Error('TWITCH_STREAM_KEY fehlt oder enthält unzulässige Zeichen.');
  }
  return { server: normalizeServer(url.toString()), key };
}

export async function inspectTwitchRuntime(
  env: NodeJS.ProcessEnv = process.env,
  options: InspectOptions = {},
): Promise<TwitchRuntimeHealth> {
  const enabled = env.TWITCH_ENABLED === 'true';
  const checks: TwitchHealthCheck[] = [];
  const add = (id: string, status: TwitchHealthCheck['status'], message: string) => checks.push({ id, status, message });

  if (!enabled) {
    add('twitch-enabled', 'disabled', 'Twitch-Parallelstreaming ist deaktiviert.');
    return {
      enabled,
      ready: true,
      status: 'disabled',
      pluginInstalled: false,
      configurationPresent: false,
      configurationSecure: null,
      targetPresent: false,
      targetMatchesEnvironment: false,
      syncStart: false,
      syncStop: false,
      sharesMainEncoders: false,
      checks,
    };
  }

  let expected: { server: string; key: string } | null = null;
  try {
    expected = expectedTarget(env);
    add('twitch-environment', 'ok', 'Twitch-Ziel und Streamschlüssel sind syntaktisch gültig.');
  } catch (error) {
    add('twitch-environment', 'error', error instanceof Error ? error.message : String(error));
  }

  const home = options.homeDir ?? homedir();
  const configRoot = options.configRoot ?? env.XDG_CONFIG_HOME ?? join(home, '.config');
  const profile = safeProfileName(env.OBS_PROFILE_NAME);
  const configFile = join(configRoot, 'obs-studio', 'basic', 'profiles', profile, 'obs-multi-rtmp.json');
  const pluginCandidates =
    options.pluginCandidates ?? defaultPluginCandidates(configRoot, env.OBS_MULTI_RTMP_PLUGIN_PATH);
  const pluginInstalled = Boolean(await firstReadable(pluginCandidates));
  add(
    'plugin-installed',
    pluginInstalled ? 'ok' : 'error',
    pluginInstalled ? 'OBS Multiple RTMP Outputs ist installiert.' : 'OBS Multiple RTMP Outputs wurde nicht gefunden.',
  );

  let document: any = null;
  let configurationSecure: boolean | null = null;
  try {
    document = JSON.parse(await readFile(configFile, 'utf8'));
    configurationSecure = secureOwnerOnly((await stat(configFile)).mode);
    add('plugin-config', 'ok', 'Die Plugin-Konfiguration ist lesbar.');
    add(
      'plugin-config-permissions',
      configurationSecure ? 'ok' : 'error',
      configurationSecure
        ? 'Die Plugin-Konfiguration ist nur für den Eigentümer lesbar.'
        : 'Die Plugin-Konfiguration ist für andere Benutzer zugänglich.',
    );
  } catch (error: any) {
    add(
      'plugin-config',
      'error',
      error?.code === 'ENOENT' ? 'Die Plugin-Konfiguration fehlt.' : 'Die Plugin-Konfiguration ist ungültig.',
    );
  }

  const target = Array.isArray(document?.targets)
    ? document.targets.find((item: any) => item?.id === MANAGED_TARGET_ID)
    : null;
  const targetPresent = Boolean(target);
  add(
    'twitch-target',
    targetPresent ? 'ok' : 'error',
    targetPresent ? 'Das verwaltete Twitch-Ziel ist vorhanden.' : 'Das verwaltete Twitch-Ziel fehlt.',
  );

  const syncStart = target?.['sync-start'] === true;
  const syncStop = target?.['sync-stop'] === true;
  const sharesMainEncoders =
    targetPresent &&
    MAIN_ENCODER_REFERENCES.has(target?.['video-config']) &&
    MAIN_ENCODER_REFERENCES.has(target?.['audio-config']);
  let targetMatchesEnvironment = false;
  if (targetPresent && expected) {
    try {
      targetMatchesEnvironment =
        normalizeServer(target?.['service-param']?.server) === expected.server &&
        secretMatches(target?.['service-param']?.key, expected.key);
    } catch {
      targetMatchesEnvironment = false;
    }
    add(
      'twitch-target-credentials',
      targetMatchesEnvironment ? 'ok' : 'error',
      targetMatchesEnvironment
        ? 'Twitch-Server und Streamschlüssel stimmen mit der Umgebung überein.'
        : 'Twitch-Server oder Streamschlüssel stimmen nicht mit der Umgebung überein.',
    );
    add('twitch-sync-start', syncStart ? 'ok' : 'error', syncStart ? 'Twitch startet synchron.' : 'Synchroner Twitch-Start ist deaktiviert.');
    add('twitch-sync-stop', syncStop ? 'ok' : 'error', syncStop ? 'Twitch stoppt synchron.' : 'Synchroner Twitch-Stopp ist deaktiviert.');
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
    enabled,
    ready,
    status: ready ? 'ready' : 'degraded',
    pluginInstalled,
    configurationPresent: Boolean(document),
    configurationSecure,
    targetPresent,
    targetMatchesEnvironment,
    syncStart,
    syncStop,
    sharesMainEncoders,
    checks,
  };
}

export async function assertTwitchRuntimeReady(env: NodeJS.ProcessEnv = process.env, options: InspectOptions = {}) {
  const report = await inspectTwitchRuntime(env, options);
  if (!report.ready) {
    const failures = report.checks.filter((check) => check.status === 'error').map((check) => check.message);
    throw new Error(`Twitch-Vorabprüfung fehlgeschlagen: ${failures.join(' ')}`);
  }
  return report;
}
