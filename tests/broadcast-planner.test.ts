import { describe, expect, it } from 'vitest';
import {
  deterministicBroadcastPlan,
  filterBroadcastCandidates,
  type BroadcastPlannerOptions,
} from '../apps/api/src/broadcast-planner.js';
import type { ArticleDetailRecord } from '@ans/database';

const now = Date.parse('2026-07-20T14:00:00Z');
const options: BroadcastPlannerOptions = {
  maximumItems: 4,
  targetRuntimeMinutes: 10,
  minimumTrust: 50,
  freshnessHours: 72,
  focus: 'balanced',
  diversity: 'high',
  categoryFilters: [],
  sourceIds: [],
};

function article(id: string, category: string, sourceId: string, hoursOld: number, trust = 80) {
  return {
    id,
    source_id: sourceId,
    source_name: sourceId,
    title: `${category} Meldung ${id}`,
    url: `https://example.test/${id}`,
    canonical_url: null,
    published_at: new Date(now - hoursOld * 3_600_000).toISOString(),
    fetched_at: new Date(now - hoursOld * 3_600_000).toISOString(),
    author: null,
    excerpt: 'Ein ausreichend langer Nachrichtentext für die Schätzung der Laufzeit.',
    main_text: null,
    content_hash: id,
    status: 'approved' as const,
    category,
    region: null,
    trust_score: trust,
    warnings: [],
    summary: null,
    editorial_notes: null,
    summary_model: null,
    summary_model_version: null,
    prompt_version: null,
    script_text: null,
    screen_text: null,
    ticker_text: null,
    audio_path: null,
    audio_duration_seconds: null,
  } satisfies ArticleDetailRecord;
}

describe('broadcast planner fallback', () => {
  it('filters stale and low-trust contributions before planning', () => {
    const candidates = filterBroadcastCandidates(
      [article('a', 'Politik', 'one', 2), article('b', 'Sport', 'two', 100), article('c', 'Kultur', 'three', 2, 20)],
      options,
      now,
    );
    expect(candidates.map((candidate) => candidate.id)).toEqual(['a']);
  });

  it('creates a deterministic, diverse plan without an AI response', () => {
    const result = deterministicBroadcastPlan({
      channelName: 'Zeitkante',
      articles: [
        article('a', 'Politik', 'one', 1),
        article('b', 'Politik', 'one', 2),
        article('c', 'Wirtschaft', 'two', 3),
        article('d', 'Kultur', 'three', 4),
      ],
      options,
      now,
    });
    expect(result.name).toContain('Zeitkante');
    expect(result.articleIds).toHaveLength(4);
    expect(result.articleIds[0]).toBe('a');
    expect(result.articleIds[1]).not.toBe('b');
    expect(result.rationale).toContain('Ersatzplan');
  });
});
