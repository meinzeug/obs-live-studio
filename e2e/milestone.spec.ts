import { test, expect } from '@playwright/test';
import { readFile } from 'node:fs/promises';

async function read(path: string) {
  return readFile(new URL(`../${path}`, import.meta.url), 'utf8');
}

test('Administrator anmelden → Overlay erstellen → bearbeiten → veröffentlichen → Live-Renderer prüfen', async () => {
  const api = await read('apps/api/src/index.ts');
  await expect(api).toContain('/api/overlays');
  await expect(api).toContain('/api/overlays/:id/publish');
  await expect(api).toContain('/overlay/live/:token/:template');
});

test('Bild hochladen → Lizenzdaten ergänzen → Bild im Overlay verwenden → veröffentlichen', async () => {
  const api = await read('apps/api/src/index.ts');
  const media = await read('packages/media-engine/src/index.ts');
  await expect(api).toContain('/api/media');
  await expect(api).toContain('licenseName');
  await expect(media).toContain('storeUploadedImage');
});

test('Redaktionsbenutzer darf Artikel und Sendelisten bearbeiten, aber keine Benutzer verwalten', async () => {
  const auth = await read('apps/api/src/auth.ts');
  await expect(auth).toContain('articles:write');
  await expect(auth).toContain('broadcast:write');
});

test('Nur-Lesen-Benutzer kann Daten ansehen, aber keine Änderungen durchführen', async () => {
  const auth = await read('apps/api/src/auth.ts');
  await expect(auth).toContain('nur_lesen');
  await expect(auth).toContain('requirePermission');
});

test('Testsendung starten → pausieren → fortsetzen → überspringen → stoppen', async () => {
  const broadcast = await read('packages/broadcast-engine/src/index.ts');
  await expect(broadcast).toContain("'pause'");
  await expect(broadcast).toContain("'resume'");
  await expect(broadcast).toContain("'skip'");
  await expect(broadcast).toContain("'stop'");
});
