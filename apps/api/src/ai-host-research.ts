const GERMAN_RESEARCH_STOP_WORDS = new Set([
  'aber',
  'auch',
  'das',
  'dass',
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
  'hat',
  'haben',
  'heißt',
  'ist',
  'kann',
  'kommt',
  'man',
  'mit',
  'nach',
  'oder',
  'sich',
  'sie',
  'sind',
  'und',
  'von',
  'war',
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
  kind: 'newsroom' | 'reference' | 'program';
  title: string;
  publisher: string;
  url: string;
  excerpt: string;
  publishedAt: string | null;
  trustScore: number;
};

export type AiHostResearchPackage = {
  query: string;
  terms: string[];
  researchedAt: string;
  sources: AiHostResearchSource[];
  errors: string[];
  confidence: 'none' | 'limited' | 'supported';
};

type EditorialSource = {
  title: string;
  publisher: string;
  url: string;
  excerpt: string;
  published_at: string | null;
  trust_score: number;
};

function cleanText(value: unknown, maximum: number) {
  return String(value ?? '')
    .replace(/<[^>]+>/g, ' ')
    .replace(/\s+/g, ' ')
    .trim()
    .slice(0, maximum);
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
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), 8_000);
  try {
    const response = await fetchImpl(url, {
      signal: controller.signal,
      headers: { accept: 'application/json', 'user-agent': userAgent },
    });
    if (!response.ok) throw new Error(`${label} fehlgeschlagen (HTTP ${response.status}).`);
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

export async function searchWikipediaForAiHost(
  terms: string[],
  options: { fetchImpl?: typeof fetch; userAgent?: string } = {},
): Promise<AiHostResearchSource[]> {
  if (!terms.length) return [];
  const fetchImpl = options.fetchImpl ?? fetch;
  const userAgent = options.userAgent ?? 'OpenTVStudio/1.0 (AI research desk)';
  const searchUrl = new URL('https://de.wikipedia.org/w/api.php');
  searchUrl.search = new URLSearchParams({
    action: 'query',
    list: 'search',
    srsearch: terms.join(' '),
    srnamespace: '0',
    srlimit: '4',
    srprop: '',
    format: 'json',
    formatversion: '2',
    origin: '*',
  }).toString();
  const searchDocument = await fetchJsonLimited(searchUrl, fetchImpl, userAgent, 'Wikipedia-Recherche');
  const titleCandidates = (Array.isArray(searchDocument?.query?.search) ? searchDocument.query.search : [])
    .map((entry: any): string => cleanText(entry?.title, 220))
    .filter((title: string) => Boolean(title));
  const titles = [...new Set<string>(titleCandidates)].slice(0, 4);
  if (!titles.length) return [];

  const pageResults = await Promise.allSettled(
    titles.map(async (requestedTitle): Promise<AiHostResearchSource | null> => {
      const pageUrl = new URL('https://de.wikipedia.org/w/api.php');
      pageUrl.search = new URLSearchParams({
        action: 'query',
        titles: requestedTitle,
        prop: 'extracts|info',
        redirects: '1',
        explaintext: '1',
        exsectionformat: 'plain',
        inprop: 'url',
        format: 'json',
        formatversion: '2',
        origin: '*',
      }).toString();
      const document = await fetchJsonLimited(pageUrl, fetchImpl, userAgent, 'Wikipedia-Recherche');
      const page = Array.isArray(document?.query?.pages) ? document.query.pages[0] : null;
      const title = cleanText(page?.title, 220);
      const excerpt = focusedExcerpt(page?.extract, terms, 1400);
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
    }),
  );
  const sources: AiHostResearchSource[] = [];
  for (const result of pageResults) {
    if (result.status === 'fulfilled' && result.value) sources.push(result.value);
  }
  if (!sources.length) {
    const failure = pageResults.find((result): result is PromiseRejectedResult => result.status === 'rejected');
    if (failure) throw failure.reason;
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
  const unique = new Map<string, { source: AiHostResearchSource; relevance: number }>();
  const normalizedTerms = terms.map((term) => term.toLocaleLowerCase('de-DE')).filter(Boolean);
  const requiredMatches = Math.min(2, normalizedTerms.length);
  const specificTerms = normalizedTerms.length >= 3 ? normalizedTerms.slice(2) : [];
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
    const relevance = normalizedTerms.filter((term) => searchable.includes(term)).length;
    if (requiredMatches && relevance < requiredMatches) continue;
    if (specificTerms.length && !specificTerms.some((term) => searchable.includes(term))) continue;
    const key = `${url.hostname}${url.pathname}`.toLocaleLowerCase('de-DE');
    if (unique.has(key)) continue;
    unique.set(key, {
      relevance,
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
        (b.source.kind === 'program' ? 2 : b.source.kind === 'newsroom' ? 1 : 0) -
          (a.source.kind === 'program' ? 2 : a.source.kind === 'newsroom' ? 1 : 0) ||
        b.source.trustScore - a.source.trustScore,
    )
    .slice(0, 6)
    .map((entry) => entry.source);
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
  const [referenceResult, programResult] = await Promise.allSettled([
    searchWikipediaForAiHost(terms, {
      fetchImpl: input.fetchImpl,
      userAgent: input.env?.WIKIMEDIA_USER_AGENT ?? input.env?.NEWS_USER_AGENT ?? 'OpenTVStudio/1.0 (AI research desk)',
    }),
    input.videoUrl
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
  const sources = reviewAiHostResearchSources([...editorial, ...references, ...programSources], terms);
  return {
    query,
    terms,
    researchedAt: new Date().toISOString(),
    sources,
    errors,
    confidence: sources.some((source) => source.kind === 'newsroom' && source.trustScore >= 70)
      ? 'supported'
      : sources.length
        ? 'limited'
        : 'none',
  };
}
