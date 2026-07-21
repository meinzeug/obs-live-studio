-- YouTube und TikTok teilen sich eine Premium-Redaktion und eine hochwertige
-- Sprecherzeugung. Der ElevenLabs-Schluessel bleibt bewusst in der geschuetzten
-- Server-Environment; hier liegen nur nicht geheime Produktionsparameter.
create table if not exists shorts_premium_settings(
  id boolean primary key default true,
  elevenlabs_enabled boolean not null default true,
  elevenlabs_voice_id text not null default '',
  elevenlabs_voice_name text not null default '',
  elevenlabs_model_id text not null default 'eleven_multilingual_v2',
  elevenlabs_output_format text not null default 'mp3_44100_128',
  elevenlabs_stability double precision not null default 0.55,
  elevenlabs_similarity_boost double precision not null default 0.78,
  elevenlabs_style double precision not null default 0.20,
  elevenlabs_speaker_boost boolean not null default true,
  local_tts_fallback boolean not null default true,
  paid_llm_enabled boolean not null default true,
  paid_llm_model_strategy text not null default 'automatic',
  paid_llm_model text not null default '',
  paid_llm_max_request_usd numeric(8,4) not null default 0.20,
  paid_llm_daily_budget_usd numeric(8,2) not null default 5.00,
  editorial_instructions text not null default
    'Sachlich, präzise und neugierig formulieren. Keine erfundenen Fakten, Zitate oder Clickbait-Versprechen.',
  updated_at timestamptz not null default now(),
  constraint shorts_premium_settings_singleton check(id),
  constraint shorts_premium_stability_valid check(elevenlabs_stability between 0 and 1),
  constraint shorts_premium_similarity_valid check(elevenlabs_similarity_boost between 0 and 1),
  constraint shorts_premium_style_valid check(elevenlabs_style between 0 and 1),
  constraint shorts_premium_model_strategy_valid check(paid_llm_model_strategy in ('automatic','fixed')),
  constraint shorts_premium_request_budget_valid check(paid_llm_max_request_usd between 0.01 and 25),
  constraint shorts_premium_daily_budget_valid check(paid_llm_daily_budget_usd between 0.01 and 1000)
);

insert into shorts_premium_settings(id) values(true) on conflict(id) do nothing;

alter table youtube_short_jobs
  add column if not exists premium_plan jsonb not null default '{}'::jsonb,
  add column if not exists premium_planned_at timestamptz,
  add column if not exists planned_publish_at timestamptz;

alter table tiktok_short_jobs
  add column if not exists premium_plan jsonb not null default '{}'::jsonb,
  add column if not exists planned_publish_at timestamptz;

create index if not exists idx_youtube_short_jobs_planned_publish
  on youtube_short_jobs(status,planned_publish_at)
  where status in ('ready','upload-queued');

create index if not exists idx_tiktok_short_jobs_planned_publish
  on tiktok_short_jobs(status,planned_publish_at)
  where status in ('ready','upload-queued');
