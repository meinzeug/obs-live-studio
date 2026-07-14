const STREAM_KEY_PATTERN = /^[A-Za-z0-9_-]{8,256}$/;
const RELAY_KEY_PATTERN = /^[A-Za-z0-9_-]{3,128}$/;
const APP_PATTERN = /^[A-Za-z0-9_-]+$/;
const LOOPBACK_HOSTS = new Set(['127.0.0.1', 'localhost']);

function enabled(value, fallback = false) {
  if (value == null || value === '') return fallback;
  return value === 'true';
}

function integer(value, fallback, minimum, maximum) {
  const source = value == null || value === '' ? fallback : value;
  const parsed = Number(source);
  if (!Number.isInteger(parsed) || parsed < minimum || parsed > maximum) {
    throw new Error(`Ungültiger Zahlenwert: ${source}`);
  }
  return parsed;
}

function streamKey(name, value) {
  const normalized = String(value ?? '').trim();
  if (!STREAM_KEY_PATTERN.test(normalized)) {
    throw new Error(`${name} fehlt oder enthält unzulässige Zeichen`);
  }
  return normalized;
}

function relayKey(value) {
  const normalized = String(value ?? 'studio').trim();
  if (!RELAY_KEY_PATTERN.test(normalized)) throw new Error('MULTISTREAM_RELAY_KEY ist ungültig');
  return normalized;
}

export function parseRtmpsTarget(id, name, rawUrl, key, localPort) {
  let url;
  try {
    url = new URL(rawUrl);
  } catch {
    throw new Error(`${name}: ungültige RTMPS-Adresse`);
  }
  if (url.protocol !== 'rtmps:') throw new Error(`${name}: nur verschlüsselte rtmps://-Ziele sind erlaubt`);
  if (url.username || url.password || url.search || url.hash) {
    throw new Error(`${name}: Zugangsdaten, Query und Fragment gehören nicht in die Serveradresse`);
  }
  const applicationPath = url.pathname.replace(/\/+$/, '');
  if (!applicationPath || applicationPath === '/') throw new Error(`${name}: der RTMPS-Anwendungspfad fehlt`);
  return {
    id,
    name,
    remoteHost: url.hostname,
    remotePort: Number(url.port || 443),
    applicationPath,
    streamKey: streamKey(`${id.toUpperCase()}_STREAM_KEY`, key),
    localPort,
  };
}

export function resolveStreamRelayConfig(env = process.env) {
  const relayUrl = new URL(env.MULTISTREAM_RELAY_SERVER ?? 'rtmp://127.0.0.1:19350/live');
  if (relayUrl.protocol !== 'rtmp:') throw new Error('MULTISTREAM_RELAY_SERVER muss mit rtmp:// beginnen');
  if (relayUrl.username || relayUrl.password || relayUrl.search || relayUrl.hash) {
    throw new Error('MULTISTREAM_RELAY_SERVER darf keine Zugangsdaten, Query oder Fragmente enthalten');
  }
  if (!LOOPBACK_HOSTS.has(relayUrl.hostname)) {
    throw new Error('MULTISTREAM_RELAY_SERVER muss an 127.0.0.1 oder localhost gebunden sein');
  }
  const application = relayUrl.pathname.replace(/^\/+|\/+$/g, '');
  if (!APP_PATTERN.test(application)) throw new Error('Der lokale Relay-Anwendungsname ist ungültig');
  const config = {
    enabled: enabled(env.MULTISTREAM_ENABLED),
    relayHost: '127.0.0.1',
    relayPort: integer(relayUrl.port, 19350, 1024, 65535),
    relayApplication: application,
    relayKey: relayKey(env.MULTISTREAM_RELAY_KEY),
    healthHost: '127.0.0.1',
    healthPort: integer(env.MULTISTREAM_RELAY_HEALTH_PORT, 12091, 1024, 65535),
    tunnelBasePort: integer(env.MULTISTREAM_TUNNEL_BASE_PORT, 19351, 1024, 65530),
    targets: [],
  };
  if (config.relayPort === config.healthPort || config.relayPort === config.tunnelBasePort) {
    throw new Error('Relay-, Health- und Tunnel-Ports müssen unterschiedlich sein');
  }
  if (!config.enabled) return config;

  let nextPort = config.tunnelBasePort;
  if (enabled(env.YOUTUBE_ENABLED, true)) {
    config.targets.push(
      parseRtmpsTarget(
        'youtube',
        'YouTube',
        env.STREAM_SERVER ?? 'rtmps://a.rtmps.youtube.com:443/live2',
        env.STREAM_KEY,
        nextPort++,
      ),
    );
  }
  if (enabled(env.TWITCH_ENABLED)) {
    config.targets.push(
      parseRtmpsTarget(
        'twitch',
        'Twitch',
        env.TWITCH_STREAM_SERVER ?? 'rtmps://live.twitch.tv:443/app',
        env.TWITCH_STREAM_KEY,
        nextPort++,
      ),
    );
  }
  if (!config.targets.length) throw new Error('Für den Multistream-Relay ist kein Ziel aktiviert');
  if (config.targets.some((target) => target.localPort === config.healthPort || target.localPort === config.relayPort)) {
    throw new Error('Ein lokaler Tunnel-Port kollidiert mit dem Relay- oder Health-Port');
  }
  return config;
}

function nginxQuote(value) {
  return `"${String(value).replaceAll('\\', '\\\\').replaceAll('"', '\\"')}"`;
}

export function renderNginxConfig(config, options) {
  if (!config.enabled) throw new Error('Der Relay ist deaktiviert');
  const pushes = config.targets
    .map(
      (target) =>
        `      push rtmp://127.0.0.1:${target.localPort}${target.applicationPath}/${target.streamKey};`,
    )
    .join('\n');
  return `load_module ${nginxQuote(options.rtmpModulePath)};
worker_processes 1;
pid ${nginxQuote(options.pidPath)};
error_log ${nginxQuote(options.errorLogPath)} info;

events {
  worker_connections 1024;
}

rtmp {
  server {
    listen ${config.relayHost}:${config.relayPort};
    chunk_size 4096;
    ping 30s;
    ping_timeout 10s;

    application ${config.relayApplication} {
      live on;
      record off;
      idle_streams off;
      drop_idle_publisher 15s;
      push_reconnect 1s;
      allow publish 127.0.0.1;
      deny publish all;
      allow play 127.0.0.1;
      deny play all;
${pushes}
    }
  }
}

http {
  access_log off;
  server {
    listen ${config.healthHost}:${config.healthPort};
    location = /health {
      default_type application/json;
      return 200 '{"ok":true,"service":"stream-relay"}\n';
    }
    location = /stat {
      rtmp_stat all;
      default_type application/xml;
    }
  }
}
`;
}

export function renderStunnelConfig(config, options) {
  if (!config.enabled) throw new Error('Der Relay ist deaktiviert');
  const services = config.targets
    .map(
      (target) => `[${target.id}]
client = yes
accept = 127.0.0.1:${target.localPort}
connect = ${target.remoteHost}:${target.remotePort}
sni = ${target.remoteHost}
checkHost = ${target.remoteHost}
TIMEOUTclose = 0
`,
    )
    .join('\n');
  return `foreground = yes
pid =
debug = notice
output = ${options.logPath}
CAfile = ${options.caFile}
verifyChain = yes
socket = l:TCP_NODELAY=1
socket = r:TCP_NODELAY=1

${services}`;
}

export function publicRelayStatus(config) {
  return {
    enabled: config.enabled,
    input: config.enabled
      ? `rtmp://${config.relayHost}:${config.relayPort}/${config.relayApplication}/${config.relayKey}`
      : null,
    healthUrl: config.enabled ? `http://${config.healthHost}:${config.healthPort}/health` : null,
    targets: config.targets.map((target) => ({
      id: target.id,
      name: target.name,
      host: target.remoteHost,
      port: target.remotePort,
      encrypted: true,
    })),
  };
}

export function validateModulePath(path) {
  if (!path || /[\r\n;]/.test(path)) throw new Error('Ungültiger Pfad zum nginx-rtmp-Modul');
  return path;
}
