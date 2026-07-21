-- Standardmäßig werden fertige TikTok-Clips ohne Developer-App an den offiziellen
-- TikTok-Web-Uploader übergeben. Direct Post bleibt als optionaler API-Modus erhalten.
alter table tiktok_shorts_settings
  add column if not exists publishing_mode text not null default 'manual';

alter table tiktok_shorts_settings
  drop constraint if exists tiktok_shorts_publishing_mode_valid;
alter table tiktok_shorts_settings
  add constraint tiktok_shorts_publishing_mode_valid
  check(publishing_mode in ('manual','api'));

alter table tiktok_short_jobs
  add column if not exists handoff_at timestamptz,
  add column if not exists handoff_count int not null default 0,
  add column if not exists manual_published_at timestamptz,
  add column if not exists manual_post_url text;

alter table tiktok_short_jobs
  drop constraint if exists tiktok_short_jobs_status_valid;
alter table tiktok_short_jobs
  add constraint tiktok_short_jobs_status_valid check(status in (
    'queued','rendering','ready','handed-off','upload-queued','uploading','processing','published','failed','cancelled'
  ));

alter table tiktok_short_jobs
  drop constraint if exists tiktok_short_jobs_handoff_count_valid;
alter table tiktok_short_jobs
  add constraint tiktok_short_jobs_handoff_count_valid check(handoff_count>=0);
