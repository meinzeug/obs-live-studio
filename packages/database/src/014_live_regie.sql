alter table live_studio_settings
  add column if not exists transition text not null default 'fade',
  add column if not exists transition_duration_ms integer not null default 450,
  add column if not exists chat_url text,
  add column if not exists chat_visible boolean not null default false;

alter table live_studio_settings
  drop constraint if exists live_studio_transition_valid;

alter table live_studio_settings
  add constraint live_studio_transition_valid
  check (transition=any('{cut,fade,swipe,slide,luma_wipe}'::text[]));

alter table live_studio_settings
  drop constraint if exists live_studio_transition_duration_valid;

alter table live_studio_settings
  add constraint live_studio_transition_duration_valid
  check (transition_duration_ms between 0 and 5000);
