import { constants } from 'node:fs';
import { access } from 'node:fs/promises';
import { homedir } from 'node:os';
import { join } from 'node:path';

export const STREAMING_PROVIDERS = ['youtube', 'twitch'];

const defaults = {
  youtube: {
    channelName: 'ArgumentationsKette',
    server: 'rtmps://a.rtmps.youtube.com:443/live2',
  },
  twitch: {
    channelName: 'ArgumentationsKette',
    server: 'rtmp://live.twitch.tv/app',
  },
};

function firstNonEmpty(...values) {
  for (const value of values) {
    if (typeof value === 'string' && value.trim()) return value.trim();
  }
  return '';
}

export function envBoolean(value, fallback = false) {
  if (value == null || value === '') return fallback;
  return ['1', 'true', 'yes', 'on'].includes(String(value).trim().toLowerCase());
}

export function resolveStreamingTargets(env = process.env) {
  const legacyService = String(env.STREAM_SERVICE ?? 'youtube').trim().toLowerCase();
  const youtubeEnabled = envBoolean(env.YOUTUBE_STREAM_ENABLED, legacyService !== 'twitch');
  const twitchEnabled = envBoolean(env.TWITCH_STREAM_ENABLED, legacyService === 'twitch');

  const targets = [
    {
      provider: 'youtube',
      enabled: youtubeEnabled,
      channelName: firstNonEmpty(env.YOUTUBE_CHANNEL_NAME, env.CHANNEL_NAME, defaults.youtube.channelName),
      channelUrl: firstNonEmpty(env.YOUTUBE_CHANNEL_URL),
      server: firstNonEmpty(env.YOUTUBE_STREAM_SERVER, env.STREAM_SERVER, defaults.youtube.server),
      key: firstNonEmpty(env.YOUTUBE_STREAM_KEY, env.STREAM_KEY),
    },
    {
      provider: 'twitch',
      enabled: twitchEnabled,
      channelName: firstNonEmpty(env.TWITCH_CHANNEL_NAME, env.CHANNEL_NAME, defaults.twitch.channelName),
      channelUrl: firstNonEmpty(env.TWITCH_CHANNEL_URL),
      server: firstNonEmpty(env.TWITCH_STREAM_SERVER, defaults.twitch.server),
      key: firstNonEmpty(env.TWITCH_STREAM_KEY),
    },
  ].map((target) => ({
    ...target,
    configured: Boolean(target.server && target.key),
  }));

  const requestedPrimary = String(env.STREAM_PRIMARY_PROVIDER ?? legacyService ?? 'youtube').trim().toLowerCase();
  const requested = STREAMING_PROVIDERS.includes(requestedPrimary) ? requestedPrimary : 'youtube';
  const primary = targets.find((target) => target.provider === requested && target.enabled) ?? targets.find((target) => target.enabled);

  if (!primary) throw new Error('Mindestens ein Streamingziel muss aktiviert sein.');

  return {
    primaryProvider: primary.provider,
    targets: targets.map((target) => ({ ...target, primary: target.provider === primary.provider })),
  };
}

export function validateStreamingTargets(configuration) {
  const primary = configuration.targets.find((target) => target.primary);
  if (!primary) throw new Error('Kein primäres Streamingziel konfiguriert.');
  if (!primary.server) throw new Error(`Für ${primary.provider} fehlt der Streamingserver.`);
  if (primary.provider !== 'youtube' && !primary.key) {
    throw new Error(`Für das primäre Streamingziel ${primary.provider} fehlt der Streamschlüssel.`);
  }

  const invalidSecondary = configuration.targets.find(
    (target) => target.enabled && !target.primary && (!target.server || !target.key),
  );
  if (invalidSecondary) {
    throw new Error(`Für das zusätzliche Streamingziel ${invalidSecondary.provider} fehlen Server oder Streamschlüssel.`);
  }
  return configuration;
}

export function buildObsMainService(target) {
  const service = target.provider === 'youtube' ? 'YouTube - RTMPS' : target.provider === 'twitch' ? 'Twitch' : 'Custom';
  return {
    type: 'rtmp_common',
    settings: {
      service,
      server: target.server,
      key: target.key,
      bwtest: false,
      use_auth: false,
    },
  };
}

export function buildManagedMultiRtmpTarget(target) {
  if (!target.enabled || target.primary) return null;
  return {
    id: `ans-${target.provider}`,
    name: target.provider === 'youtube' ? 'YouTube' : 'Twitch',
    protocol: 'RTMP',
    'service-param': {
      server: target.server,
      key: target.key,
      use_auth: false,
    },
    'output-param': {},
    'sync-start': true,
    'sync-stop': true,
  };
}

export function mergeMultiRtmpConfig(existing, managedTargets) {
  const safeExisting = existing && typeof existing === 'object' ? existing : {};
  const existingTargets = Array.isArray(safeExisting.targets) ? safeExisting.targets : [];
  const unmanagedTargets = existingTargets.filter(
    (target) => typeof target?.id !== 'string' || !target.id.startsWith('ans-'),
  );
  return {
    ...safeExisting,
    targets: [...unmanagedTargets, ...managedTargets.filter(Boolean)],
    video_configs: Array.isArray(safeExisting.video_configs) ? safeExisting.video_configs : [],
    audio_configs: Array.isArray(safeExisting.audio_configs) ? safeExisting.audio_configs : [],
  };
}

export function publicStreamingTargets(configuration) {
  return configuration.targets.map(({ key: _key, ...target }) => ({
    ...target,
    configured: target.primary && target.provider === 'youtube' ? Boolean(target.server) : target.configured,
  }));
}

export function obsMultiRtmpPluginCandidates(env = process.env) {
  const configRoot = env.XDG_CONFIG_HOME ?? join(homedir(), '.config');
  return [
    env.OBS_MULTI_RTMP_PLUGIN_PATH,
    join(configRoot, 'obs-studio', 'plugins', 'obs-multi-rtmp', 'bin', '64bit', 'obs-multi-rtmp.so'),
    '/usr/lib/obs-plugins/obs-multi-rtmp.so',
    '/usr/lib/x86_64-linux-gnu/obs-plugins/obs-multi-rtmp.so',
    '/usr/local/lib/obs-plugins/obs-multi-rtmp.so',
  ].filter(Boolean);
}

export async function findObsMultiRtmpPlugin(env = process.env) {
  for (const candidate of obsMultiRtmpPluginCandidates(env)) {
    try {
      await access(candidate, constants.R_OK);
      return candidate;
    } catch {}
  }
  return null;
}
