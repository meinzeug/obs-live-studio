import { describe, expect, it } from 'vitest';
import { runCompleteStudioPreflight } from '../scripts/complete-studio-preflight.mjs';

function baseReport(scope = 'all') {
  return {
    ok: false,
    scope,
    checkedAt: '2026-07-14T00:00:00.000Z',
    summary: { total: 2, passed: 1, disabled: 0, errors: 1 },
    checks: [
      { id: 'obs-program', status: 'ok', message: 'OBS ist vorhanden.' },
      { id: 'obs-stream-service', status: 'error', message: 'OBS-Streamserver fehlt.' },
    ],
  };
}

const ttsInspector = async () => ({
  ok: true,
  engine: 'piper',
  voice: 'de_DE-thorsten-high',
  model: null,
  checks: [],
});

describe('complete generic streaming preflight', () => {
  it('allows a fresh unconfigured studio while automatic streaming is disabled', async () => {
    const report = await runCompleteStudioPreflight({
      scope: 'all',
      env: { STREAM_AUTO_START: 'false' },
      basePreflight: async () => baseReport(),
      ttsInspector,
      streamingInspector: async () => ({
        ok: true,
        studio: { studioName: 'Open TV Studio', channelName: 'Mein Kanal' },
        primary: { platform: 'custom', name: 'Hauptziel', configured: false },
        additionalTargets: [],
        checks: [{ id: 'stream-primary', status: 'disabled', message: 'Hauptziel ist noch offen.' }],
      }),
    });

    expect(report.ok).toBe(true);
    expect(report.checks).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ id: 'obs-stream-service', status: 'disabled' }),
        expect.objectContaining({ id: 'stream-primary', status: 'disabled' }),
      ]),
    );
  });

  it('keeps the OBS service error when automatic streaming is enabled', async () => {
    const report = await runCompleteStudioPreflight({
      scope: 'all',
      env: { STREAM_AUTO_START: 'true' },
      basePreflight: async () => baseReport(),
      ttsInspector,
      streamingInspector: async () => ({
        ok: false,
        studio: { studioName: 'Open TV Studio', channelName: 'Mein Kanal' },
        primary: { platform: 'custom', name: 'Hauptziel', configured: false },
        additionalTargets: [],
        checks: [{ id: 'stream-primary', status: 'error', message: 'Hauptziel fehlt.' }],
      }),
    });

    expect(report.ok).toBe(false);
    expect(report.checks).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ id: 'obs-stream-service', status: 'error' }),
        expect.objectContaining({ id: 'stream-primary', status: 'error' }),
      ]),
    );
  });
});
