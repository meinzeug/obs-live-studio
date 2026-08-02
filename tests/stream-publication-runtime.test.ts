import { describe, expect, it } from 'vitest';
import { streamPublicationDecision } from '../apps/api/src/stream-publication-runtime.js';

describe('stream publication schedule', () => {
  it('requests recurring clips without rotating a young segment', () => {
    expect(
      streamPublicationDecision({
        nowMs: 40 * 60_000,
        segmentStartedAtMs: 0,
        lastTwitchClipAtMs: 5 * 60_000,
        twitchClipIntervalMs: 30 * 60_000,
        segmentMaximumMs: 11 * 60 * 60_000,
        archiveRotationRequired: true,
      }),
    ).toEqual({ createTwitchClip: true, rotateSegment: false });
  });

  it('rotates streams at the archive boundary and does nothing while offline', () => {
    expect(
      streamPublicationDecision({
        nowMs: 12 * 60 * 60_000,
        segmentStartedAtMs: 0,
        lastTwitchClipAtMs: 11.75 * 60 * 60_000,
        twitchClipIntervalMs: 30 * 60_000,
        segmentMaximumMs: 11.75 * 60 * 60_000,
        archiveRotationRequired: true,
      }),
    ).toEqual({ createTwitchClip: false, rotateSegment: true });
    expect(
      streamPublicationDecision({
        nowMs: 12 * 60 * 60_000,
        segmentStartedAtMs: null,
        lastTwitchClipAtMs: null,
        twitchClipIntervalMs: 30 * 60_000,
        segmentMaximumMs: 11.75 * 60 * 60_000,
        archiveRotationRequired: true,
      }),
    ).toEqual({ createTwitchClip: false, rotateSegment: false });
  });

  it('keeps a Twitch-only stream continuous beyond the archive boundary', () => {
    expect(
      streamPublicationDecision({
        nowMs: 24 * 60 * 60_000,
        segmentStartedAtMs: 0,
        lastTwitchClipAtMs: 23.75 * 60 * 60_000,
        twitchClipIntervalMs: 30 * 60_000,
        segmentMaximumMs: 11.75 * 60 * 60_000,
        archiveRotationRequired: false,
      }),
    ).toEqual({ createTwitchClip: false, rotateSegment: false });
  });
});
