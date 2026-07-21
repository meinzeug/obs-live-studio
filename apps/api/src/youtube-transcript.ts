import { spawn } from 'node:child_process';
import { existsSync } from 'node:fs';
import { access, mkdtemp, readFile, readdir, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { dirname, isAbsolute, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

export type YoutubeTranscriptSegment = {
  startMs: number;
  durationMs: number;
  text: string;
};

export type YoutubeTranscript = {
  text: string;
  language: string;
  source: 'youtube-captions' | 'yt-dlp';
  segments: YoutubeTranscriptSegment[];
};

type CaptionTrack = {
  baseUrl?: string;
  languageCode?: string;
  kind?: string;
  name?: { simpleText?: string; runs?: Array<{ text?: string }> };
};

function cleanCaptionText(value: unknown) {
  return String(value ?? '')
    .replace(/<[^>]+>/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();
}

function boundedJsonArray(source: string, marker: string) {
  const markerIndex = source.indexOf(marker);
  if (markerIndex < 0) return null;
  const start = source.indexOf('[', markerIndex + marker.length);
  if (start < 0) return null;
  let depth = 0;
  let quoted = false;
  let escaped = false;
  for (let index = start; index < source.length; index += 1) {
    const character = source[index]!;
    if (quoted) {
      if (escaped) escaped = false;
      else if (character === '\\') escaped = true;
      else if (character === '"') quoted = false;
      continue;
    }
    if (character === '"') quoted = true;
    else if (character === '[') depth += 1;
    else if (character === ']') {
      depth -= 1;
      if (depth === 0) return source.slice(start, index + 1);
    }
  }
  return null;
}

export function youtubeCaptionTracksFromWatchPage(html: string): CaptionTrack[] {
  const encoded = boundedJsonArray(html, '"captionTracks":');
  if (!encoded) return [];
  try {
    const parsed = JSON.parse(encoded);
    return Array.isArray(parsed) ? parsed.filter((track): track is CaptionTrack => Boolean(track?.baseUrl)) : [];
  } catch {
    return [];
  }
}

function captionTrackScore(track: CaptionTrack) {
  const language = track.languageCode?.toLocaleLowerCase('de-DE') ?? '';
  const german = language === 'de' || language.startsWith('de-');
  const english = language === 'en' || language.startsWith('en-');
  const automatic = track.kind === 'asr';
  return (german ? 100 : english ? 40 : 0) + (automatic ? 0 : 20);
}

export function parseYoutubeJson3Transcript(payload: unknown): YoutubeTranscriptSegment[] {
  const events =
    payload && typeof payload === 'object' && Array.isArray((payload as any).events) ? (payload as any).events : [];
  const segments: YoutubeTranscriptSegment[] = [];
  for (const event of events) {
    const text = cleanCaptionText(
      Array.isArray(event?.segs) ? event.segs.map((segment: any) => segment?.utf8 ?? '').join('') : '',
    );
    if (!text || text === '[Musik]' || text === '[Applaus]') continue;
    const previous = segments.at(-1);
    if (previous?.text === text) continue;
    segments.push({
      startMs: Math.max(0, Math.floor(Number(event?.tStartMs) || 0)),
      durationMs: Math.max(0, Math.floor(Number(event?.dDurationMs) || 0)),
      text,
    });
  }
  return segments;
}

function transcriptText(segments: YoutubeTranscriptSegment[]) {
  return cleanCaptionText(segments.map((segment) => segment.text).join(' ')).slice(0, 250_000);
}

async function responseTextLimited(response: Response, maximumBytes: number, label: string) {
  if (!response.ok) throw new Error(`${label} HTTP ${response.status}`);
  const declared = Number(response.headers.get('content-length'));
  if (Number.isFinite(declared) && declared > maximumBytes) throw new Error(`${label} ist zu groß.`);
  const bytes = new Uint8Array(await response.arrayBuffer());
  if (bytes.byteLength > maximumBytes) throw new Error(`${label} ist zu groß.`);
  return new TextDecoder().decode(bytes);
}

async function transcriptFromYoutubePage(videoId: string, fetchImpl: typeof fetch): Promise<YoutubeTranscript> {
  const response = await fetchImpl(`https://www.youtube.com/watch?v=${encodeURIComponent(videoId)}&hl=de`, {
    headers: {
      'user-agent': process.env.NEWS_USER_AGENT || 'OpenTVStudio/1.0 (lokale TV-Redaktion)',
      accept: 'text/html,application/xhtml+xml',
      'accept-language': 'de-DE,de;q=0.9,en;q=0.7',
    },
    signal: AbortSignal.timeout(15_000),
  });
  const html = await responseTextLimited(response, 5 * 1024 * 1024, 'YouTube-Watchseite');
  const track = youtubeCaptionTracksFromWatchPage(html).sort(
    (left, right) => captionTrackScore(right) - captionTrackScore(left),
  )[0];
  if (!track?.baseUrl) throw new Error('Für dieses Video ist kein abrufbares Transkript verfügbar.');
  const captionsUrl = new URL(track.baseUrl);
  captionsUrl.searchParams.set('fmt', 'json3');
  const captionsResponse = await fetchImpl(captionsUrl, {
    headers: { 'user-agent': process.env.NEWS_USER_AGENT || 'OpenTVStudio/1.0 (lokale TV-Redaktion)' },
    signal: AbortSignal.timeout(20_000),
  });
  const document = JSON.parse(await responseTextLimited(captionsResponse, 8 * 1024 * 1024, 'YouTube-Untertitel'));
  const segments = parseYoutubeJson3Transcript(document);
  const text = transcriptText(segments);
  if (text.length < 120) throw new Error('Das verfügbare YouTube-Transkript ist leer oder zu kurz.');
  return {
    text,
    language: track.languageCode?.trim() || 'de',
    source: 'youtube-captions',
    segments,
  };
}

export function youtubeTranscriptProjectRoot() {
  const configured = process.env.PROJECT_ROOT?.trim();
  if (configured) return isAbsolute(configured) ? configured : resolve(process.cwd(), configured);
  for (const start of [dirname(fileURLToPath(import.meta.url)), process.cwd()]) {
    let candidate = start;
    for (let depth = 0; depth < 8; depth += 1) {
      if (existsSync(join(candidate, 'package.json')) && existsSync(join(candidate, 'packages/database'))) {
        return candidate;
      }
      const parent = dirname(candidate);
      if (parent === candidate) break;
      candidate = parent;
    }
  }
  return process.cwd();
}

async function availableYtDlpExecutable() {
  const configured = process.env.YTDLP_EXECUTABLE?.trim();
  const candidates = [
    configured,
    resolve(youtubeTranscriptProjectRoot(), 'var/youtube-tools-venv/bin/yt-dlp'),
    'yt-dlp',
  ].filter((candidate): candidate is string => Boolean(candidate));
  for (const candidate of candidates) {
    if (candidate === 'yt-dlp') return candidate;
    const absolute = isAbsolute(candidate) ? candidate : resolve(youtubeTranscriptProjectRoot(), candidate);
    try {
      await access(absolute);
      return absolute;
    } catch {
      // Nächsten bekannten Installationsort versuchen.
    }
  }
  return null;
}

async function runYtDlp(executable: string, args: string[], timeoutMs: number) {
  await new Promise<void>((resolvePromise, reject) => {
    const child = spawn(executable, args, { stdio: ['ignore', 'ignore', 'pipe'] });
    let stderr = '';
    const timer = setTimeout(() => {
      child.kill('SIGKILL');
      reject(new Error('yt-dlp hat das Zeitlimit für die Transkriptabfrage überschritten.'));
    }, timeoutMs);
    child.stderr.on('data', (chunk) => {
      stderr = `${stderr}${String(chunk)}`.slice(-4000);
    });
    child.once('error', (error) => {
      clearTimeout(timer);
      reject(error);
    });
    child.once('close', (code) => {
      clearTimeout(timer);
      if (code === 0) resolvePromise();
      else reject(new Error(`yt-dlp konnte keine Untertitel abrufen: ${cleanCaptionText(stderr).slice(0, 700)}`));
    });
  });
}

async function transcriptFromYtDlp(videoId: string): Promise<YoutubeTranscript> {
  const executable = await availableYtDlpExecutable();
  if (!executable) throw new Error('yt-dlp ist für den Transkript-Fallback nicht installiert.');
  const temporary = await mkdtemp(join(tmpdir(), 'open-tv-youtube-transcript-'));
  try {
    const providerHome = process.env.YTDLP_POT_PROVIDER_HOME?.trim()
      ? resolve(youtubeTranscriptProjectRoot(), process.env.YTDLP_POT_PROVIDER_HOME.trim())
      : resolve(youtubeTranscriptProjectRoot(), 'var/bgutil-ytdlp-pot-provider/server');
    const providerScript = join(providerHome, 'build/generate_once.js');
    const providerArgs: string[] = [];
    const browserCookies = process.env.YTDLP_COOKIES_FROM_BROWSER?.trim();
    const authenticationArgs = browserCookies ? ['--cookies-from-browser', browserCookies] : [];
    try {
      await access(providerScript);
      if (!browserCookies) {
        providerArgs.push(
          '--extractor-args',
          `youtubepot-bgutilscript:server_home=${providerHome}`,
          '--extractor-args',
          'youtube:fetch_pot=always',
        );
      }
    } catch {
      // Der offizielle yt-dlp-Ablauf bleibt auch ohne optionalen PO-Token-Provider nutzbar.
    }
    await runYtDlp(
      executable,
      [
        '--skip-download',
        '--no-playlist',
        '--js-runtimes',
        `node:${process.execPath}`,
        '--retries',
        '3',
        '--sleep-requests',
        '1',
        '--sleep-subtitles',
        '1',
        ...authenticationArgs,
        ...providerArgs,
        '--write-subs',
        '--write-auto-subs',
        '--sub-langs',
        'de.*,de,en.*,en',
        '--sub-format',
        'json3',
        '--output',
        join(temporary, '%(id)s.%(ext)s'),
        `https://www.youtube.com/watch?v=${encodeURIComponent(videoId)}`,
      ],
      90_000,
    );
    const files = (await readdir(temporary))
      .filter((file) => file.endsWith('.json3'))
      .sort((left, right) => {
        const german = Number(/\.de(?:[-_.]|$)/i.test(right)) - Number(/\.de(?:[-_.]|$)/i.test(left));
        const manual = Number(!/\.orig\.|\.live_chat\./i.test(right)) - Number(!/\.orig\.|\.live_chat\./i.test(left));
        return german || manual || left.localeCompare(right);
      });
    const file = files[0];
    if (!file) throw new Error('yt-dlp hat keine Untertiteldatei erzeugt.');
    const document = JSON.parse(await readFile(join(temporary, file), 'utf8'));
    const segments = parseYoutubeJson3Transcript(document);
    const text = transcriptText(segments);
    if (text.length < 120) throw new Error('Das über yt-dlp geladene Transkript ist leer oder zu kurz.');
    const language = file.match(/\.([a-z]{2}(?:-[A-Z]{2})?)\.json3$/)?.[1] ?? 'de';
    return { text, language, source: 'yt-dlp', segments };
  } finally {
    await rm(temporary, { recursive: true, force: true });
  }
}

export async function fetchYoutubeTranscript(
  videoId: string,
  options: { fetchImpl?: typeof fetch } = {},
): Promise<YoutubeTranscript> {
  if (!/^[a-zA-Z0-9_-]{6,20}$/.test(videoId)) throw new Error('Ungültige YouTube-Video-ID.');
  const errors: string[] = [];
  if (!options.fetchImpl) {
    try {
      return await transcriptFromYtDlp(videoId);
    } catch (error) {
      errors.push(error instanceof Error ? error.message : String(error));
    }
  }
  try {
    return await transcriptFromYoutubePage(videoId, options.fetchImpl ?? fetch);
  } catch (error) {
    errors.push(error instanceof Error ? error.message : String(error));
  }
  throw Object.assign(new Error(`YouTube-Transkript nicht verfügbar. ${errors.join(' | ')}`.slice(0, 1600)), {
    statusCode: 422,
  });
}
