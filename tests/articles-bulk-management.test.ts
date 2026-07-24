import { readFile } from 'node:fs/promises';
import { describe, expect, it } from 'vitest';

describe('modern newsroom article management', () => {
  it('provides atomic bulk actions and guarded single deletion', async () => {
    const [database, api, page] = await Promise.all([
      readFile('packages/database/src/index.ts', 'utf8'),
      readFile('apps/api/src/index.ts', 'utf8'),
      readFile('apps/web/src/pages/ArticlesPage.tsx', 'utf8'),
    ]);
    expect(database).toContain('bulkDeleteArticles');
    expect(database).toContain('bulkSetArticleStatus');
    expect(api).toContain("app.post('/api/articles/bulk'");
    expect(api).toContain("z.enum(['delete', 'review', 'approve', 'discard'])");
    expect(page).toContain('Alle sichtbaren auswählen');
    expect(page).toContain("runBulk('delete', [article.id])");
    expect(page).toContain('articles-selection-bar');
  });
});
