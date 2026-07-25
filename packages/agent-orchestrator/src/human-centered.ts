export type HumanImpactLevel = 'low' | 'moderate' | 'high' | 'prohibited';

export type HumanImpactAssessment = {
  level: HumanImpactLevel;
  summary: string;
  affectedPeople: string[];
  safeguards: string[];
  prohibitedObjective: boolean;
  humanReviewRequired: boolean;
  matchedSignals: string[];
};

const PROHIBITED_OBJECTIVES = [
  /\b(?:alle|sämtliche)\s+(?:menschen|mitarbeit(?:er|ende)|beschäftigte)\s+(?:vollständig\s+)?ersetzen\b/giu,
  /\b(?:ersetze|ersetzt|ersetzen)\s+(?:alle|sämtliche)?\s*(?:menschen|mitarbeit(?:er|ende)|beschäftigte)\b/giu,
  /\b(?:menschen|mitarbeit(?:er|ende)|beschäftigte)\s+(?:überflüssig|entbehrlich)\s+machen\b/giu,
  /\b(?:mache|macht|machen)\s+(?:alle|sämtliche)?\s*(?:menschen|mitarbeit(?:er|ende)|beschäftigte)\s+(?:überflüssig|entbehrlich)\b/giu,
  /\b(?:arbeitsplätze|stellen)\s+(?:beseitigen|vernichten|abschaffen)\b/giu,
  /\bpersonalabbau\s+(?:maximieren|beschleunigen|erzwingen)\b/giu,
  /\b(?:ohne|keine)\s+menschliche(?:n)?\s+(?:mitarbeiter|beschäftigte|redaktion|verantwortung)\b/giu,
] as const;

const HUMAN_IMPACT_SIGNALS = [
  /\b(?:mitarbeiter|mitarbeitende|beschäftigte|personal|arbeitsplatz|arbeitsplätze|stellenabbau|entlassung)\b/giu,
  /\b(?:rolle|rollen|zuständigkeit|zuständigkeiten|schichtplan|arbeitsablauf|arbeitsabläufe|leistungsbewertung)\b/giu,
  /\b(?:vollautomatisch|autonom|ersetzen|reduzieren|abbauen)\b/giu,
] as const;

function boundedText(value: unknown, maximum = 40_000) {
  if (typeof value === 'string') return value.slice(0, maximum);
  try {
    return JSON.stringify(value).slice(0, maximum);
  } catch {
    return '';
  }
}

function isNegated(text: string, index: number) {
  const context = text.slice(Math.max(0, index - 55), index).toLocaleLowerCase('de-DE');
  return /\b(?:nicht|niemals|kein(?:e|en|er|es)?|verhindert?|verboten|ohne das ziel)\b/.test(context);
}

export function assessHumanImpact(input: {
  title?: unknown;
  instruction?: unknown;
  proposal?: unknown;
}): HumanImpactAssessment {
  const text = [boundedText(input.title), boundedText(input.instruction), boundedText(input.proposal)]
    .filter(Boolean)
    .join('\n');
  const prohibitedMatches = PROHIBITED_OBJECTIVES.flatMap((pattern) => {
    pattern.lastIndex = 0;
    return [...text.matchAll(pattern)]
      .filter((match) => !isNegated(text, match.index ?? 0))
      .map((match) => match[0].slice(0, 160));
  });
  const impactMatches = HUMAN_IMPACT_SIGNALS.flatMap((pattern) => {
    pattern.lastIndex = 0;
    return [...text.matchAll(pattern)].map((match) => match[0].slice(0, 160));
  });
  const prohibitedObjective = prohibitedMatches.length > 0;
  const highImpact = !prohibitedObjective && impactMatches.length >= 2;
  const moderateImpact = !prohibitedObjective && !highImpact && impactMatches.length > 0;
  const level: HumanImpactLevel = prohibitedObjective
    ? 'prohibited'
    : highImpact
      ? 'high'
      : moderateImpact
        ? 'moderate'
        : 'low';
  return {
    level,
    summary: prohibitedObjective
      ? 'Der Entwurf behandelt die Beseitigung menschlicher Arbeit oder Verantwortung als Ziel und darf nicht umgesetzt werden.'
      : highImpact
        ? 'Der Entwurf kann Rollen, Zuständigkeiten oder Arbeitsabläufe von Menschen wesentlich verändern und benötigt eine menschliche Folgenprüfung.'
        : moderateImpact
          ? 'Der Entwurf berührt menschliche Arbeitsabläufe; Auswirkungen und Eingriffsmöglichkeiten müssen transparent bleiben.'
          : 'Keine wesentliche Auswirkung auf Beschäftigung oder menschliche Entscheidungsgewalt erkannt.',
    affectedPeople: impactMatches.length ? ['Redaktion', 'Produktion', 'Regie', 'Senderleitung'] : [],
    safeguards: [
      'Menschliche Letztverantwortung und jederzeitiger Not-Aus',
      'Erklärbarer Vorschlag mit sichtbaren Daten, Unsicherheiten und Alternativen',
      'Keine autonome Einstellung, Kündigung oder Leistungsbewertung von Menschen',
      'Rückrollbarer Testbetrieb vor dauerhafter Aktivierung',
      'Automation erweitert menschliche Fähigkeiten; Personalabbau ist kein Optimierungsziel',
    ],
    prohibitedObjective,
    humanReviewRequired: prohibitedObjective || highImpact,
    matchedSignals: [...new Set([...prohibitedMatches, ...impactMatches])].slice(0, 20),
  };
}

export const HUMAN_CENTERED_AI_PRINCIPLES = [
  'KI unterstützt Menschen und erweitert ihre Handlungsmöglichkeiten.',
  'Personalabbau oder die Beseitigung menschlicher Arbeit ist kein Optimierungsziel.',
  'Einstellung, Kündigung, Sanktion und Leistungsbewertung von Menschen bleiben außerhalb autonomer Agentenbefugnisse.',
  'Folgenreiche Änderungen benötigen verständliche Begründung, menschliche Freigabe, Widerspruch und Rückrollbarkeit.',
  'Menschen können Automation jederzeit pausieren, übersteuern oder beenden.',
] as const;
