alter table overlay_projects add column if not exists public_live_id text;
alter table overlay_projects add column if not exists public_url text;
alter table overlay_projects add column if not exists obs_input_name text;
alter table overlay_projects add column if not exists obs_scene_name text;
alter table overlay_projects add column if not exists obs_configured_version_id uuid;
alter table overlay_projects add column if not exists obs_configured_url text;
alter table overlay_projects add column if not exists obs_configured_at timestamptz;
alter table overlay_projects add column if not exists obs_width integer;
alter table overlay_projects add column if not exists obs_height integer;
create unique index if not exists idx_overlay_public_live_id on overlay_projects(public_live_id) where public_live_id is not null;

create table if not exists live_events(
  id bigserial primary key,
  type text not null,
  created_at timestamptz not null default now(),
  broadcast_run_id uuid references broadcast_runs(id),
  article_id uuid references articles(id),
  overlay_version_id uuid references overlay_versions(id),
  dedupe_key text,
  payload jsonb not null default '{}'
);
create unique index if not exists idx_live_events_dedupe on live_events(dedupe_key) where dedupe_key is not null;
create index if not exists idx_live_events_created on live_events(created_at desc);
create index if not exists idx_live_events_run on live_events(broadcast_run_id,id);

create table if not exists obs_overlay_sources(
  project_id uuid primary key references overlay_projects(id) on delete cascade,
  scene_name text not null,
  input_name text not null,
  url text not null,
  version_id uuid references overlay_versions(id),
  width integer not null,
  height integer not null,
  configured_at timestamptz not null default now(),
  status text not null default 'configured',
  last_error text
);

alter table media_assets add column if not exists deleted_at timestamptz;
alter table media_assets add column if not exists archived_at timestamptz;
alter table media_assets add column if not exists license_status text not null default 'unknown';
