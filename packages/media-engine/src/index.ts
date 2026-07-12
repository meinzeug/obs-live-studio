import { createHash } from 'node:crypto';
import { createWriteStream } from 'node:fs';
import { Transform } from 'node:stream';
import { mkdir, rm } from 'node:fs/promises';
import { basename, extname, join } from 'node:path';
import { pipeline } from 'node:stream/promises';
import sharp, { type Metadata } from 'sharp';

export const MAX_IMAGE_BYTES = 15 * 1024 * 1024;
export const allowedImageMimes = ['image/png', 'image/jpeg', 'image/webp'] as const;
export type AllowedImageMime = (typeof allowedImageMimes)[number];

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

const mimeByFormat: Record<string, AllowedImageMime | undefined> = {
  png: 'image/png',
  jpeg: 'image/jpeg',
  webp: 'image/webp',
};

function extensionForMime(mime: AllowedImageMime) {
  return mime === 'image/jpeg' ? 'jpg' : mime.replace('image/', '');
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
  const maxBytes = input.maxBytes ?? MAX_IMAGE_BYTES;
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
    const info = await inspectImage(
      await import('node:fs/promises').then((fs) => fs.readFile(tempPath)),
      input.declaredMime,
      input.filename,
    );
    const sha256 = hash.digest('hex');
    const originalPath = join(input.directory, `${sha256}.${info.extension}`);
    await import('node:fs/promises').then((fs) =>
      fs.rename(tempPath, originalPath).catch(async () => {
        await fs.rm(originalPath, { force: true });
        await fs.rename(tempPath, originalPath);
      }),
    );
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
