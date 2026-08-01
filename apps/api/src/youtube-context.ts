import {
  prepareYoutubeContextAnalysis,
  resolveAvaEditorialStyle,
  type YoutubeContextAnalysisAiOutput,
} from '@ans/ai-provider';
import {
  failYoutubeEditorialAnalysis,
  failYoutubeTranscript,
  getSetting,
  getYoutubeVideo,
  markYoutubeEditorialAnalysisProcessing,
  markYoutubeTranscriptProcessing,
  saveYoutubeEditorialAnalysis,
  saveYoutubeTranscript,
  type YoutubeVideoRecord,
} from '@ans/database';
import { getAiStaffMember, recordAiStaffActivity, searchAiHostEditorialSources } from '@ans/database/ai-staff';
import { getYoutubePreproducedScript } from '@ans/database/youtube-preproduction';
import { resolveOperationalNotification, upsertOperationalNotification } from '@ans/database/notifications';
import { aiHostResearchTerms, buildAiHostResearchPackage } from './ai-host-research.js';
import { fetchYoutubeTranscript } from './youtube-transcript.js';

export type YoutubeContextPreparation = {
  status: 'ready' | 'news-fallback';
  analysis: YoutubeContextAnalysisAiOutput | null;
  model: string | null;
  fallbackReason: string | null;
  rateLimited: boolean;
  transcriptStatus: YoutubeVideoRecord['transcript_status'];
};

const runningPreparations = new Map<string, Promise<YoutubeContextPreparation>>();
let aiProviderBlockedUntil = 0;

function errorText(error: unknown) {
  return (error instanceof Error ? error.message : String(error)).replace(/\s+/g, ' ').trim().slice(0, 1500);
}

function boundedCopy(value: unknown, maximum: number) {
  return String(value ?? '')
    .replace(/\s+/g, ' ')
    .trim()
    .slice(0, maximum);
}

function statusCode(error: unknown) {
  if (!error || typeof error !== 'object') return 0;
  return Number((error as { statusCode?: unknown }).statusCode ?? 0);
}

function isRateLimited(error: unknown) {
  const message = errorText(error);
  return statusCode(error) === 429 || /(?:rate.?limit|zu viele anfragen|quota|429)/i.test(message);
}

function presenterEditorialPreferences(config: Record<string, unknown> | null | undefined) {
  const contextDepth = ['focused', 'balanced', 'detailed'].includes(String(config?.contextDepth))
    ? (config?.contextDepth as 'focused' | 'balanced' | 'detailed')
    : 'balanced';
  const moderationFrequency = ['restrained', 'balanced', 'active'].includes(String(config?.liveFrequency))
    ? (config?.liveFrequency as 'restrained' | 'balanced' | 'active')
    : 'balanced';
  const takeoverFrequency = ['rare', 'balanced', 'frequent'].includes(String(config?.takeoverFrequency))
    ? (config?.takeoverFrequency as 'rare' | 'balanced' | 'frequent')
    : 'balanced';
  return {
    contextDepth,
    moderationFrequency,
    inlineCommentaryEnabled: config?.inlineCommentaryEnabled !== false,
    inlineCommentaryIntervalSeconds: Math.max(
      90,
      Math.min(900, Number(config?.inlineCommentaryIntervalSeconds) || 180),
    ),
    takeoverFrequency,
    presenterStyle: resolveAvaEditorialStyle(config),
  };
}

function storedAnalysis(video: YoutubeVideoRecord) {
  if (video.editorial_analysis_status !== 'ready' || !video.editorial_analysis) return null;
  return video.editorial_analysis as YoutubeContextAnalysisAiOutput;
}

function recentFailure(video: YoutubeVideoRecord) {
  const transcriptFailureAt = video.transcript_fetched_at ? Date.parse(video.transcript_fetched_at) : 0;
  const transcriptCooldownMs = video.transcript_status === 'unavailable' ? 6 * 60 * 60_000 : 15 * 60_000;
  if (
    ['unavailable', 'error'].includes(video.transcript_status) &&
    Number.isFinite(transcriptFailureAt) &&
    transcriptFailureAt + transcriptCooldownMs > Date.now()
  ) {
    return {
      reason: video.transcript_error || 'YouTube-Transkript ist vorübergehend nicht verfügbar.',
      rateLimited: isRateLimited(video.transcript_error),
      transcriptStatus: video.transcript_status,
    };
  }
  const analysisFailureAt = video.editorial_analyzed_at ? Date.parse(video.editorial_analyzed_at) : 0;
  const analysisCooldownMs = isRateLimited(video.editorial_analysis_error) ? 15 * 60_000 : 5 * 60_000;
  if (
    video.transcript_status === 'ready' &&
    ['fallback', 'error'].includes(video.editorial_analysis_status) &&
    Number.isFinite(analysisFailureAt) &&
    analysisFailureAt + analysisCooldownMs > Date.now()
  ) {
    return {
      reason: video.editorial_analysis_error || 'Die KI-Redaktion wird in Kürze erneut versuchen.',
      rateLimited: isRateLimited(video.editorial_analysis_error),
      transcriptStatus: video.transcript_status,
    };
  }
  return null;
}

function isPermanentlyUnavailableTranscript(detail: string) {
  return (
    !isRateLimited(detail) &&
    /(?:kein abrufbares transkript|keine untertiteldatei erzeugt|transkript ist leer oder zu kurz|untertitel sind deaktiviert|no subtitles)/i.test(
      detail,
    )
  );
}

async function activity(
  staffMemberId: string,
  input: {
    eventType: string;
    title: string;
    detail?: string;
    status: string;
    metadata?: Record<string, unknown>;
  },
) {
  await recordAiStaffActivity({ staffMemberId, ...input }).catch(() => null);
}

function editorialQuestion(video: YoutubeVideoRecord, transcript: string) {
  const opening = transcript.slice(0, 2400);
  return `${video.title}. Zentrale Personen, Aussagen und Sachthemen aus dem Transkript: ${opening}`;
}

async function prepare(videoId: string, force: boolean): Promise<YoutubeContextPreparation> {
  let video = await getYoutubeVideo(videoId);
  if (!video) throw Object.assign(new Error('YouTube-Video nicht gefunden.'), { statusCode: 404 });
  const cached = storedAnalysis(video);
  if (cached && !force) {
    return {
      status: 'ready',
      analysis: cached,
      model: video.editorial_analysis_model,
      fallbackReason: null,
      rateLimited: false,
      transcriptStatus: video.transcript_status,
    };
  }
  const cachedFailure = force ? null : recentFailure(video);
  if (cachedFailure) {
    return {
      status: 'news-fallback',
      analysis: null,
      model: null,
      fallbackReason: cachedFailure.reason,
      rateLimited: cachedFailure.rateLimited,
      transcriptStatus: cachedFailure.transcriptStatus,
    };
  }

  let transcript = video.transcript_text?.trim() ?? '';
  if (!transcript || force) {
    await markYoutubeTranscriptProcessing(video.id);
    await activity('editor', {
      eventType: 'youtube_transcript_started',
      title: `Transkript wird ausgewertet: ${video.title}`,
      status: 'working',
      metadata: { youtubeVideoId: video.video_id, youtubeLibraryId: video.id, format: 'youtube-context' },
    });
    try {
      const fetched = await fetchYoutubeTranscript(video.video_id);
      transcript = fetched.text;
      video = (await saveYoutubeTranscript(video.id, fetched)) ?? video;
      await activity('editor', {
        eventType: 'youtube_transcript_completed',
        title: `Transkript erfasst: ${video.title}`,
        detail: `${transcript.length.toLocaleString('de-DE')} Zeichen · Sprache ${fetched.language}`,
        status: 'completed',
        metadata: {
          youtubeVideoId: video.video_id,
          youtubeLibraryId: video.id,
          transcriptSource: fetched.source,
          transcriptLanguage: fetched.language,
          format: 'youtube-context',
        },
      });
    } catch (error) {
      const detail = errorText(error);
      const unavailable = isPermanentlyUnavailableTranscript(detail);
      await failYoutubeTranscript(video.id, detail, unavailable ? 'unavailable' : 'error');
      await failYoutubeEditorialAnalysis(video.id, `Transkript nicht verfügbar: ${detail}`);
      await activity('editor', {
        eventType: 'youtube_transcript_failed',
        title: `News-Fallback für ${video.title}`,
        detail,
        status: 'warning',
        metadata: { youtubeVideoId: video.video_id, youtubeLibraryId: video.id, format: 'youtube-context' },
      });
      await upsertOperationalNotification({
        level: 'warning',
        component: 'KI-Redaktion',
        message: `YouTube-Einordnung nutzt News-Fallback: ${detail}`,
        dedupeKey: `youtube-context:${video.id}`,
        details: { youtubeLibraryId: video.id, title: video.title, stage: 'transcript' },
      }).catch(() => null);
      return {
        status: 'news-fallback',
        analysis: null,
        model: null,
        fallbackReason: detail,
        rateLimited: isRateLimited(detail),
        transcriptStatus: unavailable ? 'unavailable' : 'error',
      };
    }
  }

  if (Date.now() < aiProviderBlockedUntil) {
    const detail =
      'Der konfigurierte KI-Provider ist vorübergehend limitiert; aktuelle Nachrichten werden eingeblendet.';
    await failYoutubeEditorialAnalysis(video.id, detail);
    return {
      status: 'news-fallback',
      analysis: null,
      model: null,
      fallbackReason: detail,
      rateLimited: true,
      transcriptStatus: 'ready',
    };
  }

  await markYoutubeEditorialAnalysisProcessing(video.id);
  await activity('producer', {
    eventType: 'youtube_context_started',
    title: `YouTube-Einordnung wird geplant: ${video.title}`,
    status: 'working',
    metadata: { youtubeVideoId: video.video_id, youtubeLibraryId: video.id, format: 'youtube-context' },
  });
  try {
    const [ava, editorialProfile] = await Promise.all([
      getAiStaffMember('moderator').catch(() => null),
      getSetting<{
        mode?: string;
        label?: string;
      }>('studio.editorial-profile').catch(() => null),
    ]);
    const editorialPreferences = presenterEditorialPreferences(ava?.config);
    const researchQuestion = editorialQuestion(video, transcript);
    const terms = aiHostResearchTerms(researchQuestion, video.title);
    const editorialSources = await searchAiHostEditorialSources(terms, 6).catch(() => []);
    const research = await buildAiHostResearchPackage({
      question: researchQuestion,
      videoTitle: video.title,
      videoUrl: video.url,
      editorialSources,
      env: process.env,
    });
    await activity('fact-checker', {
      eventType: 'youtube_context_research_completed',
      title: `${research.sources.length} Quellen für die Einordnung geprüft`,
      detail: research.errors.join(' · ') || `Recherche-Einstufung: ${research.confidence}`,
      status: research.sources.length ? 'completed' : 'warning',
      metadata: {
        youtubeVideoId: video.video_id,
        youtubeLibraryId: video.id,
        format: 'youtube-context',
        query: research.query,
        confidence: research.confidence,
        sources: research.sources.map((source) => ({
          kind: source.kind,
          title: source.title,
          publisher: source.publisher,
          url: source.url,
          trustScore: source.trustScore,
        })),
      },
    });
    const result = await prepareYoutubeContextAnalysis({
      title: video.title,
      channel: video.channel_title,
      category: video.category_name,
      description: video.description,
      durationSeconds: video.duration_seconds,
      transcript,
      transcriptSegments: Array.isArray(video.transcript_segments) ? video.transcript_segments : [],
      transcriptLanguage: video.transcript_language,
      researchSources: research.sources.map((source) => ({
        title: source.title,
        publisher: source.publisher,
        url: source.url,
        excerpt: source.excerpt,
        trustScore: source.trustScore,
      })),
      moderatorInstructions: ava?.instructions,
      editorialMode: editorialProfile?.mode === 'satire' ? 'satire' : 'news',
      satireDisclosure: editorialProfile?.label ?? null,
      ...editorialPreferences,
    });
    const analysis = {
      ...result.output,
      researchSources: research.sources.map((source) => ({
        title: source.title,
        publisher: source.publisher,
        url: source.url,
      })),
    } satisfies YoutubeContextAnalysisAiOutput & {
      researchSources: Array<{ title: string; publisher: string; url: string }>;
    };
    await saveYoutubeEditorialAnalysis(video.id, analysis, result.model);
    await resolveOperationalNotification(`youtube-context:${video.id}`).catch(() => null);
    await activity('producer', {
      eventType: 'youtube_context_ready',
      title: `Einordnung sendefertig: ${video.title}`,
      detail: `${analysis.cards.length} Karten · ${analysis.pauseMoments.length} AVA-Pausen`,
      status: 'ready',
      metadata: {
        youtubeVideoId: video.video_id,
        youtubeLibraryId: video.id,
        format: 'youtube-context',
        model: result.model,
        tier: result.tier,
        usage: result.usage,
        editorialPreferences,
      },
    });
    return {
      status: 'ready',
      analysis,
      model: result.model,
      fallbackReason: null,
      rateLimited: false,
      transcriptStatus: 'ready',
    };
  } catch (error) {
    const detail = errorText(error);
    const rateLimited = isRateLimited(error);
    if (rateLimited) aiProviderBlockedUntil = Date.now() + 15 * 60_000;
    await failYoutubeEditorialAnalysis(video.id, detail);
    await activity('producer', {
      eventType: 'youtube_context_fallback',
      title: `News-Fallback für ${video.title}`,
      detail,
      status: 'warning',
      metadata: {
        youtubeVideoId: video.video_id,
        youtubeLibraryId: video.id,
        format: 'youtube-context',
        rateLimited,
      },
    });
    await upsertOperationalNotification({
      level: 'warning',
      component: 'KI-Redaktion',
      message: `YouTube-Einordnung nutzt News-Fallback: ${detail}`,
      dedupeKey: `youtube-context:${video.id}`,
      details: { youtubeLibraryId: video.id, title: video.title, stage: 'analysis', rateLimited },
    }).catch(() => null);
    return {
      status: 'news-fallback',
      analysis: null,
      model: null,
      fallbackReason: detail,
      rateLimited,
      transcriptStatus: 'ready',
    };
  }
}

export async function prepareYoutubeContextForVideo(
  videoId: string,
  options: { force?: boolean } = {},
): Promise<YoutubeContextPreparation> {
  if (options.force) return prepare(videoId, true);
  const [video, script] = await Promise.all([
    getYoutubeVideo(videoId),
    getYoutubePreproducedScript(videoId).catch(() => null),
  ]);
  if (video && script?.cues.length) {
    const cueCards = script.cues.slice(0, 12).map((cue) => ({
      kind:
        cue.kind === 'fact-check'
          ? ('fact-check' as const)
          : cue.kind === 'question'
            ? ('question' as const)
            : cue.kind === 'reaction'
              ? ('claim' as const)
              : ('context' as const),
      headline: boundedCopy(cue.headline, 180) || 'Einordnung',
      text: boundedCopy(cue.source_excerpt || cue.speaker_text, 1_200),
      sourceLabel: 'Video-Transkript · lokale Vorproduktion',
    }));
    while (cueCards.length < 4) cueCards.push({ ...cueCards[cueCards.length % script.cues.length]! });
    const pauses = script.cues.slice(0, 24).map((cue) => ({
      atPercent: Math.max(
        8,
        Math.min(92, Math.round((Number(cue.at_ms) / Math.max(1, Number(script.duration_ms))) * 100)),
      ),
      headline: boundedCopy(cue.headline, 160) || 'Einordnung',
      text: boundedCopy(cue.speaker_text, 700),
      question: boundedCopy(cue.audience_prompt, 260) || 'Welche Perspektive oder Quelle ergänzt diesen Punkt?',
      displayMode: cue.display_mode,
      wit: cue.wit,
    }));
    while (pauses.length < 2) {
      const source = pauses[0]!;
      pauses.push({ ...source, atPercent: Math.min(92, source.atPercent + 35) });
    }
    const excerpts = script.cues
      .map((cue) => boundedCopy(cue.source_excerpt, 300))
      .filter(Boolean)
      .slice(0, 6);
    const questions = script.cues
      .map((cue) => boundedCopy(cue.audience_prompt, 260))
      .filter(Boolean)
      .slice(0, 6);
    const analysis: YoutubeContextAnalysisAiOutput = {
      neutralSummary:
        excerpts.slice(0, 2).join(' ') ||
        'Die Runde ordnet die Aussagen des vorliegenden Transkripts nacheinander und quellenkritisch ein.',
      context: 'Lokale, zeitcodierte Einzelredaktion aus dem vorhandenen Video-Transkript.',
      keyClaims: excerpts.slice(0, 6).length
        ? excerpts.slice(0, 6)
        : ['Die zentrale Aussage wird im Sendungsverlauf geprüft.'],
      uncertainties: ['Aussagen des Videos gelten bis zu einer unabhängigen Quelle als Position des Beitrags.'],
      criticalQuestions:
        questions.length >= 2
          ? questions
          : ['Welche Quelle stützt diese Aussage?', 'Welche Gegenposition muss die Runde berücksichtigen?'],
      chatPrompts:
        questions.length >= 2
          ? questions.slice(0, 6)
          : ['Welche Perspektive fehlt?', 'Welche Aussage sollen wir genauer prüfen?'],
      cards: cueCards,
      pauseMoments: pauses,
    };
    return {
      status: 'ready',
      analysis,
      model: script.generator_version,
      fallbackReason: null,
      rateLimited: false,
      transcriptStatus: video.transcript_status,
    };
  }
  const existing = runningPreparations.get(videoId);
  if (existing) return existing;
  const job = prepare(videoId, false).finally(() => runningPreparations.delete(videoId));
  runningPreparations.set(videoId, job);
  return job;
}
