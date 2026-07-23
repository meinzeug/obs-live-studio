import { query, transaction } from './index.js';

export type AiStaffAutonomy = 'suggest' | 'review' | 'auto';
export type AiHostInteractionMode = 'off' | 'review' | 'auto-safe';

export type AiStaffMember = {
  id: string;
  display_name: string;
  job_title: string;
  role: string;
  description: string;
  enabled: boolean;
  autonomy: AiStaffAutonomy;
  avatar_style: string;
  accent_color: string;
  instructions: string;
  config: Record<string, unknown>;
  updated_at: string;
};

export type AiStaffTaskKind = 'assignment' | 'question' | 'review';
export type AiStaffTaskPriority = 'low' | 'normal' | 'high' | 'urgent';
export type AiStaffTaskStatus = 'queued' | 'running' | 'waiting_review' | 'completed' | 'failed' | 'cancelled';

export type AiStaffTask = {
  id: string;
  staff_member_id: string;
  parent_task_id: string | null;
  kind: AiStaffTaskKind;
  title: string;
  instructions: string;
  priority: AiStaffTaskPriority;
  status: AiStaffTaskStatus;
  requested_by: string | null;
  requested_by_name?: string | null;
  due_at: string | null;
  result_summary: string | null;
  result_text: string | null;
  result: Record<string, unknown>;
  model: string | null;
  error: string | null;
  attempts: number;
  locked_at: string | null;
  started_at: string | null;
  completed_at: string | null;
  cancelled_at: string | null;
  created_at: string;
  updated_at: string;
};

export type AiStaffActivity = {
  id: string;
  staff_member_id: string;
  task_id: string | null;
  event_type: string;
  title: string;
  detail: string | null;
  status: string | null;
  metadata: Record<string, unknown>;
  actor_user_id: string | null;
  actor_name: string | null;
  created_at: string;
};

export type AiStaffMemberSummary = AiStaffMember & {
  work_status: 'paused' | 'working' | 'queued' | 'on_air' | 'ready';
  open_tasks: number;
  completed_tasks: number;
  failed_tasks: number;
  total_tasks: number;
  last_activity_at: string | null;
  current_task_title: string | null;
};

export type AiHostEditorialResearchSource = {
  id: string;
  title: string;
  publisher: string;
  url: string;
  excerpt: string;
  published_at: string | null;
  trust_score: number;
  status: string;
};

export type AiHostSettings = {
  id: boolean;
  enabled: boolean;
  live_stream_url: string | null;
  live_chat_id: string | null;
  chat_source_mode: 'channel' | 'content';
  chat_platforms: Array<'youtube' | 'twitch'>;
  twitch_channel: string | null;
  active_moderator_id: string;
  overlay_position: 'top-left' | 'top-right' | 'bottom-left' | 'bottom-right';
  overlay_scale: number;
  show_avatar: boolean;
  show_chat: boolean;
  anonymize_authors: boolean;
  voice_enabled: boolean;
  avatar_voice_sync: boolean;
  interaction_mode: AiHostInteractionMode;
  question_interval_seconds: number;
  response_cooldown_seconds: number;
  response_duration_seconds: number;
  max_turns_per_hour: number;
  max_chat_messages_per_turn: number;
  minimum_chat_messages: number;
  participation_prompt: string;
  greeting_enabled: boolean;
  greeting_presenter_mode: 'ava' | 'mia' | 'alternate';
  greeting_cooldown_seconds: number;
  greeting_like_step: number;
  greeting_youtube_memberships: boolean;
  greeting_youtube_subscribers: boolean;
  greeting_youtube_likes: boolean;
  greeting_twitch_subscriptions: boolean;
  greeting_twitch_follows: boolean;
  updated_at: string;
};

export type AiHostSession = {
  id: string;
  broadcast_item_id: string | null;
  youtube_library_id: string | null;
  youtube_video_id: string;
  video_title: string;
  channel_title: string;
  video_url: string;
  format_kind: string;
  briefing: Record<string, unknown> | null;
  briefing_model: string | null;
  status: 'preparing' | 'live' | 'paused' | 'ended' | 'error';
  phase_index: number;
  next_phase_at: string | null;
  last_chat_response_at: string | null;
  chat_page_token: string | null;
  chat_poll_after: string | null;
  chat_error: string | null;
  chat_live_chat_id: string | null;
  chat_source_key: string | null;
  chat_last_success_at: string | null;
  chat_last_message_at: string | null;
  chat_messages_received: number;
  chat_provider_state: Record<string, unknown>;
  direction_state: Record<string, unknown>;
  last_direction_at: string | null;
  next_direction_at: string | null;
  started_at: string;
  ended_at: string | null;
  updated_at: string;
};

export type AiHostChatMessage = {
  id: string;
  session_id: string;
  provider: string;
  provider_message_id: string;
  author_name: string;
  author_channel_id: string | null;
  message: string;
  message_type: string;
  safe: boolean;
  moderation_reason: string | null;
  used_at: string | null;
  published_at: string;
  received_at: string;
};

export type AiHostChatQueueMetrics = {
  received_total: number;
  safe_total: number;
  pending_total: number;
  pending_questions: number;
  processed_total: number;
  rejected_total: number;
  last_received_at: string | null;
  last_processed_at: string | null;
};

export type AiStaffTurn = {
  id: string;
  session_id: string;
  staff_member_id: string;
  kind: 'intro' | 'context' | 'question' | 'chat-response' | 'chat-commentary' | 'greeting' | 'cta' | 'fallback';
  headline: string;
  text: string;
  cta: string | null;
  chat_theme: string | null;
  chat_excerpt: string | null;
  chat_fingerprint: string | null;
  source_message_ids: string[];
  status: 'pending' | 'approved' | 'live' | 'expired' | 'rejected';
  model: string | null;
  audio_path: string | null;
  voice_attempts: number;
  voice_error: string | null;
  voice_retry_at: string | null;
  voice_ready_at: string | null;
  starts_at: string;
  ends_at: string;
  created_at: string;
  avatar_sequence: string;
  display_mode: 'takeover' | 'inline';
  presentation: Record<string, unknown>;
};

export async function listAiStaffMembers() {
  return (
    await query<AiStaffMember>(
      "select * from ai_staff_members order by case role when 'producer' then 1 when 'editor' then 2 when 'fact-checker' then 3 when 'chat-analyst' then 4 when 'chat-moderator' then 5 when 'moderator' then 6 else 7 end",
    )
  ).rows;
}

export async function listAiStaffMembersWithWorkState() {
  return (
    await query<AiStaffMemberSummary>(
      `select m.*,
        case
          when not m.enabled then 'paused'
          when coalesce(tasks.running_tasks,0)>0 then 'working'
          when live_turn.id is not null then 'on_air'
          when coalesce(tasks.queued_tasks,0)>0 then 'queued'
          else 'ready'
        end work_status,
        coalesce(tasks.open_tasks,0)::int open_tasks,
        coalesce(tasks.completed_tasks,0)::int completed_tasks,
        coalesce(tasks.failed_tasks,0)::int failed_tasks,
        coalesce(tasks.total_tasks,0)::int total_tasks,
        greatest(tasks.last_task_at,turns.last_turn_at,activity.last_activity_at) last_activity_at,
        tasks.current_task_title
       from ai_staff_members m
       left join lateral (
         select
           count(*) filter(where status in ('queued','running','waiting_review')) open_tasks,
           count(*) filter(where status='running') running_tasks,
           count(*) filter(where status='queued') queued_tasks,
           count(*) filter(where status='completed') completed_tasks,
           count(*) filter(where status='failed') failed_tasks,
           count(*) total_tasks,
           max(updated_at) last_task_at,
           (array_agg(title order by case status when 'running' then 0 else 1 end,updated_at desc)
             filter(where status in ('running','queued','waiting_review')))[1] current_task_title
         from ai_staff_tasks where staff_member_id=m.id
       ) tasks on true
       left join lateral (
         select max(created_at) last_turn_at from ai_staff_turns where staff_member_id=m.id
       ) turns on true
       left join lateral (
         select max(created_at) last_activity_at from ai_staff_activity where staff_member_id=m.id
       ) activity on true
       left join lateral (
         select id from ai_staff_turns
         where staff_member_id=m.id and status in ('approved','live') and starts_at<=now() and ends_at>now()
         order by starts_at desc limit 1
       ) live_turn on true
       order by case m.role when 'producer' then 1 when 'editor' then 2 when 'fact-checker' then 3 when 'chat-analyst' then 4 when 'chat-moderator' then 5 when 'moderator' then 6 else 7 end`,
    )
  ).rows;
}

export async function getAiStaffMember(id: string) {
  return (await query<AiStaffMember>('select * from ai_staff_members where id=$1', [id])).rows[0] ?? null;
}

export async function updateAiStaffMember(
  id: string,
  input: Partial<
    Pick<
      AiStaffMember,
      | 'display_name'
      | 'job_title'
      | 'description'
      | 'enabled'
      | 'autonomy'
      | 'avatar_style'
      | 'accent_color'
      | 'instructions'
      | 'config'
    >
  >,
) {
  return (
    (
      await query<AiStaffMember>(
        `update ai_staff_members set
         display_name=coalesce($2,display_name),
         job_title=coalesce($3,job_title),
         description=coalesce($4,description),
         enabled=coalesce($5,enabled),
         autonomy=coalesce($6,autonomy),
         avatar_style=coalesce($7,avatar_style),
         accent_color=coalesce($8,accent_color),
         instructions=coalesce($9,instructions),
         config=coalesce($10,config),
         updated_at=now()
       where id=$1 returning *`,
        [
          id,
          input.display_name ?? null,
          input.job_title ?? null,
          input.description ?? null,
          input.enabled ?? null,
          input.autonomy ?? null,
          input.avatar_style ?? null,
          input.accent_color ?? null,
          input.instructions ?? null,
          input.config ?? null,
        ],
      )
    ).rows[0] ?? null
  );
}

export async function getAiHostSettings() {
  return (await query<AiHostSettings>('select * from ai_host_settings where id=true')).rows[0];
}

export async function updateAiHostSettings(
  input: Partial<{
    enabled: boolean;
    liveStreamUrl: string | null;
    liveChatId: string | null;
    chatSourceMode: AiHostSettings['chat_source_mode'];
    chatPlatforms: AiHostSettings['chat_platforms'];
    twitchChannel: string | null;
    activeModeratorId: string;
    overlayPosition: AiHostSettings['overlay_position'];
    overlayScale: number;
    showAvatar: boolean;
    showChat: boolean;
    anonymizeAuthors: boolean;
    voiceEnabled: boolean;
    avatarVoiceSync: boolean;
    interactionMode: AiHostInteractionMode;
    questionIntervalSeconds: number;
    responseCooldownSeconds: number;
    responseDurationSeconds: number;
    maxTurnsPerHour: number;
    maxChatMessagesPerTurn: number;
    minimumChatMessages: number;
    participationPrompt: string;
    greetingEnabled: boolean;
    greetingPresenterMode: AiHostSettings['greeting_presenter_mode'];
    greetingCooldownSeconds: number;
    greetingLikeStep: number;
    greetingYoutubeMemberships: boolean;
    greetingYoutubeSubscribers: boolean;
    greetingYoutubeLikes: boolean;
    greetingTwitchSubscriptions: boolean;
    greetingTwitchFollows: boolean;
  }>,
) {
  return (
    await query<AiHostSettings>(
      `update ai_host_settings set
         enabled=coalesce($1,enabled),live_stream_url=case when $2 then $3 else live_stream_url end,
         live_chat_id=case when $4 then $5 else live_chat_id end,active_moderator_id=coalesce($6,active_moderator_id),
         overlay_position=coalesce($7,overlay_position),overlay_scale=coalesce($8,overlay_scale),
         show_avatar=coalesce($9,show_avatar),show_chat=coalesce($10,show_chat),
         anonymize_authors=coalesce($11,anonymize_authors),voice_enabled=coalesce($12,voice_enabled),
         interaction_mode=coalesce($13,interaction_mode),question_interval_seconds=coalesce($14,question_interval_seconds),
         response_cooldown_seconds=coalesce($15,response_cooldown_seconds),response_duration_seconds=coalesce($16,response_duration_seconds),
         max_turns_per_hour=coalesce($17,max_turns_per_hour),max_chat_messages_per_turn=coalesce($18,max_chat_messages_per_turn),
         minimum_chat_messages=coalesce($19,minimum_chat_messages),participation_prompt=coalesce($20,participation_prompt),
         chat_source_mode=coalesce($21,chat_source_mode),
         chat_platforms=coalesce($22::jsonb,chat_platforms),
         twitch_channel=case when $23 then $24 else twitch_channel end,
         avatar_voice_sync=coalesce($25,avatar_voice_sync),
         greeting_enabled=coalesce($26,greeting_enabled),
         greeting_presenter_mode=coalesce($27,greeting_presenter_mode),
         greeting_cooldown_seconds=coalesce($28,greeting_cooldown_seconds),
         greeting_like_step=coalesce($29,greeting_like_step),
         greeting_youtube_memberships=coalesce($30,greeting_youtube_memberships),
         greeting_youtube_subscribers=coalesce($31,greeting_youtube_subscribers),
         greeting_youtube_likes=coalesce($32,greeting_youtube_likes),
         greeting_twitch_subscriptions=coalesce($33,greeting_twitch_subscriptions),
         greeting_twitch_follows=coalesce($34,greeting_twitch_follows),
         updated_at=now()
       where id=true returning *`,
      [
        input.enabled ?? null,
        Object.prototype.hasOwnProperty.call(input, 'liveStreamUrl'),
        input.liveStreamUrl ?? null,
        Object.prototype.hasOwnProperty.call(input, 'liveChatId'),
        input.liveChatId ?? null,
        input.activeModeratorId ?? null,
        input.overlayPosition ?? null,
        input.overlayScale ?? null,
        input.showAvatar ?? null,
        input.showChat ?? null,
        input.anonymizeAuthors ?? null,
        input.voiceEnabled ?? null,
        input.interactionMode ?? null,
        input.questionIntervalSeconds ?? null,
        input.responseCooldownSeconds ?? null,
        input.responseDurationSeconds ?? null,
        input.maxTurnsPerHour ?? null,
        input.maxChatMessagesPerTurn ?? null,
        input.minimumChatMessages ?? null,
        input.participationPrompt ?? null,
        input.chatSourceMode ?? null,
        input.chatPlatforms ? JSON.stringify(input.chatPlatforms) : null,
        Object.prototype.hasOwnProperty.call(input, 'twitchChannel'),
        input.twitchChannel ?? null,
        input.avatarVoiceSync ?? null,
        input.greetingEnabled ?? null,
        input.greetingPresenterMode ?? null,
        input.greetingCooldownSeconds ?? null,
        input.greetingLikeStep ?? null,
        input.greetingYoutubeMemberships ?? null,
        input.greetingYoutubeSubscribers ?? null,
        input.greetingYoutubeLikes ?? null,
        input.greetingTwitchSubscriptions ?? null,
        input.greetingTwitchFollows ?? null,
      ],
    )
  ).rows[0];
}

export async function youtubeItemForAiHost(itemId: string) {
  return (
    (
      await query<{
        item_id: string;
        youtube_library_id: string | null;
        youtube_video_id: string;
        title: string;
        channel_title: string;
        url: string;
        description: string | null;
        category_name: string | null;
        duration_seconds: number;
        format_kind: string;
        context_analysis: Record<string, unknown> | null;
        context_analysis_model: string | null;
        transcript_segments: Array<{ startMs: number; durationMs: number; text: string }>;
        format_regie: Record<string, unknown>;
      }>(
        `select bi.id item_id,yv.id youtube_library_id,
              coalesce(nullif(bi.rules->>'youtubeVideoId',''),yv.video_id,'studio-'||bi.id::text) youtube_video_id,
              coalesce(nullif(bi.rules->>'title',''),yv.title,a.title,'Laufendes Studioprogramm') title,
              coalesce(nullif(bi.rules->>'channelTitle',''),yv.channel_title,s.name,'Open TV Studio') channel_title,
              coalesce(nullif(bi.rules->>'url',''),yv.url,a.canonical_url,a.url,'https://localhost.invalid/studio') url,
              coalesce(yv.description,a.main_text,a.excerpt) description,
              coalesce(yc.name,a.category) category_name,
              coalesce(bi.duration_seconds,yv.duration_seconds,90)::int duration_seconds,
              coalesce(nullif(bi.rules->>'kind',''),'youtube-video') format_kind,
              coalesce(
                case when yv.editorial_analysis_status='ready' then yv.editorial_analysis end,
                bi.rules->'contextAnalysis'
              ) context_analysis,
              coalesce(
                case when yv.editorial_analysis_status='ready' then yv.editorial_analysis_model end,
                nullif(bi.rules->>'analysisModel','')
              ) context_analysis_model,
              coalesce(yv.transcript_segments,'[]'::jsonb) transcript_segments
              ,jsonb_build_object(
                'avaRole',coalesce(bi.rules->'avaRole','{}'::jsonb),
                'miaRole',coalesce(bi.rules->'miaRole','{}'::jsonb),
                'samRole',coalesce(bi.rules->'samRole','{}'::jsonb),
                'hostChoreography',coalesce(bi.rules->'hostChoreography','{}'::jsonb),
                'miaInteractionPrompt',bi.rules->>'miaInteractionPrompt',
                'liveStreamPriority',coalesce((bi.rules->>'liveStreamPriority')::boolean,false),
                'youtubeLiveSource',coalesce((bi.rules->>'youtubeLiveSource')::boolean,false)
              ) format_regie
       from broadcast_items bi
       left join youtube_videos yv on yv.deleted_at is null and (
         yv.id=case when (bi.rules->>'youtubeLibraryId') ~* '^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$' then (bi.rules->>'youtubeLibraryId')::uuid else null end
         or yv.video_id=nullif(bi.rules->>'youtubeVideoId','')
       )
       left join youtube_video_categories yc on yc.id=yv.category_id
       left join articles a on a.id=bi.article_id and a.deleted_at is null
       left join sources s on s.id=a.source_id
       where bi.id=$1 and (yv.id is not null or a.id is not null)
       limit 1`,
        [itemId],
      )
    ).rows[0] ?? null
  );
}

export async function activeAiHostSession() {
  return (
    (
      await query<AiHostSession>(
        `select * from ai_host_sessions where ended_at is null and status in ('preparing','live','paused') order by started_at desc limit 1`,
      )
    ).rows[0] ?? null
  );
}

export async function startAiHostSession(input: {
  broadcastItemId: string;
  youtubeLibraryId?: string | null;
  youtubeVideoId: string;
  videoTitle: string;
  channelTitle: string;
  videoUrl: string;
  formatKind?: string;
}) {
  return transaction(async (client) => {
    await client.query(
      `update ai_host_sessions set status='ended',ended_at=now(),updated_at=now()
       where ended_at is null and broadcast_item_id is distinct from $1`,
      [input.broadcastItemId],
    );
    const existing = (
      await client.query<AiHostSession>(
        `select * from ai_host_sessions where broadcast_item_id=$1 and ended_at is null limit 1`,
        [input.broadcastItemId],
      )
    ).rows[0];
    if (existing) return existing;
    return (
      await client.query<AiHostSession>(
        `insert into ai_host_sessions(broadcast_item_id,youtube_library_id,youtube_video_id,video_title,channel_title,video_url,format_kind,next_phase_at)
         values($1,$2,$3,$4,$5,$6,$7,now()) returning *`,
        [
          input.broadcastItemId,
          input.youtubeLibraryId ?? null,
          input.youtubeVideoId,
          input.videoTitle,
          input.channelTitle,
          input.videoUrl,
          input.formatKind ?? 'youtube-video',
        ],
      )
    ).rows[0];
  });
}

export async function updateAiHostSession(
  id: string,
  input: Partial<{
    briefing: Record<string, unknown>;
    briefingModel: string | null;
    status: AiHostSession['status'];
    phaseIndex: number;
    nextPhaseAt: string | null;
    lastChatResponseAt: string | null;
    chatPageToken: string | null;
    chatPollAfter: string | null;
    chatError: string | null;
    chatLiveChatId: string | null;
    chatSourceKey: string | null;
    chatLastSuccessAt: string | null;
    chatLastMessageAt: string | null;
    chatMessagesReceived: number;
    chatProviderState: Record<string, unknown>;
    directionState: Record<string, unknown>;
    lastDirectionAt: string | null;
    nextDirectionAt: string | null;
    endedAt: string | null;
  }>,
) {
  return (
    (
      await query<AiHostSession>(
        `update ai_host_sessions set
         briefing=coalesce($2,briefing),briefing_model=case when $3 then $4 else briefing_model end,
         status=coalesce($5,status),phase_index=coalesce($6,phase_index),
         next_phase_at=case when $7 then $8::timestamptz else next_phase_at end,
         last_chat_response_at=case when $9 then $10::timestamptz else last_chat_response_at end,
         chat_page_token=case when $11 then $12 else chat_page_token end,
         chat_poll_after=case when $13 then $14::timestamptz else chat_poll_after end,
         chat_error=case when $15 then $16 else chat_error end,
         ended_at=case when $17 then $18::timestamptz else ended_at end,
         chat_live_chat_id=case when $19 then $20 else chat_live_chat_id end,
         chat_source_key=case when $21 then $22 else chat_source_key end,
         chat_last_success_at=case when $23 then $24::timestamptz else chat_last_success_at end,
         chat_last_message_at=case when $25 then $26::timestamptz else chat_last_message_at end,
         chat_messages_received=coalesce($27,chat_messages_received),
         chat_provider_state=coalesce($28,chat_provider_state),
         direction_state=coalesce($29,direction_state),
         last_direction_at=case when $30 then $31::timestamptz else last_direction_at end,
         next_direction_at=case when $32 then $33::timestamptz else next_direction_at end,
         updated_at=now()
       where id=$1 returning *`,
        [
          id,
          input.briefing ?? null,
          Object.prototype.hasOwnProperty.call(input, 'briefingModel'),
          input.briefingModel ?? null,
          input.status ?? null,
          input.phaseIndex ?? null,
          Object.prototype.hasOwnProperty.call(input, 'nextPhaseAt'),
          input.nextPhaseAt ?? null,
          Object.prototype.hasOwnProperty.call(input, 'lastChatResponseAt'),
          input.lastChatResponseAt ?? null,
          Object.prototype.hasOwnProperty.call(input, 'chatPageToken'),
          input.chatPageToken ?? null,
          Object.prototype.hasOwnProperty.call(input, 'chatPollAfter'),
          input.chatPollAfter ?? null,
          Object.prototype.hasOwnProperty.call(input, 'chatError'),
          input.chatError ?? null,
          Object.prototype.hasOwnProperty.call(input, 'endedAt'),
          input.endedAt ?? null,
          Object.prototype.hasOwnProperty.call(input, 'chatLiveChatId'),
          input.chatLiveChatId ?? null,
          Object.prototype.hasOwnProperty.call(input, 'chatSourceKey'),
          input.chatSourceKey ?? null,
          Object.prototype.hasOwnProperty.call(input, 'chatLastSuccessAt'),
          input.chatLastSuccessAt ?? null,
          Object.prototype.hasOwnProperty.call(input, 'chatLastMessageAt'),
          input.chatLastMessageAt ?? null,
          input.chatMessagesReceived ?? null,
          input.chatProviderState ?? null,
          input.directionState ?? null,
          Object.prototype.hasOwnProperty.call(input, 'lastDirectionAt'),
          input.lastDirectionAt ?? null,
          Object.prototype.hasOwnProperty.call(input, 'nextDirectionAt'),
          input.nextDirectionAt ?? null,
        ],
      )
    ).rows[0] ?? null
  );
}

export async function endActiveAiHostSession() {
  await query(`update ai_host_sessions set status='ended',ended_at=now(),updated_at=now() where ended_at is null`);
}

export async function insertAiHostChatMessages(
  sessionId: string,
  messages: Array<{
    provider?: string;
    providerMessageId: string;
    authorName: string;
    authorChannelId?: string | null;
    message: string;
    messageType?: string;
    safe: boolean;
    moderationReason?: string | null;
    publishedAt: string;
  }>,
) {
  let inserted = 0;
  for (const message of messages) {
    const result = await query(
      `insert into ai_host_chat_messages(session_id,provider,provider_message_id,author_name,author_channel_id,message,message_type,safe,moderation_reason,published_at)
       values($1,$2,$3,$4,$5,$6,$7,$8,$9,$10) on conflict(provider,provider_message_id) do nothing`,
      [
        sessionId,
        message.provider ?? 'youtube',
        message.providerMessageId,
        message.authorName,
        message.authorChannelId ?? null,
        message.message,
        message.messageType ?? 'textMessageEvent',
        message.safe,
        message.moderationReason ?? null,
        message.publishedAt,
      ],
    );
    inserted += result.rowCount ?? 0;
  }
  return inserted;
}

export async function unusedAiHostChatMessages(sessionId: string, limit: number) {
  return (
    await query<AiHostChatMessage>(
      `select * from ai_host_chat_messages where session_id=$1 and safe=true and used_at is null
       order by published_at asc limit $2`,
      [sessionId, Math.max(1, Math.min(100, limit))],
    )
  ).rows;
}

/**
 * Reads the reply window of an on-air audience prompt independently from the
 * bounded periodic-discussion queue. A busy chat must not bury a short topic
 * suggestion behind older general conversation.
 */
export async function unusedAiHostChatMessagesSince(sessionId: string, publishedAfter: string, limit = 100) {
  return (
    await query<AiHostChatMessage>(
      `select * from ai_host_chat_messages
       where session_id=$1 and safe=true and used_at is null and published_at >= $2::timestamptz
       order by published_at asc limit $3`,
      [sessionId, publishedAfter, Math.max(1, Math.min(250, limit))],
    )
  ).rows;
}

/**
 * Returns the recent public live-chat stream for the on-air overlay. This is
 * intentionally independent from `used_at`: a message remains visible in the
 * chat even after Sam or Mia has processed it. Unsafe messages never leave the
 * moderated database boundary.
 */
export async function recentAiHostChatMessages(sessionId: string, limit = 40) {
  return (
    await query<AiHostChatMessage>(
      `select * from (
         select * from ai_host_chat_messages
         where session_id=$1 and safe=true and provider in ('youtube','twitch')
         order by published_at desc,received_at desc limit $2
       ) recent order by published_at asc,received_at asc`,
      [sessionId, Math.max(1, Math.min(100, limit))],
    )
  ).rows;
}

export async function aiHostChatQueueMetrics(sessionId: string): Promise<AiHostChatQueueMetrics> {
  return (
    await query<AiHostChatQueueMetrics>(
      `select
         count(*)::int received_total,
         count(*) filter(where safe=true)::int safe_total,
         count(*) filter(where safe=true and used_at is null)::int pending_total,
         count(*) filter(
           where safe=true and used_at is null and (
             position('?' in message)>0
             or lower(message) ~ '^[[:space:]]*!frage([^[:alnum:]_]|$)'
             or lower(message) ~ '(^|[.!][[:space:]]+)(@[[:alnum:]_.-]+[[:space:]]+)?(was|wann|wie|warum|wieso|weshalb|wer|wo|woher|wohin|welche(r|s|n|m)?|kannst[[:space:]]+du|könnt[[:space:]]+ihr)([^[:alnum:]_]|$)'
           )
         )::int pending_questions,
         count(*) filter(where safe=true and used_at is not null)::int processed_total,
         count(*) filter(where safe=false)::int rejected_total,
         max(received_at) last_received_at,
         max(used_at) last_processed_at
       from ai_host_chat_messages where session_id=$1`,
      [sessionId],
    )
  ).rows[0]!;
}

/**
 * Direct viewer questions use their own priority queue. This prevents a busy
 * discussion backlog from hiding a newer question behind the bounded batch
 * consumed by the periodic Sam-to-Mia analysis.
 */
export async function nextUnusedAiHostDirectQuestion(sessionId: string) {
  return (
    (
      await query<AiHostChatMessage>(
        `select * from ai_host_chat_messages
       where session_id=$1 and safe=true and used_at is null
         and (
           position('?' in message)>0
           or lower(message) ~ '^[[:space:]]*!frage([^[:alnum:]_]|$)'
           or lower(message) ~ '(^|[.!][[:space:]]+)(@[[:alnum:]_.-]+[[:space:]]+)?(was|wann|wie|warum|wieso|weshalb|wer|wo|woher|wohin|welche(r|s|n|m)?|kannst[[:space:]]+du|könnt[[:space:]]+ihr)([^[:alnum:]_]|$)'
         )
       order by published_at asc limit 1`,
        [sessionId],
      )
    ).rows[0] ?? null
  );
}

export async function searchAiHostEditorialSources(terms: string[], limit = 5) {
  const safeTerms = terms
    .map((term) =>
      term
        .normalize('NFKC')
        .replace(/[^\p{L}\p{N}-]/gu, '')
        .trim()
        .toLocaleLowerCase('de-DE'),
    )
    .filter((term) => term.length >= 3)
    .slice(0, 10);
  if (!safeTerms.length) return [];
  const rows = (
    await query<AiHostEditorialResearchSource>(
      `with candidates as (
         select a.id,a.title,coalesce(s.name,'Manuelle Redaktion') publisher,
                coalesce(nullif(a.canonical_url,''),a.url) url,
                left(regexp_replace(coalesce(nullif(a.main_text,''),a.excerpt,''),'\\s+',' ','g'),12000) excerpt,
                a.published_at,a.trust_score,a.status,
                lower(concat_ws(' ',a.title,a.excerpt,a.main_text,s.name)) haystack
         from articles a left join sources s on s.id=a.source_id
         where a.deleted_at is null and a.status not in ('blocked','discarded')
       ), ranked as (
         select candidates.*,
                (select count(*) from unnest($1::text[]) term where haystack like '%'||term||'%') matches
         from candidates
       )
       select id,title,publisher,url,excerpt,published_at,trust_score,status
       from ranked where matches>0
       order by matches desc,trust_score desc,coalesce(published_at,now()-interval '100 years') desc
       limit $2`,
      [safeTerms, Math.max(1, Math.min(12, Math.floor(limit)))],
    )
  ).rows;
  return rows.map((row) => {
    const text = row.excerpt.replace(/\s+/g, ' ').trim();
    const lower = text.toLocaleLowerCase('de-DE');
    const maximum = 1400;
    let bestStart = 0;
    let bestScore = -1;
    for (const term of safeTerms) {
      const index = lower.indexOf(term);
      if (index < 0) continue;
      const start = Math.max(0, index - 320);
      const candidate = lower.slice(start, start + maximum);
      const score = safeTerms.reduce(
        (total, candidateTerm, termIndex) => total + (candidate.includes(candidateTerm) ? termIndex + 1 : 0),
        0,
      );
      if (score > bestScore) {
        bestStart = start;
        bestScore = score;
      }
    }
    const excerpt = text.slice(bestStart, bestStart + maximum).trim();
    return {
      ...row,
      excerpt: `${bestStart > 0 ? '… ' : ''}${excerpt}${bestStart + maximum < text.length ? ' …' : ''}`,
    };
  });
}

export async function markAiHostChatMessagesUsed(ids: string[]) {
  if (!ids.length) return;
  await query(`update ai_host_chat_messages set used_at=now() where id=any($1::uuid[])`, [ids]);
}

export async function aiHostTurnsLastHour(sessionId: string) {
  return Number(
    (
      await query<{ count: string }>(
        `select count(*) from ai_staff_turns where session_id=$1 and created_at>=now()-interval '1 hour'`,
        [sessionId],
      )
    ).rows[0]?.count ?? 0,
  );
}

export async function aiHostTurnMetricsLastHour(sessionId: string) {
  const row = (
    await query<{ total: string; chat_responses: string; scheduled: string }>(
      `select count(*)::text total,
         count(*) filter(where kind in ('chat-response','chat-commentary'))::text chat_responses,
         count(*) filter(where kind in ('intro','question','context'))::text scheduled
       from ai_staff_turns where session_id=$1 and created_at>=now()-interval '1 hour'`,
      [sessionId],
    )
  ).rows[0];
  return {
    total: Number(row?.total ?? 0),
    chatResponses: Number(row?.chat_responses ?? 0),
    scheduled: Number(row?.scheduled ?? 0),
  };
}

export async function createAiStaffTurn(input: {
  sessionId: string;
  staffMemberId: string;
  kind: AiStaffTurn['kind'];
  headline: string;
  text: string;
  cta?: string | null;
  chatTheme?: string | null;
  chatExcerpt?: string | null;
  chatFingerprint?: string | null;
  sourceMessageIds?: string[];
  status?: AiStaffTurn['status'];
  model?: string | null;
  audioPath?: string | null;
  durationSeconds: number;
  displayMode?: AiStaffTurn['display_mode'];
  presentation?: Record<string, unknown>;
}) {
  return (
    await query<AiStaffTurn>(
      `insert into ai_staff_turns(session_id,staff_member_id,kind,headline,text,cta,chat_theme,chat_excerpt,chat_fingerprint,source_message_ids,status,model,audio_path,starts_at,ends_at,display_mode,presentation)
       values($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,now(),now()+($14||' seconds')::interval,$15,$16) returning *`,
      [
        input.sessionId,
        input.staffMemberId,
        input.kind,
        input.headline,
        input.text,
        input.cta ?? null,
        input.chatTheme ?? null,
        input.chatExcerpt ?? null,
        input.chatFingerprint ?? null,
        input.sourceMessageIds ?? [],
        input.status ?? 'approved',
        input.model ?? null,
        input.audioPath ?? null,
        Math.max(5, Math.min(180, input.durationSeconds)),
        input.displayMode ?? 'takeover',
        input.presentation ?? {},
      ],
    )
  ).rows[0];
}

export async function currentAiStaffTurn(sessionId: string) {
  return (
    (
      await query<
        AiStaffTurn & { display_name: string; job_title: string; avatar_style: string; accent_color: string }
      >(
        `select t.*,m.display_name,m.job_title,m.avatar_style,m.accent_color
       from ai_staff_turns t join ai_staff_members m on m.id=t.staff_member_id
       where t.session_id=$1 and t.status in ('approved','live') and t.starts_at<=now() and t.ends_at>now()
       order by t.starts_at desc limit 1`,
        [sessionId],
      )
    ).rows[0] ?? null
  );
}

export async function latestAiStaffTurns(sessionId: string, limit = 20) {
  return (
    await query<AiStaffTurn & { display_name: string; job_title: string }>(
      `select t.*,m.display_name,m.job_title from ai_staff_turns t join ai_staff_members m on m.id=t.staff_member_id
       where t.session_id=$1 order by t.created_at desc limit $2`,
      [sessionId, Math.max(1, Math.min(100, limit))],
    )
  ).rows;
}

export type AiLiveDirectionEvent = {
  id: string;
  session_id: string;
  broadcast_item_id: string | null;
  turn_id: string | null;
  trigger: string;
  action: string;
  presenter_id: string | null;
  display_mode: string | null;
  priority: number;
  reason: string;
  signals: Record<string, unknown>;
  created_at: string;
};

export async function recordAiLiveDirectionEvent(input: {
  sessionId: string;
  broadcastItemId?: string | null;
  turnId?: string | null;
  trigger: string;
  action: string;
  presenterId?: string | null;
  displayMode?: string | null;
  priority: number;
  reason: string;
  signals?: Record<string, unknown>;
}) {
  return (
    await query<AiLiveDirectionEvent>(
      `insert into ai_live_direction_events(
         session_id,broadcast_item_id,turn_id,trigger,action,presenter_id,
         display_mode,priority,reason,signals
       ) values($1,$2,$3,$4,$5,$6,$7,$8,$9,$10)
       returning *`,
      [
        input.sessionId,
        input.broadcastItemId ?? null,
        input.turnId ?? null,
        input.trigger,
        input.action,
        input.presenterId ?? null,
        input.displayMode ?? null,
        Math.max(0, Math.min(100, Math.round(input.priority))),
        input.reason,
        input.signals ?? {},
      ],
    )
  ).rows[0];
}

export async function latestAiLiveDirectionEvents(sessionId: string, limit = 20) {
  return (
    await query<AiLiveDirectionEvent>(
      `select * from ai_live_direction_events
       where session_id=$1 order by created_at desc limit $2`,
      [sessionId, Math.max(1, Math.min(100, limit))],
    )
  ).rows;
}

export type AiChatCommentaryHistory = Pick<
  AiStaffTurn,
  'chat_fingerprint' | 'chat_theme' | 'chat_excerpt' | 'text' | 'created_at'
>;

export async function recentAiChatCommentaries(sessionId: string, lookbackMinutes = 30) {
  return (
    await query<AiChatCommentaryHistory>(
      `select chat_fingerprint,chat_theme,chat_excerpt,text,created_at
       from ai_staff_turns
       where session_id=$1 and kind='chat-commentary'
         and created_at>=now()-($2::double precision*interval '1 minute')
       order by created_at desc limit 40`,
      [sessionId, Math.max(1, Math.min(24 * 60, lookbackMinutes))],
    )
  ).rows;
}

/**
 * Returns the next approved turn whose voice rendering was interrupted or has
 * not started yet. Keeping this state in PostgreSQL lets the API resume TTS
 * after a process restart instead of silently losing an on-air answer.
 */
export async function nextAiStaffVoiceTurn(sessionId: string, maximumAttempts = 4) {
  return (
    (
      await query<AiStaffTurn>(
        `select * from ai_staff_turns
         where session_id=$1
           and status in ('approved','live')
           and audio_path is null
           and voice_attempts < $2
         order by case when kind in ('chat-response','chat-commentary') then 0 else 1 end,created_at asc
         limit 1`,
        [sessionId, Math.max(1, Math.min(10, maximumAttempts))],
      )
    ).rows[0] ?? null
  );
}

export async function upcomingAiStaffVoiceTurn(sessionId: string) {
  return (
    (
      await query<AiStaffTurn>(
        `select * from ai_staff_turns
         where session_id=$1
           and status in ('approved','live')
           and audio_path is not null
           and starts_at>now()
           and starts_at<=now()+interval '10 minutes'
         order by starts_at asc limit 1`,
        [sessionId],
      )
    ).rows[0] ?? null
  );
}

export async function markAiStaffVoiceAttempt(id: string) {
  return (
    (
      await query<AiStaffTurn>(
        `update ai_staff_turns
         set voice_attempts=voice_attempts+1,voice_error=null,voice_retry_at=null
         where id=$1 and audio_path is null and status in ('approved','live')
         returning *`,
        [id],
      )
    ).rows[0] ?? null
  );
}

export async function markAiStaffVoiceFailure(
  id: string,
  error: string,
  retryDelaySeconds: number,
  maximumAttempts = 4,
) {
  return (
    (
      await query<AiStaffTurn>(
        `update ai_staff_turns
         set voice_error=$2,
             voice_retry_at=case when voice_attempts<$4 then now()+($3::double precision*interval '1 second') else null end,
             status=case when voice_attempts>=$4 then 'expired' else status end
         where id=$1 and audio_path is null returning *`,
        [
          id,
          error.slice(0, 1500),
          Math.max(5, Math.min(300, retryDelaySeconds)),
          Math.max(1, Math.min(10, maximumAttempts)),
        ],
      )
    ).rows[0] ?? null
  );
}

export async function updateAiStaffTurnStatus(id: string, status: AiStaffTurn['status']) {
  return (
    (
      await query<AiStaffTurn>(
        `update ai_staff_turns set status=$2,
         starts_at=case when $2='approved' then now() else starts_at end,
         ends_at=case when $2='approved' then now()+greatest(interval '5 seconds',ends_at-starts_at) else ends_at end
       where id=$1 returning *`,
        [id, status],
      )
    ).rows[0] ?? null
  );
}

export async function setAiStaffTurnAudio(id: string, audioPath: string, synchronizedDurationSeconds?: number | null) {
  const synchronizedDuration = Number.isFinite(synchronizedDurationSeconds)
    ? Math.max(1, Math.min(180, Number(synchronizedDurationSeconds)))
    : null;
  return transaction(async (client) => {
    const target = (await client.query<AiStaffTurn>('select * from ai_staff_turns where id=$1 for update', [id]))
      .rows[0];
    if (!target) return null;
    await client.query('select pg_advisory_xact_lock(hashtext($1))', [target.session_id]);
    return (
      (
        await client.query<AiStaffTurn>(
          `with boundary as (
             select greatest(
               now(),
               coalesce(max(ends_at)+interval '700 milliseconds',now())
             ) starts_at
             from ai_staff_turns
             where session_id=$4 and id<>$1
               and status in ('approved','live')
               and audio_path is not null and ends_at>now()
           )
           update ai_staff_turns turn
           set audio_path=$2,
               starts_at=boundary.starts_at,
               ends_at=boundary.starts_at+
                 case when $3::double precision is null
                   then greatest(interval '5 seconds',turn.ends_at-turn.starts_at)
                   else $3::double precision*interval '1 second'
                 end,
               voice_error=null,
               voice_retry_at=null,
               voice_ready_at=now()
           from boundary where turn.id=$1 returning turn.*`,
          [id, audioPath, synchronizedDuration, target.session_id],
        )
      ).rows[0] ?? null
    );
  });
}

/**
 * Rebases a turn when the overlay has decoded and revealed the presenter.
 * Voice rendering, browser preloading and OBS compositing must not consume the
 * actual on-air window before the first audio sample is played.
 */
export async function markAiStaffTurnPlaybackStarted(id: string) {
  return transaction(async (client) => {
    const target = (await client.query<AiStaffTurn>('select * from ai_staff_turns where id=$1 for update', [id]))
      .rows[0];
    if (!target || !target.audio_path || !['approved', 'live'].includes(target.status)) return null;
    if (target.status === 'live') return target;
    return (
      (
        await client.query<AiStaffTurn>(
          `update ai_staff_turns
           set status='live',
               starts_at=now(),
               ends_at=now()+greatest(interval '5 seconds',ends_at-starts_at)
           where id=$1 and status='approved' returning *`,
          [id],
        )
      ).rows[0] ?? null
    );
  });
}

/** Marks a turn complete as soon as the browser reports ended/error. */
export async function completeAiStaffTurnPlayback(id: string) {
  return (
    (
      await query<AiStaffTurn>(
        `update ai_staff_turns
         set status='expired',ends_at=now()
         where id=$1 and status in ('approved','live') returning *`,
        [id],
      )
    ).rows[0] ?? null
  );
}

export async function getAiStaffTurn(id: string) {
  return (await query<AiStaffTurn>('select * from ai_staff_turns where id=$1', [id])).rows[0] ?? null;
}

export async function listAiStaffTasks(staffMemberId: string, limit = 50) {
  return (
    await query<AiStaffTask>(
      `select t.*,u.display_name requested_by_name
       from ai_staff_tasks t left join users u on u.id=t.requested_by
       where t.staff_member_id=$1
       order by
         case t.status when 'running' then 0 when 'waiting_review' then 1 when 'queued' then 2 else 3 end,
         case t.priority when 'urgent' then 0 when 'high' then 1 when 'normal' then 2 else 3 end,
         t.updated_at desc
       limit $2`,
      [staffMemberId, Math.max(1, Math.min(200, limit))],
    )
  ).rows;
}

export async function getAiStaffTask(id: string) {
  return (
    (
      await query<AiStaffTask>(
        `select t.*,u.display_name requested_by_name
       from ai_staff_tasks t left join users u on u.id=t.requested_by where t.id=$1`,
        [id],
      )
    ).rows[0] ?? null
  );
}

export async function aiStaffTaskMetrics(staffMemberId: string) {
  return (
    await query<{
      total: number;
      open: number;
      completed: number;
      failed: number;
      turns: number;
      average_completion_seconds: number | null;
      last_activity_at: string | null;
    }>(
      `select
         count(t.*)::int total,
         count(t.*) filter(where t.status in ('queued','running','waiting_review'))::int open,
         count(t.*) filter(where t.status='completed')::int completed,
         count(t.*) filter(where t.status='failed')::int failed,
         (select count(*)::int from ai_staff_turns where staff_member_id=$1) turns,
         round(avg(extract(epoch from (t.completed_at-t.started_at))) filter(where t.completed_at is not null and t.started_at is not null))::int average_completion_seconds,
         greatest(max(t.updated_at),
           (select max(created_at) from ai_staff_turns where staff_member_id=$1),
           (select max(created_at) from ai_staff_activity where staff_member_id=$1)) last_activity_at
       from ai_staff_tasks t where t.staff_member_id=$1`,
      [staffMemberId],
    )
  ).rows[0];
}

export async function listAiStaffActivity(staffMemberId: string, limit = 80) {
  return (
    await query<AiStaffActivity>(
      `select * from (
         select a.id,a.staff_member_id,a.task_id,a.event_type,a.title,a.detail,a.status,
                coalesce(a.metadata,'{}'::jsonb) || case when task.id is null then '{}'::jsonb else
                  jsonb_strip_nulls(jsonb_build_object(
                    'requestTitle',task.title,
                    'request',task.instructions,
                    'requestKind',task.kind,
                    'priority',task.priority,
                    'dueAt',task.due_at
                  ))
                end metadata,
                a.actor_user_id,u.display_name actor_name,a.created_at
         from ai_staff_activity a
         left join users u on u.id=a.actor_user_id
         left join ai_staff_tasks task on task.id=a.task_id
         where a.staff_member_id=$1
         union all
         select t.id,t.staff_member_id,null::uuid task_id,'live_turn' event_type,t.headline title,t.text detail,
                t.status,jsonb_build_object('kind',t.kind,'sessionId',t.session_id,'model',t.model) metadata,
                null::uuid actor_user_id,null::text actor_name,t.created_at
         from ai_staff_turns t where t.staff_member_id=$1
       ) events order by created_at desc limit $2`,
      [staffMemberId, Math.max(1, Math.min(300, limit))],
    )
  ).rows;
}

export async function recordAiStaffActivity(input: {
  staffMemberId: string;
  taskId?: string | null;
  eventType: string;
  title: string;
  detail?: string | null;
  status?: string | null;
  metadata?: Record<string, unknown>;
  actorUserId?: string | null;
}) {
  return (
    await query<AiStaffActivity>(
      `insert into ai_staff_activity(staff_member_id,task_id,event_type,title,detail,status,metadata,actor_user_id)
       values($1,$2,$3,$4,$5,$6,$7,$8) returning *`,
      [
        input.staffMemberId,
        input.taskId ?? null,
        input.eventType,
        input.title,
        input.detail ?? null,
        input.status ?? null,
        input.metadata ?? {},
        input.actorUserId ?? null,
      ],
    )
  ).rows[0];
}

export async function createAiStaffTask(input: {
  staffMemberId: string;
  parentTaskId?: string | null;
  kind: AiStaffTaskKind;
  title: string;
  instructions: string;
  priority: AiStaffTaskPriority;
  requestedBy?: string | null;
  dueAt?: string | null;
}) {
  return transaction(async (client) => {
    const task = (
      await client.query<AiStaffTask>(
        `insert into ai_staff_tasks(staff_member_id,parent_task_id,kind,title,instructions,priority,requested_by,due_at)
         select $1,$2::uuid,$3,$4,$5,$6,$7::uuid,$8::timestamptz
         where $2::uuid is null or exists(
           select 1 from ai_staff_tasks parent where parent.id=$2::uuid and parent.staff_member_id=$1
         )
         returning *`,
        [
          input.staffMemberId,
          input.parentTaskId ?? null,
          input.kind,
          input.title,
          input.instructions,
          input.priority,
          input.requestedBy ?? null,
          input.dueAt ?? null,
        ],
      )
    ).rows[0];
    if (!task) return null;
    await client.query(
      `insert into ai_staff_activity(staff_member_id,task_id,event_type,title,detail,status,metadata,actor_user_id)
       values($1,$2,'task_created','Neue Aufgabe erhalten',$3,'queued',$4,$5)`,
      [
        task.staff_member_id,
        task.id,
        task.instructions,
        {
          requestTitle: task.title,
          request: task.instructions,
          requestKind: task.kind,
          priority: task.priority,
          dueAt: task.due_at,
        },
        input.requestedBy ?? null,
      ],
    );
    return task;
  });
}

export async function claimNextAiStaffTask() {
  return transaction(async (client) => {
    await client.query(
      `update ai_staff_tasks set status='queued',locked_at=null,started_at=null,updated_at=now(),
         error='Automatisch nach einem unterbrochenen Lauf erneut eingeplant.'
       where status='running' and locked_at<now()-interval '15 minutes'`,
    );
    const candidate = (
      await client.query<AiStaffTask>(
        `select t.* from ai_staff_tasks t join ai_staff_members m on m.id=t.staff_member_id
         where t.status='queued' and m.enabled=true
         order by case t.priority when 'urgent' then 0 when 'high' then 1 when 'normal' then 2 else 3 end,
                  t.created_at
         for update of t skip locked limit 1`,
      )
    ).rows[0];
    if (!candidate) return null;
    const task = (
      await client.query<AiStaffTask>(
        `update ai_staff_tasks set status='running',locked_at=now(),started_at=coalesce(started_at,now()),
           attempts=attempts+1,error=null,updated_at=now() where id=$1 returning *`,
        [candidate.id],
      )
    ).rows[0];
    await client.query(
      `insert into ai_staff_activity(staff_member_id,task_id,event_type,title,detail,status)
       values($1,$2,'task_started','Aufgabe wird bearbeitet',$3,'running')`,
      [task.staff_member_id, task.id, task.title],
    );
    return task;
  });
}

export async function completeAiStaffTask(
  id: string,
  input: {
    summary: string;
    response: string;
    result: Record<string, unknown>;
    model: string;
    waitingReview: boolean;
  },
) {
  return transaction(async (client) => {
    const status: AiStaffTaskStatus = input.waitingReview ? 'waiting_review' : 'completed';
    const task = (
      await client.query<AiStaffTask>(
        `update ai_staff_tasks set status=$2,result_summary=$3,result_text=$4,result=$5,model=$6,
           completed_at=case when $2='completed' then now() else null end,locked_at=null,updated_at=now()
         where id=$1 and status='running' returning *`,
        [id, status, input.summary, input.response, input.result, input.model],
      )
    ).rows[0];
    if (!task) return null;
    await client.query(
      `insert into ai_staff_activity(staff_member_id,task_id,event_type,title,detail,status,metadata)
       values($1,$2,$3,$4,$5,$6,$7)`,
      [
        task.staff_member_id,
        task.id,
        status === 'completed' ? 'task_completed' : 'task_review_requested',
        status === 'completed' ? 'Aufgabe abgeschlossen' : 'Ergebnis wartet auf Freigabe',
        input.summary,
        status,
        { model: input.model },
      ],
    );
    return task;
  });
}

export async function failAiStaffTask(id: string, error: string) {
  return transaction(async (client) => {
    const task = (
      await client.query<AiStaffTask>(
        `update ai_staff_tasks set status='failed',error=$2,locked_at=null,updated_at=now()
         where id=$1 and status='running' returning *`,
        [id, error.slice(0, 1500)],
      )
    ).rows[0];
    if (!task) return null;
    await client.query(
      `insert into ai_staff_activity(staff_member_id,task_id,event_type,title,detail,status)
       values($1,$2,'task_failed','Aufgabe fehlgeschlagen',$3,'failed')`,
      [task.staff_member_id, task.id, error.slice(0, 1500)],
    );
    return task;
  });
}

export async function transitionAiStaffTask(
  id: string,
  action: 'cancel' | 'retry' | 'approve',
  actorUserId?: string | null,
) {
  return transaction(async (client) => {
    const current = (await client.query<AiStaffTask>('select * from ai_staff_tasks where id=$1 for update', [id]))
      .rows[0];
    if (!current) return null;
    const allowed =
      (action === 'cancel' && ['queued', 'running', 'waiting_review'].includes(current.status)) ||
      (action === 'retry' && ['failed', 'cancelled'].includes(current.status)) ||
      (action === 'approve' && current.status === 'waiting_review');
    if (!allowed) return { task: current, transitioned: false };
    const nextStatus: AiStaffTaskStatus =
      action === 'cancel' ? 'cancelled' : action === 'retry' ? 'queued' : 'completed';
    const task = (
      await client.query<AiStaffTask>(
        `update ai_staff_tasks set status=$2,
           cancelled_at=case when $2='cancelled' then now() else null end,
           completed_at=case when $2='completed' then now() else null end,
           locked_at=null,error=case when $2='queued' then null else error end,
           started_at=case when $2='queued' then null else started_at end,updated_at=now()
         where id=$1 returning *`,
        [id, nextStatus],
      )
    ).rows[0];
    const labels = {
      cancel: ['task_cancelled', 'Aufgabe abgebrochen'],
      retry: ['task_retried', 'Aufgabe erneut eingeplant'],
      approve: ['task_approved', 'Ergebnis freigegeben'],
    } as const;
    await client.query(
      `insert into ai_staff_activity(staff_member_id,task_id,event_type,title,detail,status,actor_user_id)
       values($1,$2,$3,$4,$5,$6,$7)`,
      [
        task.staff_member_id,
        task.id,
        labels[action][0],
        labels[action][1],
        task.title,
        nextStatus,
        actorUserId ?? null,
      ],
    );
    return { task, transitioned: true };
  });
}

export async function aiTeamActivity(limit = 60) {
  return (
    await query<AiStaffActivity & { display_name: string; job_title: string }>(
      `select events.*,m.display_name,m.job_title
       from (
         select a.id,a.staff_member_id,a.task_id,a.event_type,a.title,a.detail,a.status,
                coalesce(a.metadata,'{}'::jsonb) || case when task.id is null then '{}'::jsonb else
                  jsonb_strip_nulls(jsonb_build_object(
                    'requestTitle',task.title,
                    'request',task.instructions,
                    'requestKind',task.kind,
                    'priority',task.priority,
                    'dueAt',task.due_at
                  ))
                end metadata,
                a.actor_user_id,u.display_name actor_name,a.created_at
         from ai_staff_activity a
         left join users u on u.id=a.actor_user_id
         left join ai_staff_tasks task on task.id=a.task_id
         union all
         select t.id,t.staff_member_id,null::uuid task_id,'live_turn' event_type,t.headline title,t.text detail,
                t.status,jsonb_build_object('kind',t.kind,'sessionId',t.session_id,'model',t.model) metadata,
                null::uuid actor_user_id,null::text actor_name,t.created_at
         from ai_staff_turns t
       ) events join ai_staff_members m on m.id=events.staff_member_id
       order by events.created_at desc limit $1`,
      [Math.max(1, Math.min(200, limit))],
    )
  ).rows;
}
