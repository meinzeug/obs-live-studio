import { createHash } from 'node:crypto';
import { spawn } from 'node:child_process';
import { mkdir, rename, rm, stat, writeFile } from 'node:fs/promises';
import path from 'node:path';

export const DEFAULT_TTS_ENGINE = 'pocket-tts';
export const DEFAULT_POCKET_TTS_SERVER_URL = 'http://127.0.0.1:8000';
export const DEFAULT_POCKET_TTS_LANGUAGE = 'german_24l';
export const DEFAULT_POCKET_TTS_VOICE = 'lola';
// Official Pocket TTS catalogue voice used for the second on-air presenter.
// Keeping this separate from the station default makes AVA and the chat host
// audibly distinguishable while both still use the resident german_24l model.
export const DEFAULT_POCKET_TTS_CHAT_VOICE = 'alba';
export const DEFAULT_POCKET_TTS_TEMPERATURE = 0.7;
export const DEFAULT_POCKET_TTS_DECODE_STEPS = 4;
export const DEFAULT_TTS_OUTPUT_GAIN_DB = 7;
export const DEFAULT_PIPER_VOICE = 'de_DE-dii-high';
export const DEFAULT_PIPER_MODEL_PATH = './var/models/piper/de_DE-dii-high.onnx';
export const DEFAULT_PIPER_EXECUTABLE = './var/piper-venv/bin/piper';

const DEFAULT_TTS_TIMEOUT_MS = 120_000;
const DEFAULT_PROBE_TIMEOUT_MS = 30_000;
const MAX_PROCESS_OUTPUT_BYTES = 64 * 1024;

export interface TtsOptions {
  piperExecutable?: string;
  modelPath?: string;
  outputDirectory: string;
  voice?: string;
  speed?: number;
  volume?: number;
  outputGainDb?: number;
  ffmpegExecutable?: string;
  timeoutMs?: number;
}

export interface EspeakOptions {
  outputDirectory: string;
  executable?: string;
  voice?: string;
  speed?: number;
  volume?: number;
  outputGainDb?: number;
  ffmpegExecutable?: string;
  timeoutMs?: number;
}

export interface Qwen3TtsOptions {
  outputDirectory: string;
  executable?: string;
  model?: string;
  modelDirectory?: string;
  language?: string;
  speaker?: string;
  instruct?: string;
  outputGainDb?: number;
  ffmpegExecutable?: string;
  timeoutMs?: number;
}

export interface PocketTtsOptions {
  outputDirectory: string;
  serverUrl?: string;
  voice?: string;
  language?: string;
  temperature?: number;
  decodeSteps?: number;
  outputGainDb?: number;
  ffmpegExecutable?: string;
  timeoutMs?: number;
}

export interface SubprocessOptions {
  stdin?: string;
  timeoutMs?: number;
  label?: string;
}

function appendProcessOutput(current: string, chunk: unknown) {
  const next = `${current}${String(chunk)}`;
  return next.length > MAX_PROCESS_OUTPUT_BYTES ? next.slice(-MAX_PROCESS_OUTPUT_BYTES) : next;
}

function normalizedTimeout(value: number | undefined, fallback: number) {
  const parsed = Number(value ?? fallback);
  return Number.isFinite(parsed) ? Math.max(1, Math.floor(parsed)) : fallback;
}

function normalizedInteger(value: number | undefined, fallback: number, minimum: number, maximum: number) {
  const parsed = Number(value ?? fallback);
  return Number.isFinite(parsed) ? Math.max(minimum, Math.min(maximum, Math.round(parsed))) : fallback;
}

export async function runSubprocess(executable: string, args: string[], options: SubprocessOptions = {}) {
  const timeoutMs = normalizedTimeout(options.timeoutMs, DEFAULT_TTS_TIMEOUT_MS);
  const label = options.label?.trim() || executable;

  return new Promise<string>((resolve, reject) => {
    const child = spawn(executable, args, { stdio: ['pipe', 'pipe', 'pipe'] });
    let stdout = '';
    let stderr = '';
    let settled = false;
    let timer: NodeJS.Timeout | undefined;

    const finish = (error?: Error) => {
      if (settled) return;
      settled = true;
      if (timer) clearTimeout(timer);
      if (error) reject(error);
      else resolve(stdout.trim());
    };

    timer = setTimeout(() => {
      child.kill('SIGKILL');
      finish(new Error(`${label} hat das Zeitlimit von ${timeoutMs} ms überschritten`));
    }, timeoutMs);

    child.stdout.on('data', (chunk) => {
      stdout = appendProcessOutput(stdout, chunk);
    });
    child.stderr.on('data', (chunk) => {
      stderr = appendProcessOutput(stderr, chunk);
    });
    child.once('error', (error) => {
      finish(new Error(`${label} konnte nicht gestartet werden: ${error.message}`, { cause: error }));
    });
    child.once('close', (code, signal) => {
      if (code === 0) {
        finish();
        return;
      }
      const reason = stderr.trim() || `Prozess endete mit Code ${code ?? 'unbekannt'}${signal ? ` (${signal})` : ''}`;
      finish(new Error(`${label} fehlgeschlagen: ${reason}`));
    });
    child.stdin.on('error', (error: NodeJS.ErrnoException) => {
      if (error.code !== 'EPIPE')
        finish(new Error(`${label} konnte keine Eingabe lesen: ${error.message}`, { cause: error }));
    });
    child.stdin.end(options.stdin ?? '');
  });
}

function speechFile(text: string, identity: Record<string, unknown>, outputDirectory: string) {
  const fingerprint = createHash('sha256').update(text).update('\0').update(JSON.stringify(identity)).digest('hex');
  return path.resolve(outputDirectory, `${fingerprint}.wav`);
}

async function usableAudioFile(file: string) {
  try {
    return (await stat(file)).size > 44;
  } catch {
    return false;
  }
}

async function replaceFile(source: string, destination: string) {
  try {
    await rename(source, destination);
  } catch (error) {
    const code = (error as NodeJS.ErrnoException).code;
    if (code !== 'EEXIST' && code !== 'EPERM') throw error;
    await rm(destination, { force: true });
    await rename(source, destination);
  }
}

async function applyOutputGain(file: string, opts: { gainDb?: number; ffmpegExecutable?: string; timeoutMs?: number }) {
  const gainDb = normalizedNumber(opts.gainDb, 0, -12, 18);
  if (Math.abs(gainDb) < 0.01) return;
  const boostedFile = `${file}.gain-${process.pid}-${Date.now()}-${Math.random().toString(16).slice(2)}.wav`;
  try {
    await runSubprocess(
      opts.ffmpegExecutable?.trim() || process.env.FFMPEG_EXECUTABLE || 'ffmpeg',
      [
        '-y',
        '-hide_banner',
        '-loglevel',
        'error',
        '-i',
        file,
        '-filter:a',
        `volume=${gainDb}dB,alimiter=limit=0.96`,
        '-ar',
        '24000',
        '-ac',
        '1',
        boostedFile,
      ],
      {
        timeoutMs: Math.min(normalizedTimeout(opts.timeoutMs, DEFAULT_TTS_TIMEOUT_MS), 60_000),
        label: 'FFmpeg TTS-Gain',
      },
    );
    if (await usableAudioFile(boostedFile)) await replaceFile(boostedFile, file);
  } catch {
    await rm(boostedFile, { force: true });
  }
}

async function createAtomicSpeechFile(file: string, generate: (temporaryFile: string) => Promise<void>) {
  if (await usableAudioFile(file)) return true;
  const temporaryFile = `${file}.tmp-${process.pid}-${Date.now()}-${Math.random().toString(16).slice(2)}`;
  try {
    await generate(temporaryFile);
    if (!(await usableAudioFile(temporaryFile)))
      throw new Error('Die Sprachausgabe hat keine gültige Audiodatei erzeugt');
    await replaceFile(temporaryFile, file);
    return false;
  } catch (error) {
    await rm(temporaryFile, { force: true });
    throw error;
  }
}

export async function synthesizePiper(text: string, opts: TtsOptions) {
  if (!text.trim()) throw new Error('Leerer Sprechertext');
  const modelPath = opts.modelPath?.trim() || DEFAULT_PIPER_MODEL_PATH;
  const executable = opts.piperExecutable?.trim() || DEFAULT_PIPER_EXECUTABLE;
  const voice = opts.voice?.trim() || DEFAULT_PIPER_VOICE;
  await mkdir(opts.outputDirectory, { recursive: true });
  const file = speechFile(
    text,
    {
      engine: 'piper',
      executable,
      modelPath: path.resolve(modelPath),
      voice,
      speed: opts.speed ?? null,
      volume: opts.volume ?? null,
      outputGainDb: opts.outputGainDb ?? null,
    },
    opts.outputDirectory,
  );
  const cached = await createAtomicSpeechFile(file, async (temporaryFile) => {
    await runSubprocess(executable, ['--model', modelPath, '--output_file', temporaryFile], {
      stdin: text,
      timeoutMs: opts.timeoutMs,
      label: 'Piper',
    });
    await applyOutputGain(temporaryFile, {
      gainDb: opts.outputGainDb,
      ffmpegExecutable: opts.ffmpegExecutable,
      timeoutMs: opts.timeoutMs,
    });
  });
  return { file, format: 'wav' as const, cached, voice, modelPath };
}

function normalizedNumber(value: number | undefined, fallback: number, minimum: number, maximum: number) {
  const parsed = Number(value ?? fallback);
  return Number.isFinite(parsed) ? Math.max(minimum, Math.min(maximum, parsed)) : fallback;
}

function normalizePocketServerUrl(value: string | undefined) {
  const raw = value?.trim() || DEFAULT_POCKET_TTS_SERVER_URL;
  const url = new URL(raw);
  url.pathname = url.pathname.replace(/\/+$/, '');
  url.search = '';
  url.hash = '';
  return url.toString().replace(/\/$/, '');
}

export async function synthesizePocketTts(text: string, opts: PocketTtsOptions) {
  if (!text.trim()) throw new Error('Leerer Sprechertext');
  await mkdir(opts.outputDirectory, { recursive: true });
  const serverUrl = normalizePocketServerUrl(opts.serverUrl);
  const voice = opts.voice?.trim() || DEFAULT_POCKET_TTS_VOICE;
  const language = opts.language?.trim() || DEFAULT_POCKET_TTS_LANGUAGE;
  const temperature = normalizedNumber(opts.temperature, DEFAULT_POCKET_TTS_TEMPERATURE, 0, 2);
  const decodeSteps = Math.round(normalizedNumber(opts.decodeSteps, DEFAULT_POCKET_TTS_DECODE_STEPS, 1, 16));
  const file = speechFile(
    text,
    {
      engine: 'pocket-tts',
      serverUrl,
      voice,
      language,
      temperature,
      decodeSteps,
      outputGainDb: opts.outputGainDb ?? null,
    },
    opts.outputDirectory,
  );
  const cached = await createAtomicSpeechFile(file, async (temporaryFile) => {
    const form = new FormData();
    form.set('text', text);
    if (voice) form.set('voice_url', voice);
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), normalizedTimeout(opts.timeoutMs, DEFAULT_TTS_TIMEOUT_MS));
    try {
      const response = await fetch(`${serverUrl}/tts`, {
        method: 'POST',
        body: form,
        signal: controller.signal,
      });
      if (!response.ok) {
        const body = await response.text().catch(() => '');
        throw new Error(`Pocket TTS HTTP ${response.status}${body ? `: ${body.slice(0, 500)}` : ''}`);
      }
      const buffer = Buffer.from(await response.arrayBuffer());
      await writeFile(temporaryFile, buffer);
      await applyOutputGain(temporaryFile, {
        gainDb: opts.outputGainDb,
        ffmpegExecutable: opts.ffmpegExecutable,
        timeoutMs: opts.timeoutMs,
      });
    } catch (error) {
      if ((error as Error).name === 'AbortError') {
        throw new Error(`Pocket TTS hat das Zeitlimit überschritten`);
      }
      throw error;
    } finally {
      clearTimeout(timeout);
    }
  });
  return { file, format: 'wav' as const, cached, voice, modelPath: `${language}@${serverUrl}` };
}

export async function synthesizeEspeak(text: string, opts: EspeakOptions) {
  if (!text.trim()) throw new Error('Leerer Sprechertext');
  await mkdir(opts.outputDirectory, { recursive: true });
  const voice = opts.voice?.trim() || 'de';
  const speed = normalizedInteger(opts.speed, 165, 80, 450);
  const volume = normalizedInteger(opts.volume, 100, 0, 200);
  const executable = opts.executable?.trim() || 'espeak-ng';
  const file = speechFile(
    text,
    { engine: 'espeak-ng', executable, voice, speed, volume, outputGainDb: opts.outputGainDb ?? null },
    opts.outputDirectory,
  );
  const cached = await createAtomicSpeechFile(file, async (temporaryFile) => {
    await runSubprocess(
      executable,
      ['--stdin', '-v', voice, '-s', String(speed), '-a', String(volume), '-w', temporaryFile],
      {
        stdin: text,
        timeoutMs: opts.timeoutMs,
        label: 'eSpeak NG',
      },
    );
    await applyOutputGain(temporaryFile, {
      gainDb: opts.outputGainDb,
      ffmpegExecutable: opts.ffmpegExecutable,
      timeoutMs: opts.timeoutMs,
    });
  });
  return { file, format: 'wav' as const, cached };
}

export async function synthesizeQwen3Tts(text: string, opts: Qwen3TtsOptions) {
  if (!text.trim()) throw new Error('Leerer Sprechertext');
  await mkdir(opts.outputDirectory, { recursive: true });
  const executable = opts.executable?.trim() || './var/qwen3-tts-venv/bin/python';
  const model = opts.modelDirectory?.trim() || opts.model?.trim() || 'Qwen/Qwen3-TTS-12Hz-0.6B-CustomVoice';
  const language = opts.language?.trim() || 'German';
  const speaker = opts.speaker?.trim() || 'Ryan';
  const instruct =
    opts.instruct?.trim() ||
    'Sprich wie ein ruhiger deutscher Nachrichtensprecher: klar, seriös, neutral und gut verständlich.';
  const file = speechFile(
    text,
    { engine: 'qwen3-tts', executable, model, language, speaker, instruct, outputGainDb: opts.outputGainDb ?? null },
    opts.outputDirectory,
  );
  const cached = await createAtomicSpeechFile(file, async (temporaryFile) => {
    const source = `
import json
import sys

import soundfile as sf
import torch
from qwen_tts import Qwen3TTSModel

payload = json.loads(sys.stdin.read())
dtype = torch.bfloat16 if torch.cuda.is_available() else torch.float32
device_map = "cuda:0" if torch.cuda.is_available() else "cpu"
model = Qwen3TTSModel.from_pretrained(payload["model"], device_map=device_map, dtype=dtype)
model_name = payload["model"]
if "VoiceDesign" in model_name:
    wavs, sr = model.generate_voice_design(
        text=payload["text"],
        language=payload["language"],
        instruct=payload["instruct"],
    )
elif "CustomVoice" in model_name:
    wavs, sr = model.generate_custom_voice(
        text=payload["text"],
        language=payload["language"],
        speaker=payload["speaker"],
        instruct=payload["instruct"],
    )
else:
    raise RuntimeError("Qwen3-TTS Base-Modelle benötigen Referenz-Audio und sind für automatische Studio-TTS nicht vorkonfiguriert.")
sf.write(payload["output"], wavs[0], sr, format="WAV")
`;
    await runSubprocess(executable, ['-c', source], {
      stdin: JSON.stringify({ text, model, language, speaker, instruct, output: temporaryFile }),
      timeoutMs: opts.timeoutMs,
      label: 'Qwen3-TTS',
    });
    await applyOutputGain(temporaryFile, {
      gainDb: opts.outputGainDb,
      ffmpegExecutable: opts.ffmpegExecutable,
      timeoutMs: opts.timeoutMs,
    });
  });
  return { file, format: 'wav' as const, cached, voice: `${model}:${language}:${speaker}`, modelPath: model };
}

export async function probeAudioDuration(
  file: string,
  ffprobeExecutable = process.env.FFPROBE_EXECUTABLE ?? 'ffprobe',
  timeoutMs = DEFAULT_PROBE_TIMEOUT_MS,
) {
  const out = await runSubprocess(
    ffprobeExecutable,
    ['-v', 'error', '-show_entries', 'format=duration', '-of', 'default=noprint_wrappers=1:nokey=1', file],
    { timeoutMs, label: 'ffprobe' },
  );
  const seconds = Number(out);
  if (!Number.isFinite(seconds) || seconds <= 0)
    throw new Error(`ffprobe lieferte keine gültige Audiodauer für ${file}`);
  return Math.round(seconds * 100) / 100;
}

export function estimateWordTimings(text: string, durationSeconds: number) {
  const words = text.split(/\s+/).filter(Boolean);
  const total = words.reduce((a, w) => a + w.length, 0) || 1;
  let t = 0;
  return words.map((w) => {
    const d = durationSeconds * (w.length / total);
    const item = { word: w, start: t, end: t + d };
    t += d + (/[,.!?]$/.test(w) ? 0.12 : 0);
    return item;
  });
}
