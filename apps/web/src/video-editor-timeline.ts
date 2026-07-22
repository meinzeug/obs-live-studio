export type TimelineClipLike = {
  id: string;
  sourceId: string;
  sourceStart: number;
  duration: number;
  transition: string;
  transitionDuration?: number;
};

export type TimelineTimedLayer = {
  startAt: number;
  duration: number;
};

function rounded(value: number) {
  return Number(value.toFixed(3));
}

function clamp(value: number, minimum: number, maximum: number) {
  return Math.max(minimum, Math.min(maximum, value));
}

function overlap(previous: TimelineClipLike | undefined, clip: TimelineClipLike) {
  if (!previous || clip.transition === 'cut') return 0;
  return Math.min(
    clip.transitionDuration ?? 0.45,
    Math.max(0, previous.duration - 0.25),
    Math.max(0, clip.duration - 0.25),
  );
}

export function timelineClipStart(clips: TimelineClipLike[], clipId: string) {
  let start = 0;
  for (const [index, clip] of clips.entries()) {
    start -= overlap(clips[index - 1], clip);
    if (clip.id === clipId) return rounded(start);
    start += clip.duration;
  }
  return null;
}

export function timelineCutPoints(clips: TimelineClipLike[]) {
  const points = [0];
  for (const [index, clip] of clips.entries())
    points.push(rounded(points.at(-1)! + clip.duration - overlap(clips[index - 1], clip)));
  return points;
}

export function snapTimelineTime(value: number, targets: number[], thresholdSeconds: number, fps: number) {
  const frame = 1 / Math.max(1, fps);
  const frameValue = Math.round(value / frame) * frame;
  let closestTarget: number | null = null;
  let targetDistance = Number.POSITIVE_INFINITY;
  for (const target of targets) {
    const candidateDistance = Math.abs(value - target);
    if (candidateDistance <= thresholdSeconds && candidateDistance < targetDistance) {
      closestTarget = target;
      targetDistance = candidateDistance;
    }
  }
  return rounded(closestTarget ?? frameValue);
}

export function trimTimelineClip<T extends TimelineClipLike>(input: {
  clips: T[];
  clipId: string;
  edge: 'start' | 'end';
  deltaSeconds: number;
  sourceDuration: number;
  minimumDuration?: number;
}) {
  const minimum = Math.max(0.04, input.minimumDuration ?? 0.25);
  const clips = input.clips.map((clip) => ({ ...clip })) as T[];
  const clip = clips.find((candidate) => candidate.id === input.clipId);
  if (!clip) return { clips, appliedDelta: 0, durationDelta: 0 };
  if (input.edge === 'start') {
    const appliedDelta = clamp(input.deltaSeconds, -clip.sourceStart, clip.duration - minimum);
    clip.sourceStart = rounded(clip.sourceStart + appliedDelta);
    clip.duration = rounded(clip.duration - appliedDelta);
    return { clips, appliedDelta: rounded(appliedDelta), durationDelta: rounded(-appliedDelta) };
  }
  const maximumDuration = Math.max(minimum, input.sourceDuration - clip.sourceStart);
  const appliedDelta = clamp(input.deltaSeconds, minimum - clip.duration, maximumDuration - clip.duration);
  clip.duration = rounded(clip.duration + appliedDelta);
  return { clips, appliedDelta: rounded(appliedDelta), durationDelta: rounded(appliedDelta) };
}

export function rollTimelineCut<T extends TimelineClipLike>(input: {
  clips: T[];
  leftClipId: string;
  deltaSeconds: number;
  leftSourceDuration: number;
  minimumDuration?: number;
}) {
  const minimum = Math.max(0.04, input.minimumDuration ?? 0.25);
  const clips = input.clips.map((clip) => ({ ...clip })) as T[];
  const leftIndex = clips.findIndex((clip) => clip.id === input.leftClipId);
  const left = clips[leftIndex];
  const right = clips[leftIndex + 1];
  if (!left || !right) return { clips, appliedDelta: 0 };
  const minimumDelta = Math.max(minimum - left.duration, -right.sourceStart);
  const maximumDelta = Math.min(input.leftSourceDuration - left.sourceStart - left.duration, right.duration - minimum);
  if (maximumDelta < minimumDelta) return { clips, appliedDelta: 0 };
  const appliedDelta = clamp(input.deltaSeconds, minimumDelta, maximumDelta);
  left.duration = rounded(left.duration + appliedDelta);
  right.sourceStart = rounded(right.sourceStart + appliedDelta);
  right.duration = rounded(right.duration - appliedDelta);
  return { clips, appliedDelta: rounded(appliedDelta) };
}

export function slipTimelineClip<T extends TimelineClipLike>(input: {
  clips: T[];
  clipId: string;
  deltaSeconds: number;
  sourceDuration: number;
}) {
  const clips = input.clips.map((clip) => ({ ...clip })) as T[];
  const clip = clips.find((candidate) => candidate.id === input.clipId);
  if (!clip) return { clips, appliedDelta: 0 };
  const nextSourceStart = clamp(clip.sourceStart + input.deltaSeconds, 0, input.sourceDuration - clip.duration);
  const appliedDelta = rounded(nextSourceStart - clip.sourceStart);
  clip.sourceStart = rounded(nextSourceStart);
  return { clips, appliedDelta };
}

export function splitTimelineClip<T extends TimelineClipLike>(input: {
  clips: T[];
  clipId: string;
  offsetSeconds: number;
  newClipId: string;
  minimumDuration?: number;
}) {
  const minimum = Math.max(0.04, input.minimumDuration ?? 0.25);
  const index = input.clips.findIndex((clip) => clip.id === input.clipId);
  const original = input.clips[index];
  if (!original || input.offsetSeconds < minimum || original.duration - input.offsetSeconds < minimum)
    return { clips: input.clips.map((clip) => ({ ...clip })) as T[], split: false };
  const clips = input.clips.map((clip) => ({ ...clip })) as T[];
  const first = clips[index]!;
  const second = {
    ...first,
    id: input.newClipId,
    sourceStart: rounded(first.sourceStart + input.offsetSeconds),
    duration: rounded(first.duration - input.offsetSeconds),
    transition: 'cut',
  } as T;
  first.duration = rounded(input.offsetSeconds);
  clips.splice(index + 1, 0, second);
  return { clips, split: true };
}

export function rippleTimedLayers<T extends TimelineTimedLayer>(layers: T[], boundary: number, deltaSeconds: number) {
  return layers.map((layer) =>
    layer.startAt >= boundary - 0.001
      ? { ...layer, startAt: rounded(Math.max(0, layer.startAt + deltaSeconds)) }
      : { ...layer },
  );
}
