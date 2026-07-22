import { spawnSync } from 'node:child_process';
import { constants } from 'node:fs';
import { access, readFile, stat } from 'node:fs/promises';
import { resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

export const DEFAULT_TTS_ENGINE = 'pocket-tts';
export const DEFAULT_POCKET_TTS_SERVER_URL = 'http://127.0.0.1:8000';
export const DEFAULT_POCKET_TTS_LANGUAGE = 'german_24l';
export const DEFAULT_POCKET_TTS_VOICE = 'anna';
export const DEFAULT_POCKET_TTS_EXECUTABLE = './var/pocket-tts-venv/bin/pocket-tts';
export const DEFAULT_PIPER_VOICE = 'de_DE-dii-high';
export const DEFAULT_PIPER_MODEL_PATH = './var/models/piper/de_DE-dii-high.onnx';
export const DEFAULT_PIPER_EXECUTABLE = './var/piper-venv/bin/piper';
export const DEFAULT_FFPROBE_EXECUTABLE = 'ffprobe';
export const DEFAULT_TTS_OUTPUT_DIRECTORY = './var/tts';
export const DEFAULT_TTS_TIMEOUT_MS = 120_000;
export const DEFAULT_QWEN3_TTS_TIMEOUT_MS = 300_000;
export const DEFAULT_MINIMUM_PIPER_MODEL_BYTES = 50 * 1024 * 1024;
export const DEFAULT_QWEN3_TTS_EXECUTABLE = './var/qwen3-tts-venv/bin/python';
export const DEFAULT_QWEN3_TTS_MODEL = 'Qwen/Qwen3-TTS-12Hz-0.6B-CustomVoice';
export const DEFAULT_QWEN3_TTS_MODEL_DIR = './var/models/qwen3-tts/Qwen3-TTS-12Hz-0.6B-CustomVoice';
export const DEFAULT_QWEN3_TTS_TOKENIZER_DIR = './var/models/qwen3-tts/Qwen3-TTS-Tokenizer-12Hz';

function configuredValue(...values) {
  for (const value of values) {
    const normalized = String(value ?? '').trim();
    if (normalized) return normalized;
  }
  return '';
}

function positiveInteger(value, fallback, minimum, maximum) {
  const parsed = Number(value ?? fallback);
  if (!Number.isInteger(parsed) || parsed < minimum || parsed > maximum) return fallback;
  return parsed;
}

function configuredTimeout(value, engine) {
  const fallback = engine === 'qwen3-tts' ? DEFAULT_QWEN3_TTS_TIMEOUT_MS : DEFAULT_TTS_TIMEOUT_MS;
  const minimum = engine === 'qwen3-tts' ? DEFAULT_QWEN3_TTS_TIMEOUT_MS : 1_000;
  return positiveInteger(value, fallback, minimum, 15 * 60_000);
}

function resolveCommand(root, value) {
  const command = configuredValue(value);
  return command.includes('/') ? resolve(root, command) : command;
}

async function inspectFile(path, options = {}) {
  let metadata;
  try {
    metadata = await stat(path);
  } catch {
    return { exists: false, readable: false, executable: false, sizeBytes: 0 };
  }
  if (!metadata.isFile()) {
    return {
      exists: true,
      readable: false,
      executable: false,
      sizeBytes: metadata.size,
    };
  }
  try {
    await access(path, options.executable ? constants.X_OK : constants.R_OK);
    return {
      exists: true,
      readable: true,
      executable: Boolean(options.executable),
      sizeBytes: metadata.size,
    };
  } catch {
    return {
      exists: true,
      readable: false,
      executable: false,
      sizeBytes: metadata.size,
    };
  }
}

async function commandAvailable(command) {
  if (!command) return false;
  if (command.includes('/')) return (await inspectFile(command, { executable: true })).executable;
  return spawnSync('which', [command], { stdio: 'ignore' }).status === 0;
}

export function resolveTtsRuntime(env = process.env, root = process.cwd()) {
  const rawEngine = configuredValue(env.TTS_ENGINE, DEFAULT_TTS_ENGINE).toLowerCase();
  const engine = rawEngine === 'espeak' ? 'espeak-ng' : rawEngine;
  const piper = engine === 'piper';
  const qwen = engine === 'qwen3-tts';
  const pocket = engine === 'pocket-tts';
  const executable = piper
    ? resolveCommand(root, configuredValue(env.PIPER_EXECUTABLE, DEFAULT_PIPER_EXECUTABLE))
    : pocket
      ? resolveCommand(root, configuredValue(env.POCKET_TTS_EXECUTABLE, DEFAULT_POCKET_TTS_EXECUTABLE))
      : qwen
        ? resolveCommand(root, configuredValue(env.QWEN3_TTS_EXECUTABLE, DEFAULT_QWEN3_TTS_EXECUTABLE))
        : resolveCommand(root, configuredValue(env.ESPEAK_EXECUTABLE, '/usr/bin/espeak-ng'));
  const configuredModelPath = configuredValue(env.PIPER_MODEL_PATH, env.TTS_MODEL_PATH, DEFAULT_PIPER_MODEL_PATH);
  const modelPath = piper ? resolve(root, configuredModelPath) : null;
  const qwenModelDirectory = qwen
    ? resolve(root, configuredValue(env.QWEN3_TTS_MODEL_DIR, DEFAULT_QWEN3_TTS_MODEL_DIR))
    : null;
  const qwenTokenizerDirectory = qwen
    ? resolve(root, configuredValue(env.QWEN3_TTS_TOKENIZER_DIR, DEFAULT_QWEN3_TTS_TOKENIZER_DIR))
    : null;

  return {
    engine,
    supported: engine === 'pocket-tts' || engine === 'piper' || engine === 'espeak-ng' || engine === 'qwen3-tts',
    voice: qwen
      ? 'qwen3-tts-german'
      : configuredValue(env.TTS_DEFAULT_VOICE, pocket ? DEFAULT_POCKET_TTS_VOICE : piper ? DEFAULT_PIPER_VOICE : 'de'),
    executable,
    ffprobeExecutable: resolveCommand(root, configuredValue(env.FFPROBE_EXECUTABLE, DEFAULT_FFPROBE_EXECUTABLE)),
    pocketServerUrl: configuredValue(env.POCKET_TTS_SERVER_URL, DEFAULT_POCKET_TTS_SERVER_URL),
    pocketLanguage: configuredValue(env.POCKET_TTS_LANGUAGE, DEFAULT_POCKET_TTS_LANGUAGE),
    modelPath,
    configPath: modelPath ? `${modelPath}.json` : null,
    qwenModel: configuredValue(env.QWEN3_TTS_MODEL, DEFAULT_QWEN3_TTS_MODEL),
    qwenModelDirectory,
    qwenTokenizerDirectory,
    qwenLanguage: configuredValue(env.QWEN3_TTS_LANGUAGE, 'German'),
    outputDirectory: resolve(
      root,
      configuredValue(env.TTS_OUTPUT_DIR, env.TTS_OUTPUT_DIRECTORY, DEFAULT_TTS_OUTPUT_DIRECTORY),
    ),
    timeoutMs: configuredTimeout(env.TTS_TIMEOUT_MS, engine),
    minimumModelBytes: positiveInteger(
      env.PIPER_MIN_MODEL_BYTES,
      DEFAULT_MINIMUM_PIPER_MODEL_BYTES,
      44,
      1024 * 1024 * 1024,
    ),
  };
}

export async function inspectTtsRuntime(options = {}) {
  const env = options.env ?? process.env;
  const root = resolve(options.root ?? process.cwd());
  const checkCommand = options.commandAvailable ?? commandAvailable;
  const runtime = resolveTtsRuntime(env, root);
  const checks = [];
  const add = (id, status, message, detail) => checks.push({ id, status, message, ...(detail ? { detail } : {}) });

  if (!runtime.supported) {
    add('tts-engine', 'error', `Nicht unterstützte TTS-Engine: ${runtime.engine || '(leer)'}`);
  } else {
    add(
      'tts-engine',
      'ok',
      runtime.engine === 'piper'
        ? `Piper ist als Sprachausgabe mit ${runtime.voice} konfiguriert.`
        : runtime.engine === 'pocket-tts'
          ? `Pocket TTS ist als lokale Sprachausgabe mit ${runtime.pocketLanguage} und Stimme ${runtime.voice} konfiguriert.`
          : runtime.engine === 'qwen3-tts'
            ? `Qwen3-TTS ist als deutsche Sprachausgabe mit ${runtime.qwenModel} konfiguriert.`
            : `eSpeak NG ist als Sprachausgabe mit ${runtime.voice} konfiguriert.`,
    );
  }

  if (runtime.supported) {
    const executableAvailable = await checkCommand(runtime.executable);
    add(
      'tts-executable',
      executableAvailable ? 'ok' : 'error',
      executableAvailable
        ? `TTS-Programm ist ausführbar: ${runtime.executable}`
        : `TTS-Programm fehlt oder ist nicht ausführbar: ${runtime.executable}`,
    );
    const ffprobeAvailable = await checkCommand(runtime.ffprobeExecutable);
    add(
      'tts-ffprobe',
      ffprobeAvailable ? 'ok' : 'error',
      ffprobeAvailable
        ? `FFprobe ist ausführbar: ${runtime.ffprobeExecutable}`
        : `FFprobe fehlt oder ist nicht ausführbar: ${runtime.ffprobeExecutable}`,
    );
  }

  let modelMetadata = null;
  let modelSizeBytes = null;
  if (runtime.engine === 'piper' && runtime.modelPath && runtime.configPath) {
    const model = await inspectFile(runtime.modelPath);
    modelSizeBytes = model.sizeBytes;
    const modelValid = model.readable && model.sizeBytes >= runtime.minimumModelBytes;
    add(
      'tts-model',
      modelValid ? 'ok' : 'error',
      !model.exists
        ? `Piper-Modell fehlt: ${runtime.modelPath}`
        : !model.readable
          ? `Piper-Modell ist nicht lesbar: ${runtime.modelPath}`
          : modelValid
            ? `Piper-Modell ist lesbar (${model.sizeBytes} Bytes).`
            : `Piper-Modell ist mit ${model.sizeBytes} Bytes unerwartet klein.`,
    );

    try {
      const configFile = await inspectFile(runtime.configPath);
      if (!configFile.exists) {
        throw new Error(`Piper-Modellkonfiguration fehlt: ${runtime.configPath}`);
      }
      if (!configFile.readable) {
        throw new Error(`Piper-Modellkonfiguration ist nicht lesbar: ${runtime.configPath}`);
      }
      const parsed = JSON.parse(await readFile(runtime.configPath, 'utf8'));
      const languageCode = String(parsed?.language?.code ?? '').trim();
      const sampleRate = Number(parsed?.audio?.sample_rate);
      if (!languageCode || !Number.isFinite(sampleRate) || sampleRate <= 0) {
        throw new Error('Piper-Modellkonfiguration enthält keine gültige Sprache oder Abtastrate.');
      }
      if (runtime.voice === DEFAULT_PIPER_VOICE && !['de', 'de_DE'].includes(languageCode)) {
        throw new Error(`Dii High erwartet Deutsch (de oder de_DE), gefunden wurde ${languageCode}.`);
      }
      modelMetadata = parsed;
      add('tts-model-config', 'ok', `Piper-Modellkonfiguration ist gültig (${languageCode}, ${sampleRate} Hz).`);
    } catch (error) {
      add(
        'tts-model-config',
        'error',
        error instanceof Error ? error.message : 'Piper-Modellkonfiguration ist ungültig.',
      );
    }
  }

  if (runtime.engine === 'qwen3-tts' && runtime.qwenModelDirectory && runtime.qwenTokenizerDirectory) {
    const modelConfig = await inspectFile(`${runtime.qwenModelDirectory}/config.json`);
    add(
      'tts-qwen-model',
      modelConfig.readable ? 'ok' : 'error',
      modelConfig.exists
        ? modelConfig.readable
          ? `Qwen3-TTS-Modell ist vorhanden: ${runtime.qwenModelDirectory}`
          : `Qwen3-TTS-Modell ist nicht lesbar: ${runtime.qwenModelDirectory}`
        : `Qwen3-TTS-Modell fehlt: ${runtime.qwenModelDirectory}`,
    );
    const tokenizerConfig = await inspectFile(`${runtime.qwenTokenizerDirectory}/config.json`);
    add(
      'tts-qwen-tokenizer',
      tokenizerConfig.readable ? 'ok' : 'error',
      tokenizerConfig.exists
        ? tokenizerConfig.readable
          ? `Qwen3-TTS-Tokenizer ist vorhanden: ${runtime.qwenTokenizerDirectory}`
          : `Qwen3-TTS-Tokenizer ist nicht lesbar: ${runtime.qwenTokenizerDirectory}`
        : `Qwen3-TTS-Tokenizer fehlt: ${runtime.qwenTokenizerDirectory}`,
    );
    modelMetadata = {
      language: { code: runtime.qwenLanguage },
      quality: runtime.qwenModel.includes('1.7B') ? '1.7B' : '0.6B',
      audio: { sample_rate: 24_000 },
      num_speakers: null,
    };
  }

  if (runtime.engine === 'pocket-tts') {
    const healthy = await fetch(`${runtime.pocketServerUrl.replace(/\/$/, '')}/health`, {
      signal: AbortSignal.timeout(2_000),
    })
      .then((response) => response.ok)
      .catch(() => false);
    add(
      'tts-pocket-service',
      healthy ? 'ok' : 'error',
      healthy
        ? `Pocket-TTS-Dienst antwortet unter ${runtime.pocketServerUrl}.`
        : `Pocket-TTS-Dienst antwortet nicht unter ${runtime.pocketServerUrl}.`,
    );
    modelMetadata = {
      language: { code: runtime.pocketLanguage },
      quality: runtime.pocketLanguage.endsWith('_24l') ? '24l' : 'standard',
      audio: { sample_rate: 24_000 },
      num_speakers: null,
    };
  }

  const errors = checks.filter((check) => check.status === 'error');
  return {
    ok: errors.length === 0,
    checkedAt: new Date().toISOString(),
    engine: runtime.engine,
    voice: runtime.voice,
    executable: runtime.executable,
    ffprobeExecutable: runtime.ffprobeExecutable,
    modelPath: runtime.modelPath,
    configPath: runtime.configPath,
    qwenModel: runtime.qwenModel,
    pocketServerUrl: runtime.pocketServerUrl,
    pocketLanguage: runtime.pocketLanguage,
    qwenModelDirectory: runtime.qwenModelDirectory,
    qwenTokenizerDirectory: runtime.qwenTokenizerDirectory,
    outputDirectory: runtime.outputDirectory,
    timeoutMs: runtime.timeoutMs,
    model: modelMetadata
      ? {
          language: modelMetadata.language?.code ?? null,
          quality: modelMetadata.quality ?? runtime.voice.split('-').at(-1) ?? null,
          sampleRate: modelMetadata.audio?.sample_rate ?? null,
          speakers: modelMetadata.num_speakers ?? null,
          sizeBytes: modelSizeBytes,
        }
      : null,
    summary: {
      total: checks.length,
      passed: checks.filter((check) => check.status === 'ok').length,
      errors: errors.length,
    },
    checks,
  };
}

const direct = process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url);
if (direct) {
  const json = process.argv.includes('--json');
  const report = await inspectTtsRuntime();
  if (json) console.log(JSON.stringify(report));
  else {
    console.log(`TTS-Laufzeitprüfung: ${report.ok ? 'BESTANDEN' : 'FEHLGESCHLAGEN'}`);
    for (const check of report.checks) {
      console.log(`${check.status === 'ok' ? '✓' : '✗'} ${check.message}`);
    }
  }
  if (!report.ok) process.exitCode = 1;
}
