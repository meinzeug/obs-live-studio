create table if not exists growth_settings(
  id boolean primary key default true,
  enabled boolean not null default true,
  auto_detect boolean not null default true,
  auto_create_social_pack boolean not null default true,
  approval_required boolean not null default true,
  minimum_score int not null default 62,
  minimum_chat_messages int not null default 3,
  clip_preroll_seconds int not null default 12,
  clip_duration_seconds int not null default 45,
  participation_overlay boolean not null default true,
  share_url text,
  share_prompt text not null default 'Teile die Sendung mit Menschen, die mitdiskutieren sollten.',
  platforms jsonb not null default '["youtube-shorts","instagram-reels","tiktok"]',
  updated_at timestamptz not null default now(),
  constraint growth_settings_singleton check(id),
  constraint growth_score_valid check(minimum_score between 1 and 100)
);

insert into growth_settings(id) values(true) on conflict(id) do nothing;

create table if not exists growth_moments(
  id uuid primary key default gen_random_uuid(),
  ai_host_session_id uuid references ai_host_sessions(id) on delete set null,
  broadcast_item_id uuid references broadcast_items(id) on delete set null,
  youtube_video_id text,
  title text not null,
  hook text not null,
  reason text not null,
  score int not null,
  chat_count int not null default 0,
  media_position_ms bigint,
  status text not null default 'detected',
  social_pack jsonb not null default '{}',
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint growth_moment_score_valid check(score between 1 and 100),
  constraint growth_moment_status_valid check(status in ('detected','approved','rejected','rendering','ready','published','failed'))
);

create index if not exists idx_growth_moments_recent on growth_moments(created_at desc);
create index if not exists idx_growth_moments_session on growth_moments(ai_host_session_id,created_at desc);

create table if not exists growth_publications(
  id uuid primary key default gen_random_uuid(),
  moment_id uuid not null references growth_moments(id) on delete cascade,
  platform text not null,
  status text not null default 'queued',
  title text not null,
  caption text not null,
  hashtags text[] not null default '{}',
  media_path text,
  external_id text,
  public_url text,
  error text,
  scheduled_at timestamptz,
  published_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint growth_publication_status_valid check(status in ('queued','waiting-media','ready','publishing','published','failed','cancelled')),
  unique(moment_id,platform)
);
