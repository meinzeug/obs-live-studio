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
});
