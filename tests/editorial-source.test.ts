import { describe, expect, it } from 'vitest';
import { safeEditorialSourceUrl } from '../apps/web/src/editorial-source.js';

describe('editorial source links', () => {
  it('prefers a valid canonical HTTP source', () => {
    expect(safeEditorialSourceUrl('https://example.org/article?id=1', 'https://fallback.example/article')).toBe(
      'https://example.org/article?id=1',
    );
  });

  it('falls back to the original article URL when the canonical URL is invalid', () => {
    expect(safeEditorialSourceUrl('not a URL', 'http://example.org/article')).toBe('http://example.org/article');
  });

  it('rejects script, file, and malformed URLs', () => {
    expect(safeEditorialSourceUrl('javascript:alert(1)', 'file:///etc/passwd')).toBeNull();
    expect(safeEditorialSourceUrl('data:text/html,unsafe', 'broken')).toBeNull();
  });
});
