import { expect, test } from '@playwright/test';

test('Browser-Live-Control-Center shell renders routed production pages', async ({ page }) => {
  await page.route('**/api/auth/session', async (route) =>
    route.fulfill({
      contentType: 'application/json',
      body: JSON.stringify({
        authenticated: true,
        setupRequired: false,
        csrfToken: 'test-csrf',
        user: {
          id: '00000000-0000-4000-8000-000000000001',
          email: 'admin@example.test',
          display_name: 'E2E Admin',
          role: 'administrator',
          permissions: ['sources:write', 'articles:write', 'broadcast:write', 'obs:write', 'users:write'],
        },
      }),
    }),
  );
  await page.route('**/api/dashboard', (route) =>
    route.fulfill({
      contentType: 'application/json',
      body: JSON.stringify({
        status: 'Bereit',
        counts: { newArticles: 1, approved: 1 },
        current: { item: 'E2E Meldung' },
        obs: { status: 'connected' },
        playback: { status: 'idle' },
        stream: { outputActive: true },
        automation: { enabled: true, minimumTrust: 80, requireStream: true, sourceIds: [], scanLimit: 100 },
      }),
    }),
  );
  await page.route('**/api/overlays', (route) =>
    route.fulfill({ contentType: 'application/json', body: JSON.stringify([]) }),
  );
  await page.route('**/api/media**', (route) =>
    route.fulfill({ contentType: 'application/json', body: JSON.stringify([]) }),
  );
  await page.goto('/dashboard');
  await expect(page.getByRole('heading', { name: 'Sendestatus' })).toBeVisible();
  await expect(page.locator('.stat').filter({ hasText: 'Neue Artikel' })).toContainText('1');
  await expect(page.getByText('LIVE', { exact: true })).toBeVisible();
  await page.getByRole('link', { name: 'Overlays' }).click();
  await expect(page).toHaveURL(/\/overlays$/);
  await expect(page.getByRole('heading', { name: 'Overlays', exact: true })).toBeVisible();
  await page.getByRole('link', { name: 'Medien' }).click();
  await expect(page.getByRole('heading', { name: 'Medien' })).toBeVisible();
});

test('Live renderer reloads immediately from server-sent playback events', async ({ page }) => {
  let articleTitle = 'Startmeldung';
  await page.route('**/api/overlay/live/token/main-news', (route) =>
    route.fulfill({
      contentType: 'application/json',
      body: JSON.stringify({
        eventVersion: Date.now(),
        serverTime: new Date().toISOString(),
        article: { title: articleTitle, summary: 'Zusammenfassung', source: 'Testquelle' },
        playback: { status: 'playing' },
        overlay: {
          schemaVersion: 1,
          template: 'main-news',
          width: 1920,
          height: 1080,
          elements: [
            {
              id: 'title',
              type: 'text',
              name: 'Titel',
              x: 10,
              y: 10,
              width: 800,
              height: 80,
              zIndex: 1,
              hidden: false,
              opacity: 1,
              binding: 'article.title',
              props: {
                color: '#fff',
                background: 'transparent',
                borderWidth: 0,
                borderColor: 'transparent',
                padding: 0,
                fontSize: 42,
                fontWeight: 700,
                align: 'left',
              },
            },
          ],
        },
      }),
    }),
  );
  await page.goto('/');
  await page.setContent(`<!doctype html><div id="root"></div><script>
    async function load(){const data=await (await fetch('/api/overlay/live/token/main-news')).json();document.getElementById('root').textContent=data.article.title+' '+data.playback.status;}
    load(); window.__reload=load;
  </script>`);
  await expect(page.locator('#root')).toContainText('Startmeldung playing');
  articleTitle = 'Eilmeldung';
  await page.evaluate(() => (window as unknown as { __reload: () => Promise<void> }).__reload());
  await expect(page.locator('#root')).toContainText('Eilmeldung playing');
});
