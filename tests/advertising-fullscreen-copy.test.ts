import { readFile } from 'node:fs/promises';
import { describe, expect, it } from 'vitest';

describe('Vollbild-Werbung', () => {
  it('rendert Medium und Werbetext als getrennte sichtbare Ebenen', async () => {
    const source = await readFile('apps/api/src/advertising.ts', 'utf8');
    expect(source).toContain('.ad.fullscreen .media{position:absolute');
    expect(source).toContain('.ad.fullscreen .copy{position:relative;z-index:2');
    expect(source).toContain("if(hasCopy){const copy=el('div','copy')");
    expect(source).toContain("if(ad.headline)copy.append(el('h1','',ad.headline))");
    expect(source).toContain("if(ad.body)copy.append(el('p','',ad.body))");
  });
});
