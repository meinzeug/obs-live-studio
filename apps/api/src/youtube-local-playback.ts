import { spawn } from 'node:child_process';
import { createHash } from 'node:crypto';
import { access } from 'node:fs/promises';
import { isAbsolute, join, resolve } from 'node:path';

export type YoutubeLocalPlaybackResolution = {
  videoId: string;
  title: string;
  url: string;
  protocol: string;
  isLive: boolean;
  resolvedAt: string;
  expiresAt: string;
};

type ResolverEnvironment = {
  YTDLP_EXECUTABLE?: string;
  YTDLP_COOKIES_FROM_BROWSER?: string;
  YTDLP_POT_PROVIDER_HOME?: string;
};

type ResolveOptions = {
  projectRoot: string;
  environment?: ResolverEnvironment;
  nodeExecutable?: string;
  forceRefresh?: boolean;
  timeoutMs?: number;
};

const resolutionCache = new Map<string, YoutubeLocalPlaybackResolution>();
const pendingResolutions = new Map<string, Promise<YoutubeLocalPlaybackResolution>>();
const proxyTargets = new Map<string, { videoId: string; url: string; expiresAt: number }>();

function validVideoId(value: string) {
  if (!/^[a-zA-Z0-9_-]{6,20}$/.test(value)) throw new Error('Ungültige YouTube-Video-ID.');
  return value;
}

function validatedMediaUrl(value: string) {
  const url = new URL(value);
  const host = url.hostname.toLowerCase();
  if (
    url.protocol !== 'https:' ||
    (!host.endsWith('.googlevideo.com') && host !== 'googlevideo.com' && !host.endsWith('.youtube.com'))
  ) {
    throw new Error('yt-dlp hat eine unerwartete Medienadresse geliefert.');
  }
  return url;
}

function signedUrlExpiry(url: URL, now = Date.now()) {
  const value = Number(/\/expire\/(\d+)(?:\/|$)/.exec(url.pathname)?.[1] ?? url.searchParams.get('expire') ?? 0) * 1000;
  return Number.isFinite(value) && value > now + 60_000 ? value : now + 60 * 60_000;
}

function absoluteFromProject(projectRoot: string, value: string) {
  return isAbsolute(value) ? value : resolve(projectRoot, value);
}

async function executablePath(projectRoot: string, environment: ResolverEnvironment) {
  const configured = environment.YTDLP_EXECUTABLE?.trim();
  const candidates = [
    configured ? absoluteFromProject(projectRoot, configured) : null,
    join(projectRoot, 'var/youtube-tools-venv/bin/yt-dlp'),
    join(projectRoot, 'var/yt-dlp/bin/yt-dlp'),
  ].filter((candidate): candidate is string => Boolean(candidate));
  for (const candidate of candidates) {
    try {
      await access(candidate);
      return candidate;
    } catch {
      // Nächsten lokalen Installationsort prüfen.
    }
  }
  throw new Error('Der lokale yt-dlp-Dienst ist nicht installiert.');
}

export function youtubeLocalPlaybackArguments(
  videoIdValue: string,
  options: {
    projectRoot: string;
    environment?: ResolverEnvironment;
    nodeExecutable?: string;
    providerAvailable?: boolean;
  },
) {
  const videoId = validVideoId(videoIdValue);
  const environment = options.environment ?? process.env;
  const providerHome = absoluteFromProject(
    options.projectRoot,
    environment.YTDLP_POT_PROVIDER_HOME?.trim() || 'var/bgutil-ytdlp-pot-provider/server',
  );
  const args = [
    '--ignore-config',
    '--no-warnings',
    '--no-playlist',
    '--skip-download',
    '--socket-timeout',
    '15',
    '--retries',
    '3',
    '--fragment-retries',
    '3',
    '--js-runtimes',
    `node:${options.nodeExecutable ?? process.execPath}`,
  ];
  const browserCookies = environment.YTDLP_COOKIES_FROM_BROWSER?.trim();
  if (browserCookies) args.push('--cookies-from-browser', browserCookies);
  if (options.providerAvailable !== false) {
    args.push(
      '--extractor-args',
      `youtubepot-bgutilscript:server_home=${providerHome}`,
      '--extractor-args',
      'youtube:fetch_pot=always',
    );
  }
  args.push(
    '-f',
    'best[height<=1080]/best',
    '--print',
    '{"protocol":%(protocol)j,"isLive":%(is_live)j,"title":%(title)j,"url":%(url)j}',
    `https://www.youtube.com/watch?v=${encodeURIComponent(videoId)}`,
  );
  return args;
}

export function parseYoutubeLocalPlaybackOutput(videoIdValue: string, output: string, now = Date.now()) {
  const videoId = validVideoId(videoIdValue);
  const line = output
    .split(/\r?\n/)
    .map((entry) => entry.trim())
    .find(Boolean);
  if (!line) throw new Error('yt-dlp hat keine abspielbare Medienadresse geliefert.');
  const parsed = JSON.parse(line) as { protocol?: unknown; isLive?: unknown; title?: unknown; url?: unknown };
  const url = validatedMediaUrl(String(parsed.url ?? ''));
  const signedExpiry = signedUrlExpiry(url, now);
  const maximumCacheMs = parsed.isLive === true ? 10 * 60_000 : 30 * 60_000;
  const expiresAt = Number.isFinite(signedExpiry) && signedExpiry > now + 60_000
    ? Math.min(signedExpiry - 120_000, now + maximumCacheMs)
    : now + maximumCacheMs;
  return {
    videoId,
    title: String(parsed.title ?? '').trim() || `YouTube ${videoId}`,
    url: url.toString(),
    protocol: String(parsed.protocol ?? '').trim().toLowerCase() || 'https',
    isLive: parsed.isLive === true,
    resolvedAt: new Date(now).toISOString(),
    expiresAt: new Date(expiresAt).toISOString(),
  } satisfies YoutubeLocalPlaybackResolution;
}

export function registerYoutubePlaybackProxyTarget(videoIdValue: string, targetValue: string, now = Date.now()) {
  const videoId = validVideoId(videoIdValue);
  const target = validatedMediaUrl(targetValue);
  const token = createHash('sha256').update(`${videoId}\0${target.toString()}`).digest('base64url').slice(0, 32);
  proxyTargets.set(token, {
    videoId,
    url: target.toString(),
    expiresAt: Math.min(signedUrlExpiry(target, now), now + 60 * 60_000),
  });
  return `/live/youtube/${encodeURIComponent(videoId)}/proxy/${token}`;
}

export function getYoutubePlaybackProxyTarget(videoIdValue: string, tokenValue: string, now = Date.now()) {
  const videoId = validVideoId(videoIdValue);
  if (!/^[a-zA-Z0-9_-]{20,64}$/.test(tokenValue)) throw new Error('Ungültiger Wiedergabe-Token.');
  const target = proxyTargets.get(tokenValue);
  if (!target || target.videoId !== videoId || target.expiresAt <= now) {
    proxyTargets.delete(tokenValue);
    throw new Error('Der Wiedergabe-Token ist abgelaufen.');
  }
  return target.url;
}

export function rewriteYoutubeHlsManifest(videoIdValue: string, manifest: string, manifestUrl: string) {
  const videoId = validVideoId(videoIdValue);
  const base = validatedMediaUrl(manifestUrl);
  const proxied = (value: string) => {
    const absolute = new URL(value, base);
    return registerYoutubePlaybackProxyTarget(videoId, absolute.toString());
  };
  return manifest
    .split(/\r?\n/)
    .map((line) => {
      if (!line) return line;
      if (!line.startsWith('#')) return proxied(line.trim());
      return line.replaceAll(/URI="([^"]+)"/g, (_match, uri: string) => `URI="${proxied(uri)}"`);
    })
    .join('\n');
}

export async function readYoutubeHlsManifest(response: Response, maximumBytes: number) {
  const safeMaximum = Math.max(1, Math.floor(maximumBytes));
  const declaredLength = Number(response.headers.get('content-length') ?? 0);
  if (Number.isFinite(declaredLength) && declaredLength > safeMaximum) {
    throw new Error(`YouTube-HLS-Manifest überschreitet das Größenlimit von ${safeMaximum} Bytes.`);
  }
  if (!response.body) throw new Error('YouTube-HLS-Manifest enthält keine Daten.');
  const reader = response.body.getReader();
  const decoder = new TextDecoder();
  let bytes = 0;
  let manifest = '';
  try {
    while (true) {
      const { done, value } = await reader.read();
      if (done) break;
      bytes += value.byteLength;
      if (bytes > safeMaximum) {
        await reader.cancel();
        throw new Error(`YouTube-HLS-Manifest überschreitet das Größenlimit von ${safeMaximum} Bytes.`);
      }
      manifest += decoder.decode(value, { stream: true });
    }
    manifest += decoder.decode();
    return manifest;
  } finally {
    reader.releaseLock();
  }
}

function resolverError(stderr: string) {
  const compact = stderr.replaceAll(/\s+/g, ' ').trim();
  if (/sign in to confirm|not a bot/i.test(compact)) {
    return new Error(
      'YouTube verlangt eine Anmeldung. Das konfigurierte lokale Browser-Cookieprofil konnte den Abruf nicht freigeben.',
    );
  }
  if (/no video formats|requested format is not available/i.test(compact)) {
    return new Error('YouTube hat für diese Quelle derzeit keinen abspielbaren Stream bereitgestellt.');
  }
  return new Error(compact ? `YouTube konnte lokal nicht aufgelöst werden: ${compact.slice(0, 500)}` : 'yt-dlp ist fehlgeschlagen.');
}

async function runResolver(
  executable: string,
  args: string[],
  videoId: string,
  timeoutMs: number,
): Promise<YoutubeLocalPlaybackResolution> {
  return new Promise((resolvePromise, reject) => {
    const child = spawn(executable, args, { stdio: ['ignore', 'pipe', 'pipe'] });
    let stdout = '';
    let stderr = '';
    let settled = false;
    const finish = (error?: Error, result?: YoutubeLocalPlaybackResolution) => {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      if (error) reject(error);
      else resolvePromise(result!);
    };
    const timer = setTimeout(() => {
      child.kill('SIGKILL');
      finish(new Error('Der lokale YouTube-Abruf hat das Zeitlimit überschritten.'));
    }, timeoutMs);
    child.stdout.on('data', (chunk) => {
      stdout = `${stdout}${String(chunk)}`.slice(-256_000);
    });
    child.stderr.on('data', (chunk) => {
      stderr = `${stderr}${String(chunk)}`.slice(-16_000);
    });
    child.once('error', (error) => finish(error));
    child.once('close', (code) => {
      if (code !== 0) {
        finish(resolverError(stderr));
        return;
      }
      try {
        finish(undefined, parseYoutubeLocalPlaybackOutput(videoId, stdout));
      } catch (error) {
        finish(error instanceof Error ? error : new Error(String(error)));
      }
    });
  });
}

export async function resolveYoutubeLocalPlayback(videoIdValue: string, options: ResolveOptions) {
  const videoId = validVideoId(videoIdValue);
  const now = Date.now();
  const cached = resolutionCache.get(videoId);
  if (!options.forceRefresh && cached && new Date(cached.expiresAt).getTime() > now + 15_000) return cached;
  const pending = pendingResolutions.get(videoId);
  if (pending && !options.forceRefresh) return pending;
  const resolution = (async () => {
    const environment = options.environment ?? process.env;
    const executable = await executablePath(options.projectRoot, environment);
    const providerHome = absoluteFromProject(
      options.projectRoot,
      environment.YTDLP_POT_PROVIDER_HOME?.trim() || 'var/bgutil-ytdlp-pot-provider/server',
    );
    let providerAvailable = true;
    try {
      await access(join(providerHome, 'build/generate_once.js'));
    } catch {
      providerAvailable = false;
    }
    const result = await runResolver(
      executable,
      youtubeLocalPlaybackArguments(videoId, {
        projectRoot: options.projectRoot,
        environment,
        nodeExecutable: options.nodeExecutable,
        providerAvailable,
      }),
      videoId,
      options.timeoutMs ?? 45_000,
    );
    resolutionCache.set(videoId, result);
    return result;
  })();
  pendingResolutions.set(videoId, resolution);
  try {
    return await resolution;
  } finally {
    if (pendingResolutions.get(videoId) === resolution) pendingResolutions.delete(videoId);
  }
}

export function clearYoutubeLocalPlaybackCache(videoId?: string) {
  if (videoId) resolutionCache.delete(validVideoId(videoId));
  else resolutionCache.clear();
}
