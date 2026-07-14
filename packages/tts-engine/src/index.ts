import { createHash } from 'node:crypto';
import { spawn } from 'node:child_process';
import { mkdir, rename, rm, stat } from 'node:fs/promises';
import path from 'node:path';

const DEFAULT_TTS_TIMEOUT_MS = 120_000;
const DEFAULT_PROBE_TIMEOUT_MS = 30_000;
const MAX_PROCESS_OUTPUT_BYTES = 64 * 1024;

export interface TtsOptions {
  piperExecutable?: string;
  modelPath: string;
  outputDirectory: string;
  voice?: string;
  speed?: number;
  volume?: number;
  timeoutMs?: number;
}

export interface EspeakOptions {
  outputDirectory: string;
  executable?: string;
  voice?: string;
  speed?: number;
  volume?: number;
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
  if (!opts.modelPath.trim()) throw new Error('Für Piper fehlt der Modellpfad');
  await mkdir(opts.outputDirectory, { recursive: true });
  const executable = opts.piperExecutable?.trim() || 'piper';
  const file = speechFile(
    text,
    {
      engine: 'piper',
      executable,
      modelPath: path.resolve(opts.modelPath),
      voice: opts.voice ?? null,
      speed: opts.speed ?? null,
      volume: opts.volume ?? null,
    },
    opts.outputDirectory,
  );
  const cached = await createAtomicSpeechFile(file, async (temporaryFile) => {
    await runSubprocess(executable, ['--model', opts.modelPath, '--output_file', temporaryFile], {
      stdin: text,
      timeoutMs: opts.timeoutMs,
      label: 'Piper',
    });
  });
  return { file, format: 'wav' as const, cached };
}

export async function synthesizeEspeak(text: string, opts: EspeakOptions) {
  if (!text.trim()) throw new Error('Leerer Sprechertext');
  await mkdir(opts.outputDirectory, { recursive: true });
  const voice = opts.voice?.trim() || 'de';
  const speed = normalizedInteger(opts.speed, 165, 80, 450);
  const volume = normalizedInteger(opts.volume, 100, 0, 200);
  const executable = opts.executable?.trim() || 'espeak-ng';
  const file = speechFile(text, { engine: 'espeak-ng', executable, voice, speed, volume }, opts.outputDirectory);
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
  });
  return { file, format: 'wav' as const, cached };
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
