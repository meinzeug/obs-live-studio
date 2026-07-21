import { query, transaction } from './index.js';
import type { YoutubeShortJob } from './youtube-shorts.js';

export type ShortsPremiumSettings = {
  id: boolean;
  elevenlabs_enabled: boolean;
  elevenlabs_voice_id: string;
  elevenlabs_voice_name: string;
  elevenlabs_model_id: string;
  elevenlabs_output_format: string;
  elevenlabs_stability: number;
  elevenlabs_similarity_boost: number;
  elevenlabs_style: number;
  elevenlabs_speaker_boost: boolean;
  local_tts_fallback: boolean;
  paid_llm_enabled: boolean;
  paid_llm_model_strategy: 'automatic' | 'fixed';
  paid_llm_model: string;
  paid_llm_max_request_usd: number;
  paid_llm_daily_budget_usd: number;
  editorial_instructions: string;
  updated_at: string;
};

export type ShortsPremiumPlan = {
  hook: string;
  narrationText: string;
  editorialAngle: string;
  youtube: {
    title: string;
    description: string;
    tags: string[];
    hashtags: string[];
    publishDelayMinutes: number;
    scheduleRationale: string;
  };
  tiktok: {
    caption: string;
    hashtags: string[];
    publishDelayMinutes: number;
    scheduleRationale: string;
  };
};

function normalizedSettings(row: ShortsPremiumSettings) {
  return {
    ...row,
    paid_llm_max_request_usd: Number(row.paid_llm_max_request_usd),
    paid_llm_daily_budget_usd: Number(row.paid_llm_daily_budget_usd),
  };
}

export async function getShortsPremiumSettings() {
  return normalizedSettings(
    (await query<ShortsPremiumSettings>('select * from shorts_premium_settings where id=true')).rows[0],
  );
}

export async function updateShortsPremiumSettings(
  input: Partial<{
    elevenlabsEnabled: boolean;
    elevenlabsVoiceId: string;
    elevenlabsVoiceName: string;
    elevenlabsModelId: string;
    elevenlabsOutputFormat: string;
    elevenlabsStability: number;
    elevenlabsSimilarityBoost: number;
    elevenlabsStyle: number;
    elevenlabsSpeakerBoost: boolean;
    localTtsFallback: boolean;
    paidLlmEnabled: boolean;
    paidLlmModelStrategy: 'automatic' | 'fixed';
    paidLlmModel: string;
    paidLlmMaxRequestUsd: number;
    paidLlmDailyBudgetUsd: number;
    editorialInstructions: string;
  }>,
) {
  return normalizedSettings(
    (
      await query<ShortsPremiumSettings>(
        `update shorts_premium_settings set
         elevenlabs_enabled=coalesce($1,elevenlabs_enabled),
         elevenlabs_voice_id=coalesce($2,elevenlabs_voice_id),
         elevenlabs_voice_name=coalesce($3,elevenlabs_voice_name),
         elevenlabs_model_id=coalesce($4,elevenlabs_model_id),
         elevenlabs_output_format=coalesce($5,elevenlabs_output_format),
         elevenlabs_stability=coalesce($6,elevenlabs_stability),
         elevenlabs_similarity_boost=coalesce($7,elevenlabs_similarity_boost),
         elevenlabs_style=coalesce($8,elevenlabs_style),
         elevenlabs_speaker_boost=coalesce($9,elevenlabs_speaker_boost),
         local_tts_fallback=coalesce($10,local_tts_fallback),
         paid_llm_enabled=coalesce($11,paid_llm_enabled),
         paid_llm_model_strategy=coalesce($12,paid_llm_model_strategy),
         paid_llm_model=coalesce($13,paid_llm_model),
         paid_llm_max_request_usd=coalesce($14,paid_llm_max_request_usd),
         paid_llm_daily_budget_usd=coalesce($15,paid_llm_daily_budget_usd),
         editorial_instructions=coalesce($16,editorial_instructions),updated_at=now()
       where id=true returning *`,
        [
          input.elevenlabsEnabled ?? null,
          input.elevenlabsVoiceId ?? null,
          input.elevenlabsVoiceName ?? null,
          input.elevenlabsModelId ?? null,
          input.elevenlabsOutputFormat ?? null,
          input.elevenlabsStability ?? null,
          input.elevenlabsSimilarityBoost ?? null,
          input.elevenlabsStyle ?? null,
          input.elevenlabsSpeakerBoost ?? null,
          input.localTtsFallback ?? null,
          input.paidLlmEnabled ?? null,
          input.paidLlmModelStrategy ?? null,
          input.paidLlmModel ?? null,
          input.paidLlmMaxRequestUsd ?? null,
          input.paidLlmDailyBudgetUsd ?? null,
          input.editorialInstructions ?? null,
        ],
      )
    ).rows[0],
  );
}

export type ShortsQualityUpgradeStatus = {
  youtube: { waiting: number; queued: number; upgraded: number };
  tiktok: { waiting: number; queued: number; upgraded: number };
};

function countValue(value: string | number | undefined) {
  return Number(value ?? 0);
}

/**
 * Reports only jobs which are still safe to render again. Published, handed-off
 * and actively uploading clips are deliberately excluded so enabling a premium
 * voice can never create a duplicate remote post.
 */
export async function getShortsQualityUpgradeStatus(): Promise<ShortsQualityUpgradeStatus> {
  const result = await query<{
    youtube_waiting: string;
    youtube_queued: string;
    youtube_upgraded: string;
    tiktok_waiting: string;
    tiktok_queued: string;
    tiktok_upgraded: string;
  }>(
    `select
       (select count(*)::text from youtube_short_jobs
          where status in ('ready','upload-queued') and youtube_upload_id is null and uploaded_at is null
            and premium_planned_at is not null
            and coalesce(metadata->>'speechProvider','')<>'elevenlabs') youtube_waiting,
       (select count(*)::text from youtube_short_jobs
          where status in ('queued','downloading','rendering')
            and coalesce(metadata->>'hqUpgradeQueued','false')='true') youtube_queued,
       (select count(*)::text from youtube_short_jobs
          where coalesce(metadata->>'speechProvider','')='elevenlabs') youtube_upgraded,
       (select count(*)::text from tiktok_short_jobs
          where status in ('ready','upload-queued') and publish_id is null and published_at is null
            and coalesce(metadata->>'speechProvider','')<>'elevenlabs') tiktok_waiting,
       (select count(*)::text from tiktok_short_jobs
          where status in ('queued','rendering')
            and coalesce(metadata->>'hqUpgradeQueued','false')='true') tiktok_queued,
       (select count(*)::text from tiktok_short_jobs
          where coalesce(metadata->>'speechProvider','')='elevenlabs') tiktok_upgraded`,
  );
  const row = result.rows[0];
  return {
    youtube: {
      waiting: countValue(row?.youtube_waiting),
      queued: countValue(row?.youtube_queued),
      upgraded: countValue(row?.youtube_upgraded),
    },
    tiktok: {
      waiting: countValue(row?.tiktok_waiting),
      queued: countValue(row?.tiktok_queued),
      upgraded: countValue(row?.tiktok_upgraded),
    },
  };
}

export type ShortsQualityUpgradeQueueResult = {
  youtube: number;
  tiktok: number;
  total: number;
};

/**
 * Queues locally finished fallback renders after ElevenLabs becomes available.
 * The previous output path is retained until the renderer replaces the file,
 * which keeps previews usable if the premium render itself fails.
 */
export async function queueFallbackShortsForElevenLabsUpgrade(): Promise<ShortsQualityUpgradeQueueResult> {
  return transaction(async (client) => {
    await client.query("select pg_advisory_xact_lock(hashtext('shorts-elevenlabs-quality-upgrade'))");
    const youtube = await client.query<{ id: string }>(
      `update youtube_short_jobs set
         status='queued',progress=2,error=null,attempts=0,next_attempt_at=now(),
         started_at=null,completed_at=null,locked_at=null,locked_by=null,
         metadata=coalesce(metadata,'{}'::jsonb)||jsonb_build_object(
           'hqUpgradeQueued',true,
           'hqUpgradeQueuedAt',now(),
           'previousSpeechProvider',coalesce(metadata->>'speechProvider','local'),
           'fallbackOutputPath',output_path
         ),updated_at=now()
       where status in ('ready','upload-queued')
         and youtube_upload_id is null and uploaded_at is null
         and premium_planned_at is not null
         and coalesce(metadata->>'speechProvider','')<>'elevenlabs'
       returning id`,
    );
    const tiktok = await client.query<{ id: string }>(
      `update tiktok_short_jobs set
         status='queued',progress=2,error=null,attempts=0,next_attempt_at=now(),
         started_at=null,completed_at=null,locked_at=null,locked_by=null,
         metadata=coalesce(metadata,'{}'::jsonb)||jsonb_build_object(
           'hqUpgradeQueued',true,
           'hqUpgradeQueuedAt',now(),
           'previousSpeechProvider',coalesce(metadata->>'speechProvider','local'),
           'fallbackOutputPath',output_path
         ),updated_at=now()
       where status in ('ready','upload-queued')
         and publish_id is null and published_at is null
         and coalesce(metadata->>'speechProvider','')<>'elevenlabs'
       returning id`,
    );
    const youtubeCount = youtube.rowCount ?? youtube.rows.length;
    const tiktokCount = tiktok.rowCount ?? tiktok.rows.length;
    return { youtube: youtubeCount, tiktok: tiktokCount, total: youtubeCount + tiktokCount };
  });
}

function publishAt(delayMinutes: number) {
  return new Date(Date.now() + Math.max(0, Math.min(1440, Math.round(delayMinutes))) * 60_000).toISOString();
}

export async function applyPremiumShortPlan(
  id: string,
  input: { plan: ShortsPremiumPlan; model: string; usage: Record<string, unknown> },
) {
  const youtubePublishAt = publishAt(input.plan.youtube.publishDelayMinutes);
  const tiktokPublishAt = publishAt(input.plan.tiktok.publishDelayMinutes);
  return transaction(async (client) => {
    const job =
      (
        await client.query<YoutubeShortJob>(
          `update youtube_short_jobs set
           commentary_headline=$2,commentary_text=$3,commentary_model=$4,
           premium_plan=$5::jsonb,premium_planned_at=now(),planned_publish_at=$6::timestamptz,
           metadata=coalesce(metadata,'{}'::jsonb)||jsonb_build_object(
             'premiumEditorial',true,'premiumEditorialModel',$4::text,'premiumEditorialUsage',$7::jsonb,
             'publication',jsonb_build_object(
               'title',$8::text,'description',$9::text,'tags',$10::jsonb
             )
           ),updated_at=now()
         where id=$1 and status<>'cancelled' returning *`,
          [
            id,
            input.plan.hook,
            input.plan.narrationText,
            input.model,
            JSON.stringify(input.plan),
            youtubePublishAt,
            JSON.stringify(input.usage),
            input.plan.youtube.title,
            input.plan.youtube.description,
            JSON.stringify(input.plan.youtube.tags),
          ],
        )
      ).rows[0] ?? null;
    if (!job) return null;
    await client.query(
      `update tiktok_short_jobs set
         caption=left(trim(concat($2::text,' ',array_to_string(array(select jsonb_array_elements_text($3::jsonb)),' '))),2200),
         premium_plan=$4::jsonb,planned_publish_at=$5::timestamptz,
         metadata=coalesce(metadata,'{}'::jsonb)||jsonb_build_object(
           'premiumEditorial',true,'premiumEditorialModel',$6::text,'premiumEditorialUsage',$7::jsonb
         ),updated_at=now()
       where source_job_id=$1 and status in ('queued','failed','cancelled','ready','handed-off')`,
      [
        id,
        input.plan.tiktok.caption,
        JSON.stringify(input.plan.tiktok.hashtags),
        JSON.stringify(input.plan),
        tiktokPublishAt,
        input.model,
        JSON.stringify(input.usage),
      ],
    );
    return job;
  });
}
