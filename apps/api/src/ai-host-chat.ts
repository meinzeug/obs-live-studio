function limitedChatText(value: unknown, maximum: number) {
  return String(value ?? '')
    .replace(/\s+/g, ' ')
    .trim()
    .slice(0, maximum);
}

function speechWords(value: unknown) {
  return limitedChatText(value, 2000)
    .replace(/(?:\.{2,}|…)+/gu, '.')
    .split(/\s+/u)
    .filter(Boolean);
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
  return /\?|\b(was|wann|wie|warum|wieso|wer|wo|welche)\b/i.test(value);
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
  verifiedFact: { value: string; statement: string } | null | undefined,
) {
  const cleanResponse = fitCompleteSpeechCharacters(response, 750);
  if (!verifiedFact) return cleanResponse;
  const value = limitedChatText(verifiedFact.value, 120);
  const statement = limitedChatText(verifiedFact.statement, 500);
  if (!value || !statement) return cleanResponse;
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
