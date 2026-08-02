import { describe, expect, it } from 'vitest';
import { youtubeShowCueTargetCount, type YoutubeShowCueTarget, type YoutubeShowScriptAiOutput } from '@ans/ai-provider';
import {
  validateYoutubeShowScript,
  youtubeShowCueTargets,
  youtubeVideoNeedsGermanTranslation,
} from '../apps/api/src/youtube-preproduction.js';

const presenters = [
  'moderator',
  'presenter-leon',
  'presenter-lea',
  'presenter-jonas',
  'chat-moderator',
  'presenter-karim',
] as const;

const names = {
  none: '',
  moderator: 'Ava',
  'presenter-leon': 'Leon',
  'presenter-lea': 'Lea',
  'presenter-jonas': 'Jonas',
  'chat-moderator': 'Mia',
  'presenter-karim': 'Karim',
  translator: 'Nora',
} as const;

function completeScript(durationSeconds = 3_600, translateToGerman = false): YoutubeShowScriptAiOutput {
  const targets = youtubeShowCueTargets(durationSeconds, translateToGerman);
  return {
    editorialSummary:
      'Eine vollständige, transkriptgebundene TV-Einordnung mit Intro, verteilten Perspektiven und einem abschließenden, überprüfbaren Fazit.',
    cues: targets.map((target, index) => ({
      ...target,
      sourceStartSeconds: target.kind === 'intro' ? 0 : Math.max(0, target.atSeconds - 35),
      sourceEndSeconds: target.kind === 'intro' ? 0 : target.atSeconds,
      displayMode: target.kind === 'intro' || target.kind === 'closing' ? 'takeover' : 'inline',
      headline: target.kind === 'intro' ? 'Willkommen zur Einordnung' : `Einordnung ${index}`,
      speakerText: spokenDiscussionText(target),
      audiencePrompt: index % 5 === 0 ? 'Welche Quelle ergänzt diesen Punkt aus eurer Sicht?' : '',
      sourceExcerpt:
        target.kind === 'intro' || target.kind === 'closing'
          ? ''
          : `Konkreter Transkriptausschnitt für den Sendungs-Cue ${index}.`,
      wit: false,
    })),
  };
}

function spokenDiscussionText(target: YoutubeShowCueTarget) {
  if (target.presenterId === 'translator')
    return 'Die Passage wird vollständig und bedeutungstreu auf Deutsch wiedergegeben, ohne dabei eine eigene Bewertung hinzuzufügen.';
  const response =
    target.respondsToPresenterId === 'none' ? '' : `${names[target.respondsToPresenterId]}, dein Punkt ist wichtig. `;
  const handoff =
    target.handoffToPresenterId === 'none'
      ? ''
      : ` ${names[target.handoffToPresenterId]}, wie ordnest du diese Folge ein?`;
  return `${response}Diese konkrete Passage wird als Aussage des Beitrags eingeordnet; Beleglage, Kontext und offene Schlussfolgerungen bleiben klar getrennt.${handoff}`;
}

describe('Codex-YouTube-Vorproduktion', () => {
  it('erzwingt über die gesamte Laufzeit Einordnungen im Abstand von 20 bis 40 Sekunden', () => {
    expect(youtubeShowCueTargetCount(600)).toBe(16);
    expect(youtubeShowCueTargetCount(3_600)).toBe(91);
    expect(youtubeShowCueTargetCount(24 * 3_600)).toBe(2_161);
    const times = youtubeShowCueTargets(3_600, false).map((target) => target.atSeconds);
    expect(times.every((time, index) => index === 0 || time - times[index - 1]! >= 20)).toBe(true);
    expect(times.every((time, index) => index === 0 || time - times[index - 1]! <= 40)).toBe(true);
  });

  it('akzeptiert nur ein vollständiges, hörbar verknüpftes Mehrstimmen-Manuskript', () => {
    const cues = validateYoutubeShowScript(completeScript(), 3_600);
    expect(cues).toHaveLength(91);
    expect(cues[0]!.kind).toBe('intro');
    expect(cues.at(-1)!.kind).toBe('closing');
    expect(new Set(cues.map((cue) => cue.presenterId))).toEqual(new Set(presenters));
    expect(cues.slice(1).every((cue) => cue.respondsToPresenterId !== 'none')).toBe(true);
  });

  it('gibt auch kurzen Videos eine echte Diskussion mit allen sechs Moderatoren', () => {
    const targets = youtubeShowCueTargets(30, false);
    expect(targets).toHaveLength(6);
    expect(new Set(targets.map((target) => target.presenterId))).toEqual(new Set(presenters));
    expect(new Set(targets.map((target) => target.atSeconds))).toEqual(new Set([0, 29]));
    expect(targets.filter((target) => target.atSeconds === 29)).toHaveLength(5);
    expect(validateYoutubeShowScript(completeScript(30), 30, targets)).toHaveLength(6);
  });

  it('plant bei fremdsprachigen Videos Nora vor jeder Moderatoreneinordnung ein', () => {
    const targets = youtubeShowCueTargets(600, true);
    expect(targets.filter((target) => target.presenterId === 'translator')).toHaveLength(16);
    expect(
      targets
        .filter((target) => target.kind === 'translation')
        .every((target) => target.handoffToPresenterId !== 'none'),
    ).toBe(true);
    expect(
      targets
        .filter((target) => target.presenterId !== 'translator' && target.kind !== 'intro')
        .every((target) => target.respondsToPresenterId !== 'translator'),
    ).toBe(true);
    expect(validateYoutubeShowScript(completeScript(600, true), 600, targets)).toHaveLength(32);
    expect(
      youtubeVideoNeedsGermanTranslation({
        title: 'Migration Crisis in Ceuta - LIVE Breaking News Coverage',
        transcript_language: 'de',
        transcript_source: 'yt-dlp',
        source_language: 'en',
      }),
    ).toBe(true);
  });

  it('verwirft Pakete, die den verbindlichen Cue- und Diskussionsplan verändern', () => {
    const script = completeScript();
    script.cues.at(-1)!.kind = 'context';
    expect(() => validateYoutubeShowScript(script, 3_600)).toThrow(/verbindlichen Sendeplan/);
  });
});
