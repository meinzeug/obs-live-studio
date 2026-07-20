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

export type AiHostSettings = {
  id: boolean;
  enabled: boolean;
  live_stream_url: string | null;
  live_chat_id: string | null;
  chat_source_mode: 'channel' | 'content';
  active_moderator_id: string;
  overlay_position: 'top-left' | 'top-right' | 'bottom-left' | 'bottom-right';
  overlay_scale: number;
  show_avatar: boolean;
  show_chat: boolean;
  anonymize_authors: boolean;
  voice_enabled: boolean;
  interaction_mode: AiHostInteractionMode;
  question_interval_seconds: number;
  response_cooldown_seconds: number;
  response_duration_seconds: number;
  max_turns_per_hour: number;
  max_chat_messages_per_turn: number;
  minimum_chat_messages: number;
  participation_prompt: string;
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
  briefing: Record<string, unknown> | null;
  briefing_model: string | null;
  status: 'preparing' | 'live' | 'paused' | 'ended' | 'error';
  phase_index: number;
  next_phase_at: string | null;
  last_chat_response_at: string | null;
  chat_page_token: string | null;
  chat_poll_after: string | null;
  chat_error: string | null;
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

export type AiStaffTurn = {
  id: string;
  session_id: string;
  staff_member_id: string;
  kind: 'intro' | 'context' | 'question' | 'chat-response' | 'cta' | 'fallback';
  headline: string;
  text: string;
  cta: string | null;
  chat_theme: string | null;
  chat_excerpt: string | null;
  source_message_ids: string[];
  status: 'pending' | 'approved' | 'live' | 'expired' | 'rejected';
  model: string | null;
  audio_path: string | null;
  starts_at: string;
  ends_at: string;
  created_at: string;
};

export async function listAiStaffMembers() {
  return (await query<AiStaffMember>('select * from ai_staff_members order by case role when \'producer\' then 1 when \'editor\' then 2 when \'fact-checker\' then 3 when \'chat-analyst\' then 4 else 5 end')).rows;
}

export async function getAiStaffMember(id: string) {
  return (await query<AiStaffMember>('select * from ai_staff_members where id=$1', [id])).rows[0] ?? null;
}

export async function updateAiStaffMember(
  id: string,
  input: Partial<Pick<AiStaffMember, 'display_name' | 'enabled' | 'autonomy' | 'avatar_style' | 'accent_color' | 'instructions' | 'config'>>,
) {
  return (
    await query<AiStaffMember>(
      `update ai_staff_members set
         display_name=coalesce($2,display_name),
         enabled=coalesce($3,enabled),
         autonomy=coalesce($4,autonomy),
         avatar_style=coalesce($5,avatar_style),
         accent_color=coalesce($6,accent_color),
         instructions=coalesce($7,instructions),
         config=coalesce($8,config),
         updated_at=now()
       where id=$1 returning *`,
      [
        id,
        input.display_name ?? null,
        input.enabled ?? null,
        input.autonomy ?? null,
        input.avatar_style ?? null,
        input.accent_color ?? null,
        input.instructions ?? null,
        input.config ?? null,
      ],
    )
  ).rows[0] ?? null;
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
    activeModeratorId: string;
    overlayPosition: AiHostSettings['overlay_position'];
    overlayScale: number;
    showAvatar: boolean;
    showChat: boolean;
    anonymizeAuthors: boolean;
    voiceEnabled: boolean;
    interactionMode: AiHostInteractionMode;
    questionIntervalSeconds: number;
    responseCooldownSeconds: number;
    responseDurationSeconds: number;
    maxTurnsPerHour: number;
    maxChatMessagesPerTurn: number;
    minimumChatMessages: number;
    participationPrompt: string;
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
         chat_source_mode=coalesce($21,chat_source_mode),updated_at=now()
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
      ],
    )
  ).rows[0];
}

export async function youtubeItemForAiHost(itemId: string) {
  return (
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
    }>(
      `select bi.id item_id,yv.id youtube_library_id,
              coalesce(nullif(bi.rules->>'youtubeVideoId',''),yv.video_id) youtube_video_id,
              coalesce(nullif(bi.rules->>'title',''),yv.title,'YouTube-Video') title,
              coalesce(nullif(bi.rules->>'channelTitle',''),yv.channel_title,'YouTube') channel_title,
              coalesce(nullif(bi.rules->>'url',''),yv.url,'https://www.youtube.com') url,
              yv.description,yc.name category_name,coalesce(bi.duration_seconds,yv.duration_seconds,900)::int duration_seconds
       from broadcast_items bi
       left join youtube_videos yv on yv.deleted_at is null and (
         yv.id=case when (bi.rules->>'youtubeLibraryId') ~* '^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$' then (bi.rules->>'youtubeLibraryId')::uuid else null end
         or yv.video_id=nullif(bi.rules->>'youtubeVideoId','')
       )
       left join youtube_video_categories yc on yc.id=yv.category_id
       where bi.id=$1 and bi.rules->>'kind' in ('youtube-video','youtube-news-sidebar')
       limit 1`,
      [itemId],
    )
  ).rows[0] ?? null;
}

export async function activeAiHostSession() {
  return (
    await query<AiHostSession>(
      `select * from ai_host_sessions where ended_at is null and status in ('preparing','live','paused') order by started_at desc limit 1`,
    )
  ).rows[0] ?? null;
}

export async function startAiHostSession(input: {
  broadcastItemId: string;
  youtubeLibraryId?: string | null;
  youtubeVideoId: string;
  videoTitle: string;
  channelTitle: string;
  videoUrl: string;
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
        `insert into ai_host_sessions(broadcast_item_id,youtube_library_id,youtube_video_id,video_title,channel_title,video_url,next_phase_at)
         values($1,$2,$3,$4,$5,$6,now()) returning *`,
        [
          input.broadcastItemId,
          input.youtubeLibraryId ?? null,
          input.youtubeVideoId,
          input.videoTitle,
          input.channelTitle,
          input.videoUrl,
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
    endedAt: string | null;
  }>,
) {
  return (
    await query<AiHostSession>(
      `update ai_host_sessions set
         briefing=coalesce($2,briefing),briefing_model=case when $3 then $4 else briefing_model end,
         status=coalesce($5,status),phase_index=coalesce($6,phase_index),
         next_phase_at=case when $7 then $8::timestamptz else next_phase_at end,
         last_chat_response_at=case when $9 then $10::timestamptz else last_chat_response_at end,
         chat_page_token=case when $11 then $12 else chat_page_token end,
         chat_poll_after=case when $13 then $14::timestamptz else chat_poll_after end,
         chat_error=case when $15 then $16 else chat_error end,
         ended_at=case when $17 then $18::timestamptz else ended_at end,updated_at=now()
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
      ],
    )
  ).rows[0] ?? null;
}

export async function endActiveAiHostSession() {
  await query(`update ai_host_sessions set status='ended',ended_at=now(),updated_at=now() where ended_at is null`);
}

export async function insertAiHostChatMessages(
  sessionId: string,
  messages: Array<{
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
      `insert into ai_host_chat_messages(session_id,provider_message_id,author_name,author_channel_id,message,message_type,safe,moderation_reason,published_at)
       values($1,$2,$3,$4,$5,$6,$7,$8,$9) on conflict(provider,provider_message_id) do nothing`,
      [
        sessionId,
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

export async function markAiHostChatMessagesUsed(ids: string[]) {
  if (!ids.length) return;
  await query(`update ai_host_chat_messages set used_at=now() where id=any($1::uuid[])`, [ids]);
}

export async function aiHostTurnsLastHour(sessionId: string) {
  return Number(
    (await query<{ count: string }>(`select count(*) from ai_staff_turns where session_id=$1 and created_at>=now()-interval '1 hour'`, [sessionId])).rows[0]?.count ?? 0,
  );
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
  sourceMessageIds?: string[];
  status?: AiStaffTurn['status'];
  model?: string | null;
  audioPath?: string | null;
  durationSeconds: number;
}) {
  return (
    await query<AiStaffTurn>(
      `insert into ai_staff_turns(session_id,staff_member_id,kind,headline,text,cta,chat_theme,chat_excerpt,source_message_ids,status,model,audio_path,starts_at,ends_at)
       values($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,now(),now()+($13||' seconds')::interval) returning *`,
      [
        input.sessionId,
        input.staffMemberId,
        input.kind,
        input.headline,
        input.text,
        input.cta ?? null,
        input.chatTheme ?? null,
        input.chatExcerpt ?? null,
        input.sourceMessageIds ?? [],
        input.status ?? 'approved',
        input.model ?? null,
        input.audioPath ?? null,
        Math.max(5, Math.min(180, input.durationSeconds)),
      ],
    )
  ).rows[0];
}

export async function currentAiStaffTurn(sessionId: string) {
  return (
    await query<AiStaffTurn & { display_name: string; job_title: string; avatar_style: string; accent_color: string }>(
      `select t.*,m.display_name,m.job_title,m.avatar_style,m.accent_color
       from ai_staff_turns t join ai_staff_members m on m.id=t.staff_member_id
       where t.session_id=$1 and t.status in ('approved','live') and t.starts_at<=now() and t.ends_at>now()
       order by t.starts_at desc limit 1`,
      [sessionId],
    )
  ).rows[0] ?? null;
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

export async function updateAiStaffTurnStatus(id: string, status: AiStaffTurn['status']) {
  return (
    await query<AiStaffTurn>(
      `update ai_staff_turns set status=$2,
         starts_at=case when $2='approved' then now() else starts_at end,
         ends_at=case when $2='approved' then now()+greatest(interval '5 seconds',ends_at-starts_at) else ends_at end
       where id=$1 returning *`,
      [id, status],
    )
  ).rows[0] ?? null;
}

export async function setAiStaffTurnAudio(id: string, audioPath: string) {
  return (await query<AiStaffTurn>('update ai_staff_turns set audio_path=$2 where id=$1 returning *', [id, audioPath])).rows[0] ?? null;
}

export async function getAiStaffTurn(id: string) {
  return (await query<AiStaffTurn>('select * from ai_staff_turns where id=$1', [id])).rows[0] ?? null;
}

export async function aiTeamActivity(limit = 60) {
  return (
    await query(
      `select t.*,m.display_name,m.job_title,s.video_title,s.channel_title
       from ai_staff_turns t join ai_staff_members m on m.id=t.staff_member_id join ai_host_sessions s on s.id=t.session_id
       order by t.created_at desc limit $1`,
      [Math.max(1, Math.min(200, limit))],
    )
  ).rows;
}
