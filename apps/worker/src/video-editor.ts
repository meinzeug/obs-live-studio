import { createHash } from 'node:crypto';
import { createReadStream } from 'node:fs';
import { spawn } from 'node:child_process';
import { access, mkdir, mkdtemp, readdir, rm, stat, statfs, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { relative, resolve } from 'node:path';
import {
  claimVideoEditorRender,
  claimVideoEditorDownload,
  completeVideoEditorRender,
  completeVideoEditorDownload,
  createVideoEditorMediaAsset,
  failVideoEditorRender,
  failVideoEditorDownload,
  getVideoEditorProject,
  isVideoEditorDownloadActive,
  recoverStaleVideoEditorRenders,
  recoverStaleVideoEditorDownloads,
  updateVideoEditorRenderProgress,
  updateVideoEditorDownloadProgress,
  videoEditorDuration,
  videoEditorTransitionOverlap,
  type VideoEditorDocument,
  type VideoEditorQuality,
  type VideoEditorSource,
} from '@ans/database/video-editor';
import { resolveOperationalNotification, upsertOperationalNotification } from '@ans/database/notifications';
import {
  compactError,
  downloadYoutubeRange,
  executable,
  processOutput,
  resolvedPath,
  runProcess,
  runtimeEnvironment,
  youtubeDownloadArguments,
} from './youtube-shorts.js';
import { PROJECT_ROOT } from './project-root.js';

type Log = (event: string, extra?: Record<string, unknown>) => void;
type ClaimedVideoEditorRender = NonNullable<Awaited<ReturnType<typeof claimVideoEditorRender>>>;
type ClaimedVideoEditorDownload = NonNullable<Awaited<ReturnType<typeof claimVideoEditorDownload>>>;

const qualityEdges: Record<VideoEditorQuality, number> = { '720p': 720, '1080p': 1080, '1440p': 1440 };

export function videoEditorDimensions(
  quality: VideoEditorQuality,
  aspectRatio: VideoEditorDocument['canvas']['aspectRatio'],
) {
  const edge = qualityEdges[quality];
  if (aspectRatio === '9:16') return { width: edge, height: Math.round((edge * 16) / 9 / 2) * 2 };
  if (aspectRatio === '1:1') return { width: edge, height: edge };
  return { width: Math.round((edge * 16) / 9 / 2) * 2, height: edge };
}

function notificationKey(renderId: string) {
  return `youtube-video-editor:${renderId}`;
}

function downloadNotificationKey(sourceId: string) {
  return `youtube-video-editor-download:${sourceId}`;
}

function safeFilename(value: string) {
  return (
    value
      .normalize('NFKD')
      .replace(/[\u0300-\u036f]/g, '')
      .replace(/[^a-zA-Z0-9_-]+/g, '-')
      .replace(/^-+|-+$/g, '')
      .slice(0, 90) || 'youtube-video'
  );
}

function storedPath(path: string) {
  const pathRelativeToProject = relative(PROJECT_ROOT, path);
  return pathRelativeToProject.startsWith('..') ? path : `./${pathRelativeToProject}`;
}

async function hasStream(ffprobe: string, path: string, selector: 'v:0' | 'a:0') {
  const output = await processOutput(
    ffprobe,
    ['-v', 'error', '-select_streams', selector, '-show_entries', 'stream=index', '-of', 'csv=p=0', path],
    30_000,
    'Die Medienprüfung',
  );
  return Boolean(output.trim());
}

function sourceFor(sources: VideoEditorSource[], sourceId: string) {
  const source = sources.find((candidate) => candidate.id === sourceId);
  if (!source) throw new Error(`Eine Timeline-Quelle (${sourceId}) ist nicht mehr verfügbar.`);
  return source;
}

async function materializeSource(input: {
  source: VideoEditorSource;
  startSeconds: number;
  durationSeconds: number;
  directory: string;
  prefix: string;
  maximumHeight: number;
}) {
  if (input.source.local_path && input.source.status === 'ready') {
    if (!input.source.local_path) throw new Error(`Die lokale Quelle „${input.source.title}“ hat keinen Dateipfad.`);
    const path = resolvedPath(input.source.local_path);
    await access(path).catch(() => {
      throw new Error(`Die lokale Quelle „${input.source.title}“ fehlt auf dem Datenträger.`);
    });
    return { path, sourceStart: input.startSeconds };
  }
  if (!input.source.source_url) throw new Error(`Die YouTube-Quelle „${input.source.title}“ hat keine URL.`);
  return {
    path: await downloadYoutubeRange({
      url: input.source.source_url,
      startSeconds: input.startSeconds,
      durationSeconds: input.durationSeconds,
      directory: input.directory,
      prefix: input.prefix,
      maximumHeight: input.maximumHeight,
    }),
    sourceStart: 0,
  };
}

function videoFilter(input: {
  width: number;
  height: number;
  fps: number;
  duration: number;
  fit: 'contain' | 'cover';
  background: string;
  effect: VideoEditorDocument['clips'][number]['effect'];
  effectIntensity: number;
  motion: VideoEditorDocument['clips'][number]['motion'];
}) {
  const resize =
    input.fit === 'contain'
      ? `scale=${input.width}:${input.height}:force_original_aspect_ratio=decrease,pad=${input.width}:${input.height}:(ow-iw)/2:(oh-ih)/2:color=${input.background}`
      : `scale=${input.width}:${input.height}:force_original_aspect_ratio=increase,crop=${input.width}:${input.height}`;
  const strength = Math.max(0, Math.min(1, input.effectIntensity));
  const effect =
    input.effect === 'cinematic'
      ? `,eq=contrast=${(1 + strength * 0.16).toFixed(3)}:saturation=${(1 - strength * 0.12).toFixed(3)}:brightness=${(-strength * 0.025).toFixed(3)}`
      : input.effect === 'warm'
        ? `,colorbalance=rs=${(strength * 0.13).toFixed(3)}:bs=${(-strength * 0.1).toFixed(3)}`
        : input.effect === 'cool'
          ? `,colorbalance=rs=${(-strength * 0.08).toFixed(3)}:bs=${(strength * 0.14).toFixed(3)}`
          : input.effect === 'monochrome'
            ? `,hue=s=${(1 - strength).toFixed(3)}`
            : input.effect === 'high-contrast'
              ? `,eq=contrast=${(1 + strength * 0.35).toFixed(3)}:saturation=${(1 + strength * 0.08).toFixed(3)}`
              : input.effect === 'soft'
                ? `,gblur=sigma=${(strength * 2.2).toFixed(3)}`
                : input.effect === 'sharpen'
                  ? `,unsharp=5:5:${(strength * 1.2).toFixed(3)}:5:5:0`
                  : '';
  const frameCount = Math.max(1, Math.round(input.duration * input.fps));
  const motion =
    input.motion === 'zoom-in'
      ? `,zoompan=z='min(zoom+${(0.08 / frameCount).toFixed(7)}\\,1.08)':x='iw/2-(iw/zoom/2)':y='ih/2-(ih/zoom/2)':d=1:s=${input.width}x${input.height}:fps=${input.fps}`
      : input.motion === 'zoom-out'
        ? `,zoompan=z='if(eq(on\\,0)\\,1.08\\,max(1\\,zoom-${(0.08 / frameCount).toFixed(7)}))':x='iw/2-(iw/zoom/2)':y='ih/2-(ih/zoom/2)':d=1:s=${input.width}x${input.height}:fps=${input.fps}`
        : input.motion === 'pan-left'
          ? `,zoompan=z=1.08:x='(iw-iw/zoom)*(1-on/${frameCount})':y='ih/2-(ih/zoom/2)':d=1:s=${input.width}x${input.height}:fps=${input.fps}`
          : input.motion === 'pan-right'
            ? `,zoompan=z=1.08:x='(iw-iw/zoom)*on/${frameCount}':y='ih/2-(ih/zoom/2)':d=1:s=${input.width}x${input.height}:fps=${input.fps}`
            : '';
  return `trim=duration=${input.duration.toFixed(3)},setpts=PTS-STARTPTS,${resize},setsar=1,fps=${input.fps}${effect}${motion},format=yuv420p`;
}

function ffmpegTransition(transition: VideoEditorDocument['clips'][number]['transition']) {
  return transition === 'fade' ? 'dissolve' : transition;
}

export function buildVideoEditorClipComposition(document: VideoEditorDocument) {
  const filters: string[] = [];
  document.clips.forEach((_clip, index) => {
    filters.push(`[${index}:v]setpts=PTS-STARTPTS[clipV${index}]`);
    filters.push(`[${index}:a]asetpts=PTS-STARTPTS[clipA${index}]`);
  });
  let videoLabel = 'clipV0';
  let audioLabel = 'clipA0';
  let composedDuration = document.clips[0]?.duration ?? 0;
  for (let index = 1; index < document.clips.length; index += 1) {
    const clip = document.clips[index]!;
    const transitionDuration = videoEditorTransitionOverlap(document.clips[index - 1], clip);
    const nextVideo = `sequenceV${index}`;
    const nextAudio = `sequenceA${index}`;
    if (transitionDuration > 0) {
      filters.push(
        `[${videoLabel}][clipV${index}]xfade=transition=${ffmpegTransition(clip.transition)}:duration=${transitionDuration.toFixed(3)}:offset=${Math.max(0, composedDuration - transitionDuration).toFixed(3)}[${nextVideo}]`,
      );
      filters.push(
        `[${audioLabel}][clipA${index}]acrossfade=d=${transitionDuration.toFixed(3)}:c1=tri:c2=tri[${nextAudio}]`,
      );
      composedDuration += clip.duration - transitionDuration;
    } else {
      filters.push(`[${videoLabel}][clipV${index}]concat=n=2:v=1:a=0[${nextVideo}]`);
      filters.push(`[${audioLabel}][clipA${index}]concat=n=2:v=0:a=1[${nextAudio}]`);
      composedDuration += clip.duration;
    }
    videoLabel = nextVideo;
    audioLabel = nextAudio;
  }
  filters.push(`[${videoLabel}]null[baseVideo]`);
  filters.push(`[${audioLabel}]anull[baseAudio]`);
  return { filters, duration: Number(composedDuration.toFixed(3)) };
}

async function prepareClips(input: {
  document: VideoEditorDocument;
  sources: VideoEditorSource[];
  directory: string;
  ffmpeg: string;
  ffprobe: string;
  width: number;
  height: number;
  progress: (value: number) => Promise<unknown>;
}) {
  const outputs: string[] = [];
  for (const [index, clip] of input.document.clips.entries()) {
    const source = sourceFor(input.sources, clip.sourceId);
    if (source.media_type !== 'video') throw new Error(`„${source.title}“ ist keine Videoquelle.`);
    const materialized = await materializeSource({
      source,
      startSeconds: clip.sourceStart,
      durationSeconds: clip.duration,
      directory: input.directory,
      prefix: `clip-source-${index}`,
      maximumHeight: input.height,
    });
    if (!(await hasStream(input.ffprobe, materialized.path, 'v:0')))
      throw new Error(`„${source.title}“ enthält keine lesbare Videospur.`);
    const hasAudio = await hasStream(input.ffprobe, materialized.path, 'a:0');
    const output = resolve(input.directory, `clip-${String(index).padStart(3, '0')}.mp4`);
    const args = ['-y'];
    if (materialized.sourceStart > 0) args.push('-ss', materialized.sourceStart.toFixed(3));
    args.push('-i', materialized.path);
    if (!hasAudio) args.push('-f', 'lavfi', '-t', clip.duration.toFixed(3), '-i', 'anullsrc=r=48000:cl=stereo');
    const audioInput = hasAudio ? '0:a' : '1:a';
    args.push(
      '-filter_complex',
      `[0:v]${videoFilter({
        width: input.width,
        height: input.height,
        fps: input.document.canvas.fps,
        duration: clip.duration,
        fit: clip.fit,
        background: input.document.canvas.backgroundColor,
        effect: clip.effect,
        effectIntensity: clip.effectIntensity,
        motion: clip.motion,
      })}[video];[${audioInput}]atrim=duration=${clip.duration.toFixed(3)},asetpts=PTS-STARTPTS,aresample=48000,aformat=sample_fmts=fltp:channel_layouts=stereo,volume=${clip.volume.toFixed(3)}[audio]`,
      '-map',
      '[video]',
      '-map',
      '[audio]',
      '-t',
      clip.duration.toFixed(3),
      '-c:v',
      'libx264',
      '-preset',
      process.env.VIDEO_EDITOR_PREPARE_PRESET || 'veryfast',
      '-crf',
      '18',
      '-c:a',
      'aac',
      '-b:a',
      '192k',
      '-ar',
      '48000',
      '-ac',
      '2',
      output,
    );
    await runProcess(
      input.ffmpeg,
      args,
      Math.max(10 * 60_000, clip.duration * 15_000),
      `Clip ${index + 1} („${source.title}“)`,
    );
    outputs.push(output);
    await input.progress(5 + Math.round(((index + 1) / input.document.clips.length) * 27));
  }
  return outputs;
}

function filterPath(path: string) {
  return path.replaceAll('\\', '\\\\').replaceAll(':', '\\:').replaceAll("'", "\\'");
}

function fontPath(font: VideoEditorDocument['textTracks'][number]['fontFamily'], weight: string) {
  const bold = weight !== 'regular';
  const candidates: Record<typeof font, [string, string]> = {
    'dejavu-sans': [
      '/usr/share/fonts/truetype/dejavu/DejaVuSans.ttf',
      '/usr/share/fonts/truetype/dejavu/DejaVuSans-Bold.ttf',
    ],
    'ibm-plex-sans': [
      '/usr/share/fonts/truetype/ibm-plex/IBMPlexSans-Regular.ttf',
      '/usr/share/fonts/truetype/ibm-plex/IBMPlexSans-Bold.ttf',
    ],
    'ibm-plex-condensed': [
      '/usr/share/fonts/truetype/ibm-plex/IBMPlexSansCondensed-Regular.ttf',
      '/usr/share/fonts/truetype/ibm-plex/IBMPlexSansCondensed-Bold.ttf',
    ],
    'liberation-sans': [
      '/usr/share/fonts/truetype/liberation2/LiberationSans-Regular.ttf',
      '/usr/share/fonts/truetype/liberation2/LiberationSans-Bold.ttf',
    ],
  };
  return candidates[font][bold ? 1 : 0];
}

function visualAnimationPosition(input: {
  animation: 'none' | 'fade' | 'rise' | 'slide-left' | 'slide-right';
  x: number;
  y: number;
  width: number;
  height: number;
  startAt: number;
}) {
  const progress = `max(0\\,(${(input.startAt + 0.35).toFixed(3)}-t)/0.35)`;
  if (input.animation === 'rise') return { x: `${input.x}`, y: `${input.y}+${progress}*${input.height}` };
  if (input.animation === 'slide-left') return { x: `${input.x}-${progress}*${input.width}`, y: `${input.y}` };
  if (input.animation === 'slide-right') return { x: `${input.x}+${progress}*${input.width}`, y: `${input.y}` };
  return { x: `${input.x}`, y: `${input.y}` };
}

function buildImageFilters(input: {
  tracks: Array<{ track: VideoEditorDocument['imageTracks'][number]; inputIndex: number }>;
  width: number;
  height: number;
  initialLabel: string;
}) {
  const filters: string[] = [];
  let previous = input.initialLabel;
  for (const [index, entry] of input.tracks.entries()) {
    const track = entry.track;
    const width = Math.max(20, Math.round((input.width * track.width) / 1000));
    const height = Math.max(20, Math.round((input.height * track.height) / 1000));
    const x = Math.round((input.width * track.x) / 1000);
    const y = Math.round((input.height * track.y) / 1000);
    const resize =
      track.fit === 'cover'
        ? `scale=${width}:${height}:force_original_aspect_ratio=increase,crop=${width}:${height}`
        : `scale=${width}:${height}:force_original_aspect_ratio=decrease,pad=${width}:${height}:(ow-iw)/2:(oh-ih)/2:color=0x00000000`;
    const fadeDuration = Math.min(0.3, track.duration / 3);
    const fade =
      track.animation === 'fade'
        ? `,fade=t=in:st=0:d=${fadeDuration.toFixed(3)}:alpha=1,fade=t=out:st=${Math.max(0, track.duration - fadeDuration).toFixed(3)}:d=${fadeDuration.toFixed(3)}:alpha=1`
        : '';
    const rotation =
      Math.abs(track.rotation) > 0.01
        ? `,rotate=${(track.rotation * Math.PI) / 180}:ow=rotw(iw):oh=roth(ih):c=none`
        : '';
    const imageLabel = `imageOverlay${index}`;
    const next = `imageComposed${index}`;
    filters.push(
      `[${entry.inputIndex}:v]${resize},format=rgba,colorchannelmixer=aa=${track.opacity.toFixed(3)}${fade}${rotation},setpts=PTS-STARTPTS+${track.startAt.toFixed(3)}/TB[${imageLabel}]`,
    );
    const position = visualAnimationPosition({
      animation: track.animation,
      x,
      y,
      width,
      height,
      startAt: track.startAt,
    });
    filters.push(
      `[${previous}][${imageLabel}]overlay=x='${position.x}':y='${position.y}':enable='between(t\\,${track.startAt.toFixed(3)}\\,${(track.startAt + track.duration).toFixed(3)})':eof_action=pass[${next}]`,
    );
    previous = next;
  }
  return { filters, outputLabel: previous };
}

function wrappedOverlayText(value: string, maximumCharacters: number) {
  return value
    .split(/\r?\n/)
    .flatMap((paragraph) => {
      const words = paragraph.trim().split(/\s+/).filter(Boolean);
      if (!words.length) return [''];
      const lines: string[] = [];
      let line = '';
      for (const word of words) {
        const candidate = line ? `${line} ${word}` : word;
        if (candidate.length > maximumCharacters && line) {
          lines.push(line);
          line = word;
        } else line = candidate;
      }
      if (line) lines.push(line);
      return lines;
    })
    .join('\n');
}

async function buildTextFilters(input: {
  document: VideoEditorDocument;
  directory: string;
  width: number;
  height: number;
  initialLabel: string;
}) {
  const filters: string[] = [];
  let previous = input.initialLabel;
  for (const [index, track] of input.document.textTracks.entries()) {
    const path = resolve(input.directory, `text-${index}.txt`);
    const size = Math.max(14, Math.round((track.fontSize * input.height) / 1080));
    const width = Math.max(80, Math.round((input.width * track.width) / 1000));
    await writeFile(path, wrappedOverlayText(track.text, Math.max(8, Math.floor(width / (size * 0.56)))), {
      encoding: 'utf8',
      mode: 0o600,
    });
    const next = `text${index}`;
    const start = track.startAt;
    const end = track.startAt + track.duration;
    const anchor = `${(input.width * track.x) / 1000}`;
    const restingX =
      track.align === 'center' ? `${anchor}-text_w/2` : track.align === 'right' ? `${anchor}-text_w` : anchor;
    const slideProgress = `max(0\\,(${(start + 0.35).toFixed(3)}-t)/0.35)`;
    const x =
      track.animation === 'slide-left'
        ? `${restingX}-${slideProgress}*${Math.round(width * 0.25)}`
        : track.animation === 'slide-right'
          ? `${restingX}+${slideProgress}*${Math.round(width * 0.25)}`
          : restingX;
    const restingY = `${(input.height * track.y) / 1000}-text_h/2`;
    const y = track.animation === 'rise' ? `${restingY}+${slideProgress}*${Math.round(input.height * 0.1)}` : restingY;
    const alpha =
      track.animation === 'fade'
        ? `:alpha='${track.opacity.toFixed(3)}*max(0\\,min(1\\,min((t-${start.toFixed(3)})/0.3\\,(${end.toFixed(3)}-t)/0.3)))'`
        : `:alpha=${track.opacity.toFixed(3)}`;
    const border = Math.max(10, Math.round(size * 0.32));
    filters.push(
      `[${previous}]drawtext=fontfile='${filterPath(fontPath(track.fontFamily, track.fontWeight))}':textfile='${filterPath(path)}':expansion=none:fontcolor=${track.color}:fontsize=${size}:line_spacing=${Math.round(size * 0.2)}:x='${x}':y='${y}':box=${track.backgroundOpacity > 0 ? 1 : 0}:boxcolor=${track.backgroundColor}@${track.backgroundOpacity.toFixed(3)}:boxborderw=${border}:borderw=${track.outlineWidth}:bordercolor=${track.outlineColor}:shadowcolor=${track.shadowColor}:shadowx=${track.shadowX}:shadowy=${track.shadowY}:enable='between(t\\,${start.toFixed(3)}\\,${end.toFixed(3)})'${alpha}[${next}]`,
    );
    previous = next;
  }
  return { filters, outputLabel: previous };
}

function parseProgressSeconds(chunk: string) {
  const microseconds = [...chunk.matchAll(/out_time_(?:us|ms)=(\d+)/g)].at(-1)?.[1];
  if (microseconds) return Number(microseconds) / 1_000_000;
  const stamp = [...chunk.matchAll(/out_time=(\d+):(\d+):(\d+(?:\.\d+)?)/g)].at(-1);
  return stamp ? Number(stamp[1]) * 3600 + Number(stamp[2]) * 60 + Number(stamp[3]) : 0;
}

async function runFfmpegWithProgress(input: {
  ffmpeg: string;
  args: string[];
  duration: number;
  onProgress: (progress: number) => Promise<unknown>;
}) {
  await new Promise<void>((resolvePromise, reject) => {
    const output = input.args.at(-1);
    if (!output) {
      reject(new Error('Für den Videoexport wurde keine Ausgabedatei angegeben.'));
      return;
    }
    const child = spawn(input.ffmpeg, [...input.args.slice(0, -1), '-progress', 'pipe:2', '-nostats', output], {
      stdio: ['ignore', 'ignore', 'pipe'],
    });
    let stderr = '';
    let lastProgress = 0;
    const timer = setTimeout(
      () => {
        child.kill('SIGKILL');
        reject(new Error('Das Rendern hat das Sicherheitszeitlimit überschritten.'));
      },
      Math.max(30 * 60_000, Math.min(18 * 60 * 60_000, input.duration * 20_000)),
    );
    child.stderr.on('data', (data) => {
      const chunk = String(data);
      stderr = `${stderr}${chunk}`.slice(-18_000);
      const seconds = parseProgressSeconds(chunk);
      const progress = Math.min(96, 33 + Math.round((seconds / Math.max(0.25, input.duration)) * 63));
      if (progress >= lastProgress + 2) {
        lastProgress = progress;
        void input.onProgress(progress).catch(() => undefined);
      }
    });
    child.once('error', (error) => {
      clearTimeout(timer);
      reject(error);
    });
    child.once('close', (code) => {
      clearTimeout(timer);
      if (code === 0) resolvePromise();
      else
        reject(new Error(`FFmpeg konnte das Video nicht rendern: ${stderr.replace(/\s+/g, ' ').trim().slice(-1600)}`));
    });
  });
}

async function sha256(path: string) {
  return new Promise<string>((resolvePromise, reject) => {
    const hash = createHash('sha256');
    const stream = createReadStream(path);
    stream.on('data', (chunk) => hash.update(chunk));
    stream.once('error', reject);
    stream.once('end', () => resolvePromise(hash.digest('hex')));
  });
}

function classifiedYoutubeDownloadError(stderr: string) {
  const compact = stderr.replace(/\s+/g, ' ').trim().slice(-1800);
  if (/age.?restrict|confirm your age|sign in to confirm your age/i.test(compact))
    return 'Das Video ist altersbeschränkt. Hinterlege bei Bedarf ein freigegebenes yt-dlp-Cookie-Profil.';
  if (/sign in to confirm you.?re not a bot|confirm you.?re not a bot|login required/i.test(compact))
    return 'YouTube verlangt für diesen Abruf eine Anmeldung. Hinterlege ein freigegebenes yt-dlp-Cookie-Profil.';
  if (/not available in your country|geo.?restrict|blocked in your country/i.test(compact))
    return 'Das Video ist in dieser Region gesperrt.';
  if (/copyright|copyright holder/i.test(compact))
    return 'Das Video ist aus urheberrechtlichen Gründen nicht verfügbar.';
  if (/private video|members.?only/i.test(compact)) return 'Das Video ist privat oder nur für Mitglieder verfügbar.';
  if (/video unavailable|has been removed|does not exist/i.test(compact))
    return 'Das YouTube-Video ist nicht mehr verfügbar.';
  if (/unsupported url|invalid url/i.test(compact)) return 'Die angegebene YouTube-URL ist ungültig.';
  return compact ? `yt-dlp konnte das Video nicht laden: ${compact}` : 'yt-dlp konnte das Video nicht laden.';
}

function youtubeEditorFormat(source: ClaimedVideoEditorDownload) {
  if (source.download_mode === 'audio') return 'ba/b';
  const heights: Record<string, number | undefined> = { '720p': 720, '1080p': 1080, '1440p': 1440 };
  const height = heights[source.download_quality];
  return height ? `bv*[height<=${height}]+ba/b[height<=${height}]/b` : 'bv*+ba/b';
}

export async function runYoutubeEditorDownload(
  source: ClaimedVideoEditorDownload,
  env: NodeJS.ProcessEnv,
  onProgress: (progress: number) => Promise<unknown>,
  isActive: () => Promise<boolean> = async () => true,
) {
  if (!source.source_url || !source.youtube_video_id) throw new Error('YouTube-URL oder Video-ID fehlt.');
  const ytDlp = await executable(
    env.YTDLP_EXECUTABLE || resolve(PROJECT_ROOT, 'var/youtube-tools-venv/bin/yt-dlp'),
    'yt-dlp',
  );
  const directory = resolve(PROJECT_ROOT, 'downloads/youtube-video-editor', source.project_id);
  await mkdir(directory, { recursive: true, mode: 0o750 });
  const prefix = `${safeFilename(source.title)}-${source.youtube_video_id}`;
  const outputTemplate = resolve(directory, `${prefix}.%(ext)s`);
  const previousFiles = (await readdir(directory)).filter((name) => name.startsWith(`${prefix}.`));
  await Promise.all(previousFiles.map((name) => rm(resolve(directory, name), { force: true })));
  const maximumBytes = Math.max(
    10 * 1024 * 1024,
    Math.min(20 * 1024 * 1024 * 1024, Number(env.VIDEO_EDITOR_MAX_DOWNLOAD_BYTES) || 4 * 1024 * 1024 * 1024),
  );
  const configuredFfmpeg = env.FFMPEG_EXECUTABLE?.trim();
  const args = [
    '--no-playlist',
    '--newline',
    '--no-write-info-json',
    '--no-write-thumbnail',
    '--js-runtimes',
    `node:${process.execPath}`,
    '--retries',
    '8',
    '--fragment-retries',
    '8',
    '--socket-timeout',
    '30',
    '--max-filesize',
    String(maximumBytes),
    ...(configuredFfmpeg?.includes('/') ? ['--ffmpeg-location', configuredFfmpeg] : []),
    '--format',
    youtubeEditorFormat(source),
    ...(source.download_mode === 'audio'
      ? ['--extract-audio', '--audio-format', 'm4a', '--audio-quality', '0']
      : ['--merge-output-format', 'mp4', '--remux-video', 'mp4']),
    ...(await youtubeDownloadArguments()),
    '--output',
    outputTemplate,
    source.source_url,
  ];
  let output = '';
  let lastProgress = 0;
  await new Promise<void>((resolvePromise, reject) => {
    const child = spawn(ytDlp, args, { stdio: ['ignore', 'pipe', 'pipe'] });
    let stopReason = '';
    let checking = false;
    let forceKillTimer: NodeJS.Timeout | null = null;
    const stop = (reason: string) => {
      if (stopReason) return;
      stopReason = reason;
      child.kill('SIGTERM');
      forceKillTimer = setTimeout(() => child.kill('SIGKILL'), 5_000);
      forceKillTimer.unref?.();
    };
    const safetyMonitor = setInterval(() => {
      if (checking || stopReason) return;
      checking = true;
      void (async () => {
        const active = await isActive().catch(() => true);
        if (!active) {
          stop('Der YouTube-Download wurde abgebrochen.');
          return;
        }
        const names = await readdir(directory).catch(() => [] as string[]);
        let downloadedBytes = 0;
        for (const name of names.filter((name) => name.startsWith(`${prefix}.`))) {
          const info = await stat(resolve(directory, name)).catch(() => null);
          if (info?.isFile()) downloadedBytes += info.size;
        }
        if (downloadedBytes >= maximumBytes) {
          stop(`Der Download überschreitet das konfigurierte Größenlimit von ${maximumBytes} Bytes.`);
          return;
        }
        const disk = await statfs(directory).catch(() => null);
        const minimumFreeBytes = Math.max(
          512 * 1024 * 1024,
          Number(env.VIDEO_EDITOR_MIN_FREE_BYTES) || 2 * 1024 * 1024 * 1024,
        );
        if (disk && Number(disk.bavail) * Number(disk.bsize) < minimumFreeBytes) {
          stop('Der Download wurde gestoppt, damit die Sicherheitsreserve des Datenträgers erhalten bleibt.');
        }
      })()
        .catch((error) => stop(`Download-Sicherheitsprüfung fehlgeschlagen: ${compactError(error)}`))
        .finally(() => {
          checking = false;
        });
    }, 2_000);
    safetyMonitor.unref?.();
    const timer = setTimeout(
      () => {
        stop('Der YouTube-Download hat das Sicherheitszeitlimit überschritten.');
      },
      2 * 60 * 60_000,
    );
    const consume = (data: Buffer | string) => {
      const chunk = String(data);
      output = `${output}${chunk}`.slice(-24_000);
      const matches = [...chunk.matchAll(/(?:^|\s)(\d{1,3}(?:\.\d+)?)%/g)];
      const progress = Math.min(95, Math.floor(Number(matches.at(-1)?.[1] ?? 0)));
      if (progress >= lastProgress + 1) {
        lastProgress = progress;
        void onProgress(progress).catch(() => undefined);
      }
    };
    child.stdout.on('data', consume);
    child.stderr.on('data', consume);
    child.once('error', (error) => {
      clearTimeout(timer);
      clearInterval(safetyMonitor);
      if (forceKillTimer) clearTimeout(forceKillTimer);
      reject(error);
    });
    child.once('close', (code) => {
      clearTimeout(timer);
      clearInterval(safetyMonitor);
      if (forceKillTimer) clearTimeout(forceKillTimer);
      if (stopReason) {
        reject(new Error(stopReason));
        return;
      }
      if (code === 0) resolvePromise();
      else reject(new Error(classifiedYoutubeDownloadError(output)));
    });
  });
  const files = await readdir(directory);
  const file = files.find(
    (name) => name.startsWith(`${prefix}.`) && !name.endsWith('.part') && !name.endsWith('.ytdl'),
  );
  if (!file) throw new Error('yt-dlp hat nach dem Download keine fertige Mediendatei hinterlegt.');
  const path = resolve(directory, file);
  const info = await stat(path);
  if (!info.isFile() || !info.size || info.size > maximumBytes)
    throw new Error('Die heruntergeladene Datei ist leer oder überschreitet das konfigurierte Größenlimit.');
  const probe = JSON.parse(
    await processOutput(
      env.FFPROBE_EXECUTABLE || 'ffprobe',
      [
        '-v',
        'error',
        '-show_entries',
        'format=duration:stream=codec_type,codec_name,width,height',
        '-of',
        'json',
        path,
      ],
      30_000,
      'Die Download-Metadaten',
    ),
  ) as {
    format?: { duration?: string };
    streams?: Array<{ codec_type?: string; codec_name?: string; width?: number; height?: number }>;
  };
  const durationSeconds = Number(probe.format?.duration);
  if (!Number.isFinite(durationSeconds) || durationSeconds <= 0)
    throw new Error('Die heruntergeladene Datei enthält keine gültige Laufzeit.');
  const video = probe.streams?.find((stream) => stream.codec_type === 'video');
  const audio = probe.streams?.find((stream) => stream.codec_type === 'audio');
  return {
    path,
    sizeBytes: info.size,
    durationSeconds,
    metadata: {
      title: source.title,
      channelTitle: source.channel_title,
      youtubeVideoId: source.youtube_video_id,
      quality: source.download_quality,
      mode: source.download_mode,
      width: video?.width ?? null,
      height: video?.height ?? null,
      videoCodec: video?.codec_name ?? null,
      audioCodec: audio?.codec_name ?? null,
      downloadedAt: new Date().toISOString(),
    },
  };
}

export class VideoEditorDownloadProcessor {
  private timer: NodeJS.Timeout | null = null;
  private busy = false;
  private stopped = false;

  constructor(
    private readonly workerId: string,
    private readonly log: Log,
  ) {}

  async start(intervalMs = 2_000) {
    if (this.timer) return;
    this.stopped = false;
    await recoverStaleVideoEditorDownloads().catch(() => null);
    this.timer = setInterval(() => void this.tick(), intervalMs);
    this.timer.unref?.();
    setTimeout(() => void this.tick(), 500).unref?.();
  }

  stop() {
    this.stopped = true;
    if (this.timer) clearInterval(this.timer);
    this.timer = null;
  }

  async tick() {
    if (this.busy || this.stopped) return;
    this.busy = true;
    let source: ClaimedVideoEditorDownload | null = null;
    try {
      source = await claimVideoEditorDownload(this.workerId);
      if (!source) return;
      const env = await runtimeEnvironment();
      const downloaded = await runYoutubeEditorDownload(
        source,
        env,
        (progress) => updateVideoEditorDownloadProgress(source!.id, progress),
        () => isVideoEditorDownloadActive(source!.id, this.workerId),
      );
      await completeVideoEditorDownload(source.id, {
        localPath: storedPath(downloaded.path),
        sizeBytes: downloaded.sizeBytes,
        durationSeconds: downloaded.durationSeconds,
        metadata: downloaded.metadata,
      });
      await resolveOperationalNotification(downloadNotificationKey(source.id)).catch(() => null);
      this.log('video_editor_download_ready', {
        sourceId: source.id,
        projectId: source.project_id,
        bytes: downloaded.sizeBytes,
        duration: downloaded.durationSeconds,
      });
    } catch (error) {
      const message = compactError(error);
      if (source) {
        const failed = await failVideoEditorDownload(source.id, message).catch(() => null);
        await upsertOperationalNotification({
          level: failed?.status === 'error' ? 'error' : 'warning',
          component: 'video-editor',
          dedupeKey: downloadNotificationKey(source.id),
          message:
            failed?.status === 'error'
              ? `„${source.title}“ konnte nicht von YouTube heruntergeladen werden.`
              : `Der Download von „${source.title}“ wird automatisch erneut versucht.`,
          details: {
            sourceId: source.id,
            projectId: source.project_id,
            error: message,
            attempts: failed?.download_attempts ?? source.download_attempts,
          },
        }).catch(() => null);
      }
      this.log('video_editor_download_failed', {
        sourceId: source?.id,
        projectId: source?.project_id,
        error: message,
      });
      if (source) {
        const directory = resolve(PROJECT_ROOT, 'downloads/youtube-video-editor', source.project_id);
        const prefix = `${safeFilename(source.title)}-${source.youtube_video_id || 'youtube-video'}`;
        const fragments = await readdir(directory).catch(() => [] as string[]);
        await Promise.all(
          fragments
            .filter((name) => name.startsWith(`${prefix}.`) && (name.endsWith('.part') || name.endsWith('.ytdl')))
            .map((name) => rm(resolve(directory, name), { force: true })),
        );
      }
    } finally {
      this.busy = false;
    }
  }
}

export async function renderVideoEditorJob(
  claimed: ClaimedVideoEditorRender,
  log: Log,
  env: NodeJS.ProcessEnv = process.env,
) {
  const { render, sources } = claimed;
  const document = render.document_snapshot;
  if (!document.clips.length) throw new Error('Das Projekt enthält keine Videoclips.');
  const duration = videoEditorDuration(document);
  const dimensions = videoEditorDimensions(render.quality, document.canvas.aspectRatio);
  const ffmpeg = await executable(env.FFMPEG_EXECUTABLE || 'ffmpeg', 'ffmpeg');
  const ffprobe = await executable(env.FFPROBE_EXECUTABLE || 'ffprobe', 'ffprobe');
  const temporary = await mkdtemp(resolve(tmpdir(), `open-tv-video-editor-${render.id}-`));
  const outputDirectory = resolve(PROJECT_ROOT, 'var/media/video-editor/renders', render.project_id);
  await mkdir(outputDirectory, { recursive: true });
  const output = resolve(outputDirectory, `${render.id}-${render.quality}.mp4`);
  const thumbnail = resolve(outputDirectory, `${render.id}-${render.quality}.jpg`);
  try {
    const clips = await prepareClips({
      document,
      sources,
      directory: temporary,
      ffmpeg,
      ffprobe,
      ...dimensions,
      progress: (value) => updateVideoEditorRenderProgress(render.id, value),
    });
    const args = ['-y'];
    for (const clip of clips) args.push('-i', clip);
    const imageInputs: Array<{
      inputIndex: number;
      track: VideoEditorDocument['imageTracks'][number];
    }> = [];
    for (const track of document.imageTracks) {
      const source = sourceFor(sources, track.sourceId);
      if (source.media_type !== 'image' || !source.local_path)
        throw new Error(`Die Grafikquelle „${track.name}“ ist nicht mehr verfügbar.`);
      const path = resolvedPath(source.local_path);
      await access(path).catch(() => {
        throw new Error(`Die Grafikdatei „${source.title}“ fehlt auf dem Datenträger.`);
      });
      args.push('-loop', '1', '-framerate', String(document.canvas.fps), '-t', track.duration.toFixed(3), '-i', path);
      imageInputs.push({ inputIndex: clips.length + imageInputs.length, track });
    }
    const audioInputs: Array<{
      index: number;
      id: string;
      duration: number;
      startAt: number;
      volume: number;
      fadeIn: number;
      fadeOut: number;
    }> = [];
    for (const [index, track] of document.audioTracks.filter((candidate) => !candidate.muted).entries()) {
      const source = sourceFor(sources, track.sourceId);
      const materialized = await materializeSource({
        source,
        startSeconds: track.sourceStart,
        durationSeconds: track.duration,
        directory: temporary,
        prefix: `audio-source-${index}`,
        maximumHeight: 360,
      });
      if (!(await hasStream(ffprobe, materialized.path, 'a:0')))
        throw new Error(`Die Zusatzspur „${source.title}“ enthält kein Audio.`);
      if (materialized.sourceStart > 0) args.push('-ss', materialized.sourceStart.toFixed(3));
      args.push('-i', materialized.path);
      audioInputs.push({
        index: clips.length + imageInputs.length + audioInputs.length,
        id: `extraAudio${index}`,
        duration: Math.min(track.duration, Math.max(0.25, duration - track.startAt)),
        startAt: track.startAt,
        volume: track.volume,
        fadeIn: track.fadeIn,
        fadeOut: track.fadeOut,
      });
    }

    const filters: string[] = [];
    filters.push(...buildVideoEditorClipComposition(document).filters);
    const images = buildImageFilters({
      tracks: imageInputs,
      ...dimensions,
      initialLabel: 'baseVideo',
    });
    filters.push(...images.filters);
    const texts = await buildTextFilters({
      document,
      directory: temporary,
      ...dimensions,
      initialLabel: images.outputLabel,
    });
    filters.push(...texts.filters);
    if (!texts.filters.length) filters.push(`[${images.outputLabel}]null[videoOut]`);
    else filters.push(`[${texts.outputLabel}]null[videoOut]`);

    const audioLabels = ['[baseAudio]'];
    for (const track of audioInputs) {
      const effects = [
        `atrim=duration=${track.duration.toFixed(3)}`,
        'asetpts=PTS-STARTPTS',
        'aresample=48000',
        'aformat=sample_fmts=fltp:channel_layouts=stereo',
        `volume=${track.volume.toFixed(3)}`,
      ];
      if (track.fadeIn > 0) effects.push(`afade=t=in:st=0:d=${Math.min(track.fadeIn, track.duration / 2).toFixed(3)}`);
      if (track.fadeOut > 0)
        effects.push(
          `afade=t=out:st=${Math.max(0, track.duration - Math.min(track.fadeOut, track.duration / 2)).toFixed(3)}:d=${Math.min(track.fadeOut, track.duration / 2).toFixed(3)}`,
        );
      effects.push(`adelay=${Math.round(track.startAt * 1000)}:all=1`);
      filters.push(`[${track.index}:a]${effects.join(',')}[${track.id}]`);
      audioLabels.push(`[${track.id}]`);
    }
    if (audioLabels.length > 1)
      filters.push(
        `${audioLabels.join('')}amix=inputs=${audioLabels.length}:duration=first:dropout_transition=0:normalize=0,alimiter=limit=0.96[audioOut]`,
      );
    else filters.push('[baseAudio]alimiter=limit=0.96[audioOut]');

    const crf = render.quality === '1440p' ? '17' : render.quality === '1080p' ? '18' : '19';
    args.push(
      '-filter_complex',
      filters.join(';'),
      '-map',
      '[videoOut]',
      '-map',
      '[audioOut]',
      '-t',
      duration.toFixed(3),
      '-c:v',
      'libx264',
      '-preset',
      env.VIDEO_EDITOR_RENDER_PRESET || 'fast',
      '-crf',
      crf,
      '-pix_fmt',
      'yuv420p',
      '-r',
      String(document.canvas.fps),
      '-c:a',
      'aac',
      '-b:a',
      '192k',
      '-ar',
      '48000',
      '-ac',
      '2',
      '-movflags',
      '+faststart',
      output,
    );
    await runFfmpegWithProgress({
      ffmpeg,
      args,
      duration,
      onProgress: (progress) => updateVideoEditorRenderProgress(render.id, progress),
    });
    await runProcess(
      ffmpeg,
      [
        '-y',
        '-ss',
        Math.min(2, Math.max(0, duration / 3)).toFixed(3),
        '-i',
        output,
        '-frames:v',
        '1',
        '-vf',
        'scale=640:-2',
        '-q:v',
        '2',
        thumbnail,
      ],
      60_000,
      'Das Vorschaubild',
    );
    const outputStat = await stat(output);
    const project = await getVideoEditorProject(render.project_id);
    const filename = `${safeFilename(project?.project.name || 'youtube-video')}-${render.quality}.mp4`;
    const mediaAsset = await createVideoEditorMediaAsset({
      filename,
      mimeType: 'video/mp4',
      sizeBytes: outputStat.size,
      storagePath: storedPath(output),
      sha256: await sha256(output),
      durationSeconds: duration,
      resolution: `${dimensions.width}x${dimensions.height}`,
      metadata: {
        videoEditorProjectId: render.project_id,
        videoEditorRenderId: render.id,
        projectRevision: render.project_revision,
        quality: render.quality,
        fps: document.canvas.fps,
      },
      derivativePaths: {
        thumb: { path: storedPath(thumbnail), mime: 'image/jpeg', width: 640 },
      },
      usage: 'video-editor-render',
    });
    await completeVideoEditorRender(render.id, {
      outputPath: storedPath(output),
      thumbnailPath: storedPath(thumbnail),
      mediaAssetId: mediaAsset.id,
      sizeBytes: outputStat.size,
      durationSeconds: duration,
      ...dimensions,
    });
    await resolveOperationalNotification(notificationKey(render.id)).catch(() => null);
    log('video_editor_render_ready', {
      renderId: render.id,
      projectId: render.project_id,
      quality: render.quality,
      duration,
      bytes: outputStat.size,
    });
    return { output, thumbnail, duration, ...dimensions };
  } catch (error) {
    await rm(output, { force: true }).catch(() => undefined);
    await rm(thumbnail, { force: true }).catch(() => undefined);
    throw error;
  } finally {
    await rm(temporary, { recursive: true, force: true });
  }
}

export class VideoEditorProcessor {
  private timer: NodeJS.Timeout | null = null;
  private busy = false;
  private stopped = false;

  constructor(
    private readonly workerId: string,
    private readonly log: Log,
  ) {}

  async start(intervalMs = 5_000) {
    if (this.timer) return;
    this.stopped = false;
    await recoverStaleVideoEditorRenders().catch(() => null);
    this.timer = setInterval(() => void this.tick(), intervalMs);
    this.timer.unref?.();
    setTimeout(() => void this.tick(), 1_000).unref?.();
  }

  stop() {
    this.stopped = true;
    if (this.timer) clearInterval(this.timer);
    this.timer = null;
  }

  async tick() {
    if (this.busy || this.stopped) return;
    this.busy = true;
    let claimed: ClaimedVideoEditorRender | null = null;
    try {
      claimed = await claimVideoEditorRender(this.workerId);
      if (!claimed) return;
      const env = await runtimeEnvironment();
      await renderVideoEditorJob(claimed, this.log, env);
    } catch (error) {
      const message = compactError(error);
      if (claimed) {
        const failed = await failVideoEditorRender(claimed.render.id, message).catch(() => null);
        await upsertOperationalNotification({
          level: failed?.status === 'failed' ? 'error' : 'warning',
          component: 'video-editor',
          dedupeKey: notificationKey(claimed.render.id),
          message:
            failed?.status === 'failed'
              ? 'Ein YouTube-Video konnte nach mehreren Versuchen nicht gerendert werden.'
              : 'Ein YouTube-Video-Render wird nach einem Fehler automatisch erneut versucht.',
          details: {
            renderId: claimed.render.id,
            projectId: claimed.render.project_id,
            quality: claimed.render.quality,
            error: message,
            attempts: failed?.attempts ?? claimed.render.attempts,
          },
        }).catch(() => null);
      }
      this.log('video_editor_render_failed', {
        renderId: claimed?.render.id,
        projectId: claimed?.render.project_id,
        error: message,
      });
    } finally {
      this.busy = false;
    }
  }
}
