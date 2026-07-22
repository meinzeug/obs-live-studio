import { describe, expect, it, vi } from 'vitest';
import {
  aiHostResearchTerms,
  buildAiHostResearchPackage,
  deriveAiHostVerifiedFact,
  reviewAiHostResearchSources,
  searchOpenWebForAiHost,
  searchWikipediaForAiHost,
  searchYoutubeProgramSourceForAiHost,
} from '../apps/api/src/ai-host-research.js';

describe('AI host research desk', () => {
  it('builds a substantive sourced identity and origin answer for combined biography questions', () => {
    const source = {
      kind: 'reference' as const,
      title: 'Salim Samatou',
      publisher: 'Wikipedia (de)',
      url: 'https://de.wikipedia.org/wiki/Salim_Samatou',
      excerpt:
        'Salim Samatou (* 3. Juli 1994 in Nador) ist ein in der Schweiz lebender Stand-up-Komiker und YouTuber marokkanisch-indischer Abstammung. Samatou wurde in Marokko als Sohn einer indischen Mutter und eines marokkanischen Vaters geboren.',
      publishedAt: null,
      trustScore: 65,
    };

    expect(deriveAiHostVerifiedFact('Wer ist Salim Samatou und woher kommt er?', [source])).toMatchObject({
      value: 'Nador',
      statement:
        'Salim Samatou ist ein in der Schweiz lebender Stand-up-Komiker und YouTuber marokkanisch-indischer Abstammung. Laut Wikipedia (de) wurde Salim Samatou in Nador in Marokko geboren.',
    });
  });

  it('extracts what a person learned after arriving instead of accepting an evasive model answer', () => {
    const source = {
      kind: 'reference' as const,
      title: 'Salim Samatou',
      publisher: 'Wikipedia (de)',
      url: 'https://de.wikipedia.org/wiki/Salim_Samatou',
      excerpt:
        'Als er 14 Jahre alt war, kam er mit seinen Eltern nach Deutschland. In Deutschland besuchte er zunächst die Hauptschule, erlernte die deutsche Sprache, wechselte auf die Realschule an der Heidenmauer und machte das Abitur am Wirtschaftsgymnasium.',
      publishedAt: null,
      trustScore: 65,
    };

    expect(deriveAiHostVerifiedFact('Was hat Salim Samatou gelernt, als er nach Deutschland kam?', [source])).toEqual({
      kind: 'arrival-learning',
      subject: 'Salim Samatou',
      value: 'Deutsch',
      statement:
        'Laut Wikipedia (de) lernte Salim Samatou nach seiner Ankunft in Deutschland Deutsch. Er besuchte dort zunächst die Hauptschule, wechselte anschließend auf die Realschule und machte später das Abitur.',
      sourceTitle: 'Salim Samatou',
      sourcePublisher: 'Wikipedia (de)',
      sourceUrl: 'https://de.wikipedia.org/wiki/Salim_Samatou',
    });
  });

  it('builds reusable sentence-level source evidence for arbitrary researched questions', () => {
    const source = {
      kind: 'reference' as const,
      title: 'Daniele Ganser',
      publisher: 'Wikipedia (de)',
      url: 'https://de.wikipedia.org/wiki/Daniele_Ganser',
      excerpt:
        'Daniele Ganser ist ein Schweizer Publizist. Er studierte Geschichte an der Universität Basel und wurde dort promoviert.',
      publishedAt: null,
      trustScore: 65,
    };

    expect(deriveAiHostVerifiedFact('Was hat Daniele Ganser studiert?', [source])).toMatchObject({
      kind: 'source-evidence',
      subject: 'Daniele Ganser',
      statement:
        'Laut Wikipedia (de) wird zu Daniele Ganser berichtet: Er studierte Geschichte an der Universität Basel und wurde dort promoviert.',
      sourceUrl: 'https://de.wikipedia.org/wiki/Daniele_Ganser',
    });
  });

  it('turns a viewer question into focused German research terms', () => {
    expect(aiHostResearchTerms('Wo hat Daniele Ganser studiert?')).toEqual(['daniele', 'ganser', 'studiert']);
    expect(aiHostResearchTerms('Woher kommt sie?', 'Interview mit Erika Mustermann')).toEqual([
      'interview',
      'erika',
      'mustermann',
    ]);
    expect(aiHostResearchTerms('Wer ist Björn Banane? Woher kommt er?', 'Ein queerer Deutscher #björnbanane')).toEqual([
      'björn',
      'banane',
    ]);
    expect(aiHostResearchTerms('Warum sollte von der AfD eine Gefahr ausgehen? Das ist doch lächerlich.')).toEqual([
      'afd',
      'gefahr',
    ]);
  });

  it('combines newsroom material with a bounded Wikipedia reference package', async () => {
    const fetchImpl = vi.fn(async (input: string | URL | Request) => {
      const url = new URL(String(input));
      if (url.searchParams.get('list') === 'search') {
        return new Response(JSON.stringify({ query: { search: [{ title: 'Daniele Ganser' }] } }), {
          status: 200,
          headers: { 'content-type': 'application/json' },
        });
      }
      return new Response(
        JSON.stringify({
          query: {
            pages: [
              {
                title: 'Daniele Ganser',
                fullurl: 'https://de.wikipedia.org/wiki/Daniele_Ganser',
                extract: 'Daniele Ganser studierte an einer Universität und schloss sein Studium ab.',
              },
            ],
          },
        }),
        { status: 200, headers: { 'content-type': 'application/json' } },
      );
    });
    const result = await buildAiHostResearchPackage({
      question: 'Wo hat Daniele Ganser studiert?',
      editorialSources: [
        {
          title: 'Interview zur Biografie',
          publisher: 'Redaktionstest',
          url: 'https://example.org/interview',
          excerpt:
            'Das Interview beschreibt, wo Daniele Ganser studierte, und verweist auf seinen akademischen Werdegang.',
          published_at: '2026-07-20T12:00:00.000Z',
          trust_score: 82,
        },
      ],
      fetchImpl: fetchImpl as unknown as typeof fetch,
    });

    expect(fetchImpl).toHaveBeenCalledTimes(2);
    expect(String(fetchImpl.mock.calls[0]?.[0])).toContain('list=search');
    expect(String(fetchImpl.mock.calls[1]?.[0])).toContain('titles=Daniele+Ganser');
    expect(result).toMatchObject({ confidence: 'supported', errors: [] });
    expect(result.sources.map((source) => source.publisher)).toEqual(['Wikipedia (de)', 'Redaktionstest']);
  });

  it('rejects duplicate, unsafe and content-free handoff entries', () => {
    const valid = {
      kind: 'reference' as const,
      title: 'Eintrag',
      publisher: 'Wikipedia (de)',
      url: 'https://de.wikipedia.org/wiki/Eintrag',
      excerpt: 'Dieser ausreichend lange Text enthält den geprüften Recherchekontext für die Moderation.',
      publishedAt: null,
      trustScore: 65,
    };
    expect(
      reviewAiHostResearchSources([
        valid,
        { ...valid, title: 'Duplikat' },
        { ...valid, url: 'file:///etc/passwd' },
        { ...valid, url: 'https://example.org/leer', excerpt: 'zu kurz' },
      ]),
    ).toEqual([valid]);
  });

  it('rejects nominal matches that miss the specific part of a longer question', () => {
    const base = {
      kind: 'newsroom' as const,
      title: 'Ein Beitrag mit Daniele Ganser',
      publisher: 'Redaktionstest',
      url: 'https://example.org/ganser',
      excerpt: 'Dieser ausreichend lange Text erwähnt Daniele Ganser, beantwortet aber eine völlig andere Frage.',
      publishedAt: null,
      trustScore: 90,
    };
    expect(reviewAiHostResearchSources([base], ['daniele', 'ganser', 'studiert'])).toEqual([]);
    expect(reviewAiHostResearchSources([{ ...base, trustScore: 45 }], ['daniele', 'ganser'])).toEqual([]);
    expect(
      reviewAiHostResearchSources(
        [{ ...base, excerpt: `${base.excerpt} Eine Passage beschreibt, wo er studierte.` }],
        ['daniele', 'ganser', 'studiert'],
      ),
    ).toHaveLength(1);
  });

  it('uses a bounded public web-search fallback and keeps the real source URL', async () => {
    const fetchImpl = vi.fn(async (input: string | URL | Request) => {
      const url = new URL(String(input));
      expect(url.origin).toBe('https://html.duckduckgo.com');
      expect(url.searchParams.get('q')).toContain('salim samatou');
      return new Response(
        `<div class="result">
          <a class="result__a" href="//duckduckgo.com/l/?uddg=https%3A%2F%2Fwww.samatou.de%2Fsalim-samatou">Salim Samatou</a>
          <a class="result__snippet">Salim Samatou kam nach Deutschland und lernte dort Deutsch. Danach besuchte er die Realschule.</a>
        </div>`,
        { status: 200, headers: { 'content-type': 'text/html' } },
      );
    });

    const sources = await searchOpenWebForAiHost(
      'Was hat Salim Samatou gelernt, als er nach Deutschland kam?',
      ['salim', 'samatou', 'gelernt', 'deutschland'],
      { fetchImpl: fetchImpl as unknown as typeof fetch },
    );

    expect(sources).toMatchObject([
      {
        kind: 'web',
        title: 'Salim Samatou',
        publisher: 'samatou.de',
        url: 'https://www.samatou.de/salim-samatou',
      },
    ]);
    expect(reviewAiHostResearchSources(sources, ['salim', 'samatou', 'gelernt', 'deutschland'])).toHaveLength(1);
  });

  it('falls back to web evidence when the reference desk has no concrete answer', async () => {
    const fetchImpl = vi.fn(async (input: string | URL | Request) => {
      const url = new URL(String(input));
      if (url.origin === 'https://html.duckduckgo.com') {
        return new Response(
          `<div class="result">
            <a class="result__a" href="//duckduckgo.com/l/?uddg=https%3A%2F%2Fwww.samatou.de%2Fsalim-samatou">Salim Samatou</a>
            <a class="result__snippet">Salim Samatou kam nach Deutschland, erlernte die deutsche Sprache, wechselte auf die Realschule und machte das Abitur.</a>
          </div>`,
          { status: 200 },
        );
      }
      if (url.searchParams.get('list') === 'search') {
        return new Response(JSON.stringify({ query: { search: [] } }), { status: 200 });
      }
      return new Response(
        JSON.stringify({
          query: {
            pages: [{ title: 'Salim Samatou', missing: true }],
          },
        }),
        { status: 200 },
      );
    });

    const result = await buildAiHostResearchPackage({
      question: 'Was hat Salim Samatou gelernt, als er nach Deutschland kam?',
      fetchImpl: fetchImpl as unknown as typeof fetch,
    });

    expect(result.sources[0]).toMatchObject({ kind: 'web', publisher: 'samatou.de' });
    expect(result.verifiedFact).toMatchObject({
      kind: 'arrival-learning',
      subject: 'Salim Samatou',
      value: 'Deutsch',
    });
  });

  it('uses bounded official YouTube metadata as a labelled program source', async () => {
    const fetchImpl = vi.fn(async (input: string | URL | Request) => {
      const url = new URL(String(input));
      expect(url.origin).toBe('https://www.youtube.com');
      expect(url.pathname).toBe('/oembed');
      expect(url.searchParams.get('url')).toBe('https://www.youtube.com/watch?v=test123');
      return new Response(
        JSON.stringify({
          title: 'Ein Testvideo',
          author_name: 'Testkanal',
          author_url: 'https://www.youtube.com/@testkanal',
        }),
        { status: 200 },
      );
    });
    const sources = await searchYoutubeProgramSourceForAiHost('https://www.youtube.com/watch?v=test123', {
      fetchImpl: fetchImpl as unknown as typeof fetch,
    });

    expect(sources).toMatchObject([
      {
        kind: 'program',
        publisher: 'YouTube · Testkanal',
        url: 'https://www.youtube.com/watch?v=test123',
      },
    ]);
    expect(sources[0]?.excerpt).toContain('Selbstdarstellung');
  });

  it('hands Ava the passage around the specific question instead of a generic article intro', async () => {
    const intro = `Daniele Ganser ist ein Schweizer Historiker. ${'Allgemeiner biografischer Kontext. '.repeat(65)}`;
    const sources = await searchWikipediaForAiHost(['daniele', 'ganser', 'studiert'], {
      fetchImpl: vi.fn(async (input: string | URL | Request) => {
        const url = new URL(String(input));
        if (url.searchParams.get('list') === 'search') {
          return new Response(JSON.stringify({ query: { search: [{ title: 'Daniele Ganser' }] } }), {
            status: 200,
          });
        }
        return new Response(
          JSON.stringify({
            query: {
              pages: [
                {
                  title: 'Daniele Ganser',
                  fullurl: 'https://de.wikipedia.org/wiki/Daniele_Ganser',
                  extract: `${intro}Daniele Ganser studierte Geschichte und schloss das Studium später ab.`,
                },
              ],
            },
          }),
          { status: 200 },
        );
      }) as unknown as typeof fetch,
    });

    expect(sources[0]?.excerpt).toContain('studierte Geschichte');
    expect(sources[0]?.excerpt).not.toContain('ist ein Schweizer Historiker');
  });

  it('follows Wikipedia spelling suggestions and answers a biographical question from the corrected source', async () => {
    const fetchImpl = vi.fn(async (input: string | URL | Request) => {
      const url = new URL(String(input));
      if (url.origin === 'https://www.youtube.com') {
        return new Response(
          JSON.stringify({
            title: 'Berlin – Rainer Rotfuß im Gespräch',
            author_name: 'Testkanal',
            author_url: 'https://www.youtube.com/@testkanal',
          }),
          { status: 200 },
        );
      }
      if (url.searchParams.get('list') === 'search') {
        if (url.searchParams.get('srsearch') === 'rainer rotfuß') {
          expect(url.searchParams.get('srinfo')).toBe('suggestion|rewrittenquery');
          return new Response(
            JSON.stringify({
              query: {
                searchinfo: { suggestion: 'rainer rothfuß' },
                search: [{ title: 'Unpassender Treffer' }],
              },
            }),
            { status: 200 },
          );
        }
        return new Response(JSON.stringify({ query: { search: [{ title: 'Rainer Rothfuß' }] } }), { status: 200 });
      }
      if (url.searchParams.get('titles')?.toLocaleLowerCase('de-DE').includes('rainer rothfuß')) {
        return new Response(
          JSON.stringify({
            query: {
              pages: [
                {
                  title: 'Rainer Rothfuß',
                  fullurl: 'https://de.wikipedia.org/wiki/Rainer_Rothfu%C3%9F',
                  extract:
                    'Rainer Rothfuß (* 19. April 1971 in Freudenstadt) ist ein deutscher Geograph und Politiker.',
                },
              ],
            },
          }),
          { status: 200 },
        );
      }
      return new Response(
        JSON.stringify({
          query: {
            pages: [
              {
                title: 'Unpassender Treffer',
                fullurl: 'https://de.wikipedia.org/wiki/Unpassender_Treffer',
                extract: 'Dieser ausreichend lange Text handelt von einem anderen Gegenstand ohne Personenbezug.',
              },
            ],
          },
        }),
        { status: 200 },
      );
    });

    const result = await buildAiHostResearchPackage({
      question: 'Woher kommt Rainer Rotfuß?',
      videoTitle: 'Berlin – Rainer Rotfuß im Gespräch',
      videoUrl: 'https://www.youtube.com/watch?v=test123',
      fetchImpl: fetchImpl as unknown as typeof fetch,
    });

    expect(result.sources).toMatchObject([
      {
        kind: 'reference',
        title: 'Rainer Rothfuß',
        publisher: 'Wikipedia (de)',
      },
    ]);
    expect(result.sources.some((source) => source.kind === 'program')).toBe(false);
    expect(result.verifiedFact).toMatchObject({
      kind: 'birthplace',
      subject: 'Rainer Rothfuß',
      value: 'Freudenstadt',
      statement: 'Laut Wikipedia (de) wurde Rainer Rothfuß in Freudenstadt geboren.',
    });
  });

  it('still resolves a likely corrected person page when Wikipedia search is temporarily rate limited', async () => {
    const fetchImpl = vi.fn(async (input: string | URL | Request) => {
      const url = new URL(String(input));
      if (url.searchParams.get('list') === 'search') {
        return new Response('{}', { status: 429, headers: { 'retry-after': '0' } });
      }
      if (url.searchParams.get('prop') === 'info') {
        expect(url.searchParams.get('titles')).toContain('Rainer Rothfuß');
        return new Response(
          JSON.stringify({
            query: {
              pages: [
                {
                  title: 'Rainer Rotfuß',
                  missing: true,
                  fullurl: 'https://de.wikipedia.org/wiki/Rainer_Rotfu%C3%9F',
                },
                {
                  title: 'Rainer Rothfuß',
                  fullurl: 'https://de.wikipedia.org/wiki/Rainer_Rothfu%C3%9F',
                },
              ],
            },
          }),
          { status: 200 },
        );
      }
      return new Response(
        JSON.stringify({
          query: {
            pages: [
              {
                title: 'Rainer Rothfuß',
                fullurl: 'https://de.wikipedia.org/wiki/Rainer_Rothfu%C3%9F',
                extract: 'Rainer Rothfuß (* 19. April 1971 in Freudenstadt) ist ein deutscher Geograph.',
              },
            ],
          },
        }),
        { status: 200 },
      );
    });

    const sources = await searchWikipediaForAiHost(['rainer', 'rotfuß'], {
      fetchImpl: fetchImpl as unknown as typeof fetch,
    });

    expect(fetchImpl).toHaveBeenCalledTimes(4);
    expect(sources).toMatchObject([{ title: 'Rainer Rothfuß', publisher: 'Wikipedia (de)' }]);
  });

  it('ranks independent editorial and reference sources ahead of program metadata', () => {
    const shared = {
      title: 'Rainer Rothfuß',
      excerpt: 'Rainer Rothfuß wurde in Freudenstadt geboren; dieser Text enthält den biografischen Kontext.',
      publishedAt: null,
      trustScore: 80,
    };
    const reviewed = reviewAiHostResearchSources(
      [
        { ...shared, kind: 'program', publisher: 'YouTube', url: 'https://youtube.com/watch?v=one' },
        { ...shared, kind: 'reference', publisher: 'Wikipedia (de)', url: 'https://de.wikipedia.org/wiki/one' },
        { ...shared, kind: 'newsroom', publisher: 'Redaktion', url: 'https://example.org/one' },
      ],
      ['rainer', 'rotfuß'],
    );

    expect(reviewed.map((source) => source.kind)).toEqual(['newsroom', 'reference', 'program']);
  });
});
