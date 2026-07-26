import { readFile } from 'node:fs/promises';
import { describe, expect, it } from 'vitest';
import { obsBrowserRenderProfile } from '@ans/obs-controller';

describe('OBS CPU browser render profile', () => {
  it('keeps a 1080p canvas while rendering browser sources at a CPU-safe 720p/15fps', () => {
    expect(obsBrowserRenderProfile({})).toEqual({ width: 1280, height: 720, fps: 15 });
  });

  it('accepts bounded operator overrides and uses the video frame rate as fallback', () => {
    expect(
      obsBrowserRenderProfile({
        OBS_BROWSER_RENDER_WIDTH: '1600',
        OBS_BROWSER_RENDER_HEIGHT: '900',
        VIDEO_FPS: '25',
      }),
    ).toEqual({ width: 1600, height: 900, fps: 25 });
    expect(
      obsBrowserRenderProfile({
        OBS_BROWSER_RENDER_WIDTH: '99999',
        OBS_BROWSER_RENDER_HEIGHT: '1',
        OBS_BROWSER_RENDER_FPS: '200',
      }),
    ).toEqual({ width: 1920, height: 360, fps: 60 });
  });

  it('writes non-standard CPU frame rates as an OBS integer profile', async () => {
    const configureObs = await readFile('scripts/configure-obs.mjs', 'utf8');
    expect(configureObs).toContain('FPSType=1');
    expect(configureObs).toContain('FPSInt=${videoFps}');
    expect(configureObs).not.toContain('FPSCommon=${process.env.VIDEO_FPS');
  });
});
