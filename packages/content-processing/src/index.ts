import { contentHash } from '@ans/news-parser';
export function summarize(text: string, max = 520) {
  const sentences = text
    .replace(/\s+/g, ' ')
    .split(/(?<=[.!?])\s+/)
    .filter((s) => s.length > 30);
  return sentences.slice(0, 4).join(' ').slice(0, max).trim();
}
export function makeScript(title: string, summary: string, source: string) {
  return [
    'Argumentationskette.',
    `Ausgangspunkt: Nach Angaben von ${source} lautet die Meldung: ${title}.`,
    `Beleglage: ${summary}`,
    'Einordnung: Diese Darstellung stammt aus der genannten Primärquelle. Für eine belastbare Bewertung müssen Kontext, Gegenpositionen und weitere unabhängige Quellen geprüft werden.',
    'Zwischenfazit: Aus der Meldung folgt zunächst der berichtete Sachverhalt, nicht jede mögliche politische Bewertung.',
  ].join(' ');
}
export function classifyCritical(text: string) {
  const terms = [
    'tote',
    'tod',
    'terror',
    'gewalt',
    'polizei',
    'minderjährig',
    'wahl',
    'katastrophe',
    'medizinische warnung',
  ];
  const lower = text.toLowerCase();
  return terms.filter((t) => lower.includes(t));
}
export function normalizeTitle(t: string) {
  return t
    .toLowerCase()
    .normalize('NFKD')
    .replace(/[\u0300-\u036f]/g, '')
    .replace(/[^a-z0-9äöüß ]/gi, '')
    .replace(/\s+/g, ' ')
    .trim();
}
export function duplicateKey(url: string, canonical: string | undefined, title: string, text: string) {
  return `${canonical ?? url}|${normalizeTitle(title)}|${contentHash(text).slice(0, 16)}`;
}
