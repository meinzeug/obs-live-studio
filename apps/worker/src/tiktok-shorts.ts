import { access, mkdir, mkdtemp, rename, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import {
  claimTikTokShortJob,
  failTikTokShortJob,
  getTikTokShortsSettings,
  recoverStaleTikTokShortJobs,
  synchronizeTikTokShortJobs,
  updateTikTokShortJob,
  type TikTokShortJob,
  type TikTokShortsSettings,
} from '@ans/database/tiktok-shorts';
import type { YoutubeShortJob } from '@ans/database/youtube-shorts';
import { getAiPresenterProfile } from '@ans/database/ai-presenters';
import { resolveOperationalNotification, upsertOperationalNotification } from '@ans/database/notifications';
import {
  generatePremiumShortSpeech,
  getShortsPremiumSettings,
  refreshShortsQualityUpgradeNotification,
  shortsSpokenNarration,
} from './shorts-premium.js';
import {
  fetchTikTokPublishStatus,
  initializeTikTokDirectPost,
  uploadTikTokVideo,
  type TikTokCreatorInfo,
} from '../../api/src/tiktok-api.js';
import { TikTokOAuthManager } from '../../api/src/tiktok-oauth-manager.js';
import { PROJECT_ROOT } from './project-root.js';
import {
  compactError,
  downloadClip,
  executable,
  processOutput,
  resolvedPath,
  runProcess,
  runtimeEnvironment,
  sentenceExcerpt,
} from './youtube-shorts.js';
import { buildShortsVisualFilters, writeShortsLayoutTextFiles } from './shorts-layout.js';

type Log = (event: string, extra?: Record<string, unknown>) => void;

function sourceJob(job: TikTokShortJob): YoutubeShortJob {
  return {
    ...job,
    id: job.source_job_id,
    youtube_library_id: '',
    broadcast_item_id: null,
    ai_host_session_id: null,
    ai_staff_turn_id: null,
    status: 'ready',
    production_date: job.production_date,
    output_path: null,
    thumbnail_path: null,
    youtube_upload_id: null,
    youtube_upload_url: null,
    upload_privacy: null,
    attempts: 0,
    error: null,
    next_attempt_at: job.next_attempt_at,
    locked_at: null,
    locked_by: null,
    started_at: null,
    completed_at: null,
    uploaded_at: null,
    premium_planned_at: new Date().toISOString(),
    metadata: {},
    created_at: job.created_at,
    updated_at: job.updated_at,
  };
}

async function renderTikTokShort(
  job: TikTokShortJob,
  settings: TikTokShortsSettings,
  premiumSettings: Awaited<ReturnType<typeof getShortsPremiumSettings>>,
  sourcePath: string,
  directory: string,
  env: NodeJS.ProcessEnv,
) {
  const ffmpeg = await executable(env.FFMPEG_EXECUTABLE || 'ffmpeg', 'ffmpeg');
  const ffprobe = await executable(env.FFPROBE_EXECUTABLE || 'ffprobe', 'ffprobe');
  const layout = settings.layout_config;
  const presenter = await getAiPresenterProfile('moderator');
  const speakingPath = resolvedPath(
    presenter?.media.speaking?.rendered_path || './var/media/ai-host/youtube-context-speaking.webm',
  );
  const idlePath = resolvedPath(
    presenter?.media.idle?.rendered_path || './var/media/ai-host/youtube-context-idle.webm',
  );
  await Promise.all([access(speakingPath), access(idlePath)]);
  const commentary = sentenceExcerpt(job.commentary_text, 650);
  const speech = await generatePremiumShortSpeech(
    shortsSpokenNarration({
      sourceTitle: job.source_title,
      headline: job.commentary_headline,
      commentary,
      speakVideoTitle: premiumSettings.speak_video_title,
      targetSeconds: premiumSettings.narration_target_seconds,
    }),
    premiumSettings,
    env,
    presenter?.tts_voice || undefined,
  );
  const leadSeconds = 0.8;
  const speechSeconds = Math.max(1, Math.min(87.2, speech.durationSeconds));
  const idleTail = Math.max(1, 90 - leadSeconds - speechSeconds);
  const sourceHasAudio = Boolean(
    (
      await processOutput(
        ffprobe,
        ['-v', 'error', '-select_streams', 'a:0', '-show_entries', 'stream=index', '-of', 'csv=p=0', sourcePath],
        30_000,
        'Die Audio-Prüfung des TikTok-Ausschnitts',
      )
    ).trim(),
  );
  const textFiles = await writeShortsLayoutTextFiles(directory, layout, {
    formatLabel: layout.elements.formatLabel.text || 'AVA ORDNET EIN',
    title: job.source_title,
    commentary,
    source: `Quelle: ${job.source_channel}`.slice(0, 160),
  });
  const sourceVolume = settings.source_volume_percent / 100;
  const duckVolume = settings.source_duck_percent / 100;
  const filter = [
    ...buildShortsVisualFilters({
      layout,
      durationSeconds: 90,
      leadSeconds,
      speechSeconds,
      idleTail,
      sourceInput: 0,
      speakingInput: 1,
      idleInput: 2,
      textFiles,
    }),
    sourceHasAudio
      ? `[0:a]atrim=duration=90,asetpts=PTS-STARTPTS,volume='if(between(t,${leadSeconds.toFixed(2)},${(
          leadSeconds +
          speechSeconds +
          0.7
        ).toFixed(2)}),${duckVolume.toFixed(3)},${sourceVolume.toFixed(3)})':eval=frame[sourceaudio]`
      : 'anullsrc=r=48000:cl=stereo,atrim=duration=90[sourceaudio]',
    `[3:a]atrim=duration=${speechSeconds.toFixed(3)},asetpts=PTS-STARTPTS,adelay=${Math.round(leadSeconds * 1000)}:all=1,volume=1.28,apad,atrim=duration=90[voice]`,
    '[sourceaudio][voice]amix=inputs=2:duration=longest:dropout_transition=0:normalize=0,alimiter=limit=0.96,atrim=duration=90[audioout]',
  ].join(';');
  const outputDirectory = resolve(PROJECT_ROOT, 'var/media/shorts/tiktok');
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
      '90',
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
    'Der TikTok-Clip-Renderer',
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
    'Das TikTok-Vorschaubild',
  );
  const renderedDuration = Number(
    (
      await processOutput(
        ffprobe,
        ['-v', 'error', '-show_entries', 'format=duration', '-of', 'default=nw=1:nk=1', outputPath],
        30_000,
        'Die TikTok-Clip-Prüfung',
      )
    ).trim(),
  );
  if (!Number.isFinite(renderedDuration) || Math.abs(renderedDuration - 90) > 0.15)
    throw new Error(`Der fertige TikTok-Clip hat ${renderedDuration.toFixed(2)} statt exakt 90 Sekunden.`);
  return {
    outputPath,
    thumbnailPath,
    speechSeconds,
    speechProvider: speech.engine,
    speechFallback: speech.fallback,
    speechVoice: speech.voice,
  };
}

function validateCreator(job: TikTokShortJob, settings: TikTokShortsSettings, creator: TikTokCreatorInfo) {
  if (!job.privacy_level || !creator.privacyLevelOptions.includes(job.privacy_level))
    throw Object.assign(new Error('Die gewählte TikTok-Sichtbarkeit ist für dieses Konto nicht mehr verfügbar.'), {
      retryable: false,
    });
  if (!settings.app_audited && job.privacy_level !== 'SELF_ONLY')
    throw Object.assign(new Error('Nicht geprüfte TikTok-Apps dürfen nur privat (SELF_ONLY) veröffentlichen.'), {
      retryable: false,
    });
  if (creator.maxVideoPostDurationSec < 90)
    throw Object.assign(
      new Error(`Dieses TikTok-Konto erlaubt derzeit höchstens ${creator.maxVideoPostDurationSec} Sekunden.`),
      { retryable: false },
    );
  if (!job.rights_confirmed || !job.music_usage_confirmed)
    throw Object.assign(new Error('Rechte- und Musikbestätigung fehlen.'), { retryable: false });
}

function retryable(error: unknown) {
  if ((error as { retryable?: boolean })?.retryable === false) return false;
  const status = Number((error as { statusCode?: number })?.statusCode ?? 0);
  return status === 429 || status >= 500 || status === 0;
}

export class TikTokShortsProcessor {
  private timer: NodeJS.Timeout | null = null;
  private busy = false;
  private stopped = false;
  private readonly oauth = new TikTokOAuthManager();

  constructor(
    private readonly workerId: string,
    private readonly log: Log,
  ) {}

  async start(intervalMs = 12_000) {
    if (this.timer) return;
    this.stopped = false;
    await recoverStaleTikTokShortJobs().catch(() => null);
    this.timer = setInterval(() => void this.tick(), intervalMs);
    this.timer.unref?.();
    setTimeout(() => void this.tick(), 2_500).unref?.();
  }

  stop() {
    this.stopped = true;
    if (this.timer) clearInterval(this.timer);
    this.timer = null;
  }

  async tick() {
    if (this.busy || this.stopped) return;
    this.busy = true;
    let claimed: Awaited<ReturnType<typeof claimTikTokShortJob>> = null;
    try {
      await synchronizeTikTokShortJobs().catch(() => null);
      claimed = await claimTikTokShortJob(this.workerId);
      if (!claimed) return;
      const settings = await getTikTokShortsSettings();
      const premiumSettings = await getShortsPremiumSettings();
      if (claimed.mode === 'render') {
        const temporary = await mkdtemp(join(tmpdir(), `open-tv-tiktok-${claimed.job.id}-`));
        try {
          const env = await runtimeEnvironment();
          const source = await downloadClip(sourceJob(claimed.job), temporary);
          const rendered = await renderTikTokShort(claimed.job, settings, premiumSettings, source, temporary, env);
          await updateTikTokShortJob(claimed.job.id, {
            status: 'ready',
            progress: 90,
            outputPath: rendered.outputPath,
            thumbnailPath: rendered.thumbnailPath,
            error: null,
            metadata: {
              speechSeconds: rendered.speechSeconds,
              speechProvider: rendered.speechProvider,
              speechFallback: rendered.speechFallback,
              speechVoice: rendered.speechVoice,
              hqUpgradeQueued: false,
              ...(rendered.speechProvider === 'elevenlabs'
                ? { hqUpgradeCompletedAt: new Date().toISOString() }
                : { hqUpgradeFailedAt: new Date().toISOString() }),
              tiktokNativeRender: true,
            },
            completed: true,
          });
          await resolveOperationalNotification(`tiktok-short:${claimed.job.id}`).catch(() => null);
          await refreshShortsQualityUpgradeNotification().catch(() => null);
          this.log('tiktok_short_ready', { jobId: claimed.job.id, outputPath: rendered.outputPath });
        } finally {
          await rm(temporary, { recursive: true, force: true });
        }
        return;
      }
      const accessToken = await this.oauth.accessToken();
      if (claimed.mode === 'upload') {
        if (!claimed.job.output_path) throw new Error('Der TikTok-Clip wurde noch nicht gerendert.');
        const creator = await this.oauth.creatorInfo();
        validateCreator(claimed.job, settings, creator);
        const fileInfo = await import('node:fs/promises').then(({ stat }) => stat(claimed!.job.output_path!));
        const initialized = await initializeTikTokDirectPost(accessToken, fileInfo.size, {
          title: claimed.job.caption,
          privacyLevel: claimed.job.privacy_level!,
          disableComment: creator.commentDisabled || claimed.job.disable_comment,
          disableDuet: creator.duetDisabled || claimed.job.disable_duet,
          disableStitch: creator.stitchDisabled || claimed.job.disable_stitch,
          brandContentToggle: claimed.job.brand_content_toggle,
          brandOrganicToggle: claimed.job.brand_organic_toggle,
          isAigc: true,
        });
        await uploadTikTokVideo(initialized.uploadUrl, claimed.job.output_path, initialized.chunkSize);
        await updateTikTokShortJob(claimed.job.id, {
          status: 'processing',
          progress: 96,
          publishId: initialized.publishId,
          remoteStatus: 'PROCESSING_UPLOAD',
          nextAttemptAt: new Date(Date.now() + 15_000).toISOString(),
          metadata: { creatorUsername: creator.username, creatorNickname: creator.nickname },
        });
        this.log('tiktok_short_uploaded', { jobId: claimed.job.id, publishId: initialized.publishId });
        return;
      }
      if (!claimed.job.publish_id) throw Object.assign(new Error('TikTok Publish-ID fehlt.'), { retryable: false });
      const state = await fetchTikTokPublishStatus(accessToken, claimed.job.publish_id);
      if (state.status === 'FAILED')
        throw Object.assign(new Error(state.failReason || 'TikTok hat die Veröffentlichung abgelehnt.'), {
          retryable: false,
        });
      if (state.status === 'PUBLISH_COMPLETE') {
        const postId = state.postIds[0] || null;
        const username = String(claimed.job.metadata.creatorUsername ?? '').replace(/^@/, '');
        await updateTikTokShortJob(claimed.job.id, {
          status: 'published',
          progress: 100,
          postId,
          postUrl: postId && username ? `https://www.tiktok.com/@${username}/video/${postId}` : null,
          remoteStatus: state.status,
          error: null,
          published: true,
        });
        await resolveOperationalNotification(`tiktok-short:${claimed.job.id}`).catch(() => null);
        this.log('tiktok_short_published', { jobId: claimed.job.id, postId });
      } else {
        await updateTikTokShortJob(claimed.job.id, {
          status: 'processing',
          progress: Math.max(96, Math.min(99, claimed.job.progress)),
          remoteStatus: state.status || 'PROCESSING_UPLOAD',
          nextAttemptAt: new Date(Date.now() + 20_000).toISOString(),
          metadata: { uploadedBytes: state.uploadedBytes },
        });
      }
    } catch (error) {
      if (!claimed) return;
      const detail = compactError(error);
      const failed = await failTikTokShortJob(claimed.job.id, {
        stage: claimed.mode,
        error: detail,
        retryable: retryable(error),
      });
      await upsertOperationalNotification({
        level: failed?.status === 'failed' ? 'error' : 'warning',
        component: 'tiktok-shorts',
        dedupeKey: `tiktok-short:${claimed.job.id}`,
        message: `TikTok-Clip für „${claimed.job.source_title}“ konnte nicht verarbeitet werden.`,
        details: {
          jobId: claimed.job.id,
          stage: claimed.mode,
          error: detail,
          retryAt: failed?.next_attempt_at ?? null,
        },
      }).catch(() => null);
      this.log('tiktok_short_failed', { jobId: claimed.job.id, stage: claimed.mode, error: detail });
    } finally {
      this.busy = false;
    }
  }
}
