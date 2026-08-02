import { readFile } from 'node:fs/promises';
import { describe, expect, it } from 'vitest';
import {
  admitNewsroomPlan,
  calculateNewsroomRuntimeMinutes,
  enforceNewsroomFormatQuotas,
  enforceNoAdjacentVideoRepetition,
  newsroomDiscussionSettings,
  shouldTriggerNewsroomPlanning,
} from '../apps/worker/src/newsroom-planner.js';
import type { NewsroomPlanAiOutput, NewsroomReadyPlanAiOutput, NewsroomSlotAiOutput } from '@ans/ai-provider';

const root = new URL('../', import.meta.url);
const videoIds = Array.from(
  { length: 4 },
  (_, index) => `00000000-0000-4000-8000-${String(index + 1).padStart(12, '0')}`,
);
const articleId = '10000000-0000-4000-8000-000000000001';

function slot(index: number, selectedVideoIds = [videoIds[index % videoIds.length]!]): NewsroomSlotAiOutput {
  return {
    title: `Sendungsblock ${index + 1}`,
    formatSystemKey: 'ava-context-lagezentrum',
    videoIds: selectedVideoIds,
    articleIds: [articleId],
    evidencePairs: selectedVideoIds.map((videoId) => ({
      videoId,
      articleId,
      rationale: 'Video und Artikel behandeln dieselbe konkrete, heute veröffentlichte Nachrichtenentwicklung.',
    })),
    editorialAngle: 'Eine konkrete redaktionelle Perspektive auf die belegte aktuelle Nachrichtenlage.',
    whyNow: 'Das Thema ist aufgrund der gelieferten Aktualität jetzt programmlich relevant.',
    audienceQuestion: 'Welche belegte Folge ist für euch bei diesem Thema entscheidend?',
  };
}

function readyPlan(): NewsroomReadyPlanAiOutput {
  return {
    decision: 'ready',
    title: 'Tagesaktueller autonomer Sendeplan',
    newsAssessment:
      'Die gelieferten Tagespakete belegen eine aktuelle Entwicklung aus mehreren Perspektiven und tragen die geplanten Stundenblöcke mit realer Vorproduktion.',
    editorialPriorities: [
      'Die heutige Entwicklung sachlich und nachvollziehbar erklären.',
      'Unterschiedliche belegte Perspektiven im Sechs-Personen-Ensemble diskutieren.',
      'Publikumsfragen offen, konkret und ohne erfundene Reaktionen aufnehmen.',
    ],
    omittedTopics: [],
    blockers: [],
    slots: Array.from({ length: 24 }, (_, index) => slot(index, videoIds)),
  };
}

describe('Codex-CLI-Chefredaktion', () => {
  it('erzwingt in jedem Plan genügend Publikumsforen und Sechs-Personen-Rundtische', () => {
    const slots = enforceNewsroomFormatQuotas(Array.from({ length: 24 }, (_, index) => slot(index)));
    const forums = slots.filter((entry) => entry.formatSystemKey === 'ai-roundtable-publikumsforum');
    const roundtables = slots.filter((entry) => entry.formatSystemKey.startsWith('ai-roundtable-'));

    expect(forums.length).toBeGreaterThanOrEqual(8);
    expect(roundtables.length).toBeGreaterThanOrEqual(16);
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

  it('lässt nur 24 belegte Stundenblöcke mit vollständigen Video-Artikel-Paaren zu', () => {
    const admitted = admitNewsroomPlan(readyPlan(), new Set(videoIds), new Set([articleId]));

    expect(admitted.decision).toBe('ready');
    expect(admitted.slots).toHaveLength(24);
    expect(admitted.slots.every((entry) => entry.videoIds.length === 4)).toBe(true);
    expect(admitted.slots.every((entry) => entry.evidencePairs.length === 4)).toBe(true);
  });

  it('weist fehlende Evidenzpaare und nicht sendefähige Schein-Dispositionen hart zurück', () => {
    const missingPair = readyPlan();
    missingPair.slots[0] = {
      ...missingPair.slots[0]!,
      evidencePairs: missingPair.slots[0]!.evidencePairs.slice(0, 3),
    };
    expect(() => admitNewsroomPlan(missingPair, new Set(videoIds), new Set([articleId]))).toThrow(
      'explizites Evidenzpaar',
    );

    const suspended = readyPlan();
    suspended.slots[0] = { ...suspended.slots[0]!, title: 'Disposition ausgesetzt wegen fehlender Quellenlage' };
    expect(() => admitNewsroomPlan(suspended, new Set(videoIds), new Set([articleId]))).toThrow(
      'nicht sendefähige Dispositionssprache',
    );
  });

  it('materialisiert Entscheidungen mit unzureichender Evidenz niemals als Sendeplan', () => {
    const blocked: NewsroomPlanAiOutput = {
      decision: 'insufficient-evidence',
      title: 'Noch kein belastbarer Tagesplan',
      newsAssessment:
        'Die derzeit vollständig vorproduzierten Tagespakete reichen noch nicht aus, um jeden Stundenblock mit echten Laufzeiten und sachlich verbundenen Quellen zu tragen.',
      editorialPriorities: [
        'Weitere aktuelle Quellenpakete abwarten und prüfen.',
        'Nur vollständig vorproduzierte Codex-Pakete berücksichtigen.',
        'Keine Platzhalter oder sachfremden Verbindungen erzeugen.',
      ],
      omittedTopics: [],
      blockers: ['Es fehlen ausreichend lange und sachlich verbundene Tagespakete für alle 24 Stundenblöcke.'],
      slots: null,
    };

    expect(() => admitNewsroomPlan(blocked, new Set(videoIds), new Set([articleId]))).toThrow(
      'nicht zur Ausstrahlung zugelassen',
    );
  });

  it('berechnet Laufzeit ausschließlich aus Video, TTS und realen Cue-Übergängen', () => {
    expect(
      calculateNewsroomRuntimeMinutes([{ durationSeconds: 3_000, moderationAudioSeconds: 600, cueCount: 6 }]),
    ).toBe(61);
    expect(calculateNewsroomRuntimeMinutes([{ durationSeconds: 30, moderationAudioSeconds: 0, cueCount: 0 }])).toBe(1);
  });

  it('materialisiert auch Lagezentrum und Quellencheck als Sechs-Agenten-Diskussion', () => {
    const contextShow = newsroomDiscussionSettings('ava-context-lagezentrum');
    const sourceCheck = newsroomDiscussionSettings('ava-context-quellencheck');
    const audienceForum = newsroomDiscussionSettings('ai-roundtable-publikumsforum');

    for (const settings of [contextShow, sourceCheck, audienceForum]) {
      expect(settings.contentMode).toBe('ai-roundtable');
      expect(settings.aiRoundtable).toBe(true);
      expect(settings.roundtableParticipantIds).toHaveLength(6);
    }
    expect(contextShow.roundtablePreset).toBe('studio-rundtisch');
    expect(audienceForum.roundtablePreset).toBe('publikumsforum');
  });

  it('wiederholt einen blockierten Versuch ohne aktiven Plan nicht im 60-Sekunden-Takt', () => {
    const now = Date.parse('2026-08-02T12:00:00Z');
    const blockedState = {
      active_plan_id: null,
      evaluated_at: '2026-08-02T11:30:00Z',
      latest_decision: 'insufficient-evidence',
      upcoming: 0,
      has_new_ready_package: false,
    };

    expect(shouldTriggerNewsroomPlanning(blockedState, 90, now)).toBe(false);
    expect(shouldTriggerNewsroomPlanning({ ...blockedState, has_new_ready_package: true }, 90, now)).toBe(true);
    expect(shouldTriggerNewsroomPlanning({ ...blockedState, evaluated_at: '2026-08-02T10:29:59Z' }, 90, now)).toBe(
      true,
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
    expect(autopilot).toContain("plan.status='active'");
    expect(autopilot).toContain("plan.plan->>'decision'='ready'");
    expect(autopilot).toContain('advanced-to-fill-off-air-gap');
    expect(autopilot).toContain('withoutImmediateYoutubeRepeat');
    expect(autopilot).toContain('codex-continuity-distinct-video');
    expect(autopilot).toContain('order by first_item.position');
    expect(autopilot).toContain('youtube_preproduced_script_is_broadcast_ready(package.id)');
    expect(planner).toContain('audio_duration_seconds');
    expect(planner).not.toContain('return Math.max(30, Math.min(120');
    expect(planner).toContain('from jsonb_array_elements_text(');
    expect(planner).toContain("where recent.status in ('active','blocked')");
    expect(planner).toContain("where current.status='active'");
    expect(planner).toContain('pauseSeconds: 0');
    expect(planner).not.toContain("contentMode: isRoundtable ? 'ai-roundtable' : 'youtube-context'");
  });
});
