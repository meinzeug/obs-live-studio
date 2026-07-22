import { createHash } from 'node:crypto';
import { execFile } from 'node:child_process';
import { createWriteStream } from 'node:fs';
import { mkdir, rename, rm } from 'node:fs/promises';
import { join } from 'node:path';
import { Transform } from 'node:stream';
import { pipeline } from 'node:stream/promises';
import { promisify } from 'node:util';

const execFileAsync = promisify(execFile);
const allowedAudioMimes = [
  'audio/mpeg',
  'audio/mp4',
  'audio/x-m4a',
  'audio/wav',
  'audio/x-wav',
  'audio/ogg',
  'audio/webm',
] as const;

type AllowedAudioMime = (typeof allowedAudioMimes)[number];

function normalizedMime(value?: string | null) {
  return value?.split(';')[0].trim().toLowerCase() || undefined;
}

function extensionForMime(mime: AllowedAudioMime) {
  if (mime === 'audio/mpeg') return 'mp3';
  if (mime === 'audio/mp4' || mime === 'audio/x-m4a') return 'm4a';
  if (mime === 'audio/wav' || mime === 'audio/x-wav') return 'wav';
  if (mime === 'audio/ogg') return 'ogg';
  return 'webm';
}

async function inspectAudio(path: string, executable: string) {
  const { stdout } = await execFileAsync(
    executable,
    [
      '-v',
      'error',
      '-select_streams',
      'a:0',
      '-show_entries',
      'stream=codec_name,sample_rate,channels:format=duration,format_name',
      '-of',
      'json',
      path,
    ],
    { timeout: 20_000, maxBuffer: 1024 * 1024 },
  );
  const document = JSON.parse(stdout) as {
    streams?: Array<{ codec_name?: string; sample_rate?: string; channels?: number }>;
    format?: { duration?: string; format_name?: string };
  };
  const stream = document.streams?.[0];
  const durationSeconds = Number(document.format?.duration);
  if (!stream || !Number.isFinite(durationSeconds) || durationSeconds <= 0)
    throw new Error('Die Datei enthält keine gültige Audiospur.');
  return {
    durationSeconds,
    codec: stream.codec_name || 'unknown',
    sampleRate: Number(stream.sample_rate) || null,
    channels: Number(stream.channels) || null,
    format: document.format?.format_name || null,
  };
}

export async function storeUploadedAudio(input: {
  stream: NodeJS.ReadableStream;
  declaredMime?: string;
  directory: string;
  maxBytes?: number;
  maxDurationSeconds?: number;
  ffprobeExecutable?: string;
}) {
  const declared = normalizedMime(input.declaredMime);
  if (!declared || !allowedAudioMimes.includes(declared as AllowedAudioMime))
    throw new Error(`Nicht unterstützter Audio-MIME-Typ: ${declared ?? 'unbekannt'}`);
  const mime = declared as AllowedAudioMime;
  const extension = extensionForMime(mime);
  const maximumBytes = Math.max(1, Math.min(2 * 1024 * 1024 * 1024, input.maxBytes ?? 250 * 1024 * 1024));
  const maximumDuration = Math.max(1, Math.min(21_600, input.maxDurationSeconds ?? 21_600));
  await mkdir(input.directory, { recursive: true });
  const temporaryPath = join(input.directory, `.upload-audio-${process.pid}-${Date.now()}.${extension}`);
  const hash = createHash('sha256');
  let size = 0;
  const limited = new Transform({
    transform(chunk, _encoding, callback) {
      const buffer = Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk);
      size += buffer.length;
      if (size > maximumBytes) return callback(new Error('Audio-Upload ist zu groß.'));
      hash.update(buffer);
      callback(null, buffer);
    },
  });
  let outputPath: string | null = null;
  try {
    await pipeline(input.stream, limited, createWriteStream(temporaryPath));
    if (!size) throw new Error('Leere Audiodatei.');
    const audio = await inspectAudio(
      temporaryPath,
      input.ffprobeExecutable ?? process.env.FFPROBE_EXECUTABLE ?? 'ffprobe',
    );
    if (audio.durationSeconds > maximumDuration)
      throw new Error(`Die Audiodatei ist mit ${Math.round(audio.durationSeconds)} Sekunden zu lang.`);
    const sha256 = hash.digest('hex');
    outputPath = join(input.directory, `${sha256}.${extension}`);
    await rename(temporaryPath, outputPath).catch(async () => {
      await rm(outputPath!, { force: true });
      await rename(temporaryPath, outputPath!);
    });
    return { mime, extension, size, sha256, originalPath: outputPath, ...audio };
  } catch (error) {
    await rm(temporaryPath, { force: true });
    if (outputPath) await rm(outputPath, { force: true });
    throw error;
  }
}

export { allowedAudioMimes };
