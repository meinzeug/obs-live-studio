export const playbackStatuses = [
  'idle',
  'preparing',
  'playing',
  'pausing',
  'paused',
  'resuming',
  'skipping',
  'stopping',
  'ended',
  'error',
  'interrupted',
] as const;

export type PlaybackStatus = (typeof playbackStatuses)[number];
export type BroadcastCommand = 'pause' | 'resume' | 'skip' | 'stop';
export type CommandStatus = 'pending' | 'claimed' | 'completed' | 'rejected';

export interface PlaybackSnapshot {
  status: PlaybackStatus;
  commandSeq: number;
  stateRevision: number;
  runId?: string;
  playlistId?: string;
  itemId?: string;
  articleId?: string;
  position?: number;
  mediaPositionMs?: number | null;
  mediaDurationMs?: number | null;
  obsMediaStatus?: string | null;
  obsConfirmedPositionMs?: number | null;
  recoveryMode?: 'fresh' | 'resumed' | 'restarted' | 'unavailable' | null;
  updatedAt?: string;
}

export interface AcceptedCommand {
  seq: number;
  command: BroadcastCommand;
  accepted: boolean;
  status: CommandStatus;
  reason?: string;
}

export interface TransitionResult {
  from: PlaybackStatus;
  to: PlaybackStatus;
  command: BroadcastCommand;
  accepted: boolean;
  terminal: boolean;
  reason?: string;
}

export function isTerminalStatus(status: PlaybackStatus) {
  return status === 'ended' || status === 'error' || status === 'interrupted';
}

export function normalizeSnapshot(input: Partial<PlaybackSnapshot> = {}): PlaybackSnapshot {
  return {
    status: input.status ?? 'idle',
    commandSeq: input.commandSeq ?? 0,
    stateRevision: input.stateRevision ?? 0,
    runId: input.runId,
    playlistId: input.playlistId,
    itemId: input.itemId,
    articleId: input.articleId,
    position: input.position,
    mediaPositionMs: input.mediaPositionMs ?? null,
    mediaDurationMs: input.mediaDurationMs ?? null,
    obsMediaStatus: input.obsMediaStatus ?? null,
    obsConfirmedPositionMs: input.obsConfirmedPositionMs ?? null,
    recoveryMode: input.recoveryMode ?? null,
    updatedAt: input.updatedAt,
  };
}
