-- TikTok nutzt dieselben redaktionell qualifizierten AVA-Momente als Quelle,
-- bekommt aber einen eigenen, wasserzeichenfreien Render- und Freigabestatus.
-- TikTok Direct Post darf erst nach einer ausdrücklichen Freigabe pro Clip laufen.
create table if not exists tiktok_shorts_settings(
  id boolean primary key default true,
  enabled boolean not null default true,
  auto_create boolean not null default true,
  daily_limit int not null default 3,
  duration_seconds int not null default 90,
  caption_template text not null default '{title} – AVA ordnet ein #Einordnung #News',
  time_zone text not null default 'Europe/Berlin',
  source_volume_percent int not null default 88,
  source_duck_percent int not null default 24,
  app_audited boolean not null default false,
  updated_at timestamptz not null default now(),
  constraint tiktok_shorts_settings_singleton check(id),
  constraint tiktok_shorts_daily_limit_valid check(daily_limit between 0 and 50),
  constraint tiktok_shorts_duration_valid check(duration_seconds=90),
  constraint tiktok_shorts_source_volume_valid check(source_volume_percent between 0 and 150),
  constraint tiktok_shorts_duck_volume_valid check(source_duck_percent between 0 and 100)
);

insert into tiktok_shorts_settings(id) values(true) on conflict(id) do nothing;

create table if not exists tiktok_short_jobs(
  id uuid primary key default gen_random_uuid(),
  source_job_id uuid not null references youtube_short_jobs(id) on delete cascade,
  status text not null default 'queued',
  progress int not null default 0,
  production_date date not null,
  output_path text,
  thumbnail_path text,
  caption text not null default '',
  privacy_level text,
  disable_comment boolean not null default true,
  disable_duet boolean not null default true,
  disable_stitch boolean not null default true,
  brand_content_toggle boolean not null default false,
  brand_organic_toggle boolean not null default false,
  rights_confirmed boolean not null default false,
  music_usage_confirmed boolean not null default false,
  publish_id text,
  post_id text,
  post_url text,
  remote_status text,
  attempts int not null default 0,
  error text,
  next_attempt_at timestamptz not null default now(),
  locked_at timestamptz,
  locked_by text,
  started_at timestamptz,
  completed_at timestamptz,
  published_at timestamptz,
  metadata jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint tiktok_short_jobs_status_valid check(status in (
    'queued','rendering','ready','upload-queued','uploading','processing','published','failed','cancelled'
  )),
  constraint tiktok_short_jobs_progress_valid check(progress between 0 and 100),
  constraint tiktok_short_jobs_source_unique unique(source_job_id)
);

create index if not exists idx_tiktok_short_jobs_queue
  on tiktok_short_jobs(status,next_attempt_at,created_at)
  where status in ('queued','upload-queued','processing');

create index if not exists idx_tiktok_short_jobs_daily
  on tiktok_short_jobs(production_date,status,created_at desc);
