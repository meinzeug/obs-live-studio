export type StreamPublicationDecision = {
  createTwitchClip: boolean;
  rotateSegment: boolean;
};

export function streamPublicationDecision(input: {
  nowMs: number;
  segmentStartedAtMs: number | null;
  lastTwitchClipAtMs: number | null;
  twitchClipIntervalMs: number;
  segmentMaximumMs: number;
  archiveRotationRequired: boolean;
}): StreamPublicationDecision {
  if (input.segmentStartedAtMs === null) return { createTwitchClip: false, rotateSegment: false };
  return {
    createTwitchClip:
      input.lastTwitchClipAtMs === null || input.nowMs - input.lastTwitchClipAtMs >= input.twitchClipIntervalMs,
    rotateSegment: input.archiveRotationRequired && input.nowMs - input.segmentStartedAtMs >= input.segmentMaximumMs,
  };
}
