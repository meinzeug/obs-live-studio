import { describe, expect, it } from 'vitest';
import { inspectStreamingConfiguration } from '../scripts/streaming-runtime-status.mjs';

describe('streaming runtime status', () => {
  it('keeps a fresh unconfigured studio install valid while auto-start is disabled', () => {
    const report = inspectStreamingConfiguration({
      STUDIO_NAME: 'Open TV Studio',
      CHANNEL_NAME: 'Mein Kanal',
      STREAM_PLATFORM: 'custom',
      STREAM_TARGET_NAME: 'Hauptziel',
      STREAM_AUTO_START: 'false',
      STREAM_TARGETS_JSON: '[]',
    });

    expect(report.ok).toBe(true);
    expect(report.primary).toMatchObject({ platform: 'custom', configured: false });
    expect(report.checks).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ id: 'stream-primary', status: 'disabled' }),
        expect.objectContaining({ id: 'stream-additional-targets', status: 'disabled' }),
      ]),
    );
  });

  it('blocks automatic startup when the primary target is incomplete', () => {
    const report = inspectStreamingConfiguration({
      STREAM_PLATFORM: 'rumble',
      STREAM_TARGET_NAME: 'Rumble',
      STREAM_AUTO_START: 'true',
      STREAM_TARGETS_JSON: '[]',
    });

    expect(report.ok).toBe(false);
    expect(report.checks).toEqual(
      expect.arrayContaining([expect.objectContaining({ id: 'stream-primary', status: 'error' })]),
    );
  });

  it('reports malformed additional target JSON instead of throwing', () => {
    const report = inspectStreamingConfiguration({
      CHANNEL_NAME: 'Fehlerkanal',
      STREAM_PLATFORM: 'youtube',
      STREAM_KEY: 'youtube_key_123456',
      STREAM_TARGETS_JSON: '{not-json',
    });

    expect(report.ok).toBe(false);
    expect(report.studio.channelName).toBe('Fehlerkanal');
    expect(report.primary).toMatchObject({ platform: 'youtube', configured: true });
    expect(report.checks).toEqual(
      expect.arrayContaining([expect.objectContaining({ id: 'stream-additional-targets', status: 'error' })]),
    );
  });

  it('never includes configured stream keys in diagnostics', () => {
    const report = inspectStreamingConfiguration({
      STREAM_PLATFORM: 'youtube',
      STREAM_KEY: 'primary_secret_123',
      RUMBLE_SERVER: 'rtmps://rumble.example.invalid/live',
      RUMBLE_KEY: 'additional_secret_123',
      STREAM_TARGETS_JSON: JSON.stringify([
        { id: 'rumble', platform: 'rumble', serverEnv: 'RUMBLE_SERVER', keyEnv: 'RUMBLE_KEY' },
      ]),
    });
    const serialized = JSON.stringify(report);

    expect(report.ok).toBe(true);
    expect(serialized).not.toContain('primary_secret_123');
    expect(serialized).not.toContain('additional_secret_123');
  });
});
