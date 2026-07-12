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
console.log('Lokale Konfiguration und Geheimnisse sind eingerichtet.');
