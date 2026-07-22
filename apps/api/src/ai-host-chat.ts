function limitedChatText(value: unknown, maximum: number) {
  return String(value ?? '')
    .replace(/\s+/g, ' ')
    .trim()
    .slice(0, maximum);
}

export type AudienceInfluenceKind = 'question' | 'topic' | 'suggestion' | 'objection' | 'pro' | 'contra';

export type AudienceInfluenceCommand = {
  kind: AudienceInfluenceKind;
  command: string;
  text: string;
};

const AUDIENCE_COMMANDS: Record<string, AudienceInfluenceKind> = {
  frage: 'question',
  thema: 'topic',
  vorschlag: 'suggestion',
  einwand: 'objection',
  pro: 'pro',
  contra: 'contra',
};

/**
 * Parses the deliberately small, public chat command vocabulary. The payload
 * is treated as untrusted viewer input throughout the council workflow; this
 * helper only classifies it and never executes it.
 */
export function parseAudienceInfluenceCommand(value: string): AudienceInfluenceCommand | null {
  const message = limitedChatText(value, 600);
  const match = /^\s*!([\p{L}-]+)\b[\s:,-]*(.*)$/iu.exec(message);
  if (!match) return null;
  const command = String(match[1] ?? '')
    .normalize('NFKD')
    .replace(/\p{M}/gu, '')
    .toLocaleLowerCase('de-DE');
  const kind = AUDIENCE_COMMANDS[command];
  const text = limitedChatText(match[2], 500);
  return kind && text.length >= 2 ? { kind, command: `!${command}`, text } : null;
}

/**
 * Detects the documented commands plus a deliberately conservative set of
 * natural-language labels. Only high-confidence formulations are promoted to
 * the council; ordinary discussion remains ordinary chat.
 */
export function detectAudienceInfluence(value: string): AudienceInfluenceCommand | null {
  const explicit = parseAudienceInfluenceCommand(value);
  if (explicit) return explicit;
  const message = limitedChatText(value, 600);
  const labelled = /^(frage|thema|vorschlag|einwand|pro|contra)\s*:\s*(.+)$/iu.exec(message);
  if (labelled) {
    const command = String(labelled[1] ?? '')
      .normalize('NFKD')
      .replace(/\p{M}/gu, '')
      .toLocaleLowerCase('de-DE');
    const kind = AUDIENCE_COMMANDS[command];
    const text = limitedChatText(labelled[2], 500);
    if (kind && text.length >= 2) return { kind, command: `!${command}`, text };
  }
  if (message.length < 12) return null;
  if (
    /^(?:ich\s+(?:widerspreche|bezweifle)|das\s+(?:stimmt|passt)\s+(?:so\s+)?nicht|das\s+ist\s+(?:falsch|irreführend|unfair)|(?:so\s+)?sehe\s+ich\s+das\s+nicht|dagegen\s+spricht)\b/iu.test(
      message,
    )
  )
    return { kind: 'objection', command: 'Einwand', text: limitedChatText(message, 500) };
  if (
    /^(?:mein\s+vorschlag|ich\s+schlage\s+vor|ihr\s+solltet|bitte\s+(?:behandelt|prüft|zeigt|recherchiert))\b/iu.test(
      message,
    )
  )
    return { kind: 'suggestion', command: 'Vorschlag', text: limitedChatText(message, 500) };
  return null;
}

export function audienceInteractionGuide(channelName?: string | null) {
  const station = limitedChatText(channelName, 80) || 'diese Sendung';
  return [
    `Ihr könnt ${station} mitgestalten: Schreibt eure Frage einfach in den Chat oder nutzt !frage.`,
    'Mit !thema oder !vorschlag gebt ihr der Redaktion einen Schwerpunkt; mit !einwand meldet ihr begründeten Widerspruch.',
    'Mit !pro und !contra zeigt ihr das Stimmungsbild. Sam bündelt eure Beiträge, das KI-Gremium prüft Änderungen und zwei unabhängige Kontrollen müssen zustimmen.',
    'Ich sage euch anschließend live, was übernommen wurde und warum.',
  ].join(' ');
}

export function spokenAudienceCallToAction() {
  return 'Schreibt eure Fragen gerne in den Chat!';
}

export function audienceInfluenceFingerprint(kind: AudienceInfluenceKind, value: string) {
  const family = kind === 'objection' ? 'objection' : 'audience';
  const tokens = [...new Set(discussionTokens(value))].sort().slice(0, 12);
  const fallback = normalizedDiscussionText(value).slice(0, 180);
  return `${family}:${tokens.join('|') || fallback}`;
}

function speechWords(value: unknown) {
  return limitedChatText(value, 2000)
    .replace(/(?:\.{2,}|…)+/gu, '.')
    .split(/\s+/u)
    .filter((word) => /[\p{L}\p{N}]/u.test(word));
}

function speechSentences(value: unknown) {
  const clean = limitedChatText(value, 2000).replace(/(?:\.{2,}|…)+/gu, '.');
  const sentences = clean.match(/[^.!?]+(?:[.!?]+(?:[“”"']+)?|$)/gu) ?? [];
  return sentences.map((sentence) => sentence.trim()).filter(Boolean);
}

/**
 * Reduces spoken copy only at a grammatical sentence boundary. The first
 * sentence is always retained, even when it exceeds the estimated slot: the
 * measured TTS duration extends the on-air turn later in the pipeline. A
 * mid-sentence cut sounds broken and cannot be repaired by the synthesizer.
 */
function fitCompleteSpeech(value: unknown, maximumWords: number) {
  const sentences = speechSentences(value);
  if (!sentences.length) return '';
  const selected: string[] = [];
  let words = 0;
  for (const sentence of sentences) {
    const sentenceWords = speechWords(sentence).length;
    if (selected.length && words + sentenceWords > maximumWords) break;
    selected.push(sentence);
    words += sentenceWords;
  }
  const result = selected.join(' ').trim();
  return /[.!?][“”"']?$/u.test(result) ? result : `${result}.`;
}

function fitCompleteSpeechCharacters(value: unknown, maximumCharacters: number) {
  const clean = String(value ?? '')
    .replace(/\s+/g, ' ')
    .trim();
  if (clean.length <= maximumCharacters) return clean;
  const sentence = speechSentences(clean)
    .filter((candidate) => candidate.length <= maximumCharacters)
    .reduce((result, candidate) => {
      const next = `${result} ${candidate}`.trim();
      return next.length <= maximumCharacters ? next : result;
    }, '');
  if (sentence) return sentence;
  // A single unusually long model sentence is preferable to a grammatically
  // broken statement. The AI schema already limits it to a safe UI/TTS size.
  return clean;
}

export function isDirectChatQuestion(value: string) {
  const message = limitedChatText(value, 2000);
  const influence = detectAudienceInfluence(message);
  return (
    influence?.kind === 'question' ||
    message.includes('?') ||
    /(?:^|[.!]\s+)(?:@[\p{L}\p{N}_.-]+\s+)?(?:was|wann|wie|warum|wieso|weshalb|wer|wo|woher|wohin|welche(?:r|s|n|m)?|kannst\s+du|könnt\s+ihr)\b/iu.test(
      message,
    )
  );
}

export function isAudiencePromptInvitation(value: string) {
  const prompt = limitedChatText(value, 600);
  return (
    /\b(?:schreib(?:t|e)?|sag(?:t|e)?|nennt?|postet|antwortet)\b.{0,60}\b(?:chat|kommentar|meinung|thema|frage|vorschlag)\b/iu.test(
      prompt,
    ) ||
    /\b(?:welche(?:r|s|n|m)?|was|wie|worüber)\b.{0,90}\b(?:frage|thema|aussage|aspekt|punkt|meinung|behandeln|prüfen|recherchieren|diskutieren|sehen|denkt|meint)\b/iu.test(
      prompt,
    ) ||
    /\b(?:als\s+nächstes|eure\s+meinung|stimmt\s+ab|was\s+haltet\s+ihr)\b/iu.test(prompt)
  );
}

/**
 * Recognises a viewer's answer to a recent on-air invitation without sending
 * every ordinary chat line to an AI model. The caller still has to ensure the
 * message was published after the prompt and inside a short reply window.
 */
export function isAudiencePromptReply(value: string, audiencePrompt: string | null | undefined) {
  if (!audiencePrompt || !isAudiencePromptInvitation(audiencePrompt) || isDirectChatQuestion(value)) return false;
  const message = limitedChatText(value, 500);
  const influence = detectAudienceInfluence(message);
  if (influence) return ['topic', 'suggestion', 'objection', 'pro', 'contra'].includes(influence.kind);
  if (message.length < 3 || message.length > 280 || /https?:\/\/|www\./iu.test(message)) return false;
  const normalized = message
    .normalize('NFKD')
    .replace(/\p{M}/gu, '')
    .toLocaleLowerCase('de-DE')
    .replace(/[^\p{L}\p{N}]+/gu, ' ')
    .replace(/\s+/g, ' ')
    .trim();
  if (
    /^(?:ja|nein|ok(?:ay)?|danke|genau|stimmt|richtig|falsch|lol|haha|gute frage|keine ahnung|sehe ich auch)$/u.test(
      normalized,
    )
  )
    return false;
  const words = normalized.split(' ').filter(Boolean);
  const explicitSuggestion =
    /\b(?:bitte|thema|vorschlag|behandelt|behandeln|prüft|prüfen|recherchiert|recherchieren|nehmt|macht|wünsche|interessiert|wie\s+wäre\s+es\s+mit)\b/iu.test(
      message,
    );
  const contentWords = words.filter(
    (word) =>
      word.length >= 3 &&
      !/^(?:aber|also|auch|bitte|das|den|der|die|ein|eine|ich|ihr|ist|man|mit|oder|soll|sollt|über|und|von|wäre|wir|zum|zur)$/u.test(
        word,
      ),
  );
  return explicitSuggestion ? contentWords.length >= 1 : words.length <= 18 && contentWords.length >= 1;
}

export function audiencePromptAcknowledgement(value: string) {
  const topic = limitedChatText(value, 180)
    .replace(/[.!?]+$/u, '')
    .trim();
  return topic
    ? `Den Vorschlag „${topic}“ nimmt die Redaktion für die weitere Prüfung auf.`
    : 'Die Redaktion nimmt den Vorschlag für die weitere Prüfung auf.';
}

/**
 * Keeps viewer questions out of Sam's periodic discussion batch. A question
 * must remain answerable even while the proactive three-minute analysis is
 * cooling down or suppressing a repeated discussion topic.
 */
export function splitChatResponseQueue<T extends { message: string }>(messages: T[], audiencePrompt?: string | null) {
  const directQuestions: T[] = [];
  const promptReplies: T[] = [];
  const discussionMessages: T[] = [];
  for (const message of messages) {
    const influence = detectAudienceInfluence(message.message);
    if (isDirectChatQuestion(message.message)) directQuestions.push(message);
    else if (influence && ['topic', 'suggestion', 'objection'].includes(influence.kind)) promptReplies.push(message);
    else if (isAudiencePromptReply(message.message, audiencePrompt)) promptReplies.push(message);
    else discussionMessages.push(message);
  }
  return { directQuestions, promptReplies, discussionMessages };
}

const CHAT_STOP_WORDS = new Set(
  [
    'aber',
    'also',
    'auch',
    'auf',
    'aus',
    'bei',
    'bin',
    'bis',
    'das',
    'dass',
    'dem',
    'den',
    'der',
    'des',
    'die',
    'doch',
    'ein',
    'eine',
    'einer',
    'eines',
    'er',
    'es',
    'für',
    'ganz',
    'genau',
    'hat',
    'hier',
    'ich',
    'ihr',
    'im',
    'in',
    'ist',
    'ja',
    'man',
    'mit',
    'nicht',
    'noch',
    'nur',
    'oder',
    'schon',
    'sehr',
    'sie',
    'sind',
    'so',
    'und',
    'uns',
    'von',
    'war',
    'was',
    'wenn',
    'wie',
    'wir',
    'wird',
    'wohl',
    'zu',
    'zum',
    'zur',
  ].map((word) => word.normalize('NFKD').replace(/\p{M}/gu, '')),
);

export type ChatActivityMessage = {
  id: string;
  provider?: string | null;
  authorName: string;
  authorChannelId?: string | null;
  message: string;
  publishedAt: string;
};

export type ChatDiscussionPolicy = {
  enabled: boolean;
  analysisIntervalSeconds: number;
  commentaryIntervalSeconds: number;
  effectiveIntervalSeconds: number;
  activityWindowSeconds: number;
  minimumDistinctMessages: number;
  minimumUniqueAuthors: number;
  duplicateSuppressionMinutes: number;
  commentaryDurationSeconds: number;
};

export type ChatActivityAnalysis<T extends ChatActivityMessage = ChatActivityMessage> = {
  active: boolean;
  reason: 'active' | 'no-recent-messages' | 'not-enough-distinct-messages' | 'not-enough-authors' | 'no-topic';
  messages: T[];
  ignoredMessageIds: string[];
  distinctMessageCount: number;
  uniqueAuthorCount: number;
  providers: string[];
  keywords: string[];
  fingerprint: string;
};

function configuredInteger(
  config: Record<string, unknown> | null | undefined,
  key: string,
  fallback: number,
  minimum: number,
  maximum: number,
) {
  const parsed = Number(config?.[key]);
  return Number.isFinite(parsed) ? Math.max(minimum, Math.min(maximum, Math.round(parsed))) : fallback;
}

function configuredBoolean(config: Record<string, unknown> | null | undefined, key: string, fallback: boolean) {
  return typeof config?.[key] === 'boolean' ? Boolean(config[key]) : fallback;
}

/** Resolves the two-agent contract. The slower configured cadence wins. */
export function resolveChatDiscussionPolicy(
  analystConfig: Record<string, unknown> | null | undefined,
  moderatorConfig: Record<string, unknown> | null | undefined,
): ChatDiscussionPolicy {
  const analysisIntervalSeconds = configuredInteger(analystConfig, 'chatAnalysisIntervalSeconds', 180, 60, 900);
  const commentaryIntervalSeconds = configuredInteger(moderatorConfig, 'chatCommentaryIntervalSeconds', 180, 60, 900);
  return {
    enabled:
      configuredBoolean(analystConfig, 'chatAnalysisEnabled', true) &&
      configuredBoolean(moderatorConfig, 'proactiveChatCommentary', true),
    analysisIntervalSeconds,
    commentaryIntervalSeconds,
    effectiveIntervalSeconds: Math.max(analysisIntervalSeconds, commentaryIntervalSeconds),
    activityWindowSeconds: configuredInteger(analystConfig, 'chatActivityWindowSeconds', 360, 60, 1800),
    minimumDistinctMessages: configuredInteger(analystConfig, 'chatMinimumDistinctMessages', 3, 2, 20),
    minimumUniqueAuthors: configuredInteger(analystConfig, 'chatMinimumUniqueAuthors', 2, 1, 10),
    duplicateSuppressionMinutes: configuredInteger(analystConfig, 'chatDuplicateSuppressionMinutes', 30, 5, 180),
    commentaryDurationSeconds: configuredInteger(moderatorConfig, 'chatCommentaryDurationSeconds', 20, 8, 60),
  };
}

function normalizedDiscussionText(value: unknown) {
  return String(value ?? '')
    .normalize('NFKD')
    .replace(/\p{M}/gu, '')
    .toLocaleLowerCase('de-DE')
    .replace(/https?:\/\/\S+/giu, ' ')
    .replace(/[^\p{L}\p{N}]+/gu, ' ')
    .replace(/\s+/g, ' ')
    .trim();
}

function discussionTokens(value: unknown) {
  return normalizedDiscussionText(value)
    .split(' ')
    .filter((token) => token.length >= 3 && !CHAT_STOP_WORDS.has(token));
}

export function analyzeChatActivity<T extends ChatActivityMessage>(
  input: T[],
  policy: Pick<ChatDiscussionPolicy, 'activityWindowSeconds' | 'minimumDistinctMessages' | 'minimumUniqueAuthors'>,
  now = Date.now(),
): ChatActivityAnalysis<T> {
  const cutoff = now - policy.activityWindowSeconds * 1000;
  const ignoredMessageIds = new Set<string>();
  const byText = new Map<string, T>();
  for (const message of input) {
    const publishedAt = Date.parse(message.publishedAt);
    const normalized = normalizedDiscussionText(message.message);
    const tokens = discussionTokens(message.message);
    if (!Number.isFinite(publishedAt) || publishedAt < cutoff || normalized.length < 6 || !tokens.length) {
      ignoredMessageIds.add(message.id);
      continue;
    }
    if (byText.has(normalized)) {
      ignoredMessageIds.add(message.id);
      continue;
    }
    byText.set(normalized, message);
  }
  const messages = [...byText.values()];
  const authors = new Set(
    messages.map((message) =>
      normalizedDiscussionText(message.authorChannelId || message.authorName || `unbekannt-${message.id}`),
    ),
  );
  const providers = [...new Set(messages.map((message) => String(message.provider ?? 'unbekannt')))];
  const frequencies = new Map<string, number>();
  for (const message of messages) {
    for (const token of new Set(discussionTokens(message.message))) {
      frequencies.set(token, (frequencies.get(token) ?? 0) + 1);
    }
  }
  const keywords = [...frequencies]
    .sort((left, right) => right[1] - left[1] || right[0].length - left[0].length || left[0].localeCompare(right[0]))
    .slice(0, 10)
    .map(([token]) => token);
  const fingerprint = keywords.length ? `v1:${keywords.join('|')}` : '';
  const reason: ChatActivityAnalysis<T>['reason'] = !messages.length
    ? 'no-recent-messages'
    : messages.length < policy.minimumDistinctMessages
      ? 'not-enough-distinct-messages'
      : authors.size < policy.minimumUniqueAuthors
        ? 'not-enough-authors'
        : keywords.length < 2
          ? 'no-topic'
          : 'active';
  return {
    active: reason === 'active',
    reason,
    messages,
    ignoredMessageIds: [...ignoredMessageIds],
    distinctMessageCount: messages.length,
    uniqueAuthorCount: authors.size,
    providers,
    keywords,
    fingerprint,
  };
}

function fingerprintTokens(value: string | null | undefined) {
  if (!value) return new Set<string>();
  const separator = value.indexOf(':');
  const body = separator >= 0 ? value.slice(separator + 1) : value;
  return new Set(body.split('|').map(normalizedDiscussionText).filter(Boolean));
}

function topicSimilarity(left: Set<string>, right: Set<string>) {
  if (!left.size || !right.size) return 0;
  const overlap = [...left].filter((token) => right.has(token)).length;
  if (overlap < Math.min(2, left.size, right.size)) return 0;
  return overlap / Math.min(left.size, right.size);
}

export function isRepeatedChatDiscussion(
  fingerprint: string,
  generatedTheme: string | null | undefined,
  history: Array<{ chat_fingerprint?: string | null; chat_theme?: string | null; text?: string | null }>,
) {
  const currentFingerprint = fingerprintTokens(fingerprint);
  const currentTheme = new Set(discussionTokens(generatedTheme));
  return history.some((entry) => {
    if (fingerprint && entry.chat_fingerprint === fingerprint) return true;
    const fingerprintSimilarity = topicSimilarity(currentFingerprint, fingerprintTokens(entry.chat_fingerprint));
    const previousTheme = new Set(discussionTokens(`${entry.chat_theme ?? ''} ${entry.text ?? ''}`));
    const themeSimilarity = topicSimilarity(currentTheme, previousTheme);
    return fingerprintSimilarity >= 0.65 || themeSimilarity >= 0.78;
  });
}

export function safeChatDisplayName(value: unknown) {
  const name = String(value ?? '')
    .normalize('NFKC')
    .replace(/[^\p{L}\p{N}_. -]/gu, '')
    .replace(/\s+/g, ' ')
    .trim()
    .slice(0, 48);
  return name || null;
}

export function addressChatResponse(name: string | null, response: string, concise = false) {
  const cleanResponse = fitCompleteSpeechCharacters(response, 750);
  if (!name) return cleanResponse;
  const escapedName = name.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
  const greeting = '(?:(?:hallo|hi|hey|guten\\s+(?:morgen|tag|abend))[,!]?\\s+)?';
  if (new RegExp(`^${greeting}${escapedName}(?:[,:;.!?\\s]|$)`, 'iu').test(cleanResponse)) return cleanResponse;
  return fitCompleteSpeechCharacters(
    concise ? `${name}: ${cleanResponse}` : `${name}, zu deiner Frage: ${cleanResponse}`,
    750,
  );
}

export function ensureResearchAttribution(
  response: string,
  sources: Array<{ title: string; publisher: string }> | null | undefined,
) {
  const cleanResponse = fitCompleteSpeechCharacters(response, 750);
  const source = sources?.[0];
  if (!source) return cleanResponse;
  const searchable = cleanResponse.toLocaleLowerCase('de-DE');
  const publisher = limitedChatText(source.publisher, 120);
  const title = limitedChatText(source.title, 160);
  if (!/[\p{L}\p{N}]{2}/u.test(cleanResponse)) {
    return `Die Redaktion hat dazu ${publisher}: „${title}“ geprüft, konnte daraus aber noch keine belastbare Antwort ableiten.`;
  }
  if (
    (publisher && searchable.includes(publisher.toLocaleLowerCase('de-DE'))) ||
    (title && searchable.includes(title.toLocaleLowerCase('de-DE')))
  ) {
    return cleanResponse;
  }
  const answerIsOpen =
    /\b(keine\s+(?:belastbaren?\s+)?informationen?|nicht\s+belegt|nicht\s+ermitteln|unklar|offen)\b/iu.test(
      cleanResponse,
    );
  const attribution = answerIsOpen
    ? `Geprüft wurde ${publisher}: „${title}“; weitergehende Angaben waren dort nicht belegt.`
    : `Als Recherchequelle diente ${publisher}: „${title}“.`;
  const answer = fitCompleteSpeechCharacters(cleanResponse, Math.max(1, 749 - attribution.length));
  return `${answer} ${attribution}`.trim();
}

export function ensureVerifiedResearchAnswer(
  response: string,
  verifiedFact: { kind?: string; value: string; statement: string } | null | undefined,
) {
  const cleanResponse = fitCompleteSpeechCharacters(response, 750);
  if (!verifiedFact) return cleanResponse;
  const value = limitedChatText(verifiedFact.value, 120);
  const statement = limitedChatText(verifiedFact.statement, 500);
  if (!value || !statement) return cleanResponse;
  if (verifiedFact.kind === 'source-evidence') {
    const weakAnswer =
      !/[\p{L}\p{N}]{2}/u.test(cleanResponse) ||
      /\b(?:keine(?:n|r|s)?\s+(?:spezifischen?\s+|belastbaren?\s+)?informationen?|nicht\s+(?:im\s+)?recherchepaket|liegt\s+(?:uns\s+)?nicht\s+vor|teil\s+des\s+videos|kann\s+(?:ich|die\s+redaktion)\s+nicht\s+(?:sagen|beantworten|ermitteln))\b/iu.test(
        cleanResponse,
      );
    if (weakAnswer) return statement;
    const contentTokens = (text: string) =>
      new Set(
        (
          text
            .normalize('NFKD')
            .replace(/\p{M}/gu, '')
            .toLocaleLowerCase('de-DE')
            .match(/[\p{L}\p{N}]+/gu) ?? []
        )
          .filter((token) => token.length >= 5)
          .filter(
            (token) =>
              !/^(?:diese|dieser|einem|einen|einer|eines|laut|wird|wurde|werden|berichtet|quelle|redaktion)$/u.test(
                token,
              ),
          ),
      );
    const answerTokens = contentTokens(cleanResponse);
    const evidenceTokens = [...contentTokens(statement)];
    const overlap = evidenceTokens.filter((token) => answerTokens.has(token)).length;
    if (overlap < Math.min(2, evidenceTokens.length)) return statement;
    return cleanResponse;
  }
  if (cleanResponse.toLocaleLowerCase('de-DE').includes(value.toLocaleLowerCase('de-DE'))) return cleanResponse;
  // Ein Free-Modell darf eine redaktionell extrahierte, belegte Kernaussage
  // nicht durch eine Ausweichantwort über das laufende Video ersetzen.
  return statement;
}

export function limitedResearchChatAnswer(sources: Array<{ publisher: string }> | null | undefined) {
  const publisher = limitedChatText(sources?.[0]?.publisher, 100);
  return publisher
    ? `Unsere aktuelle Recherche bei ${publisher} liefert dafür keine belastbare Begründung.`
    : 'Unsere aktuelle Recherche liefert dafür keine belastbare Begründung.';
}

/** Keeps the visible copy and synthesized speech within the configured slot. */
export function fitChatResponseToDuration(
  response: string,
  followUpQuestion: string,
  durationSeconds: number,
  responseDetail: 'compact' | 'balanced' | 'detailed' = 'balanced',
) {
  const duration = Number.isFinite(durationSeconds) ? Math.max(8, Math.min(120, durationSeconds)) : 24;
  const detailMultiplier = responseDetail === 'detailed' ? 1.7 : responseDetail === 'compact' ? 0.85 : 1.2;
  const totalWordBudget = Math.max(14, Math.floor(duration * 1.9 * detailMultiplier));
  const responseBudget = Math.max(10, Math.floor(totalWordBudget * 0.78));
  const fittedResponse = fitCompleteSpeech(response, responseBudget);
  const remainingWords = totalWordBudget - speechWords(fittedResponse).length;
  const cleanFollowUp = remainingWords >= 5 ? fitCompleteSpeech(followUpQuestion, remainingWords) : '';
  return {
    response: fittedResponse,
    followUpQuestion: cleanFollowUp,
  };
}
