import { describe, expect, it } from 'vitest';
import {
  prepareSourceUpdate,
  SourceUpdateInputError,
} from '../packages/database/src/source-update.js';

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
    expect(prepareSourceUpdate(current, { priority: 10 }).userAgent).toBe('Studio-Crawler/2.0');
  });

  it('detects real URL changes but ignores equivalent URL spelling', () => {
    expect(prepareSourceUpdate(current, { url: 'https://example.org/feed.xml' }).urlChanged).toBe(false);
    expect(prepareSourceUpdate(current, { url: 'https://example.net/feed.xml' }).urlChanged).toBe(true);
  });

  it('rejects empty and unsupported updates instead of incrementing the source version', () => {
    expect(() => prepareSourceUpdate(current, {})).toThrow('Keine Änderungen angegeben');
    expect(() => prepareSourceUpdate(current, { fetchIntervallSeconds: 60 })).toThrow(
      'Unbekannte Felder: fetchIntervallSeconds',
    );
  });

  it('exposes invalid update input as a client error', () => {
    try {
      prepareSourceUpdate(current, { url: 'not-a-url' });
      throw new Error('Expected prepareSourceUpdate to fail');
    } catch (error) {
      expect(error).toBeInstanceOf(SourceUpdateInputError);
      expect((error as SourceUpdateInputError).statusCode).toBe(400);
      expect((error as Error).message).toBe('Die Quellen-URL ist ungültig');
    }
  });

  it('rejects header control characters and clears unsafe legacy values on unrelated updates', () => {
    expect(() => prepareSourceUpdate(current, { userAgent: 'Crawler/1.0\r\nX-Test: injected' })).toThrow(
      'Der User-Agent enthält ungültige Steuerzeichen',
    );
    expect(
      prepareSourceUpdate({ ...current, user_agent: 'Crawler/1.0\nX-Test: injected' }, { priority: 5 }).userAgent,
    ).toBeNull();
  });
});
