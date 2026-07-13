import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';

const runnerSource = readFileSync(new URL('../../packages/broadcast-engine/src/index.ts', import.meta.url), 'utf8');

describe('broadcast runner production architecture', () => {
  it('does not import legacy direct write helpers or local command queues', () => {
    for (const forbidden of [
      'setPlaybackState',
      'updateBroadcastRun',
      'setBroadcastPlaylistState',
      'markBroadcastItem',
      'completeBroadcastCommand',
      '.enqueue(',
      '.process(',
      'executeEnvelope',
      'applyBroadcastCommandTransaction',
    ]) {
      expect(runnerSource).not.toContain(forbidden);
    }
  });

  it('routes claimed persistent commands through BroadcastCommandExecutor.execute()', () => {
    expect(runnerSource).toContain('new BroadcastCommandExecutor');
    expect(runnerSource).toContain('this.commandExecutor.execute(env');
  });
});
