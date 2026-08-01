import { describe, expect, it } from 'vitest';
import { youtubeShowCueTargetCount, type YoutubeShowScriptAiOutput } from '@ans/ai-provider';
import { validateYoutubeShowScript } from '../apps/api/src/youtube-preproduction.js';

const presenters = [
  'moderator',
  'presenter-leon',
  'presenter-lea',
  'presenter-jonas',
  'chat-moderator',
  'presenter-karim',
] as const;

function completeScript(durationSeconds = 3_600): YoutubeShowScriptAiOutput {
  const count = youtubeShowCueTargetCount(durationSeconds);
  return {
    editorialSummary:
      'Eine vollständige, transkriptgebundene TV-Einordnung mit Intro, verteilten Perspektiven und einem abschließenden, überprüfbaren Fazit.',
    cues: Array.from({ length: count }, (_, index) => {
      const intro = index === 0;
      const closing = index === count - 1;
      const atSeconds = intro
        ? 0
        : closing
          ? Math.floor(durationSeconds * 0.94)
          : Math.floor((index / (count - 1)) * durationSeconds * 0.92);
      return {
        atSeconds,
        sourceStartSeconds: intro || closing ? 0 : Math.max(0, atSeconds - 24),
        sourceEndSeconds: intro || closing ? 0 : Math.max(0, atSeconds - 2),
        presenterId: presenters[index % presenters.length]!,
        kind: intro ? ('intro' as const) : closing ? ('closing' as const) : ('context' as const),
        displayMode: intro || closing ? ('takeover' as const) : ('inline' as const),
        headline: intro ? 'Willkommen zur Einordnung' : closing ? 'Unser Fazit' : `Einordnung ${index}`,
        speakerText:
          'Diese konkrete Passage wird als Aussage des Beitrags eingeordnet; Beleglage, Kontext und noch offene Schlussfolgerungen bleiben dabei klar voneinander getrennt.',
        audiencePrompt: index % 5 === 0 ? 'Welche Quelle ergänzt diesen Punkt aus eurer Sicht?' : '',
        sourceExcerpt: intro || closing ? '' : `Konkreter Transkriptausschnitt für den Sendungs-Cue ${index}.`,
        wit: false,
      };
    }),
  };
}

describe('Codex-YouTube-Vorproduktion', () => {
  it('fordert für lange Videos eine dichte und begrenzte Sendungsdramaturgie', () => {
    expect(youtubeShowCueTargetCount(600)).toBe(6);
    expect(youtubeShowCueTargetCount(3_600)).toBe(26);
    expect(youtubeShowCueTargetCount(24 * 3_600)).toBe(72);
  });

  it('akzeptiert nur ein vollständiges, zeitcodiertes Mehrstimmen-Manuskript', () => {
    const cues = validateYoutubeShowScript(completeScript(), 3_600);
    expect(cues).toHaveLength(26);
    expect(cues[0]!.kind).toBe('intro');
    expect(cues.at(-1)!.kind).toBe('closing');
    expect(new Set(cues.map((cue) => cue.presenterId))).toEqual(new Set(presenters));
    expect(cues.every((cue, index) => index === 0 || cue.atSeconds > cues[index - 1]!.atSeconds)).toBe(true);
  });

  it('verwirft Pakete ohne Schlussmoderation statt einen lokalen Fallback zu senden', () => {
    const script = completeScript();
    script.cues.at(-1)!.kind = 'context';
    expect(() => validateYoutubeShowScript(script, 3_600)).toThrow(/Schlussfazit/);
  });
});
