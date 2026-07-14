import { Readable } from 'node:stream';
import { assertPublicHttpUrl } from '@ans/security';

export interface ConnectorResult {
  url: string;
  contentType: string;
  body: string;
  etag?: string;
  lastModified?: string;
  status: number;
  notModified: boolean;
}

export interface FetchOptions {
  timeoutMs?: number;
  maxBytes?: number;
  etag?: string | null;
  lastModified?: string | null;
  allowPrivate?: boolean;
  allowPrivateUrl?: (url: URL) => boolean | Promise<boolean>;
  userAgent?: string;
  maxRedirects?: number;
}

export interface LocalStudioTestUrlOptions {
  appPort?: string | number;
  allowedPaths?: readonly string[];
}

export function isAllowedLocalStudioTestUrl(rawUrl: string | URL, options: LocalStudioTestUrlOptions = {}) {
  try {
    const url = rawUrl instanceof URL ? rawUrl : new URL(rawUrl);
    const hostname = url.hostname.toLowerCase().replace(/^\[|\]$/g, '');
    const allowedPaths = new Set(options.allowedPaths ?? ['/test-feed.xml']);
    return (
      url.protocol === 'http:' &&
      !url.username &&
      !url.password &&
      !url.search &&
      !url.hash &&
      ['localhost', '127.0.0.1', '::1'].includes(hostname) &&
      url.port === String(options.appPort ?? 12000) &&
      allowedPaths.has(url.pathname)
    );
  } catch {
    return false;
  }
}

export function nextFetchAt(intervalSeconds: number, from = new Date()) {
  return new Date(from.getTime() + intervalSeconds * 1000).toISOString();
}

async function privateAddressAllowed(url: URL, options: FetchOptions) {
  if (options.allowPrivate === true) return true;
  return Boolean(await options.allowPrivateUrl?.(url));
}

export async function fetchHttpText(rawUrl: string, options: FetchOptions = {}): Promise<ConnectorResult> {
  const timeoutMs = options.timeoutMs ?? 20000;
  const maxBytes = options.maxBytes ?? 1024 * 1024;
  const maxRedirects = options.maxRedirects ?? 5;
  let current = rawUrl;
  for (let redirects = 0; redirects <= maxRedirects; redirects++) {
    const currentUrl = new URL(current);
    await assertPublicHttpUrl(currentUrl.toString(), await privateAddressAllowed(currentUrl, options));
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), timeoutMs);
    try {
      const headers: Record<string, string> = {
        'user-agent': options.userAgent ?? 'AutomatedNewsStudio/1.0 (+local)',
      };
      if (options.etag) headers['if-none-match'] = options.etag;
      if (options.lastModified) headers['if-modified-since'] = options.lastModified;
      const res = await fetch(currentUrl, { redirect: 'manual', headers, signal: controller.signal });
      if ([301, 302, 303, 307, 308].includes(res.status)) {
        const location = res.headers.get('location');
        if (!location) throw new Error(`Redirect ohne Location von ${currentUrl.toString()}`);
        if (res.body) await res.body.cancel().catch(() => undefined);
        current = new URL(location, currentUrl).toString();
        continue;
      }
      if (res.status === 304) {
        return {
          url: currentUrl.toString(),
          contentType: res.headers.get('content-type') ?? '',
          body: '',
          etag: res.headers.get('etag') ?? undefined,
          lastModified: res.headers.get('last-modified') ?? undefined,
          status: 304,
          notModified: true,
        };
      }
      if (!res.ok) throw new Error(`HTTP ${res.status} beim Abruf von ${currentUrl.toString()}`);
      const len = res.headers.get('content-length');
      if (len && Number(len) > maxBytes) throw new Error(`Antwort zu groß (${len} Bytes, Limit ${maxBytes})`);
      const body = await readLimited(res.body, maxBytes);
      return {
        url: currentUrl.toString(),
        contentType: res.headers.get('content-type') ?? '',
        body,
        etag: res.headers.get('etag') ?? undefined,
        lastModified: res.headers.get('last-modified') ?? undefined,
        status: res.status,
        notModified: false,
      };
    } catch (error) {
      if ((error as Error).name === 'AbortError') {
        throw new Error(`Timeout nach ${timeoutMs} ms beim Abruf von ${currentUrl.toString()}`);
      }
      throw error;
    } finally {
      clearTimeout(timer);
    }
  }
  throw new Error(`Zu viele Redirects für ${rawUrl}`);
}

async function readLimited(body: ReadableStream<Uint8Array> | null, maxBytes: number) {
  if (!body) return '';
  let total = 0;
  const chunks: Buffer[] = [];
  const node = Readable.fromWeb(body as any);
  for await (const chunk of node) {
    const buf = Buffer.from(chunk);
    total += buf.length;
    if (total > maxBytes) throw new Error(`Antwort überschreitet Größenlimit von ${maxBytes} Bytes`);
    chunks.push(buf);
  }
  return Buffer.concat(chunks).toString('utf8');
}
