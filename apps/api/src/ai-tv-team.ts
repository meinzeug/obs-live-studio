import type { FastifyInstance, FastifyReply, FastifyRequest } from 'fastify';
import { z } from 'zod';
import {
  createYoutubeHostChatResponse,
  prepareYoutubeHostBriefing,
  runAiStaffAssignment,
  type HostBriefingAiOutput,
} from '@ans/ai-provider';
import {
  activeAiHostSession,
  aiHostTurnMetricsLastHour,
  aiStaffTaskMetrics,
  aiTeamActivity,
  claimNextAiStaffTask,
  completeAiStaffTask,
  createAiStaffTask,
  createAiStaffTurn,
  currentAiStaffTurn,
  endActiveAiHostSession,
  failAiStaffTask,
  getAiHostSettings,
  getAiStaffMember,
  getAiStaffTask,
  getAiStaffTurn,
  insertAiHostChatMessages,
  latestAiStaffTurns,
  listAiStaffActivity,
  listAiStaffMembersWithWorkState,
  listAiStaffTasks,
  markAiStaffVoiceAttempt,
  markAiStaffVoiceFailure,
  markAiHostChatMessagesUsed,
  nextAiStaffVoiceTurn,
  recentAiChatCommentaries,
  recordAiStaffActivity,
  searchAiHostEditorialSources,
  setAiStaffTurnAudio,
  startAiHostSession,
  transitionAiStaffTask,
  unusedAiHostChatMessages,
  upcomingAiStaffVoiceTurn,
  updateAiHostSession,
  updateAiHostSettings,
  updateAiStaffMember,
  updateAiStaffTurnStatus,
  youtubeItemForAiHost,
  type AiHostSession,
  type AiHostSettings,
  type AiHostChatMessage,
  type AiStaffTurn,
} from '@ans/database/ai-staff';
import { getPlaybackSnapshot, getYoutubeContextPlaybackControl } from '@ans/database';
import { getAiPresenterProfile } from '@ans/database/ai-presenters';
import { auditLog } from '@ans/database/auth';
import {
  createGrowthMoment,
  getGrowthSettings,
  growthSummary,
  listGrowthMoments,
  updateGrowthMomentStatus,
  updateGrowthSettings,
} from '@ans/database/growth';
import type { WritePermission } from '@ans/security/auth';
import { generateTtsAudio, ttsEnvironmentForAiPresenter } from './tts-generation.js';
import { fetchYoutubeLiveChatPage, resolveYoutubeLiveChatId } from './youtube-live-chat.js';
import { TwitchLiveChatClient, twitchChannelName } from './twitch-live-chat.js';
import { aiHostAvatarVideoUrl, configuredAiHostAvatarVideoPaths } from './ai-host-avatar.js';
import {
  analyzeChatActivity,
  addressChatResponse,
  ensureResearchAttribution,
  ensureVerifiedResearchAnswer,
  fitChatResponseToDuration,
  isDirectChatQuestion,
  isRepeatedChatDiscussion,
  limitedResearchChatAnswer,
  resolveChatDiscussionPolicy,
  safeChatDisplayName,
  type ChatActivityAnalysis,
  type ChatActivityMessage,
} from './ai-host-chat.js';
import { aiHostResearchTerms, buildAiHostResearchPackage, type AiHostResearchPackage } from './ai-host-research.js';
import { aiHostOverlayDurationSeconds } from './ai-host-timing.js';
import { prepareYoutubeContextForVideo } from './youtube-context.js';

type EmitUpdate = (reason: string, payload?: Record<string, unknown>) => Promise<void>;
type RuntimeChatActivityMessage = AiHostChatMessage & ChatActivityMessage;

function stringArray(value: unknown) {
  return Array.isArray(value)
    ? value.filter((item): item is string => typeof item === 'string' && Boolean(item.trim()))
    : [];
}

function fallbackBriefing(video: Awaited<ReturnType<typeof youtubeItemForAiHost>>): HostBriefingAiOutput {
  const description = video?.description?.replace(/\s+/g, ' ').trim();
  return {
    neutralSummary:
      description?.slice(0, 780) ||
      `Im laufenden Video „${video?.title ?? 'YouTube-Video'}“ stellt der Kanal ${video?.channel_title ?? 'YouTube'} sein Thema vor.`,
    context: `Das Video stammt vom YouTube-Kanal ${video?.channel_title ?? 'Unbekannt'}. Aussagen des Videos werden in der Sendung als Position des jeweiligen Urhebers behandelt.`,
    keyClaims: [video?.title ?? 'Thema des laufenden Videos'],
    uncertainties: [
      'Für eine belastbare Bewertung müssen die im Video genannten Primärquellen einzeln geprüft werden.',
    ],
    criticalQuestions: [
      'Welche konkrete Aussage im Video überzeugt dich – und auf welche Quelle stützt du dich?',
      'Welche wichtige Gegenposition oder Information fehlt aus deiner Sicht?',
      'Woran ließe sich die zentrale Aussage des Videos nachvollziehbar überprüfen?',
    ],
    chatPrompts: [
      'Schreib deine begründete Meinung in den Chat.',
      'Welche Frage soll die Redaktion als Nächstes aufgreifen?',
    ],
  };
}

function safeDate(value: string | null | undefined, fallbackMs = Date.now()) {
  const timestamp = value ? Date.parse(value) : Number.NaN;
  return Number.isFinite(timestamp) ? timestamp : fallbackMs;
}

function limitedLiveText(value: unknown, maximum: number) {
  return String(value ?? '')
    .replace(/\s+/g, ' ')
    .trim()
    .slice(0, maximum);
}

function turnStatus(settings: AiHostSettings, autonomy: string | undefined): AiStaffTurn['status'] {
  return settings.interaction_mode === 'review' || autonomy === 'review' ? 'pending' : 'approved';
}

function turnDurationSeconds(settings: AiHostSettings) {
  return aiHostOverlayDurationSeconds(settings.response_duration_seconds);
}

type PresenterLiveFrequency = 'restrained' | 'balanced' | 'active';
type PresenterContextDepth = 'focused' | 'balanced' | 'detailed';
type PresenterResponseDetail = 'compact' | 'balanced' | 'detailed';

function presenterLiveFrequency(member: Awaited<ReturnType<typeof getAiStaffMember>>): PresenterLiveFrequency {
  const value = String(member?.config?.liveFrequency ?? 'balanced');
  return value === 'restrained' || value === 'active' ? value : 'balanced';
}

function presenterResponseDetail(member: Awaited<ReturnType<typeof getAiStaffMember>>): PresenterResponseDetail {
  const value = String(member?.config?.responseDetail ?? 'balanced');
  return value === 'compact' || value === 'detailed' ? value : 'balanced';
}

function presenterContextDepth(member: Awaited<ReturnType<typeof getAiStaffMember>>): PresenterContextDepth {
  const value = String(member?.config?.contextDepth ?? 'balanced');
  return value === 'focused' || value === 'detailed' ? value : 'balanced';
}

function presenterIntervalSeconds(baseSeconds: number, frequency: PresenterLiveFrequency) {
  const multiplier = frequency === 'active' ? 0.55 : frequency === 'restrained' ? 1.5 : 1;
  return Math.max(20, Math.round(baseSeconds * multiplier));
}

export class AiTvTeamRuntime {
  private timer: NodeJS.Timeout | null = null;
  private running = false;
  private stopped = false;
  private resolvedLiveChat = new Map<string, string>();
  private twitchChat = new TwitchLiveChatClient();
  private voiceJobs = new Map<string, Promise<void>>();
  private voiceQueueTail: Promise<void> = Promise.resolve();
  private lastError: string | null = null;
  private lastTickAt: string | null = null;
  private taskRunning = false;
  private lastTaskError: string | null = null;
  private lastVoiceError: string | null = null;
  private chatResponseRetryAfter = new Map<string, number>();
  private researchByChatMessage = new Map<string, AiHostResearchPackage>();
  private lastChatAnalysis = new Map<string, { at: number; signature: string }>();
  private contextPreparationJobs = new Map<string, Promise<void>>();
  private contextPreparationRetryAfter = new Map<string, number>();

  constructor(private readonly emitUpdate: EmitUpdate) {}

  start(intervalMs = 4000) {
    if (this.timer) return;
    this.stopped = false;
    this.timer = setInterval(() => void this.tick(), intervalMs);
    this.timer.unref?.();
    setTimeout(() => void this.tick(), 1200).unref?.();
  }

  stop() {
    this.stopped = true;
    if (this.timer) clearInterval(this.timer);
    this.timer = null;
    this.twitchChat.disconnect();
  }

  health() {
    return {
      running: Boolean(this.timer) && !this.stopped,
      busy: this.running,
      taskBusy: this.taskRunning,
      lastTickAt: this.lastTickAt,
      lastError: this.lastError,
      lastTaskError: this.lastTaskError,
      lastVoiceError: this.lastVoiceError,
      voiceJobs: this.voiceJobs.size,
      twitchChat: this.twitchChat.status(),
    };
  }

  kickTaskProcessor() {
    void this.processNextStaffTask();
  }

  async tick() {
    if (this.running || this.stopped) return;
    this.kickTaskProcessor();
    this.running = true;
    this.lastTickAt = new Date().toISOString();
    try {
      const settings = await getAiHostSettings();
      const playback = await getPlaybackSnapshot();
      if (!settings?.enabled || !['playing', 'preparing', 'paused'].includes(playback.status) || !playback.itemId) {
        this.twitchChat.disconnect();
        if (await activeAiHostSession()) await endActiveAiHostSession();
        this.lastError = null;
        return;
      }
      const video = await youtubeItemForAiHost(playback.itemId);
      if (!video) {
        this.twitchChat.disconnect();
        if (await activeAiHostSession()) await endActiveAiHostSession();
        this.lastError = null;
        return;
      }
      if (video.format_kind === 'youtube-context' && video.youtube_library_id && !video.context_analysis) {
        this.queueContextPreparation(video.youtube_library_id, video.title, video.item_id);
      }
      let session = await startAiHostSession({
        broadcastItemId: video.item_id,
        youtubeLibraryId: video.youtube_library_id,
        youtubeVideoId: video.youtube_video_id,
        videoTitle: video.title,
        channelTitle: video.channel_title,
        videoUrl: video.url,
        formatKind: video.format_kind,
      });
      if (!session.briefing) {
        session = await this.prepareSession(session, video, settings);
      } else if (
        video.format_kind === 'youtube-context' &&
        video.context_analysis &&
        JSON.stringify(session.briefing) !== JSON.stringify(video.context_analysis)
      ) {
        session =
          (await updateAiHostSession(session.id, {
            briefing: video.context_analysis,
            briefingModel: video.context_analysis_model || 'youtube-context-cache',
            phaseIndex: 0,
            nextPhaseAt: new Date(Date.now() + 8_000).toISOString(),
          })) ?? session;
        await recordAiStaffActivity({
          staffMemberId: 'producer',
          eventType: 'youtube_context_live_refresh',
          title: `Transkript-Einordnung live übernommen: ${video.title}`,
          detail:
            'Die bisherige News-Fallback-Strecke wurde ohne Neustart durch die fertige Redaktionsanalyse ersetzt.',
          status: 'ready',
          metadata: {
            sessionId: session.id,
            broadcastItemId: video.item_id,
            youtubeLibraryId: video.youtube_library_id,
            model: video.context_analysis_model,
          },
        }).catch(() => null);
        await this.emitUpdate('youtube-context-live-refresh', { sessionId: session.id, itemId: video.item_id });
      }
      if (playback.status === 'paused') {
        if (session.status !== 'paused') await updateAiHostSession(session.id, { status: 'paused' });
        return;
      }
      if (session.status !== 'live') session = (await updateAiHostSession(session.id, { status: 'live' })) ?? session;
      await this.pollChat(session, settings);
      if (settings.voice_enabled) {
        const pendingVoice = await nextAiStaffVoiceTurn(session.id);
        if (pendingVoice) {
          if (safeDate(pendingVoice.voice_retry_at, 0) <= Date.now()) this.queueVoice(pendingVoice, settings);
          return;
        }
      }
      const activeTurn = await currentAiStaffTurn(session.id);
      if (activeTurn) return;
      if (await upcomingAiStaffVoiceTurn(session.id)) return;
      const latest = (await latestAiStaffTurns(session.id, 1))[0];
      if (latest?.status === 'pending' && safeDate(latest.created_at) > Date.now() - 10 * 60_000) return;
      const turnMetrics = await aiHostTurnMetricsLastHour(session.id);
      if (turnMetrics.total < settings.max_turns_per_hour && (await this.maybeRespondToChat(session, settings))) return;
      if (turnMetrics.total >= settings.max_turns_per_hour) return;
      const reservedChatTurns = Math.max(1, Math.ceil(settings.max_turns_per_hour * 0.25));
      if (turnMetrics.scheduled >= Math.max(0, settings.max_turns_per_hour - reservedChatTurns)) return;
      if (!(await this.scheduledTurnIsDue(session, video))) return;
      await this.createScheduledTurn(session, settings);
      this.lastError = null;
    } catch (error) {
      this.lastError = error instanceof Error ? error.message : String(error);
    } finally {
      this.running = false;
    }
  }

  private queueContextPreparation(youtubeLibraryId: string, title: string, itemId: string) {
    if (
      this.contextPreparationJobs.has(youtubeLibraryId) ||
      (this.contextPreparationRetryAfter.get(youtubeLibraryId) ?? 0) > Date.now()
    )
      return;
    const job = prepareYoutubeContextForVideo(youtubeLibraryId)
      .then(async (result) => {
        const retryMs = result.status === 'ready' ? 0 : result.rateLimited ? 15 * 60_000 : 90_000;
        if (retryMs) this.contextPreparationRetryAfter.set(youtubeLibraryId, Date.now() + retryMs);
        else this.contextPreparationRetryAfter.delete(youtubeLibraryId);
        await this.emitUpdate(
          result.status === 'ready' ? 'youtube-context-prepared-live' : 'youtube-context-fallback',
          {
            youtubeLibraryId,
            itemId,
            title,
            status: result.status,
          },
        );
        if (result.status === 'ready') setTimeout(() => void this.tick(), 250).unref?.();
      })
      .catch((error) => {
        this.contextPreparationRetryAfter.set(youtubeLibraryId, Date.now() + 2 * 60_000);
        this.lastError = error instanceof Error ? error.message : String(error);
      })
      .finally(() => this.contextPreparationJobs.delete(youtubeLibraryId));
    this.contextPreparationJobs.set(youtubeLibraryId, job);
  }

  private async scheduledTurnIsDue(
    session: AiHostSession,
    video: NonNullable<Awaited<ReturnType<typeof youtubeItemForAiHost>>>,
  ) {
    if (session.format_kind !== 'youtube-context') return safeDate(session.next_phase_at, 0) <= Date.now();
    const briefing = session.briefing as HostBriefingAiOutput | null;
    const pauseMoments = Array.isArray((briefing as any)?.pauseMoments)
      ? ((briefing as any).pauseMoments as Array<{ atPercent?: unknown }>)
      : [];
    const pause = pauseMoments[session.phase_index];
    if (!pause) return safeDate(session.next_phase_at, 0) <= Date.now();
    const control = session.broadcast_item_id
      ? await getYoutubeContextPlaybackControl(session.broadcast_item_id).catch(() => null)
      : null;
    const progressFresh = control?.last_progress_at
      ? safeDate(control.last_progress_at, 0) >= Date.now() - 8_000
      : false;
    if (!progressFresh) return safeDate(session.next_phase_at, 0) <= Date.now();
    const durationMs = Math.max(30_000, Number(control?.media_duration_ms) || video.duration_seconds * 1000);
    const targetMs = (Math.max(8, Math.min(92, Number(pause.atPercent) || 12)) / 100) * durationMs;
    return Number(control?.media_position_ms ?? 0) >= targetMs;
  }

  private async processNextStaffTask() {
    if (this.taskRunning || this.stopped) return;
    this.taskRunning = true;
    let task: Awaited<ReturnType<typeof claimNextAiStaffTask>> = null;
    try {
      task = await claimNextAiStaffTask();
      if (!task) return;
      const member = await getAiStaffMember(task.staff_member_id);
      if (!member) throw new Error('Der zugewiesene KI-Mitarbeiter existiert nicht mehr.');
      const playback = await getPlaybackSnapshot().catch(() => null);
      const hostSession = await activeAiHostSession().catch(() => null);
      const result = await runAiStaffAssignment({
        memberName: member.display_name,
        jobTitle: member.job_title,
        role: member.role,
        description: member.description,
        standingInstructions: member.instructions,
        configuration: member.config,
        taskKind: task.kind,
        title: task.title,
        instructions: task.instructions,
        dueAt: task.due_at,
        studioContext: {
          playback: playback
            ? { status: playback.status, itemId: playback.itemId, playlistId: playback.playlistId }
            : null,
          liveVideo: hostSession
            ? { title: hostSession.video_title, channel: hostSession.channel_title, status: hostSession.status }
            : null,
        },
      });
      const requiresReview = member.autonomy !== 'auto' || result.output.needsReview;
      const completed = await completeAiStaffTask(task.id, {
        summary: result.output.summary,
        response: result.output.response,
        result: { ...result.output, usage: result.usage, tier: result.tier },
        model: result.model,
        waitingReview: requiresReview,
      });
      if (!completed) {
        await this.emitUpdate('staff-task-result-discarded', { taskId: task.id, staffId: task.staff_member_id });
        return;
      }
      this.lastTaskError = null;
      await this.emitUpdate('staff-task-finished', {
        taskId: task.id,
        staffId: task.staff_member_id,
        waitingReview: requiresReview,
      });
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      this.lastTaskError = message;
      if (task) await failAiStaffTask(task.id, message);
      await this.emitUpdate('staff-task-failed', { taskId: task?.id, staffId: task?.staff_member_id });
    } finally {
      this.taskRunning = false;
    }
  }

  private async prepareSession(
    session: AiHostSession,
    video: NonNullable<Awaited<ReturnType<typeof youtubeItemForAiHost>>>,
    settings: AiHostSettings,
  ) {
    const moderator = await getAiStaffMember(settings.active_moderator_id);
    let briefing = fallbackBriefing(video);
    let model = 'redaktioneller-fallback';
    if (video.format_kind === 'youtube-context' && video.context_analysis) {
      briefing = video.context_analysis as HostBriefingAiOutput;
      model = video.context_analysis_model || 'youtube-context-cache';
    } else if (video.format_kind !== 'youtube-context') {
      try {
        const result = await prepareYoutubeHostBriefing({
          title: video.title,
          description: video.description,
          channel: video.channel_title,
          category: video.category_name,
          durationSeconds: video.duration_seconds,
          moderatorInstructions: moderator?.instructions,
        });
        briefing = result.output;
        model = result.model;
      } catch {
        // Der Sender darf wegen einer nicht verfügbaren KI niemals stehen bleiben.
      }
    }
    const contextPauseMoments =
      video.format_kind === 'youtube-context' && Array.isArray((briefing as any).pauseMoments)
        ? ((briefing as any).pauseMoments as Array<{ atPercent?: unknown }>)
        : [];
    const firstPauseSeconds = contextPauseMoments.length
      ? Math.max(25, Math.floor((Number(contextPauseMoments[0]?.atPercent ?? 12) / 100) * video.duration_seconds))
      : presenterIntervalSeconds(settings.question_interval_seconds, presenterLiveFrequency(moderator));
    const updated =
      (await updateAiHostSession(session.id, {
        briefing,
        briefingModel: model,
        status: 'live',
        nextPhaseAt: new Date(Date.now() + firstPauseSeconds * 1000).toISOString(),
      })) ?? session;
    const intro = await createAiStaffTurn({
      sessionId: session.id,
      staffMemberId: settings.active_moderator_id,
      kind: 'intro',
      headline: video.format_kind === 'youtube-context' ? 'AVA ordnet ein' : 'Jetzt im Programm',
      text: briefing.neutralSummary,
      cta: settings.participation_prompt,
      status: turnStatus(settings, moderator?.autonomy),
      model,
      durationSeconds: turnDurationSeconds(settings),
    });
    this.queueVoice(intro, settings);
    await this.emitUpdate('session-started', { sessionId: session.id, itemId: video.item_id });
    return updated;
  }

  private async pollChat(session: AiHostSession, settings: AiHostSettings) {
    if (!settings.show_chat || settings.interaction_mode === 'off') {
      this.twitchChat.disconnect();
      return;
    }
    const platforms =
      Array.isArray(settings.chat_platforms) && settings.chat_platforms.length
        ? settings.chat_platforms
        : ['youtube' as const];
    const errors: string[] = [];
    const sessionStarted = safeDate(session.started_at) - 30_000;
    const update: Parameters<typeof updateAiHostSession>[1] = {};

    if (platforms.includes('twitch')) {
      const twitchStatus = this.twitchChat.ensure(settings.twitch_channel);
      // Twitch IRC liefert ausschließlich Nachrichten, die nach dem JOIN live
      // eintreffen. Anders als beim YouTube-Paging gibt es hier keine Historie,
      // daher darf eine abweichende Provider-Uhr keine echte Nachricht verwerfen.
      const twitchMessages = this.twitchChat.drain(settings.max_chat_messages_per_turn * 4);
      if (twitchMessages.length) await insertAiHostChatMessages(session.id, twitchMessages);
      if (twitchStatus.error) errors.push(twitchStatus.error);
    } else {
      this.twitchChat.disconnect();
    }

    if (platforms.includes('youtube') && safeDate(session.chat_poll_after, 0) <= Date.now()) {
      const useContentChat = settings.chat_source_mode === 'content' && Boolean(session.youtube_library_id);
      const chatSourceUrl = useContentChat ? session.video_url : settings.live_stream_url;
      const explicitChatId = useContentChat ? null : settings.live_chat_id;
      if (!process.env.YOUTUBE_DATA_API_KEY?.trim()) {
        errors.push('YouTube Data API-Key fehlt.');
      } else if (!explicitChatId && !chatSourceUrl) {
        errors.push('URL oder Livechat-ID des YouTube-Streams fehlt.');
      } else {
        try {
          const cacheKey = explicitChatId || chatSourceUrl || 'default';
          let liveChatId = this.resolvedLiveChat.get(cacheKey);
          if (!liveChatId) {
            liveChatId = await resolveYoutubeLiveChatId({
              apiKey: process.env.YOUTUBE_DATA_API_KEY,
              liveStreamUrl: chatSourceUrl,
              explicitLiveChatId: explicitChatId,
            });
            this.resolvedLiveChat.set(cacheKey, liveChatId);
          }
          const page = await fetchYoutubeLiveChatPage({
            apiKey: process.env.YOUTUBE_DATA_API_KEY,
            liveChatId,
            pageToken: session.chat_page_token,
          });
          const messages = page.messages.filter((message) => safeDate(message.publishedAt) >= sessionStarted);
          await insertAiHostChatMessages(session.id, messages);
          update.chatPageToken = page.nextPageToken;
          update.chatPollAfter = new Date(Date.now() + page.pollAfterMs).toISOString();
        } catch (error) {
          errors.push(error instanceof Error ? error.message : String(error));
          update.chatPollAfter = new Date(Date.now() + 30_000).toISOString();
        }
      }
    }

    update.chatError = errors.length ? errors.join(' · ').slice(0, 500) : null;
    await updateAiHostSession(session.id, update);
  }

  private async maybeRespondToChat(session: AiHostSession, settings: AiHostSettings) {
    if (!settings.show_chat || settings.interaction_mode === 'off') return false;
    if ((this.chatResponseRetryAfter.get(session.id) ?? 0) > Date.now()) return false;
    const contextFormat = session.format_kind === 'youtube-context';
    const messageLimit = contextFormat
      ? Math.min(50, Math.max(20, settings.max_chat_messages_per_turn * 3))
      : settings.max_chat_messages_per_turn;
    const pendingMessages = await unusedAiHostChatMessages(session.id, messageLimit);
    if (!pendingMessages.length) return false;
    const directQuestionMessage = pendingMessages.find((message) => isDirectChatQuestion(message.message));
    const containsDirectQuestion = Boolean(directQuestionMessage);
    const [moderator, analyst] = await Promise.all([
      getAiStaffMember(settings.active_moderator_id),
      contextFormat ? getAiStaffMember('chat-analyst') : Promise.resolve(null),
    ]);
    const chatPresenter = contextFormat
      ? ((await getAiStaffMember('chat-moderator')) ?? analyst ?? moderator)
      : moderator;
    const discussionPolicy = resolveChatDiscussionPolicy(analyst?.config, chatPresenter?.config);
    let messages: AiHostChatMessage[] = directQuestionMessage ? [directQuestionMessage] : pendingMessages;
    let proactiveCommentary = false;
    let discussionAnalysis: ChatActivityAnalysis<RuntimeChatActivityMessage> | null = null;
    let commentaryHistory: Awaited<ReturnType<typeof recentAiChatCommentaries>> = [];

    if (contextFormat && !containsDirectQuestion) {
      if (!analyst?.enabled || !chatPresenter?.enabled || !discussionPolicy.enabled) return false;
      const activityMessages: RuntimeChatActivityMessage[] = pendingMessages.map((message) => ({
        ...message,
        authorName: message.author_name,
        authorChannelId: message.author_channel_id,
        publishedAt: message.published_at,
      }));
      discussionAnalysis = analyzeChatActivity(activityMessages, discussionPolicy);
      if (discussionAnalysis.ignoredMessageIds.length) {
        await markAiHostChatMessagesUsed(discussionAnalysis.ignoredMessageIds);
      }
      if (!discussionAnalysis.active) return false;
      messages = discussionAnalysis.messages;
      commentaryHistory = await recentAiChatCommentaries(
        session.id,
        Math.max(
          discussionPolicy.duplicateSuppressionMinutes,
          Math.ceil(discussionPolicy.effectiveIntervalSeconds / 60) + 1,
        ),
      );
      const lastCommentaryAt = safeDate(commentaryHistory[0]?.created_at, 0);
      if (lastCommentaryAt + discussionPolicy.effectiveIntervalSeconds * 1000 > Date.now()) return false;
      if (isRepeatedChatDiscussion(discussionAnalysis.fingerprint, null, commentaryHistory)) {
        await markAiHostChatMessagesUsed(messages.map((message) => message.id));
        await recordAiStaffActivity({
          staffMemberId: 'chat-analyst',
          eventType: 'live_chat_discussion_suppressed',
          title: 'Bekannte Chatdiskussion nicht erneut an Mia übergeben',
          detail: `${discussionAnalysis.distinctMessageCount} neue Beiträge entsprachen einem bereits kommentierten Thema.`,
          status: 'completed',
          metadata: {
            sessionId: session.id,
            fingerprint: discussionAnalysis.fingerprint,
            uniqueAuthors: discussionAnalysis.uniqueAuthorCount,
            providers: discussionAnalysis.providers,
            messageIds: messages.map((message) => message.id),
          },
        }).catch(() => null);
        await this.emitUpdate('chat-discussion-suppressed', { sessionId: session.id });
        return false;
      }
      proactiveCommentary = true;
    }

    const effectiveMinimum = contextFormat ? discussionPolicy.minimumDistinctMessages : settings.minimum_chat_messages;
    if (messages.length < effectiveMinimum && !containsDirectQuestion) return false;
    const signature = messages.map((message) => message.id).join(':');
    const previousAnalysis = this.lastChatAnalysis.get(session.id);
    if (!previousAnalysis || previousAnalysis.signature !== signature) {
      await recordAiStaffActivity({
        staffMemberId: 'chat-analyst',
        eventType: containsDirectQuestion ? 'live_chat_question_batch_analyzed' : 'live_chat_discussion_analyzed',
        title: containsDirectQuestion
          ? `${messages.length} Chatbeiträge analysiert · direkte Frage erkannt`
          : `${messages.length} neue Chatbeiträge von ${discussionAnalysis?.uniqueAuthorCount ?? 'mehreren'} Personen gebündelt`,
        detail: messages
          .slice(0, 8)
          .map(
            (message) =>
              `${safeChatDisplayName(message.author_name) ?? 'Chat'}: ${limitedLiveText(message.message, 220)}`,
          )
          .join(' · '),
        status: 'completed',
        metadata: {
          sessionId: session.id,
          format: session.format_kind,
          directQuestion: directQuestionMessage?.message ?? null,
          providers: [...new Set(messages.map((message) => message.provider))],
          messageIds: messages.map((message) => message.id),
          fingerprint: discussionAnalysis?.fingerprint ?? null,
          keywords: discussionAnalysis?.keywords ?? [],
          uniqueAuthors: discussionAnalysis?.uniqueAuthorCount ?? null,
        },
      }).catch(() => null);
      this.lastChatAnalysis.set(session.id, { at: Date.now(), signature });
    }
    const chatFrequency = presenterLiveFrequency(chatPresenter);
    const responseCooldownMs = containsDirectQuestion
      ? Math.min(10, settings.response_cooldown_seconds) * 1000
      : presenterIntervalSeconds(settings.response_cooldown_seconds, chatFrequency) * 1000;
    if (!proactiveCommentary && safeDate(session.last_chat_response_at, 0) + responseCooldownMs > Date.now()) {
      return false;
    }
    const briefing = session.briefing as HostBriefingAiOutput;
    const addressedName = settings.anonymize_authors ? null : safeChatDisplayName(directQuestionMessage?.author_name);
    const research = directQuestionMessage
      ? await this.researchForChatModerator(
          session,
          directQuestionMessage.id,
          directQuestionMessage.message,
          addressedName,
          directQuestionMessage.provider,
        )
      : null;
    let result: Awaited<ReturnType<typeof createYoutubeHostChatResponse>>;
    try {
      result = await createYoutubeHostChatResponse({
        videoTitle: session.video_title,
        channel: session.channel_title,
        briefing,
        currentQuestion: stringArray(briefing?.criticalQuestions)[
          session.phase_index % Math.max(1, stringArray(briefing?.criticalQuestions).length)
        ],
        moderatorName: chatPresenter?.display_name,
        moderatorInstructions: chatPresenter?.instructions,
        responseDetail: presenterResponseDetail(chatPresenter),
        contextDepth: presenterContextDepth(chatPresenter),
        interactionMode: containsDirectQuestion ? 'question' : 'discussion-commentary',
        directChatQuestion: directQuestionMessage
          ? {
              author: addressedName,
              provider: directQuestionMessage.provider,
              message: directQuestionMessage.message,
            }
          : null,
        research,
        chatAnalysis: discussionAnalysis
          ? {
              messageCount: discussionAnalysis.distinctMessageCount,
              uniqueAuthorCount: discussionAnalysis.uniqueAuthorCount,
              providers: discussionAnalysis.providers,
              keywords: discussionAnalysis.keywords,
            }
          : null,
        previousThemes: commentaryHistory
          .map((entry) => entry.chat_theme || entry.text)
          .filter((theme): theme is string => typeof theme === 'string' && Boolean(theme)),
        chatMessages: messages.map((message) => ({
          author: settings.anonymize_authors ? null : safeChatDisplayName(message.author_name),
          provider: message.provider,
          message: message.message,
        })),
      });
      this.chatResponseRetryAfter.delete(session.id);
    } catch (error) {
      // Unbeantwortete Beiträge bleiben unbenutzt und werden nach einer kurzen
      // Pause erneut über die konfigurierte Free-first-Kaskade versucht.
      this.chatResponseRetryAfter.set(session.id, Date.now() + (containsDirectQuestion ? 30_000 : 60_000));
      const detail = error instanceof Error ? error.message : String(error);
      throw new Error(`Die KI-Moderation konnte den Chat noch nicht beantworten: ${detail}`);
    }
    const useLimitedResearchFallback = Boolean(
      directQuestionMessage &&
      research &&
      !research.verifiedFact &&
      research.confidence !== 'supported' &&
      !research.sources.some((source) => source.kind === 'program'),
    );
    const groundedAnswer = useLimitedResearchFallback
      ? limitedResearchChatAnswer(research?.sources)
      : ensureResearchAttribution(
          ensureVerifiedResearchAnswer(result.output.response, research?.verifiedFact),
          research?.sources,
        );
    const fittedResponse = fitChatResponseToDuration(
      addressChatResponse(addressedName, groundedAnswer, true),
      useLimitedResearchFallback ? 'Welche konkrete Aussage sollen wir prüfen?' : result.output.followUpQuestion,
      proactiveCommentary ? discussionPolicy.commentaryDurationSeconds : settings.response_duration_seconds,
      presenterResponseDetail(chatPresenter),
    );
    const response = {
      ...result.output,
      headline: directQuestionMessage
        ? addressedName
          ? `Antwort an ${addressedName}`
          : 'Antwort aus dem Livechat'
        : result.output.headline,
      response: fittedResponse.response,
      followUpQuestion: fittedResponse.followUpQuestion,
    };
    if (
      proactiveCommentary &&
      discussionAnalysis &&
      isRepeatedChatDiscussion(discussionAnalysis.fingerprint, response.theme, commentaryHistory)
    ) {
      await markAiHostChatMessagesUsed(messages.map((message) => message.id));
      await recordAiStaffActivity({
        staffMemberId: 'chat-analyst',
        eventType: 'live_chat_generated_theme_suppressed',
        title: 'Mögliche Wiederholung nach der Themenformulierung gestoppt',
        detail: response.theme,
        status: 'completed',
        metadata: {
          sessionId: session.id,
          fingerprint: discussionAnalysis.fingerprint,
          model: result.model,
          messageIds: messages.map((message) => message.id),
        },
      }).catch(() => null);
      return false;
    }
    const turn = await createAiStaffTurn({
      sessionId: session.id,
      staffMemberId: chatPresenter?.id ?? settings.active_moderator_id,
      kind: proactiveCommentary ? 'chat-commentary' : 'chat-response',
      headline: response.headline,
      text: response.response,
      cta: response.followUpQuestion,
      chatTheme: response.theme,
      chatExcerpt: limitedLiveText(
        addressedName
          ? `${addressedName}: ${response.representativeExcerpt || directQuestionMessage?.message || ''}`
          : response.representativeExcerpt,
        260,
      ),
      chatFingerprint: discussionAnalysis?.fingerprint ?? null,
      sourceMessageIds: messages.map((message) => message.id),
      status: turnStatus(settings, chatPresenter?.autonomy),
      model: result.model,
      durationSeconds: proactiveCommentary
        ? aiHostOverlayDurationSeconds(discussionPolicy.commentaryDurationSeconds)
        : turnDurationSeconds(settings),
    });
    await recordAiStaffActivity({
      staffMemberId: 'chat-analyst',
      eventType: 'live_chat_handoff_to_moderator',
      title: containsDirectQuestion
        ? 'Direkte Chatfrage an die Chat-Moderatorin übergeben'
        : 'Neue Chatlage an Mia zur Live-Kommentierung übergeben',
      detail: response.response,
      status: turn.status,
      metadata: {
        sessionId: session.id,
        turnId: turn.id,
        format: session.format_kind,
        viewer: addressedName,
        messageIds: messages.map((message) => message.id),
        model: result.model,
        tier: result.tier,
        fingerprint: discussionAnalysis?.fingerprint ?? null,
        uniqueAuthors: discussionAnalysis?.uniqueAuthorCount ?? null,
      },
    }).catch(() => null);
    if (directQuestionMessage) {
      await recordAiStaffActivity({
        staffMemberId: chatPresenter?.id ?? settings.active_moderator_id,
        eventType: 'researched_chat_answer_prepared',
        title: addressedName ? `Live-Antwort für ${addressedName} vorbereitet` : 'Live-Antwort vorbereitet',
        detail: response.response,
        status: turn.status,
        metadata: {
          sessionId: session.id,
          messageId: directQuestionMessage.id,
          turnId: turn.id,
          question: directQuestionMessage.message,
          viewer: addressedName,
          provider: directQuestionMessage.provider,
          query: research?.query ?? null,
          confidence: research?.confidence ?? 'none',
          verifiedFact: research?.verifiedFact ?? null,
          model: result.model,
          tier: result.tier,
          cost: result.usage.cost,
          sources: research?.sources.map((source) => ({
            kind: source.kind,
            title: source.title,
            publisher: source.publisher,
            url: source.url,
            trustScore: source.trustScore,
          })),
        },
      }).catch(() => null);
    } else if (proactiveCommentary) {
      await recordAiStaffActivity({
        staffMemberId: chatPresenter?.id ?? 'chat-moderator',
        eventType: 'proactive_chat_commentary_prepared',
        title: 'Mia kommentiert eine neue Diskussion aus dem Livechat',
        detail: response.response,
        status: turn.status,
        metadata: {
          sessionId: session.id,
          turnId: turn.id,
          theme: response.theme,
          fingerprint: discussionAnalysis?.fingerprint ?? null,
          messageCount: messages.length,
          uniqueAuthors: discussionAnalysis?.uniqueAuthorCount ?? null,
          providers: discussionAnalysis?.providers ?? [],
          model: result.model,
          tier: result.tier,
          cost: result.usage.cost,
        },
      }).catch(() => null);
    }
    await markAiHostChatMessagesUsed(messages.map((message) => message.id));
    await updateAiHostSession(session.id, { lastChatResponseAt: new Date().toISOString() });
    await this.captureGrowthMoment(session, response.headline, response.followUpQuestion, messages.length);
    this.queueVoice(turn, settings);
    await this.emitUpdate(proactiveCommentary ? 'chat-commentary' : 'chat-response', {
      sessionId: session.id,
      turnId: turn.id,
    });
    return true;
  }

  private async researchForChatModerator(
    session: AiHostSession,
    messageId: string,
    question: string,
    addressedName: string | null,
    provider: string,
  ) {
    const cached = this.researchByChatMessage.get(messageId);
    if (cached) return cached;
    await recordAiStaffActivity({
      staffMemberId: 'chat-analyst',
      eventType: 'chat_question_identified',
      title: addressedName ? `Frage von ${addressedName} erkannt` : 'Chatfrage erkannt',
      detail: limitedLiveText(question, 500),
      status: 'working',
      metadata: { sessionId: session.id, messageId, question, viewer: addressedName, provider },
    }).catch(() => null);

    let editorialSources: Awaited<ReturnType<typeof searchAiHostEditorialSources>> = [];
    const preliminaryTerms = aiHostResearchTerms(question, session.video_title);
    try {
      editorialSources = await searchAiHostEditorialSources(preliminaryTerms, 5);
    } catch {
      // Die öffentliche Referenzrecherche bleibt auch bei einem lokalen Suchfehler verfügbar.
    }
    const research = await buildAiHostResearchPackage({
      question,
      videoTitle: session.video_title,
      videoUrl: session.video_url,
      editorialSources,
      env: process.env,
    });
    await recordAiStaffActivity({
      staffMemberId: 'editor',
      eventType: 'source_research_completed',
      title: `Quellenpaket für die Chatmoderation: ${research.sources.length} Treffer`,
      detail: limitedLiveText(question, 500),
      status: research.sources.length ? 'completed' : 'warning',
      metadata: {
        sessionId: session.id,
        messageId,
        question,
        viewer: addressedName,
        provider,
        query: research.query,
        errors: research.errors,
        sources: research.sources.map((source) => ({
          kind: source.kind,
          title: source.title,
          publisher: source.publisher,
          url: source.url,
          trustScore: source.trustScore,
        })),
      },
    }).catch(() => null);
    await recordAiStaffActivity({
      staffMemberId: 'fact-checker',
      eventType: 'research_handoff_reviewed',
      title: research.sources.length ? 'Quellen für die Chatmoderation geprüft' : 'Keine belastbare Quelle gefunden',
      detail: research.sources.length
        ? `${research.sources.length} deduplizierte Quellen · Einstufung: ${research.confidence}`
        : 'Die Frage bleibt für einen späteren Rechercheversuch offen.',
      status: research.sources.length ? 'ready' : 'warning',
      metadata: {
        sessionId: session.id,
        messageId,
        question,
        viewer: addressedName,
        provider,
        query: research.query,
        confidence: research.confidence,
        verifiedFact: research.verifiedFact,
        errors: research.errors,
        sources: research.sources.map((source) => ({
          kind: source.kind,
          title: source.title,
          publisher: source.publisher,
          url: source.url,
          trustScore: source.trustScore,
        })),
      },
    }).catch(() => null);
    if (research.sources.length || !research.errors.length) this.researchByChatMessage.set(messageId, research);
    if (this.researchByChatMessage.size > 200) {
      const oldest = this.researchByChatMessage.keys().next().value;
      if (oldest) this.researchByChatMessage.delete(oldest);
    }
    return research;
  }

  private async captureGrowthMoment(session: AiHostSession, headline: string, hook: string, chatCount: number) {
    const growth = await getGrowthSettings().catch(() => null);
    if (!growth?.enabled || !growth.auto_detect || chatCount < growth.minimum_chat_messages) return;
    const score = Math.min(98, 54 + chatCount * 5 + (hook.includes('?') ? 6 : 0));
    if (score < growth.minimum_score) return;
    const playback = await getPlaybackSnapshot();
    const topicTags = session.video_title
      .replace(/[^\p{L}\p{N} ]/gu, ' ')
      .split(/\s+/)
      .filter((word) => word.length >= 5)
      .slice(0, 4)
      .map((word) => `#${word.replace(/[^\p{L}\p{N}]/gu, '')}`);
    const moment = await createGrowthMoment({
      sessionId: session.id,
      broadcastItemId: session.broadcast_item_id,
      youtubeVideoId: session.youtube_video_id,
      title: headline,
      hook,
      reason: `${chatCount} sichere Chatbeiträge bilden ein gemeinsames Diskussionsthema.`,
      score,
      chatCount,
      mediaPositionMs: playback.mediaPositionMs,
      socialPack: {
        shortTitle: headline,
        caption: `${hook} Die vollständige Diskussion läuft bei uns im Livestream.`,
        hashtags: ['#LiveDiskussion', '#Nachrichten', ...topicTags].slice(0, 7),
        sourceAttribution: `${session.channel_title} · ${session.video_url}`,
        rightsReviewRequired: true,
      },
    });
    await this.emitUpdate('growth-moment-detected', { momentId: moment.id, score: moment.score });
  }

  private async createScheduledTurn(session: AiHostSession, settings: AiHostSettings) {
    const briefing = session.briefing as HostBriefingAiOutput;
    const questions = stringArray(briefing?.criticalQuestions);
    const prompts = stringArray(briefing?.chatPrompts);
    const claims = stringArray(briefing?.keyClaims);
    const phase = session.phase_index;
    const contextPauses = Array.isArray((briefing as any)?.pauseMoments)
      ? ((briefing as any).pauseMoments as Array<{
          atPercent?: unknown;
          headline?: unknown;
          text?: unknown;
          question?: unknown;
        }>)
      : [];
    const contextPause = session.format_kind === 'youtube-context' ? contextPauses[phase] : null;
    const contextCards = Array.isArray((briefing as any)?.cards)
      ? ((briefing as any).cards as Array<{
          kind?: unknown;
          headline?: unknown;
          text?: unknown;
          sourceLabel?: unknown;
        }>)
      : [];
    const contextCard =
      session.format_kind === 'youtube-context' && !contextPause && contextCards.length
        ? contextCards[Math.max(0, phase - contextPauses.length) % contextCards.length]
        : null;
    const question =
      questions[phase % Math.max(1, questions.length)] || 'Welche Information ist für eure Einschätzung entscheidend?';
    const useContext = phase % 3 === 2 && claims.length > 0;
    const moderator = await getAiStaffMember(settings.active_moderator_id);
    const turn = await createAiStaffTurn({
      sessionId: session.id,
      staffMemberId: settings.active_moderator_id,
      kind: contextPause || contextCard ? 'context' : useContext ? 'context' : 'question',
      headline: contextPause
        ? limitedLiveText(contextPause.headline, 180) || 'AVA ordnet ein'
        : contextCard
          ? limitedLiveText(contextCard.headline, 180) || 'AVA ordnet ein'
          : useContext
            ? 'Redaktioneller Blick'
            : 'Frage an euch',
      text: contextPause
        ? limitedLiveText(contextPause.text, 1400) || question
        : contextCard
          ? limitedLiveText(contextCard.text, 1400) || question
          : useContext
            ? claims[phase % claims.length]!
            : question,
      cta: contextPause
        ? limitedLiveText(contextPause.question, 320) || settings.participation_prompt
        : contextCard
          ? contextCard.kind === 'question'
            ? limitedLiveText(contextCard.text, 320)
            : prompts[phase % Math.max(1, prompts.length)] || settings.participation_prompt
          : prompts[phase % Math.max(1, prompts.length)] || settings.participation_prompt,
      status: turnStatus(settings, moderator?.autonomy),
      model: session.briefing_model,
      durationSeconds: turnDurationSeconds(settings),
    });
    const nextContextPause = contextPauses[phase + 1];
    const startedAt = safeDate(session.started_at);
    const targetNextAt = nextContextPause
      ? startedAt +
        Math.max(
          25,
          Math.floor(
            (Number(nextContextPause.atPercent ?? 50) / 100) *
              Math.max(30, (await youtubeItemForAiHost(session.broadcast_item_id ?? ''))?.duration_seconds ?? 900),
          ),
        ) *
          1000
      : Date.now() +
        presenterIntervalSeconds(settings.question_interval_seconds, presenterLiveFrequency(moderator)) * 1000;
    await updateAiHostSession(session.id, {
      phaseIndex: phase + 1,
      nextPhaseAt: new Date(Math.max(Date.now() + 20_000, targetNextAt)).toISOString(),
    });
    this.queueVoice(turn, settings);
    await this.emitUpdate('scheduled-turn', { sessionId: session.id, turnId: turn.id });
  }

  queueVoice(turn: AiStaffTurn, settings: AiHostSettings) {
    if (
      !settings.voice_enabled ||
      turn.status === 'pending' ||
      this.voiceJobs.has(turn.id) ||
      safeDate(turn.voice_retry_at, 0) > Date.now()
    )
      return;
    const job = this.voiceQueueTail
      .catch(() => undefined)
      .then(async () => {
        const attemptedTurn = await markAiStaffVoiceAttempt(turn.id);
        if (!attemptedTurn) return;
        const presenterProfile = await getAiPresenterProfile(attemptedTurn.staff_member_id).catch(() => null);
        const voiceEnvironment = ttsEnvironmentForAiPresenter(
          attemptedTurn.staff_member_id,
          process.env,
          presenterProfile?.tts_voice || undefined,
        );
        await recordAiStaffActivity({
          staffMemberId: attemptedTurn.staff_member_id,
          eventType: 'voice_render_started',
          title: `Stimme für Live-Einblendung wird erzeugt · Versuch ${attemptedTurn.voice_attempts}`,
          detail: attemptedTurn.text,
          status: 'working',
          metadata: { sessionId: attemptedTurn.session_id, turnId: attemptedTurn.id, kind: attemptedTurn.kind },
        }).catch(() => null);
        try {
          const speechText = ['chat-response', 'chat-commentary'].includes(attemptedTurn.kind)
            ? `${attemptedTurn.text} ${attemptedTurn.cta ?? ''}`
            : `${attemptedTurn.headline}. ${attemptedTurn.text} ${attemptedTurn.cta ?? ''}`;
          const audio = await generateTtsAudio(speechText, voiceEnvironment);
          const readyTurn = await setAiStaffTurnAudio(
            attemptedTurn.id,
            audio.file,
            settings.avatar_voice_sync ? Math.ceil(audio.durationSeconds) + 3 : null,
          );
          if (!readyTurn) return;
          this.lastVoiceError = null;
          await recordAiStaffActivity({
            staffMemberId: readyTurn.staff_member_id,
            eventType: 'voice_ready_for_overlay',
            title: 'Live-Antwort ist vertont und für das Overlay bereit',
            detail: readyTurn.text,
            status: 'ready',
            metadata: {
              sessionId: readyTurn.session_id,
              turnId: readyTurn.id,
              kind: readyTurn.kind,
              startsAt: readyTurn.starts_at,
              endsAt: readyTurn.ends_at,
              durationSeconds: audio.durationSeconds,
            },
          }).catch(() => null);
          await this.emitUpdate('voice-ready', { turnId: readyTurn.id });
        } catch (error) {
          const message = error instanceof Error ? error.message : String(error);
          this.lastVoiceError = message;
          const retryDelaySeconds = Math.min(120, 10 * 2 ** Math.max(0, attemptedTurn.voice_attempts - 1));
          const failedTurn = await markAiStaffVoiceFailure(attemptedTurn.id, message, retryDelaySeconds);
          await recordAiStaffActivity({
            staffMemberId: attemptedTurn.staff_member_id,
            eventType: 'voice_generation_failed',
            title:
              failedTurn?.status === 'expired'
                ? 'Live-Vertonung endgültig fehlgeschlagen'
                : 'Live-Vertonung wird wiederholt',
            detail: message,
            status: failedTurn?.status === 'expired' ? 'failed' : 'warning',
            metadata: {
              sessionId: attemptedTurn.session_id,
              turnId: attemptedTurn.id,
              attempt: attemptedTurn.voice_attempts,
              retryAt: failedTurn?.voice_retry_at ?? null,
            },
          }).catch(() => null);
          await this.emitUpdate('voice-failed', {
            turnId: attemptedTurn.id,
            retryAt: failedTurn?.voice_retry_at ?? null,
          });
        }
      })
      .catch(async (error) => {
        this.lastVoiceError = error instanceof Error ? error.message : String(error);
        await this.emitUpdate('voice-queue-failed', { turnId: turn.id }).catch(() => undefined);
      })
      .finally(() => this.voiceJobs.delete(turn.id));
    this.voiceJobs.set(turn.id, job);
    this.voiceQueueTail = job;
  }
}

const settingsSchema = z.object({
  enabled: z.boolean().optional(),
  liveStreamUrl: z.string().trim().url().nullable().optional(),
  liveChatId: z.string().trim().max(500).nullable().optional(),
  chatSourceMode: z.enum(['channel', 'content']).optional(),
  chatPlatforms: z
    .array(z.enum(['youtube', 'twitch']))
    .min(1)
    .max(2)
    .optional(),
  twitchChannel: z.string().trim().max(200).nullable().optional(),
  activeModeratorId: z.string().trim().max(80).optional(),
  overlayPosition: z.enum(['top-left', 'top-right', 'bottom-left', 'bottom-right']).optional(),
  overlayScale: z.number().int().min(65).max(140).optional(),
  showAvatar: z.boolean().optional(),
  showChat: z.boolean().optional(),
  anonymizeAuthors: z.boolean().optional(),
  voiceEnabled: z.boolean().optional(),
  avatarVoiceSync: z.boolean().optional(),
  interactionMode: z.enum(['off', 'review', 'auto-safe']).optional(),
  questionIntervalSeconds: z.number().int().min(20).max(900).optional(),
  responseCooldownSeconds: z.number().int().min(20).max(900).optional(),
  responseDurationSeconds: z.number().int().min(8).max(120).optional(),
  maxTurnsPerHour: z.number().int().min(1).max(60).optional(),
  maxChatMessagesPerTurn: z.number().int().min(1).max(50).optional(),
  minimumChatMessages: z.number().int().min(1).max(20).optional(),
  participationPrompt: z.string().trim().min(1).max(240).optional(),
});

const aiStaffConfigSchema = z.object({
  tone: z.enum(['neutral', 'warm', 'analytical', 'decisive']),
  responseDetail: z.enum(['compact', 'balanced', 'detailed']),
  modelStrategy: z.enum(['speed', 'balanced', 'quality']),
  proactive: z.boolean(),
  requiresSources: z.boolean(),
  notifyOnCompletion: z.boolean(),
  specialties: z.array(z.string().trim().min(1).max(80)).max(12),
  liveFrequency: z.enum(['restrained', 'balanced', 'active']).default('balanced'),
  contextDepth: z.enum(['focused', 'balanced', 'detailed']).default('balanced'),
  chatAnalysisEnabled: z.boolean().optional(),
  chatAnalysisIntervalSeconds: z.number().int().min(60).max(900).optional(),
  chatActivityWindowSeconds: z.number().int().min(60).max(1800).optional(),
  chatMinimumDistinctMessages: z.number().int().min(2).max(20).optional(),
  chatMinimumUniqueAuthors: z.number().int().min(1).max(10).optional(),
  chatDuplicateSuppressionMinutes: z.number().int().min(5).max(180).optional(),
  proactiveChatCommentary: z.boolean().optional(),
  chatCommentaryIntervalSeconds: z.number().int().min(60).max(900).optional(),
  chatCommentaryDurationSeconds: z.number().int().min(8).max(60).optional(),
});

const aiStaffTaskSchema = z.object({
  parentTaskId: z.string().uuid().nullable().optional(),
  kind: z.enum(['assignment', 'question', 'review']).default('assignment'),
  title: z.string().trim().min(2).max(200),
  instructions: z.string().trim().min(3).max(12_000),
  priority: z.enum(['low', 'normal', 'high', 'urgent']).default('normal'),
  dueAt: z.string().datetime({ offset: true }).nullable().optional(),
});

export async function aiHostOverlayState(itemId?: string | null) {
  const [settings, growth] = await Promise.all([getAiHostSettings(), getGrowthSettings().catch(() => null)]);
  if (!settings?.enabled) return { enabled: false, visible: false };
  const session = await activeAiHostSession();
  if (!session || (itemId && session.broadcast_item_id !== itemId)) return { enabled: true, visible: false };
  const turn = await currentAiStaffTurn(session.id);
  const persistent = session.format_kind === 'youtube-context';
  if (!turn && !persistent) return { enabled: true, visible: false, sessionId: session.id };
  const [member, chatModerator, memberProfile, chatModeratorProfile] = await Promise.all([
    getAiStaffMember(settings.active_moderator_id),
    persistent ? getAiStaffMember('chat-moderator') : Promise.resolve(null),
    getAiPresenterProfile(settings.active_moderator_id).catch(() => null),
    persistent ? getAiPresenterProfile('chat-moderator').catch(() => null) : Promise.resolve(null),
  ]);
  const avatarVideoPaths = configuredAiHostAvatarVideoPaths();
  const presenterMediaUrl = (
    profile: Awaited<ReturnType<typeof getAiPresenterProfile>>,
    state: 'idle' | 'speaking',
  ) => {
    const media = profile?.media[state];
    return media
      ? `/api/overlay/ai-presenters/${encodeURIComponent(profile.staff_member_id)}/${state}?v=${encodeURIComponent(media.sha256)}`
      : null;
  };
  const idleVideoUrl = presenterMediaUrl(memberProfile, 'idle');
  const speakingVideoUrl = presenterMediaUrl(memberProfile, 'speaking');
  const chatModeratorVideoUrl = presenterMediaUrl(chatModeratorProfile, 'speaking');
  return {
    enabled: true,
    visible: Boolean(turn) || persistent,
    persistent,
    formatKind: session.format_kind,
    broadcastItemId: session.broadcast_item_id,
    sessionId: session.id,
    position: settings.overlay_position,
    scale: settings.overlay_scale,
    showAvatar: settings.show_avatar,
    showChat: settings.show_chat,
    avatarVoiceSync: settings.avatar_voice_sync && settings.voice_enabled && settings.show_avatar,
    growth:
      growth?.enabled && growth.participation_overlay
        ? { shareUrl: growth.share_url, sharePrompt: growth.share_prompt }
        : null,
    moderator: member
      ? {
          id: member.id,
          name: member.display_name,
          jobTitle: member.job_title,
          avatarStyle: member.avatar_style,
          avatarVideoUrl: persistent
            ? idleVideoUrl
            : (speakingVideoUrl ?? aiHostAvatarVideoUrl(member, turn?.avatar_sequence ?? '0', avatarVideoPaths.length)),
          idleVideoUrl: persistent ? idleVideoUrl : null,
          speakingVideoUrl: persistent ? speakingVideoUrl : null,
          chatModeratorVideoUrl: persistent ? chatModeratorVideoUrl : null,
          accentColor: member.accent_color,
        }
      : null,
    chatModerator:
      persistent && chatModerator
        ? {
            id: chatModerator.id,
            name: chatModerator.display_name,
            jobTitle: chatModerator.job_title,
            avatarStyle: chatModerator.avatar_style,
            videoUrl: chatModeratorVideoUrl,
            accentColor: chatModerator.accent_color,
          }
        : null,
    turn: turn
      ? {
          id: turn.id,
          kind: turn.kind,
          headline: turn.headline,
          text: turn.text,
          cta: turn.cta,
          chatTheme: turn.chat_theme,
          chatExcerpt: turn.chat_excerpt,
          startsAt: turn.starts_at,
          endsAt: turn.ends_at,
          audioUrl: turn.audio_path ? `/api/overlay/ai-host/audio/${encodeURIComponent(turn.id)}` : null,
        }
      : null,
  };
}

export async function registerAiTvTeamRoutes(
  app: FastifyInstance,
  requirePermission: (req: FastifyRequest, reply: FastifyReply, permission: WritePermission) => void,
  runtime: AiTvTeamRuntime,
  readStoredFile: (path: string) => Promise<Buffer>,
  emitUpdate: EmitUpdate,
) {
  app.get('/api/ai-team', async () => ({
    members: await listAiStaffMembersWithWorkState(),
    activity: await aiTeamActivity(30),
  }));
  app.get('/api/ai-team/members/:memberId', async (req, reply) => {
    const id = z
      .string()
      .trim()
      .max(80)
      .parse((req.params as { memberId: string }).memberId);
    const [members, tasks, activity, metrics] = await Promise.all([
      listAiStaffMembersWithWorkState(),
      listAiStaffTasks(id, 80),
      listAiStaffActivity(id, 120),
      aiStaffTaskMetrics(id),
    ]);
    const member = members.find((candidate) => candidate.id === id);
    if (!member) return reply.code(404).send({ error: 'KI-Mitarbeiter nicht gefunden' });
    return { member, tasks, activity, metrics };
  });
  app.patch('/api/ai-team/members/:memberId', async (req, reply) => {
    requirePermission(req, reply, 'users:write');
    const id = z
      .string()
      .trim()
      .max(80)
      .parse((req.params as { memberId: string }).memberId);
    const body = z
      .object({
        display_name: z.string().trim().min(1).max(100).optional(),
        job_title: z.string().trim().min(2).max(140).optional(),
        description: z.string().trim().min(3).max(1200).optional(),
        enabled: z.boolean().optional(),
        autonomy: z.enum(['suggest', 'review', 'auto']).optional(),
        avatar_style: z.string().trim().max(80).optional(),
        accent_color: z
          .string()
          .regex(/^#[0-9a-f]{6}$/i)
          .optional(),
        instructions: z.string().trim().max(4000).optional(),
        config: aiStaffConfigSchema.optional(),
      })
      .parse(req.body ?? {});
    const member = await updateAiStaffMember(id, body);
    if (!member) return reply.code(404).send({ error: 'KI-Mitarbeiter nicht gefunden' });
    await recordAiStaffActivity({
      staffMemberId: id,
      eventType: 'settings_updated',
      title: 'Agentenkonfiguration aktualisiert',
      detail: Object.keys(body).join(', '),
      status: member.enabled ? 'ready' : 'paused',
      actorUserId: req.user?.id,
    });
    await auditLog(req.user?.id ?? null, 'ai_staff.member.update', 'ai_staff_member', undefined, {
      staffId: id,
      fields: Object.keys(body),
    });
    await emitUpdate('staff-updated', { staffId: id });
    return member;
  });
  app.post('/api/ai-team/members/:memberId/tasks', async (req, reply) => {
    requirePermission(req, reply, 'broadcast:write');
    const id = z
      .string()
      .trim()
      .max(80)
      .parse((req.params as { memberId: string }).memberId);
    if (!(await getAiStaffMember(id))) return reply.code(404).send({ error: 'KI-Mitarbeiter nicht gefunden' });
    const body = aiStaffTaskSchema.parse(req.body ?? {});
    const task = await createAiStaffTask({
      staffMemberId: id,
      parentTaskId: body.parentTaskId,
      kind: body.kind,
      title: body.title,
      instructions: body.instructions,
      priority: body.priority,
      requestedBy: req.user?.id,
      dueAt: body.dueAt,
    });
    if (!task)
      return reply.code(409).send({ error: 'Der gewählte Folgeauftrag gehört nicht zu diesem KI-Mitarbeiter.' });
    await auditLog(req.user?.id ?? null, 'ai_staff.task.create', 'ai_staff_task', task.id, {
      staffId: id,
      kind: task.kind,
      priority: task.priority,
    });
    await emitUpdate('staff-task-created', { staffId: id, taskId: task.id });
    runtime.kickTaskProcessor();
    return reply.code(202).send(task);
  });
  app.post('/api/ai-team/tasks/:id/:action', async (req, reply) => {
    requirePermission(req, reply, 'broadcast:write');
    const params = z
      .object({ id: z.string().uuid(), action: z.enum(['cancel', 'retry', 'approve']) })
      .parse(req.params);
    const existing = await getAiStaffTask(params.id);
    if (!existing) return reply.code(404).send({ error: 'Aufgabe nicht gefunden' });
    const result = await transitionAiStaffTask(params.id, params.action, req.user?.id);
    if (!result?.transitioned)
      return reply
        .code(409)
        .send({ error: 'Diese Aktion ist im aktuellen Aufgabenstatus nicht möglich.', task: result?.task ?? existing });
    await auditLog(req.user?.id ?? null, `ai_staff.task.${params.action}`, 'ai_staff_task', params.id, {
      staffId: existing.staff_member_id,
    });
    await emitUpdate(`staff-task-${params.action}`, { staffId: existing.staff_member_id, taskId: params.id });
    if (params.action === 'retry') runtime.kickTaskProcessor();
    return result.task;
  });
  app.get('/api/ai-host/settings', async () => getAiHostSettings());
  app.patch('/api/ai-host/settings', async (req, reply) => {
    requirePermission(req, reply, 'broadcast:write');
    const body = settingsSchema.parse(req.body ?? {});
    const current = await getAiHostSettings();
    const effectivePlatforms = body.chatPlatforms ?? current.chat_platforms ?? ['youtube'];
    const effectiveTwitchChannel = Object.prototype.hasOwnProperty.call(body, 'twitchChannel')
      ? body.twitchChannel
      : current.twitch_channel;
    if (effectivePlatforms.includes('twitch') && !twitchChannelName(effectiveTwitchChannel)) {
      return reply
        .code(400)
        .send({ error: 'Für Twitch bitte einen gültigen Kanalnamen oder eine twitch.tv-Kanal-URL angeben.' });
    }
    const settings = await updateAiHostSettings(body);
    await emitUpdate('settings-updated');
    void runtime.tick();
    return settings;
  });
  app.get('/api/ai-host/status', async () => {
    const settings = await getAiHostSettings();
    const session = await activeAiHostSession();
    const runtimeHealth = runtime.health();
    const youtubeConfigured = Boolean(
      process.env.YOUTUBE_DATA_API_KEY &&
      (settings.chat_source_mode === 'content' || settings.live_chat_id || settings.live_stream_url),
    );
    const twitchConfigured = Boolean(twitchChannelName(settings.twitch_channel));
    const selectedPlatforms = Array.isArray(settings.chat_platforms) ? settings.chat_platforms : ['youtube'];
    return {
      runtime: runtimeHealth,
      settings,
      session,
      turn: session ? await currentAiStaffTurn(session.id) : null,
      recentTurns: session ? await latestAiStaffTurns(session.id, 12) : [],
      chatConfigured: selectedPlatforms.some((platform) =>
        platform === 'youtube' ? youtubeConfigured : twitchConfigured,
      ),
      youtubeApiConfigured: Boolean(process.env.YOUTUBE_DATA_API_KEY),
      chatProviders: {
        youtube: { selected: selectedPlatforms.includes('youtube'), configured: youtubeConfigured },
        twitch: {
          selected: selectedPlatforms.includes('twitch'),
          ...runtimeHealth.twitchChat,
          configured: twitchConfigured,
        },
      },
    };
  });
  app.get('/api/growth', async () => ({
    settings: await getGrowthSettings(),
    summary: await growthSummary(),
    moments: await listGrowthMoments(60),
  }));
  app.patch('/api/growth/settings', async (req, reply) => {
    requirePermission(req, reply, 'users:write');
    const body = z
      .object({
        enabled: z.boolean().optional(),
        autoDetect: z.boolean().optional(),
        autoCreateSocialPack: z.boolean().optional(),
        approvalRequired: z.boolean().optional(),
        minimumScore: z.number().int().min(1).max(100).optional(),
        minimumChatMessages: z.number().int().min(1).max(50).optional(),
        clipPrerollSeconds: z.number().int().min(0).max(120).optional(),
        clipDurationSeconds: z.number().int().min(10).max(180).optional(),
        participationOverlay: z.boolean().optional(),
        shareUrl: z.string().trim().url().nullable().optional(),
        sharePrompt: z.string().trim().min(1).max(240).optional(),
        platforms: z
          .array(z.enum(['youtube-shorts', 'instagram-reels', 'tiktok', 'x', 'facebook']))
          .max(5)
          .optional(),
      })
      .parse(req.body ?? {});
    const settings = await updateGrowthSettings(body);
    await emitUpdate('growth-settings-updated');
    return settings;
  });
  app.post('/api/growth/moments/:id/:action', async (req, reply) => {
    requirePermission(req, reply, 'broadcast:write');
    const params = z.object({ id: z.string().uuid(), action: z.enum(['approve', 'reject']) }).parse(req.params);
    const moment = await updateGrowthMomentStatus(params.id, params.action === 'approve' ? 'approved' : 'rejected');
    if (!moment) return reply.code(404).send({ error: 'Highlight nicht gefunden' });
    return moment;
  });
  app.post('/api/ai-host/test-chat', async (req, reply) => {
    requirePermission(req, reply, 'broadcast:write');
    const session = await activeAiHostSession();
    if (!session) return reply.code(409).send({ error: 'Aktuell läuft kein interaktiv moderiertes YouTube-Video.' });
    const body = z
      .object({
        message: z.string().trim().min(1).max(500),
        author: z.string().trim().min(1).max(100).default('Studiotest'),
        provider: z.enum(['youtube', 'twitch', 'studio']).default('studio'),
      })
      .parse(req.body ?? {});
    await insertAiHostChatMessages(session.id, [
      {
        provider: body.provider,
        providerMessageId: `test-${Date.now()}`,
        authorName: body.author,
        message: body.message,
        safe: true,
        publishedAt: new Date().toISOString(),
      },
    ]);
    await updateAiHostSession(session.id, { lastChatResponseAt: null });
    void runtime.tick();
    return { ok: true };
  });
  app.post('/api/ai-host/turns/:id/:action', async (req, reply) => {
    requirePermission(req, reply, 'broadcast:write');
    const params = z.object({ id: z.string().uuid(), action: z.enum(['approve', 'reject']) }).parse(req.params);
    const turn = await updateAiStaffTurnStatus(params.id, params.action === 'approve' ? 'approved' : 'rejected');
    if (!turn) return reply.code(404).send({ error: 'Moderation nicht gefunden' });
    if (params.action === 'approve') runtime.queueVoice(turn, await getAiHostSettings());
    await emitUpdate(`turn-${params.action}`, { turnId: turn.id });
    return turn;
  });
  app.get('/api/overlay/ai-host/avatar/:memberId', async (req, reply) => {
    const memberId = z
      .string()
      .trim()
      .min(1)
      .max(80)
      .regex(/^[a-z0-9_-]+$/i)
      .parse((req.params as { memberId: string }).memberId);
    const variant = z.coerce
      .number()
      .int()
      .min(1)
      .max(20)
      .catch(1)
      .parse((req.query as { variant?: unknown }).variant ?? 1);
    const member = await getAiStaffMember(memberId);
    const avatarPaths = configuredAiHostAvatarVideoPaths();
    const avatarPath = avatarPaths[variant - 1] ?? avatarPaths[0] ?? '';
    if (!member || member.avatar_style !== 'video' || !avatarPath) {
      return reply.code(404).send({ error: 'Avatar-Video nicht verfügbar' });
    }
    try {
      const video = await readStoredFile(avatarPath);
      return reply.header('Cache-Control', 'public, max-age=300').type('video/webm').send(video);
    } catch (error) {
      req.log.warn({ error, memberId }, 'Konfiguriertes KI-Avatar-Video ist nicht lesbar');
      return reply.code(404).send({ error: 'Avatar-Video nicht verfügbar' });
    }
  });
  app.get('/api/overlay/ai-host/audio/:id', async (req, reply) => {
    const id = z
      .string()
      .uuid()
      .parse((req.params as { id: string }).id);
    const turn = await getAiStaffTurn(id);
    if (!turn?.audio_path) return reply.code(404).send({ error: 'Audio ist noch nicht verfügbar' });
    const audio = await readStoredFile(turn.audio_path);
    return reply.header('Cache-Control', 'private, max-age=3600').type('audio/wav').send(audio);
  });
}
