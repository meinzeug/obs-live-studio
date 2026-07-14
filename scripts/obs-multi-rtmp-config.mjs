import {
  publicStreamTarget,
  resolveAdditionalStreamTargets,
} from '../packages/streaming-platforms/index.mjs';

export const MANAGED_TARGET_PREFIX = 'studio-target-';
export const LEGACY_MANAGED_TARGET_ID = 'argumentationskette-twitch';
export const MANAGED_TARGET_ID = `${MANAGED_TARGET_PREFIX}twitch`;

function asArray(value) {
  return Array.isArray(value) ? value : [];
}

function pluginTarget(target) {
  return {
    id: target.managedId,
    name: target.name,
    protocol: 'RTMP',
    'sync-start': target.syncStart,
    'sync-stop': target.syncStop,
    'service-param': {
      server: target.server,
      key: target.key,
      use_auth: false,
    },
    'output-param': {},
  };
}

export function resolveManagedTargets(env = process.env) {
  return resolveAdditionalStreamTargets(env, { requireConfigured: true }).map(pluginTarget);
}

export function updateMultiRtmpConfig(existing, env = process.env) {
  const base = existing && typeof existing === 'object' && !Array.isArray(existing) ? existing : {};
  const managedTargets = resolveManagedTargets(env);
  const targets = asArray(base.targets).filter(
    (item) =>
      typeof item?.id !== 'string' ||
      (!item.id.startsWith(MANAGED_TARGET_PREFIX) && item.id !== LEGACY_MANAGED_TARGET_ID),
  );
  targets.push(...managedTargets);
  return {
    ...base,
    targets,
    video_configs: asArray(base.video_configs),
    audio_configs: asArray(base.audio_configs),
  };
}

export function publicMultistreamStatus(env = process.env) {
  const targets = resolveAdditionalStreamTargets(env, { includeDisabled: true }).map(publicStreamTarget);
  return {
    enabled: targets.some((target) => target.enabled),
    configured: targets.filter((target) => target.enabled && target.configured).length,
    targets,
  };
}

export function resolveTwitchTarget(env = process.env) {
  const target = resolveAdditionalStreamTargets(env, { includeDisabled: true }).find(
    (candidate) => candidate.platform === 'twitch',
  );
  return {
    enabled: Boolean(target?.enabled),
    target: target?.enabled ? pluginTarget(target) : null,
  };
}

export function publicTwitchStatus(env = process.env) {
  const target = resolveAdditionalStreamTargets(env, { includeDisabled: true }).find(
    (candidate) => candidate.platform === 'twitch',
  );
  return {
    enabled: Boolean(target?.enabled),
    target: target?.enabled ? publicStreamTarget(target) : null,
  };
}
