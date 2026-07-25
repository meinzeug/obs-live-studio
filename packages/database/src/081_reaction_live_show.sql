alter table live_studio_settings
  drop constraint if exists live_studio_reaction_mode_valid;

alter table live_studio_settings
  add constraint live_studio_reaction_mode_valid
  check (reaction_mode=any('{camera,ava,live}'::text[]));
