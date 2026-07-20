alter table live_studio_settings
  add column if not exists reaction_enabled boolean not null default false,
  add column if not exists reaction_previous_layout text not null default 'grid',
  add column if not exists reaction_previous_auto_layout boolean not null default true,
  add column if not exists reaction_youtube_source_id text,
  add column if not exists reaction_camera_source_ids jsonb not null default '[]'::jsonb,
  add column if not exists reaction_position text not null default 'right',
  add column if not exists reaction_size_percent integer not null default 28,
  add column if not exists reaction_gap integer not null default 24,
  add column if not exists reaction_style text not null default 'neon',
  add column if not exists reaction_animation text not null default 'slide',
  add column if not exists reaction_title text not null default 'LIVE REACTION',
  add column if not exists reaction_accent_color text not null default '#d20a2e';

update live_studio_settings
set reaction_camera_source_ids='[]'::jsonb
where jsonb_typeof(reaction_camera_source_ids) is distinct from 'array';

alter table live_studio_settings
  drop constraint if exists live_studio_layout_valid;

alter table live_studio_settings
  add constraint live_studio_layout_valid
  check (layout=any('{fullscreen,split,grid,pip,reaction}'::text[]));

alter table live_studio_settings
  drop constraint if exists live_studio_reaction_previous_layout_valid;

alter table live_studio_settings
  add constraint live_studio_reaction_previous_layout_valid
  check (reaction_previous_layout=any('{fullscreen,split,grid,pip}'::text[]));

alter table live_studio_settings
  drop constraint if exists live_studio_reaction_position_valid;

alter table live_studio_settings
  add constraint live_studio_reaction_position_valid
  check (reaction_position=any('{left,right,top,bottom}'::text[]));

alter table live_studio_settings
  drop constraint if exists live_studio_reaction_size_valid;

alter table live_studio_settings
  add constraint live_studio_reaction_size_valid
  check (reaction_size_percent between 15 and 45);

alter table live_studio_settings
  drop constraint if exists live_studio_reaction_gap_valid;

alter table live_studio_settings
  add constraint live_studio_reaction_gap_valid
  check (reaction_gap between 0 and 80);

alter table live_studio_settings
  drop constraint if exists live_studio_reaction_style_valid;

alter table live_studio_settings
  add constraint live_studio_reaction_style_valid
  check (reaction_style=any('{neon,news,glass,clean}'::text[]));

alter table live_studio_settings
  drop constraint if exists live_studio_reaction_animation_valid;

alter table live_studio_settings
  add constraint live_studio_reaction_animation_valid
  check (reaction_animation=any('{fade,slide,pop,pulse}'::text[]));

alter table live_studio_settings
  drop constraint if exists live_studio_reaction_accent_color_valid;

alter table live_studio_settings
  add constraint live_studio_reaction_accent_color_valid
  check (reaction_accent_color ~ '^#[0-9a-fA-F]{6}$');
