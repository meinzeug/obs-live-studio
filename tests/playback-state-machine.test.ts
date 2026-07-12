import { describe, expect, it } from 'vitest';
import {
  PlaybackCommandProcessor,
  PlaybackConflictError,
  transitionTable,
  validateTransition,
} from '@ans/broadcast-engine';

describe('explicit playback transition table', () => {
  it('documents stop precedence from all non-terminal states', () => {
    for (const state of ['preparing', 'playing', 'pausing', 'paused', 'resuming', 'skipping'] as const) {
      const result = validateTransition(state, 'stop');
      expect(result.accepted).toBe(true);
      expect(result.to).toBe('stopping');
      expect(result.terminal).toBe(true);
    }
  });

  it('rejects invalid resume instead of saving it for a future pause', () => {
    const processor = new PlaybackCommandProcessor({ status: 'preparing' });
    const accepted = processor.enqueue('resume');
    expect(accepted.accepted).toBe(false);
    expect(accepted.status).toBe('rejected');
    expect(processor.process().acceptedSequence).toHaveLength(0);
  });

  it('can throw HTTP-409 compatible conflicts for invalid transitions', () => {
    const processor = new PlaybackCommandProcessor({ status: 'idle' });
    expect(() => processor.enqueue('pause', { throwOnConflict: true })).toThrow(PlaybackConflictError);
    try {
      processor.enqueue('pause', { throwOnConflict: true });
    } catch (error) {
      expect((error as PlaybackConflictError).statusCode).toBe(409);
      expect((error as PlaybackConflictError).result.reason).toContain('not-valid');
    }
  });

  it('resumes from paused to playing with a completed command sequence', () => {
    const processor = new PlaybackCommandProcessor({ status: 'paused', commandSeq: 4 });
    processor.enqueue('resume');
    const batch = processor.process();
    expect(batch.snapshot.status).toBe('playing');
    expect(batch.snapshot.commandSeq).toBe(5);
    expect(batch.acceptedSequence).toEqual([
      expect.objectContaining({ seq: 5, command: 'resume', status: 'completed', accepted: true }),
    ]);
  });

  it('handles repeated resume while playing idempotently without changing to paused later', () => {
    const processor = new PlaybackCommandProcessor({ status: 'playing', commandSeq: 9 });
    processor.enqueue('resume');
    processor.enqueue('resume');
    const batch = processor.process();
    expect(batch.snapshot.status).toBe('playing');
    expect(batch.acceptedSequence).toHaveLength(2);
    expect(batch.acceptedSequence.map((entry) => entry.command)).toEqual(['resume', 'resume']);
    expect(batch.acceptedSequence.map((entry) => entry.status)).toEqual(['completed', 'completed']);
  });

  it('orders concurrent pause and stop deterministically with stop first', () => {
    const processor = new PlaybackCommandProcessor({ status: 'playing' });
    processor.enqueue('pause');
    processor.enqueue('stop');
    const batch = processor.process();
    expect(batch.acceptedSequence.map((entry) => entry.command)).toEqual(['stop']);
    expect(batch.snapshot.status).toBe('stopping');
  });

  it('allows skip while paused and marks the item as skipping', () => {
    const processor = new PlaybackCommandProcessor({ status: 'paused', commandSeq: 2 });
    processor.enqueue('skip');
    const batch = processor.process();
    expect(batch.snapshot.status).toBe('skipping');
    expect(batch.acceptedSequence[0]).toMatchObject({ command: 'skip', status: 'completed' });
  });

  it('allows stop while paused and gives it priority over resume', () => {
    const processor = new PlaybackCommandProcessor({ status: 'paused', commandSeq: 2 });
    processor.enqueue('resume');
    processor.enqueue('stop');
    const batch = processor.process();
    expect(batch.snapshot.status).toBe('stopping');
    expect(batch.acceptedSequence.map((entry) => entry.command)).toEqual(['stop']);
  });

  it('keeps repeated stop idempotent once stopping', () => {
    const processor = new PlaybackCommandProcessor({ status: 'stopping', commandSeq: 7 });
    processor.enqueue('stop');
    processor.enqueue('stop');
    const batch = processor.process();
    expect(batch.snapshot.status).toBe('stopping');
    expect(batch.acceptedSequence).toHaveLength(1);
  });

  it('exposes a complete transition table for commands used by the API', () => {
    expect(transitionTable.playing).toMatchObject({ pause: 'paused', skip: 'skipping', stop: 'stopping' });
    expect(transitionTable.paused).toMatchObject({
      pause: 'paused',
      resume: 'playing',
      skip: 'skipping',
      stop: 'stopping',
    });
  });
});
