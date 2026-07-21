import { readFile } from 'node:fs/promises';
import { describe, expect, it } from 'vitest';
import { aiHostOverlayDurationSeconds } from '../apps/api/src/ai-host-timing.js';

describe('AI host overlay timing', () => {
  it('honors the configured ten-second display duration', () => {
    expect(aiHostOverlayDurationSeconds(10)).toBe(10);
  });

  it('keeps invalid values inside the WebUI-supported range', () => {
    expect(aiHostOverlayDurationSeconds(Number.NaN)).toBe(24);
    expect(aiHostOverlayDurationSeconds(2)).toBe(8);
    expect(aiHostOverlayDurationSeconds(500)).toBe(120);
  });

  it('ducks OBS YouTube audio while Ava speech is playing', async () => {
    const api = await readFile('apps/api/src/index.ts', 'utf8');
    expect(api).toContain("app.post('/api/overlay/audio-duck'");
    expect(api).toContain('duck("start")');
    expect(api).toContain('duck("stop")');
    expect(api).toContain('AI_HOST_DUCK_YOUTUBE_VOLUME');
    expect(api).toContain('AI_HOST_YOUTUBE_NORMAL_VOLUME');
    expect(api).toContain('setAiAudioVolume(aiAudioNormalVolume)');
    expect(api).toContain('activeAiAudioDuckClients');
    expect(api).toContain('armAiAudioSafetyRelease');
    expect(api).toContain('clientId:audioClientId');
    expect(api.indexOf("await releaseAiAudioDucking(clientKey, 'stop')")).toBeLessThan(
      api.indexOf('await completeAiStaffTurnPlayback(input.turnId)'),
    );
  });

  it('holds the full-screen presenter until the paused YouTube player has received its resume command', async () => {
    const api = await readFile('apps/api/src/index.ts', 'utf8');
    expect(api).toContain('await duck("start")');
    expect(api).toContain('duck("stop").finally');
    expect(api).toContain('HOST_VIDEO_RESUME_LEAD_MS+HOST_TAKEOVER_EXIT_MS');
    expect(api.indexOf('await duck("start")')).toBeLessThan(api.indexOf('audio.play().catch'));
  });
});
