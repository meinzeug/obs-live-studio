import { randomBytes } from 'node:crypto';
import { chmod, mkdir, readFile, writeFile } from 'node:fs/promises';
import { resolve } from 'node:path';
import OBSWebSocket from 'obs-websocket-js';
import { resolveStudioProfile } from '../packages/streaming-platforms/index.mjs';

const root = resolve(new URL('..', import.meta.url).pathname);
const credentialsFile = resolve(root, 'var', 'admin-credentials.json');
const baseUrl = process.env.APP_URL ?? 'http://127.0.0.1:12000';
const studio = resolveStudioProfile(process.env);
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

async function waitForApi(attempts = 30) {
  let lastError;
  for (let attempt = 0; attempt < attempts; attempt++) {
    try {
      const response = await fetch(`${baseUrl}/health`);
      if (response.ok) return;
    } catch (error) {
      lastError = error;
    }
    await new Promise((resolveDelay) => setTimeout(resolveDelay, 500));
  }
  throw new Error(`API ist nicht erreichbar: ${lastError instanceof Error ? lastError.message : String(lastError)}`);
}

async function waitForObs(attempts = 40) {
  let lastError;
  for (let attempt = 0; attempt < attempts; attempt++) {
    const probe = new OBSWebSocket();
    try {
      await probe.connect(
        `ws://${process.env.OBS_HOST ?? '127.0.0.1'}:${process.env.OBS_PORT ?? 4455}`,
        process.env.OBS_PASSWORD,
      );
      await probe.disconnect();
      return;
    } catch (error) {
      lastError = error;
      await probe.disconnect().catch(() => undefined);
    }
    await new Promise((resolveDelay) => setTimeout(resolveDelay, 500));
  }
  throw new Error(
    `OBS WebSocket ist nicht erreichbar: ${lastError instanceof Error ? lastError.message : String(lastError)}`,
  );
}

let credentials;
try {
  credentials = JSON.parse(await readFile(credentialsFile, 'utf8'));
} catch {}

await waitForApi();
const session = await request('/api/auth/session');
if (session.setupRequired) {
  credentials = {
    url: 'http://127.0.0.1:12001',
    email: 'studio@open-tv-studio.local',
    password: randomBytes(18).toString('base64url'),
    displayName: `${studio.channelName} Studio`,
  };
  const setup = await request('/api/auth/setup', {
    method: 'POST',
    body: JSON.stringify(credentials),
  });
  csrfToken = setup.csrfToken;
  await mkdir(resolve(root, 'var'), { recursive: true });
  await writeFile(credentialsFile, `${JSON.stringify(credentials, null, 2)}\n`, { mode: 0o600 });
  await chmod(credentialsFile, 0o600);
} else {
  if (!credentials?.email || !credentials?.password)
    throw new Error(`Administrator existiert, aber ${credentialsFile} fehlt`);
  const login = await request('/api/auth/login', {
    method: 'POST',
    body: JSON.stringify({ email: credentials.email, password: credentials.password }),
  });
  csrfToken = login.csrfToken;
}

await waitForObs();
await request('/api/obs/connect', { method: 'POST' });

const overlays = await request('/api/overlays');
for (const spec of [
  { name: `${studio.channelName} Hauptsendung`, template: 'main-news' },
  { name: `${studio.channelName} Bereitschaft`, template: 'maintenance' },
]) {
  let project = overlays.find((item) => item.template === spec.template);
  let draft;
  if (!project) {
    const created = await request('/api/overlays', {
      method: 'POST',
      body: JSON.stringify({ ...spec, width: 1920, height: 1080 }),
    });
    project = created.project;
    draft = created.draft;
  } else {
    const details = await request(`/api/overlays/${project.id}`);
    draft = details.draft;
    if (process.env.STUDIO_REFRESH_OVERLAYS === 'true') {
      const reset = await request(`/api/overlays/${project.id}/reset-template`, { method: 'POST' });
      draft = reset.draft;
    } else if (!draft) {
      const snapshot = details.versions?.[0]?.snapshot;
      if (!snapshot) throw new Error(`Kein Overlay-Dokument für ${spec.template}`);
      const recreated = await request(`/api/overlays/${project.id}/draft`, {
        method: 'PUT',
        body: JSON.stringify(snapshot),
      });
      draft = recreated.draft;
    }
  }
  if (!draft?.id) throw new Error(`Kein veröffentlichbarer Entwurf für ${spec.template}`);
  await request(`/api/overlays/${project.id}/publish`, {
    method: 'POST',
    body: JSON.stringify({ versionId: draft.id, description: 'Lokaler Studio-Bootstrap' }),
  });
}

const sourceUrl = `${baseUrl}/test-feed.xml`;
const sources = await request('/api/sources');
let source = sources.find((item) => item.url === sourceUrl);
if (!source) {
  source = await request('/api/sources', {
    method: 'POST',
    body: JSON.stringify({
      name: `${studio.channelName} lokaler Sendetest`,
      url: sourceUrl,
      type: 'rss',
      category: 'Test',
      region: 'Lokal',
      language: 'de',
      priority: 10,
      trustLevel: 100,
      fetchIntervalSeconds: 60,
      maxArticles: 5,
      maxFetchSeconds: 10,
      active: true,
    }),
  });
} else if (!source.active) {
  await request(`/api/sources/${source.id}/active`, { method: 'POST', body: JSON.stringify({ active: true }) });
}

const obs = new OBSWebSocket();
await obs.connect(
  `ws://${process.env.OBS_HOST ?? '127.0.0.1'}:${process.env.OBS_PORT ?? 4455}`,
  process.env.OBS_PASSWORD,
);
await obs.call('SetCurrentProgramScene', { sceneName: '10_MAINTENANCE' });
const sceneList = await obs.call('GetSceneList');
await obs.disconnect();

console.log(
  JSON.stringify({
    ok: true,
    studio: studio.studioName,
    channel: studio.channelName,
    primaryTarget: studio.primary.name,
    adminCredentials: credentialsFile,
    sourceId: source.id,
    currentScene: sceneList.currentProgramSceneName,
    scenes: sceneList.scenes.map((scene) => scene.sceneName),
  }),
);
