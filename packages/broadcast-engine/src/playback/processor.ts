import { commandPriority, validateTransition } from './transitions.js';
import type { AcceptedCommand, BroadcastCommand, PlaybackSnapshot, TransitionResult } from './state.js';
import { normalizeSnapshot } from './state.js';

export class PlaybackConflictError extends Error {
  public readonly statusCode = 409;
  constructor(
    message: string,
    public readonly result: TransitionResult,
  ) {
    super(message);
  }
}

export interface ProcessedCommandBatch {
  snapshot: PlaybackSnapshot;
  acceptedSequence: AcceptedCommand[];
  transitions: TransitionResult[];
}

export class PlaybackCommandProcessor {
  private readonly snapshot: PlaybackSnapshot;

  constructor(snapshot: Partial<PlaybackSnapshot> = {}) {
    this.snapshot = normalizeSnapshot(snapshot);
  }

  state() {
    return this.snapshot;
  }

  validate(command: BroadcastCommand) {
    return validateTransition(this.snapshot.status, command);
  }

  targetStatus(command: BroadcastCommand) {
    return this.validate(command).to;
  }

  priority(command: BroadcastCommand) {
    return commandPriority(command);
  }

  transition(command: BroadcastCommand, seq = this.snapshot.commandSeq + 1): ProcessedCommandBatch {
    const result = this.validate(command);
    const entry = {
      seq,
      command,
      accepted: result.accepted,
      status: result.accepted ? ('completed' as const) : ('rejected' as const),
      reason: result.reason,
    };
    const snapshot = result.accepted
      ? normalizeSnapshot({
          ...this.snapshot,
          status: result.to,
          commandSeq: seq,
          stateRevision: this.snapshot.stateRevision + 1,
        })
      : this.snapshot;
    return { snapshot, acceptedSequence: [entry], transitions: [result] };
  }

  assert(command: BroadcastCommand) {
    const result = this.validate(command);
    if (!result.accepted) throw new PlaybackConflictError(result.reason ?? 'Ungültiger Zustandsübergang', result);
    return result;
  }
}
