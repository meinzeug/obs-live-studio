import { spawn } from 'node:child_process';
import { existsSync } from 'node:fs';
import { access, mkdir, mkdtemp, readFile, readdir, rename, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { basename, isAbsolute, join, resolve } from 'node:path';
import { parse as parseEnvironment } from 'dotenv';
import {
  claimYoutubeShortJob,
  failYoutubeShortJob,
  getYoutubeShortsSettings,
  recoverStaleYoutubeShortJobs,
  updateYoutubeShortJob,
  type YoutubeShortJob,
  type YoutubeShortsSettings,
} from '@ans/database/youtube-shorts';
import { getAiPresenterProfile } from '@ans/database/ai-presenters';
import { resolveOperationalNotification, upsertOperationalNotification } from '@ans/database/notifications';
import { generateTtsAudio, ttsEnvironmentForAiPresenter } from '../../api/src/tts-generation.js';
import { youtubeShortPublication } from '../../api/src/youtube-short-publication.js';
import { uploadYoutubeVideoResumable, youtubeOAuthPublicStatus } from '../../api/src/youtube-oauth.js';
import { PROJECT_ROOT } from './project-root.js';

type Log = (event: string, extra?: Record<string, unknown>) => void;

function resolvedPath(value: string) {
  if (value.startsWith('~/')) return resolve(process.env.HOME || PROJECT_ROOT, value.slice(2));
  return isAbsolute(value) ? resolve(value) : resolve(PROJECT_ROOT, value);
}

async function executable(value: string, fallback: string) {
  const candidates = [value.trim(), fallback].filter(Boolean);
  for (const candidate of candidates) {
    if (!candidate.includes('/')) return candidate;
    const path = resolvedPath(candidate);
    try {
      await access(path);
      return path;
    } catch {
      // Nächsten Kandidaten versuchen.
    }
  }
  throw new Error(`${basename(fallback)} ist nicht installiert oder nicht ausführbar.`);
}

function compactError(error: unknown) {
  return (error instanceof Error ? error.message : String(error)).replace(/\s+/g, ' ').trim().slice(0, 1800);
}

async function runtimeEnvironment(): Promise<NodeJS.ProcessEnv> {
  try {
    const persisted = parseEnvironment(await readFile(resolve(PROJECT_ROOT, '.env'), 'utf8'));
    return { ...process.env, ...persisted };
  } catch {
    return { ...process.env };
  }
}

async function runProcess(command: string, args: string[], timeoutMs: number, label: string) {
  return new Promise<void>((resolvePromise, reject) => {
    const child = spawn(command, args, { stdio: ['ignore', 'ignore', 'pipe'] });
    let stderr = '';
    const timer = setTimeout(() => {
      child.kill('SIGKILL');
      reject(new Error(`${label} hat das Zeitlimit überschritten.`));
    }, timeoutMs);
    child.stderr.on('data', (chunk) => {
      stderr = `${stderr}${String(chunk)}`.slice(-12_000);
    });
    child.once('error', (error) => {
      clearTimeout(timer);
      reject(error);
    });
    child.once('close', (code) => {
      clearTimeout(timer);
      if (code === 0) resolvePromise();
      else reject(new Error(`${label} ist fehlgeschlagen: ${stderr.replace(/\s+/g, ' ').trim().slice(-1400)}`));
    });
  });
}

async function processOutput(command: string, args: string[], timeoutMs: number, label: string) {
  return new Promise<string>((resolvePromise, reject) => {
    const child = spawn(command, args, { stdio: ['ignore', 'pipe', 'pipe'] });
    let stdout = '';
    let stderr = '';
    const timer = setTimeout(() => {
      child.kill('SIGKILL');
      reject(new Error(`${label} hat das Zeitlimit überschritten.`));
    }, timeoutMs);
    child.stdout.on('data', (chunk) => {
      stdout = `${stdout}${String(chunk)}`.slice(-24_000);
    });
    child.stderr.on('data', (chunk) => {
      stderr = `${stderr}${String(chunk)}`.slice(-12_000);
    });
    child.once('error', (error) => {
      clearTimeout(timer);
      reject(error);
    });
    child.once('close', (code) => {
      clearTimeout(timer);
      if (code === 0) resolvePromise(stdout);
      else reject(new Error(`${label} ist fehlgeschlagen: ${stderr.replace(/\s+/g, ' ').trim().slice(-1400)}`));
    });
  });
}

async function youtubeDownloadArguments() {
  const providerHome = process.env.YTDLP_POT_PROVIDER_HOME?.trim()
    ? resolvedPath(process.env.YTDLP_POT_PROVIDER_HOME.trim())
    : resolve(PROJECT_ROOT, 'var/bgutil-ytdlp-pot-provider/server');
  const providerScript = join(providerHome, 'build/generate_once.js');
  const browserCookies = process.env.YTDLP_COOKIES_FROM_BROWSER?.trim();
  const args = browserCookies ? ['--cookies-from-browser', browserCookies] : [];
  if (!browserCookies && existsSync(providerScript)) {
    args.push(
      '--extractor-args',
      `youtubepot-bgutilscript:server_home=${providerHome}`,
      '--extractor-args',
      'youtube:fetch_pot=always',
    );
  }
  return args;
}

async function downloadClip(job: YoutubeShortJob, directory: string) {
  const ytDlp = await executable(
    process.env.YTDLP_EXECUTABLE || resolve(PROJECT_ROOT, 'var/youtube-tools-venv/bin/yt-dlp'),
    'yt-dlp',
  );
  const clipEnd = job.clip_start_seconds + job.clip_duration_seconds + 2;
  await runProcess(
    ytDlp,
    [
      '--no-playlist',
      '--js-runtimes',
      `node:${process.execPath}`,
      '--retries',
      '5',
      '--fragment-retries',
      '5',
      '--download-sections',
      `*${job.clip_start_seconds.toFixed(3)}-${clipEnd.toFixed(3)}`,
      '--force-keyframes-at-cuts',
      '--format',
      'bv*[height<=720]+ba/b[height<=720]/b',
      '--merge-output-format',
      'mp4',
      ...(await youtubeDownloadArguments()),
      '--output',
      join(directory, 'source.%(ext)s'),
      job.source_url,
    ],
    20 * 60_000,
    'Der YouTube-Ausschnitt',
  );
  const files = await readdir(directory);
  const source = files.find((file) => /^source\.(?:mp4|mkv|webm|mov)$/i.test(file));
  if (!source) throw new Error('yt-dlp hat keine verwendbare Videodatei erzeugt.');
  return join(directory, source);
}

function sentenceExcerpt(value: string, maximum = 360) {
  const clean = value.replace(/\s+/g, ' ').trim();
  if (clean.length <= maximum) return clean;
  const slice = clean.slice(0, maximum + 1);
  const sentence = Math.max(slice.lastIndexOf('. '), slice.lastIndexOf('? '), slice.lastIndexOf('! '));
  const word = slice.lastIndexOf(' ');
  return `${slice.slice(0, sentence >= maximum * 0.55 ? sentence + 1 : word > 0 ? word : maximum).trim()}…`;
}

function wrappedText(value: string, columns = 34, lines = 5) {
  const words = value.replace(/\s+/g, ' ').trim().split(' ');
  const rows: string[] = [];
  let current = '';
  for (const word of words) {
    if (`${current} ${word}`.trim().length <= columns) current = `${current} ${word}`.trim();
    else {
      if (current) rows.push(current);
      current = word;
      if (rows.length >= lines) break;
    }
  }
  if (current && rows.length < lines) rows.push(current);
  if (words.join(' ').length > rows.join(' ').length) rows[rows.length - 1] = `${rows.at(-1)?.replace(/…?$/, '')}…`;
  return rows.join('\n');
}

function escapeFilterPath(path: string) {
  return path.replaceAll('\\', '\\\\').replaceAll(':', '\\:').replaceAll("'", "\\'");
}

async function renderShort(
  job: YoutubeShortJob,
  settings: YoutubeShortsSettings,
  sourcePath: string,
  directory: string,
  env: NodeJS.ProcessEnv,
) {
  const ffmpeg = await executable(env.FFMPEG_EXECUTABLE || 'ffmpeg', 'ffmpeg');
  const ffprobe = await executable(env.FFPROBE_EXECUTABLE || 'ffprobe', 'ffprobe');
  const overlayPath = resolvedPath(settings.overlay_path);
  await access(overlayPath).catch(() => {
    throw new Error(`Das konfigurierte Shorts-PNG fehlt: ${overlayPath}`);
  });
  const presenter = await getAiPresenterProfile('moderator');
  const speakingPath = resolvedPath(
    presenter?.media.speaking?.rendered_path || './var/media/ai-host/youtube-context-speaking.webm',
  );
  const idlePath = resolvedPath(
    presenter?.media.idle?.rendered_path || './var/media/ai-host/youtube-context-idle.webm',
  );
  await Promise.all([access(speakingPath), access(idlePath)]);
  const commentary = sentenceExcerpt(job.commentary_text);
  const speech = await generateTtsAudio(
    `${job.commentary_headline}. ${commentary}`,
    ttsEnvironmentForAiPresenter('moderator', env, presenter?.tts_voice || undefined),
  );
  const leadSeconds = 0.75;
  const speechSeconds = Math.max(1, Math.min(42, speech.durationSeconds));
  const idleTail = Math.max(1, job.clip_duration_seconds - leadSeconds - speechSeconds);
  const sourceHasAudio = Boolean(
    (
      await processOutput(
        ffprobe,
        ['-v', 'error', '-select_streams', 'a:0', '-show_entries', 'stream=index', '-of', 'csv=p=0', sourcePath],
        30_000,
        'Die Audio-Prüfung des YouTube-Ausschnitts',
      )
    ).trim(),
  );
  const sourceVolume = settings.source_volume_percent / 100;
  const duckVolume = settings.source_duck_percent / 100;
  const titleText = join(directory, 'title.txt');
  const commentaryText = join(directory, 'commentary.txt');
  await Promise.all([
    writeFile(titleText, wrappedText(job.source_title, 38, 3), { mode: 0o600 }),
    writeFile(commentaryText, wrappedText(commentary, 38, 5), { mode: 0o600 }),
  ]);
  const font = existsSync('/usr/share/fonts/truetype/dejavu/DejaVuSans-Bold.ttf')
    ? '/usr/share/fonts/truetype/dejavu/DejaVuSans-Bold.ttf'
    : '/usr/share/fonts/truetype/liberation2/LiberationSans-Bold.ttf';
  const filter = [
    '[0:v]split=2[sourcebg][sourcemain]',
    '[sourcebg]scale=1080:1920:force_original_aspect_ratio=increase,crop=1080:1920,gblur=sigma=34,eq=brightness=-0.38:saturation=0.72[background]',
    '[sourcemain]scale=1000:562:force_original_aspect_ratio=decrease:force_divisible_by=2,setsar=1,pad=1000:562:(ow-iw)/2:(oh-ih)/2:color=black[video]',
    '[background][video]overlay=40:270[stage0]',
    `[stage0]drawbox=x=42:y=850:w=996:h=260:color=0x06101ddd:t=fill,drawbox=x=42:y=850:w=9:h=260:color=0x22d3eeff:t=fill[stage1]`,
    `[stage1]drawtext=fontfile='${escapeFilterPath(font)}':textfile='${escapeFilterPath(titleText)}':fontcolor=white:fontsize=42:line_spacing=8:x=72:y=878[stage2]`,
    `[stage2]drawtext=fontfile='${escapeFilterPath(font)}':textfile='${escapeFilterPath(commentaryText)}':fontcolor=0xe2e8f0:fontsize=31:line_spacing=7:x=72:y=1125[stage3]`,
    `[3:v]split=2[idlepre0][idlepost0]`,
    `[idlepre0]scale=900:-2,trim=duration=${leadSeconds},setpts=PTS-STARTPTS[idlepre]`,
    `[2:v]scale=900:-2,trim=duration=${speechSeconds.toFixed(3)},setpts=PTS-STARTPTS[speaking]`,
    `[idlepost0]scale=900:-2,trim=duration=${idleTail.toFixed(3)},setpts=PTS-STARTPTS[idlepost]`,
    '[idlepre][speaking][idlepost]concat=n=3:v=1:a=0[avatar]',
    '[stage3][avatar]overlay=-10:1350:shortest=0[stage4]',
    '[1:v]scale=1080:1920[branding]',
    '[stage4][branding]overlay=0:0:shortest=0,format=yuv420p[videoout]',
    sourceHasAudio
      ? `[0:a]atrim=duration=${job.clip_duration_seconds},asetpts=PTS-STARTPTS,volume='if(between(t,${leadSeconds.toFixed(2)},${(
          leadSeconds +
          speechSeconds +
          0.7
        ).toFixed(2)}),${duckVolume.toFixed(3)},${sourceVolume.toFixed(3)})':eval=frame[sourceaudio]`
      : `anullsrc=r=48000:cl=stereo,atrim=duration=${job.clip_duration_seconds}[sourceaudio]`,
    `[4:a]atrim=duration=${speechSeconds.toFixed(3)},asetpts=PTS-STARTPTS,adelay=${Math.round(leadSeconds * 1000)}:all=1,volume=1.28,apad,atrim=duration=${job.clip_duration_seconds}[voice]`,
    `[sourceaudio][voice]amix=inputs=2:duration=longest:dropout_transition=0:normalize=0,alimiter=limit=0.96,atrim=duration=${job.clip_duration_seconds}[audioout]`,
  ].join(';');
  const outputDirectory = resolve(PROJECT_ROOT, 'var/media/shorts/output');
  await mkdir(outputDirectory, { recursive: true });
  const temporaryOutput = join(directory, `${job.id}.mp4`);
  await runProcess(
    ffmpeg,
    [
      '-hide_banner',
      '-loglevel',
      'error',
      '-y',
      '-stream_loop',
      '-1',
      '-i',
      sourcePath,
      '-loop',
      '1',
      '-i',
      overlayPath,
      '-stream_loop',
      '-1',
      '-c:v',
      'libvpx-vp9',
      '-i',
      speakingPath,
      '-stream_loop',
      '-1',
      '-c:v',
      'libvpx-vp9',
      '-i',
      idlePath,
      '-i',
      speech.file,
      '-filter_complex',
      filter,
      '-map',
      '[videoout]',
      '-map',
      '[audioout]',
      '-t',
      String(job.clip_duration_seconds),
      '-r',
      '30',
      '-c:v',
      'libx264',
      '-preset',
      env.SHORTS_X264_PRESET || 'medium',
      '-crf',
      env.SHORTS_X264_CRF || '21',
      '-c:a',
      'aac',
      '-b:a',
      '192k',
      '-movflags',
      '+faststart',
      temporaryOutput,
    ],
    45 * 60_000,
    'Der Shorts-Renderer',
  );
  const outputPath = join(outputDirectory, `${job.id}.mp4`);
  await rename(temporaryOutput, outputPath);
  const thumbnailPath = join(outputDirectory, `${job.id}.jpg`);
  await runProcess(
    ffmpeg,
    [
      '-hide_banner',
      '-loglevel',
      'error',
      '-y',
      '-ss',
      '1.2',
      '-i',
      outputPath,
      '-frames:v',
      '1',
      '-q:v',
      '2',
      thumbnailPath,
    ],
    60_000,
    'Das Short-Vorschaubild',
  );
  const renderedDuration = Number(
    (
      await processOutput(
        ffprobe,
        ['-v', 'error', '-show_entries', 'format=duration', '-of', 'default=nw=1:nk=1', outputPath],
        30_000,
        'Die Short-Prüfung',
      )
    ).trim(),
  );
  if (!Number.isFinite(renderedDuration) || Math.abs(renderedDuration - job.clip_duration_seconds) > 0.15) {
    throw new Error(`Der fertige Short hat ${renderedDuration.toFixed(2)} statt exakt 90 Sekunden.`);
  }
  await runProcess(ffprobe, ['-v', 'error', '-show_streams', '-show_format', outputPath], 30_000, 'Die Short-Prüfung');
  return { outputPath, thumbnailPath, commentary, speechSeconds };
}

async function upload(job: YoutubeShortJob, settings: YoutubeShortsSettings, env: NodeJS.ProcessEnv) {
  if (!job.output_path) throw new Error('Der Short wurde noch nicht gerendert.');
  const oauth = youtubeOAuthPublicStatus(env);
  const selectedChannelId = settings.youtube_channel_id.trim();
  const channelId = selectedChannelId || (oauth.channels.length === 1 ? oauth.channels[0]!.id : '');
  if (selectedChannelId && !oauth.channels.some((channel) => channel.id === selectedChannelId))
    throw new Error('Der eingestellte YouTube-Zielkanal ist nicht mehr autorisiert.');
  if (!channelId && oauth.channels.length > 1)
    throw new Error('Für den YouTube-Upload muss zuerst ein Zielkanal ausgewählt werden.');
  const publication = youtubeShortPublication(job, settings);
  const result = await uploadYoutubeVideoResumable(
    job.output_path,
    {
      title: publication.title,
      description: publication.description,
      tags: publication.tags,
      privacyStatus: publication.privacyStatus,
      containsSyntheticMedia: true,
    },
    { env, channelId: channelId || null },
  );
  await updateYoutubeShortJob(job.id, {
    status: 'uploaded',
    progress: 100,
    youtubeUploadId: result.id,
    youtubeUploadUrl: result.url,
    uploadPrivacy: publication.privacyStatus,
    error: null,
    metadata: { publication, uploadedChannelId: channelId || null },
    completed: true,
    uploaded: true,
  });
  return result;
}

export class YoutubeShortsProcessor {
  private timer: NodeJS.Timeout | null = null;
  private busy = false;
  private stopped = false;

  constructor(
    private readonly workerId: string,
    private readonly log: Log,
  ) {}

  async start(intervalMs = 12_000) {
    if (this.timer) return;
    this.stopped = false;
    await recoverStaleYoutubeShortJobs().catch(() => null);
    this.timer = setInterval(() => void this.tick(), intervalMs);
    this.timer.unref?.();
    setTimeout(() => void this.tick(), 1500).unref?.();
  }

  stop() {
    this.stopped = true;
    if (this.timer) clearInterval(this.timer);
    this.timer = null;
  }

  async tick() {
    if (this.busy || this.stopped) return;
    this.busy = true;
    let claimed: Awaited<ReturnType<typeof claimYoutubeShortJob>> = null;
    let activeStage: 'render' | 'upload' = 'render';
    try {
      const env = await runtimeEnvironment();
      const oauth = youtubeOAuthPublicStatus(env);
      const settings = await getYoutubeShortsSettings();
      const selectedChannelId = settings.youtube_channel_id.trim();
      const channelReady = selectedChannelId
        ? oauth.channels.some((channel) => channel.id === selectedChannelId)
        : oauth.channels.length <= 1;
      const uploadReady = oauth.connected && channelReady;
      claimed = await claimYoutubeShortJob(this.workerId, uploadReady);
      if (!claimed) return;
      if (claimed.claimMode === 'upload') {
        activeStage = 'upload';
        if (!settings.rights_confirmed)
          throw new Error('Die Rechtebestätigung für automatische YouTube-Uploads fehlt.');
        const result = await upload(claimed.job, settings, env);
        await resolveOperationalNotification(`youtube-short:${claimed.job.id}`).catch(() => null);
        this.log('youtube_short_uploaded', { jobId: claimed.job.id, youtubeVideoId: result.id });
        return;
      }
      const temporary = await mkdtemp(join(tmpdir(), `open-tv-short-${claimed.job.id}-`));
      try {
        await updateYoutubeShortJob(claimed.job.id, { status: 'downloading', progress: 8 });
        const source = await downloadClip(claimed.job, temporary);
        await updateYoutubeShortJob(claimed.job.id, { status: 'rendering', progress: 32 });
        const rendered = await renderShort(claimed.job, settings, source, temporary, env);
        const ready = await updateYoutubeShortJob(claimed.job.id, {
          status: 'ready',
          progress: 90,
          outputPath: rendered.outputPath,
          thumbnailPath: rendered.thumbnailPath,
          error: null,
          metadata: { commentary: rendered.commentary, speechSeconds: rendered.speechSeconds },
          completed: true,
        });
        await resolveOperationalNotification(`youtube-short:${claimed.job.id}`).catch(() => null);
        this.log('youtube_short_ready', { jobId: claimed.job.id, outputPath: rendered.outputPath });
        if (ready && settings.auto_upload && settings.rights_confirmed && uploadReady) {
          activeStage = 'upload';
          const result = await upload(ready, settings, env);
          this.log('youtube_short_uploaded', { jobId: ready.id, youtubeVideoId: result.id });
        } else if (settings.auto_upload && (!settings.rights_confirmed || !uploadReady)) {
          await upsertOperationalNotification({
            level: 'warning',
            component: 'youtube-shorts',
            dedupeKey: 'youtube-shorts:upload-setup',
            message: 'Ein Short ist fertig, der automatische YouTube-Upload wartet aber noch auf Freigabe.',
            details: {
              oauthConnected: oauth.connected,
              channelSelected: channelReady,
              authorizedChannels: oauth.channels.length,
              rightsConfirmed: settings.rights_confirmed,
              jobId: claimed.job.id,
            },
          }).catch(() => null);
        }
      } finally {
        await rm(temporary, { recursive: true, force: true });
      }
    } catch (error) {
      if (!claimed) return;
      const detail = compactError(error);
      const stage = activeStage;
      const failed = await failYoutubeShortJob(claimed.job.id, { stage, error: detail, retryable: true });
      if (!failed) {
        this.log('youtube_short_cancelled', { jobId: claimed.job.id, stage });
        return;
      }
      await upsertOperationalNotification({
        level: failed.status === 'failed' ? 'error' : 'warning',
        component: 'youtube-shorts',
        dedupeKey: `youtube-short:${claimed.job.id}`,
        message: `Short-Produktion für „${claimed.job.source_title}“ ist fehlgeschlagen.`,
        details: { jobId: claimed.job.id, stage, error: detail, retryAt: failed.next_attempt_at ?? null },
      }).catch(() => null);
      this.log('youtube_short_failed', { jobId: claimed.job.id, stage, error: detail });
    } finally {
      this.busy = false;
    }
  }
}
