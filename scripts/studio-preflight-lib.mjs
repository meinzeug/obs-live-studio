import { access, readFile, stat } from 'node:fs/promises';
import { constants } from 'node:fs';
import { spawnSync } from 'node:child_process';
import { isIP } from 'node:net';
import { homedir } from 'node:os';
import { join, resolve } from 'node:path';
import { inspectObsMultiRtmp } from './obs-multi-rtmp-health.mjs';

const LOOPBACK_HOSTS = new Set(['localhost', '127.0.0.1', '::1']);
const VALID_SCOPES = new Set(['all', 'api', 'obs', 'configuration']);

function ownerOnly(mode) {
  return (mode & 0o077) === 0;
}

function isLoopback(host) {
  if (LOOPBACK_HOSTS.has(host)) return true;
  return isIP(host) === 4 && host.startsWith('127.');
}

function positiveInteger(value, fallback, minimum, maximum) {
  const parsed = Number(value ?? fallback);
  if (!Number.isInteger(parsed) || parsed < minimum || parsed > maximum) return fallback;
  return parsed;
}

function safeErrorDetail(error) {
  if (!error || typeof error !== 'object') return undefined;
  const code = typeof error.code === 'string' ? error.code : undefined;
  const name = typeof error.name === 'string' ? error.name : undefined;
  return [name, code].filter(Boolean).join(':') || undefined;
}

async function commandAvailable(command) {
  if (!command) return false;
  if (command.includes('/')) {
    try {
      await access(command, constants.X_OK);
      return true;
    } catch {
      return false;
    }
  }
  return spawnSync('which', [command], { stdio: 'ignore' }).status === 0;
}

async function inspectFile(path, options = {}) {
  try {
    const metadata = await stat(path);
    await access(path, options.executable ? constants.X_OK : constants.R_OK);
    const currentUid = typeof process.getuid === 'function' ? process.getuid() : null;
    const ownedByCurrentUser = currentUid === null || metadata.uid === currentUid;
    return {
      exists: true,
      secure: options.secret ? ownerOnly(metadata.mode) && ownedByCurrentUser : true,
      ownedByCurrentUser,
      mode: metadata.mode & 0o777,
    };
  } catch {
    return { exists: false, secure: false, ownedByCurrentUser: false, mode: null };
  }
}

function validateSecret(name, value, minimumLength) {
  const normalized = String(value ?? '');
  if (normalized.length < minimumLength) return `${name} fehlt oder ist kürzer als ${minimumLength} Zeichen.`;
  if (/^(password|change-me|secret|example|test)$/i.test(normalized)) {
    return `${name} verwendet einen unsicheren Platzhalter.`;
  }
  return null;
}

function validateLocalUrl(name, value, allowRemote) {
  try {
    const url = new URL(String(value));
    if (!['http:', 'https:', 'ws:', 'wss:'].includes(url.protocol)) {
      return `${name} verwendet ein nicht unterstütztes Protokoll.`;
    }
    if (!allowRemote && !isLoopback(url.hostname))
      return `${name} muss ohne ALLOW_REMOTE_BIND=true auf Loopback zeigen.`;
    return null;
  } catch {
    return `${name} ist keine gültige URL.`;
  }
}

async function checkDatabase(url, attempts, delayMs) {
  const pg = await import('pg');
  const Client = pg.Client ?? pg.default?.Client;
  if (!Client) throw new Error('PostgreSQL-Client konnte nicht geladen werden.');
  let lastError = null;
  for (let attempt = 1; attempt <= attempts; attempt += 1) {
    const client = new Client({ connectionString: url, connectionTimeoutMillis: 3000 });
    try {
      await client.connect();
      await client.query('select 1 as ok');
      await client.end();
      return;
    } catch (error) {
      lastError = error;
      await client.end().catch(() => undefined);
      if (attempt < attempts) await new Promise((resolveDelay) => setTimeout(resolveDelay, delayMs));
    }
  }
  throw lastError ?? new Error('PostgreSQL-Vorabprüfung wurde ohne Ergebnis beendet.');
}

async function readJson(path) {
  try {
    return JSON.parse(await readFile(path, 'utf8'));
  } catch {
    return null;
  }
}

function normalizeScope(value) {
  const scope = String(value ?? 'all');
  if (!VALID_SCOPES.has(scope)) throw new Error(`Unbekannter Preflight-Bereich: ${scope}`);
  return scope;
}

export async function runStudioPreflight(options = {}) {
  const env = options.env ?? process.env;
  const root = resolve(options.root ?? process.cwd());
  const home = options.homeDir ?? homedir();
  const scope = normalizeScope(options.scope);
  const checkDatabaseConnection = options.checkDatabase ?? true;
  const databaseChecker = options.databaseChecker ?? checkDatabase;
  const checks = [];
  const add = (id, status, message, detail) => checks.push({ id, status, message, ...(detail ? { detail } : {}) });
  const includesApi = scope === 'all' || scope === 'api';
  const includesObs = scope === 'all' || scope === 'obs';
  const includesConfiguration = scope === 'all' || scope === 'api' || scope === 'obs' || scope === 'configuration';

  const nodeMajor = Number(process.versions.node.split('.')[0]);
  add(
    'node-version',
    nodeMajor >= 22 ? 'ok' : 'error',
    nodeMajor >= 22 ? `Node.js ${process.versions.node} ist unterstützt.` : 'Node.js 22 oder neuer ist erforderlich.',
  );

  if (includesConfiguration) {
    const envPath = resolve(root, '.env');
    const envFile = await inspectFile(envPath, { secret: true });
    add(
      'env-file',
      envFile.exists && envFile.secure ? 'ok' : 'error',
      !envFile.exists
        ? '.env fehlt.'
        : envFile.secure
          ? '.env besitzt restriktive Dateirechte und gehört dem Dienstbenutzer.'
          : '.env besitzt unsichere Rechte oder gehört einem anderen Benutzer.',
      envFile.exists ? `mode=${envFile.mode?.toString(8)}` : undefined,
    );

    for (const [name, minimum] of [
      ['SESSION_SECRET', 32],
      ['ENCRYPTION_KEY', 32],
      ['DESKTOP_AGENT_TOKEN', 32],
      ['OBS_PASSWORD', 16],
    ]) {
      const error = validateSecret(name, env[name], minimum);
      add(`secret-${name.toLowerCase()}`, error ? 'error' : 'ok', error ?? `${name} ist gesetzt.`);
    }

    const allowRemote = env.ALLOW_REMOTE_BIND === 'true';
    for (const [id, name, host] of [
      ['app-bind', 'APP_HOST', String(env.APP_HOST ?? '127.0.0.1')],
      ['desktop-agent-bind', 'DESKTOP_AGENT_HOST', String(env.DESKTOP_AGENT_HOST ?? '127.0.0.1')],
      ['obs-bind', 'OBS_HOST', String(env.OBS_HOST ?? '127.0.0.1')],
    ]) {
      const accepted = allowRemote || isLoopback(host);
      add(
        id,
        accepted ? 'ok' : 'error',
        accepted ? `${name}=${host} ist zulässig.` : `${name} darf ohne ALLOW_REMOTE_BIND=true nur Loopback verwenden.`,
      );
    }
    const agentError = validateLocalUrl(
      'DESKTOP_AGENT_URL',
      env.DESKTOP_AGENT_URL ?? 'http://127.0.0.1:12090',
      allowRemote,
    );
    add('desktop-agent-url', agentError ? 'error' : 'ok', agentError ?? 'Desktop-Agent-URL ist zulässig.');
  }

  if (includesApi) {
    let databaseUrl;
    try {
      databaseUrl = new URL(String(env.DATABASE_URL ?? ''));
      if (!['postgres:', 'postgresql:'].includes(databaseUrl.protocol)) throw new Error('protocol');
      add('database-url', 'ok', 'DATABASE_URL ist syntaktisch gültig.');
    } catch {
      add('database-url', 'error', 'DATABASE_URL fehlt oder ist ungültig.');
    }
    if (databaseUrl && checkDatabaseConnection) {
      try {
        await databaseChecker(
          databaseUrl.toString(),
          positiveInteger(env.PREFLIGHT_DATABASE_ATTEMPTS, 5, 1, 30),
          positiveInteger(env.PREFLIGHT_DATABASE_DELAY_MS, 1000, 100, 30_000),
        );
        add('database-connection', 'ok', 'PostgreSQL ist erreichbar und beantwortet Abfragen.');
      } catch (error) {
        add('database-connection', 'error', 'PostgreSQL ist nicht erreichbar.', safeErrorDetail(error));
      }
    }
  }

  if (includesObs) {
    const obsExecutable = String(env.OBS_EXECUTABLE ?? '/usr/bin/obs');
    const obsAvailable = await commandAvailable(obsExecutable);
    add(
      'obs-executable',
      obsAvailable ? 'ok' : 'error',
      obsAvailable ? `OBS ist verfügbar: ${obsExecutable}` : `OBS ist nicht ausführbar: ${obsExecutable}`,
    );

    const configBase = env.XDG_CONFIG_HOME ?? join(home, '.config');
    const obsConfigRoot = join(configBase, 'obs-studio');
    const profile = String(env.OBS_PROFILE_NAME ?? 'Automated News Studio').replace(/[^A-Za-z0-9_-]+/g, '_');
    const collection = String(env.OBS_SCENE_COLLECTION ?? 'Automated News Studio').replace(/[^A-Za-z0-9_-]+/g, '_');
    const profileDir = join(obsConfigRoot, 'basic', 'profiles', profile);
    const basicFile = await inspectFile(join(profileDir, 'basic.ini'), { secret: true });
    add(
      'obs-profile',
      basicFile.exists && basicFile.secure ? 'ok' : 'error',
      !basicFile.exists
        ? 'Das OBS-Profil fehlt.'
        : basicFile.secure
          ? 'Das OBS-Profil ist vorhanden und geschützt.'
          : 'Das OBS-Profil besitzt unsichere Rechte oder einen falschen Eigentümer.',
    );

    const servicePath = join(profileDir, 'service.json');
    const serviceFile = await inspectFile(servicePath, { secret: true });
    const service = serviceFile.exists ? await readJson(servicePath) : null;
    add(
      'obs-stream-service',
      serviceFile.exists && serviceFile.secure && service ? 'ok' : 'error',
      !serviceFile.exists
        ? 'Die OBS-Streamkonfiguration fehlt.'
        : !serviceFile.secure
          ? 'Die OBS-Streamkonfiguration besitzt unsichere Rechte oder einen falschen Eigentümer.'
          : service
            ? 'Die OBS-Streamkonfiguration ist lesbar und geschützt.'
            : 'Die OBS-Streamkonfiguration ist ungültig.',
    );
    if (service && env.STREAM_AUTO_START === 'true') {
      const configuredKey = String(service?.settings?.key || env.STREAM_KEY || '');
      add(
        'youtube-stream-key',
        configuredKey.length >= 8 ? 'ok' : 'error',
        configuredKey.length >= 8
          ? 'Ein YouTube-Streamschlüssel ist konfiguriert.'
          : 'STREAM_AUTO_START ist aktiv, aber kein YouTube-Streamschlüssel ist konfiguriert.',
      );
    }

    for (const managed of [
      { id: 'obs-global-config', label: 'globale OBS-Konfiguration', path: join(obsConfigRoot, 'global.ini') },
      { id: 'obs-user-config', label: 'OBS-Benutzerkonfiguration', path: join(obsConfigRoot, 'user.ini') },
      {
        id: 'obs-websocket-config',
        label: 'OBS-WebSocket-Konfiguration',
        path: join(obsConfigRoot, 'plugin_config', 'obs-websocket', 'config.json'),
        json: true,
      },
      {
        id: 'obs-scene-collection',
        label: 'OBS-Szenensammlung',
        path: join(obsConfigRoot, 'basic', 'scenes', `${collection}.json`),
        json: true,
      },
    ]) {
      const file = await inspectFile(managed.path, { secret: true });
      const parsed = file.exists && managed.json ? await readJson(managed.path) : true;
      const ok = file.exists && file.secure && Boolean(parsed);
      add(
        managed.id,
        ok ? 'ok' : 'error',
        !file.exists
          ? `Die ${managed.label} fehlt.`
          : !file.secure
            ? `Die ${managed.label} besitzt unsichere Rechte oder einen falschen Eigentümer.`
            : !parsed
              ? `Die ${managed.label} ist ungültig.`
              : `Die ${managed.label} ist vorhanden, lesbar und geschützt.`,
      );
    }

    const websocketConfig = await readJson(join(obsConfigRoot, 'plugin_config', 'obs-websocket', 'config.json'));
    const websocketAuthMatches = Boolean(
      websocketConfig &&
      websocketConfig.server_enabled === true &&
      websocketConfig.auth_required === true &&
      websocketConfig.server_password === env.OBS_PASSWORD &&
      Number(websocketConfig.server_port) === Number(env.OBS_PORT ?? 4455),
    );
    add(
      'obs-websocket-auth',
      websocketAuthMatches ? 'ok' : 'error',
      websocketAuthMatches
        ? 'OBS-WebSocket-Passwort und Port stimmen mit der Dienstkonfiguration überein.'
        : 'OBS-WebSocket-Passwort oder Port weicht von der Dienstkonfiguration ab. npm run obs:configure ausführen.',
    );

    const twitch = await inspectObsMultiRtmp(env, {
      homeDir: home,
      configRoot: configBase,
      pluginCandidates: options.pluginCandidates,
    });
    for (const check of twitch.checks) add(`twitch-${check.id}`, check.status, check.message);
  }

  if (scope === 'all') {
    const ffmpeg = await commandAvailable(String(env.FFMPEG_EXECUTABLE ?? 'ffmpeg'));
    add('ffmpeg', ffmpeg ? 'ok' : 'error', ffmpeg ? 'FFmpeg ist verfügbar.' : 'FFmpeg wurde nicht gefunden.');
    const ttsEngine = String(env.TTS_ENGINE ?? 'piper').toLowerCase();
    if (ttsEngine === 'espeak-ng' || ttsEngine === 'espeak') {
      const executable = String(env.ESPEAK_EXECUTABLE ?? '/usr/bin/espeak-ng');
      const available = await commandAvailable(executable);
      add(
        'tts-engine',
        available ? 'ok' : 'error',
        available ? 'eSpeak NG ist verfügbar.' : 'eSpeak NG wurde nicht gefunden.',
      );
    } else {
      const model = String(env.PIPER_MODEL_PATH ?? env.TTS_MODEL_PATH ?? '');
      const modelFile = model ? await inspectFile(model) : { exists: false };
      add(
        'tts-model',
        modelFile.exists ? 'ok' : 'error',
        modelFile.exists ? 'Das Piper-Modell ist verfügbar.' : 'Das Piper-Modell fehlt.',
      );
    }
  }

  const errors = checks.filter((check) => check.status === 'error');
  return {
    ok: errors.length === 0,
    scope,
    checkedAt: new Date().toISOString(),
    summary: {
      total: checks.length,
      passed: checks.filter((check) => check.status === 'ok').length,
      disabled: checks.filter((check) => check.status === 'disabled').length,
      errors: errors.length,
    },
    checks,
  };
}
