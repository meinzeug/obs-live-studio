import type { MemoryDocument, RankedMemory } from './types.js';

function tokens(value: string) {
  return value
    .toLocaleLowerCase('de-DE')
    .normalize('NFKD')
    .replace(/[^\p{L}\p{N}]+/gu, ' ')
    .split(/\s+/)
    .filter((token) => token.length > 2)
    .slice(0, 200);
}

export function rankMemories(query: string, documents: MemoryDocument[], limit = 8): RankedMemory[] {
  const terms = [...new Set(tokens(query))];
  if (!terms.length) return documents.slice(0, limit).map((document) => ({ ...document, score: 0 }));
  const now = Date.now();
  return documents
    .map((document) => {
      const haystack = tokens(`${document.content} ${JSON.stringify(document.metadata)}`);
      const frequencies = new Map<string, number>();
      for (const token of haystack) frequencies.set(token, (frequencies.get(token) ?? 0) + 1);
      const lexical = terms.reduce((score, term) => score + Math.min(3, frequencies.get(term) ?? 0), 0) / terms.length;
      const ageDays = Math.max(0, (now - new Date(document.createdAt).getTime()) / 86_400_000);
      const recency = 1 / (1 + ageDays / 30);
      const trust = Math.max(0, Math.min(1, document.trustScore / 100));
      return { ...document, score: lexical * 0.7 + trust * 0.2 + recency * 0.1 };
    })
    .filter((document) => document.score > 0.1)
    .sort((left, right) => right.score - left.score || right.createdAt.localeCompare(left.createdAt))
    .slice(0, Math.max(1, Math.min(50, limit)));
}

export function memoryContext(query: string, documents: MemoryDocument[], maximumCharacters = 12_000) {
  const ranked = rankMemories(query, documents, 12);
  let remaining = maximumCharacters;
  const selected: RankedMemory[] = [];
  for (const memory of ranked) {
    if (remaining <= 0) break;
    const content = memory.content.slice(0, remaining);
    selected.push({ ...memory, content });
    remaining -= content.length;
  }
  return selected;
}
