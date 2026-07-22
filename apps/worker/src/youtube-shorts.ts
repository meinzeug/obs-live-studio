import { spawn } from 'node:child_process';
import { existsSync } from 'node:fs';
import { access, mkdir, mkdtemp, readFile, readdir, rename, rm } from 'node:fs/promises';
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
import {
  ensurePremiumShortEditorial,
  generatePremiumShortSpeech,
  getShortsPremiumSettings,
  refreshShortsQualityUpgradeNotification,
  shortsNarrationForDuration,
} from './shorts-premium.js';
import { youtubeShortPublication } from '../../api/src/youtube-short-publication.js';
import { uploadYoutubeVideoResumable, youtubeOAuthPublicStatus } from '../../api/src/youtube-oauth.js';
import { PROJECT_ROOT } from './project-root.js';
import { buildShortsVisualFilters, writeShortsLayoutTextFiles } from './shorts-layout.js';

type Log = (event: string, extra?: Record<string, unknown>) => void;

export function resolvedPath(value: string) {
  if (value.startsWith('~/')) return resolve(process.env.HOME || PROJECT_ROOT, value.slice(2));
  return isAbsolute(value) ? resolve(value) : resolve(PROJECT_ROOT, value);
}

export async function executable(value: string, fallback: string) {
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

export function compactError(error: unknown) {
  return (error instanceof Error ? error.message : String(error)).replace(/\s+/g, ' ').trim().slice(0, 1800);
}

export async function runtimeEnvironment(): Promise<NodeJS.ProcessEnv> {
  try {
    const persisted = parseEnvironment(await readFile(resolve(PROJECT_ROOT, '.env'), 'utf8'));
    return { ...process.env, ...persisted };
  } catch {
    return { ...process.env };
  }
}

export async function runProcess(command: string, args: string[], timeoutMs: number, label: string) {
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

export async function processOutput(command: string, args: string[], timeoutMs: number, label: string) {
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

export async function downloadClip(job: YoutubeShortJob, directory: string) {
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

export function sentenceExcerpt(value: string, maximum = 360) {
  const clean = value.replace(/\s+/g, ' ').trim();
  if (clean.length <= maximum) return clean;
  const slice = clean.slice(0, maximum + 1);
  const sentence = Math.max(slice.lastIndexOf('. '), slice.lastIndexOf('? '), slice.lastIndexOf('! '));
  const word = slice.lastIndexOf(' ');
  return `${slice.slice(0, sentence >= maximum * 0.55 ? sentence + 1 : word > 0 ? word : maximum).trim()}…`;
}

export function wrappedText(value: string, columns = 34, lines = 5) {
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

export function escapeFilterPath(path: string) {
  return path.replaceAll('\\', '\\\\').replaceAll(':', '\\:').replaceAll("'", "\\'");
}

async function renderShort(
  job: YoutubeShortJob,
  settings: YoutubeShortsSettings,
  premiumSettings: Awaited<ReturnType<typeof getShortsPremiumSettings>>,
  sourcePath: string,
  directory: string,
  env: NodeJS.ProcessEnv,
) {
  const ffmpeg = await executable(env.FFMPEG_EXECUTABLE || 'ffmpeg', 'ffmpeg');
  const ffprobe = await executable(env.FFPROBE_EXECUTABLE || 'ffprobe', 'ffprobe');
  const layout = settings.layout_config;
  const overlayPath = resolvedPath(settings.overlay_path);
  if (layout.brandingOverlayVisible)
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
  const commentary = sentenceExcerpt(job.commentary_text, 650);
  const spokenHeadline = premiumSettings.speak_video_title
    ? `Das Video „${job.source_title}“. ${job.commentary_headline}`
    : job.commentary_headline;
  const speech = await generatePremiumShortSpeech(
    shortsNarrationForDuration(spokenHeadline, commentary, premiumSettings.narration_target_seconds),
    premiumSettings,
    env,
    presenter?.tts_voice || undefined,
  );
  const leadSeconds = 0.75;
  const speechSeconds = Math.max(1, Math.min(job.clip_duration_seconds - leadSeconds - 2, speech.durationSeconds));
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
  const textFiles = await writeShortsLayoutTextFiles(directory, layout, {
    formatLabel: layout.elements.formatLabel.text || 'AVA ORDNET EIN',
    title: job.source_title,
    commentary,
    source: `Quelle: ${job.source_channel}`.slice(0, 160),
  });
  const brandingInput = layout.brandingOverlayVisible ? 1 : undefined;
  const speakingInput = layout.brandingOverlayVisible ? 2 : 1;
  const idleInput = layout.brandingOverlayVisible ? 3 : 2;
  const speechInput = layout.brandingOverlayVisible ? 4 : 3;
  const filter = [
    ...buildShortsVisualFilters({
      layout,
      durationSeconds: job.clip_duration_seconds,
      leadSeconds,
      speechSeconds,
      idleTail,
      sourceInput: 0,
      speakingInput,
      idleInput,
      brandingInput,
      textFiles,
    }),
    sourceHasAudio
      ? `[0:a]atrim=duration=${job.clip_duration_seconds},asetpts=PTS-STARTPTS,volume='if(between(t,${leadSeconds.toFixed(2)},${(
          leadSeconds +
          speechSeconds +
          0.7
        ).toFixed(2)}),${duckVolume.toFixed(3)},${sourceVolume.toFixed(3)})':eval=frame[sourceaudio]`
      : `anullsrc=r=48000:cl=stereo,atrim=duration=${job.clip_duration_seconds}[sourceaudio]`,
    `[${speechInput}:a]atrim=duration=${speechSeconds.toFixed(3)},asetpts=PTS-STARTPTS,adelay=${Math.round(leadSeconds * 1000)}:all=1,volume=1.28,apad,atrim=duration=${job.clip_duration_seconds}[voice]`,
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
      ...(layout.brandingOverlayVisible ? ['-loop', '1', '-i', overlayPath] : []),
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
  return {
    outputPath,
    thumbnailPath,
    commentary,
    speechSeconds,
    speechProvider: speech.engine,
    speechFallback: speech.fallback,
    speechVoice: speech.voice,
  };
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
      const premiumSettings = await getShortsPremiumSettings();
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
      const plannedJob = await ensurePremiumShortEditorial(claimed.job, premiumSettings, env);
      const temporary = await mkdtemp(join(tmpdir(), `open-tv-short-${plannedJob.id}-`));
      try {
        await updateYoutubeShortJob(plannedJob.id, { status: 'downloading', progress: 8 });
        const source = await downloadClip(plannedJob, temporary);
        await updateYoutubeShortJob(plannedJob.id, { status: 'rendering', progress: 32 });
        const rendered = await renderShort(plannedJob, settings, premiumSettings, source, temporary, env);
        const ready = await updateYoutubeShortJob(plannedJob.id, {
          status: 'ready',
          progress: 90,
          outputPath: rendered.outputPath,
          thumbnailPath: rendered.thumbnailPath,
          error: null,
          metadata: {
            commentary: rendered.commentary,
            speechSeconds: rendered.speechSeconds,
            speechProvider: rendered.speechProvider,
            speechFallback: rendered.speechFallback,
            speechVoice: rendered.speechVoice,
            hqUpgradeQueued: false,
            ...(rendered.speechProvider === 'elevenlabs'
              ? { hqUpgradeCompletedAt: new Date().toISOString() }
              : { hqUpgradeFailedAt: new Date().toISOString() }),
          },
          completed: true,
        });
        await resolveOperationalNotification(`youtube-short:${claimed.job.id}`).catch(() => null);
        await refreshShortsQualityUpgradeNotification().catch(() => null);
        this.log('youtube_short_ready', { jobId: claimed.job.id, outputPath: rendered.outputPath });
        // A ready render is deliberately not uploaded in this tick. Every
        // upload—including a manually requested one—must be claimed on the next
        // tick so the database can atomically reserve a daily upload slot.
        if (ready && settings.enabled && settings.auto_upload && (!settings.rights_confirmed || !uploadReady)) {
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
