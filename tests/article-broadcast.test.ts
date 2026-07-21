import { describe, it, expect } from 'vitest';
import { parseHtmlArticle, contentHash } from '@ans/news-parser';
import { cleanArticleTextForBroadcast, combineEditorialWarnings, summarize, makeScript } from '@ans/content-processing';

describe('article to broadcast milestone', () => {
  it('extracts article text without executable markup', () => {
    const parsed = parseHtmlArticle(
      '<main><h1>Hallo</h1><script>alert(1)</script><style>body{}</style><p>Dies ist der sichere Haupttext eines Artikels mit genügend Inhalt für einen Beitrag.</p></main>',
      'https://example.org/a',
    );
    expect(parsed.text).toContain('sichere Haupttext');
    expect(parsed.text).not.toContain('alert(1)');
    expect(contentHash(parsed.text)).toHaveLength(64);
  });
  it('creates summary and speaker script from stored article text', () => {
    const text =
      'Die Redaktion prüft einen neuen Nachrichtenartikel. Der Text enthält belegte Informationen und wird für den Sendebeitrag verdichtet. Weitere Details bleiben im Originalartikel nachvollziehbar.';
    const summary = summarize(text);
    const script = makeScript('Neue Meldung', summary, 'Testquelle');
    expect(summary.length).toBeGreaterThan(20);
    expect(script).toContain('Nach Angaben von Testquelle');
    expect(script).not.toContain('Einordnung:');
    expect(script).not.toContain('Zwischenfazit:');
  });
  it('removes common website boilerplate before broadcast text generation', () => {
    const cleaned = cleanArticleTextForBroadcast(
      'Facebook Twitter Linkedin Xing Email Print Werbung: Die Regierung hat ein neues Programm beschlossen. Es startet im kommenden Jahr und betrifft mehrere Länder.',
    );
    expect(cleaned).toContain('Die Regierung hat ein neues Programm beschlossen');
    expect(cleaned).not.toContain('Facebook Twitter Linkedin');
  });
  it('rebuilds editorial warnings without accumulating stale AI findings', () => {
    expect(
      combineEditorialWarnings('Wahl steht an', 'Die Wahl findet am Sonntag statt.', ['Termin ungeprüft']),
    ).toEqual(['wahl', 'KI-Hinweis: Termin ungeprüft']);
    expect(combineEditorialWarnings('Haushalt', 'Der Haushalt wurde vorgestellt.', [])).toEqual([]);
  });
});
