import { spawn } from 'node:child_process';
import { mkdir } from 'node:fs/promises';
import path from 'node:path';
import { createHash } from 'node:crypto';
export interface TtsOptions {
  piperExecutable?: string;
  modelPath: string;
  outputDirectory: string;
  voice?: string;
  speed?: number;
  volume?: number;
}
export interface EspeakOptions {
  outputDirectory: string;
  executable?: string;
  voice?: string;
  speed?: number;
  volume?: number;
}

function speechFile(text: string, identity: string, outputDirectory: string) {
  return path.resolve(
    outputDirectory,
    `${createHash('sha1')
      .update(text + identity)
      .digest('hex')}.wav`,
  );
}

export async function synthesizePiper(text: string, opts: TtsOptions) {
  await mkdir(opts.outputDirectory, { recursive: true });
  const file = speechFile(text, opts.modelPath, opts.outputDirectory);
  const exe = opts.piperExecutable ?? 'piper';
  await new Promise<void>((resolve, reject) => {
    const child = spawn(exe, ['--model', opts.modelPath, '--output_file', file], { stdio: ['pipe', 'pipe', 'pipe'] });
    let err = '';
    child.stderr.on('data', (d) => (err += d));
    child.on('close', (c) => (c === 0 ? resolve() : reject(new Error(err || `Piper beendet mit Code ${c}`))));
    child.stdin.end(text);
  });
  return { file, format: 'wav' as const };
}

export async function synthesizeEspeak(text: string, opts: EspeakOptions) {
  await mkdir(opts.outputDirectory, { recursive: true });
  const voice = opts.voice || 'de';
  const speed = Math.round(opts.speed ?? 165);
  const volume = Math.round(opts.volume ?? 100);
  const file = speechFile(text, `espeak-ng:${voice}:${speed}:${volume}`, opts.outputDirectory);
  const exe = opts.executable ?? 'espeak-ng';
  await new Promise<void>((resolve, reject) => {
    const child = spawn(exe, ['--stdin', '-v', voice, '-s', String(speed), '-a', String(volume), '-w', file], {
      stdio: ['pipe', 'ignore', 'pipe'],
    });
    let err = '';
    child.stderr.on('data', (d) => (err += d));
    child.on('error', reject);
    child.on('close', (code) =>
      code === 0 ? resolve() : reject(new Error(err || `eSpeak NG beendet mit Code ${code}`)),
    );
    child.stdin.end(text);
  });
  return { file, format: 'wav' as const };
}
export async function probeAudioDuration(
  file: string,
  ffprobeExecutable = process.env.FFPROBE_EXECUTABLE ?? 'ffprobe',
) {
  const out = await new Promise<string>((resolve, reject) => {
    const child = spawn(
      ffprobeExecutable,
      ['-v', 'error', '-show_entries', 'format=duration', '-of', 'default=noprint_wrappers=1:nokey=1', file],
      { stdio: ['ignore', 'pipe', 'pipe'] },
    );
    let stdout = '';
    let stderr = '';
    child.stdout.on('data', (d) => (stdout += d));
    child.stderr.on('data', (d) => (stderr += d));
    child.on('close', (c) =>
      c === 0 ? resolve(stdout.trim()) : reject(new Error(stderr || `ffprobe beendet mit Code ${c}`)),
    );
  });
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
