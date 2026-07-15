import { expect, test } from '@playwright/test';
import { pool, query } from '@ans/database';
import { createUser } from '@ans/database/auth';
import { hashPassword } from '@ans/security/auth';
import { cleanupBroadcastFixtures, createBroadcastFixture } from '../tests/helpers/broadcast-fixtures.js';

const adminEmail = 'e2e-admin@example.test';
const adminPassword = 'e2e-admin-password';

async function resetObs() {
  await fetch(`http://127.0.0.1:${process.env.OBS_MOCK_STATUS_PORT ?? '4456'}/reset`, { method: 'POST' });
}
async function resetObsRequests() {
  await fetch(`http://127.0.0.1:${process.env.OBS_MOCK_STATUS_PORT ?? '4456'}/requests/reset`, { method: 'POST' });
}
async function configureObsMock(config: Record<string, unknown>) {
  await fetch(`http://127.0.0.1:${process.env.OBS_MOCK_STATUS_PORT ?? '4456'}/config`, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify(config),
  });
}
async function endObsMedia() {
  await fetch(`http://127.0.0.1:${process.env.OBS_MOCK_STATUS_PORT ?? '4456'}/end`, { method: 'POST' });
}
async function latestCommandStatus(command: string, playlistId: string) {
  return (
    await query(
      `select status from broadcast_commands where command=$1 and playlist_id=$2 order by created_at desc limit 1`,
      [command, playlistId],
    )
  ).rows[0]?.status;
}
async function playbackStatus() {
  return (await query(`select state->>'status' status from playback_state where id=true`)).rows[0]?.status;
}
async function obsRequests() {
  return (await (await fetch(`http://127.0.0.1:${process.env.OBS_MOCK_STATUS_PORT ?? '4456'}/requests`)).json())
    .requests as Array<{
    requestType: string;
    requestData?: any;
  }>;
}
function obsActions(requests: Array<{ requestType: string; requestData?: any }>) {
  return requests
    .filter((request) => request.requestType === 'TriggerMediaInputAction')
    .map((request) => String(request.requestData?.mediaAction));
}
async function cleanup() {
  await cleanupBroadcastFixtures('e2e', adminEmail);
}
async function ensureE2eAdmin() {
  await createUser({
    email: adminEmail,
    displayName: 'E2E Admin',
    passwordHash: await hashPassword(adminPassword),
    role: 'administrator',
  });
}
async function seedPlaylist(items = 2) {
  return (await createBroadcastFixture({ scope: 'e2e', items, durationSeconds: 2 })).playlistId;
}
async function login(page: any) {
  await page.goto('/#/broadcast');
  await expect(page.getByRole('heading', { name: 'Willkommen zurück' })).toBeVisible();
  await page.getByPlaceholder('name@beispiel.de').fill(adminEmail);
  await page.getByPlaceholder('Passwort').fill(adminPassword);
  await page.getByRole('button', { name: 'Einloggen' }).click();
  await expect(page.getByRole('heading', { name: 'Broadcast' })).toBeVisible();
}

test.beforeEach(async () => {
  await cleanup();
  await ensureE2eAdmin();
  await resetObs();
});
test.afterAll(async () => {
  await cleanup();
  await pool.end();
});

test('Administrator anmelden und Broadcast über die Oberfläche starten', async ({ page }) => {
  const playlistId = await seedPlaylist();
  await configureObsMock({ holdPlaying: true, mediaDuration: 60_000, cursorStep: 100 });
  await login(page);
  await page.getByRole('button', { name: 'Starten' }).first().click();
  await expect(page.getByRole('status')).toContainText('Sendeliste gestartet', { timeout: 30000 });
  await expect
    .poll(
      async () =>
        (
          await query(
            `select bro.status from broadcast_recovery_operations bro join broadcast_runs br on br.id=bro.broadcast_run_id where br.playlist_id=$1 and bro.operation_type='start' order by bro.created_at desc limit 1`,
            [playlistId],
          )
        ).rows[0]?.status,
      { timeout: 30000 },
    )
    .toBe('completed');
  await expect
    .poll(
      async () => (await query(`select status from broadcast_runs where playlist_id=$1`, [playlistId])).rows[0]?.status,
      { timeout: 30000 },
    )
    .toBe('running');
  await expect
    .poll(
      async () =>
        (await (await fetch(`http://127.0.0.1:${process.env.BROADCAST_RUNNER_STATUS_PORT ?? '12100'}/ready`)).json())
          .ready,
      { timeout: 30000 },
    )
    .toBe(true);
  await endObsMedia();
});

test('Pause, Resume und Skip erzeugen jeweils exakt eine OBS-Aktion', async ({ page }) => {
  const playlistId = await seedPlaylist(3);
  await configureObsMock({ holdPlaying: true, mediaDuration: 60_000, cursorStep: 100 });
  await login(page);
  await page.getByRole('button', { name: 'Starten' }).first().click();
  await expect(page.getByRole('button', { name: 'Pause' })).toBeEnabled({ timeout: 30000 });
  await expect.poll(playbackStatus, { timeout: 30000 }).toBe('playing');
  await resetObsRequests();

  await page.getByRole('button', { name: 'Pause' }).click();
  await expect.poll(async () => latestCommandStatus('pause', playlistId), { timeout: 30000 }).toBe('completed');
  await expect.poll(playbackStatus, { timeout: 30000 }).toBe('paused');
  await expect
    .poll(async () => obsActions(await obsRequests()).filter((action) => action.endsWith('_PAUSE')).length)
    .toBe(1);

  await page.getByRole('button', { name: 'Fortsetzen' }).click();
  await expect.poll(async () => latestCommandStatus('resume', playlistId), { timeout: 30000 }).toBe('completed');
  await expect.poll(playbackStatus, { timeout: 30000 }).toBe('playing');
  await expect
    .poll(async () => obsActions(await obsRequests()).filter((action) => action.endsWith('_PLAY')).length)
    .toBe(1);

  const positionBeforeSkip = Number(
    (await query(`select current_position from broadcast_playlists where id=$1`, [playlistId])).rows[0]
      ?.current_position,
  );
  await page.getByRole('button', { name: 'Überspringen' }).click();
  await expect.poll(async () => latestCommandStatus('skip', playlistId), { timeout: 30000 }).toBe('completed');
  await expect
    .poll(
      async () =>
        Number(
          (await query(`select current_position from broadcast_playlists where id=$1`, [playlistId])).rows[0]
            ?.current_position,
        ),
      { timeout: 30000 },
    )
    .toBeGreaterThan(positionBeforeSkip);
  await expect
    .poll(async () => obsActions(await obsRequests()).filter((action) => action.endsWith('_STOP')).length)
    .toBe(1);
  await endObsMedia();
});

test('Broadcast stoppen setzt Run, Playlist und Playback auf interrupted', async ({ page }) => {
  const playlistId = await seedPlaylist(2);
  await configureObsMock({ holdPlaying: true, mediaDuration: 60_000, cursorStep: 100 });
  await login(page);
  await page.getByRole('button', { name: 'Starten' }).first().click();
  await expect(page.getByRole('button', { name: 'Stoppen' })).toBeEnabled({ timeout: 30000 });
  await expect.poll(playbackStatus, { timeout: 30000 }).toBe('playing');
  await resetObsRequests();
  await page.getByRole('button', { name: 'Stoppen' }).click();
  await expect.poll(async () => latestCommandStatus('stop', playlistId), { timeout: 30000 }).toBe('completed');
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
  await expect
    .poll(async () => obsActions(await obsRequests()).filter((action) => action.endsWith('_STOP')).length)
    .toBe(1);
  await endObsMedia();
});
