import { describe, expect, it } from 'vitest';
import { youtubePlaybackWindow, youtubePlayerReachedEnd, youtubePlayerUnavailable } from '@ans/broadcast-engine';

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

  it('recognizes the real YouTube end independently of a stale planned duration', () => {
    expect(
      youtubePlayerReachedEnd(
        {
          paused: false,
          media_position_ms: 364_100,
          media_duration_ms: 364_381,
          player_state: 0,
          last_progress_at: new Date(now - 200).toISOString(),
        },
        now,
      ),
    ).toBe(true);
  });

  it('does not finish while AVA has paused the video or the player heartbeat is stale', () => {
    const progress = {
      media_position_ms: 363_500,
      media_duration_ms: 364_381,
      player_state: 2,
      last_progress_at: new Date(now - 200).toISOString(),
    };
    expect(youtubePlayerReachedEnd({ ...progress, paused: true }, now)).toBe(false);
    expect(
      youtubePlayerReachedEnd(
        { ...progress, paused: false, last_progress_at: new Date(now - 20_000).toISOString() },
        now,
      ),
    ).toBe(false);
  });

  it('advances after a loaded wrapper reports a player that never starts', () => {
    const unstarted = {
      paused: false,
      media_position_ms: 0,
      media_duration_ms: null,
      player_state: -1,
      last_progress_at: new Date(now - 200).toISOString(),
    };
    expect(youtubePlayerUnavailable(unstarted, now - 29_999, now)).toBe(false);
    expect(youtubePlayerUnavailable(unstarted, now - 30_000, now)).toBe(true);
    expect(youtubePlayerUnavailable({ ...unstarted, paused: true }, now - 60_000, now)).toBe(false);
  });
});
