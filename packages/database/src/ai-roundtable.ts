import { query, transaction } from './index.js';

export type AiRoundtableStatus = 'standby' | 'preparing' | 'live' | 'paused' | 'ended' | 'error';
export type AiRoundtablePreset = 'studio-rundtisch' | 'fakten-duell' | 'publikumsforum';

export type AiRoundtableSettings = {
  id: boolean;
  enabled: boolean;
  status: AiRoundtableStatus;
  preset: AiRoundtablePreset;
  topic: string;
  moderator_id: string;
  participant_ids: string[];
  current_speaker_id: string | null;
  current_turn_index: number;
  turn_duration_seconds: number;
  max_rounds: number;
  chat_enabled: boolean;
  fact_check_enabled: boolean;
  audience_prompt: string;
  production_settings: AiRoundtableProductionSettings;
  show_session_key: string | null;
  active_item_id: string | null;
  introduction_complete: boolean;
  video_context: AiRoundtableVideoContext;
  started_at: string | null;
  updated_at: string;
};

export type AiRoundtableProductionSettings = {
  introductionsEnabled?: boolean;
  showAllParticipants?: boolean;
  autoDiscussVideos?: boolean;
  videoLayout?: 'video-left' | 'panel-grid';
  fallbackMode?: 'codex-retry';
  minimumParticipants?: number;
  humorLevel?: 'off' | 'subtle' | 'lively';
  banterEnabled?: boolean;
  duckYoutubeAudio?: boolean;
  youtubeDuckVolume?: number;
  translationYoutubeVolume?: number;
  translatorPictureInPicture?: boolean;
};

export type AiRoundtableVideoContext = {
  itemId?: string;
  youtubeLibraryId?: string;
  runKey?: string;
  title?: string;
  channel?: string;
  url?: string;
  sourceLanguage?: string;
  translationRequired?: boolean;
  cards?: Array<{ headline?: string; text?: string; sourceLabel?: string }>;
  news?: Array<{ title?: string; text?: string; source?: string }>;
};

export type AiRoundtableTurn = {
  id: string;
  speaker_id: string;
  display_name?: string;
  job_title?: string;
  accent_color?: string;
  turn_index: number;
  round_number: number;
  kind: 'opening' | 'position' | 'response' | 'fact-check' | 'audience' | 'translation' | 'closing';
  headline: string;
  text: string;
  audience_prompt: string | null;
  source_labels: string[];
  model: string | null;
  tier: 'free' | 'paid' | 'codex' | 'local' | null;
  audio_path: string | null;
  preproduced_cue_id: string | null;
  preproduced_run_key: string | null;
  video_pause_ms: number | string | null;
  source_start_ms: number | string | null;
  source_end_ms: number | string | null;
  audience_message_id: string | null;
  status: 'preparing' | 'ready' | 'live' | 'completed' | 'failed';
  starts_at: string;
  ends_at: string;
  created_at: string;
};

export async function getAiRoundtableSettings() {
  return (await query<AiRoundtableSettings>('select * from ai_roundtable_settings where id=true')).rows[0];
}

export async function updateAiRoundtableSettings(
  input: Partial<{
    enabled: boolean;
    status: AiRoundtableStatus;
    preset: AiRoundtablePreset;
    topic: string;
    moderatorId: string;
    participantIds: string[];
    currentSpeakerId: string | null;
    currentTurnIndex: number;
    turnDurationSeconds: number;
    maxRounds: number;
    chatEnabled: boolean;
    factCheckEnabled: boolean;
    audiencePrompt: string;
    productionSettings: AiRoundtableProductionSettings;
    showSessionKey: string | null;
    activeItemId: string | null;
    introductionComplete: boolean;
    videoContext: AiRoundtableVideoContext;
    startedAt: string | null;
  }>,
) {
  return (
    await query<AiRoundtableSettings>(
      `update ai_roundtable_settings set
         enabled=coalesce($1,enabled),
         status=coalesce($2,status),
         preset=coalesce($3,preset),
         topic=coalesce($4,topic),
         moderator_id=coalesce($5,moderator_id),
         participant_ids=coalesce($6::text[],participant_ids),
         current_speaker_id=case when $7 then $8 else current_speaker_id end,
         current_turn_index=coalesce($9,current_turn_index),
         turn_duration_seconds=coalesce($10,turn_duration_seconds),
         max_rounds=coalesce($11,max_rounds),
         chat_enabled=coalesce($12,chat_enabled),
         fact_check_enabled=coalesce($13,fact_check_enabled),
         audience_prompt=coalesce($14,audience_prompt),
         production_settings=coalesce($15::jsonb,production_settings),
         show_session_key=case when $16 then $17 else show_session_key end,
         active_item_id=case when $18 then $19::uuid else active_item_id end,
         introduction_complete=coalesce($20,introduction_complete),
         video_context=coalesce($21::jsonb,video_context),
         started_at=case when $22 then $23::timestamptz else started_at end,
         updated_at=now()
       where id=true returning *`,
      [
        input.enabled ?? null,
        input.status ?? null,
        input.preset ?? null,
        input.topic ?? null,
        input.moderatorId ?? null,
        input.participantIds ?? null,
        Object.prototype.hasOwnProperty.call(input, 'currentSpeakerId'),
        input.currentSpeakerId ?? null,
        input.currentTurnIndex ?? null,
        input.turnDurationSeconds ?? null,
        input.maxRounds ?? null,
        input.chatEnabled ?? null,
        input.factCheckEnabled ?? null,
        input.audiencePrompt ?? null,
        input.productionSettings ?? null,
        Object.prototype.hasOwnProperty.call(input, 'showSessionKey'),
        input.showSessionKey ?? null,
        Object.prototype.hasOwnProperty.call(input, 'activeItemId'),
        input.activeItemId ?? null,
        input.introductionComplete ?? null,
        input.videoContext ?? null,
        Object.prototype.hasOwnProperty.call(input, 'startedAt'),
        input.startedAt ?? null,
      ],
    )
  ).rows[0];
}

export async function resetAiRoundtableTurns() {
  return transaction(async (client) => {
    await client.query(
      `update ai_roundtable_turns set status='completed' where status in ('preparing','ready','live')`,
    );
    await client.query(
      `update ai_roundtable_settings
       set current_speaker_id=null,current_turn_index=0,started_at=now(),updated_at=now()
       where id=true`,
    );
  });
}

export async function configureAiRoundtableBroadcastItem(input: {
  showSessionKey: string;
  itemId: string;
  topic: string;
  preset: AiRoundtablePreset;
  participantIds: string[];
  productionSettings?: AiRoundtableProductionSettings;
  videoContext: AiRoundtableVideoContext;
}) {
  return transaction(async (client) => {
    const current = (
      await client.query<AiRoundtableSettings>('select * from ai_roundtable_settings where id=true for update')
    ).rows[0];
    if (!current) throw new Error('KI-Rundenregie ist nicht eingerichtet.');
    const sessionChanged = current.show_session_key !== input.showSessionKey;
    const itemChanged = current.active_item_id !== input.itemId;
    const resetTurns = sessionChanged || itemChanged || current.status === 'ended' || current.status === 'error';
    if (resetTurns)
      await client.query(
        `update ai_roundtable_turns set status='completed' where status in ('preparing','ready','live')`,
      );
    const introductionComplete = sessionChanged ? false : current.introduction_complete;
    return (
      await client.query<AiRoundtableSettings>(
        `update ai_roundtable_settings
         set enabled=true,status='live',preset=$1,topic=$2,
             participant_ids=$3::text[],
             moderator_id=case when moderator_id=any($3::text[]) then moderator_id else ($3::text[])[1] end,
             current_speaker_id=case when $4 then null else current_speaker_id end,
             current_turn_index=case when $4 then 0 else current_turn_index end,
             production_settings=production_settings || $5::jsonb,
             show_session_key=$6,active_item_id=$7::uuid,
             introduction_complete=$8,video_context=$9::jsonb,
             started_at=case when $10 then now() else started_at end,
             updated_at=now()
         where id=true returning *`,
        [
          input.preset,
          input.topic.slice(0, 600),
          input.participantIds.slice(0, 6),
          resetTurns,
          input.productionSettings ?? {},
          input.showSessionKey.slice(0, 200),
          input.itemId,
          introductionComplete,
          input.videoContext,
          sessionChanged,
        ],
      )
    ).rows[0];
  });
}

export async function completeAiRoundtableBroadcastItem(showSessionKey: string, itemId: string, finalItem: boolean) {
  return (
    await query<AiRoundtableSettings>(
      `update ai_roundtable_settings
       set status=case when $3 then 'ended' else 'paused' end,
           current_speaker_id=null,
           updated_at=now()
       where id=true and show_session_key=$1 and active_item_id=$2::uuid
       returning *`,
      [showSessionKey, itemId, finalItem],
    )
  ).rows[0];
}

export async function listAiRoundtableParticipants(ids?: string[]) {
  return (
    await query<{
      id: string;
      display_name: string;
      job_title: string;
      role: string;
      description: string;
      accent_color: string;
      instructions: string;
      config: Record<string, unknown>;
      tts_provider: string;
      tts_voice: string;
      idle_revision: string | null;
      speaking_revision: string | null;
    }>(
      `select member.id,member.display_name,member.job_title,member.role,member.description,
              member.accent_color,member.instructions,member.config,
              coalesce(profile.tts_provider,'') tts_provider,coalesce(profile.tts_voice,'') tts_voice,
              idle.sha256 idle_revision,speaking.sha256 speaking_revision
       from ai_staff_members member
       left join ai_presenter_profiles profile on profile.staff_member_id=member.id
       left join ai_presenter_media idle on idle.staff_member_id=member.id and idle.state='idle'
       left join ai_presenter_media speaking on speaking.staff_member_id=member.id and speaking.state='speaking'
       where member.enabled=true and member.role in ('moderator','chat-moderator','translator')
         and ($1::text[] is null or member.id=any($1::text[]))
       order by
         case when $1::text[] is null then 0 else array_position($1::text[],member.id) end nulls last,
         member.display_name`,
      [ids?.length ? ids : null],
    )
  ).rows;
}

export async function currentAiRoundtableTurn() {
  return (
    (
      await query<AiRoundtableTurn>(
        `select turn.*,member.display_name,member.job_title,member.accent_color
         from ai_roundtable_turns turn
         join ai_staff_members member on member.id=turn.speaker_id
         where turn.status in ('ready','live') and turn.ends_at>now()
         order by turn.turn_index desc limit 1`,
      )
    ).rows[0] ?? null
  );
}

export async function listAiRoundtableTurns(limit = 30) {
  return (
    await query<AiRoundtableTurn>(
      `select turn.*,member.display_name,member.job_title,member.accent_color
       from ai_roundtable_turns turn
       join ai_staff_members member on member.id=turn.speaker_id
       order by turn.turn_index desc limit $1`,
      [Math.max(1, Math.min(200, limit))],
    )
  ).rows;
}

export async function getAiRoundtableTurn(turnId: string) {
  return (
    (
      await query<AiRoundtableTurn>(
        `select turn.*,member.display_name,member.job_title,member.accent_color
         from ai_roundtable_turns turn
         join ai_staff_members member on member.id=turn.speaker_id
         where turn.id=$1`,
        [turnId],
      )
    ).rows[0] ?? null
  );
}

export async function completeExpiredAiRoundtableTurns() {
  return query(
    `with expired as (
       update ai_roundtable_turns
       set status='completed'
       where status in ('ready','live') and ends_at<=now()
       returning preproduced_cue_id,preproduced_run_key
     ), completed_cues as (
       update youtube_preproduced_cue_runs cue_run
       set status='completed',completed_at=coalesce(completed_at,now())
       from expired
       where expired.preproduced_cue_id=cue_run.cue_id
         and expired.preproduced_run_key=cue_run.run_key
         and cue_run.status='claimed'
       returning cue_run.cue_id
     )
     select
       (select count(*)::int from expired) completed_turns,
       (select count(*)::int from completed_cues) completed_preproduced_cues`,
  );
}

export async function insertAiRoundtableTurn(input: {
  speakerId: string;
  turnIndex: number;
  roundNumber: number;
  kind: AiRoundtableTurn['kind'];
  headline: string;
  text: string;
  audiencePrompt?: string | null;
  sourceLabels?: string[];
  model?: string | null;
  tier?: AiRoundtableTurn['tier'];
  audioPath?: string | null;
  preproducedCueId?: string | null;
  preproducedRunKey?: string | null;
  videoPauseMs?: number | null;
  sourceStartMs?: number | null;
  sourceEndMs?: number | null;
  audienceMessageId?: string | null;
  durationSeconds: number;
}) {
  return transaction(async (client) => {
    await client.query(`update ai_roundtable_turns set status='completed' where status in ('ready','live')`);
    const turn = (
      await client.query<AiRoundtableTurn>(
        `insert into ai_roundtable_turns(
           speaker_id,turn_index,round_number,kind,headline,text,audience_prompt,source_labels,
           model,tier,audio_path,preproduced_cue_id,preproduced_run_key,video_pause_ms,
           source_start_ms,source_end_ms,audience_message_id,status,starts_at,ends_at
         ) values(
           $1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15,$16,$17,
           'live',now(),now()+($18||' seconds')::interval
         )
         returning *`,
        [
          input.speakerId,
          input.turnIndex,
          input.roundNumber,
          input.kind,
          input.headline,
          input.text,
          input.audiencePrompt ?? null,
          input.sourceLabels ?? [],
          input.model ?? null,
          input.tier ?? null,
          input.audioPath ?? null,
          input.preproducedCueId ?? null,
          input.preproducedRunKey?.slice(0, 240) ?? null,
          input.videoPauseMs == null ? null : Math.max(0, Math.floor(input.videoPauseMs)),
          input.sourceStartMs == null ? null : Math.max(0, Math.floor(input.sourceStartMs)),
          input.sourceEndMs == null ? null : Math.max(0, Math.floor(input.sourceEndMs)),
          input.audienceMessageId ?? null,
          Math.max(8, Math.min(240, Math.ceil(input.durationSeconds))),
        ],
      )
    ).rows[0];
    await client.query(
      `update ai_roundtable_settings
       set current_speaker_id=$1,current_turn_index=$2,updated_at=now()
       where id=true`,
      [input.speakerId, input.turnIndex],
    );
    return turn;
  });
}

export async function nextRoundtableAudienceQuestion() {
  return (
    (
      await query<{
        id: string;
        provider: string;
        author_name: string;
        message: string;
        published_at: string;
      }>(
        `select message.id,message.provider,message.author_name,message.message,message.published_at
         from ai_host_chat_messages message
         where message.safe=true
           and message.provider in ('youtube','twitch')
           and message.received_at>now()-interval '90 minutes'
           and (
             position('?' in message.message)>0
             or lower(message.message) ~ '^[[:space:]]*!frage([^[:alnum:]_]|$)'
           )
           and not exists(
             select 1 from ai_roundtable_turns turn where turn.audience_message_id=message.id
           )
         order by message.published_at
         limit 1`,
      )
    ).rows[0] ?? null
  );
}

export async function completeAiRoundtableTurnPlayback(turnId: string, failed = false) {
  return (
    (
      await query<AiRoundtableTurn>(
        `update ai_roundtable_turns
       set status=case when $2 then 'failed' else 'completed' end,
           ends_at=least(ends_at,now())
       where id=$1 and status in ('preparing','ready','live')
       returning *`,
        [turnId, failed],
      )
    ).rows[0] ?? null
  );
}

export async function getAiRoundtableTurnPlaybackContext(turnId: string) {
  return (
    (
      await query<{
        id: string;
        speaker_id: string;
        preproduced_cue_id: string | null;
        preproduced_run_key: string | null;
        video_pause_ms: number | string | null;
        active_item_id: string | null;
        introduction_complete: boolean;
        status: AiRoundtableTurn['status'];
      }>(
        `select turn.id,turn.speaker_id,turn.preproduced_cue_id,turn.preproduced_run_key,turn.video_pause_ms,
                settings.active_item_id,settings.introduction_complete,turn.status
         from ai_roundtable_turns turn
         cross join ai_roundtable_settings settings
         where turn.id=$1`,
        [turnId],
      )
    ).rows[0] ?? null
  );
}

export async function recentRoundtableAudienceMessages(limit = 12) {
  return (
    await query<{ provider: string; author_name: string; message: string; published_at: string }>(
      `select provider,author_name,message,published_at
       from ai_host_chat_messages
       where safe=true and received_at>now()-interval '30 minutes'
       order by published_at desc limit $1`,
      [Math.max(1, Math.min(40, limit))],
    )
  ).rows.reverse();
}
