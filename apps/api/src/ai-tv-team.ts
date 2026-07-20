import type { FastifyInstance, FastifyReply, FastifyRequest } from 'fastify';
import { z } from 'zod';
import { createYoutubeHostChatResponse, prepareYoutubeHostBriefing, type HostBriefingAiOutput } from '@ans/ai-provider';
import {
  activeAiHostSession,
  aiHostTurnsLastHour,
  aiTeamActivity,
  createAiStaffTurn,
  currentAiStaffTurn,
  endActiveAiHostSession,
  getAiHostSettings,
  getAiStaffMember,
  getAiStaffTurn,
  insertAiHostChatMessages,
  latestAiStaffTurns,
  listAiStaffMembers,
  markAiHostChatMessagesUsed,
  setAiStaffTurnAudio,
  startAiHostSession,
  unusedAiHostChatMessages,
  updateAiHostSession,
  updateAiHostSettings,
  updateAiStaffMember,
  updateAiStaffTurnStatus,
  youtubeItemForAiHost,
  type AiHostSession,
  type AiHostSettings,
  type AiStaffTurn,
} from '@ans/database/ai-staff';
import { getPlaybackSnapshot } from '@ans/database';
import { createGrowthMoment, getGrowthSettings, growthSummary, listGrowthMoments, updateGrowthMomentStatus, updateGrowthSettings } from '@ans/database/growth';
import type { WritePermission } from '@ans/security/auth';
import { generateTtsAudio } from './tts-generation.js';
import { fetchYoutubeLiveChatPage, resolveYoutubeLiveChatId } from './youtube-live-chat.js';

type EmitUpdate = (reason: string, payload?: Record<string, unknown>) => Promise<void>;

function stringArray(value: unknown) {
  return Array.isArray(value) ? value.filter((item): item is string => typeof item === 'string' && Boolean(item.trim())) : [];
}

function fallbackBriefing(video: Awaited<ReturnType<typeof youtubeItemForAiHost>>): HostBriefingAiOutput {
  const description = video?.description?.replace(/\s+/g, ' ').trim();
  return {
    neutralSummary: description?.slice(0, 780) || `Im laufenden Video „${video?.title ?? 'YouTube-Video'}“ stellt der Kanal ${video?.channel_title ?? 'YouTube'} sein Thema vor.`,
    context: `Das Video stammt vom YouTube-Kanal ${video?.channel_title ?? 'Unbekannt'}. Aussagen des Videos werden in der Sendung als Position des jeweiligen Urhebers behandelt.`,
    keyClaims: [video?.title ?? 'Thema des laufenden Videos'],
    uncertainties: ['Für eine belastbare Bewertung müssen die im Video genannten Primärquellen einzeln geprüft werden.'],
    criticalQuestions: [
      'Welche konkrete Aussage im Video überzeugt dich – und auf welche Quelle stützt du dich?',
      'Welche wichtige Gegenposition oder Information fehlt aus deiner Sicht?',
      'Woran ließe sich die zentrale Aussage des Videos nachvollziehbar überprüfen?',
    ],
    chatPrompts: ['Schreib deine begründete Meinung in den Chat.', 'Welche Frage soll die Redaktion als Nächstes aufgreifen?'],
  };
}

function safeDate(value: string | null | undefined, fallbackMs = Date.now()) {
  const timestamp = value ? Date.parse(value) : Number.NaN;
  return Number.isFinite(timestamp) ? timestamp : fallbackMs;
}

function turnStatus(settings: AiHostSettings, autonomy: string | undefined): AiStaffTurn['status'] {
  return settings.interaction_mode === 'review' || autonomy === 'review' ? 'pending' : 'approved';
}

export class AiTvTeamRuntime {
  private timer: NodeJS.Timeout | null = null;
  private running = false;
  private stopped = false;
  private resolvedLiveChat = new Map<string, string>();
  private voiceJobs = new Map<string, Promise<void>>();
  private lastError: string | null = null;
  private lastTickAt: string | null = null;

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
  }

  health() {
    return { running: Boolean(this.timer) && !this.stopped, busy: this.running, lastTickAt: this.lastTickAt, lastError: this.lastError, voiceJobs: this.voiceJobs.size };
  }

  async tick() {
    if (this.running || this.stopped) return;
    this.running = true;
    this.lastTickAt = new Date().toISOString();
    try {
      const settings = await getAiHostSettings();
      const playback = await getPlaybackSnapshot();
      if (!settings?.enabled || !['playing', 'preparing', 'paused'].includes(playback.status) || !playback.itemId) {
        if (await activeAiHostSession()) await endActiveAiHostSession();
        this.lastError = null;
        return;
      }
      const video = await youtubeItemForAiHost(playback.itemId);
      if (!video) {
        if (await activeAiHostSession()) await endActiveAiHostSession();
        this.lastError = null;
        return;
      }
      let session = await startAiHostSession({
        broadcastItemId: video.item_id,
        youtubeLibraryId: video.youtube_library_id,
        youtubeVideoId: video.youtube_video_id,
        videoTitle: video.title,
        channelTitle: video.channel_title,
        videoUrl: video.url,
      });
      if (!session.briefing) session = await this.prepareSession(session, video, settings);
      if (playback.status === 'paused') {
        if (session.status !== 'paused') await updateAiHostSession(session.id, { status: 'paused' });
        return;
      }
      if (session.status !== 'live') session = (await updateAiHostSession(session.id, { status: 'live' })) ?? session;
      await this.pollChat(session, settings);
      const activeTurn = await currentAiStaffTurn(session.id);
      if (activeTurn) return;
      const latest = (await latestAiStaffTurns(session.id, 1))[0];
      if (latest?.status === 'pending' && safeDate(latest.created_at) > Date.now() - 10 * 60_000) return;
      if ((await aiHostTurnsLastHour(session.id)) >= settings.max_turns_per_hour) return;
      if (await this.maybeRespondToChat(session, settings)) return;
      if (safeDate(session.next_phase_at, 0) > Date.now()) return;
      await this.createScheduledTurn(session, settings);
      this.lastError = null;
    } catch (error) {
      this.lastError = error instanceof Error ? error.message : String(error);
    } finally {
      this.running = false;
    }
  }

  private async prepareSession(session: AiHostSession, video: NonNullable<Awaited<ReturnType<typeof youtubeItemForAiHost>>>, settings: AiHostSettings) {
    const moderator = await getAiStaffMember(settings.active_moderator_id);
    let briefing = fallbackBriefing(video);
    let model = 'redaktioneller-fallback';
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
    const updated = (await updateAiHostSession(session.id, {
      briefing,
      briefingModel: model,
      status: 'live',
      nextPhaseAt: new Date(Date.now() + settings.question_interval_seconds * 1000).toISOString(),
    })) ?? session;
    const intro = await createAiStaffTurn({
      sessionId: session.id,
      staffMemberId: settings.active_moderator_id,
      kind: 'intro',
      headline: 'Jetzt im Programm',
      text: briefing.neutralSummary,
      cta: settings.participation_prompt,
      status: turnStatus(settings, moderator?.autonomy),
      model,
      durationSeconds: settings.response_duration_seconds,
    });
    this.queueVoice(intro, settings);
    await this.emitUpdate('session-started', { sessionId: session.id, itemId: video.item_id });
    return updated;
  }

  private async pollChat(session: AiHostSession, settings: AiHostSettings) {
    if (!settings.show_chat || settings.interaction_mode === 'off') return;
    const chatSourceUrl = settings.chat_source_mode === 'content' ? session.video_url : settings.live_stream_url;
    const explicitChatId = settings.chat_source_mode === 'content' ? null : settings.live_chat_id;
    if (!process.env.YOUTUBE_DATA_API_KEY?.trim() || (!explicitChatId && !chatSourceUrl)) return;
    if (safeDate(session.chat_poll_after, 0) > Date.now()) return;
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
      const sessionStarted = safeDate(session.started_at) - 30_000;
      const messages = page.messages.filter((message) => safeDate(message.publishedAt) >= sessionStarted);
      await insertAiHostChatMessages(session.id, messages);
      await updateAiHostSession(session.id, {
        chatPageToken: page.nextPageToken,
        chatPollAfter: new Date(Date.now() + page.pollAfterMs).toISOString(),
        chatError: null,
      });
    } catch (error) {
      await updateAiHostSession(session.id, {
        chatPollAfter: new Date(Date.now() + 30_000).toISOString(),
        chatError: error instanceof Error ? error.message.slice(0, 500) : String(error).slice(0, 500),
      });
    }
  }

  private async maybeRespondToChat(session: AiHostSession, settings: AiHostSettings) {
    if (!settings.show_chat || settings.interaction_mode === 'off') return false;
    if (safeDate(session.last_chat_response_at, 0) + settings.response_cooldown_seconds * 1000 > Date.now()) return false;
    const messages = await unusedAiHostChatMessages(session.id, settings.max_chat_messages_per_turn);
    if (messages.length < settings.minimum_chat_messages) return false;
    const moderator = await getAiStaffMember(settings.active_moderator_id);
    const briefing = session.briefing as HostBriefingAiOutput;
    let response = {
      theme: 'Stimmen aus dem Chat',
      headline: 'Der Chat diskutiert',
      response: `Im Chat werden unterschiedliche Sichtweisen zum laufenden Video genannt. Entscheidend ist, welche konkrete Aussage sich mit einer nachvollziehbaren Quelle belegen lässt.`,
      followUpQuestion: stringArray(briefing?.criticalQuestions)[session.phase_index % Math.max(1, stringArray(briefing?.criticalQuestions).length)] || 'Welche Belege sind für eure Einschätzung ausschlaggebend?',
      representativeExcerpt: messages[0]?.message.slice(0, 220) ?? '',
    };
    let model = 'redaktioneller-fallback';
    try {
      const result = await createYoutubeHostChatResponse({
        videoTitle: session.video_title,
        channel: session.channel_title,
        briefing,
        currentQuestion: stringArray(briefing?.criticalQuestions)[session.phase_index % Math.max(1, stringArray(briefing?.criticalQuestions).length)],
        moderatorName: moderator?.display_name,
        moderatorInstructions: moderator?.instructions,
        chatMessages: messages.map((message) => ({ author: settings.anonymize_authors ? null : message.author_name, message: message.message })),
      });
      response = result.output;
      model = result.model;
    } catch {
      // Deterministischer Fallback hält die Live-Sendung interaktiv.
    }
    const turn = await createAiStaffTurn({
      sessionId: session.id,
      staffMemberId: settings.active_moderator_id,
      kind: 'chat-response',
      headline: response.headline,
      text: response.response,
      cta: response.followUpQuestion,
      chatTheme: response.theme,
      chatExcerpt: response.representativeExcerpt,
      sourceMessageIds: messages.map((message) => message.id),
      status: turnStatus(settings, moderator?.autonomy),
      model,
      durationSeconds: settings.response_duration_seconds,
    });
    await markAiHostChatMessagesUsed(messages.map((message) => message.id));
    await updateAiHostSession(session.id, { lastChatResponseAt: new Date().toISOString() });
    await this.captureGrowthMoment(session, response.headline, response.followUpQuestion, messages.length);
    this.queueVoice(turn, settings);
    await this.emitUpdate('chat-response', { sessionId: session.id, turnId: turn.id });
    return true;
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
    const question = questions[phase % Math.max(1, questions.length)] || 'Welche Information ist für eure Einschätzung entscheidend?';
    const useContext = phase % 3 === 2 && claims.length > 0;
    const moderator = await getAiStaffMember(settings.active_moderator_id);
    const turn = await createAiStaffTurn({
      sessionId: session.id,
      staffMemberId: settings.active_moderator_id,
      kind: useContext ? 'context' : 'question',
      headline: useContext ? 'Redaktioneller Blick' : 'Frage an euch',
      text: useContext ? claims[phase % claims.length]! : question,
      cta: prompts[phase % Math.max(1, prompts.length)] || settings.participation_prompt,
      status: turnStatus(settings, moderator?.autonomy),
      model: session.briefing_model,
      durationSeconds: settings.response_duration_seconds,
    });
    await updateAiHostSession(session.id, {
      phaseIndex: phase + 1,
      nextPhaseAt: new Date(Date.now() + settings.question_interval_seconds * 1000).toISOString(),
    });
    this.queueVoice(turn, settings);
    await this.emitUpdate('scheduled-turn', { sessionId: session.id, turnId: turn.id });
  }

  queueVoice(turn: AiStaffTurn, settings: AiHostSettings) {
    if (!settings.voice_enabled || turn.status === 'pending' || this.voiceJobs.has(turn.id)) return;
    const job = generateTtsAudio(`${turn.headline}. ${turn.text} ${turn.cta ?? ''}`)
      .then(async (audio) => {
        await setAiStaffTurnAudio(turn.id, audio.file);
        await this.emitUpdate('voice-ready', { turnId: turn.id });
      })
      .catch(() => undefined)
      .finally(() => this.voiceJobs.delete(turn.id));
    this.voiceJobs.set(turn.id, job);
  }
}

const settingsSchema = z.object({
  enabled: z.boolean().optional(),
  liveStreamUrl: z.string().trim().url().nullable().optional(),
  liveChatId: z.string().trim().max(500).nullable().optional(),
  chatSourceMode: z.enum(['channel', 'content']).optional(),
  activeModeratorId: z.string().trim().max(80).optional(),
  overlayPosition: z.enum(['top-left', 'top-right', 'bottom-left', 'bottom-right']).optional(),
  overlayScale: z.number().int().min(65).max(140).optional(),
  showAvatar: z.boolean().optional(),
  showChat: z.boolean().optional(),
  anonymizeAuthors: z.boolean().optional(),
  voiceEnabled: z.boolean().optional(),
  interactionMode: z.enum(['off', 'review', 'auto-safe']).optional(),
  questionIntervalSeconds: z.number().int().min(20).max(900).optional(),
  responseCooldownSeconds: z.number().int().min(20).max(900).optional(),
  responseDurationSeconds: z.number().int().min(8).max(120).optional(),
  maxTurnsPerHour: z.number().int().min(1).max(60).optional(),
  maxChatMessagesPerTurn: z.number().int().min(1).max(50).optional(),
  minimumChatMessages: z.number().int().min(1).max(20).optional(),
  participationPrompt: z.string().trim().min(1).max(240).optional(),
});

export async function aiHostOverlayState(itemId?: string | null) {
  const [settings, growth] = await Promise.all([getAiHostSettings(), getGrowthSettings().catch(() => null)]);
  if (!settings?.enabled) return { enabled: false, visible: false };
  const session = await activeAiHostSession();
  if (!session || (itemId && session.broadcast_item_id !== itemId)) return { enabled: true, visible: false };
  const turn = await currentAiStaffTurn(session.id);
  if (!turn) return { enabled: true, visible: false, sessionId: session.id };
  const member = await getAiStaffMember(turn.staff_member_id);
  return {
    enabled: true,
    visible: true,
    sessionId: session.id,
    position: settings.overlay_position,
    scale: settings.overlay_scale,
    showAvatar: settings.show_avatar,
    showChat: settings.show_chat,
    growth: growth?.enabled && growth.participation_overlay ? { shareUrl: growth.share_url, sharePrompt: growth.share_prompt } : null,
    moderator: member ? { id: member.id, name: member.display_name, jobTitle: member.job_title, avatarStyle: member.avatar_style, accentColor: member.accent_color } : null,
    turn: {
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
    },
  };
}

export async function registerAiTvTeamRoutes(
  app: FastifyInstance,
  requirePermission: (req: FastifyRequest, reply: FastifyReply, permission: WritePermission) => void,
  runtime: AiTvTeamRuntime,
  readStoredFile: (path: string) => Promise<Buffer>,
  emitUpdate: EmitUpdate,
) {
  app.get('/api/ai-team', async () => ({ members: await listAiStaffMembers(), activity: await aiTeamActivity(30) }));
  app.patch('/api/ai-team/members/:id', async (req, reply) => {
    requirePermission(req, reply, 'users:write');
    const id = z.string().trim().max(80).parse((req.params as { id: string }).id);
    const body = z.object({
      display_name: z.string().trim().min(1).max(100).optional(), enabled: z.boolean().optional(),
      autonomy: z.enum(['suggest', 'review', 'auto']).optional(), avatar_style: z.string().trim().max(80).optional(),
      accent_color: z.string().regex(/^#[0-9a-f]{6}$/i).optional(), instructions: z.string().trim().max(4000).optional(),
    }).parse(req.body ?? {});
    const member = await updateAiStaffMember(id, body);
    if (!member) return reply.code(404).send({ error: 'KI-Mitarbeiter nicht gefunden' });
    await emitUpdate('staff-updated', { staffId: id });
    return member;
  });
  app.get('/api/ai-host/settings', async () => getAiHostSettings());
  app.patch('/api/ai-host/settings', async (req, reply) => {
    requirePermission(req, reply, 'broadcast:write');
    const settings = await updateAiHostSettings(settingsSchema.parse(req.body ?? {}));
    await emitUpdate('settings-updated');
    void runtime.tick();
    return settings;
  });
  app.get('/api/ai-host/status', async () => {
    const settings = await getAiHostSettings();
    const session = await activeAiHostSession();
    return {
      runtime: runtime.health(), settings, session,
      turn: session ? await currentAiStaffTurn(session.id) : null,
      recentTurns: session ? await latestAiStaffTurns(session.id, 12) : [],
      chatConfigured: Boolean(process.env.YOUTUBE_DATA_API_KEY && (settings.chat_source_mode === 'content' || settings.live_chat_id || settings.live_stream_url)),
      youtubeApiConfigured: Boolean(process.env.YOUTUBE_DATA_API_KEY),
    };
  });
  app.get('/api/growth', async () => ({ settings: await getGrowthSettings(), summary: await growthSummary(), moments: await listGrowthMoments(60) }));
  app.patch('/api/growth/settings', async (req, reply) => {
    requirePermission(req, reply, 'users:write');
    const body = z.object({
      enabled:z.boolean().optional(),autoDetect:z.boolean().optional(),autoCreateSocialPack:z.boolean().optional(),approvalRequired:z.boolean().optional(),
      minimumScore:z.number().int().min(1).max(100).optional(),minimumChatMessages:z.number().int().min(1).max(50).optional(),
      clipPrerollSeconds:z.number().int().min(0).max(120).optional(),clipDurationSeconds:z.number().int().min(10).max(180).optional(),
      participationOverlay:z.boolean().optional(),shareUrl:z.string().trim().url().nullable().optional(),sharePrompt:z.string().trim().min(1).max(240).optional(),
      platforms:z.array(z.enum(['youtube-shorts','instagram-reels','tiktok','x','facebook'])).max(5).optional(),
    }).parse(req.body ?? {});
    const settings = await updateGrowthSettings(body);
    await emitUpdate('growth-settings-updated');
    return settings;
  });
  app.post('/api/growth/moments/:id/:action', async (req, reply) => {
    requirePermission(req, reply, 'broadcast:write');
    const params=z.object({id:z.string().uuid(),action:z.enum(['approve','reject'])}).parse(req.params);
    const moment=await updateGrowthMomentStatus(params.id,params.action==='approve'?'approved':'rejected');
    if(!moment)return reply.code(404).send({error:'Highlight nicht gefunden'});
    return moment;
  });
  app.post('/api/ai-host/test-chat', async (req, reply) => {
    requirePermission(req, reply, 'broadcast:write');
    const session = await activeAiHostSession();
    if (!session) return reply.code(409).send({ error: 'Aktuell läuft kein interaktiv moderiertes YouTube-Video.' });
    const body = z.object({ message: z.string().trim().min(1).max(500), author: z.string().trim().min(1).max(100).default('Studiotest') }).parse(req.body ?? {});
    await insertAiHostChatMessages(session.id, [{ providerMessageId: `test-${Date.now()}`, authorName: body.author, message: body.message, safe: true, publishedAt: new Date().toISOString() }]);
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
  app.get('/api/overlay/ai-host/audio/:id', async (req, reply) => {
    const id = z.string().uuid().parse((req.params as { id: string }).id);
    const turn = await getAiStaffTurn(id);
    if (!turn?.audio_path) return reply.code(404).send({ error: 'Audio ist noch nicht verfügbar' });
    const audio = await readStoredFile(turn.audio_path);
    return reply.header('Cache-Control', 'private, max-age=3600').type('audio/wav').send(audio);
  });
}
