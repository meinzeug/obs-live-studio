-- Automatische Shorts sollen nicht als dichter Block entstehen. Der Abstand
-- wird pro Zielplattform ausgewertet; bewusst manuell ausgelöste Produktionen
-- bleiben weiterhin möglich.
alter table youtube_shorts_settings
  add column if not exists minimum_interval_hours double precision not null default 3
    check(minimum_interval_hours between 0 and 24);

alter table tiktok_shorts_settings
  add column if not exists minimum_interval_hours double precision not null default 3
    check(minimum_interval_hours between 0 and 24);

create index if not exists idx_youtube_short_jobs_created_active
  on youtube_short_jobs(created_at desc)
  where status<>'cancelled';

create index if not exists idx_tiktok_short_jobs_created_active
  on tiktok_short_jobs(created_at desc)
  where status<>'cancelled';
