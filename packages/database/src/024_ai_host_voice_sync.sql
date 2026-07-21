alter table ai_host_settings
  add column if not exists avatar_voice_sync boolean not null default true;
