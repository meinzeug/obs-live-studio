export const playbackStatuses = [
  'idle',
  'starting',
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
export type CommandStatus =
  'pending' | 'claimed' | 'executing' | 'completed' | 'rejected' | 'failed' | 'expired' | 'reconciliation_required';

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
  startConfig?: Record<string, unknown>;
  updatedAt?: string;
}

export interface AcceptedCommand {
  seq: number;
  command: BroadcastCommand;
  accepted: boolean;
  status: CommandStatus;
  reason?: string;
}

export class PlaybackConsistencyError extends Error {
  readonly code = 'PLAYBACK_CONSISTENCY_ERROR';
  constructor(
    message: string,
    public readonly details: Record<string, unknown> = {},
  ) {
    super(message);
  }
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
    startConfig: input.startConfig ?? {},
    updatedAt: input.updatedAt,
  };
}
