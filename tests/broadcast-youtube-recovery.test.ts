import { describe, expect, it } from 'vitest';
import { youtubePlaybackWindow } from '@ans/broadcast-engine';

describe('YouTube broadcast item recovery', () => {
  const now = Date.parse('2026-07-21T03:30:00.000Z');

  it('uses the full duration for a newly planned item', () => {
    expect(youtubePlaybackWindow({ status: 'planned', started_at: null }, 935_000, now)).toEqual({
      startSeconds: 0,
      remainingDurationMs: 935_000,
    });
  });

  it('continues a running item at its elapsed playback position after a runner restart', () => {
    expect(youtubePlaybackWindow({ status: 'playing', started_at: '2026-07-21T03:20:00.000Z' }, 935_000, now)).toEqual({
      startSeconds: 600,
      remainingDurationMs: 335_000,
    });
  });

  it('also resumes an unfinished item left in a transient preparation state', () => {
    expect(
      youtubePlaybackWindow(
        { status: 'preparing', started_at: '2026-07-21T03:25:00.000Z', finished_at: null },
        935_000,
        now,
      ),
    ).toEqual({
      startSeconds: 300,
      remainingDurationMs: 635_000,
    });
  });

  it('finishes an overdue recovered item immediately instead of replaying it', () => {
    expect(youtubePlaybackWindow({ status: 'playing', started_at: '2026-07-21T03:00:00.000Z' }, 935_000, now)).toEqual({
      startSeconds: 934,
      remainingDurationMs: 0,
    });
  });
});
