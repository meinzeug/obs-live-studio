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
  private snapshot: PlaybackSnapshot;
  private pending: AcceptedCommand[] = [];

  constructor(snapshot: Partial<PlaybackSnapshot> = {}) {
    this.snapshot = normalizeSnapshot(snapshot);
  }

  state() {
    return this.snapshot;
  }

  enqueue(command: BroadcastCommand, opts: { throwOnConflict?: boolean } = {}) {
    const result = validateTransition(this.snapshot.status, command);
    const seq = this.snapshot.commandSeq + this.pending.length + 1;
    if (!result.accepted) {
      if (opts.throwOnConflict) throw new PlaybackConflictError(result.reason ?? 'Ungültiger Zustandsübergang', result);
      return { seq, command, accepted: false, status: 'rejected' as const, reason: result.reason };
    }
    const accepted = { seq, command, accepted: true, status: 'pending' as const, reason: result.reason };
    if (command === 'stop') this.pending = [accepted];
    else if (!this.pending.some((p) => p.command === 'stop')) this.pending.push(accepted);
    return accepted;
  }

  process(): ProcessedCommandBatch {
    const ordered = [...this.pending].sort(
      (a, b) => commandPriority(a.command) - commandPriority(b.command) || a.seq - b.seq,
    );
    const acceptedSequence: AcceptedCommand[] = [];
    const transitions: TransitionResult[] = [];
    for (const entry of ordered) {
      const result = validateTransition(this.snapshot.status, entry.command);
      transitions.push(result);
      if (!result.accepted) {
        acceptedSequence.push({ ...entry, status: 'rejected', accepted: false, reason: result.reason });
        continue;
      }
      this.snapshot = normalizeSnapshot({
        ...this.snapshot,
        status: result.to,
        commandSeq: entry.seq,
        stateRevision: this.snapshot.stateRevision + 1,
      });
      acceptedSequence.push({ ...entry, status: 'completed', accepted: true, reason: result.reason });
      if (entry.command === 'stop') break;
      if (entry.command === 'skip') break;
      if (entry.command === 'pause') break;
      if (entry.command === 'resume') continue;
    }
    this.pending = [];
    return { snapshot: this.snapshot, acceptedSequence, transitions };
  }

  clear() {
    this.pending = [];
  }
}
