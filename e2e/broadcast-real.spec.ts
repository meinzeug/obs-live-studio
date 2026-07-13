import { expect, test } from '@playwright/test';
import { randomUUID, createHash } from 'node:crypto';
import { pool, query } from '@ans/database';

const adminEmail = 'e2e-admin@example.test';
const adminPassword = 'e2e-admin-password';

async function resetObs() {
  await fetch('http://127.0.0.1:4456/reset', { method: 'POST' });
}
async function obsRequests() {
  return (await (await fetch('http://127.0.0.1:4456/requests')).json()).requests as Array<{
    requestType: string;
    requestData?: any;
  }>;
}
function obsActions(requests: Array<{ requestType: string; requestData?: any }>) {
  return requests
    .filter((r) => r.requestType === 'TriggerMediaInputAction')
    .map((r) => String(r.requestData?.mediaAction));
}
async function cleanup() {
  await query("delete from live_events where payload->>'testRun'='e2e' or dedupe_key like 'e2e:%'");
  await query("delete from broadcast_recovery_operations where requested_by='e2e'");
  await query("delete from broadcast_commands where idempotency_key like 'e2e:%'");
  await query("delete from broadcast_runner_leases where runner_id like 'runner-%' or runner_id like 'e2e-%'");
  await query('delete from playback_state where id=true');
  await query("delete from broadcast_runs where last_state->>'testRun'='e2e'");
  await query("delete from broadcast_playlists where name like 'e2e-%'");
  await query("delete from overlay_projects where name like 'e2e-%'");
  await query("delete from articles where title like 'e2e-%'");
  await query('delete from users where email=$1', [adminEmail]);
}
async function seedPlaylist(items = 2) {
  const suffix = randomUUID();
  const project = (
    await query(
      `insert into overlay_projects(name,width,height,template,status,public_live_id,public_token_hash,public_url)
    values($1,1920,1080,'main-news','active',$2,$3,$4) returning id`,
      [`e2e-${suffix}`, `e2e-live-${suffix}`, `hash-${suffix}`, `/overlays/e2e-${suffix}`],
    )
  ).rows[0];
  const version = (
    await query(
      `insert into overlay_versions(project_id,status,published,snapshot) values($1,'published',true,'{}') returning id`,
      [project.id],
    )
  ).rows[0];
  await query(`update overlay_projects set obs_configured_version_id=$2 where id=$1`, [project.id, version.id]);
  const playlist = (
    await query(`insert into broadcast_playlists(name,status,current_position) values($1,'draft',0) returning id`, [
      `e2e-${suffix}`,
    ])
  ).rows[0];
  for (let i = 0; i < items; i += 1) {
    const title = `e2e-${suffix}-${i}`;
    const article = (
      await query(
        `insert into articles(title,url,canonical_url,content_hash,status,main_text) values($1,$2,$2,$3,'approved','Text') returning id`,
        [title, `https://example.test/${suffix}/${i}`, createHash('sha1').update(`${suffix}-${i}`).digest('hex')],
      )
    ).rows[0];
    const script = (
      await query(`insert into scripts(article_id,text) values($1,'E2E script') returning id`, [article.id])
    ).rows[0];
    const media = (
      await query(
        `insert into media_assets(filename,mime_type,duration_seconds,usage) values($1,'audio/wav',2,'article-voice') returning id`,
        [`/tmp/${title}.wav`],
      )
    ).rows[0];
    await query(`insert into audio_assets(script_id,media_id,duration_seconds) values($1,$2,2)`, [script.id, media.id]);
    await query(`insert into broadcast_items(playlist_id,article_id,position,status) values($1,$2,$3,'planned')`, [
      playlist.id,
      article.id,
      i,
    ]);
  }
  return playlist.id as string;
}
async function loginOrSetup(page: any) {
  await page.goto('/broadcast');
  if (
    await page
      .getByRole('heading', { name: 'Ersten Administrator einrichten' })
      .isVisible()
      .catch(() => false)
  ) {
    await page.getByPlaceholder('E-Mail').fill(adminEmail);
    await page.getByPlaceholder('Anzeigename').fill('E2E Admin');
    await page.getByPlaceholder('Passwort').fill(adminPassword);
    await page.getByRole('button', { name: 'Administrator anlegen' }).click();
  } else if (
    await page
      .getByRole('heading', { name: 'Anmelden' })
      .isVisible()
      .catch(() => false)
  ) {
    await page.getByPlaceholder('E-Mail').fill(adminEmail);
    await page.getByPlaceholder('Passwort').fill(adminPassword);
    await page.getByRole('button', { name: 'Einloggen' }).click();
  }
  await expect(page.getByRole('heading', { name: 'Broadcast' })).toBeVisible();
}

test.beforeEach(async () => {
  await cleanup();
  await resetObs();
});
test.afterAll(async () => {
  await cleanup();
  await pool.end();
});

test('Administrator einrichten, anmelden und Broadcast über die Oberfläche starten', async ({ page }) => {
  const playlistId = await seedPlaylist();
  await loginOrSetup(page);
  await page.getByText(`e2e-`).locator('..').getByRole('button', { name: 'Start' }).first().click();
  await expect(page.getByRole('status')).toContainText(/Status: (preparing|playing|running|starting)/, {
    timeout: 30000,
  });
  await expect
    .poll(
      async () => (await query(`select status from broadcast_runs where playlist_id=$1`, [playlistId])).rows[0]?.status,
    )
    .toMatch(/starting|running|ended/);
});

test('Pause, Resume und Skip erzeugen jeweils exakt eine OBS-Aktion', async ({ page }) => {
  await seedPlaylist(3);
  await loginOrSetup(page);
  await page.getByRole('button', { name: 'Start' }).first().click();
  await expect(page.getByRole('button', { name: 'Pause' })).toBeEnabled({ timeout: 30000 });
  await resetObs();
  await page.getByRole('button', { name: 'Pause' }).click();
  await expect.poll(async () => obsActions(await obsRequests()).filter((a) => a.endsWith('_PAUSE')).length).toBe(1);
  await page.getByRole('button', { name: 'Fortsetzen' }).click();
  await expect.poll(async () => obsActions(await obsRequests()).filter((a) => a.endsWith('_PLAY')).length).toBe(1);
  await page.getByRole('button', { name: 'Überspringen' }).click();
  await expect.poll(async () => obsActions(await obsRequests()).filter((a) => a.endsWith('_STOP')).length).toBe(1);
});

test('Broadcast stoppen setzt Run, Playlist und Playback auf interrupted', async ({ page }) => {
  const playlistId = await seedPlaylist(2);
  await loginOrSetup(page);
  await page.getByRole('button', { name: 'Start' }).first().click();
  await expect(page.getByRole('button', { name: 'Stop' })).toBeEnabled({ timeout: 30000 });
  await page.getByRole('button', { name: 'Stop' }).click();
  await expect
    .poll(
      async () => (await query(`select status from broadcast_runs where playlist_id=$1`, [playlistId])).rows[0]?.status,
      { timeout: 30000 },
    )
    .toBe('interrupted');
  await expect
    .poll(async () => (await query(`select status from broadcast_playlists where id=$1`, [playlistId])).rows[0]?.status)
    .toBe('interrupted');
  await expect
    .poll(async () => (await query(`select state->>'status' status from playback_state where id=true`)).rows[0]?.status)
    .toBe('interrupted');
});
