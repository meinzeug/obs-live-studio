import { resolve } from 'node:path';
import { preparePremiumShortEditorial, resolveAvaEditorialStyle, shouldUseAvaWit } from '@ans/ai-provider';
import { getAiStaffMember } from '@ans/database/ai-staff';
import {
  applyPremiumShortPlan,
  getShortsPremiumSettings,
  getShortsQualityUpgradeStatus,
  type ShortsPremiumSettings,
} from '@ans/database/shorts-premium';
import type { YoutubeShortJob } from '@ans/database/youtube-shorts';
import { resolveOperationalNotification, upsertOperationalNotification } from '@ans/database/notifications';
import { probeAudioDuration, synthesizeElevenLabs } from '@ans/tts-engine';
import { generateTtsAudio, ttsEnvironmentForAiPresenter } from '../../api/src/tts-generation.js';
import { PROJECT_ROOT } from './project-root.js';

function detail(error: unknown) {
  return (error instanceof Error ? error.message : String(error)).replace(/[\r\n]+/g, ' ').slice(0, 1200);
}

export async function refreshShortsQualityUpgradeNotification() {
  const status = await getShortsQualityUpgradeStatus();
  const queued = status.youtube.queued + status.tiktok.queued;
  if (queued === 0) {
    await resolveOperationalNotification('shorts-premium:hq-upgrade').catch(() => null);
    return status;
  }
  await upsertOperationalNotification({
    level: 'info',
    component: 'shorts-premium',
    dedupeKey: 'shorts-premium:hq-upgrade',
    message: `${queued} Shorts werden derzeit mit ElevenLabs hochwertig neu vertont.`,
    details: status,
  }).catch(() => null);
  return status;
}

export async function ensurePremiumShortEditorial(
  job: YoutubeShortJob,
  settings: ShortsPremiumSettings,
  env: NodeJS.ProcessEnv,
) {
  if (job.premium_planned_at && Object.keys(job.premium_plan ?? {}).length) return job;
  if (!settings.paid_llm_enabled)
    throw Object.assign(new Error('Die verpflichtende Paid-LLM-Redaktion für Shorts ist deaktiviert.'), {
      retryable: false,
    });
  const preferredPaidModels =
    settings.paid_llm_model_strategy === 'fixed' && settings.paid_llm_model.trim()
      ? [settings.paid_llm_model.trim()]
      : undefined;
  if (preferredPaidModels?.some((model) => model === 'openrouter/free' || model.includes(':free')))
    throw Object.assign(new Error('Für die Premium-Shorts-Redaktion ist ein kostenloses Modell konfiguriert.'), {
      retryable: false,
    });
  try {
    const ava = await getAiStaffMember('moderator').catch(() => null);
    const presenterStyle = resolveAvaEditorialStyle(ava?.config);
    const result = await preparePremiumShortEditorial(
      {
        title: job.source_title,
        channel: job.source_channel,
        sourceUrl: job.source_url,
        transcriptExcerpt: job.transcript_excerpt,
        existingHeadline: job.commentary_headline,
        existingCommentary: job.commentary_text,
        clipStartSeconds: job.clip_start_seconds,
        timeZone: env.TZ || 'Europe/Berlin',
        editorialInstructions: settings.editorial_instructions,
        presenterStyle,
        includeWit: shouldUseAvaWit(presenterStyle, job.youtube_video_id, 'shorts'),
      },
      {
        env: {
          ...env,
          OPENROUTER_PAID_FALLBACK: 'true',
          OPENROUTER_MAX_REQUEST_USD: String(settings.paid_llm_max_request_usd),
          OPENROUTER_DAILY_BUDGET_USD: String(settings.paid_llm_daily_budget_usd),
        },
        preferredPaidModels,
      },
    );
    const updated = await applyPremiumShortPlan(job.id, {
      plan: result.output,
      model: result.model,
      usage: { ...result.usage, tier: result.tier },
    });
    if (!updated)
      throw Object.assign(new Error('Der Short wurde während der Premium-Planung entfernt.'), { retryable: false });
    await resolveOperationalNotification('shorts-premium:editorial').catch(() => null);
    return updated;
  } catch (error) {
    await upsertOperationalNotification({
      level: 'error',
      component: 'shorts-premium',
      dedupeKey: 'shorts-premium:editorial',
      message: 'Die Premium-Redaktion konnte Short-Konzept, Titel, Beschreibung oder Planung nicht erzeugen.',
      details: {
        jobId: job.id,
        sourceTitle: job.source_title,
        modelStrategy: settings.paid_llm_model_strategy,
        configuredModel: settings.paid_llm_model || null,
        error: detail(error),
        requiredAction: 'OpenRouter-Verbindung und Premium-Budget in den Shorts-Einstellungen prüfen.',
      },
    }).catch(() => null);
    throw error;
  }
}

export async function generatePremiumShortSpeech(
  text: string,
  settings: ShortsPremiumSettings,
  env: NodeJS.ProcessEnv,
  presenterVoice?: string,
) {
  const apiKey = env.ELEVENLABS_API_KEY?.trim() ?? '';
  const voiceId = settings.elevenlabs_voice_id.trim();
  if (settings.elevenlabs_enabled && apiKey && voiceId) {
    try {
      const speech = await synthesizeElevenLabs(text, {
        apiKey,
        voiceId,
        modelId: settings.elevenlabs_model_id,
        outputFormat: settings.elevenlabs_output_format,
        stability: settings.elevenlabs_stability,
        similarityBoost: settings.elevenlabs_similarity_boost,
        style: settings.elevenlabs_style,
        speakerBoost: settings.elevenlabs_speaker_boost,
        outputGainDb: 3,
        outputDirectory: resolve(PROJECT_ROOT, 'var/tts/shorts-premium'),
        ffmpegExecutable: env.FFMPEG_EXECUTABLE || 'ffmpeg',
        timeoutMs: 120_000,
      });
      const durationSeconds = await probeAudioDuration(speech.file, env.FFPROBE_EXECUTABLE || 'ffprobe', 30_000);
      await resolveOperationalNotification('shorts-premium:elevenlabs').catch(() => null);
      return {
        ...speech,
        durationSeconds,
        engine: 'elevenlabs',
        configuredEngine: 'elevenlabs',
        voice: settings.elevenlabs_voice_name || voiceId,
        fallback: false,
      };
    } catch (error) {
      await upsertOperationalNotification({
        level: settings.local_tts_fallback ? 'warning' : 'error',
        component: 'shorts-premium',
        dedupeKey: 'shorts-premium:elevenlabs',
        message: settings.local_tts_fallback
          ? 'ElevenLabs ist für Shorts ausgefallen. Die Produktion verwendet automatisch das lokale TTS-Fallback.'
          : 'ElevenLabs ist für Shorts ausgefallen und der lokale TTS-Fallback ist deaktiviert.',
        details: { error: detail(error), voiceId, modelId: settings.elevenlabs_model_id },
      }).catch(() => null);
      if (!settings.local_tts_fallback) throw error;
    }
  } else {
    const missing = !settings.elevenlabs_enabled ? 'deaktiviert' : !apiKey ? 'API-Key fehlt' : 'Stimme fehlt';
    await upsertOperationalNotification({
      level: settings.local_tts_fallback ? 'warning' : 'error',
      component: 'shorts-premium',
      dedupeKey: 'shorts-premium:elevenlabs',
      message: settings.local_tts_fallback
        ? `ElevenLabs ist nicht sendebereit (${missing}). Shorts verwenden das lokale TTS-Fallback.`
        : `ElevenLabs ist nicht sendebereit (${missing}).`,
      details: { missing, requiredAction: 'ElevenLabs in den YouTube- oder TikTok-Shorts-Einstellungen verbinden.' },
    }).catch(() => null);
    if (!settings.local_tts_fallback) throw new Error(`ElevenLabs ist nicht sendebereit: ${missing}.`);
  }
  const speech = await generateTtsAudio(text, ttsEnvironmentForAiPresenter('moderator', env, presenterVoice));
  return { ...speech, fallback: true };
}

export { getShortsPremiumSettings };
