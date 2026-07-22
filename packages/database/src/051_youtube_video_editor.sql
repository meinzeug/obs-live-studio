create table if not exists youtube_video_editor_projects(
  id uuid primary key default gen_random_uuid(),
  name text not null,
  description text,
  document jsonb not null default '{"version":1,"canvas":{"aspectRatio":"16:9","backgroundColor":"#050810","fps":30},"clips":[],"audioTracks":[],"textTracks":[],"imageTracks":[]}'::jsonb,
  revision int not null default 1,
  status text not null default 'draft',
  duration_seconds numeric(12,3) not null default 0,
  last_error text,
  created_by uuid references users(id) on delete set null,
  deleted_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint youtube_video_editor_project_status_valid
    check(status in ('draft','queued','rendering','ready','failed')),
  constraint youtube_video_editor_project_document_valid
    check(jsonb_typeof(document)='object' and document->>'version'='1')
);

create table if not exists youtube_video_editor_sources(
  id uuid primary key default gen_random_uuid(),
  project_id uuid not null references youtube_video_editor_projects(id) on delete cascade,
  source_kind text not null,
  youtube_library_id uuid references youtube_videos(id) on delete set null,
  media_asset_id uuid references media_assets(id) on delete set null,
  youtube_video_id text,
  source_url text,
  title text not null,
  channel_title text,
  media_type text not null default 'video',
  duration_seconds numeric(12,3) not null,
  preview_url text,
  local_path text,
  status text not null default 'ready',
  error text,
  download_progress int not null default 0,
  download_quality text not null default 'best',
  download_mode text not null default 'video',
  downloaded_size_bytes bigint,
  download_metadata jsonb not null default '{}'::jsonb,
  download_attempts int not null default 0,
  download_locked_by text,
  download_locked_at timestamptz,
  sort_order int not null default 0,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint youtube_video_editor_source_kind_valid
    check(source_kind in ('youtube-url','youtube-library','media')),
  constraint youtube_video_editor_source_media_type_valid
    check(media_type in ('video','audio','image')),
  constraint youtube_video_editor_source_status_valid
    check(status in ('remote','queued','downloading','ready','error')),
  constraint youtube_video_editor_download_progress_valid check(download_progress between 0 and 100),
  constraint youtube_video_editor_download_quality_valid check(download_quality in ('best','720p','1080p','1440p','audio')),
  constraint youtube_video_editor_download_mode_valid check(download_mode in ('video','audio')),
  constraint youtube_video_editor_source_origin_valid check(
    (source_kind in ('youtube-url','youtube-library') and youtube_video_id is not null and source_url is not null)
    or
    (source_kind='media' and media_asset_id is not null and local_path is not null)
  )
);

create unique index if not exists idx_youtube_video_editor_source_youtube_unique
  on youtube_video_editor_sources(project_id,youtube_video_id)
  where youtube_video_id is not null;
create unique index if not exists idx_youtube_video_editor_source_media_unique
  on youtube_video_editor_sources(project_id,media_asset_id)
  where media_asset_id is not null;
create index if not exists idx_youtube_video_editor_sources_project
  on youtube_video_editor_sources(project_id,sort_order,created_at);
create index if not exists idx_youtube_video_editor_source_download_claim
  on youtube_video_editor_sources(status,created_at)
  where status='queued' and source_kind in ('youtube-url','youtube-library');

create table if not exists youtube_video_editor_renders(
  id uuid primary key default gen_random_uuid(),
  project_id uuid not null references youtube_video_editor_projects(id) on delete cascade,
  project_revision int not null,
  quality text not null,
  status text not null default 'queued',
  progress int not null default 0,
  document_snapshot jsonb not null,
  output_path text,
  thumbnail_path text,
  media_asset_id uuid references media_assets(id) on delete set null,
  size_bytes bigint,
  duration_seconds numeric(12,3),
  width int,
  height int,
  error text,
  attempts int not null default 0,
  next_attempt_at timestamptz not null default now(),
  locked_by text,
  locked_at timestamptz,
  started_at timestamptz,
  completed_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint youtube_video_editor_render_quality_valid
    check(quality in ('720p','1080p','1440p')),
  constraint youtube_video_editor_render_status_valid
    check(status in ('queued','rendering','ready','failed','cancelled')),
  constraint youtube_video_editor_render_progress_valid check(progress between 0 and 100)
);

create index if not exists idx_youtube_video_editor_render_claim
  on youtube_video_editor_renders(status,next_attempt_at,created_at)
  where status='queued';
create index if not exists idx_youtube_video_editor_render_project
  on youtube_video_editor_renders(project_id,created_at desc);
