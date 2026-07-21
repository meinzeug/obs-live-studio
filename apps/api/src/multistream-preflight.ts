import { timingSafeEqual } from 'node:crypto';
import { constants } from 'node:fs';
import { access, readFile, stat } from 'node:fs/promises';
import { homedir } from 'node:os';
import { join } from 'node:path';
import { ObsController } from '@ans/obs-controller';
import {
  resolveAdditionalStreamTargets,
  resolvePrimaryStreamTarget,
  type StreamTarget,
} from '../../../packages/streaming-platforms/index.mjs';

const MAIN_ENCODER_REFERENCES = new Set<unknown>([undefined, null, '', '<OBS_STREAMING_ENCODER>']);
const PATCH_MARKER = Symbol.for('open-tv-studio.obs.multistream-preflight');

export type MultistreamHealthCheck = {
  id: string;
  status: 'ok' | 'error' | 'disabled';
  message: string;
};

export type MultistreamTargetHealth = {
  id: string;
  name: string;
  platform: string;
  present: boolean;
  matchesEnvironment: boolean;
  syncStart: boolean;
  syncStop: boolean;
  sharesMainEncoders: boolean;
  ready: boolean;
};

export type MultistreamRuntimeHealth = {
  enabled: boolean;
  ready: boolean;
  status: 'disabled' | 'ready' | 'degraded';
  pluginInstalled: boolean;
  configurationPresent: boolean;
  configurationSecure: boolean | null;
  configurationOwnedByProcess: boolean | null;
  targets: MultistreamTargetHealth[];
  checks: MultistreamHealthCheck[];
};

type InspectOptions = {
  homeDir?: string;
  configRoot?: string;
  pluginCandidates?: string[];
};

type InstallOptions = {
  environmentProvider?: () => NodeJS.ProcessEnv;
  inspectOptionsProvider?: () => InspectOptions;
};

function safeProfileName(value: string | undefined) {
  return String(value ?? 'Open TV Studio').replace(/[^A-Za-z0-9_-]+/g, '_');
}

function normalizeServer(value: unknown) {
  return new URL(String(value ?? '')).toString().replace(/\/$/, '');
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

async function firstReadableFile(paths: string[]) {
  for (const path of paths) {
    try {
      const metadata = await stat(path);
      if (!metadata.isFile()) continue;
      await access(path, constants.R_OK);
      return path;
    } catch {}
  }
  return null;
}

function inspectTarget(expected: StreamTarget, document: any, add: (check: MultistreamHealthCheck) => void) {
  const target = Array.isArray(document?.targets)
    ? document.targets.find((item: any) => item?.id === expected.managedId)
    : null;
  const present = Boolean(target);
  add({
    id: `${expected.id}-target`,
    status: present ? 'ok' : 'error',
    message: present
      ? `${expected.name}: verwaltetes Ziel ist vorhanden.`
      : `${expected.name}: verwaltetes Ziel fehlt.`,
  });

  const syncStart = target?.['sync-start'] === true;
  const syncStop = target?.['sync-stop'] === true;
  const sharesMainEncoders =
    present &&
    MAIN_ENCODER_REFERENCES.has(target?.['video-config']) &&
    MAIN_ENCODER_REFERENCES.has(target?.['audio-config']);
  let matchesEnvironment = false;

  if (present) {
    try {
      matchesEnvironment =
        normalizeServer(target?.['service-param']?.server) === normalizeServer(expected.server) &&
        secretMatches(target?.['service-param']?.key, expected.key);
    } catch {
      matchesEnvironment = false;
    }
    add({
      id: `${expected.id}-credentials`,
      status: matchesEnvironment ? 'ok' : 'error',
      message: matchesEnvironment
        ? `${expected.name}: Server und Streamschlüssel stimmen mit der Umgebung überein.`
        : `${expected.name}: Server oder Streamschlüssel stimmen nicht mit der Umgebung überein.`,
    });
    add({
      id: `${expected.id}-sync-start`,
      status: syncStart ? 'ok' : 'error',
      message: syncStart
        ? `${expected.name}: startet synchron.`
        : `${expected.name}: synchroner Start ist deaktiviert.`,
    });
    add({
      id: `${expected.id}-sync-stop`,
      status: syncStop ? 'ok' : 'error',
      message: syncStop ? `${expected.name}: stoppt synchron.` : `${expected.name}: synchroner Stopp ist deaktiviert.`,
    });
    add({
      id: `${expected.id}-encoder-sharing`,
      status: sharesMainEncoders ? 'ok' : 'error',
      message: sharesMainEncoders
        ? `${expected.name}: teilt die OBS-Hauptencoder.`
        : `${expected.name}: verwendet abweichende Encoder und kann zusätzliche Last erzeugen.`,
    });
  }

  return {
    id: expected.id,
    name: expected.name,
    platform: expected.platform,
    present,
    matchesEnvironment,
    syncStart,
    syncStop,
    sharesMainEncoders,
    ready: present && matchesEnvironment && syncStart && syncStop && sharesMainEncoders,
  } satisfies MultistreamTargetHealth;
}

export async function inspectMultistreamRuntime(
  env: NodeJS.ProcessEnv = process.env,
  options: InspectOptions = {},
): Promise<MultistreamRuntimeHealth> {
  const checks: MultistreamHealthCheck[] = [];
  const add = (check: MultistreamHealthCheck) => checks.push(check);
  let expectedTargets: StreamTarget[] = [];
  try {
    expectedTargets = resolveAdditionalStreamTargets(env, { requireConfigured: true });
  } catch (error) {
    add({
      id: 'multistream-environment',
      status: 'error',
      message: error instanceof Error ? error.message : String(error),
    });
  }

  const enabled = expectedTargets.length > 0 || checks.some((check) => check.status === 'error');
  if (!enabled) {
    add({ id: 'multistream-enabled', status: 'disabled', message: 'Zusätzliche Streaming-Ziele sind deaktiviert.' });
    return {
      enabled: false,
      ready: true,
      status: 'disabled',
      pluginInstalled: false,
      configurationPresent: false,
      configurationSecure: null,
      configurationOwnedByProcess: null,
      targets: [],
      checks,
    };
  }

  if (expectedTargets.length) {
    add({
      id: 'multistream-environment',
      status: 'ok',
      message: `${expectedTargets.length} zusätzliches Streaming-Ziel ist syntaktisch gültig.`,
    });
  }

  const home = options.homeDir ?? homedir();
  const configRoot = options.configRoot ?? env.XDG_CONFIG_HOME ?? join(home, '.config');
  const profile = safeProfileName(env.OBS_PROFILE_NAME);
  const configFile = join(configRoot, 'obs-studio', 'basic', 'profiles', profile, 'obs-multi-rtmp.json');
  const pluginCandidates =
    options.pluginCandidates ?? defaultPluginCandidates(configRoot, env.OBS_MULTI_RTMP_PLUGIN_PATH);
  const pluginInstalled = Boolean(await firstReadableFile(pluginCandidates));
  add({
    id: 'plugin-installed',
    status: pluginInstalled ? 'ok' : 'error',
    message: pluginInstalled
      ? 'OBS Multiple RTMP Outputs ist installiert.'
      : 'OBS Multiple RTMP Outputs wurde nicht gefunden.',
  });

  let document: any = null;
  let configurationSecure: boolean | null = null;
  let configurationOwnedByProcess: boolean | null = null;
  try {
    document = JSON.parse((await readFile(configFile, 'utf8')).replace(/^\uFEFF/, ''));
    const metadata = await stat(configFile);
    const currentUid = typeof process.getuid === 'function' ? process.getuid() : null;
    configurationSecure = secureOwnerOnly(metadata.mode);
    configurationOwnedByProcess = currentUid === null || metadata.uid === currentUid;
    add({ id: 'plugin-config', status: 'ok', message: 'Die Multistream-Konfiguration ist lesbar.' });
    add({
      id: 'plugin-config-permissions',
      status: configurationSecure ? 'ok' : 'error',
      message: configurationSecure
        ? 'Die Multistream-Konfiguration ist nur für den Eigentümer lesbar.'
        : 'Die Multistream-Konfiguration ist für andere Benutzer zugänglich.',
    });
    add({
      id: 'plugin-config-owner',
      status: configurationOwnedByProcess ? 'ok' : 'error',
      message: configurationOwnedByProcess
        ? 'Die Multistream-Konfiguration gehört dem laufenden Dienstbenutzer.'
        : 'Die Multistream-Konfiguration gehört einem anderen Benutzer.',
    });
  } catch (error: any) {
    add({
      id: 'plugin-config',
      status: 'error',
      message:
        error?.code === 'ENOENT'
          ? 'Die Multistream-Konfiguration fehlt.'
          : 'Die Multistream-Konfiguration ist ungültig.',
    });
  }

  const targets = expectedTargets.map((target) => inspectTarget(target, document, add));
  const ready = checks.every((check) => check.status !== 'error');
  return {
    enabled: true,
    ready,
    status: ready ? 'ready' : 'degraded',
    pluginInstalled,
    configurationPresent: Boolean(document),
    configurationSecure,
    configurationOwnedByProcess,
    targets,
    checks,
  };
}

export async function assertMultistreamRuntimeReady(
  env: NodeJS.ProcessEnv = process.env,
  options: InspectOptions = {},
) {
  const report = await inspectMultistreamRuntime(env, options);
  if (!report.ready) {
    const failures = report.checks.filter((check) => check.status === 'error').map((check) => check.message);
    throw new Error(`Multistream-Vorabprüfung fehlgeschlagen: ${failures.join(' ')}`);
  }
  return report;
}

export function assertPrimaryStreamTargetReady(env: NodeJS.ProcessEnv = process.env) {
  return resolvePrimaryStreamTarget(env, { requireConfigured: true });
}

export function installMultistreamPreflight(options: InstallOptions = {}) {
  const prototype = ObsController.prototype as any;
  if (prototype[PATCH_MARKER]) return () => undefined;

  const original = prototype.startStream as typeof ObsController.prototype.startStream;
  const wrapped = async function (this: ObsController, ...args: Parameters<typeof original>) {
    const env = options.environmentProvider?.() ?? process.env;
    const inspectOptions = options.inspectOptionsProvider?.() ?? {};
    assertPrimaryStreamTargetReady(env);
    await assertMultistreamRuntimeReady(env, inspectOptions);
    return original.apply(this, args);
  } as typeof original;

  prototype.startStream = wrapped;
  prototype[PATCH_MARKER] = { original, wrapped };

  return () => {
    if (prototype[PATCH_MARKER]?.wrapped === wrapped) {
      prototype.startStream = original;
      delete prototype[PATCH_MARKER];
    }
  };
}
