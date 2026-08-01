import { describe, expect, it } from 'vitest';
import {
  hostBriefingNeedsRefresh,
  hostBriefingWithFormatRegie,
  hostFormatRegie,
  isEditorialFallbackBriefingModel,
} from '../apps/api/src/ai-host-format.js';

const formatRegie = {
  satireMode: true,
  hostRoster: ['moderator', 'chat-moderator', 'presenter-leon', 'presenter-jonas'],
  coHostIds: ['presenter-leon', 'presenter-jonas'],
};

describe('AI host format regie persistence', () => {
  it('merges the broadcast format into an editorial briefing', () => {
    expect(hostBriefingWithFormatRegie({ keyClaims: ['Aussage'] }, formatRegie)).toEqual({
      keyClaims: ['Aussage'],
      formatRegie,
    });
  });

  it('refreshes fallback and format-less sessions exactly once', () => {
    const effectiveBriefing = { keyClaims: ['Aussage'] };
    expect(
      hostBriefingNeedsRefresh({
        storedBriefing: { keyClaims: ['Fallback'] },
        storedModel: 'redaktioneller-fallback',
        effectiveBriefing,
        desiredModel: 'openrouter/free',
        itemFormatRegie: formatRegie,
      }),
    ).toBe(true);
    expect(
      hostBriefingNeedsRefresh({
        storedBriefing: hostBriefingWithFormatRegie(effectiveBriefing, formatRegie),
        storedModel: 'openrouter/free',
        effectiveBriefing,
        desiredModel: 'openrouter/free',
        itemFormatRegie: formatRegie,
      }),
    ).toBe(false);
  });

  it('recognizes fallback briefings after local production versions were appended', () => {
    expect(isEditorialFallbackBriefingModel('redaktioneller-fallback+grounded-six-host-dialogue-v4')).toBe(true);
    expect(isEditorialFallbackBriefingModel('codex-cli+live-recherche')).toBe(false);
  });

  it('keeps an enriched live-research briefing instead of overwriting it every tick', () => {
    expect(
      hostBriefingNeedsRefresh({
        storedBriefing: hostBriefingWithFormatRegie(
          { keyClaims: ['Geprüfte Live-Recherche'], sources: [{ title: 'Quelle' }] },
          formatRegie,
        ),
        storedModel: 'openrouter/free+live-recherche',
        effectiveBriefing: { keyClaims: ['Zwischengespeicherter Kontext'] },
        desiredModel: 'openrouter/free',
        itemFormatRegie: formatRegie,
      }),
    ).toBe(false);
  });

  it('resolves a missing session format from the active broadcast item', () => {
    expect(hostFormatRegie({ keyClaims: ['Aussage'] }, formatRegie)).toEqual(formatRegie);
  });
});
