import { createHash } from 'node:crypto';
import { createWriteStream } from 'node:fs';
import { execFile } from 'node:child_process';
import { Transform } from 'node:stream';
import { promisify } from 'node:util';
import { mkdir, rename, rm, stat } from 'node:fs/promises';
import { join } from 'node:path';
import { pipeline } from 'node:stream/promises';
import sharp from 'sharp';
import {
  MAX_VIDEO_BYTES,
  allowedVideoMimes,
  type AllowedVideoMime,
  type StoredVideoResult,
} from './index.js';

const execFileAsync = promisify(execFile);

function normalizedMime(value?: string | null) {
  return value?.split(';')[0].trim().toLowerCase() || undefined;
}

function extensionForVideoMime(mime: AllowedVideoMime): 'mp4' | 'webm' | 'mov' {
  if (mime === 'video/webm') return 'webm';
  if (mime === 'video/quicktime') return 'mov';
  return 'mp4';
}

async function inspectVideo(path: string, executable: string) {
  const { stdout } = await execFileAsync(
    executable,
    [
      '-v',
      'error',
      '-select_streams',
      'v:0',
      '-show_entries',
      'stream=width,height,codec_name:format=duration,format_name',
      '-of',
      'json',
      path,
    ],
    { timeout: 20_000, maxBuffer: 1024 * 1024 },
  );
  const document = JSON.parse(stdout);
  const stream = document.streams?.[0];
  const durationSeconds = Number(document.format?.duration);
  const width = Number(stream?.width);
  const height = Number(stream?.height);
  if (!Number.isFinite(durationSeconds) || durationSeconds <= 0) throw new Error('Videodauer konnte nicht ermittelt werden');
  if (!Number.isInteger(width) || !Number.isInteger(height) || width < 640 || height < 360) {
    throw new Error('Videoauflösung ist kleiner als 640×360 oder ungültig');
  }
  return { durationSeconds, width, height };
}

export async function storeUploadedVideo(input: {
  stream: NodeJS.ReadableStream;
  declaredMime?: string;
  directory: string;
  maxBytes?: number;
  maxDurationSeconds?: number;
  ffprobeExecutable?: string;
  ffmpegExecutable?: string;
}): Promise<StoredVideoResult> {
  const declared = normalizedMime(input.declaredMime);
  if (!declared || !allowedVideoMimes.includes(declared as AllowedVideoMime)) {
    throw new Error(`Nicht unterstützter Video-MIME-Typ: ${declared ?? 'unbekannt'}`);
  }
  const mime = declared as AllowedVideoMime;
  const extension = extensionForVideoMime(mime);
  const maxBytes = input.maxBytes ?? MAX_VIDEO_BYTES;
  await mkdir(input.directory, { recursive: true });
  const tempPath = join(input.directory, `.upload-video-${process.pid}-${Date.now()}.${extension}`);
  const hash = createHash('sha256');
  let size = 0;
  const limited = new Transform({
    transform(chunk, _encoding, callback) {
      const buffer = Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk);
      size += buffer.length;
      if (size > maxBytes) return callback(new Error('Video-Upload ist zu groß'));
      hash.update(buffer);
      callback(null, buffer);
    },
  });
  let originalPath: string | null = null;
  let thumbPath: string | null = null;
  try {
    await pipeline(input.stream, limited, createWriteStream(tempPath));
    if (!size) throw new Error('Leere Videodatei');
    const video = await inspectVideo(tempPath, input.ffprobeExecutable ?? process.env.FFPROBE_EXECUTABLE ?? 'ffprobe');
    const durationLimit = input.maxDurationSeconds ?? Number(process.env.MEDIA_MAX_VIDEO_DURATION_SECONDS ?? 180);
    if (video.durationSeconds > durationLimit) {
      throw new Error(`Video ist mit ${Math.round(video.durationSeconds)} Sekunden zu lang`);
    }
    const sha256 = hash.digest('hex');
    originalPath = join(input.directory, `${sha256}.${extension}`);
    await rename(tempPath, originalPath).catch(async () => {
      await rm(originalPath!, { force: true });
      await rename(tempPath, originalPath!);
    });
    thumbPath = join(input.directory, `${sha256}.thumb.webp`);
    await execFileAsync(
      input.ffmpegExecutable ?? process.env.FFMPEG_EXECUTABLE ?? 'ffmpeg',
      [
        '-y',
        '-ss',
        String(Math.min(1, video.durationSeconds / 3)),
        '-i',
        originalPath,
        '-frames:v',
        '1',
        '-vf',
        'scale=640:-2',
        thumbPath,
      ],
      { timeout: 30_000, maxBuffer: 2 * 1024 * 1024 },
    );
    const thumbMeta = await sharp(thumbPath).metadata();
    const thumbStat = await stat(thumbPath);
    return {
      mime,
      size,
      sha256,
      width: video.width,
      height: video.height,
      durationSeconds: video.durationSeconds,
      extension,
      originalPath,
      derivatives: [
        {
          label: 'thumb',
          width: thumbMeta.width ?? 640,
          height: thumbMeta.height ?? 360,
          path: thumbPath,
          mime: 'image/webp',
          sizeBytes: thumbStat.size,
        },
      ],
    };
  } catch (error) {
    await rm(tempPath, { force: true });
    if (originalPath) await rm(originalPath, { force: true });
    if (thumbPath) await rm(thumbPath, { force: true });
    throw error;
  }
}
