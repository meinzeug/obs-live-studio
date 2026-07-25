import { describe, expect, it } from 'vitest';
import { buildLiveEditorialBriefing, liveEditorialResearchQuestion } from '../apps/api/src/live-editorial-briefing.js';

const video = {
  title: 'LIVE ❗ Libertäres Fest Afuera Kulturfest der Freiheit in Sachsen-Anhalt 2026',
  channel_title: 'Utopia TV Deutschland',
  description: null,
  category_name: 'Politik',
  url: 'https://www.youtube.com/watch?v=example123',
};

describe('redaktioneller Live-Fallback', () => {
  it('creates specific, transparent moderation without pretending to have a transcript', () => {
    const briefing = buildLiveEditorialBriefing({ video });
    expect(briefing.neutralSummary).toContain('Utopia TV Deutschland');
    expect(briefing.neutralSummary).toContain('kein belastbares Transkript');
    expect(briefing.cards).toHaveLength(4);
    expect(briefing.cards.map((card) => card.headline)).toContain('Freiheitlicher Prüfstein');
    expect(briefing.criticalQuestions[0]).toContain('Libertäres Fest Afuera');
    expect(briefing.liveResearch).toMatchObject({
      mode: 'metadata-only',
      transcriptAvailable: false,
      confidence: 'none',
    });
  });

  it('rotates sourced context into bounded cards when research is available', () => {
    const briefing = buildLiveEditorialBriefing({
      video,
      research: {
        query: 'Afuera Kulturfest',
        terms: ['afuera', 'kulturfest'],
        researchedAt: '2026-07-24T20:00:00.000Z',
        errors: [],
        confidence: 'supported',
        verifiedFact: null,
        sources: [
          {
            kind: 'web',
            title: 'Programm und Veranstalter des Kulturfests',
            publisher: 'beispiel.de',
            url: 'https://beispiel.de/kulturfest',
            excerpt:
              'Das Programm nennt Vorträge, Diskussionen und Kulturbeiträge rund um Freiheit und individuelle Verantwortung.',
            publishedAt: null,
            trustScore: 72,
          },
        ],
      },
    });
    expect(briefing.liveResearch.mode).toBe('researched');
    expect(briefing.liveResearch.sources).toHaveLength(1);
    expect(briefing.cards.some((card) => card.sourceLabel.includes('beispiel.de'))).toBe(true);
    expect(briefing.cards.some((card) => card.text.includes('nicht als Beleg für jede Aussage'))).toBe(true);
  });

  it('uses topic-first search wording so broad helper terms do not displace the event name', () => {
    expect(liveEditorialResearchQuestion(video)).toMatch(/^Libertäres Fest Afuera/);
  });
});
