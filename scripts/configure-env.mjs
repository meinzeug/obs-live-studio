import { randomBytes } from 'node:crypto';
import { chmod, copyFile, readFile, writeFile } from 'node:fs/promises';
import { resolve } from 'node:path';

const root = resolve(new URL('..', import.meta.url).pathname);
const envFile = resolve(root, '.env');
const exampleFile = resolve(root, '.env.example');

try {
  await readFile(envFile, 'utf8');
} catch {
  await copyFile(exampleFile, envFile);
}

const lines = (await readFile(envFile, 'utf8')).split(/\r?\n/);
const values = new Map();
for (const line of lines) {
  const match = line.match(/^([A-Z][A-Z0-9_]*)=(.*)$/);
  if (match) values.set(match[1], match[2]);
}

const generated = {
  DATABASE_URL: () => `postgresql://newsuser:${randomBytes(24).toString('base64url')}@localhost:5432/newsstudio`,
  SESSION_SECRET: () => randomBytes(32).toString('hex'),
  ENCRYPTION_KEY: () => randomBytes(32).toString('hex'),
  OBS_PASSWORD: () => randomBytes(24).toString('base64url'),
  DESKTOP_AGENT_TOKEN: () => randomBytes(32).toString('hex'),
};
for (const [key, makeValue] of Object.entries(generated)) {
  if (!values.get(key)) values.set(key, makeValue());
}

const engine = String(values.get('TTS_ENGINE') ?? '').toLowerCase();
const legacyEspeakDefaults =
  ['espeak', 'espeak-ng'].includes(engine) &&
  !values.get('PIPER_MODEL_PATH') &&
  !values.get('TTS_MODEL_PATH') &&
  (!values.get('TTS_DEFAULT_VOICE') || values.get('TTS_DEFAULT_VOICE') === 'de') &&
  (!values.get('TTS_SPEED') || values.get('TTS_SPEED') === '165') &&
  (!values.get('TTS_VOLUME') || values.get('TTS_VOLUME') === '100');

if (!engine || legacyEspeakDefaults) values.set('TTS_ENGINE', 'pocket-tts');
if (values.get('TTS_ENGINE') === 'pocket-tts') {
  if (!values.get('TTS_PRESET_ID')) values.set('TTS_PRESET_ID', 'pocket-tts-german-24l-anna');
  if (!values.get('TTS_DEFAULT_VOICE') || legacyEspeakDefaults) values.set('TTS_DEFAULT_VOICE', 'anna');
  if (!values.get('POCKET_TTS_VOICE')) values.set('POCKET_TTS_VOICE', values.get('TTS_DEFAULT_VOICE') ?? 'anna');
  if (!values.get('POCKET_TTS_LANGUAGE')) values.set('POCKET_TTS_LANGUAGE', 'german_24l');
  if (!values.get('POCKET_TTS_SERVER_URL')) values.set('POCKET_TTS_SERVER_URL', 'http://127.0.0.1:8000');
  if (!values.get('POCKET_TTS_TEMPERATURE')) values.set('POCKET_TTS_TEMPERATURE', '0.7');
  if (!values.get('POCKET_TTS_DECODE_STEPS')) values.set('POCKET_TTS_DECODE_STEPS', '4');
  if (!values.get('POCKET_TTS_EXECUTABLE')) values.set('POCKET_TTS_EXECUTABLE', './var/pocket-tts-venv/bin/pocket-tts');
  if (!values.get('AI_CHAT_MODERATOR_TTS_VOICE')) values.set('AI_CHAT_MODERATOR_TTS_VOICE', 'anna');
  if (!values.get('TTS_OUTPUT_GAIN_DB')) values.set('TTS_OUTPUT_GAIN_DB', '7');
  if (!values.get('TTS_TIMEOUT_MS')) values.set('TTS_TIMEOUT_MS', '120000');
}
if (values.get('TTS_ENGINE') === 'piper') {
  if (!values.get('TTS_PRESET_ID')) values.set('TTS_PRESET_ID', 'piper-de-dii-high');
  if (!values.get('TTS_MODEL_PATH')) values.set('TTS_MODEL_PATH', './var/models/piper/de_DE-dii-high.onnx');
  if (!values.get('PIPER_MODEL_PATH')) values.set('PIPER_MODEL_PATH', './var/models/piper/de_DE-dii-high.onnx');
  if (!values.get('PIPER_EXECUTABLE')) values.set('PIPER_EXECUTABLE', './var/piper-venv/bin/piper');
  if (!values.get('TTS_DEFAULT_VOICE') || legacyEspeakDefaults) values.set('TTS_DEFAULT_VOICE', 'de_DE-dii-high');
  if (!values.get('TTS_SPEED') || legacyEspeakDefaults) values.set('TTS_SPEED', '1');
  if (!values.get('TTS_VOLUME') || legacyEspeakDefaults) values.set('TTS_VOLUME', '1');
  if (!values.get('TTS_TIMEOUT_MS')) values.set('TTS_TIMEOUT_MS', '120000');
}
if (!values.get('AI_HOST_AVATAR_VIDEO_PATHS')) {
  values.set(
    'AI_HOST_AVATAR_VIDEO_PATHS',
    './var/media/ai-host/ava-moderator-1.webm,./var/media/ai-host/ava-moderator-2.webm,./var/media/ai-host/ava-moderator-3.webm',
  );
}
if (!values.get('AI_HOST_AVATAR_VIDEO_PATH')) {
  values.set('AI_HOST_AVATAR_VIDEO_PATH', './var/media/ai-host/ava-moderator-1.webm');
}
if (!values.get('YOUTUBE_CONTEXT_AVATAR_IDLE_PATH')) {
  values.set('YOUTUBE_CONTEXT_AVATAR_IDLE_PATH', './var/media/ai-host/youtube-context-idle.webm');
}
if (!values.get('YOUTUBE_CONTEXT_AVATAR_SPEAKING_PATH')) {
  values.set('YOUTUBE_CONTEXT_AVATAR_SPEAKING_PATH', './var/media/ai-host/youtube-context-speaking.webm');
}
if (!values.get('YOUTUBE_CONTEXT_CHAT_MODERATOR_PATH')) {
  values.set('YOUTUBE_CONTEXT_CHAT_MODERATOR_PATH', './var/media/ai-host/youtube-context-chat-moderator.webm');
}
if (!values.get('STUDIO_BRAND_VIDEO_PATH')) {
  values.set('STUDIO_BRAND_VIDEO_PATH', './var/media/studio/zeitkante-intro-outro.mp4');
}
if (!values.get('PROGRAM_INTRO_ENABLED')) values.set('PROGRAM_INTRO_ENABLED', 'true');
if (!values.get('PROGRAM_INTRO_DURATION_MS')) values.set('PROGRAM_INTRO_DURATION_MS', '8000');
if (!values.get('AI_HOST_DUCK_YOUTUBE_VOLUME')) values.set('AI_HOST_DUCK_YOUTUBE_VOLUME', '0.22');
if (!values.get('YTDLP_EXECUTABLE')) values.set('YTDLP_EXECUTABLE', './var/youtube-tools-venv/bin/yt-dlp');
if (!values.get('YTDLP_POT_PROVIDER_HOME'))
  values.set('YTDLP_POT_PROVIDER_HOME', './var/bgutil-ytdlp-pot-provider/server');

const seen = new Set();
const output = lines.map((line) => {
  const match = line.match(/^([A-Z][A-Z0-9_]*)=/);
  if (!match || !values.has(match[1])) return line;
  seen.add(match[1]);
  return `${match[1]}=${values.get(match[1])}`;
});
for (const [key, value] of values) {
  if (!seen.has(key)) output.push(`${key}=${value}`);
}
await writeFile(envFile, `${output.filter((line, index, all) => line || index < all.length - 1).join('\n')}\n`, {
  mode: 0o600,
});
await chmod(envFile, 0o600);
console.log(
  legacyEspeakDefaults
    ? 'Lokale Konfiguration wurde auf Piper mit Dii High migriert.'
    : 'Lokale Konfiguration und Geheimnisse sind eingerichtet.',
);
