import { describe, expect, it } from 'vitest';
import {
  resolveAdditionalStreamTargets,
  resolvePrimaryStreamTarget,
  resolveStudioProfile,
} from '../packages/streaming-platforms/index.mjs';
import {
  LEGACY_MANAGED_TARGET_ID,
  MANAGED_TARGET_PREFIX,
  publicMultistreamStatus,
  updateMultiRtmpConfig,
} from '../scripts/obs-multi-rtmp-config.mjs';

describe('streaming platform profiles', () => {
  it('creates a channel-neutral unconfigured profile for a fresh installation', () => {
    const profile = resolveStudioProfile({
      STUDIO_NAME: 'Meine Senderegie',
      CHANNEL_NAME: 'Kanal Nord',
      STREAM_PLATFORM: 'custom',
      STREAM_TARGET_NAME: 'Eigener Server',
      STREAM_TARGETS_JSON: '[]',
    });

    expect(profile.studioName).toBe('Meine Senderegie');
    expect(profile.channelName).toBe('Kanal Nord');
    expect(profile.primary).toMatchObject({
      platform: 'custom',
      name: 'Eigener Server',
      configured: false,
    });
    expect(profile.supportedPlatforms.map((platform) => platform.id)).toEqual(
      expect.arrayContaining(['youtube', 'twitch', 'x', 'rumble', 'kick', 'facebook', 'linkedin', 'custom']),
    );
  });

  it('uses convenient RTMPS defaults for YouTube and Twitch', () => {
    expect(
      resolvePrimaryStreamTarget({
        STREAM_PLATFORM: 'youtube',
        STREAM_KEY: 'youtube_key_123',
      }),
    ).toMatchObject({
      platform: 'youtube',
      server: 'rtmps://a.rtmps.youtube.com:443/live2',
      configured: true,
      secure: true,
    });
    expect(
      resolvePrimaryStreamTarget({
        STREAM_PLATFORM: 'twitch',
        STREAM_KEY: 'twitch_key_123',
      }),
    ).toMatchObject({
      platform: 'twitch',
      server: 'rtmps://live.twitch.tv:443/app',
      configured: true,
      secure: true,
    });
  });

  it('resolves arbitrary additional targets through environment references without exposing keys', () => {
    const secret = 'rumble_secret_123';
    const env = {
      STREAM_PLATFORM: 'youtube',
      STREAM_KEY: 'youtube_key_123',
      RUMBLE_SERVER: 'rtmps://example.rumble.invalid/live',
      RUMBLE_KEY: secret,
      RUMBLE_CHANNEL: 'https://rumble.com/c/example',
      X_SERVER: 'rtmps://example.x.invalid/live',
      X_KEY: 'x_secret_123',
      STREAM_TARGETS_JSON: JSON.stringify([
        {
          id: 'rumble',
          platform: 'rumble',
          serverEnv: 'RUMBLE_SERVER',
          keyEnv: 'RUMBLE_KEY',
          channelUrlEnv: 'RUMBLE_CHANNEL',
        },
        {
          id: 'x-live',
          platform: 'x',
          name: 'X Live',
          serverEnv: 'X_SERVER',
          keyEnv: 'X_KEY',
        },
      ]),
    };

    const targets = resolveAdditionalStreamTargets(env, { requireConfigured: true });
    expect(targets).toHaveLength(2);
    expect(targets[0]).toMatchObject({
      id: 'rumble',
      managedId: `${MANAGED_TARGET_PREFIX}rumble`,
      platform: 'rumble',
      key: secret,
      configured: true,
    });
    const publicStatus = JSON.stringify(publicMultistreamStatus(env));
    expect(publicStatus).toContain('Rumble');
    expect(publicStatus).toContain('X Live');
    expect(publicStatus).not.toContain(secret);
    expect(publicStatus).not.toContain('x_secret_123');
  });

  it('migrates the legacy Twitch variables and removes the old managed target', () => {
    const env = {
      STREAM_SERVER: 'rtmps://a.rtmps.youtube.com:443/live2',
      STREAM_KEY: 'youtube_key_123',
      STREAM_SERVICE: 'youtube',
      TWITCH_ENABLED: 'true',
      TWITCH_STREAM_SERVER: 'rtmps://live.twitch.tv:443/app',
      TWITCH_STREAM_KEY: 'twitch_key_123',
    };
    const config = updateMultiRtmpConfig(
      {
        targets: [
          { id: 'manual-target', name: 'Manuell' },
          { id: LEGACY_MANAGED_TARGET_ID, name: 'Alt' },
        ],
      },
      env,
    );

    expect(config.targets.map((target) => target.id)).toEqual(['manual-target', `${MANAGED_TARGET_PREFIX}twitch`]);
    expect(config.targets[1]['sync-start']).toBe(true);
    expect(config.targets[1]['sync-stop']).toBe(true);
    expect(config.targets[1]['video-config']).toBeUndefined();
    expect(config.targets[1]['audio-config']).toBeUndefined();
  });

  it('rejects duplicate target ids and insecure ingest unless explicitly allowed', () => {
    expect(() =>
      resolveAdditionalStreamTargets({
        STREAM_TARGETS_JSON: JSON.stringify([
          { id: 'same', platform: 'custom', server: 'rtmps://one.invalid/live', key: 'secret_one' },
          { id: 'same', platform: 'custom', server: 'rtmps://two.invalid/live', key: 'secret_two' },
        ]),
      }),
    ).toThrow(/Doppelte Streaming-Ziel-ID/);

    expect(() =>
      resolvePrimaryStreamTarget({
        STREAM_PLATFORM: 'custom',
        STREAM_SERVER: 'rtmp://insecure.invalid/live',
        STREAM_KEY: 'secret_123',
      }),
    ).toThrow(/rtmps:\/\//);

    expect(
      resolvePrimaryStreamTarget({
        STREAM_PLATFORM: 'custom',
        STREAM_SERVER: 'rtmp://insecure.invalid/live',
        STREAM_KEY: 'secret_123',
        STREAM_REQUIRE_RTMPS: 'false',
      }).secure,
    ).toBe(false);
  });
});
