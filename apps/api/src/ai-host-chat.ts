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
