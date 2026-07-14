import { describe, expect, it } from 'vitest';
import {
  MANAGED_TARGET_ID,
  publicTwitchStatus,
  resolveTwitchTarget,
  updateMultiRtmpConfig,
} from '../scripts/obs-multi-rtmp-config.mjs';

const enabledEnvironment = {
  TWITCH_ENABLED: 'true',
  TWITCH_STREAM_SERVER: 'rtmps://live.twitch.tv:443/app',
  TWITCH_STREAM_KEY: 'live_123456789_example',
};

describe('obs-multi-rtmp Twitch configuration', () => {
  it('creates a synchronized Twitch target sharing the main OBS encoders', () => {
    const config = updateMultiRtmpConfig(null, enabledEnvironment);
    expect(config.targets).toHaveLength(1);
    expect(config.targets[0]).toEqual({
      id: MANAGED_TARGET_ID,
      name: 'Twitch',
      protocol: 'RTMP',
      'sync-start': true,
      'sync-stop': true,
      'service-param': {
        server: 'rtmps://live.twitch.tv:443/app',
        key: 'live_123456789_example',
        use_auth: false,
      },
      'output-param': {},
    });
    expect(config.targets[0]['video-config']).toBeUndefined();
    expect(config.targets[0]['audio-config']).toBeUndefined();
    expect(config.video_configs).toEqual([]);
    expect(config.audio_configs).toEqual([]);
  });

  it('preserves unrelated plugin targets while replacing the managed target', () => {
    const existing = {
      targets: [
        { id: 'other-target', name: 'Other' },
        { id: MANAGED_TARGET_ID, name: 'Old Twitch' },
      ],
      video_configs: [{ id: 'custom-video' }],
      audio_configs: [{ id: 'custom-audio' }],
      custom_field: true,
    };
    const config = updateMultiRtmpConfig(existing, enabledEnvironment);
    expect(config.targets.map((target) => target.id)).toEqual(['other-target', MANAGED_TARGET_ID]);
    expect(config.video_configs).toEqual([{ id: 'custom-video' }]);
    expect(config.audio_configs).toEqual([{ id: 'custom-audio' }]);
    expect(config.custom_field).toBe(true);
  });

  it('removes only the managed Twitch target when disabled', () => {
    const config = updateMultiRtmpConfig(
      {
        targets: [
          { id: 'other-target', name: 'Other' },
          { id: MANAGED_TARGET_ID, name: 'Twitch' },
        ],
      },
      { TWITCH_ENABLED: 'false' },
    );
    expect(config.targets).toEqual([{ id: 'other-target', name: 'Other' }]);
  });

  it('requires encrypted Twitch ingest', () => {
    expect(() =>
      resolveTwitchTarget({
        ...enabledEnvironment,
        TWITCH_STREAM_SERVER: 'rtmp://live.twitch.tv/app',
      }),
    ).toThrow(/rtmps:\/\//);
  });

  it('rejects malformed stream keys', () => {
    expect(() =>
      resolveTwitchTarget({
        ...enabledEnvironment,
        TWITCH_STREAM_KEY: 'bad key;injected',
      }),
    ).toThrow(/unzulässige Zeichen/);
  });

  it('never exposes the Twitch stream key in public status', () => {
    const status = JSON.stringify(publicTwitchStatus(enabledEnvironment));
    expect(status).toContain('Twitch');
    expect(status).toContain('sharesMainEncoders');
    expect(status).not.toContain(enabledEnvironment.TWITCH_STREAM_KEY);
  });
});
