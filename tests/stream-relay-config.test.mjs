import { describe, expect, it } from 'vitest';
import {
  publicRelayStatus,
  renderNginxConfig,
  renderStunnelConfig,
  resolveStreamRelayConfig,
} from '../scripts/stream-relay-config.mjs';

describe('stream relay configuration', () => {
  it('keeps the relay disabled without requiring platform credentials', () => {
    const config = resolveStreamRelayConfig({ MULTISTREAM_ENABLED: 'false' });
    expect(config.enabled).toBe(false);
    expect(config.relayPort).toBe(19350);
    expect(config.targets).toEqual([]);
  });

  it('creates independent encrypted YouTube and Twitch targets', () => {
    const config = resolveStreamRelayConfig({
      MULTISTREAM_ENABLED: 'true',
      YOUTUBE_ENABLED: 'true',
      STREAM_SERVER: 'rtmps://a.rtmps.youtube.com:443/live2',
      STREAM_KEY: 'youtube_test_key_1234',
      TWITCH_ENABLED: 'true',
      TWITCH_STREAM_SERVER: 'rtmps://live.twitch.tv:443/app',
      TWITCH_STREAM_KEY: 'twitch_test_key_5678',
    });

    expect(config.targets.map((target) => target.id)).toEqual(['youtube', 'twitch']);
    expect(config.targets.map((target) => target.localPort)).toEqual([19351, 19352]);

    const nginx = renderNginxConfig(config, {
      rtmpModulePath: '/usr/lib/nginx/modules/ngx_rtmp_module.so',
      pidPath: '/tmp/stream-relay.pid',
      errorLogPath: '/tmp/stream-relay.log',
    });
    expect(nginx).toContain('push rtmp://127.0.0.1:19351/live2/youtube_test_key_1234;');
    expect(nginx).toContain('push rtmp://127.0.0.1:19352/app/twitch_test_key_5678;');
    expect(nginx).toContain('allow publish 127.0.0.1;');
    expect(nginx).toContain('deny publish all;');

    const stunnel = renderStunnelConfig(config, {
      logPath: '/tmp/stunnel.log',
      caFile: '/etc/ssl/certs/ca-certificates.crt',
    });
    expect(stunnel).toContain('connect = a.rtmps.youtube.com:443');
    expect(stunnel).toContain('connect = live.twitch.tv:443');
    expect(stunnel).not.toContain('youtube_test_key_1234');
    expect(stunnel).not.toContain('twitch_test_key_5678');

    const status = JSON.stringify(publicRelayStatus(config));
    expect(status).toContain('YouTube');
    expect(status).toContain('Twitch');
    expect(status).not.toContain('youtube_test_key_1234');
    expect(status).not.toContain('twitch_test_key_5678');
  });

  it('rejects unencrypted upstream targets', () => {
    expect(() =>
      resolveStreamRelayConfig({
        MULTISTREAM_ENABLED: 'true',
        YOUTUBE_ENABLED: 'true',
        STREAM_SERVER: 'rtmp://example.invalid/live',
        STREAM_KEY: 'youtube_test_key_1234',
      }),
    ).toThrow(/nur verschlüsselte rtmps:\/\//);
  });

  it('rejects keys that could inject relay configuration', () => {
    expect(() =>
      resolveStreamRelayConfig({
        MULTISTREAM_ENABLED: 'true',
        YOUTUBE_ENABLED: 'true',
        STREAM_SERVER: 'rtmps://a.rtmps.youtube.com:443/live2',
        STREAM_KEY: 'safe_key;push rtmp://attacker.invalid/live',
      }),
    ).toThrow(/unzulässige Zeichen/);
  });

  it('requires the local relay to stay on loopback', () => {
    expect(() =>
      resolveStreamRelayConfig({
        MULTISTREAM_ENABLED: 'false',
        MULTISTREAM_RELAY_SERVER: 'rtmp://0.0.0.0:19350/live',
      }),
    ).toThrow(/127\.0\.0\.1 oder localhost/);
  });
});
