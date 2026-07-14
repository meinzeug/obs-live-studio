import {
  STREAMING_PLATFORMS,
  publicStreamTarget,
  resolveAdditionalStreamTargets,
  resolvePrimaryStreamTarget,
  resolveStudioProfile,
} from '../packages/streaming-platforms/index.mjs';

function fallbackStudio(env, primary, additionalTargets) {
  const channelName = String(env.CHANNEL_NAME ?? 'Mein Kanal').trim() || 'Mein Kanal';
  return {
    studioName: String(env.STUDIO_NAME ?? `${channelName} TV Studio`).trim() || `${channelName} TV Studio`,
    channelName,
    channelUrl: primary?.channelUrl ?? '',
    primary: primary ? publicStreamTarget(primary) : null,
    additionalTargets: additionalTargets.map(publicStreamTarget),
    multistream: additionalTargets.some((target) => target.enabled),
    supportedPlatforms: STREAMING_PLATFORMS.map((platform) => ({ ...platform })),
  };
}

export function inspectStreamingConfiguration(env = process.env) {
  const checks = [];
  const add = (id, status, message) => checks.push({ id, status, message });
  let primary = null;
  let additionalTargets = [];

  try {
    primary = resolvePrimaryStreamTarget(env);
    const autoStart = env.STREAM_AUTO_START === 'true';
    if (primary.configured) {
      add('stream-primary', 'ok', `${primary.name} ist als Hauptziel konfiguriert.`);
    } else if (autoStart) {
      add(
        'stream-primary',
        'error',
        `STREAM_AUTO_START ist aktiv, aber ${primary.name} besitzt keinen vollständigen Server und Streamschlüssel.`,
      );
    } else {
      add(
        'stream-primary',
        'disabled',
        `${primary.name} ist noch nicht vollständig konfiguriert; der automatische Streamstart ist deaktiviert.`,
      );
    }
    if (primary.server) {
      add(
        'stream-primary-transport',
        primary.secure ? 'ok' : env.STREAM_REQUIRE_RTMPS === 'false' ? 'disabled' : 'error',
        primary.secure
          ? `${primary.name} verwendet verschlüsseltes RTMPS.`
          : env.STREAM_REQUIRE_RTMPS === 'false'
            ? `${primary.name} verwendet ausdrücklich erlaubtes unverschlüsseltes RTMP.`
            : `${primary.name} verwendet unverschlüsseltes RTMP.`,
      );
    }
  } catch (error) {
    add('stream-primary', 'error', error instanceof Error ? error.message : String(error));
  }

  try {
    additionalTargets = resolveAdditionalStreamTargets(env, { includeDisabled: true });
    const active = additionalTargets.filter((target) => target.enabled);
    add(
      'stream-additional-targets',
      active.length ? 'ok' : 'disabled',
      active.length
        ? `${active.length} zusätzliches Streaming-Ziel ist definiert.`
        : 'Keine zusätzlichen Streaming-Ziele sind aktiviert.',
    );
  } catch (error) {
    add('stream-additional-targets', 'error', error instanceof Error ? error.message : String(error));
  }

  let studio;
  try {
    studio = resolveStudioProfile(env);
  } catch {
    studio = fallbackStudio(env, primary, additionalTargets);
  }
  const errors = checks.filter((check) => check.status === 'error');
  return {
    ok: errors.length === 0,
    studio,
    primary: primary ? publicStreamTarget(primary) : null,
    additionalTargets: additionalTargets.map(publicStreamTarget),
    checks,
  };
}
