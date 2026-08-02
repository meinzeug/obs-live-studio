import { readFile } from 'node:fs/promises';
import { describe, expect, it } from 'vitest';
import { enforceNewsroomFormatQuotas, enforceNoAdjacentVideoRepetition } from '../apps/worker/src/newsroom-planner.js';
import type { NewsroomPlanAiOutput } from '@ans/ai-provider';

const root = new URL('../', import.meta.url);

function slot(index: number): NewsroomPlanAiOutput['slots'][number] {
  return {
    title: `Sendungsblock ${index + 1}`,
    formatSystemKey: 'ava-context-lagezentrum',
    videoIds: [`00000000-0000-4000-8000-${String(index + 1).padStart(12, '0')}`],
    articleIds: [`10000000-0000-4000-8000-${String(index + 1).padStart(12, '0')}`],
    editorialAngle: 'Eine konkrete redaktionelle Perspektive auf die belegte aktuelle Nachrichtenlage.',
    whyNow: 'Das Thema ist aufgrund der gelieferten Aktualität jetzt programmlich relevant.',
    audienceQuestion: 'Welche belegte Folge ist für euch bei diesem Thema entscheidend?',
  };
}

describe('Codex-CLI-Chefredaktion', () => {
  it('erzwingt in jedem Plan genügend Publikumsforen und Sechs-Personen-Rundtische', () => {
    const slots = enforceNewsroomFormatQuotas(Array.from({ length: 12 }, (_, index) => slot(index)));
    const forums = slots.filter((entry) => entry.formatSystemKey === 'ai-roundtable-publikumsforum');
    const roundtables = slots.filter((entry) => entry.formatSystemKey.startsWith('ai-roundtable-'));

    expect(forums.length).toBeGreaterThanOrEqual(4);
    expect(roundtables.length).toBeGreaterThanOrEqual(8);
  });

  it('ordnet Sendungsblöcke so, dass dasselbe Video nie zweimal direkt nacheinander läuft', () => {
    const slots = Array.from({ length: 6 }, (_, index) => ({
      ...slot(index),
      videoIds: [index < 3 ? 'video-a' : index < 5 ? 'video-b' : 'video-c'],
    }));
    const ordered = enforceNoAdjacentVideoRepetition(slots);
    for (let index = 1; index < ordered.length; index += 1) {
      expect(ordered[index]!.videoIds[0]).not.toBe(ordered[index - 1]!.videoIds.at(-1));
    }
  });

  it('weist unmittelbare Doppelungen innerhalb eines Sendungsblocks zurück', () => {
    expect(() => enforceNoAdjacentVideoRepetition([{ ...slot(0), videoIds: ['video-a', 'video-a'] }])).toThrow(
      'innerhalb eines Blocks',
    );
  });

  it('verankert Codex-only-Planung, vollständige Vorproduktion und sechs sichtbare Moderatoren', async () => {
    const [planner, migration, roundtable, overlay, autopilot] = await Promise.all([
      readFile(new URL('apps/worker/src/newsroom-planner.ts', root), 'utf8'),
      readFile(new URL('packages/database/src/092_codex_autonomous_newsroom.sql', root), 'utf8'),
      readFile(new URL('apps/api/src/ai-roundtable.ts', root), 'utf8'),
      readFile(new URL('apps/api/src/ai-tv-team.ts', root), 'utf8'),
      readFile(new URL('apps/worker/src/autopilot.ts', root), 'utf8'),
    ]);

    expect(planner).toContain('planAutonomousNewsroom');
    expect(planner).toContain("AI_PROVIDER: 'codex'");
    expect(planner).toContain("OPENROUTER_FALLBACK: 'false'");
    expect(planner).toContain('listYoutubeVideosWithReadyPreproduction');
    expect(planner).toContain('codexNewsroomPlanId');
    expect(migration).toContain('codex_newsroom_plans');
    expect(migration).toContain("tier in ('free','paid','local','codex')");
    expect(migration).toContain("'codex-newsroom.enabled','true'::jsonb");
    expect(migration).toContain("'minimumDistinctPresenters',6");
    expect(migration).toContain("'roundtableProductionSettings',coalesce(format.settings");
    expect(migration).toContain("'roundtableProductionSettings',coalesce(playlist.settings");
    expect(migration).toContain("'roundtableProductionSettings',coalesce(item.rules");
    expect(migration.match(/'fallbackMode','codex-retry'/g)?.length).toBeGreaterThanOrEqual(5);
    expect(roundtable).toContain("'roundtable-codex-retry'");
    expect(roundtable).toContain('releaseYoutubePreproducedCue');
    expect(roundtable).toContain('localFallback: false');
    expect(overlay).toContain('sixAgentEnsemble');
    expect(overlay).toContain('hostRoster.length >= 6');
    expect(autopilot).toContain('advanceNextReadyCodexNewsroomPlaylistWhenOffAir');
    expect(autopilot).toContain('advanced-to-fill-off-air-gap');
    expect(autopilot).toContain('withoutImmediateYoutubeRepeat');
    expect(autopilot).toContain('codex-continuity-distinct-video');
    expect(autopilot).toContain('order by first_item.position');
    expect(autopilot).toContain('youtube_preproduced_script_is_broadcast_ready(package.id)');
    expect(planner).toContain('audio_duration_seconds');
    expect(planner).not.toContain('return Math.max(30, Math.min(120');
  });
});
