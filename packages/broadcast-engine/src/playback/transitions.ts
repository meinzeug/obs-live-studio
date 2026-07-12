import type { BroadcastCommand, PlaybackStatus, TransitionResult } from './state.js';
import { isTerminalStatus } from './state.js';

type TransitionRule = Partial<Record<BroadcastCommand, PlaybackStatus>>;

export const transitionTable: Record<PlaybackStatus, TransitionRule> = {
  idle: { skip: 'skipping', stop: 'ended' },
  preparing: { pause: 'paused', skip: 'skipping', stop: 'stopping' },
  playing: { pause: 'paused', skip: 'skipping', stop: 'stopping' },
  pausing: { pause: 'paused', resume: 'playing', skip: 'skipping', stop: 'stopping' },
  paused: { resume: 'playing', skip: 'skipping', stop: 'stopping' },
  resuming: { pause: 'paused', resume: 'playing', skip: 'skipping', stop: 'stopping' },
  skipping: { skip: 'skipping', stop: 'stopping' },
  stopping: { stop: 'stopping' },
  ended: {},
  error: {},
  interrupted: {},
};

export function validateTransition(from: PlaybackStatus, command: BroadcastCommand): TransitionResult {
  if (command === 'stop') {
    if (isTerminalStatus(from)) {
      return { from, to: from, command, accepted: true, terminal: true, reason: 'already-terminal' };
    }
    return { from, to: transitionTable[from].stop ?? 'stopping', command, accepted: true, terminal: true };
  }
  if (isTerminalStatus(from) || (from === 'idle' && command !== 'skip')) {
    return {
      from,
      to: from,
      command,
      accepted: false,
      terminal: isTerminalStatus(from),
      reason: `command-${command}-not-valid-from-${from}`,
    };
  }
  const to = transitionTable[from][command];
  if (!to) {
    return {
      from,
      to: from,
      command,
      accepted: false,
      terminal: false,
      reason: `command-${command}-not-valid-from-${from}`,
    };
  }
  if (command === 'pause' && from === 'paused') {
    return { from, to: from, command, accepted: true, terminal: false, reason: 'already-paused' };
  }
  if (command === 'resume' && from === 'playing') {
    return { from, to: from, command, accepted: true, terminal: false, reason: 'already-playing' };
  }
  return { from, to, command, accepted: true, terminal: to === 'stopping' || isTerminalStatus(to) };
}

export function commandPriority(command: BroadcastCommand) {
  switch (command) {
    case 'stop':
      return 0;
    case 'skip':
      return 1;
    case 'pause':
      return 2;
    case 'resume':
      return 3;
  }
}
