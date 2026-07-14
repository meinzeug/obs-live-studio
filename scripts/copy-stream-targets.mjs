import { access, copyFile, mkdir } from 'node:fs/promises';
import { constants } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const source = resolve(root, 'apps', 'web', 'public', 'stream-targets.json');
const destination = resolve(root, 'apps', 'web', 'dist', 'stream-targets.json');

try {
  await access(source, constants.R_OK);
  await access(dirname(destination), constants.W_OK);
  await mkdir(dirname(destination), { recursive: true });
  await copyFile(source, destination);
  console.log('Streamingziel-Metadaten wurden in den Web-Build kopiert.');
} catch (error) {
  if (process.env.NODE_ENV === 'production') {
    throw new Error(`Streamingziel-Metadaten konnten nicht kopiert werden: ${error instanceof Error ? error.message : String(error)}`);
  }
}
