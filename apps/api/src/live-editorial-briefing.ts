import type { HostBriefingAiOutput } from '@ans/ai-provider';
import type { AiHostResearchPackage, AiHostResearchSource } from './ai-host-research.js';

export type LiveEditorialVideo = {
  title: string;
  channel_title: string;
  description?: string | null;
  category_name?: string | null;
  url: string;
};

export type LiveEditorialCard = {
  kind: 'claim' | 'context' | 'fact-check' | 'question';
  headline: string;
  text: string;
  sourceLabel: string;
};

export type LiveEditorialBriefing = HostBriefingAiOutput & {
  cards: LiveEditorialCard[];
  liveResearch: {
    mode: 'metadata-only' | 'researched';
    transcriptAvailable: false;
    researchedAt: string | null;
    confidence: AiHostResearchPackage['confidence'] | 'none';
    sources: Array<{
      title: string;
      publisher: string;
      url: string;
      trustScore: number;
    }>;
  };
};

function clean(value: unknown, maximum: number) {
  return String(value ?? '')
    .replace(/<[^>]+>/g, ' ')
    .replace(/\s+/g, ' ')
    .trim()
    .slice(0, maximum);
}

function unique(values: string[], maximum: number, itemMaximum: number) {
  return [...new Set(values.map((value) => clean(value, itemMaximum)).filter(Boolean))].slice(0, maximum);
}

function announcedTopic(title: string) {
  return (
    clean(title, 420)
      .replace(/^(?:live|livestream|jetzt live)\s*[❗!|:–—-]*/iu, '')
      .replace(/\s*[|·]\s*(?:live|livestream)\s*$/iu, '')
      .trim() || 'das angekündigte Thema'
  );
}

function shortSourceHint(source: AiHostResearchSource) {
  const words = clean(source.excerpt, 500).split(/\s+/).filter(Boolean).slice(0, 22);
  const excerpt = words.join(' ').replace(/[,:;–—-]+$/u, '');
  return excerpt ? `Der Recherchetreffer nennt: „${excerpt}${words.length >= 22 ? ' …' : ''}“` : '';
}

function researchCard(source: AiHostResearchSource, index: number): LiveEditorialCard {
  const hint = shortSourceHint(source);
  return {
    kind: index === 0 ? 'fact-check' : 'context',
    headline: index === 0 ? 'Was die Redaktion belegen kann' : `Weiterer Kontext: ${clean(source.title, 90)}`,
    text: clean(
      `${source.publisher} führt „${source.title}“ als relevanten Hintergrund. ${hint} Der Hinweis wird als Ausgangspunkt für die Prüfung genutzt, nicht als Beleg für jede Aussage im Livestream.`,
      1_000,
    ),
    sourceLabel: clean(`${source.publisher} · ${source.title}`, 180),
  };
}

export function liveEditorialResearchQuestion(video: LiveEditorialVideo) {
  return clean(`${announcedTopic(video.title)}: Hintergrund, Veranstalter und öffentlich belegbare Informationen`, 500);
}

export function buildLiveEditorialBriefing(input: {
  video: LiveEditorialVideo;
  aiBriefing?: HostBriefingAiOutput | null;
  research?: AiHostResearchPackage | null;
}): LiveEditorialBriefing {
  const { video } = input;
  const topic = announcedTopic(video.title);
  const channel = clean(video.channel_title, 180) || 'dem sendenden YouTube-Kanal';
  const description = clean(video.description, 700);
  const sources = (input.research?.sources ?? []).slice(0, 3);
  const hasResearch = sources.length > 0;
  const metadataSummary =
    `Wir begleiten den von ${channel} angekündigten Livestream „${topic}“. ` +
    'Da noch kein belastbares Transkript vorliegt, trennt die Redaktion sichtbar zwischen Programmbeschreibung, recherchiertem Hintergrund und offenen Aussagen.';
  const neutralSummary = clean(
    input.aiBriefing?.neutralSummary
      ? `${input.aiBriefing.neutralSummary} ${metadataSummary}`
      : description
        ? `${metadataSummary} Der Kanal beschreibt die Sendung so: ${description}`
        : metadataSummary,
    900,
  );
  const sourceContext = hasResearch
    ? `Die Redaktion hat ${sources.length} öffentliche Recherchetreffer zum angekündigten Thema gefunden. Sie dienen zur Orientierung; Aussagen des laufenden Videos werden erst mit konkreten Belegen als bestätigt behandelt.`
    : 'Bis belastbare Quellen oder ein Transkript vorliegen, moderiert die Redaktion anhand der sicheren Sendemetadaten und kennzeichnet alle inhaltlichen Punkte als offene Prüfaufträge.';
  const context = clean(
    input.aiBriefing?.context ? `${input.aiBriefing.context} ${sourceContext}` : sourceContext,
    900,
  );
  const keyClaims = unique(
    [
      `Sicher ist: Der Kanal ${channel} sendet unter dem Titel „${topic}“.`,
      ...(input.aiBriefing?.keyClaims ?? []).map((claim) => `Als Thema des Videos angekündigt: ${claim}`),
      ...sources.map((source) => `Recherchehinweis: ${source.publisher} führt „${source.title}“ zum Thema.`),
    ],
    6,
    300,
  );
  const uncertainties = unique(
    [
      'Ohne Transkript kann die Redaktion einzelne Aussagen des laufenden Streams noch nicht wortgetreu prüfen.',
      'Programmtitel und Kanalbeschreibung sind Selbstdarstellungen und noch kein unabhängiger Beleg.',
      ...(input.aiBriefing?.uncertainties ?? []),
      ...(input.research?.errors ?? []).map(() => 'Mindestens ein Rechercheweg war vorübergehend nicht erreichbar.'),
    ],
    6,
    300,
  );
  const criticalQuestions = unique(
    [
      `Welche konkrete Aussage zu „${topic}“ ist für euch zentral – und mit welcher Quelle lässt sie sich prüfen?`,
      'Welche Entscheidung sollte beim Einzelnen bleiben, und wo beginnen nachvollziehbar die Rechte anderer?',
      'Welche Gegenposition fehlt bisher im Stream oder wird zu schwach dargestellt?',
      'Welche praktische Folge hätte die gerade vertretene Position für euren Alltag?',
      ...(input.aiBriefing?.criticalQuestions ?? []),
    ],
    8,
    260,
  );
  const chatPrompts = unique(
    [
      'Welche Aussage sollen AVA und die Redaktion als Nächstes prüfen?',
      'Schreibt eure begründete Gegenposition oder Zustimmung in den Chat.',
      ...(input.aiBriefing?.chatPrompts ?? []),
    ],
    6,
    220,
  );
  const cards = (
    [
      {
        kind: 'context',
        headline: 'Was wir sicher wissen',
        text: clean(
          `Der Livestream läuft beim Kanal ${channel} und ist als „${topic}“ angekündigt. Alles Weitere wird während der Sendung als Aussage, Beobachtung oder recherchierter Beleg kenntlich gemacht.`,
          1_000,
        ),
        sourceLabel: `YouTube-Programmdaten · ${channel}`,
      },
      ...sources.map(researchCard),
      {
        kind: 'context',
        headline: 'Freiheitlicher Prüfstein',
        text: 'Entscheidend ist nicht nur, ob eine Forderung attraktiv klingt. Wir fragen: Wer entscheidet, wer trägt die Folgen, welche Rechte anderer sind betroffen und lässt sich ein Zwang wirklich begründen?',
        sourceLabel: 'Zeitkante Redaktion',
      },
      {
        kind: 'fact-check',
        headline: 'Behauptung oder Beleg?',
        text: 'Achtet auf den Unterschied zwischen persönlicher Erfahrung, politischer Forderung und überprüfbarer Tatsachenbehauptung. AVA greift konkrete Belege und erkennbare Lücken im weiteren Verlauf auf.',
        sourceLabel: 'Redaktioneller Prüfrahmen',
      },
      {
        kind: 'question',
        headline: 'Eure Perspektive',
        text: criticalQuestions[0]!,
        sourceLabel: 'Livechat · YouTube und Twitch',
      },
    ] satisfies LiveEditorialCard[]
  ).slice(0, 8);
  while (cards.length < 4) {
    cards.push({
      kind: 'question',
      headline: 'Frage an euch',
      text: criticalQuestions[cards.length % criticalQuestions.length]!,
      sourceLabel: 'Livechat',
    });
  }
  return {
    neutralSummary,
    context,
    keyClaims: keyClaims.length ? keyClaims : [`Angekündigtes Thema: ${topic}`],
    uncertainties,
    criticalQuestions,
    chatPrompts,
    cards,
    liveResearch: {
      mode: hasResearch ? 'researched' : 'metadata-only',
      transcriptAvailable: false,
      researchedAt: input.research?.researchedAt ?? null,
      confidence: input.research?.confidence ?? 'none',
      sources: sources.map((source) => ({
        title: source.title,
        publisher: source.publisher,
        url: source.url,
        trustScore: source.trustScore,
      })),
    },
  };
}
