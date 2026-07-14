import { readFile } from 'node:fs/promises';
import { resolve } from 'node:path';
import OBSWebSocket from 'obs-websocket-js';
import { resolveStudioProfile } from '../packages/streaming-platforms/index.mjs';
import { runCompleteStudioPreflight } from './complete-studio-preflight.mjs';

const root = resolve(new URL('..', import.meta.url).pathname);
const studio = resolveStudioProfile(process.env);
const preflight = await runCompleteStudioPreflight({ root, scope: 'all' });
if (!preflight.ok) {
  const failures = preflight.checks.filter((check) => check.status === 'error').map((check) => check.message);
  throw new Error(`Lokale Sendungsabnahme wegen Vorabprüfung abgebrochen: ${failures.join(' ')}`);
}

const credentials = JSON.parse(await readFile(resolve(root, 'var', 'admin-credentials.json'), 'utf8'));
const baseUrl = process.env.APP_URL ?? 'http://127.0.0.1:12000';
let cookie = '';
let csrfToken = '';

async function request(path, init = {}) {
  const headers = new Headers(init.headers);
  if (init.body && !headers.has('content-type')) headers.set('content-type', 'application/json');
  if (cookie) headers.set('cookie', cookie);
  if (csrfToken && !['GET', 'HEAD'].includes(init.method ?? 'GET')) headers.set('x-csrf-token', csrfToken);
  const response = await fetch(`${baseUrl}${path}`, { ...init, headers });
  const setCookies = response.headers.getSetCookie?.() ?? [];
  if (setCookies.length) cookie = setCookies.map((item) => item.split(';', 1)[0]).join('; ');
  const text = await response.text();
  const body = text ? JSON.parse(text) : null;
  if (!response.ok) throw new Error(`${init.method ?? 'GET'} ${path}: ${body?.message ?? body?.error ?? text}`);
  return body;
}

const login = await request('/api/auth/login', {
  method: 'POST',
  body: JSON.stringify({ email: credentials.email, password: credentials.password }),
});
csrfToken = login.csrfToken;

const articles = await request('/api/articles?limit=20');
const expectedTitle = `${studio.channelName} ist auf Sendung`;
const article = articles.find((item) => item.title === expectedTitle) ?? articles[0];
if (!article) throw new Error('Kein Artikel für die lokale Sendungsabnahme vorhanden');
await request(`/api/articles/${article.id}/process`, { method: 'POST' });
await request(`/api/articles/${article.id}/status`, {
  method: 'POST',
  body: JSON.stringify({ status: 'approved' }),
});
const tts = await request(`/api/articles/${article.id}/tts`, { method: 'POST' });
if (!tts.file || !(tts.durationSeconds > 0)) throw new Error('TTS hat keine abspielbare Audiodatei erzeugt');

await request('/api/obs/connect', { method: 'POST' });
await request('/api/obs/setup', { method: 'POST' });
const preflightObs = new OBSWebSocket();
await preflightObs.connect(
  `ws://${process.env.OBS_HOST ?? '127.0.0.1'}:${process.env.OBS_PORT ?? 4455}`,
  process.env.OBS_PASSWORD,
);
const preflightStream = await preflightObs.call('GetStreamStatus');
await preflightObs.disconnect();
let contribution = { playback: { status: 'skipped-live' } };
if (!preflightStream.outputActive) {
  contribution = await request('/api/obs/test-contribution', {
    method: 'POST',
    body: JSON.stringify({ articleId: article.id }),
  });
  if (contribution.playback?.status !== 'ended') throw new Error('OBS-Testbeitrag wurde nicht vollständig beendet');
}

const playlist = await request('/api/broadcast/playlists', {
  method: 'POST',
  body: JSON.stringify({ name: `${studio.channelName} lokale Abnahme ${new Date().toISOString()}` }),
});
const item = await request(`/api/broadcast/playlists/${playlist.id}/items`, {
  method: 'POST',
  body: JSON.stringify({ articleId: article.id }),
});
if (!item?.id) throw new Error('Beitrag konnte nicht zur Sendeliste hinzugefügt werden');
const started = await request(`/api/broadcast/playlists/${playlist.id}/start`, { method: 'POST' });

let observedRun = false;
let finalStatus;
const deadline = Date.now() + 120_000;
while (Date.now() < deadline) {
  const status = await request('/api/broadcast/status');
  if (status.run?.id === started.runId) observedRun = true;
  if (observedRun && !status.run) {
    finalStatus = status;
    break;
  }
  await new Promise((resolveDelay) => setTimeout(resolveDelay, 500));
}
if (!finalStatus) throw new Error('Der externe Broadcast-Runner hat den Sendelauf nicht rechtzeitig beendet');
const finishedPlaylist = await request(`/api/broadcast/playlists/${playlist.id}`);
if (finishedPlaylist.items?.[0]?.status !== 'played') {
  throw new Error(`Sendebeitrag endete mit Status ${finishedPlaylist.items?.[0]?.status ?? 'unbekannt'}`);
}

const obs = new OBSWebSocket();
await obs.connect(
  `ws://${process.env.OBS_HOST ?? '127.0.0.1'}:${process.env.OBS_PORT ?? 4455}`,
  process.env.OBS_PASSWORD,
);
const [sceneList, inputList, streamStatus] = await Promise.all([
  obs.call('GetSceneList'),
  obs.call('GetInputList'),
  obs.call('GetStreamStatus'),
]);
await obs.disconnect();

for (const expected of ['03_MAIN_NEWS', '10_MAINTENANCE']) {
  if (!sceneList.scenes.some((scene) => scene.sceneName === expected)) throw new Error(`OBS-Szene fehlt: ${expected}`);
}
for (const expected of ['ANS_MAIN_OVERLAY', 'ANS_MAINTENANCE_OVERLAY', 'ANS_SPRECHER_AUDIO']) {
  if (!inputList.inputs.some((input) => input.inputName === expected)) throw new Error(`OBS-Quelle fehlt: ${expected}`);
}
if (streamStatus.outputActive && process.env.STREAM_AUTO_START !== 'true')
  throw new Error('Der lokale Abnahmetest darf ohne STREAM_AUTO_START keinen externen Stream starten');

console.log(
  JSON.stringify({
    ok: true,
    studio: studio.studioName,
    channel: studio.channelName,
    primaryTarget: studio.primary.name,
    preflight: preflight.summary,
    articleId: article.id,
    audioFile: tts.file,
    audioDurationSeconds: tts.durationSeconds,
    testContribution: contribution.playback.status,
    broadcastRunId: started.runId,
    broadcastItemStatus: finishedPlaylist.items[0].status,
    finalPlaybackStatus: finalStatus.playback?.status,
    currentScene: sceneList.currentProgramSceneName,
    streamActive: streamStatus.outputActive,
  }),
);
