export type StreamingPlatformId =
  | 'youtube'
  | 'twitch'
  | 'x'
  | 'rumble'
  | 'kick'
  | 'facebook'
  | 'linkedin'
  | 'custom';

export interface StreamingPlatformDefinition {
  id: StreamingPlatformId;
  label: string;
  setupUrl: string | null;
  defaultServer: string | null;
  obsServiceName: string | null;
  serverProvidedByDashboard: boolean;
}

export interface StreamTarget {
  id: string;
  managedId: string;
  name: string;
  platform: StreamingPlatformId;
  server: string;
  key: string;
  channelUrl: string;
  enabled: boolean;
  configured: boolean;
  secure: boolean;
  syncStart: boolean;
  syncStop: boolean;
  obsServiceName: string | null;
}

export interface PublicStreamTarget extends Omit<StreamTarget, 'key'> {}

export interface StudioProfile {
  studioName: string;
  channelName: string;
  channelUrl: string;
  primary: PublicStreamTarget;
  additionalTargets: PublicStreamTarget[];
  multistream: boolean;
  supportedPlatforms: StreamingPlatformDefinition[];
}

export const STREAMING_PLATFORMS: StreamingPlatformDefinition[] = [
  {
    id: 'youtube',
    label: 'YouTube',
    setupUrl: 'https://studio.youtube.com/',
    defaultServer: 'rtmps://a.rtmps.youtube.com:443/live2',
    obsServiceName: 'YouTube - RTMPS',
    serverProvidedByDashboard: false,
  },
  {
    id: 'twitch',
    label: 'Twitch',
    setupUrl: 'https://dashboard.twitch.tv/settings/stream',
    defaultServer: 'rtmps://live.twitch.tv:443/app',
    obsServiceName: 'Twitch',
    serverProvidedByDashboard: false,
  },
  {
    id: 'x',
    label: 'X',
    setupUrl: 'https://studio.x.com/',
    defaultServer: null,
    obsServiceName: null,
    serverProvidedByDashboard: true,
  },
  {
    id: 'rumble',
    label: 'Rumble',
    setupUrl: 'https://rumble.com/account/livestreams',
    defaultServer: null,
    obsServiceName: null,
    serverProvidedByDashboard: true,
  },
  {
    id: 'kick',
    label: 'Kick',
    setupUrl: 'https://kick.com/dashboard/settings/stream',
    defaultServer: null,
    obsServiceName: null,
    serverProvidedByDashboard: true,
  },
  {
    id: 'facebook',
    label: 'Facebook Live',
    setupUrl: 'https://www.facebook.com/live/producer/',
    defaultServer: null,
    obsServiceName: null,
    serverProvidedByDashboard: true,
  },
  {
    id: 'linkedin',
    label: 'LinkedIn Live',
    setupUrl: 'https://www.linkedin.com/video/golive/now/',
    defaultServer: null,
    obsServiceName: null,
    serverProvidedByDashboard: true,
  },
  {
    id: 'custom',
    label: 'Benutzerdefiniertes RTMP-Ziel',
    setupUrl: null,
    defaultServer: null,
    obsServiceName: null,
    serverProvidedByDashboard: true,
  },
];

const PLATFORM_ALIASES: Record<string, StreamingPlatformId> = {
  youtube: 'youtube',
  yt: 'youtube',
  twitch: 'twitch',
  x: 'x',
  twitter: 'x',
  rumble: 'rumble',
  kick: 'kick',
  facebook: 'facebook',
  'facebook-live': 'facebook',
  linkedin: 'linkedin',
  'linkedin-live': 'linkedin',
  custom: 'custom',
  rtmp: 'custom',
};

function value(...values: unknown[]) {
  for (const candidate of values) {
    const normalized = String(candidate ?? '').trim();
    if (normalized) return normalized;
  }
  return '';
}

function booleanValue(input: unknown, fallback: boolean) {
  if (input === undefined || input === null || input === '') return fallback;
  return String(input).trim().toLowerCase() === 'true';
}

function safeId(input: string) {
  const normalized = input
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9_-]+/g, '-')
    .replace(/^-+|-+$/g, '')
    .slice(0, 48);
  if (!normalized) throw new Error('Streaming-Ziel benötigt eine gültige ID.');
  return normalized;
}

export function normalizePlatformId(input: unknown): StreamingPlatformId {
  const normalized = value(input).toLowerCase();
  return PLATFORM_ALIASES[normalized] ?? 'custom';
}

export function platformDefinition(input: unknown) {
  const id = normalizePlatformId(input);
  return STREAMING_PLATFORMS.find((platform) => platform.id === id)!;
}

function normalizeChannelUrl(input: unknown) {
  const raw = value(input);
  if (!raw) return '';
  const url = new URL(raw);
  if (!['http:', 'https:'].includes(url.protocol) || url.username || url.password) {
    throw new Error('Kanal-URL muss eine öffentliche HTTP- oder HTTPS-Adresse ohne Zugangsdaten sein.');
  }
  return url.toString();
}

export function normalizeStreamServer(input: unknown, options: { requireRtmps?: boolean } = {}) {
  const raw = value(input);
  if (!raw) return '';
  const url = new URL(raw);
  if (!['rtmp:', 'rtmps:'].includes(url.protocol)) {
    throw new Error('Streamserver muss rtmp:// oder rtmps:// verwenden.');
  }
  if (options.requireRtmps && url.protocol !== 'rtmps:') {
    throw new Error('Streamserver muss verschlüsseltes rtmps:// verwenden.');
  }
  if (url.username || url.password || url.search || url.hash || !url.hostname) {
    throw new Error('Streamserver enthält unzulässige Bestandteile.');
  }
  return url.toString().replace(/\/$/, '');
}

function normalizeStreamKey(input: unknown) {
  const key = value(input);
  if (!key) return '';
  if (key.length < 8 || key.length > 1024 || /[\r\n\0]/.test(key)) {
    throw new Error('Streamschlüssel fehlt oder besitzt ein unzulässiges Format.');
  }
  return key;
}

function inferLegacyPlatform(env: NodeJS.ProcessEnv) {
  const service = value(env.STREAM_PLATFORM, env.CHANNEL_PLATFORM, env.STREAM_SERVICE).toLowerCase();
  if (service.includes('twitch') && !service.includes('youtube')) return 'twitch';
  if (service.includes('youtube')) return 'youtube';
  const server = value(env.STREAM_SERVER).toLowerCase();
  if (server.includes('twitch')) return 'twitch';
  if (server.includes('youtube')) return 'youtube';
  return 'custom';
}

function channelUrlForPlatform(env: NodeJS.ProcessEnv, platform: StreamingPlatformId) {
  return value(
    env.CHANNEL_URL,
    platform === 'youtube' ? env.YOUTUBE_CHANNEL_URL : '',
    platform === 'twitch' ? env.TWITCH_CHANNEL_URL : '',
  );
}

function targetFromInput(
  input: Record<string, unknown>,
  env: NodeJS.ProcessEnv,
  options: { primary?: boolean; requireConfigured?: boolean } = {},
): StreamTarget {
  const platform = normalizePlatformId(input.platform);
  const definition = platformDefinition(platform);
  const id = options.primary ? 'primary' : safeId(value(input.id, platform));
  const server = normalizeStreamServer(value(input.server, definition.defaultServer), {
    requireRtmps: booleanValue(env.STREAM_REQUIRE_RTMPS, true),
  });
  const key = normalizeStreamKey(input.key);
  const enabled = booleanValue(input.enabled, options.primary ? true : true);
  const configured = Boolean(server && key);
  if (enabled && options.requireConfigured && !configured) {
    throw new Error(`${value(input.name, definition.label)} benötigt Streamserver und Streamschlüssel.`);
  }
  return {
    id,
    managedId: options.primary ? 'studio-primary' : `studio-target-${id}`,
    name: value(input.name, definition.label),
    platform,
    server,
    key,
    channelUrl: normalizeChannelUrl(input.channelUrl),
    enabled,
    configured,
    secure: server.startsWith('rtmps://'),
    syncStart: booleanValue(input.syncStart, true),
    syncStop: booleanValue(input.syncStop, true),
    obsServiceName: definition.obsServiceName,
  };
}

export function resolvePrimaryStreamTarget(
  env: NodeJS.ProcessEnv = process.env,
  options: { requireConfigured?: boolean } = {},
) {
  const platform = normalizePlatformId(value(env.STREAM_PLATFORM, env.CHANNEL_PLATFORM, inferLegacyPlatform(env)));
  return targetFromInput(
    {
      id: 'primary',
      name: value(env.STREAM_TARGET_NAME, platformDefinition(platform).label),
      platform,
      server: value(env.STREAM_SERVER, platformDefinition(platform).defaultServer),
      key: env.STREAM_KEY,
      channelUrl: channelUrlForPlatform(env, platform),
      enabled: true,
      syncStart: true,
      syncStop: true,
    },
    env,
    { primary: true, requireConfigured: options.requireConfigured },
  );
}

function resolveEnvironmentReference(input: Record<string, unknown>, directKey: string, envKey: string, env: NodeJS.ProcessEnv) {
  const reference = value(input[envKey]);
  return reference ? value(env[reference]) : value(input[directKey]);
}

function parseTargetDocument(raw: string) {
  if (!raw) return [];
  let parsed: unknown;
  try {
    parsed = JSON.parse(raw);
  } catch (error) {
    throw new Error(`STREAM_TARGETS_JSON ist ungültiges JSON: ${error instanceof Error ? error.message : String(error)}`);
  }
  if (!Array.isArray(parsed)) throw new Error('STREAM_TARGETS_JSON muss ein JSON-Array sein.');
  return parsed;
}

export function resolveAdditionalStreamTargets(
  env: NodeJS.ProcessEnv = process.env,
  options: { requireConfigured?: boolean; includeDisabled?: boolean } = {},
) {
  const documents = parseTargetDocument(value(env.STREAM_TARGETS_JSON));
  const targets: StreamTarget[] = [];
  const ids = new Set<string>();

  for (const raw of documents) {
    if (!raw || typeof raw !== 'object' || Array.isArray(raw)) {
      throw new Error('Jedes zusätzliche Streaming-Ziel muss ein JSON-Objekt sein.');
    }
    const input = raw as Record<string, unknown>;
    const platform = normalizePlatformId(input.platform);
    const target = targetFromInput(
      {
        ...input,
        id: value(input.id, platform),
        platform,
        server: resolveEnvironmentReference(input, 'server', 'serverEnv', env),
        key: resolveEnvironmentReference(input, 'key', 'keyEnv', env),
        channelUrl: resolveEnvironmentReference(input, 'channelUrl', 'channelUrlEnv', env),
      },
      env,
      { requireConfigured: options.requireConfigured },
    );
    if (ids.has(target.id)) throw new Error(`Doppelte Streaming-Ziel-ID: ${target.id}`);
    ids.add(target.id);
    if (target.enabled || options.includeDisabled) targets.push(target);
  }

  const primary = resolvePrimaryStreamTarget(env);
  const legacyTwitchEnabled = env.TWITCH_ENABLED === 'true' && primary.platform !== 'twitch';
  if (legacyTwitchEnabled && !ids.has('twitch')) {
    targets.push(
      targetFromInput(
        {
          id: 'twitch',
          name: 'Twitch',
          platform: 'twitch',
          server: value(env.TWITCH_STREAM_SERVER, platformDefinition('twitch').defaultServer),
          key: env.TWITCH_STREAM_KEY,
          channelUrl: env.TWITCH_CHANNEL_URL,
          enabled: true,
        },
        env,
        { requireConfigured: options.requireConfigured },
      ),
    );
  }

  return targets;
}

export function publicStreamTarget(target: StreamTarget): PublicStreamTarget {
  const { key: _key, ...publicTarget } = target;
  return publicTarget;
}

export function resolveStudioProfile(env: NodeJS.ProcessEnv = process.env): StudioProfile {
  const primary = resolvePrimaryStreamTarget(env);
  const additionalTargets = resolveAdditionalStreamTargets(env, { includeDisabled: true }).map(publicStreamTarget);
  const channelName = value(env.CHANNEL_NAME, 'Mein Kanal');
  return {
    studioName: value(env.STUDIO_NAME, `${channelName} TV Studio`),
    channelName,
    channelUrl: primary.channelUrl,
    primary: publicStreamTarget(primary),
    additionalTargets,
    multistream: additionalTargets.some((target) => target.enabled),
    supportedPlatforms: STREAMING_PLATFORMS.map((platform) => ({ ...platform })),
  };
}
