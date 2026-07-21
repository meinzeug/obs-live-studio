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

function truncateSpeechWords(value: unknown, maximumWords: number) {
  const words = speechWords(value);
  if (words.length <= maximumWords) return words.join(' ');
  const result = words
    .slice(0, Math.max(1, maximumWords))
    .join(' ')
    .replace(/[,;:–—-]+$/u, '')
    .replace(/[.!?]+$/u, '');
  return `${result}.`;
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
  const cleanResponse = limitedChatText(response, 750);
  if (!name) return cleanResponse;
  const escapedName = name.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
  const greeting = '(?:(?:hallo|hi|hey|guten\\s+(?:morgen|tag|abend))[,!]?\\s+)?';
  if (new RegExp(`^${greeting}${escapedName}(?:[,:;.!?\\s]|$)`, 'iu').test(cleanResponse)) return cleanResponse;
  return limitedChatText(concise ? `${name}: ${cleanResponse}` : `${name}, zu deiner Frage: ${cleanResponse}`, 750);
}

export function ensureResearchAttribution(
  response: string,
  sources: Array<{ title: string; publisher: string }> | null | undefined,
) {
  const cleanResponse = limitedChatText(response, 750);
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
  const answer = cleanResponse.slice(0, Math.max(0, 749 - attribution.length)).trimEnd();
  return `${answer} ${attribution}`.trim();
}

export function ensureVerifiedResearchAnswer(
  response: string,
  verifiedFact: { value: string; statement: string } | null | undefined,
) {
  const cleanResponse = limitedChatText(response, 750);
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
export function fitChatResponseToDuration(response: string, followUpQuestion: string, durationSeconds: number) {
  const duration = Number.isFinite(durationSeconds) ? Math.max(8, Math.min(120, durationSeconds)) : 24;
  const totalWordBudget = Math.max(14, Math.floor(duration * 1.9));
  const cleanFollowUp = truncateSpeechWords(followUpQuestion, Math.max(5, Math.floor(totalWordBudget * 0.35)));
  const followUpWords = speechWords(cleanFollowUp).length;
  const responseBudget = Math.max(8, totalWordBudget - followUpWords);
  return {
    response: truncateSpeechWords(response, responseBudget),
    followUpQuestion: cleanFollowUp,
  };
}
