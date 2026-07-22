alter table youtube_video_editor_sources
  drop constraint if exists youtube_video_editor_source_media_type_valid;
alter table youtube_video_editor_sources
  add constraint youtube_video_editor_source_media_type_valid
  check(media_type in ('video','audio','image'));

alter table youtube_video_editor_sources
  add column if not exists download_progress int not null default 0,
  add column if not exists download_quality text not null default 'best',
  add column if not exists download_mode text not null default 'video',
  add column if not exists downloaded_size_bytes bigint,
  add column if not exists download_metadata jsonb not null default '{}'::jsonb,
  add column if not exists download_attempts int not null default 0,
  add column if not exists download_locked_by text,
  add column if not exists download_locked_at timestamptz;

alter table youtube_video_editor_sources
  drop constraint if exists youtube_video_editor_source_status_valid;
alter table youtube_video_editor_sources
  add constraint youtube_video_editor_source_status_valid
  check(status in ('remote','queued','downloading','ready','error'));
alter table youtube_video_editor_sources
  drop constraint if exists youtube_video_editor_download_progress_valid;
alter table youtube_video_editor_sources
  add constraint youtube_video_editor_download_progress_valid check(download_progress between 0 and 100);
alter table youtube_video_editor_sources
  drop constraint if exists youtube_video_editor_download_quality_valid;
alter table youtube_video_editor_sources
  add constraint youtube_video_editor_download_quality_valid
  check(download_quality in ('best','720p','1080p','1440p','audio'));
alter table youtube_video_editor_sources
  drop constraint if exists youtube_video_editor_download_mode_valid;
alter table youtube_video_editor_sources
  add constraint youtube_video_editor_download_mode_valid check(download_mode in ('video','audio'));

create index if not exists idx_youtube_video_editor_source_download_claim
  on youtube_video_editor_sources(status,created_at)
  where status='queued' and source_kind in ('youtube-url','youtube-library');

alter table youtube_video_editor_projects
  alter column document set default
  '{"version":1,"canvas":{"aspectRatio":"16:9","backgroundColor":"#050810","fps":30},"clips":[],"audioTracks":[],"textTracks":[],"imageTracks":[]}'::jsonb;
