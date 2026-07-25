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
  started_at: string | null;
  updated_at: string;
};

export type AiRoundtableTurn = {
  id: string;
  speaker_id: string;
  display_name?: string;
  job_title?: string;
  accent_color?: string;
  turn_index: number;
  round_number: number;
  kind: 'opening' | 'position' | 'response' | 'fact-check' | 'audience' | 'closing';
  headline: string;
  text: string;
  audience_prompt: string | null;
  source_labels: string[];
  model: string | null;
  tier: 'free' | 'paid' | 'local' | null;
  audio_path: string | null;
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
         started_at=case when $15 then $16::timestamptz else started_at end,
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
        Object.prototype.hasOwnProperty.call(input, 'startedAt'),
        input.startedAt ?? null,
      ],
    )
  ).rows[0];
}

export async function resetAiRoundtableTurns() {
  return transaction(async (client) => {
    await client.query(`update ai_roundtable_turns set status='completed' where status in ('preparing','ready','live')`);
    await client.query(
      `update ai_roundtable_settings
       set current_speaker_id=null,current_turn_index=0,started_at=now(),updated_at=now()
       where id=true`,
    );
  });
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
       where member.enabled=true and member.role in ('moderator','chat-moderator')
         and ($1::text[] is null or member.id=any($1::text[]))
       order by member.display_name`,
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

export async function completeExpiredAiRoundtableTurns() {
  return query(
    `update ai_roundtable_turns set status='completed'
     where status in ('ready','live') and ends_at<=now()`,
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
  durationSeconds: number;
}) {
  return transaction(async (client) => {
    await client.query(`update ai_roundtable_turns set status='completed' where status in ('ready','live')`);
    const turn = (
      await client.query<AiRoundtableTurn>(
        `insert into ai_roundtable_turns(
           speaker_id,turn_index,round_number,kind,headline,text,audience_prompt,source_labels,
           model,tier,audio_path,status,starts_at,ends_at
         ) values($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,'live',now(),now()+($12||' seconds')::interval)
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
          Math.max(12, Math.min(240, Math.ceil(input.durationSeconds))),
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
