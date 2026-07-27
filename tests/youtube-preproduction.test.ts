import { describe, expect, it } from 'vitest';
import { generateYoutubePreproducedCues } from '../apps/api/src/youtube-preproduction.js';

function video(durationSeconds = 3_600) {
  const transcript_segments = Array.from({ length: durationSeconds / 10 }, (_, index) => ({
    startMs: index * 10_000,
    durationMs: 9_000,
    text: `Abschnitt ${index}: Der Beitrag beschreibt eine konkrete Entwicklung und nennt dazu einen überprüfbaren Zusammenhang.`,
  }));
  return {
    id: '00000000-0000-4000-8000-000000000001',
    title: 'Ein langes Testvideo',
    duration_seconds: durationSeconds,
    transcript_text: transcript_segments.map((segment) => segment.text).join(' '),
    transcript_segments,
    editorial_analysis: null,
  } as any;
}

describe('YouTube-Vorproduktion', () => {
  it('verteilt sendefertige Wortmeldungen über ein langes Video und alle sechs Stimmen', () => {
    const input = video();
    const cues = generateYoutubePreproducedCues(input);
    expect(cues.length).toBeGreaterThanOrEqual(12);
    expect(cues[0]!.atMs).toBeLessThan(60_000);
    expect(cues.at(-1)!.atMs).toBeGreaterThan(2_700_000);
    expect(new Set(cues.map((cue) => cue.presenterId))).toEqual(
      new Set([
        'moderator',
        'chat-moderator',
        'presenter-lea',
        'presenter-leon',
        'presenter-jonas',
        'presenter-karim',
      ]),
    );
    expect(cues.every((cue) => cue.speakerText.length >= 90)).toBe(true);
    expect(cues.every((cue) => cue.sourceExcerpt)).toBe(true);
    expect(cues.every((cue) => Number(cue.sourceEndMs) < cue.atMs)).toBe(true);
    expect(
      [...new Set(cues.map((cue) => cue.atMs))].some(
        (pauseMs) => cues.filter((cue) => cue.atMs === pauseMs).length >= 2,
      ),
    ).toBe(true);
    expect(cues.some((cue) => /Ava|Leon|Lea|Jonas|Mia|Karim/.test(cue.speakerText))).toBe(true);
    expect(cues.every((cue) => !cue.speakerText.includes(input.title))).toBe(true);
  });

  it('übernimmt keine isolierten Alttexte und erzeugt stattdessen einen verbundenen Dialog', () => {
    const input = video(600);
    input.editorial_analysis = {
      pauseMoments: [
        {
          atPercent: 5,
          headline: 'Aussage',
          text: 'Der Transkript-Analyse zeigt 24 unterschiedliche Moderationspausen.',
        },
      ],
    };
    const cues = generateYoutubePreproducedCues(input);
    expect(cues[0]!.speakerText).not.toContain('Transkript-Analyse');
    expect(cues[0]!.speakerText).toContain('Wir steigen direkt in die Sache ein');
    expect(cues[1]!.speakerText).toMatch(/Ava|Leon|Lea|Jonas|Mia|Karim/);
    expect(cues[1]!.speakerText).not.toMatch(/knüpft an|ordnet ein/i);
    expect(cues[1]!.atMs).toBe(cues[0]!.atMs);
    expect(cues[1]!.sourceExcerpt).toBe(cues[0]!.sourceExcerpt);
  });
});
