create table if not exists live_studio_settings(
  id boolean primary key default true,
  enabled boolean not null default false,
  layout text not null default 'grid',
  program_source_id text,
  preview_source_id text,
  overlay_project_id uuid references overlay_projects(id) on delete set null,
  updated_at timestamptz not null default now(),
  constraint live_studio_settings_singleton check (id),
  constraint live_studio_layout_valid check (layout=any('{fullscreen,split,grid,pip}'::text[]))
);

insert into live_studio_settings(id)
values(true)
on conflict(id) do nothing;

create table if not exists live_studio_sources(
  source_id text primary key,
  input_name text not null,
  display_name text not null,
  user_name text,
  viewer_url text,
  muted boolean not null default false,
  hidden boolean not null default false,
  slot_index int not null default 0,
  in_program boolean not null default false,
  last_portal_state jsonb not null default '{}'::jsonb,
  added_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create index if not exists idx_live_studio_sources_slot on live_studio_sources(slot_index,source_id);
