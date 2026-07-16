import { describe, expect, it } from 'vitest';
import { resolveMultipartLimits } from '../apps/api/src/multipart-limits.js';

describe('multipart limits', () => {
  it('allows the documented default video upload size', () => {
    expect(resolveMultipartLimits({})).toEqual({
      fileSize: 250 * 1024 * 1024,
      files: 1,
      fields: 20,
      parts: 21,
    });
  });

  it('uses the larger configured media limit', () => {
    expect(
      resolveMultipartLimits({
        MEDIA_MAX_IMAGE_BYTES: String(300 * 1024 * 1024),
        MEDIA_MAX_VIDEO_BYTES: String(200 * 1024 * 1024),
      }).fileSize,
    ).toBe(300 * 1024 * 1024);
  });

  it('falls back safely for invalid limits', () => {
    expect(
      resolveMultipartLimits({ MEDIA_MAX_IMAGE_BYTES: '-1', MEDIA_MAX_VIDEO_BYTES: 'not-a-number' }).fileSize,
    ).toBe(250 * 1024 * 1024);
  });
});
