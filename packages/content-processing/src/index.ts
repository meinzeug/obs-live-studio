import { contentHash } from '@ans/news-parser';

const BOILERPLATE_PATTERNS = [
  /\bfacebook\b/i,
  /\btwitter\b/i,
  /\blinkedin\b/i,
  /\bxing\b/i,
  /\bemail\b/i,
  /\bprint\b/i,
  /\bwerbung\b/i,
  /\banmelden\b/i,
  /\bregistrieren\b/i,
  /\bnewsletter\b/i,
  /\bunterstützen\b/i,
  /\bich unterstütze bereits\b/i,
  /\bkommentare?\b/i,
  /\biframe\b/i,
  /\bgoogletagmanager\b/i,
];

export function cleanArticleTextForBroadcast(text: string, max = 12_000) {
  const normalized = text
    .replace(/<[^>]+>/g, ' ')
    .replace(/\b(Facebook|Twitter|Linkedin|Xing|Email|Print)\b/gi, ' ')
    .replace(/\b(Werbung|Anmelden|Registrieren|Newsletter)\s*[:•-]?\s*/gi, ' ')
    .replace(/\s+/g, ' ')
    .trim();
  const chunks = normalized
    .split(/(?<=[.!?])\s+|(?<=\])\s+|\s{2,}/)
    .map((chunk) => chunk.trim())
    .filter(Boolean)
    .filter((chunk) => {
      if (chunk.length < 18) return false;
      const boilerplateHits = BOILERPLATE_PATTERNS.filter((pattern) => pattern.test(chunk)).length;
      return boilerplateHits < 2 || chunk.length > 180;
    });
  const cleaned = chunks.join(' ').replace(/\s+/g, ' ').trim();
  return (cleaned || normalized).slice(0, max).trim();
}

export function summarize(text: string, max = 520) {
  const sentences = cleanArticleTextForBroadcast(text, Math.max(max * 4, 2000))
    .replace(/\s+/g, ' ')
    .split(/(?<=[.!?])\s+/)
    .filter((s) => s.length > 30);
  return sentences.slice(0, 4).join(' ').slice(0, max).trim();
}
export function makeScript(title: string, summary: string, source: string, channelName = 'Studio') {
  const cleanSummary = cleanArticleTextForBroadcast(summary, 900);
  return [
    `${channelName}. ${title}.`,
    `Nach Angaben von ${source}: ${cleanSummary}`,
    'Weitere Details und mögliche Aktualisierungen ergeben sich aus dem Originalbericht.',
  ].join(' ');
}

function escapedPattern(value: string) {
  return value.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

/**
 * Keeps the spoken station ident in sync with the configured channel name.
 * Generated scripts historically stored the channel directly in their first
 * sentence, so changing the station identity must also replace that old ident
 * before a new audio asset is rendered.
 */
export function scriptWithChannelName(script: string, channelName: string, previousChannelNames: string[] = []) {
  const name = channelName.replace(/\s+/g, ' ').trim() || 'Studio';
  let text = script.replace(/\s+/g, ' ').trim();
  const aliases = [...new Set(['ArgumentationsKette', 'Argumentationskette', ...previousChannelNames])]
    .map((alias) => alias.replace(/\s+/g, ' ').trim())
    .filter((alias) => alias && alias.toLocaleLowerCase('de') !== name.toLocaleLowerCase('de'));
  for (const alias of aliases) {
    text = text.replace(new RegExp(`^${escapedPattern(alias)}\\s*[.!:–—-]+\\s*`, 'iu'), '');
  }
  if (new RegExp(`^${escapedPattern(name)}(?:\\s*[.!:–—-]|$)`, 'iu').test(text)) return text;
  return `${name}. ${text}`.trim();
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
export function combineEditorialWarnings(title: string, text: string, aiRiskFlags: string[] = []) {
  const ruleWarnings = classifyCritical(`${title} ${text}`);
  const aiWarnings = aiRiskFlags
    .map((warning) => warning.trim())
    .filter(Boolean)
    .map((warning) => `KI-Hinweis: ${warning}`);
  return [...new Set([...ruleWarnings, ...aiWarnings])].slice(0, 20);
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
