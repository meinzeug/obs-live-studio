import { spawnSync } from 'node:child_process';
import { createWriteStream } from 'node:fs';
import { access, mkdir, readFile, rename, rm, stat } from 'node:fs/promises';
import { constants } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { Readable } from 'node:stream';
import { pipeline } from 'node:stream/promises';

const root = resolve(new URL('..', import.meta.url).pathname);
const piperVersion = process.env.PIPER_PACKAGE_VERSION ?? '1.4.2';
const venvDirectory = resolve(root, process.env.PIPER_VENV_DIR ?? './var/piper-venv');
const executable = resolve(root, process.env.PIPER_EXECUTABLE ?? './var/piper-venv/bin/piper');
const modelPath = resolve(
  root,
  process.env.PIPER_MODEL_PATH ?? process.env.TTS_MODEL_PATH ?? './var/models/piper/de_DE-dii-high.onnx',
);
const configPath = `${modelPath}.json`;
const force = process.env.PIPER_FORCE_INSTALL === 'true' || process.argv.includes('--force');
const minimumModelBytes = Math.max(44, Number(process.env.PIPER_MIN_MODEL_BYTES ?? 50 * 1024 * 1024));
const modelBaseUrl =
  process.env.PIPER_MODEL_BASE_URL ??
  process.env.PIPER_THORSTEN_HIGH_BASE_URL ??
  'https://huggingface.co/csukuangfj/vits-piper-de_DE-dii-high/resolve/main';
const modelUrl = process.env.PIPER_MODEL_URL ?? `${modelBaseUrl}/de_DE-dii-high.onnx`;
const configUrl = process.env.PIPER_CONFIG_URL ?? `${modelUrl}.json`;
const voiceName = process.env.TTS_DEFAULT_VOICE ?? 'de_DE-dii-high';

function run(command, args) {
  const result = spawnSync(command, args, { cwd: root, stdio: 'inherit', env: process.env });
  if (result.error) throw new Error(`${command} konnte nicht gestartet werden: ${result.error.message}`);
  if (result.status !== 0) throw new Error(`${command} wurde mit Code ${result.status ?? 'unbekannt'} beendet`);
}

async function readableFile(path, minimumBytes = 1) {
  try {
    await access(path, constants.R_OK);
    return (await stat(path)).size >= minimumBytes;
  } catch {
    return false;
  }
}

async function executableFile(path) {
  try {
    await access(path, constants.X_OK);
    const metadata = await stat(path);
    return metadata.isFile() && metadata.size > 0;
  } catch {
    return false;
  }
}

async function download(url, destination, minimumBytes) {
  const temporary = `${destination}.download-${process.pid}-${Date.now()}`;
  await mkdir(dirname(destination), { recursive: true });
  try {
    const response = await fetch(url, { redirect: 'follow' });
    if (!response.ok || !response.body) throw new Error(`Download fehlgeschlagen: HTTP ${response.status} ${url}`);
    await pipeline(Readable.fromWeb(response.body), createWriteStream(temporary, { mode: 0o600 }));
    const size = (await stat(temporary)).size;
    if (size < minimumBytes) throw new Error(`Download ist unerwartet klein: ${size} Bytes (${url})`);
    await rm(destination, { force: true });
    await rename(temporary, destination);
    return size;
  } catch (error) {
    await rm(temporary, { force: true });
    throw error;
  }
}

async function ensurePiperExecutable() {
  if (!force && (await executableFile(executable))) return false;
  const python = process.env.PYTHON_EXECUTABLE ?? 'python3';
  await mkdir(dirname(venvDirectory), { recursive: true });
  if (force) await rm(venvDirectory, { recursive: true, force: true });
  if (!(await readableFile(resolve(venvDirectory, 'bin/python')))) run(python, ['-m', 'venv', venvDirectory]);
  const venvPython = resolve(venvDirectory, 'bin/python');
  run(venvPython, ['-m', 'pip', 'install', '--disable-pip-version-check', '--no-input', `piper-tts==${piperVersion}`]);
  if (!(await executableFile(executable))) {
    throw new Error(`Piper wurde installiert, aber ${executable} fehlt oder ist nicht ausführbar`);
  }
  return true;
}

async function ensureVoiceFiles() {
  const modelInstalled = force || !(await readableFile(modelPath, minimumModelBytes));
  const configInstalled = force || !(await readableFile(configPath, 100));
  const modelBytes = modelInstalled
    ? await download(modelUrl, modelPath, minimumModelBytes)
    : (await stat(modelPath)).size;
  if (configInstalled) await download(configUrl, configPath, 100);
  const config = JSON.parse(await readFile(configPath, 'utf8'));
  if (!['de', 'de_DE'].includes(config.language?.code))
    throw new Error(`Unerwartete Piper-Sprache: ${config.language?.code ?? 'unbekannt'}`);
  return { modelInstalled, configInstalled, modelBytes };
}

try {
  const executableInstalled = await ensurePiperExecutable();
  const voice = await ensureVoiceFiles();
  console.log(
    JSON.stringify({
      ok: true,
      engine: 'piper',
      voice: voiceName,
      piperVersion,
      executable,
      modelPath,
      configPath,
      executableInstalled,
      ...voice,
    }),
  );
} catch (error) {
  console.error(
    JSON.stringify({
      ok: false,
      engine: 'piper',
      voice: voiceName,
      error: error instanceof Error ? error.message : String(error),
    }),
  );
  process.exitCode = 1;
}
