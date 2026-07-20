import type { FastifyInstance, FastifyReply, FastifyRequest } from 'fastify';
import type { WritePermission } from '@ans/security/auth';
import { randomUUID } from 'node:crypto';
import { spawn } from 'node:child_process';
import { access, stat } from 'node:fs/promises';
import { constants } from 'node:fs';
import { resolve } from 'node:path';
import dotenv from 'dotenv';
import { z } from 'zod';
import { DEFAULT_PIPER_EXECUTABLE, DEFAULT_PIPER_MODEL_PATH, DEFAULT_PIPER_VOICE } from '@ans/tts-engine';
import { updateEnvironmentDocument } from './stream-target-settings.js';
import { PROJECT_ROOT } from './project-root.js';
import {
  readOptionalEnvironmentFile,
  withEnvironmentFileLock,
  writePrivateEnvironmentFile,
} from './environment-file.js';

export type TtsPreset = {
  id: string;
  label: string;
  description: string;
  engine: 'piper' | 'espeak-ng' | 'qwen3-tts';
  voice: string;
  modelPath: string | null;
  executable: string;
  size: 'klein' | 'mittel' | 'hoch';
  audioReady: boolean;
  installHint: string;
};

type TtsInstallJob = {
  id: string;
  presetId: string;
  status: 'idle' | 'running' | 'completed' | 'failed';
  step: string;
  message: string;
  startedAt: string;
  completedAt: string | null;
  error: string | null;
  log: string[];
};

const piperRoot = './var/models/piper';
const qwenRoot = './var/models/qwen3-tts';
const qwenTokenizerPath = `${qwenRoot}/Qwen3-TTS-Tokenizer-12Hz`;
const qwenExecutable = './var/qwen3-tts-venv/bin/python';

export const TTS_PRESETS = [
  {
    id: 'piper-de-thorsten-high',
    label: 'Piper · Thorsten High',
    description: 'Deutsche Standardstimme mit guter Qualität für Sendebeiträge.',
    engine: 'piper',
    voice: DEFAULT_PIPER_VOICE,
    modelPath: DEFAULT_PIPER_MODEL_PATH,
    executable: DEFAULT_PIPER_EXECUTABLE,
    size: 'hoch',
    audioReady: true,
    installHint: 'Installiert Piper lokal in ./var/piper-venv und lädt das Thorsten-High-Modell.',
  },
  {
    id: 'piper-de-thorsten-medium',
    label: 'Piper · Thorsten Medium',
    description: 'Kleineres deutsches Piper-Modell mit guter Laufzeit auf schwächerer Hardware.',
    engine: 'piper',
    voice: 'de_DE-thorsten-medium',
    modelPath: `${piperRoot}/de_DE-thorsten-medium.onnx`,
    executable: DEFAULT_PIPER_EXECUTABLE,
    size: 'mittel',
    audioReady: true,
    installHint: 'Installiert Piper lokal und lädt Thorsten Medium.',
  },
  {
    id: 'piper-de-eva-x-low',
    label: 'Piper · Eva K x-low',
    description: 'Sehr kleines deutsches Piper-Modell, wenn Geschwindigkeit wichtiger als Qualität ist.',
    engine: 'piper',
    voice: 'de_DE-eva_k-x_low',
    modelPath: `${piperRoot}/de_DE-eva_k-x_low.onnx`,
    executable: DEFAULT_PIPER_EXECUTABLE,
    size: 'klein',
    audioReady: true,
    installHint: 'Installiert Piper lokal und lädt Eva K x-low.',
  },
  {
    id: 'espeak-ng-de',
    label: 'eSpeak NG · Deutsch',
    description: 'Robuste Systemstimme mit geringer Qualität, aber sehr kleiner Laufzeitabhängigkeit.',
    engine: 'espeak-ng',
    voice: 'de',
    modelPath: null,
    executable: '/usr/bin/espeak-ng',
    size: 'klein',
    audioReady: true,
    installHint: 'Installiert das Systempaket espeak-ng, wenn Paketverwaltung verfügbar ist.',
  },
  {
    id: 'qwen3-tts-06b-german-customvoice',
    label: 'Qwen3-TTS · 0.6B CustomVoice',
    description: 'Kleines offizielles Qwen3-TTS-Modell, in der Studio-Konfiguration fest auf Deutsch gesetzt.',
    engine: 'qwen3-tts',
    voice: 'Qwen/Qwen3-TTS-12Hz-0.6B-CustomVoice',
    modelPath: `${qwenRoot}/Qwen3-TTS-12Hz-0.6B-CustomVoice`,
    executable: qwenExecutable,
    size: 'mittel',
    audioReady: true,
    installHint: 'Installiert qwen-tts in ./var/qwen3-tts-venv und lädt Modell plus 12Hz-Tokenizer von Hugging Face.',
  },
  {
    id: 'qwen3-tts-17b-german-customvoice',
    label: 'Qwen3-TTS · 1.7B CustomVoice',
    description: 'Größeres offizielles Qwen3-TTS-Modell für deutsche Sprechertexte mit besserer Qualität.',
    engine: 'qwen3-tts',
    voice: 'Qwen/Qwen3-TTS-12Hz-1.7B-CustomVoice',
    modelPath: `${qwenRoot}/Qwen3-TTS-12Hz-1.7B-CustomVoice`,
    executable: qwenExecutable,
    size: 'hoch',
    audioReady: true,
    installHint: 'Installiert qwen-tts und lädt 1.7B CustomVoice plus 12Hz-Tokenizer.',
  },
  {
    id: 'qwen3-tts-17b-german-voicedesign',
    label: 'Qwen3-TTS · 1.7B VoiceDesign',
    description: '1.7B Qwen3-TTS mit deutscher Voice-Design-Anweisung für natürlichere Sprecherstimme.',
    engine: 'qwen3-tts',
    voice: 'Qwen/Qwen3-TTS-12Hz-1.7B-VoiceDesign',
    modelPath: `${qwenRoot}/Qwen3-TTS-12Hz-1.7B-VoiceDesign`,
    executable: qwenExecutable,
    size: 'hoch',
    audioReady: true,
    installHint: 'Installiert qwen-tts und lädt 1.7B VoiceDesign plus 12Hz-Tokenizer.',
  },
] satisfies TtsPreset[];

const ttsSettingsInputSchema = z.object({ presetId: z.string().min(1) }).strict();
type TtsSettingsInput = z.infer<typeof ttsSettingsInputSchema>;

type TtsSettingsDependencies = {
  env: NodeJS.ProcessEnv;
  readEnvironmentFile: () => Promise<string>;
  writeEnvironmentFile: (content: string) => Promise<void>;
  commandAvailable: (command: string) => Promise<boolean>;
  fileUsable: (file: string, minimumBytes?: number) => Promise<boolean>;
  spawnInstall: (preset: TtsPreset, onLog: (chunk: string) => void) => Promise<void>;
};

type TtsSettingsOptions = Partial<TtsSettingsDependencies> & { envFile?: string };

function resolveLocalPath(path: string) {
  return path.includes('/') ? resolve(PROJECT_ROOT, path) : path;
}

async function commandAvailable(command: string) {
  if (!command) return false;
  if (command.includes('/')) {
    try {
      await access(resolveLocalPath(command), constants.X_OK);
      return true;
    } catch {
      return false;
    }
  }
  return new Promise<boolean>((resolveResult) => {
    const child = spawn('which', [command], { stdio: 'ignore' });
    child.once('error', () => resolveResult(false));
    child.once('close', (code) => resolveResult(code === 0));
  });
}

async function fileUsable(file: string, minimumBytes = 1) {
  try {
    const metadata = await stat(resolveLocalPath(file));
    return metadata.isFile() && metadata.size >= minimumBytes;
  } catch {
    return false;
  }
}

function piperModelUrl(preset: TtsPreset) {
  if (preset.id === 'piper-de-thorsten-medium')
    return 'https://huggingface.co/rhasspy/piper-voices/resolve/main/de/de_DE/thorsten/medium/de_DE-thorsten-medium.onnx';
  if (preset.id === 'piper-de-eva-x-low')
    return 'https://huggingface.co/rhasspy/piper-voices/resolve/main/de/de_DE/eva_k/x_low/de_DE-eva_k-x_low.onnx';
  return 'https://huggingface.co/rhasspy/piper-voices/resolve/main/de/de_DE/thorsten/high/de_DE-thorsten-high.onnx';
}

function qwenLocalModelName(preset: TtsPreset) {
  return preset.voice.split('/').at(-1) ?? preset.id;
}

function qwenModelPath(preset: TtsPreset) {
  return preset.modelPath ?? `${qwenRoot}/${qwenLocalModelName(preset)}`;
}

function spawnProcess(command: string, args: string[], env: NodeJS.ProcessEnv, onLog: (chunk: string) => void) {
  return new Promise<void>((resolveResult, reject) => {
    const child = spawn(command, args, { cwd: PROJECT_ROOT, env, stdio: ['ignore', 'pipe', 'pipe'] });
    child.stdout.on('data', (chunk) => onLog(String(chunk)));
    child.stderr.on('data', (chunk) => onLog(String(chunk)));
    child.once('error', reject);
    child.once('close', (code) => {
      if (code === 0) resolveResult();
      else reject(new Error(`${command} ${args.join(' ')} wurde mit Code ${code ?? 'unbekannt'} beendet`));
    });
  });
}

async function defaultSpawnInstall(preset: TtsPreset, onLog: (chunk: string) => void) {
  if (preset.engine === 'piper') {
    const env = {
      ...process.env,
      PIPER_MODEL_PATH: preset.modelPath ?? DEFAULT_PIPER_MODEL_PATH,
      TTS_MODEL_PATH: preset.modelPath ?? DEFAULT_PIPER_MODEL_PATH,
      TTS_DEFAULT_VOICE: preset.voice,
      PIPER_MODEL_URL: piperModelUrl(preset),
      PIPER_CONFIG_URL: `${piperModelUrl(preset)}.json`,
      PIPER_MIN_MODEL_BYTES: preset.id === 'piper-de-thorsten-high' ? String(50 * 1024 * 1024) : String(1024 * 1024),
    };
    await spawnProcess('node', ['--env-file=.env', 'scripts/install-piper-thorsten-high.mjs'], env, onLog);
    return;
  }
  if (preset.engine === 'espeak-ng') {
    if (await commandAvailable('apt-get')) {
      await spawnProcess('apt-get', ['update'], process.env, onLog);
      await spawnProcess('apt-get', ['install', '-y', 'espeak-ng', 'ffmpeg'], process.env, onLog);
      return;
    }
    throw new Error('Automatische Installation benötigt apt-get oder ein bereits installiertes espeak-ng.');
  }
  const venvPython = resolveLocalPath(qwenExecutable);
  await spawnProcess('python3', ['-m', 'venv', resolveLocalPath('./var/qwen3-tts-venv')], process.env, onLog);
  await spawnProcess(
    venvPython,
    ['-m', 'pip', 'install', '--disable-pip-version-check', '--no-input', '-U', 'qwen-tts', 'huggingface_hub[cli]'],
    process.env,
    onLog,
  );
  await spawnProcess(
    resolveLocalPath('./var/qwen3-tts-venv/bin/huggingface-cli'),
    ['download', 'Qwen/Qwen3-TTS-Tokenizer-12Hz', '--local-dir', resolveLocalPath(qwenTokenizerPath)],
    process.env,
    onLog,
  );
  await spawnProcess(
    resolveLocalPath('./var/qwen3-tts-venv/bin/huggingface-cli'),
    ['download', preset.voice, '--local-dir', resolveLocalPath(qwenModelPath(preset))],
    process.env,
    onLog,
  );
}

function findPreset(id: string) {
  const preset = TTS_PRESETS.find((candidate) => candidate.id === id);
  if (!preset) throw Object.assign(new Error(`Unbekanntes TTS-Preset: ${id}`), { statusCode: 400 });
  return preset;
}

function selectedPresetId(env: NodeJS.ProcessEnv) {
  const configured = String(env.TTS_PRESET_ID ?? '').trim();
  if (configured && TTS_PRESETS.some((preset) => preset.id === configured)) return configured;
  const engine = String(env.TTS_ENGINE ?? 'piper').toLowerCase();
  const voice = String(env.TTS_DEFAULT_VOICE ?? '').trim();
  if (engine === 'espeak' || engine === 'espeak-ng') return 'espeak-ng-de';
  if (engine === 'qwen3-tts') {
    const model = String(env.QWEN3_TTS_MODEL ?? '').trim();
    return (
      TTS_PRESETS.find((preset) => preset.engine === 'qwen3-tts' && preset.voice === model)?.id ??
      'qwen3-tts-06b-german-customvoice'
    );
  }
  return TTS_PRESETS.find((preset) => preset.voice === voice)?.id ?? 'piper-de-thorsten-high';
}

export function buildTtsEnvironment(current: NodeJS.ProcessEnv, rawInput: unknown) {
  const input = ttsSettingsInputSchema.parse(rawInput);
  const preset = findPreset(input.presetId);
  const piper = preset.engine === 'piper';
  const espeak = preset.engine === 'espeak-ng';
  const qwen = preset.engine === 'qwen3-tts';
  const currentTimeout = Number(current.TTS_TIMEOUT_MS ?? 120_000);
  const qwenTimeout = Number.isFinite(currentTimeout) ? Math.max(300_000, Math.floor(currentTimeout)) : 300_000;
  const updates = {
    TTS_PRESET_ID: preset.id,
    TTS_ENGINE: preset.engine,
    TTS_DEFAULT_VOICE: espeak ? preset.voice : piper ? preset.voice : 'qwen3-tts-german',
    TTS_SPEED: espeak ? '165' : '1',
    TTS_VOLUME: espeak ? '100' : '1',
    TTS_TIMEOUT_MS: qwen ? String(qwenTimeout) : (current.TTS_TIMEOUT_MS ?? '120000'),
    PIPER_EXECUTABLE: piper ? preset.executable : (current.PIPER_EXECUTABLE ?? DEFAULT_PIPER_EXECUTABLE),
    PIPER_MODEL_PATH: piper ? (preset.modelPath ?? DEFAULT_PIPER_MODEL_PATH) : (current.PIPER_MODEL_PATH ?? ''),
    TTS_MODEL_PATH: piper ? (preset.modelPath ?? DEFAULT_PIPER_MODEL_PATH) : (current.TTS_MODEL_PATH ?? ''),
    ESPEAK_EXECUTABLE: espeak ? preset.executable : (current.ESPEAK_EXECUTABLE ?? '/usr/bin/espeak-ng'),
    QWEN3_TTS_MODEL: qwen ? preset.voice : (current.QWEN3_TTS_MODEL ?? ''),
    QWEN3_TTS_MODEL_DIR: qwen ? qwenModelPath(preset) : (current.QWEN3_TTS_MODEL_DIR ?? ''),
    QWEN3_TTS_TOKENIZER_DIR: qwen ? qwenTokenizerPath : (current.QWEN3_TTS_TOKENIZER_DIR ?? ''),
    QWEN3_TTS_EXECUTABLE: qwen ? preset.executable : (current.QWEN3_TTS_EXECUTABLE ?? qwenExecutable),
    QWEN3_TTS_LANGUAGE: qwen ? 'German' : (current.QWEN3_TTS_LANGUAGE ?? 'German'),
    QWEN3_TTS_SPEAKER: qwen ? (current.QWEN3_TTS_SPEAKER ?? 'Ryan') : (current.QWEN3_TTS_SPEAKER ?? 'Ryan'),
    QWEN3_TTS_INSTRUCT: qwen
      ? (current.QWEN3_TTS_INSTRUCT ??
        'Sprich wie ein ruhiger deutscher Nachrichtensprecher: klar, seriös, neutral und gut verständlich.')
      : (current.QWEN3_TTS_INSTRUCT ?? ''),
  };
  return { input, preset, updates, next: { ...current, ...updates } };
}

export class TtsSettingsManager {
  private saving = false;
  private job: TtsInstallJob | null = null;
  private readonly dependencies: TtsSettingsDependencies;
  private readonly envFile: string;

  constructor(options: TtsSettingsOptions = {}) {
    const envFile = options.envFile ?? resolve(PROJECT_ROOT, '.env');
    this.envFile = envFile;
    this.dependencies = {
      env: options.env ?? process.env,
      readEnvironmentFile: options.readEnvironmentFile ?? (() => readOptionalEnvironmentFile(envFile)),
      writeEnvironmentFile:
        options.writeEnvironmentFile ?? ((content) => writePrivateEnvironmentFile(envFile, content)),
      commandAvailable: options.commandAvailable ?? commandAvailable,
      fileUsable: options.fileUsable ?? fileUsable,
      spawnInstall: options.spawnInstall ?? defaultSpawnInstall,
    };
  }

  private async currentEnvironment() {
    const content = await this.dependencies.readEnvironmentFile();
    return { content, env: { ...this.dependencies.env, ...dotenv.parse(content) } };
  }

  private async installationState(preset: TtsPreset) {
    if (preset.engine === 'piper') {
      const executable = await this.dependencies.commandAvailable(resolveLocalPath(preset.executable));
      const model = await this.dependencies.fileUsable(preset.modelPath ?? DEFAULT_PIPER_MODEL_PATH, 1024 * 1024);
      const config = await this.dependencies.fileUsable(`${preset.modelPath ?? DEFAULT_PIPER_MODEL_PATH}.json`, 100);
      const ffprobe = await this.dependencies.commandAvailable('ffprobe');
      return {
        installed: executable && model && config && ffprobe,
        checks: { executable, model, config, ffprobe },
      };
    }
    if (preset.engine === 'espeak-ng') {
      const executable = await this.dependencies.commandAvailable(preset.executable);
      const ffprobe = await this.dependencies.commandAvailable('ffprobe');
      return { installed: executable && ffprobe, checks: { executable, ffprobe } };
    }
    const executable = await this.dependencies.commandAvailable(resolveLocalPath(preset.executable));
    const model = await this.dependencies.fileUsable(`${qwenModelPath(preset)}/config.json`, 100);
    const tokenizer = await this.dependencies.fileUsable(`${qwenTokenizerPath}/config.json`, 100);
    const ffprobe = await this.dependencies.commandAvailable('ffprobe');
    return {
      installed: executable && model && tokenizer && ffprobe,
      checks: { executable, model, tokenizer, ffprobe },
    };
  }

  async get() {
    const { env } = await this.currentEnvironment();
    const presetId = selectedPresetId(env);
    const presets = await Promise.all(
      TTS_PRESETS.map(async (preset) => ({
        ...preset,
        ...(await this.installationState(preset)),
      })),
    );
    const selected = presets.find((preset) => preset.id === presetId) ?? presets[0];
    return {
      presetId,
      selected,
      presets,
      job: this.job,
      note:
        selected?.engine === 'qwen3-tts'
          ? 'Qwen3-TTS benötigt eine geeignete lokale Python/PyTorch-Laufzeit; ohne GPU kann die Synthese langsam sein.'
          : '',
    };
  }

  private startInstall(preset: TtsPreset) {
    if (this.job?.status === 'running') return this.job;
    const job: TtsInstallJob = {
      id: randomUUID(),
      presetId: preset.id,
      status: 'running',
      step: 'install',
      message: `${preset.label} wird installiert …`,
      startedAt: new Date().toISOString(),
      completedAt: null,
      error: null,
      log: [],
    };
    this.job = job;
    const append = (chunk: string) => {
      const lines = chunk
        .split(/\r?\n/)
        .map((line) => line.trim())
        .filter(Boolean);
      job.log.push(...lines);
      job.log = job.log.slice(-80);
      job.message = lines.at(-1) ?? job.message;
    };
    void this.dependencies
      .spawnInstall(preset, append)
      .then(() => {
        job.status = 'completed';
        job.completedAt = new Date().toISOString();
        job.step = 'completed';
        job.message = `${preset.label} ist installiert.`;
      })
      .catch((error) => {
        job.status = 'failed';
        job.completedAt = new Date().toISOString();
        job.step = 'failed';
        job.error = error instanceof Error ? error.message : String(error);
        job.message = job.error;
      });
    return job;
  }

  async save(rawInput: unknown) {
    if (this.saving)
      throw Object.assign(new Error('TTS-Einstellungen werden bereits gespeichert.'), { statusCode: 409 });
    this.saving = true;
    try {
      const input = ttsSettingsInputSchema.parse(rawInput);
      const preset = findPreset(input.presetId);
      await withEnvironmentFileLock(this.envFile, async () => {
        const { content, env } = await this.currentEnvironment();
        const { updates } = buildTtsEnvironment(env, input);
        await this.dependencies.writeEnvironmentFile(updateEnvironmentDocument(content, updates));
        for (const [key, value] of Object.entries(updates)) this.dependencies.env[key] = value;
      });
      const state = await this.installationState(preset);
      if (!state.installed) this.startInstall(preset);
      return this.get();
    } finally {
      this.saving = false;
    }
  }

  async installSelected() {
    const { env } = await this.currentEnvironment();
    const preset = findPreset(selectedPresetId(env));
    this.startInstall(preset);
    return this.get();
  }
}

type RequirePermission = (request: FastifyRequest, reply: FastifyReply, permission: WritePermission) => unknown;

export function registerTtsSettingsRoutes(
  app: FastifyInstance,
  manager: TtsSettingsManager,
  requirePermission: RequirePermission,
) {
  app.get('/api/tts/settings', async (request, reply) => {
    requirePermission(request, reply, 'users:write');
    return manager.get();
  });
  app.post('/api/tts/settings', async (request, reply) => {
    requirePermission(request, reply, 'users:write');
    return manager.save(request.body as TtsSettingsInput);
  });
  app.post('/api/tts/settings/install', async (request, reply) => {
    requirePermission(request, reply, 'users:write');
    return manager.installSelected();
  });
}
