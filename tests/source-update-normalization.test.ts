import { describe, expect, it } from 'vitest';
import { prepareSourceUpdate } from '../packages/database/src/source-update.js';

const current = {
  id: 'source-id',
  name: 'Quelle',
  url: 'https://example.org/feed.xml',
  user_agent: '  Studio-Crawler/2.0  ',
  trust_level: 50,
};

describe('source update normalization', () => {
  it('preserves and trims the stored user agent on unrelated partial updates', () => {
    const prepared = prepareSourceUpdate(current, { name: 'Neue Bezeichnung' });

    expect(prepared.next.name).toBe('Neue Bezeichnung');
    expect(prepared.userAgent).toBe('Studio-Crawler/2.0');
    expect(prepared.urlChanged).toBe(false);
  });

  it('clears explicit blank user agents without treating missing fields as removal', () => {
    expect(prepareSourceUpdate(current, { userAgent: '   ' }).userAgent).toBeNull();
    expect(prepareSourceUpdate(current, { userAgent: null }).userAgent).toBeNull();
    expect(prepareSourceUpdate(current, {}).userAgent).toBe('Studio-Crawler/2.0');
  });

  it('detects real URL changes but ignores equivalent URL spelling', () => {
    expect(prepareSourceUpdate(current, { url: 'https://example.org/feed.xml' }).urlChanged).toBe(false);
    expect(prepareSourceUpdate(current, { url: 'https://example.net/feed.xml' }).urlChanged).toBe(true);
  });
});
