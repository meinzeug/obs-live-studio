import { describe, expect, it } from 'vitest';
import { directLiveShow, type LiveDirectorInput } from '../apps/api/src/live-director.js';

const now = Date.parse('2026-07-23T22:00:00.000Z');

function input(overrides: Partial<LiveDirectorInput> = {}): LiveDirectorInput {
  return {
    nowMs: now,
    sessionStartedAtMs: now - 30 * 60_000,
    nextDirectionAtMs: now - 1_000,
    progressPercent: 40,
    progressFresh: true,
    liveSource: false,
    pendingChatMessages: 0,
    pendingChatQuestions: 0,
    lastChatMessageAtMs: 0,
    sequence: 2,
    pauseIndex: 0,
    pauseMoments: [],
    lastAvaAtMs: now - 8 * 60_000,
    lastMiaAtMs: now - 3 * 60_000,
    closingPrompted: false,
    avaTargetIntervalSeconds: 420,
    minimumAvaCommentariesPerHour: 6,
    miaPromptIntervalSeconds: 480,
    inlineCommentaryEnabled: true,
    takeoverFrequency: 'balanced',
    ...overrides,
  };
}

describe('dynamic live director', () => {
  it('takes over at an editorial transcript marker', () => {
    const decision = directLiveShow(input({ progressPercent: 42, pauseMoments: [{ atPercent: 40 }] }));
    expect(decision).toMatchObject({
      action: 'ava-takeover',
      trigger: 'editorial-moment',
      pauseIndex: 0,
      displayMode: 'takeover',
    });
  });

  it('opens a Mia window when the live chat becomes active', () => {
    const decision = directLiveShow(
      input({
        pendingChatMessages: 4,
        lastChatMessageAtMs: now - 15_000,
        lastMiaAtMs: now - 5 * 60_000,
      }),
    );
    expect(decision).toMatchObject({
      action: 'mia-interaction',
      trigger: 'chat-activity',
      presenterId: 'chat-moderator',
      displayMode: 'inline',
    });
  });

  it('prevents long silent stretches on long and live videos', () => {
    const decision = directLiveShow(
      input({
        liveSource: true,
        lastAvaAtMs: now - 6 * 60_000,
        lastMiaAtMs: now - 60_000,
        sequence: 2,
      }),
    );
    expect(decision).toMatchObject({
      action: 'ava-inline',
      trigger: 'silence-limit',
    });
  });

  it('creates a closing audience window near the end', () => {
    const decision = directLiveShow(
      input({
        progressPercent: 91,
        lastAvaAtMs: now - 60_000,
        lastMiaAtMs: now - 4 * 60_000,
      }),
    );
    expect(decision).toMatchObject({
      action: 'mia-interaction',
      trigger: 'closing',
    });
  });

  it('does nothing while no event or cadence is due', () => {
    expect(
      directLiveShow(
        input({
          nextDirectionAtMs: now + 60_000,
          lastAvaAtMs: now - 30_000,
          lastMiaAtMs: now - 30_000,
        }),
      ),
    ).toBeNull();
  });
});
