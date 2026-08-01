import { prepareYoutubeShowScript, youtubeShowCueTargetCount, type YoutubeShowScriptAiOutput } from '@ans/ai-provider';
import { getYoutubeVideo, type YoutubeVideoRecord } from '@ans/database';
import { getAiStaffMember } from '@ans/database/ai-staff';
import { getAiPresenterProfile } from '@ans/database/ai-presenters';
import {
  markYoutubePreproductionStatus,
  saveYoutubePreproducedScript,
  youtubeTranscriptHash,
  type YoutubePreproducedCueDraft,
} from '@ans/database/youtube-preproduction';
import { generateTtsAudio, ttsEnvironmentForAiPresenter } from './tts-generation.js';
import { prepareYoutubeContextForVideo } from './youtube-context.js';

export const YOUTUBE_PREPRODUCTION_GENERATOR_VERSION = 'codex-cli-complete-show-v1';

const presenterIds = [
  'moderator',
  'presenter-leon',
  'presenter-lea',
  'presenter-jonas',
  'chat-moderator',
  'presenter-karim',
] as const;

function videoDurationSeconds(video: YoutubeVideoRecord) {
  const finalSegment = Array.isArray(video.transcript_segments) ? video.transcript_segments.at(-1) : null;
  return Math.max(
    60,
    Math.floor(Number(video.duration_seconds ?? 0)),
    Math.ceil((Number(finalSegment?.startMs ?? 0) + Number(finalSegment?.durationMs ?? 0)) / 1000),
  );
}

function clean(value: unknown, maximum: number) {
  return String(value ?? '')
    .replace(/\s+/g, ' ')
    .trim()
    .slice(0, maximum);
}

export function validateYoutubeShowScript(
  output: YoutubeShowScriptAiOutput,
  durationSeconds: number,
): YoutubeShowScriptAiOutput['cues'] {
  const expected = youtubeShowCueTargetCount(durationSeconds);
  const cues = [...output.cues].sort((left, right) => left.atSeconds - right.atSeconds);
  if (cues.length !== expected)
    throw new Error(`Codex CLI lieferte ${cues.length} statt der erforderlichen ${expected} Sendungs-Cues.`);
  if (cues[0]?.kind !== 'intro' || cues[0].atSeconds > 5)
    throw new Error('Das Codex-Manuskript enthält kein sendefertiges Intro bei Sendungsbeginn.');
  if (cues.at(-1)?.kind !== 'closing' || cues.at(-1)!.atSeconds < durationSeconds * 0.88)
    throw new Error('Das Codex-Manuskript enthält kein Schlussfazit im letzten Sendungsabschnitt.');
  const contentCues = cues.filter((cue) => cue.kind !== 'intro' && cue.kind !== 'closing');
  if (!contentCues.length || contentCues.at(-1)!.atSeconds < durationSeconds * 0.78)
    throw new Error('Das Codex-Manuskript deckt die zweite Hälfte des Videos nicht ausreichend ab.');
  if (
    contentCues.some(
      (cue) =>
        clean(cue.sourceExcerpt, 1_200).length < 12 ||
        cue.sourceEndSeconds > cue.atSeconds ||
        cue.sourceStartSeconds > cue.sourceEndSeconds,
    )
  )
    throw new Error('Mindestens ein Codex-Cue ist nicht nachvollziehbar an eine vorherige Transkriptpassage gebunden.');
  if (cues.some((cue, index) => index > 0 && cue.atSeconds <= cues[index - 1]!.atSeconds))
    throw new Error('Die Codex-Cues sind nicht eindeutig und aufsteigend zeitcodiert.');
  if (cues.length >= 8) {
    const used = new Set(cues.map((cue) => cue.presenterId));
    const missing = presenterIds.filter((presenterId) => !used.has(presenterId));
    if (missing.length) throw new Error(`Das Codex-Manuskript lässt Moderatoren aus: ${missing.join(', ')}.`);
  }
  return cues;
}

function cueDrafts(
  output: YoutubeShowScriptAiOutput,
  durationSeconds: number,
): Array<
  Omit<
    YoutubePreproducedCueDraft,
    'audioPath' | 'audioDurationSeconds' | 'aiModel' | 'aiTier' | 'ttsEngine' | 'ttsVoice'
  >
> {
  return validateYoutubeShowScript(output, durationSeconds).map((cue) => ({
    atMs: Math.max(0, Math.min(durationSeconds * 1000 - 1_000, cue.atSeconds * 1000)),
    endMs: Math.max(0, Math.min(durationSeconds * 1000, cue.atSeconds * 1000 + 90_000)),
    presenterId: cue.presenterId,
    kind: cue.kind,
    displayMode: cue.kind === 'intro' || cue.kind === 'closing' ? 'takeover' : cue.displayMode,
    headline: clean(cue.headline, 180),
    speakerText: clean(cue.speakerText, 1_400),
    audiencePrompt: clean(cue.audiencePrompt, 320) || null,
    sourceExcerpt: clean(cue.sourceExcerpt, 1_200) || null,
    sourceStartMs: Math.max(0, cue.sourceStartSeconds * 1000),
    sourceEndMs: Math.max(0, Math.min(cue.atSeconds, cue.sourceEndSeconds) * 1000),
    wit: cue.wit,
  }));
}

async function renderCueAudio(
  cue: ReturnType<typeof cueDrafts>[number],
  aiModel: string,
): Promise<YoutubePreproducedCueDraft> {
  const [profile, member] = await Promise.all([
    getAiPresenterProfile(cue.presenterId).catch(() => null),
    getAiStaffMember(cue.presenterId).catch(() => null),
  ]);
  if (!member) throw new Error(`On-Air-Moderator ${cue.presenterId} ist nicht eingerichtet.`);
  const configuredPace = String(member.config?.speechPace ?? 'normal');
  const speechSpeed = configuredPace === 'relaxed' ? 0.9 : configuredPace === 'dynamic' ? 1.05 : 1;
  const voiceEnvironment = ttsEnvironmentForAiPresenter(
    cue.presenterId,
    {
      ...process.env,
      TTS_ENGINE: profile?.tts_provider || process.env.TTS_ENGINE,
      TTS_SPEED: String(speechSpeed),
    },
    profile?.tts_voice || undefined,
  );
  const speechText = `${cue.speakerText}${cue.audiencePrompt ? ` ${cue.audiencePrompt}` : ''}`;
  const audio = await generateTtsAudio(speechText, voiceEnvironment);
  return {
    ...cue,
    audioPath: audio.file,
    audioDurationSeconds: audio.durationSeconds,
    aiModel,
    aiTier: 'codex',
    ttsEngine: audio.engine,
    ttsVoice: audio.voice,
  };
}

async function renderAllCueAudio(cues: ReturnType<typeof cueDrafts>, aiModel: string, concurrency = 2) {
  const rendered = new Array<YoutubePreproducedCueDraft>(cues.length);
  let cursor = 0;
  const workers = Array.from({ length: Math.min(Math.max(1, concurrency), cues.length) }, async () => {
    while (cursor < cues.length) {
      const index = cursor;
      cursor += 1;
      rendered[index] = await renderCueAudio(cues[index]!, aiModel);
    }
  });
  await Promise.all(workers);
  return rendered;
}

export async function preproduceYoutubeVideo(
  videoOrId: YoutubeVideoRecord | string,
  options: { ttsConcurrency?: number; forceEditorialAnalysis?: boolean } = {},
) {
  const video = typeof videoOrId === 'string' ? await getYoutubeVideo(videoOrId) : videoOrId;
  if (!video) throw new Error('YouTube-Video nicht gefunden.');
  if (video.transcript_status !== 'ready' || !video.transcript_text?.trim())
    throw new Error('Vor der Codex-Vorproduktion muss ein vollständiges YouTube-Transkript vorliegen.');
  await markYoutubePreproductionStatus(video.id, 'processing');
  try {
    let editorial = await prepareYoutubeContextForVideo(video.id, {
      force: options.forceEditorialAnalysis === true,
    });
    if (editorial.status !== 'ready' || !editorial.analysis || !editorial.model?.startsWith('codex-cli')) {
      editorial = await prepareYoutubeContextForVideo(video.id, { force: true });
    }
    if (editorial.status !== 'ready' || !editorial.analysis)
      throw new Error(editorial.fallbackReason || 'Codex CLI konnte keine Redaktionsmappe erzeugen.');
    if (!editorial.model?.startsWith('codex-cli'))
      throw new Error(`Nicht zulässiges KI-Modell für die Vorproduktion: ${editorial.model ?? 'unbekannt'}.`);
    const durationSeconds = videoDurationSeconds(video);
    const result = await prepareYoutubeShowScript(
      {
        title: video.title,
        channel: video.channel_title,
        category: video.category_name,
        description: video.description,
        durationSeconds,
        transcript: video.transcript_text,
        transcriptSegments: Array.isArray(video.transcript_segments) ? video.transcript_segments : [],
        transcriptLanguage: video.transcript_language,
        editorialAnalysis: editorial.analysis,
        moderatorInstructions: (await getAiStaffMember('moderator').catch(() => null))?.instructions,
      },
      {
        env: {
          ...process.env,
          AI_PROVIDER: 'codex',
          OPENROUTER_FALLBACK: 'false',
          CODEX_CLI_TIMEOUT_MS: process.env.CODEX_CLI_TIMEOUT_MS || '900000',
        },
      },
    );
    if (result.tier !== 'codex' || !result.model.startsWith('codex-cli'))
      throw new Error(`Das Sendungsmanuskript stammt nicht aus Codex CLI (${result.model}).`);
    const drafts = cueDrafts(result.output, durationSeconds);
    const cues = await renderAllCueAudio(drafts, result.model, options.ttsConcurrency ?? 2);
    const script = await saveYoutubePreproducedScript({
      youtubeVideoId: video.id,
      transcriptHash: youtubeTranscriptHash(video),
      generatorVersion: YOUTUBE_PREPRODUCTION_GENERATOR_VERSION,
      productionModel: result.model,
      editorialSummary: result.output.editorialSummary,
      durationMs: durationSeconds * 1000,
      cues,
    });
    if (script.status !== 'ready') throw new Error(script.error || 'Das Sendepaket ist unvollständig.');
    return { script, cues, model: result.model, editorialModel: editorial.model };
  } catch (error) {
    await markYoutubePreproductionStatus(video.id, 'error', error instanceof Error ? error.message : String(error));
    throw error;
  }
}
