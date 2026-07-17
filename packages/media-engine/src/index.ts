import { createHash } from 'node:crypto';
import { createWriteStream } from 'node:fs';
import { execFile } from 'node:child_process';
import { Readable, Transform } from 'node:stream';
import { promisify } from 'node:util';
import { mkdir, readFile, rename, rm, stat } from 'node:fs/promises';
import { basename, extname, join } from 'node:path';
import { pipeline } from 'node:stream/promises';
import sharp, { type Metadata } from 'sharp';
import { boundedMediaNumber } from './runtime-values.js';

const execFileAsync = promisify(execFile);
export const MAX_IMAGE_BYTES = 15 * 1024 * 1024;
export const MAX_VIDEO_BYTES = 250 * 1024 * 1024;
export const allowedImageMimes = ['image/png', 'image/jpeg', 'image/webp'] as const;
export const allowedVideoMimes = ['video/mp4', 'video/webm', 'video/quicktime'] as const;
export type AllowedImageMime = (typeof allowedImageMimes)[number];
export type AllowedVideoMime = (typeof allowedVideoMimes)[number];

export interface MediaInspection {
  mime: AllowedImageMime;
  size: number;
  sha256: string;
  width: number;
  height: number;
  extension: string;
  format: 'png' | 'jpeg' | 'webp';
}

export interface StoredImageDerivative {
  label: 'thumb' | 'preview';
  width: number;
  height: number;
  path: string;
  mime: 'image/webp';
  sizeBytes: number;
}

export interface StoredImageResult extends MediaInspection {
  originalPath: string;
  derivatives: StoredImageDerivative[];
}

export interface StoredVideoResult {
  mime: AllowedVideoMime;
  size: number;
  sha256: string;
  width: number;
  height: number;
  durationSeconds: number;
  extension: 'mp4' | 'webm' | 'mov';
  originalPath: string;
  derivatives: Array<{
    label: 'thumb';
    width: number;
    height: number;
    path: string;
    mime: 'image/webp';
    sizeBytes: number;
  }>;
}

const mimeByFormat: Record<string, AllowedImageMime | undefined> = {
  png: 'image/png',
  jpeg: 'image/jpeg',
  webp: 'image/webp',
};

function extensionForMime(mime: AllowedImageMime) {
  return mime === 'image/jpeg' ? 'jpg' : mime.replace('image/', '');
}

function videoExtensionForMime(mime: AllowedVideoMime) {
  if (mime === 'video/webm') return 'webm';
  if (mime === 'video/quicktime') return 'mov';
  return 'mp4';
}

function normalizeDeclaredMime(declared?: string) {
  if (!declared) return undefined;
  return declared.split(';')[0].trim().toLowerCase();
}

function rejectSvg(filename?: string, declared?: string) {
  const nameExt = filename ? extname(filename).toLowerCase() : '';
  const mime = normalizeDeclaredMime(declared);
  if (nameExt === '.svg' || nameExt === '.svgz' || mime === 'image/svg+xml') {
    throw new Error('SVG-Uploads sind deaktiviert, bis ein belastbarer Sanitizer verfügbar ist');
  }
}

export async function inspectImage(buffer: Buffer, declared?: string, filename?: string): Promise<MediaInspection> {
  rejectSvg(filename, declared);
  if (buffer.length === 0) throw new Error('Leere Datei');
  if (buffer.length > MAX_IMAGE_BYTES) throw new Error('Datei ist zu groß');

  let metadata: Metadata;
  try {
    metadata = await sharp(buffer, { failOn: 'error', limitInputPixels: 60_000_000 }).metadata();
  } catch {
    throw new Error('Nicht unterstützter oder beschädigter Bildinhalt');
  }

  const mime = metadata.format ? mimeByFormat[metadata.format] : undefined;
  if (!mime || !allowedImageMimes.includes(mime)) {
    throw new Error('Nur PNG, JPEG und WebP werden unterstützt');
  }

  const normalizedDeclared = normalizeDeclaredMime(declared);
  if (normalizedDeclared && normalizedDeclared !== mime) {
    throw new Error(`MIME-Typ passt nicht zum Dateiinhalt (${normalizedDeclared} != ${mime})`);
  }

  if (!metadata.width || !metadata.height) {
    throw new Error('Bildabmessungen konnten nicht ermittelt werden');
  }

  return {
    mime,
    size: buffer.length,
    sha256: createHash('sha256').update(buffer).digest('hex'),
    width: metadata.width,
    height: metadata.height,
    extension: extensionForMime(mime),
    format: metadata.format as 'png' | 'jpeg' | 'webp',
  };
}

export async function storeUploadedImage(input: {
  stream: NodeJS.ReadableStream;
  filename: string;
  declaredMime?: string;
  directory: string;
  maxBytes?: number;
}): Promise<StoredImageResult> {
  rejectSvg(input.filename, input.declaredMime);
  const maxBytes = boundedMediaNumber(input.maxBytes, MAX_IMAGE_BYTES, 1, MAX_IMAGE_BYTES);
  await mkdir(input.directory, { recursive: true });

  const safeBase = basename(input.filename).replace(/[^a-zA-Z0-9._-]+/g, '_') || 'upload';
  const tempPath = join(input.directory, `.upload-${process.pid}-${Date.now()}-${safeBase}`);
  let size = 0;
  const hash = createHash('sha256');

  const limited = new Transform({
    transform(chunk, _encoding, callback) {
      const buffer = Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk);
      size += buffer.length;
      if (size > maxBytes) {
        callback(new Error('Datei ist zu groß'));
        return;
      }
      hash.update(buffer);
      callback(null, buffer);
    },
  });

  try {
    await pipeline(input.stream, limited, createWriteStream(tempPath));
    const info = await inspectImage(await readFile(tempPath), input.declaredMime, input.filename);
    const sha256 = hash.digest('hex');
    const originalPath = join(input.directory, `${sha256}.${info.extension}`);
    await rename(tempPath, originalPath).catch(async () => {
      await rm(originalPath, { force: true });
      await rename(tempPath, originalPath);
    });
    const derivatives = await createDerivatives(originalPath, input.directory, sha256);
    return { ...info, sha256, size, originalPath, derivatives };
  } catch (error) {
    await rm(tempPath, { force: true });
    throw error;
  }
}

async function createDerivatives(
  originalPath: string,
  directory: string,
  sha256: string,
): Promise<StoredImageDerivative[]> {
  const specs = [
    { label: 'thumb' as const, width: 320 },
    { label: 'preview' as const, width: 960 },
  ];
  const results: StoredImageDerivative[] = [];
  for (const spec of specs) {
    const out = join(directory, `${sha256}.${spec.label}.webp`);
    const meta = await sharp(originalPath)
      .resize({ width: spec.width, withoutEnlargement: true })
      .webp({ quality: 82 })
      .toFile(out);
    results.push({
      label: spec.label,
      width: meta.width,
      height: meta.height,
      path: out,
      mime: 'image/webp',
      sizeBytes: meta.size,
    });
  }
  return results;
}

function allowedRemoteHost(hostname: string, allowedHosts: string[]) {
  const normalized = hostname.toLowerCase();
  return allowedHosts.some(
    (host) => normalized === host.toLowerCase() || normalized.endsWith(`.${host.toLowerCase()}`),
  );
}

async function fetchAllowedRemote(urlValue: string, allowedHosts: string[], timeoutMs = 30_000) {
  let url = new URL(urlValue);
  for (let redirect = 0; redirect <= 5; redirect++) {
    if (url.protocol !== 'https:' || !allowedRemoteHost(url.hostname, allowedHosts) || url.username || url.password) {
      throw new Error(`Nicht freigegebener Medienhost: ${url.hostname}`);
    }
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), timeoutMs);
    try {
      const response = await fetch(url, {
        redirect: 'manual',
        signal: controller.signal,
        headers: { 'user-agent': process.env.NEWS_USER_AGENT ?? 'OpenTVStudio/1.0' },
      });
      if ([301, 302, 303, 307, 308].includes(response.status)) {
        const location = response.headers.get('location');
        if (!location) throw new Error('Medienredirect ohne Ziel');
        url = new URL(location, url);
        continue;
      }
      if (!response.ok || !response.body) throw new Error(`Medienabruf fehlgeschlagen: HTTP ${response.status}`);
      return { response, finalUrl: url.toString() };
    } finally {
      clearTimeout(timer);
    }
  }
  throw new Error('Zu viele Medienredirects');
}

export async function downloadRemoteImage(input: {
  url: string;
  allowedHosts: string[];
  directory: string;
  filename: string;
  declaredMime?: string;
}) {
  const { response, finalUrl } = await fetchAllowedRemote(input.url, input.allowedHosts);
  const declared = normalizeDeclaredMime(response.headers.get('content-type') ?? input.declaredMime);
  if (!declared?.startsWith('image/')) throw new Error(`Remote-Datei ist kein Bild (${declared ?? 'unbekannt'})`);
  const stored = await storeUploadedImage({
    stream: Readable.fromWeb(response.body as any),
    filename: input.filename,
    declaredMime: declared,
    directory: input.directory,
  });
  return { ...stored, finalUrl };
}

async function inspectVideo(path: string, ffprobeExecutable: string) {
  const { stdout } = await execFileAsync(
    ffprobeExecutable,
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
  if (!Number.isFinite(durationSeconds) || durationSeconds <= 0)
    throw new Error('Videodauer konnte nicht ermittelt werden');
  if (!Number.isInteger(width) || !Number.isInteger(height) || width < 640 || height < 360) {
    throw new Error('Videoauflösung ist kleiner als 640×360 oder ungültig');
  }
  return { durationSeconds, width, height, codec: String(stream?.codec_name ?? '') };
}

export async function downloadRemoteVideo(input: {
  url: string;
  allowedHosts: string[];
  directory: string;
  filename: string;
  declaredMime?: string;
  maxBytes?: number;
  maxDurationSeconds?: number;
  ffprobeExecutable?: string;
  ffmpegExecutable?: string;
}): Promise<StoredVideoResult & { finalUrl: string }> {
  await mkdir(input.directory, { recursive: true });
  const { response, finalUrl } = await fetchAllowedRemote(input.url, input.allowedHosts, 60_000);
  const declared = normalizeDeclaredMime(response.headers.get('content-type') ?? input.declaredMime);
  if (!declared || !allowedVideoMimes.includes(declared as AllowedVideoMime)) {
    throw new Error(`Nicht unterstützter Video-MIME-Typ: ${declared ?? 'unbekannt'}`);
  }
  const mime = declared as AllowedVideoMime;
  const maxBytes = boundedMediaNumber(input.maxBytes, MAX_VIDEO_BYTES, 1, 2 * 1024 * 1024 * 1024);
  const contentLength = Number(response.headers.get('content-length'));
  if (Number.isFinite(contentLength) && contentLength > maxBytes) throw new Error('Remote-Video ist zu groß');
  const extension = videoExtensionForMime(mime);
  const tempPath = join(input.directory, `.remote-video-${process.pid}-${Date.now()}.${extension}`);
  const hash = createHash('sha256');
  let size = 0;
  const limited = new Transform({
    transform(chunk, _encoding, callback) {
      const buffer = Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk);
      size += buffer.length;
      if (size > maxBytes) return callback(new Error('Remote-Video ist zu groß'));
      hash.update(buffer);
      callback(null, buffer);
    },
  });
  try {
    await pipeline(Readable.fromWeb(response.body as any), limited, createWriteStream(tempPath));
    const sha256 = hash.digest('hex');
    const video = await inspectVideo(tempPath, input.ffprobeExecutable ?? process.env.FFPROBE_EXECUTABLE ?? 'ffprobe');
    const durationLimit = boundedMediaNumber(
      input.maxDurationSeconds ?? process.env.MEDIA_MAX_VIDEO_DURATION_SECONDS,
      180,
      1,
      6 * 60 * 60,
      { integer: false },
    );
    if (video.durationSeconds > durationLimit) {
      throw new Error(`Video ist mit ${Math.round(video.durationSeconds)} Sekunden zu lang`);
    }
    const originalPath = join(input.directory, `${sha256}.${extension}`);
    await rename(tempPath, originalPath).catch(async () => {
      await rm(originalPath, { force: true });
      await rename(tempPath, originalPath);
    });
    const thumbPath = join(input.directory, `${sha256}.thumb.webp`);
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
      finalUrl,
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
    throw error;
  }
}

export function publicDerivativePath(mediaId: string, label: 'thumb' | 'preview') {
  return `/media/${encodeURIComponent(mediaId)}/derivatives/${label}`;
}

export function cacheHeaders(mime: string, isPrivate = false) {
  return {
    'content-type': mime,
    'cache-control': isPrivate ? 'private, no-store' : 'public, max-age=31536000, immutable',
    'x-content-type-options': 'nosniff',
  };
}
