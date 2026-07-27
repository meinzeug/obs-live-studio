-- Sendefertige, zeitcodierte Moderationsmanuskripte machen YouTube-Sendungen
-- unabhängig von der momentanen Verfügbarkeit externer KI-Modelle.

create table if not exists youtube_preproduced_scripts(
  id uuid primary key default gen_random_uuid(),
  youtube_video_id uuid not null unique references youtube_videos(id) on delete cascade,
  status text not null default 'pending',
  transcript_hash text,
  generator_version text not null default 'local-v1',
  cue_count int not null default 0,
  duration_ms bigint not null default 0,
  error text,
  generated_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint youtube_preproduced_script_status_valid
    check(status in ('pending','processing','ready','partial','unavailable','error')),
  constraint youtube_preproduced_script_cue_count_valid check(cue_count >= 0),
  constraint youtube_preproduced_script_duration_valid check(duration_ms >= 0)
);

create index if not exists idx_youtube_preproduced_scripts_status
  on youtube_preproduced_scripts(status,updated_at);

create table if not exists youtube_preproduced_cues(
  id uuid primary key default gen_random_uuid(),
  script_id uuid not null references youtube_preproduced_scripts(id) on delete cascade,
  position int not null,
  at_ms bigint not null,
  end_ms bigint,
  presenter_id text not null references ai_staff_members(id),
  kind text not null default 'context',
  display_mode text not null default 'inline',
  headline text not null,
  speaker_text text not null,
  audience_prompt text,
  source_excerpt text,
  source_start_ms bigint,
  source_end_ms bigint,
  wit boolean not null default false,
  created_at timestamptz not null default now(),
  unique(script_id,position),
  constraint youtube_preproduced_cue_position_valid check(position >= 0),
  constraint youtube_preproduced_cue_time_valid check(at_ms >= 0 and (end_ms is null or end_ms >= at_ms)),
  constraint youtube_preproduced_cue_kind_valid
    check(kind in ('intro','context','reaction','fact-check','question','closing')),
  constraint youtube_preproduced_cue_display_valid check(display_mode in ('inline','takeover')),
  constraint youtube_preproduced_cue_text_valid check(length(trim(speaker_text)) >= 10)
);

create index if not exists idx_youtube_preproduced_cues_due
  on youtube_preproduced_cues(script_id,at_ms,position);

create table if not exists youtube_preproduced_cue_runs(
  cue_id uuid not null references youtube_preproduced_cues(id) on delete cascade,
  run_key text not null,
  broadcast_item_id uuid references broadcast_items(id) on delete cascade,
  status text not null default 'claimed',
  claimed_at timestamptz not null default now(),
  completed_at timestamptz,
  primary key(cue_id,run_key),
  constraint youtube_preproduced_cue_run_status_valid
    check(status in ('claimed','completed','skipped','failed'))
);

create index if not exists idx_youtube_preproduced_cue_runs_item
  on youtube_preproduced_cue_runs(broadcast_item_id,claimed_at desc);
