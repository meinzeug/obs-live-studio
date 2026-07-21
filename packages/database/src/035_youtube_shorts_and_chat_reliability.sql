-- Provider-Wechsel im Livechat müssen seitenspezifische Page-Tokens verwerfen
-- können. Die Zustandsdaten machen außerdem sichtbar, ob Sam tatsächlich neue
-- Nachrichten erhält oder lediglich auf einen nicht verfügbaren Fremdchat
-- wartet.
alter table ai_host_sessions
  add column if not exists chat_live_chat_id text,
  add column if not exists chat_source_key text,
  add column if not exists chat_last_success_at timestamptz,
  add column if not exists chat_last_message_at timestamptz,
  add column if not exists chat_messages_received int not null default 0,
  add column if not exists chat_provider_state jsonb not null default '{}'::jsonb;

create table if not exists youtube_shorts_settings(
  id boolean primary key default true,
  enabled boolean not null default true,
  auto_create boolean not null default true,
  auto_upload boolean not null default true,
  daily_limit int not null default 3,
  duration_seconds int not null default 90,
  privacy_status text not null default 'private',
  overlay_path text not null default '/home/dennis/Dokumente/ZEITKANTE_OVERLAY_SHORTS_V2.png',
  rights_confirmed boolean not null default false,
  source_volume_percent int not null default 88,
  source_duck_percent int not null default 24,
  title_template text not null default '{title} | AVA ordnet ein #Shorts',
  description_template text not null default 'AVA ordnet einen Ausschnitt aus „{title}“ vom Kanal {channel} ein.\n\nQuelle: {url}\n\n#Shorts #Einordnung',
  tags jsonb not null default '["Shorts","Einordnung","Nachrichten","Zeitkante"]'::jsonb,
  time_zone text not null default 'Europe/Berlin',
  updated_at timestamptz not null default now(),
  constraint youtube_shorts_settings_singleton check(id),
  constraint youtube_shorts_daily_limit_valid check(daily_limit between 0 and 50),
  constraint youtube_shorts_duration_valid check(duration_seconds=90),
  constraint youtube_shorts_privacy_valid check(privacy_status in ('private','unlisted','public')),
  constraint youtube_shorts_source_volume_valid check(source_volume_percent between 0 and 150),
  constraint youtube_shorts_duck_volume_valid check(source_duck_percent between 0 and 100)
);

insert into youtube_shorts_settings(id) values(true) on conflict(id) do nothing;

create table if not exists youtube_short_jobs(
  id uuid primary key default gen_random_uuid(),
  youtube_library_id uuid not null references youtube_videos(id) on delete restrict,
  youtube_video_id text not null,
  broadcast_item_id uuid references broadcast_items(id) on delete set null,
  ai_host_session_id uuid references ai_host_sessions(id) on delete set null,
  ai_staff_turn_id uuid references ai_staff_turns(id) on delete set null,
  status text not null default 'queued',
  progress int not null default 0,
  production_date date not null,
  source_title text not null,
  source_channel text not null,
  source_url text not null,
  commentary_headline text not null,
  commentary_text text not null,
  commentary_model text not null,
  transcript_excerpt text not null,
  clip_start_seconds double precision not null default 0,
  clip_duration_seconds int not null default 90,
  output_path text,
  thumbnail_path text,
  youtube_upload_id text,
  youtube_upload_url text,
  upload_privacy text,
  attempts int not null default 0,
  error text,
  next_attempt_at timestamptz not null default now(),
  locked_at timestamptz,
  locked_by text,
  started_at timestamptz,
  completed_at timestamptz,
  uploaded_at timestamptz,
  metadata jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint youtube_short_jobs_status_valid check(status in (
    'queued','downloading','rendering','ready','upload-queued','uploading','uploaded','failed','cancelled'
  )),
  constraint youtube_short_jobs_progress_valid check(progress between 0 and 100),
  constraint youtube_short_jobs_duration_valid check(clip_duration_seconds=90),
  constraint youtube_short_jobs_one_per_video unique(youtube_video_id)
);

create index if not exists idx_youtube_short_jobs_queue
  on youtube_short_jobs(status,created_at)
  where status in ('queued','upload-queued','ready');

create index if not exists idx_youtube_short_jobs_daily
  on youtube_short_jobs(production_date,status,created_at desc);
