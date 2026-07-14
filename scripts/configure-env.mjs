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

if (!engine || legacyEspeakDefaults) values.set('TTS_ENGINE', 'piper');
if (values.get('TTS_ENGINE') === 'piper') {
  if (!values.get('TTS_MODEL_PATH'))
    values.set('TTS_MODEL_PATH', './var/models/piper/de_DE-thorsten-high.onnx');
  if (!values.get('PIPER_MODEL_PATH'))
    values.set('PIPER_MODEL_PATH', './var/models/piper/de_DE-thorsten-high.onnx');
  if (!values.get('PIPER_EXECUTABLE')) values.set('PIPER_EXECUTABLE', './var/piper-venv/bin/piper');
  if (!values.get('TTS_DEFAULT_VOICE') || legacyEspeakDefaults)
    values.set('TTS_DEFAULT_VOICE', 'de_DE-thorsten-high');
  if (!values.get('TTS_SPEED') || legacyEspeakDefaults) values.set('TTS_SPEED', '1');
  if (!values.get('TTS_VOLUME') || legacyEspeakDefaults) values.set('TTS_VOLUME', '1');
  if (!values.get('TTS_TIMEOUT_MS')) values.set('TTS_TIMEOUT_MS', '120000');
}

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
    ? 'Lokale Konfiguration wurde auf Piper mit Thorsten High migriert.'
    : 'Lokale Konfiguration und Geheimnisse sind eingerichtet.',
);
