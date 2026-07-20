import type { ArticleDetailRecord } from '@ans/database';

export type BroadcastPlanFocus =
  'balanced' | 'breaking' | 'politics' | 'economy' | 'technology' | 'regional' | 'international' | 'culture' | 'sports';
export type BroadcastPlanDiversity = 'high' | 'balanced' | 'focused';

export type BroadcastPlannerOptions = {
  name?: string;
  maximumItems: number;
  targetRuntimeMinutes: number;
  minimumTrust: number;
  freshnessHours: number;
  focus: BroadcastPlanFocus;
  diversity: BroadcastPlanDiversity;
  categoryFilters: string[];
  sourceIds: string[];
  instructions?: string;
};

const focusLabels: Record<BroadcastPlanFocus, string> = {
  balanced: 'Nachrichtenüberblick',
  breaking: 'Aktuelle Lage',
  politics: 'Politik',
  economy: 'Wirtschaft',
  technology: 'Technologie',
  regional: 'Regional',
  international: 'International',
  culture: 'Kultur',
  sports: 'Sport',
};

const focusTerms: Record<BroadcastPlanFocus, string[]> = {
  balanced: [],
  breaking: ['eilmeldung', 'aktuell', 'live', 'breaking', 'sofort', 'heute'],
  politics: ['politik', 'bundestag', 'regierung', 'wahl', 'parlament'],
  economy: ['wirtschaft', 'finanzen', 'unternehmen', 'markt', 'börse'],
  technology: ['technologie', 'digital', 'ki', 'software', 'internet'],
  regional: ['regional', 'land', 'stadt', 'kreis', 'kommune'],
  international: ['international', 'europa', 'ausland', 'usa', 'ukraine', 'russland'],
  culture: ['kultur', 'film', 'musik', 'kunst', 'medien'],
  sports: ['sport', 'fußball', 'bundesliga', 'olympia', 'tennis'],
};

function articleTime(article: ArticleDetailRecord) {
  const value = Date.parse(article.published_at ?? article.fetched_at);
  return Number.isFinite(value) ? value : 0;
}

function estimatedDurationSeconds(article: ArticleDetailRecord) {
  const stored = Number(article.audio_duration_seconds ?? 0);
  if (Number.isFinite(stored) && stored > 0) return stored;
  const words = `${article.title} ${article.summary ?? article.excerpt ?? article.main_text ?? ''}`
    .trim()
    .split(/\s+/).length;
  return Math.max(40, Math.min(120, Math.round(words / 2.5)));
}

function baseScore(article: ArticleDetailRecord, options: BroadcastPlannerOptions, now: number) {
  const ageHours = Math.max(0, (now - articleTime(article)) / 3_600_000);
  const freshness = Math.max(0, 70 - ageHours * 0.8);
  const trust = Math.max(0, Math.min(100, Number(article.trust_score ?? 0))) * 0.35;
  const text = `${article.category ?? ''} ${article.region ?? ''} ${article.title}`.toLocaleLowerCase('de');
  const focus = focusTerms[options.focus].some((term) => text.includes(term)) ? 32 : 0;
  const ready = article.audio_path && Number(article.audio_duration_seconds ?? 0) > 0 ? 8 : 0;
  return freshness + trust + focus + ready + (article.status === 'approved' ? 3 : 0);
}

export function filterBroadcastCandidates(
  articles: ArticleDetailRecord[],
  options: BroadcastPlannerOptions,
  now = Date.now(),
) {
  const categories = new Set(options.categoryFilters.map((value) => value.toLocaleLowerCase('de')));
  const sources = new Set(options.sourceIds);
  const oldest = now - options.freshnessHours * 3_600_000;
  return articles.filter((article) => {
    if (!['approved', 'published'].includes(article.status)) return false;
    if (Number(article.trust_score ?? 0) < options.minimumTrust) return false;
    if (articleTime(article) < oldest) return false;
    if (categories.size && !categories.has((article.category ?? '').toLocaleLowerCase('de'))) return false;
    if (sources.size && (!article.source_id || !sources.has(article.source_id))) return false;
    return true;
  });
}

export function deterministicBroadcastPlan(input: {
  channelName: string;
  articles: ArticleDetailRecord[];
  options: BroadcastPlannerOptions;
  now?: number;
}) {
  const now = input.now ?? Date.now();
  const remaining = input.articles.map((article) => ({
    article,
    score: baseScore(article, input.options, now),
  }));
  const selected: ArticleDetailRecord[] = [];
  let runtimeSeconds = 0;
  const runtimeTarget = input.options.targetRuntimeMinutes * 60;
  while (remaining.length && selected.length < input.options.maximumItems) {
    const previous = selected.at(-1);
    remaining.sort((a, b) => {
      const penalty = (entry: (typeof remaining)[number]) => {
        if (!previous || input.options.diversity === 'focused') return 0;
        const weight = input.options.diversity === 'high' ? 28 : 14;
        return (
          (entry.article.category && entry.article.category === previous.category ? weight : 0) +
          (entry.article.source_id && entry.article.source_id === previous.source_id ? weight : 0)
        );
      };
      return b.score - penalty(b) - (a.score - penalty(a)) || articleTime(b.article) - articleTime(a.article);
    });
    const next = remaining.shift()!.article;
    selected.push(next);
    runtimeSeconds += estimatedDurationSeconds(next);
    if (selected.length >= 3 && runtimeSeconds >= runtimeTarget) break;
  }
  const title =
    input.options.name?.trim() ||
    `${input.channelName} · ${focusLabels[input.options.focus]} ${new Date(now).toLocaleString('de-DE', {
      dateStyle: 'short',
      timeStyle: 'short',
      timeZone: 'UTC',
    })}`;
  const filters = [
    `${selected.length} Beiträge`,
    `ca. ${Math.max(1, Math.round(runtimeSeconds / 60))} Minuten`,
    `Mindestvertrauen ${input.options.minimumTrust}`,
    input.options.categoryFilters.length ? `Ressorts: ${input.options.categoryFilters.join(', ')}` : '',
  ].filter(Boolean);
  return {
    name: title,
    articleIds: selected.map((article) => article.id),
    rationale: `Robuster redaktioneller Ersatzplan nach Aktualität, Vertrauen und Themenwechseln (${filters.join(' · ')}).`,
    estimatedRuntimeSeconds: runtimeSeconds,
  };
}
