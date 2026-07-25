alter table live_studio_settings
  add column if not exists reaction_mode text not null default 'camera',
  add column if not exists reaction_youtube_library_id uuid references youtube_videos(id) on delete set null,
  add column if not exists reaction_ava_intensity text not null default 'balanced',
  add column if not exists reaction_chat_enabled boolean not null default true;

alter table live_studio_settings
  drop constraint if exists live_studio_reaction_mode_valid;

alter table live_studio_settings
  add constraint live_studio_reaction_mode_valid
  check (reaction_mode=any('{camera,ava}'::text[]));

alter table live_studio_settings
  drop constraint if exists live_studio_reaction_ava_intensity_valid;

alter table live_studio_settings
  add constraint live_studio_reaction_ava_intensity_valid
  check (reaction_ava_intensity=any('{calm,balanced,intensive}'::text[]));
