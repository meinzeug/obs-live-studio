import {
  prepareYoutubeShowScript,
  youtubeShowCueTimes,
  type YoutubeShowCueTarget,
  type YoutubeShowScriptAiOutput,
} from '@ans/ai-provider';
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

export const YOUTUBE_PREPRODUCTION_GENERATOR_VERSION = 'codex-cli-complete-show-discussion-20-40-v2';

const presenterIds = [
  'moderator',
  'presenter-leon',
  'presenter-lea',
  'presenter-jonas',
  'chat-moderator',
  'presenter-karim',
] as const;

const presenterNames = {
  moderator: 'Ava',
  'presenter-leon': 'Leon',
  'presenter-lea': 'Lea',
  'presenter-jonas': 'Jonas',
  'chat-moderator': 'Mia',
  'presenter-karim': 'Karim',
  translator: 'Nora',
} as const;

function normalizedLanguage(value: unknown) {
  return String(value ?? '')
    .trim()
    .toLowerCase()
    .replace('_', '-');
}

function looksEnglishTitle(value: string) {
  const words = value.toLowerCase().match(/[a-z]+/g) ?? [];
  const markers = new Set(['the', 'and', 'with', 'from', 'into', 'live', 'breaking', 'news', 'coverage', 'crisis']);
  return words.filter((word) => markers.has(word)).length >= 2;
}

export function youtubeVideoNeedsGermanTranslation(
  video: Pick<YoutubeVideoRecord, 'title' | 'transcript_language' | 'transcript_source' | 'source_language'>,
) {
  const sourceLanguage = normalizedLanguage(video.source_language);
  if (sourceLanguage)
    return !['de', 'deu', 'ger'].some((code) => sourceLanguage === code || sourceLanguage.startsWith(`${code}-`));
  const transcriptLanguage = normalizedLanguage(video.transcript_language);
  if (transcriptLanguage && !transcriptLanguage.startsWith('de')) return true;
  return video.transcript_source === 'yt-dlp' && looksEnglishTitle(video.title);
}

function discussionMove(index: number): YoutubeShowCueTarget['discussionMove'] {
  return ['agree-expand', 'challenge', 'fact-check', 'consequence', 'audience', 'synthesize'][
    index % 6
  ]! as YoutubeShowCueTarget['discussionMove'];
}

export function youtubeShowCueTargets(durationSeconds: number, translateToGerman: boolean): YoutubeShowCueTarget[] {
  const times = youtubeShowCueTimes(durationSeconds);
  const moderatorCount = Math.max(times.length, presenterIds.length);
  const timeIndexes = Array.from({ length: moderatorCount }, (_, index) => {
    if (moderatorCount === times.length) return index;
    if (index === 0) return 0;
    if (index === moderatorCount - 1) return times.length - 1;
    if (moderatorCount > times.length && index === moderatorCount - 2) return times.length - 1;
    return 1 + Math.floor(((index - 1) * Math.max(0, times.length - 2)) / Math.max(1, moderatorCount - 3));
  });
  const targets: YoutubeShowCueTarget[] = [];
  let previousModerator: (typeof presenterIds)[number] | null = null;
  for (let index = 0; index < moderatorCount; index += 1) {
    const timeIndex = timeIndexes[index]!;
    const atSeconds = times[timeIndex]!;
    const opening = index === 0;
    const closing = index === moderatorCount - 1;
    const moderator = presenterIds[index % presenterIds.length]!;
    const newTimeGroup = index > 0 && timeIndex !== timeIndexes[index - 1];
    if (translateToGerman && (opening || newTimeGroup)) {
      targets.push({
        atSeconds,
        presenterId: 'translator',
        kind: 'translation',
        respondsToPresenterId: previousModerator ?? 'none',
        handoffToPresenterId: moderator,
        discussionMove: 'translate',
      });
    }
    const nextModerator = presenterIds[(index + 1) % presenterIds.length]!;
    const nextStartsNewTimeGroup = !closing && timeIndexes[index + 1] !== timeIndex;
    targets.push({
      atSeconds,
      presenterId: moderator,
      kind: opening
        ? 'intro'
        : closing
          ? 'closing'
          : index % 6 === 2
            ? 'fact-check'
            : index % 6 === 4
              ? 'question'
              : index % 3 === 0
                ? 'reaction'
                : 'context',
      respondsToPresenterId: opening ? 'none' : previousModerator!,
      handoffToPresenterId: closing
        ? 'none'
        : translateToGerman && nextStartsNewTimeGroup
          ? 'translator'
          : nextModerator,
      discussionMove: opening ? 'open' : closing ? 'close' : discussionMove(index),
    });
    previousModerator = moderator;
  }
  return targets;
}

function cueTargetChunks(targets: YoutubeShowCueTarget[], maximum = 72) {
  const chunks: YoutubeShowCueTarget[][] = [];
  for (let offset = 0; offset < targets.length;) {
    let size = Math.min(maximum, targets.length - offset);
    if (targets.length - offset - size > 0 && targets.length - offset - size < 3) size -= 3;
    chunks.push(targets.slice(offset, offset + size));
    offset += size;
  }
  return chunks;
}

function videoDurationSeconds(video: YoutubeVideoRecord) {
  const finalSegment = Array.isArray(video.transcript_segments) ? video.transcript_segments.at(-1) : null;
  const declaredDuration = Math.floor(Number(video.duration_seconds ?? 0));
  if (Number.isFinite(declaredDuration) && declaredDuration > 0) return declaredDuration;
  return Math.max(1, Math.ceil((Number(finalSegment?.startMs ?? 0) + Number(finalSegment?.durationMs ?? 0)) / 1000));
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
  requiredTargets = youtubeShowCueTargets(durationSeconds, false),
): YoutubeShowScriptAiOutput['cues'] {
  const cues = [...output.cues];
  if (cues.length !== requiredTargets.length)
    throw new Error(
      `Codex CLI lieferte ${cues.length} statt der erforderlichen ${requiredTargets.length} Sendungs-Cues.`,
    );
  const mismatchedTarget = cues.findIndex((cue, index) => {
    const target = requiredTargets[index]!;
    return (
      cue.atSeconds !== target.atSeconds ||
      cue.presenterId !== target.presenterId ||
      cue.kind !== target.kind ||
      cue.respondsToPresenterId !== target.respondsToPresenterId ||
      cue.handoffToPresenterId !== target.handoffToPresenterId ||
      cue.discussionMove !== target.discussionMove
    );
  });
  if (mismatchedTarget >= 0)
    throw new Error(`Codex CLI hat den verbindlichen Sendeplan bei Cue ${mismatchedTarget + 1} verändert.`);
  const completeShow =
    requiredTargets[0]?.atSeconds === 0 && requiredTargets.at(-1)!.atSeconds >= durationSeconds * 0.88;
  const introCue = cues.find((cue) => cue.kind === 'intro');
  if (completeShow && (!introCue || introCue.atSeconds > 5))
    throw new Error('Das Codex-Manuskript enthält kein sendefertiges Intro bei Sendungsbeginn.');
  if (completeShow && (cues.at(-1)?.kind !== 'closing' || cues.at(-1)!.atSeconds < durationSeconds * 0.88))
    throw new Error('Das Codex-Manuskript enthält kein Schlussfazit im letzten Sendungsabschnitt.');
  const contentCues = cues.filter((cue) => cue.kind !== 'intro' && cue.kind !== 'closing');
  if (completeShow && (!contentCues.length || contentCues.at(-1)!.atSeconds < durationSeconds * 0.78))
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
  if (cues.some((cue, index) => index > 0 && cue.atSeconds < cues[index - 1]!.atSeconds))
    throw new Error('Die Codex-Cues sind nicht aufsteigend zeitcodiert.');
  const distinctTimes = [...new Set(cues.map((cue) => cue.atSeconds))];
  if (
    distinctTimes.some(
      (atSeconds, index) =>
        index > 0 && (atSeconds - distinctTimes[index - 1]! < 20 || atSeconds - distinctTimes[index - 1]! > 40),
    )
  )
    throw new Error('Das Codex-Manuskript verletzt den verbindlichen Einordnungsabstand von 20 bis 40 Sekunden.');
  if (cues.length >= 8) {
    const used = new Set(cues.map((cue) => cue.presenterId));
    const missing = presenterIds.filter((presenterId) => !used.has(presenterId));
    if (missing.length) throw new Error(`Das Codex-Manuskript lässt Moderatoren aus: ${missing.join(', ')}.`);
  }
  for (const cue of cues) {
    if (cue.presenterId === 'translator') continue;
    const expectedResponds = cue.respondsToPresenterId === 'none' ? null : presenterNames[cue.respondsToPresenterId];
    const expectedHandoff = cue.handoffToPresenterId === 'none' ? null : presenterNames[cue.handoffToPresenterId];
    if (
      expectedResponds &&
      !cue.speakerText.toLocaleLowerCase('de-DE').includes(expectedResponds.toLocaleLowerCase('de-DE'))
    )
      throw new Error(`${presenterNames[cue.presenterId]} reagiert nicht hörbar auf ${expectedResponds}.`);
    if (
      expectedHandoff &&
      !cue.speakerText.toLocaleLowerCase('de-DE').includes(expectedHandoff.toLocaleLowerCase('de-DE'))
    )
      throw new Error(`${presenterNames[cue.presenterId]} übergibt nicht hörbar an ${expectedHandoff}.`);
  }
  return cues;
}

function cueDrafts(
  output: YoutubeShowScriptAiOutput,
  durationSeconds: number,
  requiredTargets?: YoutubeShowCueTarget[],
): Array<
  Omit<
    YoutubePreproducedCueDraft,
    'audioPath' | 'audioDurationSeconds' | 'aiModel' | 'aiTier' | 'ttsEngine' | 'ttsVoice'
  >
> {
  return validateYoutubeShowScript(output, durationSeconds, requiredTargets).map((cue) => ({
    atMs: Math.max(0, Math.min(durationSeconds * 1000 - 1_000, cue.atSeconds * 1000)),
    endMs: Math.max(0, Math.min(durationSeconds * 1000, cue.atSeconds * 1000 + 90_000)),
    presenterId: cue.presenterId,
    kind: cue.kind,
    respondsToPresenterId: cue.respondsToPresenterId === 'none' ? null : cue.respondsToPresenterId,
    handoffToPresenterId: cue.handoffToPresenterId === 'none' ? null : cue.handoffToPresenterId,
    discussionMove: cue.discussionMove,
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
  await markYoutubePreproductionStatus(video.id, 'processing', null, YOUTUBE_PREPRODUCTION_GENERATOR_VERSION);
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
    const translateToGerman = youtubeVideoNeedsGermanTranslation(video);
    const targets = youtubeShowCueTargets(durationSeconds, translateToGerman);
    const targetChunks = cueTargetChunks(targets);
    const segments = Array.isArray(video.transcript_segments) ? video.transcript_segments : [];
    const results = [];
    for (const [chunkIndex, chunkTargets] of targetChunks.entries()) {
      const firstSecond = Math.max(0, chunkTargets[0]!.atSeconds - 45);
      const lastSecond = chunkTargets.at(-1)!.atSeconds + 3;
      const chunkSegments = segments.filter((segment) => {
        const startSeconds = Number(segment.startMs ?? 0) / 1_000;
        const endSeconds = startSeconds + Number(segment.durationMs ?? 0) / 1_000;
        return endSeconds >= firstSecond && startSeconds <= lastSecond;
      });
      const result = await prepareYoutubeShowScript(
        {
          title: video.title,
          channel: video.channel_title,
          category: video.category_name,
          description: video.description,
          durationSeconds,
          transcript: video.transcript_text,
          transcriptSegments: chunkSegments,
          transcriptLanguage: video.transcript_language,
          sourceLanguage: video.source_language,
          editorialAnalysis: editorial.analysis,
          moderatorInstructions: (await getAiStaffMember('moderator').catch(() => null))?.instructions,
          cueTargets: chunkTargets,
          chunkIndex: chunkIndex + 1,
          chunkCount: targetChunks.length,
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
      validateYoutubeShowScript(result.output, durationSeconds, chunkTargets);
      results.push(result);
    }
    const productionModel = results[0]?.model;
    if (!productionModel) throw new Error('Codex CLI hat kein Sendungsmanuskript geliefert.');
    const completeOutput: YoutubeShowScriptAiOutput = {
      editorialSummary: results
        .map((result) => result.output.editorialSummary)
        .join(' ')
        .slice(0, 1_800),
      cues: results.flatMap((result) => result.output.cues),
    };
    const drafts = cueDrafts(completeOutput, durationSeconds, targets);
    const cues = await renderAllCueAudio(drafts, productionModel, options.ttsConcurrency ?? 3);
    const script = await saveYoutubePreproducedScript({
      youtubeVideoId: video.id,
      transcriptHash: youtubeTranscriptHash(video),
      generatorVersion: YOUTUBE_PREPRODUCTION_GENERATOR_VERSION,
      productionModel,
      editorialSummary: completeOutput.editorialSummary,
      durationMs: durationSeconds * 1000,
      cues,
    });
    if (script.status !== 'ready') throw new Error(script.error || 'Das Sendepaket ist unvollständig.');
    return { script, cues, model: productionModel, editorialModel: editorial.model, translateToGerman };
  } catch (error) {
    await markYoutubePreproductionStatus(video.id, 'error', error instanceof Error ? error.message : String(error));
    throw error;
  }
}
