import { describe, expect, it, vi } from 'vitest';
import {
  aiHostResearchTerms,
  buildAiHostResearchPackage,
  reviewAiHostResearchSources,
  searchWikipediaForAiHost,
  searchYoutubeProgramSourceForAiHost,
} from '../apps/api/src/ai-host-research.js';

describe('AI host research desk', () => {
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
    expect(result.sources.map((source) => source.publisher)).toEqual(['Redaktionstest', 'Wikipedia (de)']);
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
});
