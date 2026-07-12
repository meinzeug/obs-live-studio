import { describe, it, expect } from 'vitest';
import { parseHtmlArticle, contentHash } from '@ans/news-parser';
import { summarize, makeScript } from '@ans/content-processing';

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
  });
});
