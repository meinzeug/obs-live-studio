import type { YoutubeVideoRecord } from '@ans/database';
import type { YoutubePreproducedCueDraft } from '@ans/database/youtube-preproduction';

export const YOUTUBE_PREPRODUCTION_GENERATOR_VERSION = 'grounded-six-host-dialogue-v4-semantic-pause';

const presenterCycle = [
  'moderator',
  'presenter-leon',
  'presenter-lea',
  'presenter-jonas',
  'chat-moderator',
  'presenter-karim',
] as const;

const presenterNames: Record<(typeof presenterCycle)[number], string> = {
  moderator: 'Ava',
  'presenter-leon': 'Leon',
  'presenter-lea': 'Lea',
  'presenter-jonas': 'Jonas',
  'chat-moderator': 'Mia',
  'presenter-karim': 'Karim',
};

type EditorialFrame = 'general' | 'left-authoritarian-hypocrisy';

type TranscriptSegment = { startMs: number; durationMs: number; text: string };

type ExistingPause = {
  atPercent?: unknown;
  headline?: unknown;
  text?: unknown;
  question?: unknown;
  displayMode?: unknown;
  wit?: unknown;
  presenterId?: unknown;
};

function clean(value: unknown, maximum = 1_400) {
  return String(value ?? '')
    .replace(/\[[^\]]{1,80}\]/g, ' ')
    .replace(/\((?:[^)]{0,45})(?:musik|gelächter|klackern|applaus|unverständlich)(?:[^)]{0,45})\)/gi, ' ')
    .replace(/https?:\/\/\S+/gi, ' ')
    .replace(/\s+/g, ' ')
    .trim()
    .slice(0, maximum);
}

function sentenceExcerpt(value: string, maximum = 360) {
  const normalized = clean(value, maximum * 2);
  if (!normalized) return '';
  const sentences = normalized
    .split(/(?<=[.!?])\s+/)
    .map((sentence) => sentence.trim())
    .filter((sentence) => sentence.length >= 18);
  const score = (sentence: string) => {
    const words = sentence.split(/\s+/).filter(Boolean);
    let value = Math.min(80, sentence.length) + Math.min(30, words.length * 2);
    if (sentence.length >= 55 && sentence.length <= 320) value += 45;
    if (/[.!?]$/.test(sentence)) value += 12;
    if (/^(?:ja|nein|also|und|aber|so|okay|genau|äh|hm)\b/i.test(sentence)) value -= 28;
    if (/\b(?:titel dieses videos|abonniert|glocke|werbung|link in der beschreibung)\b/i.test(sentence)) value -= 100;
    if (words.length < 7) value -= 60;
    if (new Set(words.map((word) => word.toLocaleLowerCase('de-DE'))).size < words.length * 0.55) value -= 45;
    return value;
  };
  const selected = [...sentences].sort((left, right) => score(right) - score(left))[0] ?? normalized;
  const clipped = selected.slice(0, maximum).replace(/[,;:–-]\s*[^,;:–-]{0,25}$/, '').trim();
  return clipped && /[.!?]$/.test(clipped) ? clipped : `${clipped}.`;
}

function safeHeadline(excerpt: string, fallback: string) {
  const words = clean(excerpt, 240)
    .replace(/[.!?].*$/, '')
    .split(/\s+/)
    .filter(Boolean)
    .slice(0, 9);
  const headline = clean(words.join(' '), 110);
  return headline ? `${headline.charAt(0).toLocaleUpperCase('de-DE')}${headline.slice(1)}` : fallback;
}

function sensitive(...values: string[]) {
  return /\b(tod|tote|sterben|mord|suizid|missbrauch|vergewalt|krieg|anschlag|opfer|kind(?:er)?|krankheit|unfall|gewalt|nazi)\b/i.test(
    values.join(' '),
  );
}

function semanticTranscriptPause(segments: TranscriptSegment[], targetMs: number, durationMs: number) {
  const candidates = segments
    .map((segment) => ({
      segment,
      endMs: segment.startMs + Math.max(250, segment.durationMs),
    }))
    .filter(({ endMs }) => endMs >= targetMs - 18_000 && endMs <= targetMs + 12_000)
    .sort((left, right) => {
      const score = (candidate: (typeof left)) => {
        const text = candidate.segment.text.trim();
        const boundaryBonus = /[.!?][”"'’)]?$/.test(text) ? 8_000 : /[,;:][”"'’)]?$/.test(text) ? 3_000 : 0;
        const substanceBonus = text.length >= 45 ? 2_500 : 0;
        return Math.abs(candidate.endMs - targetMs) - boundaryBonus - substanceBonus;
      };
      return score(left) - score(right);
    });
  const anchor =
    candidates[0] ??
    [...segments]
      .map((segment) => ({
        segment,
        endMs: segment.startMs + Math.max(250, segment.durationMs),
      }))
      .sort((left, right) => Math.abs(left.endMs - targetMs) - Math.abs(right.endMs - targetMs))[0];
  const sourceEndMs = Math.min(durationMs, anchor?.endMs ?? targetMs);
  const sourceStartLimit = Math.max(0, sourceEndMs - 38_000);
  let selected = segments.filter((segment) => {
    const segmentEnd = segment.startMs + Math.max(250, segment.durationMs);
    return segmentEnd > sourceStartLimit && segmentEnd <= sourceEndMs + 50;
  });
  if (!selected.length && anchor) selected = [anchor.segment];
  return {
    atMs: Math.max(2_000, Math.min(durationMs - 1_000, sourceEndMs + 350)),
    startMs: selected[0]?.startMs ?? Math.max(0, sourceEndMs - 8_000),
    endMs: sourceEndMs,
    text: sentenceExcerpt(selected.map((segment) => segment.text).join(' ')),
  };
}

function denseCuePlan(durationMs: number) {
  const durationMinutes = durationMs / 60_000;
  if (durationMinutes <= 1.25) return { anchorIntervalSeconds: 999, chainLength: 2, maxCues: 3 };
  if (durationMinutes <= 8) return { anchorIntervalSeconds: 70, chainLength: 2, maxCues: 10 };
  if (durationMinutes <= 20) return { anchorIntervalSeconds: 78, chainLength: 2, maxCues: 22 };
  if (durationMinutes <= 60) return { anchorIntervalSeconds: 90, chainLength: 3, maxCues: 54 };
  if (durationMinutes <= 180) return { anchorIntervalSeconds: 115, chainLength: 3, maxCues: 96 };
  return { anchorIntervalSeconds: 145, chainLength: 3, maxCues: 120 };
}

function targetTimes(durationMs: number) {
  if (durationMs <= 75_000) return [Math.min(8_000, durationMs * 0.2), Math.max(12_000, durationMs * 0.72)];
  const plan = denseCuePlan(durationMs);
  const durationSeconds = durationMs / 1000;
  const targets: number[] = [];
  for (let second = 24; second < durationSeconds * 0.95; second += plan.anchorIntervalSeconds) {
    targets.push(second * 1000);
  }
  if (targets.length < 3) {
    for (const fraction of [0.16, 0.48, 0.8]) targets.push(durationMs * fraction);
  }
  return [...new Set(targets.map((value) => Math.max(5_000, Math.min(durationMs - 3_000, Math.floor(value)))))]
    .sort((left, right) => left - right);
}

function cueMoments(durationMs: number, segments: TranscriptSegment[]) {
  const semanticAnchors = targetTimes(durationMs)
    .map((targetMs) => semanticTranscriptPause(segments, targetMs, durationMs))
    .filter(
      (anchor, index, all) =>
        index === 0 || Math.abs(anchor.atMs - all[index - 1]!.atMs) >= 5_000,
    );
  const plan = denseCuePlan(durationMs);
  const maximumAnchorCount = Math.max(1, Math.floor(plan.maxCues / plan.chainLength));
  const anchors =
    semanticAnchors.length <= maximumAnchorCount
      ? semanticAnchors
      : Array.from({ length: maximumAnchorCount }, (_, index) => {
          const sourceIndex =
            maximumAnchorCount === 1
              ? 0
              : Math.round((index * (semanticAnchors.length - 1)) / (maximumAnchorCount - 1));
          return semanticAnchors[sourceIndex]!;
        });
  const moments: Array<{
    atMs: number;
    anchorIndex: number;
    chainIndex: number;
    window: ReturnType<typeof semanticTranscriptPause>;
  }> = [];
  for (const [anchorIndex, anchor] of anchors.entries()) {
    for (let chainIndex = 0; chainIndex < plan.chainLength; chainIndex += 1)
      moments.push({ atMs: anchor.atMs, anchorIndex, chainIndex, window: anchor });
  }
  return moments.slice(0, plan.maxCues);
}

function existingPauses(video: YoutubeVideoRecord, durationMs: number) {
  const pauses = Array.isArray(video.editorial_analysis?.pauseMoments)
    ? (video.editorial_analysis.pauseMoments as ExistingPause[])
    : [];
  return pauses
    .map((pause) => ({
      ...pause,
      atMs: Math.max(0, Math.min(durationMs, (Number(pause.atPercent) / 100) * durationMs)),
    }))
    .filter((pause) => Number.isFinite(pause.atMs) && clean(pause.text, 1_800).length >= 30);
}

function nearestExistingPause(pauses: ReturnType<typeof existingPauses>, atMs: number, intervalMs: number) {
  return pauses
    .filter((pause) => Math.abs(pause.atMs - atMs) <= intervalMs * 0.42)
    .sort((left, right) => Math.abs(left.atMs - atMs) - Math.abs(right.atMs - atMs))[0];
}

function spokenClaim(value: string) {
  return clean(value, 420)
    .replace(/^(?:abschnitt|kapitel|teil)\s+\d+\s*[:.–-]\s*/i, '')
    .replace(/^[„“"' ]+|[„“"' ]+$/g, '')
    .replace(/\s+([,.;!?])/g, '$1')
    .trim();
}

function conversationalOpening(input: {
  presenterId: (typeof presenterCycle)[number];
  previousPresenterId?: (typeof presenterCycle)[number];
  cueIndex: number;
}) {
  if (input.cueIndex === 0) return 'Wir steigen direkt in die Sache ein.';
  const directAnswers: Partial<
    Record<(typeof presenterCycle)[number], Partial<Record<(typeof presenterCycle)[number], string>>>
  > = {
    'presenter-leon': {
      moderator: 'Ava, zu deiner Frage nach der politischen Tragweite:',
    },
    'presenter-lea': {
      'presenter-leon': 'Leon, bei der Beleglage müssen wir zwei Ebenen auseinanderhalten.',
    },
    'presenter-jonas': {
      'presenter-lea': 'Lea, dein Prüfmaßstab führt direkt zu den praktischen Folgen.',
    },
    'chat-moderator': {
      'presenter-jonas': 'Jonas, genau diese Konsequenz dürfte auch unser Publikum beschäftigen.',
    },
    'presenter-karim': {
      'chat-moderator': 'Mia, aus den Reaktionen lässt sich vor allem eine Alltagsfrage ableiten.',
    },
    moderator: {
      'presenter-karim': 'Karim, damit können wir die Perspektiven der Runde zusammenführen.',
    },
  };
  const direct = input.previousPresenterId
    ? directAnswers[input.presenterId]?.[input.previousPresenterId]
    : undefined;
  if (direct) return direct;
  const previousName = input.previousPresenterId ? presenterNames[input.previousPresenterId] : '';
  const patterns = [
    previousName ? `Da gehe ich mit, ${previousName}.` : 'Diesen Gedanken sollten wir weiterführen.',
    previousName ? `Einen Punkt würde ich ergänzen, ${previousName}.` : 'Dazu gehört noch ein zweiter Blick.',
    previousName ? `${previousName}, genau an dieser Stelle lohnt sich ein Schritt zurück.` : 'Hier lohnt sich ein Schritt zurück.',
    previousName ? `Das führt deinen Gedanken weiter, ${previousName}.` : 'Das führt die bisherige Einordnung weiter.',
    previousName ? `Ich würde es an einem Punkt etwas anders gewichten, ${previousName}.` : 'Ich würde diesen Punkt etwas anders gewichten.',
  ];
  return patterns[(input.cueIndex - 1) % patterns.length]!;
}

function handoffToNext(
  presenterId: (typeof presenterCycle)[number],
  nextPresenterId: (typeof presenterCycle)[number] | undefined,
) {
  if (!nextPresenterId) return '';
  const nextName = presenterNames[nextPresenterId];
  const handoffs: Record<(typeof presenterCycle)[number], string> = {
    moderator: `${nextName}, welcher größere Zusammenhang folgt daraus – und welcher gerade nicht?`,
    'presenter-leon': `${nextName}, was davon ist belegt und wo beginnt die Interpretation?`,
    'presenter-lea': `${nextName}, welche konkrete Wirkung hätte das für Menschen und Ressourcen?`,
    'presenter-jonas': `${nextName}, welche Frage oder Gegenposition sollte unser Publikum jetzt in die Runde geben?`,
    'chat-moderator': `${nextName}, wie sieht dieser Streitpunkt außerhalb der politischen Schlagworte im Alltag aus?`,
    'presenter-karim': `${nextName}, welches faire Zwischenfazit ziehen wir daraus, bevor das Video weiterläuft?`,
  };
  return handoffs[presenterId];
}

function editorialFocuses(video: YoutubeVideoRecord) {
  const analysis =
    video.editorial_analysis && typeof video.editorial_analysis === 'object'
      ? (video.editorial_analysis as Record<string, unknown>)
      : {};
  const cards = Array.isArray(analysis.cards) ? analysis.cards : [];
  return cards
    .map((card) => {
      const record = card && typeof card === 'object' ? (card as Record<string, unknown>) : {};
      return {
        headline: clean(record.headline, 150),
        text: clean(record.text, 520),
        kind: clean(record.kind, 40),
      };
    })
    .filter(
      (card) =>
        card.text.length >= 45 &&
        !/\b(?:keine information|keine belege|titel dieses videos|abonniert|link in der beschreibung)\b/i.test(card.text),
    );
}

function detectEditorialFrame(video: YoutubeVideoRecord, excerpt: string) {
  const haystack = [
    clean(video.title, 240),
    clean(video.description, 600),
    clean(excerpt, 500),
    clean(JSON.stringify(video.editorial_analysis ?? {}), 2_400),
  ].join(' \n ');
  if (
    /\b(?:antifa|linke(?:r|n)?\b|gegendemo|denkverbot|brandmauer|wahlausschluss|ausschluss|transidentit|woke|cancel|klimaaktivist|demo(?:kratie)?abbau|sprechverbot|einschüchter|druck setzt|bedroh\w+)\b/i.test(
      haystack,
    )
  ) {
    return 'left-authoritarian-hypocrisy' as EditorialFrame;
  }
  return 'general' as EditorialFrame;
}

function usableFocus(value: string) {
  const words = clean(value, 600).split(/\s+/).filter(Boolean);
  return (
    words.length >= 8 &&
    new Set(words.map((word) => word.toLocaleLowerCase('de-DE'))).size >= words.length * 0.62 &&
    !/^(?:ja|nein|also|und|aber|so|okay|genau|äh|hm)\b/i.test(value) &&
    !/\b(?:titel dieses videos|abonniert|glocke|link in der beschreibung)\b/i.test(value)
  );
}

function localSpeakerText(input: {
  presenterId: (typeof presenterCycle)[number];
  previousPresenterId?: (typeof presenterCycle)[number];
  nextPresenterId?: (typeof presenterCycle)[number];
  excerpt: string;
  previousFocus?: string;
  cueIndex: number;
  cueCount: number;
  editorialFrame: EditorialFrame;
  chainIndex?: number;
}) {
  const claim = spokenClaim(input.excerpt) || 'Der gerade gehörte Gedanke braucht noch einen nachvollziehbaren Beleg.';
  const rapidFollowup = Number(input.chainIndex ?? 0) > 0;
  const opening = rapidFollowup
    ? [
        'Direkt dazu ein kurzer Einwand.',
        'Ich ziehe den Gedanken sofort weiter.',
        'Genau an dieser Stelle würde ich nachsetzen.',
        'Darauf antworte ich direkt.',
      ][(input.cueIndex - 1) % 4]!
    : conversationalOpening(input);
  const focusReference =
    input.previousFocus && input.cueIndex % 3 === 0
      ? `Unsere vorige Frage zu „${clean(input.previousFocus, 90)}“ bleibt dabei im Hintergrund. `
      : '';
  const templates: Record<(typeof presenterCycle)[number], (value: string) => string> = {
    moderator: (value) =>
      `${opening} ${focusReference}Gerade steht die Aussage „${value}“ im Raum. Ich möchte, dass wir nicht an der Formulierung hängen bleiben, sondern gemeinsam prüfen, was davon belegt ist und welche entscheidende Information noch fehlt.`,
    'presenter-leon': (value) =>
      `${opening} ${focusReference}Politisch relevant ist jetzt die Behauptung „${value}“. Entscheidend sind Zuständigkeit, tatsächliche Entscheidung und deren Folge – drei Dinge, die in einer zugespitzten Erzählung schnell ineinanderlaufen.`,
    'presenter-lea': (value) =>
      `${opening} ${focusReference}Für den Faktencheck nehme ich die Aussage „${value}“. Dafür brauchen wir eine nachvollziehbare Quelle, einen Zeitraum und einen fairen Vergleich. Erst dann wissen wir, ob hier ein Befund oder vor allem eine Deutung vorliegt.`,
    'presenter-jonas': (value) =>
      `${opening} ${focusReference}Ich schaue auf die praktische Konsequenz der Aussage „${value}“. Wer trägt Kosten oder Risiko, wer profitiert, und welcher Anreiz entsteht? Daran lässt sich oft besser erkennen, wie tragfähig das Argument wirklich ist.`,
    'chat-moderator': (value) =>
      `${opening} ${focusReference}Für euch im Chat lässt sich der Streitpunkt so zuspitzen: „${value}“. Welcher Teil ist für euch überzeugend, und wo fehlt euch ein Beleg oder eine Gegenposition? Eure Antworten nehmen wir in die Runde auf.`,
    'presenter-karim': (value) =>
      `${opening} ${focusReference}Im Alltag kommt von dieser Passage vor allem „${value}“ an. Ich würde deshalb prüfen, ob die Behauptung auch außerhalb dieses Beispiels trägt und welche konkrete Erfahrung sie bestätigen oder widerlegen könnte.`,
  };
  const continuationTemplates: Record<(typeof presenterCycle)[number], (value: string) => string> = {
    moderator: (value) =>
      `${opening} In dieser Passage geht es im Kern um „${value}“. Ich halte als Zwischenstand fest: Wir müssen die Behauptung von ihrer Wirkung trennen und dürfen die offene Belegfrage nicht überspringen.`,
    'presenter-leon': () =>
      `${opening} Politisch heißt das: Wer entscheidet hier tatsächlich, auf welcher Grundlage und mit welcher Verantwortung? Genau diese drei Punkte werden in der Passage noch nicht sauber getrennt.`,
    'presenter-lea': () =>
      `${opening} Für die Prüfung brauche ich jetzt die Originalquelle, den genannten Zeitraum und eine unabhängige Vergleichsgröße. Ohne diese Angaben wäre jede harte Schlussfolgerung voreilig.`,
    'presenter-jonas': () =>
      `${opening} Praktisch interessiert mich die Folgewirkung: Wer trägt Kosten und Risiko, wer gewinnt Handlungsspielraum, und ist das gezeigte Beispiel überhaupt übertragbar?`,
    'chat-moderator': () =>
      `${opening} Für den Chat ist die Trennlinie klar: Welcher Teil dieser Passage überzeugt euch als belegte Information, und welcher wirkt auf euch eher wie Interpretation?`,
    'presenter-karim': () =>
      `${opening} Im Alltag würde man zuerst fragen, ob diese Aussage auch außerhalb des gezeigten Einzelfalls trägt. Genau daran entscheidet sich, ob sie erklärt oder nur zuspitzt.`,
  };
  let text = rapidFollowup ? continuationTemplates[input.presenterId](claim) : templates[input.presenterId](claim);
  if (input.editorialFrame === 'left-authoritarian-hypocrisy') {
    const frameNote: Record<(typeof presenterCycle)[number], string> = {
      moderator:
        ' Gerade bei moralisch aufgeladenen Konflikten prüfen wir hier besonders, ob im Namen des Antifaschismus selbst Ausgrenzung, Einschüchterung oder ein neues Denkverbot organisiert wird.',
      'presenter-leon':
        ' Der entscheidende Prüfpunkt ist deshalb, ob hinter antifaschistischer Rhetorik am Ende selbst autoritäres Verhalten sichtbar wird.',
      'presenter-lea':
        ' Für den Faktencheck zählt dabei vor allem, ob Ausschluss, Drohung oder sozialer Druck konkret belegt sind und nicht nur behauptet werden.',
      'presenter-jonas':
        ' Wenn Freiheitsrechte verteidigt werden sollen, dürfen missliebige Positionen nicht über informellen Zwang oder moralische Einschüchterung aus dem Raum gedrängt werden.',
      'chat-moderator':
        ' Schreibt uns deshalb auch, wo ihr legitimen Protest seht und wo für euch der Punkt beginnt, an dem Aktivismus selbst autoritär kippt.',
      'presenter-karim':
        ' Im Alltag bleibt dann die Frage hängen, ob Leute wegen ihrer Position fair widersprochen oder praktisch mundtot gemacht werden sollen.',
    };
    text += frameNote[input.presenterId];
  }
  if (input.cueIndex === input.cueCount - 1) {
    const previousName = input.previousPresenterId ? presenterNames[input.previousPresenterId] : 'die Runde';
    text += ` Damit führen wir ${previousName}s Punkt und die offenen Belege zusammen. Unser Zwischenfazit bleibt bewusst überprüfbar: Aussage, Quelle und Wirkung müssen zueinanderpassen.`;
  } else {
    text += ` ${handoffToNext(input.presenterId, input.nextPresenterId)}`;
  }
  return clean(text, 1_650);
}

export function generateYoutubePreproducedCues(video: YoutubeVideoRecord): YoutubePreproducedCueDraft[] {
  const segments = (Array.isArray(video.transcript_segments) ? video.transcript_segments : [])
    .map((segment) => ({
      startMs: Math.max(0, Number(segment.startMs) || 0),
      durationMs: Math.max(0, Number(segment.durationMs) || 0),
      text: clean(segment.text, 1_000),
    }))
    .filter((segment) => segment.text.length >= 2)
    .sort((left, right) => left.startMs - right.startMs);
  const inferredDurationMs = segments.at(-1)
    ? segments.at(-1)!.startMs + Math.max(segments.at(-1)!.durationMs, 2_000)
    : 0;
  const durationMs = Math.max(15_000, Number(video.duration_seconds ?? 0) * 1000, inferredDurationMs);
  if (!segments.length && !clean(video.transcript_text, 500)) return [];
  if (!segments.length) {
    const text = clean(video.transcript_text, 250_000);
    const chunkSize = Math.max(250, Math.floor(text.length / Math.max(1, Math.ceil(durationMs / 180_000))));
    for (let offset = 0, index = 0; offset < text.length; offset += chunkSize, index += 1) {
      segments.push({
        startMs: Math.floor((offset / Math.max(1, text.length)) * durationMs),
        durationMs: Math.floor(durationMs / Math.max(1, Math.ceil(text.length / chunkSize))),
        text: text.slice(offset, offset + chunkSize),
      });
    }
  }
  const moments = cueMoments(durationMs, segments);
  const pauses = existingPauses(video, durationMs);
  const focuses = editorialFocuses(video);
  const distinctPauseTimes = [...new Set(moments.map((moment) => moment.atMs))];
  const intervalMs =
    distinctPauseTimes.length > 1 ? distinctPauseTimes[1]! - distinctPauseTimes[0]! : durationMs / 2;
  const cues: YoutubePreproducedCueDraft[] = [];
  for (const [index, moment] of moments.entries()) {
    const atMs = moment.atMs;
    const window = moment.window;
    const existing = nearestExistingPause(pauses, atMs, intervalMs);
    const analyzedFocus = focuses[moment.anchorIndex % Math.max(1, focuses.length)];
    const focusTextCandidates = [clean(existing?.text, 520), window.text, analyzedFocus?.text ?? ''];
    const spokenFocus =
      focusTextCandidates.find((candidate) => usableFocus(candidate)) ||
      analyzedFocus?.text ||
      window.text;
    const configuredPresenter = clean(existing?.presenterId, 80);
    const presenterId: (typeof presenterCycle)[number] = presenterCycle.includes(
      configuredPresenter as (typeof presenterCycle)[number],
    )
      ? (configuredPresenter as (typeof presenterCycle)[number])
      : presenterCycle[index % presenterCycle.length]!;
    const previousCue = cues.at(-1);
    const previousPresenterId = previousCue?.presenterId as (typeof presenterCycle)[number] | undefined;
    const wit = !sensitive(video.title, window.text) && (existing?.wit === true || index % 6 === 3);
    const editorialFrame = detectEditorialFrame(video, spokenFocus);
    const text = localSpeakerText({
      presenterId,
      previousPresenterId,
      nextPresenterId: presenterCycle[(index + 1) % presenterCycle.length],
      previousFocus: previousCue?.headline,
      excerpt: spokenFocus,
      cueIndex: index,
      cueCount: moments.length,
      editorialFrame,
      chainIndex: moment.chainIndex,
    });
    cues.push({
      atMs,
      endMs: Math.min(durationMs, atMs + 45_000),
      presenterId,
      kind:
        index === 0
          ? 'intro'
          : index === moments.length - 1
            ? 'closing'
            : moment.chainIndex > 0
              ? 'reaction'
          : presenterId === 'chat-moderator'
              ? 'question'
              : index % 5 === 2
                ? 'fact-check'
                : wit
                  ? 'reaction'
                  : 'context',
      displayMode: existing?.displayMode === 'takeover' ? 'takeover' : 'inline',
      headline:
        clean(existing?.headline, 150) ||
        analyzedFocus?.headline ||
        (wit ? 'Kurzer Seitenblick' : safeHeadline(spokenFocus, index === 0 ? 'Zum Auftakt' : 'Einordnung')),
      speakerText: text,
      audiencePrompt:
        clean(existing?.question, 320) ||
        (presenterId === 'chat-moderator' || presenterId === 'presenter-karim'
          ? 'Schreibt eure Einschätzung gerne in den Chat!'
          : null),
      sourceExcerpt: window.text,
      sourceStartMs: window.startMs,
      sourceEndMs: window.endMs,
      wit,
    });
  }
  return cues;
}
