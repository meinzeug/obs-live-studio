const MANAGED_TARGET_ID = 'argumentationskette-twitch';
const TWITCH_KEY_PATTERN = /^[A-Za-z0-9_]{8,256}$/;

function asArray(value) {
  return Array.isArray(value) ? value : [];
}

export function resolveTwitchTarget(env = process.env) {
  const enabled = env.TWITCH_ENABLED === 'true';
  if (!enabled) return { enabled, target: null };

  const server = String(env.TWITCH_STREAM_SERVER ?? 'rtmps://live.twitch.tv:443/app').trim();
  let url;
  try {
    url = new URL(server);
  } catch {
    throw new Error('TWITCH_STREAM_SERVER ist keine gültige URL');
  }
  if (url.protocol !== 'rtmps:') {
    throw new Error('TWITCH_STREAM_SERVER muss verschlüsseltes rtmps:// verwenden');
  }
  if (url.username || url.password || url.search || url.hash || !url.pathname.replaceAll('/', '')) {
    throw new Error('TWITCH_STREAM_SERVER enthält unzulässige Bestandteile');
  }

  const key = String(env.TWITCH_STREAM_KEY ?? '').trim();
  if (!TWITCH_KEY_PATTERN.test(key)) {
    throw new Error('TWITCH_STREAM_KEY fehlt oder enthält unzulässige Zeichen');
  }

  return {
    enabled,
    target: {
      id: MANAGED_TARGET_ID,
      name: 'Twitch',
      protocol: 'RTMP',
      'sync-start': true,
      'sync-stop': true,
      'service-param': {
        server: url.toString().replace(/\/$/, ''),
        key,
        use_auth: false,
      },
      'output-param': {},
    },
  };
}

export function updateMultiRtmpConfig(existing, env = process.env) {
  const base = existing && typeof existing === 'object' && !Array.isArray(existing) ? existing : {};
  const { enabled, target } = resolveTwitchTarget(env);
  const targets = asArray(base.targets).filter((item) => item?.id !== MANAGED_TARGET_ID);
  if (enabled && target) targets.push(target);
  return {
    ...base,
    targets,
    video_configs: asArray(base.video_configs),
    audio_configs: asArray(base.audio_configs),
  };
}

export function publicTwitchStatus(env = process.env) {
  const { enabled, target } = resolveTwitchTarget(env);
  return {
    enabled,
    target: enabled
      ? {
          id: target.id,
          name: target.name,
          server: target['service-param'].server,
          syncStart: target['sync-start'],
          syncStop: target['sync-stop'],
          sharesMainEncoders: true,
        }
      : null,
  };
}

export { MANAGED_TARGET_ID };
