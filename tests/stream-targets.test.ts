import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import { describe, expect, it } from 'vitest';

const execFileAsync = promisify(execFile);
const moduleUrl = new URL('../scripts/stream-targets.mjs', import.meta.url).href;

async function evaluate(expression: string, env: Record<string, string> = {}) {
  const source = `
    const m = await import(${JSON.stringify(moduleUrl)});
    const value = ${expression};
    console.log(JSON.stringify(value));
  `;
  const { stdout } = await execFileAsync(process.execPath, ['--input-type=module', '--eval', source], {
    env: { ...process.env, ...env },
  });
  return JSON.parse(stdout.trim());
}

describe('streaming target configuration', () => {
  it('keeps the legacy YouTube configuration compatible', async () => {
    const result = await evaluate(
      `m.resolveStreamingTargets({ STREAM_SERVICE: 'youtube', STREAM_SERVER: 'rtmps://youtube.invalid/live', STREAM_KEY: 'yt-key', CHANNEL_NAME: 'Studio' })`,
    );

    expect(result.primaryProvider).toBe('youtube');
    expect(result.targets).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          provider: 'youtube',
          enabled: true,
          primary: true,
          server: 'rtmps://youtube.invalid/live',
          key: 'yt-key',
        }),
        expect.objectContaining({ provider: 'twitch', enabled: false }),
      ]),
    );
  });

  it('configures Twitch as a synchronized secondary output', async () => {
    const result = await evaluate(`(() => {
      const config = m.validateStreamingTargets(m.resolveStreamingTargets({
        STREAM_PRIMARY_PROVIDER: 'youtube',
        YOUTUBE_STREAM_ENABLED: 'true',
        YOUTUBE_STREAM_SERVER: 'rtmps://youtube.invalid/live',
        TWITCH_STREAM_ENABLED: 'true',
        TWITCH_STREAM_SERVER: 'rtmp://twitch.invalid/app',
        TWITCH_STREAM_KEY: 'tw-key'
      }));
      return {
        config,
        target: m.buildManagedMultiRtmpTarget(config.targets.find((target) => target.provider === 'twitch'))
      };
    })()`);

    expect(result.config.primaryProvider).toBe('youtube');
    expect(result.target).toMatchObject({
      id: 'ans-twitch',
      protocol: 'RTMP',
      'sync-start': true,
      'sync-stop': true,
      'service-param': { server: 'rtmp://twitch.invalid/app', key: 'tw-key', use_auth: false },
    });
  });

  it('rejects an enabled secondary target without a stream key', async () => {
    const result = await evaluate(`(() => {
      try {
        m.validateStreamingTargets(m.resolveStreamingTargets({
          YOUTUBE_STREAM_ENABLED: 'true',
          TWITCH_STREAM_ENABLED: 'true',
          TWITCH_STREAM_SERVER: 'rtmp://twitch.invalid/app'
        }));
        return { ok: true };
      } catch (error) {
        return { ok: false, message: error.message };
      }
    })()`);

    expect(result.ok).toBe(false);
    expect(result.message).toContain('twitch');
  });

  it('preserves unmanaged multi-RTMP targets while replacing managed targets', async () => {
    const result = await evaluate(`m.mergeMultiRtmpConfig(
      {
        targets: [
          { id: 'manual-target', name: 'Manual' },
          { id: 'ans-twitch', name: 'Old Twitch' }
        ],
        video_configs: [{ id: 'video-1' }],
        audio_configs: []
      },
      [{ id: 'ans-twitch', name: 'Twitch', 'sync-start': true, 'sync-stop': true }]
    )`);

    expect(result.targets).toEqual([
      expect.objectContaining({ id: 'manual-target' }),
      expect.objectContaining({ id: 'ans-twitch', name: 'Twitch' }),
    ]);
    expect(result.video_configs).toEqual([{ id: 'video-1' }]);
  });

  it('never exposes stream keys through the public target model', async () => {
    const result = await evaluate(`m.publicStreamingTargets(m.resolveStreamingTargets({
      YOUTUBE_STREAM_ENABLED: 'true',
      YOUTUBE_STREAM_KEY: 'youtube-secret',
      TWITCH_STREAM_ENABLED: 'true',
      TWITCH_STREAM_KEY: 'twitch-secret'
    }))`);

    expect(JSON.stringify(result)).not.toContain('youtube-secret');
    expect(JSON.stringify(result)).not.toContain('twitch-secret');
    expect(result.every((target: Record<string, unknown>) => !('key' in target))).toBe(true);
  });
});
