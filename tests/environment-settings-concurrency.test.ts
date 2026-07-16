import dotenv from 'dotenv';
import { describe, expect, it, vi } from 'vitest';
import { AiSettingsManager } from '../apps/api/src/ai-settings.js';
import { StreamTargetSettingsManager } from '../apps/api/src/stream-target-settings.js';

describe('shared environment settings lock', () => {
  it('does not lose AI changes while a stream configuration is being applied', async () => {
    let content = [
      'DATABASE_URL=postgresql://studio:test@localhost/studio',
      'STREAM_PLATFORM=youtube',
      'STREAM_TARGET_NAME=YouTube',
      'STREAM_SERVER=rtmps://a.rtmps.youtube.com:443/live2',
      'STREAM_KEY=youtube-secret-key',
      'CHANNEL_URL=https://youtube.example/channel',
      'STREAM_TARGETS_JSON=[]',
      '',
    ].join('\n');
    let releaseApply!: () => void;
    const applying = new Promise<void>((resolve) => {
      releaseApply = resolve;
    });
    const envFile = '/virtual/obs-live-studio-concurrent.env';
    const readEnvironmentFile = async () => content;
    const writeEnvironmentFile = async (next: string) => {
      content = next;
    };
    const streams = new StreamTargetSettingsManager({
      envFile,
      env: {},
      readEnvironmentFile,
      writeEnvironmentFile,
      applyConfiguration: () => applying,
    });
    const ai = new AiSettingsManager({
      envFile,
      env: {},
      readEnvironmentFile,
      writeEnvironmentFile,
      inspectKey: vi.fn(async () => ({
        label: 'Test',
        freeTier: false,
        limit: null,
        limitRemaining: null,
        usage: null,
        expiresAt: null,
      })),
    });

    const streamSave = streams.save({
      primary: {
        name: 'YouTube neu',
        platform: 'youtube',
        server: 'rtmps://a.rtmps.youtube.com:443/live2',
        channelUrl: 'https://youtube.example/channel',
        key: '',
      },
      additionalTargets: [],
    });
    await vi.waitFor(() => expect(dotenv.parse(content).STREAM_TARGET_NAME).toBe('YouTube neu'));
    const aiSave = ai.save({
      apiKey: 'sk-or-v1-concurrent-private-key-1234567890',
      paidFallback: true,
      autoProcessIngest: true,
      dataCollection: 'deny',
    });

    await Promise.resolve();
    expect(dotenv.parse(content).OPENROUTER_API_KEY).toBeUndefined();
    releaseApply();
    await Promise.all([streamSave, aiSave]);

    expect(dotenv.parse(content)).toMatchObject({
      STREAM_TARGET_NAME: 'YouTube neu',
      STREAM_KEY: 'youtube-secret-key',
      OPENROUTER_API_KEY: 'sk-or-v1-concurrent-private-key-1234567890',
      OPENROUTER_PAID_FALLBACK: 'true',
    });
  });
});
