import { createHash } from 'node:crypto';
import { createWriteStream } from 'node:fs';
import { execFile } from 'node:child_process';
import { Readable, Transform } from 'node:stream';
import { promisify } from 'node:util';
import { mkdir, rename, rm, stat } from 'node:fs/promises';
import { basename, join } from 'node:path';
import { pipeline } from 'node:stream/promises';
import sharp from 'sharp';
import {
  MAX_IMAGE_BYTES,
  MAX_VIDEO_BYTES,
  allowedVideoMimes,
  storeUploadedImage,
  type AllowedVideoMime,
  type StoredVideoResult,
} from './index.js';
import { boundedMediaNumber } from './runtime-values.js';

const execFileAsync = promisify(execFile);

function normalizedMime(value?: string | null) {
  return value?.split(';')[0].trim().toLowerCase() || undefined;
}

function allowedRemoteHost(hostname: string, allowedHosts: string[]) {
  const normalized = hostname.toLowerCase();
  return allowedHosts.some(
    (host) => normalized === host.toLowerCase() || normalized.endsWith(`.${host.toLowerCase()}`),
  );
}

function safeBaseName(value: string) {
  return basename(value).replace(/[^a-zA-Z0-9._-]+/g, '_') || 'media';
}

function extensionForVideoMime(mime: AllowedVideoMime): 'mp4' | 'webm' | 'mov' {
  if (mime === 'video/webm') return 'webm';
  if (mime === 'video/quicktime') return 'mov';
  return 'mp4';
}

async function fetchAllowedRemote(urlValue: string, allowedHosts: string[], timeoutMs: number) {
  timeoutMs = boundedMediaNumber(timeoutMs, 45_000, 1000, 30 * 60_000);
  const controller = new AbortController();
  const timer = setTimeout(
    () => controller.abort(new Error(`Medienabruf nach ${timeoutMs} ms abgebrochen`)),
    timeoutMs,
  );
  let url = new URL(urlValue);
  try {
    for (let redirect = 0; redirect <= 5; redirect++) {
      if (url.protocol !== 'https:' || !allowedRemoteHost(url.hostname, allowedHosts) || url.username || url.password) {
        throw new Error(`Nicht freigegebener Medienhost: ${url.hostname}`);
      }
      const response = await fetch(url, {
        redirect: 'manual',
        signal: controller.signal,
        headers: { 'user-agent': process.env.NEWS_USER_AGENT ?? 'OpenTVStudio/1.0' },
      });
      if ([301, 302, 303, 307, 308].includes(response.status)) {
        const location = response.headers.get('location');
        await response.body?.cancel().catch(() => undefined);
        if (!location) throw new Error('Medienredirect ohne Ziel');
        url = new URL(location, url);
        continue;
      }
      if (!response.ok || !response.body) throw new Error(`Medienabruf fehlgeschlagen: HTTP ${response.status}`);
      return {
        response,
        finalUrl: url.toString(),
        finish() {
          clearTimeout(timer);
        },
        abort() {
          controller.abort();
          clearTimeout(timer);
        },
      };
    }
    throw new Error('Zu viele Medienredirects');
  } catch (error) {
    clearTimeout(timer);
    if (controller.signal.aborted) throw new Error(`Medienabruf nach ${timeoutMs} ms abgebrochen`);
    throw error;
  }
}

export async function downloadRemoteImageSecure(input: {
  url: string;
  allowedHosts: string[];
  directory: string;
  filename: string;
  declaredMime?: string;
  maxBytes?: number;
  timeoutMs?: number;
}) {
  const remote = await fetchAllowedRemote(
    input.url,
    input.allowedHosts,
    boundedMediaNumber(input.timeoutMs, 45_000, 1000, 30 * 60_000),
  );
  try {
    const declared = normalizedMime(remote.response.headers.get('content-type') ?? input.declaredMime);
    if (!declared?.startsWith('image/')) throw new Error(`Remote-Datei ist kein Bild (${declared ?? 'unbekannt'})`);
    const stored = await storeUploadedImage({
      stream: Readable.fromWeb(remote.response.body as any),
      filename: safeBaseName(input.filename),
      declaredMime: declared,
      directory: input.directory,
      maxBytes: boundedMediaNumber(input.maxBytes, MAX_IMAGE_BYTES, 1, MAX_IMAGE_BYTES),
    });
    return { ...stored, finalUrl: remote.finalUrl };
  } catch (error) {
    remote.abort();
    throw error;
  } finally {
    remote.finish();
  }
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
  if (!Number.isFinite(durationSeconds) || durationSeconds <= 0)
    throw new Error('Videodauer konnte nicht ermittelt werden');
  if (!Number.isInteger(width) || !Number.isInteger(height) || width < 640 || height < 360) {
    throw new Error('Videoauflösung ist kleiner als 640×360 oder ungültig');
  }
  return { durationSeconds, width, height };
}

export async function downloadRemoteVideoSecure(input: {
  url: string;
  allowedHosts: string[];
  directory: string;
  filename: string;
  declaredMime?: string;
  maxBytes?: number;
  maxDurationSeconds?: number;
  timeoutMs?: number;
  ffprobeExecutable?: string;
  ffmpegExecutable?: string;
}): Promise<StoredVideoResult & { finalUrl: string }> {
  await mkdir(input.directory, { recursive: true });
  const remote = await fetchAllowedRemote(
    input.url,
    input.allowedHosts,
    boundedMediaNumber(input.timeoutMs, 120_000, 1000, 30 * 60_000),
  );
  const declared = normalizedMime(remote.response.headers.get('content-type') ?? input.declaredMime);
  if (!declared || !allowedVideoMimes.includes(declared as AllowedVideoMime)) {
    remote.abort();
    throw new Error(`Nicht unterstützter Video-MIME-Typ: ${declared ?? 'unbekannt'}`);
  }
  const mime = declared as AllowedVideoMime;
  const maxBytes = boundedMediaNumber(input.maxBytes, MAX_VIDEO_BYTES, 1, 2 * 1024 * 1024 * 1024);
  const contentLength = Number(remote.response.headers.get('content-length'));
  if (Number.isFinite(contentLength) && contentLength > maxBytes) {
    remote.abort();
    throw new Error('Remote-Video ist zu groß');
  }
  const extension = extensionForVideoMime(mime);
  const tempPath = join(input.directory, `.remote-video-${process.pid}-${Date.now()}.${extension}`);
  let originalPath: string | null = null;
  let thumbPath: string | null = null;
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
    await pipeline(Readable.fromWeb(remote.response.body as any), limited, createWriteStream(tempPath));
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
      finalUrl: remote.finalUrl,
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
    remote.abort();
    await rm(tempPath, { force: true });
    if (originalPath) await rm(originalPath, { force: true });
    if (thumbPath) await rm(thumbPath, { force: true });
    throw error;
  } finally {
    remote.finish();
  }
}

function escapeXml(value: string) {
  return value.replace(
    /[<>&"']/g,
    (character) =>
      ({
        '<': '&lt;',
        '>': '&gt;',
        '&': '&amp;',
        '"': '&quot;',
        "'": '&apos;',
      })[character]!,
  );
}

function wrapText(value: string, maximum = 42, maximumLines = 6) {
  const words = value.replace(/\s+/g, ' ').trim().split(' ').filter(Boolean);
  const lines: string[] = [];
  let line = '';
  for (const word of words) {
    const next = line ? `${line} ${word}` : word;
    if (next.length > maximum && line) {
      lines.push(line);
      line = word;
      if (lines.length >= maximumLines) break;
    } else {
      line = next;
    }
  }
  if (line && lines.length < maximumLines) lines.push(line);
  if (words.join(' ').length > lines.join(' ').length && lines.length) {
    lines[lines.length - 1] = `${lines[lines.length - 1].replace(/[.…]+$/, '')}…`;
  }
  return lines;
}

export async function createStatisticGraphic(input: {
  statement: string;
  title?: string;
  sourceLabel?: string;
  directory: string;
  filename?: string;
}) {
  const lines = wrapText(input.statement, 42, 6);
  const title = escapeXml((input.title ?? 'ZAHLEN & FAKTEN').slice(0, 80));
  const source = escapeXml((input.sourceLabel ?? 'Quelle: redaktionell geprüfter Beitrag').slice(0, 140));
  const text = lines
    .map(
      (line, index) =>
        `<text x="96" y="${250 + index * 72}" font-size="54" font-weight="700" fill="#ffffff">${escapeXml(line)}</text>`,
    )
    .join('');
  const svg = `
    <svg width="1280" height="720" viewBox="0 0 1280 720" xmlns="http://www.w3.org/2000/svg">
      <rect width="1280" height="720" rx="42" fill="#111318"/>
      <rect x="0" y="0" width="28" height="720" fill="#d20a2e"/>
      <text x="96" y="112" font-size="34" font-weight="900" letter-spacing="4" fill="#ff3658">${title}</text>
      ${text}
      <line x1="96" y1="625" x2="1184" y2="625" stroke="#47505d" stroke-width="2"/>
      <text x="96" y="676" font-size="24" font-weight="500" fill="#b9c0ca">${source}</text>
    </svg>`;
  const buffer = await sharp(Buffer.from(svg)).png().toBuffer();
  return storeUploadedImage({
    stream: Readable.from([buffer]),
    filename: input.filename ?? 'statistik.png',
    declaredMime: 'image/png',
    directory: input.directory,
    maxBytes: 5 * 1024 * 1024,
  });
}
