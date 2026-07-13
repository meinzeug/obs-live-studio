import { describe, expect, it } from 'vitest';
import {
  PlaybackCommandProcessor,
  PlaybackConflictError,
  transitionTable,
  validateTransition,
  PlaybackConsistencyError,
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

  it('rejects invalid resume without retaining pending work', () => {
    const processor = new PlaybackCommandProcessor({ status: 'preparing' });
    const batch = processor.transition('resume');
    expect(batch.acceptedSequence[0]).toMatchObject({ accepted: false, status: 'rejected' });
    expect(batch.snapshot.status).toBe('preparing');
  });

  it('can throw HTTP-409 compatible conflicts for invalid transitions', () => {
    const processor = new PlaybackCommandProcessor({ status: 'idle' });
    expect(() => processor.assert('pause')).toThrow(PlaybackConflictError);
    try {
      processor.assert('pause');
    } catch (error) {
      expect((error as PlaybackConflictError).statusCode).toBe(409);
      expect((error as PlaybackConflictError).result.reason).toContain('not-valid');
    }
  });

  it('resumes from paused to playing with a completed command sequence', () => {
    const processor = new PlaybackCommandProcessor({ status: 'paused', commandSeq: 4 });
    const batch = processor.transition('resume');
    expect(batch.snapshot.status).toBe('playing');
    expect(batch.snapshot.commandSeq).toBe(5);
    expect(batch.acceptedSequence).toEqual([
      expect.objectContaining({ seq: 5, command: 'resume', status: 'completed', accepted: true }),
    ]);
  });

  it('exposes deterministic command priorities without an internal queue', () => {
    const processor = new PlaybackCommandProcessor({ status: 'playing' });
    expect(processor.priority('stop')).toBeLessThan(processor.priority('pause'));
    expect(processor.priority('pause')).toBeLessThan(processor.priority('resume'));
  });

  it('allows skip while paused and marks the item as skipping', () => {
    const processor = new PlaybackCommandProcessor({ status: 'paused', commandSeq: 2 });
    const batch = processor.transition('skip');
    expect(batch.snapshot.status).toBe('skipping');
    expect(batch.acceptedSequence[0]).toMatchObject({ command: 'skip', status: 'completed' });
  });

  it('keeps repeated stop idempotent once stopping', () => {
    const processor = new PlaybackCommandProcessor({ status: 'stopping', commandSeq: 7 });
    const batch = processor.transition('stop');
    expect(batch.snapshot.status).toBe('stopping');
    expect(batch.acceptedSequence).toHaveLength(1);
  });

  it('accepts starting as a canonical runtime state', () => {
    expect(validateTransition('starting', 'stop')).toMatchObject({ accepted: true, to: 'stopping' });
    expect(transitionTable.starting).toMatchObject({ pause: 'paused', skip: 'skipping', stop: 'stopping' });
  });

  it('turns unknown states into typed consistency errors instead of crashing on undefined', () => {
    expect(() => validateTransition('ghost' as never, 'pause')).toThrow(PlaybackConsistencyError);
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
