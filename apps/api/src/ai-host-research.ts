import { load } from 'cheerio';

const GERMAN_RESEARCH_STOP_WORDS = new Set([
  'also',
  'aber',
  'aus',
  'ausgehen',
  'auch',
  'als',
  'das',
  'dass',
  'denn',
  'dem',
  'den',
  'der',
  'des',
  'die',
  'eine',
  'einem',
  'einen',
  'einer',
  'eines',
  'für',
  'frau',
  'hat',
  'haben',
  'heißt',
  'herr',
  'ist',
  'kann',
  'kam',
  'kommt',
  'doch',
  'gehen',
  'geht',
  'lächerlich',
  'man',
  'mit',
  'nach',
  'oder',
  'sich',
  'sei',
  'soll',
  'sollen',
  'sollte',
  'sollten',
  'sie',
  'sind',
  'und',
  'von',
  'war',
  'wäre',
  'was',
  'welche',
  'welcher',
  'welches',
  'wer',
  'wie',
  'wieso',
  'wo',
  'woher',
  'wann',
  'warum',
  'wurde',
  'wurden',
  'zum',
  'zur',
]);

export type AiHostResearchSource = {
  kind: 'newsroom' | 'reference' | 'web' | 'program';
  title: string;
  publisher: string;
  url: string;
  excerpt: string;
  publishedAt: string | null;
  trustScore: number;
};

export type AiHostVerifiedFact = {
  kind: 'birthplace' | 'arrival-learning' | 'source-evidence';
  subject: string;
  value: string;
  statement: string;
  sourceTitle: string;
  sourcePublisher: string;
  sourceUrl: string;
};

export type AiHostResearchPackage = {
  query: string;
  terms: string[];
  researchedAt: string;
  sources: AiHostResearchSource[];
  errors: string[];
  confidence: 'none' | 'limited' | 'supported';
  verifiedFact: AiHostVerifiedFact | null;
};

type EditorialSource = {
  title: string;
  publisher: string;
  url: string;
  excerpt: string;
  published_at: string | null;
  trust_score: number;
};

const wikipediaResearchCache = new Map<string, { expiresAt: number; sources: AiHostResearchSource[] }>();
const openWebResearchCache = new Map<string, { expiresAt: number; sources: AiHostResearchSource[] }>();

function cleanText(value: unknown, maximum: number) {
  return String(value ?? '')
    .replace(/<[^>]+>/g, ' ')
    .replace(/\s+/g, ' ')
    .trim()
    .slice(0, maximum);
}

function normalizedResearchToken(value: unknown) {
  return String(value ?? '')
    .normalize('NFKD')
    .replace(/\p{M}/gu, '')
    .replace(/ß/g, 'ss')
    .toLocaleLowerCase('de-DE')
    .replace(/[^\p{L}\p{N}]/gu, '');
}

function editDistanceAtMostOne(left: string, right: string) {
  if (left === right) return true;
  if (Math.abs(left.length - right.length) > 1) return false;
  if (left.length === right.length) {
    let differences = 0;
    for (let index = 0; index < left.length; index += 1) {
      if (left[index] !== right[index] && ++differences > 1) return false;
    }
    return true;
  }
  const [shorter, longer] = left.length < right.length ? [left, right] : [right, left];
  let shorterIndex = 0;
  let longerIndex = 0;
  let skipped = false;
  while (shorterIndex < shorter.length && longerIndex < longer.length) {
    if (shorter[shorterIndex] === longer[longerIndex]) {
      shorterIndex += 1;
      longerIndex += 1;
      continue;
    }
    if (skipped) return false;
    skipped = true;
    longerIndex += 1;
  }
  return true;
}

function researchTermMatches(searchable: string, searchableTokens: string[], term: string) {
  const normalizedTerm = normalizedResearchToken(term);
  if (!normalizedTerm) return false;
  if (searchable.includes(term.toLocaleLowerCase('de-DE')) || searchableTokens.includes(normalizedTerm)) return true;
  // Namen und flektierte Fragebegriffe dürfen einen einzelnen Tippfehler
  // enthalten. Kürzere Wörter bleiben exakt, damit die Recherche nicht
  // durch zufällige Ähnlichkeiten verwässert wird.
  if (normalizedTerm.length >= 5 && searchableTokens.some((token) => editDistanceAtMostOne(token, normalizedTerm)))
    return true;
  const concepts = [
    /(?:lern|sprach|schul|abitur)/u,
    /(?:stud|universit|hochschul|akadem)/u,
    /(?:geb|herkunft|stamm|komm)/u,
    /(?:arbeit|beruf|tatig|job)/u,
    /(?:wohn|leb|aufwachs)/u,
  ];
  return searchableTokens.some((token) =>
    concepts.some((concept) => concept.test(normalizedTerm) && concept.test(token)),
  );
}

function focusedExcerpt(value: unknown, terms: string[], maximum = 1400) {
  const text = cleanText(value, 8_000);
  if (text.length <= maximum || !terms.length) return text.slice(0, maximum);
  const lower = text.toLocaleLowerCase('de-DE');
  const starts = terms.map((term) => lower.indexOf(term)).filter((index) => index >= 0);
  let bestStart = 0;
  let bestScore = -1;
  for (const index of starts) {
    const start = Math.max(0, index - 320);
    const candidate = lower.slice(start, start + maximum);
    // Die ersten Begriffe sind häufig Name/Thema, die späteren Begriffe tragen
    // meist die eigentliche Frage (z. B. „studiert“). Deshalb gewinnt bei
    // gleicher Treffermenge die Passage mit dem spezifischeren Fragebegriff.
    const score = terms.reduce((total, term, termIndex) => total + (candidate.includes(term) ? termIndex + 1 : 0), 0);
    if (score > bestScore) {
      bestStart = start;
      bestScore = score;
    }
  }
  const excerpt = text.slice(bestStart, bestStart + maximum).trim();
  return `${bestStart > 0 ? '… ' : ''}${excerpt}${bestStart + maximum < text.length ? ' …' : ''}`;
}

export function aiHostResearchTerms(question: string, videoTitle = '') {
  const words = cleanText(question, 500)
    .normalize('NFKC')
    .match(/[\p{L}\p{N}][\p{L}\p{N}-]{1,}/gu);
  const terms = (words ?? [])
    .map((word) => word.toLocaleLowerCase('de-DE'))
    .filter((word) => word.length >= 3 && !GERMAN_RESEARCH_STOP_WORDS.has(word));
  const hasExplicitSubject = (words ?? []).some(
    (word) =>
      /^\p{Lu}/u.test(word) &&
      !GERMAN_RESEARCH_STOP_WORDS.has(word.toLocaleLowerCase('de-DE')) &&
      word.toLocaleLowerCase('de-DE') !== 'ich',
  );
  const needsVideoContext =
    terms.length < 2 || (/\b(er|ihn|ihm|sein|seine|ihr|ihre|dort|dazu|davon)\b/i.test(question) && !hasExplicitSubject);
  if (needsVideoContext) {
    const titleWords = cleanText(videoTitle, 300)
      .normalize('NFKC')
      .match(/[\p{L}\p{N}][\p{L}\p{N}-]{2,}/gu);
    for (const word of titleWords ?? []) {
      const normalized = word.toLocaleLowerCase('de-DE');
      if (!GERMAN_RESEARCH_STOP_WORDS.has(normalized)) terms.push(normalized);
    }
  }
  return [...new Set(terms)].slice(0, 10);
}

async function fetchJsonLimited(url: URL, fetchImpl: typeof fetch, userAgent: string, label = 'Recherche') {
  for (let attempt = 0; attempt < 2; attempt += 1) {
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), 8_000);
    try {
      const response = await fetchImpl(url, {
        signal: controller.signal,
        headers: { accept: 'application/json', 'user-agent': userAgent },
      });
      if (!response.ok) {
        if (attempt === 0 && [429, 502, 503, 504].includes(response.status)) {
          const retryAfterSeconds = Number(response.headers.get('retry-after'));
          const retryDelay = Number.isFinite(retryAfterSeconds)
            ? Math.max(250, Math.min(2_000, retryAfterSeconds * 1_000))
            : 500;
          await new Promise((resolve) => setTimeout(resolve, retryDelay));
          continue;
        }
        throw new Error(`${label} fehlgeschlagen (HTTP ${response.status}).`);
      }
      const declaredLength = Number(response.headers.get('content-length'));
      if (Number.isFinite(declaredLength) && declaredLength > 512 * 1024) {
        throw new Error(`${label} hat das sichere Antwortlimit überschritten.`);
      }
      const bytes = new Uint8Array(await response.arrayBuffer());
      if (bytes.byteLength > 512 * 1024) throw new Error(`${label} hat das sichere Antwortlimit überschritten.`);
      return JSON.parse(new TextDecoder().decode(bytes)) as any;
    } finally {
      clearTimeout(timer);
    }
  }
  throw new Error(`${label} fehlgeschlagen.`);
}

async function fetchTextLimited(url: URL, fetchImpl: typeof fetch, userAgent: string, label = 'Webrecherche') {
  for (let attempt = 0; attempt < 2; attempt += 1) {
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), 10_000);
    try {
      const response = await fetchImpl(url, {
        signal: controller.signal,
        headers: {
          accept: 'text/html,application/xhtml+xml',
          'accept-language': 'de-DE,de;q=0.9,en;q=0.6',
          'user-agent': userAgent,
        },
      });
      if (!response.ok) {
        if (attempt === 0 && [429, 502, 503, 504].includes(response.status)) {
          const retryAfterSeconds = Number(response.headers.get('retry-after'));
          await new Promise((resolve) =>
            setTimeout(
              resolve,
              Number.isFinite(retryAfterSeconds)
                ? Math.max(250, Math.min(2_000, retryAfterSeconds * 1_000))
                : 500,
            ),
          );
          continue;
        }
        throw new Error(`${label} fehlgeschlagen (HTTP ${response.status}).`);
      }
      const declaredLength = Number(response.headers.get('content-length'));
      if (Number.isFinite(declaredLength) && declaredLength > 768 * 1024) {
        throw new Error(`${label} hat das sichere Antwortlimit überschritten.`);
      }
      const bytes = new Uint8Array(await response.arrayBuffer());
      if (bytes.byteLength > 768 * 1024) throw new Error(`${label} hat das sichere Antwortlimit überschritten.`);
      return new TextDecoder().decode(bytes);
    } finally {
      clearTimeout(timer);
    }
  }
  throw new Error(`${label} fehlgeschlagen.`);
}

function publicSearchResultUrl(value: string) {
  try {
    const intermediary = new URL(value, 'https://html.duckduckgo.com');
    const target = intermediary.searchParams.get('uddg')
      ? new URL(intermediary.searchParams.get('uddg')!)
      : intermediary;
    const hostname = target.hostname.toLocaleLowerCase('en-US').replace(/^www\./, '');
    if (!['http:', 'https:'].includes(target.protocol)) return null;
    if (
      !hostname ||
      hostname === 'localhost' ||
      hostname.endsWith('.local') ||
      hostname === '0.0.0.0' ||
      hostname === '127.0.0.1' ||
      hostname === '::1' ||
      /^(?:10|192\.168)\./u.test(hostname) ||
      /^172\.(?:1[6-9]|2\d|3[01])\./u.test(hostname) ||
      hostname.endsWith('duckduckgo.com')
    )
      return null;
    target.hash = '';
    return target;
  } catch {
    return null;
  }
}

function webSourceTrustScore(hostname: string) {
  const host = hostname.toLocaleLowerCase('en-US').replace(/^www\./, '');
  if (
    /(?:^|\.)(?:bund\.de|gov|edu)$/u.test(host) ||
    ['bundestag.de', 'bundesregierung.de', 'destatis.de', 'europa.eu'].some(
      (domain) => host === domain || host.endsWith(`.${domain}`),
    )
  )
    return 78;
  if (
    [
      'tagesschau.de',
      'deutschlandfunk.de',
      'zdf.de',
      'ard.de',
      'dw.com',
      'reuters.com',
      'apnews.com',
      'bbc.com',
      'zeit.de',
      'spiegel.de',
      'sueddeutsche.de',
      'faz.net',
      'nzz.ch',
      'taz.de',
    ].some((domain) => host === domain || host.endsWith(`.${domain}`))
  )
    return 72;
  return 58;
}

export async function searchOpenWebForAiHost(
  question: string,
  terms: string[],
  options: { fetchImpl?: typeof fetch; userAgent?: string } = {},
): Promise<AiHostResearchSource[]> {
  if (!terms.length) return [];
  const query =
    terms.length >= 2
      ? `"${terms.slice(0, 2).join(' ')}" ${terms.slice(2).join(' ')}`.trim()
      : cleanText(question, 500);
  const cacheKey = normalizedResearchToken(query);
  const cached = options.fetchImpl ? null : openWebResearchCache.get(cacheKey);
  if (cached && cached.expiresAt > Date.now()) return cached.sources.map((source) => ({ ...source }));
  const url = new URL('https://html.duckduckgo.com/html/');
  url.search = new URLSearchParams({ q: query, kl: 'de-de' }).toString();
  const html = await fetchTextLimited(
    url,
    options.fetchImpl ?? fetch,
    options.userAgent ?? 'OpenTVStudio/1.0 (AI research desk)',
    'Öffentliche Webrecherche',
  );
  const $ = load(html);
  const sources: AiHostResearchSource[] = [];
  $('.result').each((_index, result) => {
    if (sources.length >= 8) return false;
    const titleLink = $(result).find('.result__a').first();
    const snippetNode = $(result).find('.result__snippet').first();
    const target = publicSearchResultUrl(titleLink.attr('href') ?? snippetNode.attr('href') ?? '');
    const title = cleanText(titleLink.text(), 220);
    const excerpt = cleanText(snippetNode.text(), 1400);
    if (!target || !title || excerpt.length < 40) return;
    const publisher = target.hostname.toLocaleLowerCase('en-US').replace(/^www\./, '');
    sources.push({
      kind: 'web',
      title,
      publisher,
      url: target.toString(),
      excerpt,
      publishedAt: null,
      trustScore: webSourceTrustScore(publisher),
    });
  });
  if (!options.fetchImpl) {
    openWebResearchCache.set(cacheKey, {
      expiresAt: Date.now() + 15 * 60_000,
      sources: sources.map((source) => ({ ...source })),
    });
    if (openWebResearchCache.size > 250) {
      const oldest = openWebResearchCache.keys().next().value;
      if (oldest) openWebResearchCache.delete(oldest);
    }
  }
  return sources;
}

function wikipediaTitleCase(value: string) {
  return value.replace(
    /(^|[\s-])(\p{L})/gu,
    (_match, prefix: string, letter: string) => `${prefix}${letter.toLocaleUpperCase('de-DE')}`,
  );
}

function likelyWikipediaTitles(terms: string[]) {
  const subjectTerms = terms
    .slice(0, 2)
    .map((term) => cleanText(term, 80))
    .filter(Boolean);
  if (!subjectTerms.length) return [];
  const candidates = [wikipediaTitleCase(subjectTerms.join(' '))];
  for (let termIndex = 0; termIndex < subjectTerms.length; termIndex += 1) {
    const term = subjectTerms[termIndex] ?? '';
    for (let index = 0; index < term.length; index += 1) {
      const current = term[index]?.toLocaleLowerCase('de-DE');
      const next = term[index + 1]?.toLocaleLowerCase('de-DE');
      let variant = '';
      if (current === 't' && next !== 'h') variant = `${term.slice(0, index + 1)}h${term.slice(index + 1)}`;
      if (current === 't' && next === 'h') variant = `${term.slice(0, index + 1)}${term.slice(index + 2)}`;
      if (!variant) continue;
      const words = [...subjectTerms];
      words[termIndex] = variant;
      candidates.push(wikipediaTitleCase(words.join(' ')));
    }
  }
  return [...new Set(candidates)].slice(0, 6);
}

export async function searchWikipediaForAiHost(
  terms: string[],
  options: { fetchImpl?: typeof fetch; userAgent?: string } = {},
): Promise<AiHostResearchSource[]> {
  if (!terms.length) return [];
  const cacheKey = terms.map(normalizedResearchToken).filter(Boolean).join(' ');
  const cached = options.fetchImpl ? null : wikipediaResearchCache.get(cacheKey);
  if (cached && cached.expiresAt > Date.now()) return cached.sources.map((source) => ({ ...source }));
  const fetchImpl = options.fetchImpl ?? fetch;
  const userAgent = options.userAgent ?? 'OpenTVStudio/1.0 (AI research desk)';
  const wikipediaSearch = async (query: string) => {
    const searchUrl = new URL('https://de.wikipedia.org/w/api.php');
    searchUrl.search = new URLSearchParams({
      action: 'query',
      list: 'search',
      srsearch: query,
      srnamespace: '0',
      srlimit: '4',
      srprop: '',
      srinfo: 'suggestion|rewrittenquery',
      format: 'json',
      formatversion: '2',
      origin: '*',
    }).toString();
    return fetchJsonLimited(searchUrl, fetchImpl, userAgent, 'Wikipedia-Recherche');
  };

  const originalQuery = terms.join(' ');
  let initialDocument: any = null;
  let searchFailure: unknown = null;
  try {
    initialDocument = await wikipediaSearch(originalQuery);
  } catch (error) {
    searchFailure = error;
  }
  const suggestedQuery = cleanText(
    initialDocument?.query?.searchinfo?.suggestion ?? initialDocument?.query?.searchinfo?.rewrittenquery,
    300,
  );
  const suggestedTitle = wikipediaTitleCase(suggestedQuery);
  // MediaWiki liefert bei Schreibfehlern eine fertig korrigierte Suchphrase.
  // Diese wird direkt als Seitentitel versucht; eine zweite Volltextsuche wäre
  // langsamer, erzeugt unnötige Last und kann erneut zufällige Treffer liefern.
  const titleCandidates = [
    ...(suggestedTitle ? [suggestedTitle] : []),
    ...likelyWikipediaTitles(terms),
    ...(Array.isArray(initialDocument?.query?.search) ? initialDocument.query.search : []).map((entry: any) =>
      cleanText(entry?.title, 220),
    ),
  ]
    .map((entry): string => cleanText(entry, 220))
    .filter((title: string) => Boolean(title));
  const titles = [...new Set<string>(titleCandidates)].slice(0, 4);
  if (!titles.length) {
    if (searchFailure) throw searchFailure;
    if (!options.fetchImpl) wikipediaResearchCache.set(cacheKey, { expiresAt: Date.now() + 5 * 60_000, sources: [] });
    return [];
  }
  const excerptTerms = [
    ...terms,
    ...(suggestedQuery.match(/[\p{L}\p{N}][\p{L}\p{N}-]{1,}/gu) ?? []).map((term) => term.toLocaleLowerCase('de-DE')),
  ];

  const pageUrl = new URL('https://de.wikipedia.org/w/api.php');
  pageUrl.search = new URLSearchParams({
    action: 'query',
    titles: titles.join('|'),
    prop: 'info',
    redirects: '1',
    inprop: 'url',
    format: 'json',
    formatversion: '2',
    origin: '*',
  }).toString();
  const pageDocument = await fetchJsonLimited(pageUrl, fetchImpl, userAgent, 'Wikipedia-Recherche');
  const candidateRanks = new Map(titles.map((title, index) => [normalizedResearchToken(title), index]));
  const pageTitleScore = (page: any) => {
    const title = cleanText(page?.title, 220).toLocaleLowerCase('de-DE');
    const tokens = (title.match(/[\p{L}\p{N}]+/gu) ?? []).map(normalizedResearchToken).filter(Boolean);
    return terms.filter((term) => researchTermMatches(title, tokens, term)).length;
  };
  const rankedPages = (Array.isArray(pageDocument?.query?.pages) ? pageDocument.query.pages : [])
    .filter((page: any) => page?.missing !== true && cleanText(page?.title, 220))
    .sort(
      (left: any, right: any) =>
        pageTitleScore(right) - pageTitleScore(left) ||
        (candidateRanks.get(normalizedResearchToken(left?.title)) ?? 999) -
          (candidateRanks.get(normalizedResearchToken(right?.title)) ?? 999),
    );
  const strongTitleMatches = rankedPages.filter(
    (page: any) => pageTitleScore(page) >= Math.min(2, Math.max(1, terms.length)),
  );
  const pageCandidates = (strongTitleMatches.length ? strongTitleMatches : rankedPages).slice(0, 3);
  const pageResults = await Promise.allSettled(
    pageCandidates.map(async (candidate: any) => {
      if (cleanText(candidate?.extract, 10)) return candidate;
      const detailUrl = new URL('https://de.wikipedia.org/w/api.php');
      detailUrl.search = new URLSearchParams({
        action: 'query',
        titles: cleanText(candidate?.title, 220),
        prop: 'extracts|info',
        redirects: '1',
        explaintext: '1',
        exsectionformat: 'plain',
        inprop: 'url',
        format: 'json',
        formatversion: '2',
        origin: '*',
      }).toString();
      const detailDocument = await fetchJsonLimited(detailUrl, fetchImpl, userAgent, 'Wikipedia-Recherche');
      return Array.isArray(detailDocument?.query?.pages) ? detailDocument.query.pages[0] : null;
    }),
  );
  const detailedPages = pageResults
    .filter((result): result is PromiseFulfilledResult<any> => result.status === 'fulfilled' && Boolean(result.value))
    .map((result) => result.value);
  const sources: AiHostResearchSource[] = detailedPages
    .map((page: any): AiHostResearchSource | null => {
      const title = cleanText(page?.title, 220);
      const excerpt = focusedExcerpt(page?.extract, [...new Set(excerptTerms)], 1400);
      const canonicalUrl = cleanText(page?.fullurl, 1000);
      if (!title || !excerpt || !/^https:\/\//i.test(canonicalUrl)) return null;
      return {
        kind: 'reference',
        title,
        publisher: 'Wikipedia (de)',
        url: canonicalUrl,
        excerpt,
        publishedAt: null,
        trustScore: 65,
      } satisfies AiHostResearchSource;
    })
    .filter((source: AiHostResearchSource | null): source is AiHostResearchSource => Boolean(source));
  if (!sources.length) {
    const pageFailure = pageResults.find((result): result is PromiseRejectedResult => result.status === 'rejected');
    if (pageFailure) throw pageFailure.reason;
    if (searchFailure) throw searchFailure;
  }
  if (!options.fetchImpl) {
    wikipediaResearchCache.set(cacheKey, {
      expiresAt: Date.now() + 60 * 60_000,
      sources: sources.map((source) => ({ ...source })),
    });
    if (wikipediaResearchCache.size > 250) {
      const oldest = wikipediaResearchCache.keys().next().value;
      if (oldest) wikipediaResearchCache.delete(oldest);
    }
  }
  return sources;
}

export async function searchYoutubeProgramSourceForAiHost(
  videoUrl: string,
  options: { fetchImpl?: typeof fetch; userAgent?: string } = {},
): Promise<AiHostResearchSource[]> {
  let sourceUrl: URL;
  try {
    sourceUrl = new URL(videoUrl);
  } catch {
    return [];
  }
  const hostname = sourceUrl.hostname.toLocaleLowerCase('en-US').replace(/^www\./, '');
  if (!['youtube.com', 'youtu.be'].includes(hostname) || sourceUrl.protocol !== 'https:') return [];

  const oembedUrl = new URL('https://www.youtube.com/oembed');
  oembedUrl.search = new URLSearchParams({ url: sourceUrl.toString(), format: 'json' }).toString();
  const document = await fetchJsonLimited(
    oembedUrl,
    options.fetchImpl ?? fetch,
    options.userAgent ?? 'OpenTVStudio/1.0 (AI research desk)',
    'YouTube-Programmrecherche',
  );
  const title = cleanText(document?.title, 220);
  const author = cleanText(document?.author_name, 160);
  const authorUrl = cleanText(document?.author_url, 1000);
  if (!title || !author) return [];
  const publicChannel = /^https:\/\/(?:www\.)?youtube\.com\//i.test(authorUrl)
    ? ` Öffentlicher Kanal: ${authorUrl}.`
    : '';
  const excerpt = cleanText(
    `Die offiziellen YouTube-oEmbed-Metadaten ordnen das laufende Video „${title}“ dem Kanal „${author}“ zu.${publicChannel} Diese Programquelle ist eine Selbstdarstellung und belegt keine darüber hinausgehenden biografischen Angaben.`,
    1400,
  );
  return [
    {
      kind: 'program',
      title,
      publisher: `YouTube · ${author}`,
      url: sourceUrl.toString(),
      excerpt,
      publishedAt: null,
      trustScore: 70,
    },
  ];
}

export function reviewAiHostResearchSources(sources: AiHostResearchSource[], terms: string[] = []) {
  const unique = new Map<string, { source: AiHostResearchSource; relevance: number; titleRelevance: number }>();
  const normalizedTerms = terms.map((term) => term.toLocaleLowerCase('de-DE')).filter(Boolean);
  const requiredMatches = Math.min(2, normalizedTerms.length);
  const subjectTerms = normalizedTerms.slice(0, Math.min(2, normalizedTerms.length));
  const specificTerms = normalizedTerms.length >= 3 ? normalizedTerms.slice(subjectTerms.length) : [];
  for (const source of sources) {
    let url: URL;
    try {
      url = new URL(source.url);
    } catch {
      continue;
    }
    if (!['http:', 'https:'].includes(url.protocol)) continue;
    const title = cleanText(source.title, 220);
    const excerpt = cleanText(source.excerpt, 1400);
    const publisher = cleanText(source.publisher, 160);
    const trustScore = Math.max(0, Math.min(100, Number(source.trustScore) || 0));
    if (!title || !publisher || excerpt.length < 30) continue;
    if (source.kind === 'newsroom' && trustScore < 50) continue;
    const searchable = `${title} ${publisher} ${excerpt}`.toLocaleLowerCase('de-DE');
    const searchableTokens = (searchable.match(/[\p{L}\p{N}]+/gu) ?? []).map(normalizedResearchToken).filter(Boolean);
    const relevance = normalizedTerms.filter((term) => researchTermMatches(searchable, searchableTokens, term)).length;
    const titleSearchable = title.toLocaleLowerCase('de-DE');
    const titleTokens = (titleSearchable.match(/[\p{L}\p{N}]+/gu) ?? []).map(normalizedResearchToken).filter(Boolean);
    const titleRelevance = normalizedTerms.filter((term) =>
      researchTermMatches(titleSearchable, titleTokens, term),
    ).length;
    const subjectRelevance = subjectTerms.filter((term) =>
      researchTermMatches(searchable, searchableTokens, term),
    ).length;
    if (requiredMatches && relevance < requiredMatches) continue;
    if (source.kind !== 'program' && subjectTerms.length > 1 && subjectRelevance < subjectTerms.length) continue;
    if (specificTerms.length && !specificTerms.some((term) => researchTermMatches(searchable, searchableTokens, term)))
      continue;
    const key = `${url.hostname}${url.pathname}`.toLocaleLowerCase('de-DE');
    if (unique.has(key)) continue;
    unique.set(key, {
      relevance,
      titleRelevance,
      source: {
        ...source,
        title,
        publisher,
        excerpt,
        url: url.toString(),
        trustScore,
      },
    });
  }
  return [...unique.values()]
    .sort(
      (a, b) =>
        b.relevance - a.relevance ||
        b.titleRelevance - a.titleRelevance ||
        (b.source.kind === 'newsroom' ? 4 : b.source.kind === 'reference' ? 3 : b.source.kind === 'web' ? 2 : 1) -
          (a.source.kind === 'newsroom' ? 4 : a.source.kind === 'reference' ? 3 : a.source.kind === 'web' ? 2 : 1) ||
        b.source.trustScore - a.source.trustScore,
    )
    .slice(0, 6)
    .map((entry) => entry.source);
}

export function aiHostQuestionUsesProgramMetadata(question: string) {
  const normalized = cleanText(question, 500).toLocaleLowerCase('de-DE');
  return (
    /\b(?:video|youtube|kanal|stream)\b/u.test(normalized) &&
    /\b(?:titel|heißt|lautet|hochgeladen|veröffentlicht|kanal|uploader)\b/u.test(normalized)
  );
}

function evidenceStem(value: string) {
  let token = normalizedResearchToken(value);
  if (token.length > 5) token = token.replace(/^ge(?=[a-z]{4})/u, '');
  return token.replace(/(?:ungen|ung|ieren|iert|ischen|ische|lich|ern|en|er|es|e|te|ten|t)$/u, '');
}

function evidenceTokenMatches(left: string, right: string) {
  const normalizedLeft = normalizedResearchToken(left);
  const normalizedRight = normalizedResearchToken(right);
  if (!normalizedLeft || !normalizedRight) return false;
  if (researchTermMatches(normalizedLeft, [normalizedLeft], normalizedRight)) return true;
  const leftStem = evidenceStem(normalizedLeft);
  const rightStem = evidenceStem(normalizedRight);
  if (leftStem.length >= 4 && rightStem.length >= 4) {
    if (leftStem === rightStem || leftStem.includes(rightStem) || rightStem.includes(leftStem)) return true;
  }
  const conceptGroups = [
    /(?:lern|sprach|schul|abitur)/u,
    /(?:stud|universit|hochschul|akadem)/u,
    /(?:geb|herkunft|stamm|komm)/u,
    /(?:arbeit|beruf|tatig|job)/u,
    /(?:wohn|leb|aufwachs)/u,
    /(?:grund|ursach|deshalb|daher|weil)/u,
  ];
  return conceptGroups.some((group) => group.test(normalizedLeft) && group.test(normalizedRight));
}

function evidenceSentences(value: string) {
  return (cleanText(value, 8_000).match(/[^.!?]+(?:[.!?]+|$)/gu) ?? [])
    .map((sentence) => sentence.trim())
    .filter((sentence) => sentence.length >= 24 && sentence.length <= 700);
}

function deriveSourceEvidence(question: string, sources: AiHostResearchSource[]): AiHostVerifiedFact | null {
  const terms = aiHostResearchTerms(question);
  if (!terms.length) return null;
  let best:
    | {
        source: AiHostResearchSource;
        sentence: string;
        score: number;
        value: string;
      }
    | undefined;
  for (const source of sources) {
    if (source.kind === 'program' && !aiHostQuestionUsesProgramMetadata(question)) continue;
    const titleTokens = (source.title.match(/[\p{L}\p{N}]+/gu) ?? []).map(normalizedResearchToken).filter(Boolean);
    const intentTerms = terms.filter(
      (term) => !titleTokens.some((titleToken) => evidenceTokenMatches(titleToken, term)),
    );
    const effectiveIntentTerms = intentTerms.length ? intentTerms : terms;
    for (const sentence of evidenceSentences(source.excerpt)) {
      const sentenceTokens = (sentence.match(/[\p{L}\p{N}]+/gu) ?? []).map(normalizedResearchToken).filter(Boolean);
      const matchedIntentTerms = effectiveIntentTerms.filter((term) =>
        sentenceTokens.some((token) => evidenceTokenMatches(token, term)),
      );
      if (!matchedIntentTerms.length) continue;
      const matchedTerms = terms.filter((term) => sentenceTokens.some((token) => evidenceTokenMatches(token, term)));
      const score =
        matchedIntentTerms.length * 8 +
        matchedTerms.length * 3 +
        (source.kind === 'newsroom' ? 3 : source.kind === 'reference' ? 2 : 0) +
        Math.min(3, Math.floor(sentence.length / 120));
      if (!best || score > best.score) {
        best = { source, sentence, score, value: matchedIntentTerms[0] ?? matchedTerms[0] ?? terms[0]! };
      }
    }
  }
  if (!best) return null;
  const subject = cleanText(best.source.title.replace(/\s+\([^)]*\)\s*$/u, ''), 160);
  const statement = cleanText(`Laut ${best.source.publisher} wird zu ${subject} berichtet: ${best.sentence}`, 740);
  return {
    kind: 'source-evidence',
    subject,
    value: best.value,
    statement: /[.!?]$/u.test(statement) ? statement : `${statement}.`,
    sourceTitle: best.source.title,
    sourcePublisher: best.source.publisher,
    sourceUrl: best.source.url,
  };
}

export function deriveAiHostVerifiedFact(question: string, sources: AiHostResearchSource[]): AiHostVerifiedFact | null {
  const cleanQuestion = cleanText(question, 500);
  const asksArrivalLearning =
    /\b(?:was|welche(?:s|n|r)?)\b.{0,100}\b(?:gelernt|erlernt)\b/iu.test(cleanQuestion) &&
    /\b(?:deutschland|ankam|angekommen|kam)\b/iu.test(cleanQuestion);
  if (asksArrivalLearning) {
    for (const source of sources) {
      if (source.kind === 'program') continue;
      const excerpt = cleanText(source.excerpt, 2200);
      const learnedLanguage = excerpt.match(
        /\b(?:erlernte|lernte)\s+(?:dort\s+)?(?:die\s+)?(deutsche\s+Sprache|Deutsch)\b/iu,
      )?.[1];
      const subject = cleanText(source.title.replace(/\s+\([^)]*\)\s*$/u, ''), 160);
      if (!learnedLanguage || !subject) continue;
      const schoolContext =
        /\bHauptschule\b/iu.test(excerpt) && /\bRealschule\b/iu.test(excerpt) && /\bAbitur\b/iu.test(excerpt);
      return {
        kind: 'arrival-learning',
        subject,
        value: 'Deutsch',
        statement: schoolContext
          ? `Laut ${source.publisher} lernte ${subject} nach seiner Ankunft in Deutschland Deutsch. Er besuchte dort zunächst die Hauptschule, wechselte anschließend auf die Realschule und machte später das Abitur.`
          : `Laut ${source.publisher} lernte ${subject} nach seiner Ankunft in Deutschland Deutsch.`,
        sourceTitle: source.title,
        sourcePublisher: source.publisher,
        sourceUrl: source.url,
      };
    }
  }
  if (/\b(?:woher\s+kommt|wo\s+(?:ist|wurde).{0,40}geboren)\b/iu.test(cleanQuestion)) {
    for (const source of sources) {
      if (source.kind === 'program') continue;
      const excerpt = cleanText(source.excerpt, 2000);
      const birthplace =
        excerpt.match(/\(\*\s*[^)]{0,100}?\bin\s+([^),;]{2,80})\)/iu)?.[1] ??
        excerpt.match(/\bgeboren\s+(?:am\s+[^,;.]{1,60}\s+)?(?:wurde\s+)?in\s+([^,;.()]{2,80})/iu)?.[1] ??
        excerpt.match(/\bgeboren\s+am\s+[^,;.]{1,60}\s+in\s+([^,;.()]{2,80})/iu)?.[1];
      const value = cleanText(birthplace, 80)
        .replace(/\s+(?:und|ist|war)$/iu, '')
        .trim();
      const subject = cleanText(source.title.replace(/\s+\([^)]*\)\s*$/u, ''), 160);
      if (!value || !subject) continue;
      const escapedSubject = subject.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
      const identity = excerpt.match(
        new RegExp(`^${escapedSubject}\\s+(?:\\([^)]{0,180}\\)\\s*)?ist\\s+([^.!?]{8,320})[.!?]`, 'iu'),
      )?.[1];
      const country = excerpt.match(/\bwurde\s+in\s+([^,.;]{2,60}?)(?:\s+als\s+[^.]{0,220})?\s+geboren\b/iu)?.[1];
      const asksIdentity = /\bwer\s+ist\b/iu.test(cleanQuestion);
      const identityStatement = asksIdentity && identity ? `${subject} ist ${cleanText(identity, 320)}.` : '';
      const countrySuffix =
        country && normalizedResearchToken(country) !== normalizedResearchToken(value)
          ? ` in ${cleanText(country, 60)}`
          : '';
      return {
        kind: 'birthplace',
        subject,
        value,
        statement:
          `${identityStatement} Laut ${source.publisher} wurde ${subject} in ${value}${countrySuffix} geboren.`.trim(),
        sourceTitle: source.title,
        sourcePublisher: source.publisher,
        sourceUrl: source.url,
      };
    }
  }
  return deriveSourceEvidence(cleanQuestion, sources);
}

export async function buildAiHostResearchPackage(input: {
  question: string;
  videoTitle?: string;
  videoUrl?: string;
  editorialSources?: EditorialSource[];
  env?: NodeJS.ProcessEnv;
  fetchImpl?: typeof fetch;
}): Promise<AiHostResearchPackage> {
  const terms = aiHostResearchTerms(input.question, input.videoTitle);
  const query = terms.join(' ');
  const errors: string[] = [];
  const editorial = (input.editorialSources ?? []).map((source): AiHostResearchSource => ({
    kind: 'newsroom',
    title: source.title,
    publisher: source.publisher,
    url: source.url,
    excerpt: source.excerpt,
    publishedAt: source.published_at,
    trustScore: source.trust_score,
  }));
  const usesProgramMetadata = aiHostQuestionUsesProgramMetadata(input.question);
  const [referenceResult, programResult] = await Promise.allSettled([
    searchWikipediaForAiHost(terms, {
      fetchImpl: input.fetchImpl,
      userAgent: input.env?.WIKIMEDIA_USER_AGENT ?? input.env?.NEWS_USER_AGENT ?? 'OpenTVStudio/1.0 (AI research desk)',
    }),
    input.videoUrl && usesProgramMetadata
      ? searchYoutubeProgramSourceForAiHost(input.videoUrl, {
          fetchImpl: input.fetchImpl,
          userAgent: input.env?.NEWS_USER_AGENT ?? 'OpenTVStudio/1.0 (AI research desk)',
        })
      : Promise.resolve([]),
  ]);
  const references = referenceResult.status === 'fulfilled' ? referenceResult.value : [];
  const programSources = programResult.status === 'fulfilled' ? programResult.value : [];
  for (const result of [referenceResult, programResult]) {
    if (result.status === 'rejected')
      errors.push(result.reason instanceof Error ? result.reason.message : String(result.reason));
  }
  let sourceCandidates = usesProgramMetadata
    ? [...editorial, ...references, ...programSources]
    : [...editorial, ...references];
  let sources = reviewAiHostResearchSources(sourceCandidates, terms);
  let verifiedFact = deriveAiHostVerifiedFact(input.question, sources);
  if (!verifiedFact && terms.length) {
    try {
      const webSources = await searchOpenWebForAiHost(input.question, terms, {
        fetchImpl: input.fetchImpl,
        userAgent: input.env?.NEWS_USER_AGENT ?? 'OpenTVStudio/1.0 (AI research desk)',
      });
      sourceCandidates = [...sourceCandidates, ...webSources];
      sources = reviewAiHostResearchSources(sourceCandidates, terms);
      verifiedFact = deriveAiHostVerifiedFact(input.question, sources);
    } catch (error) {
      errors.push(error instanceof Error ? error.message : String(error));
    }
  }
  return {
    query,
    terms,
    researchedAt: new Date().toISOString(),
    sources,
    errors,
    confidence: sources.some(
      (source) =>
        (source.kind === 'newsroom' && source.trustScore >= 70) ||
        (source.kind === 'reference' && source.trustScore >= 65) ||
        (source.kind === 'web' && source.trustScore >= 70),
    )
      ? 'supported'
      : sources.length
        ? 'limited'
        : 'none',
    verifiedFact,
  };
}
