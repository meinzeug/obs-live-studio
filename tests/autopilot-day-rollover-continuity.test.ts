import { readFile } from 'node:fs/promises';
import { describe, expect, it } from 'vitest';

describe('autopilot day rollover continuity', () => {
  it('keeps the local carrier instead of starting a single-presenter article fallback', async () => {
    const source = await readFile('apps/worker/src/autopilot.ts', 'utf8');
    expect(source).not.toContain('createAndStartCurrentDayNewsContinuity');
    expect(source).toContain('codex-continuity-distinct-video');
    expect(source).toContain('complete-codex-six-agent-video-show-only');
    expect(source).toContain("continuity: 'local-station-signal'");
  });
});
