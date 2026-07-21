-- Bereits wegen temporärer YouTube-Bot-/Rate-Limits aufgegebene Transkripte
-- dürfen nach der Installation des authentifizierten yt-dlp-Ablaufs erneut
-- vorbereitet werden.
update youtube_videos
set transcript_status='error',
    transcript_fetched_at=now()-interval '20 minutes',
    updated_at=now()
where transcript_status='unavailable'
  and coalesce(transcript_error,'') ~* '(HTTP 429|JavaScript runtime|not a bot|sign in|bestätigen.*bot)';

-- Die OBS-Browserquelle meldet die echte YouTube-Abspielposition. AVA kann
-- dadurch an redaktionell festgelegten Stellen statt nach bloßer Wanduhrzeit
-- unterbrechen.
alter table youtube_context_playback_controls
  add column if not exists media_position_ms bigint not null default 0,
  add column if not exists media_duration_ms bigint,
  add column if not exists player_state int,
  add column if not exists last_progress_at timestamptz;

-- Stimmen- und Avatar-Medien gehören zum Agenten und nicht zu einer einzelnen
-- Sendung. Binärdateien bleiben im geschützten Medienverzeichnis; die DB hält
-- Identität, Zustand, Prüfsumme und alle für die Auslieferung nötigen Metadaten.
create table if not exists ai_presenter_profiles(
  staff_member_id text primary key references ai_staff_members(id) on delete cascade,
  tts_voice text not null default '',
  updated_at timestamptz not null default now()
);

create table if not exists ai_presenter_media(
  id uuid primary key default gen_random_uuid(),
  staff_member_id text not null references ai_staff_members(id) on delete cascade,
  state text not null,
  original_filename text not null,
  original_path text not null,
  rendered_path text not null,
  thumbnail_path text,
  mime_type text not null default 'video/webm',
  sha256 text not null,
  width int,
  height int,
  duration_seconds double precision,
  green_screen boolean not null default true,
  managed boolean not null default true,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint ai_presenter_media_state_valid check(state in ('idle','speaking')),
  constraint ai_presenter_media_unique_state unique(staff_member_id,state)
);

create index if not exists idx_ai_presenter_media_staff
  on ai_presenter_media(staff_member_id,state);

insert into ai_presenter_profiles(staff_member_id,tts_voice)
values
  ('moderator','lola'),
  ('chat-moderator','anna')
on conflict(staff_member_id) do nothing;

-- Die bereits produktiv verwendeten Dateien werden als initiale, nicht durch
-- Uploads verwaltete Medien registriert. Ein späterer Austausch löscht sie
-- deshalb nicht versehentlich vom Datenträger.
insert into ai_presenter_media(
  staff_member_id,state,original_filename,original_path,rendered_path,mime_type,sha256,green_screen,managed
)
values
  ('moderator','idle','AVA_schaut.mp4','./var/media/ai-host/youtube-context-idle.webm','./var/media/ai-host/youtube-context-idle.webm','video/webm','bundled-ava-idle-v2',true,false),
  ('moderator','speaking','AVA_spricht.mp4','./var/media/ai-host/youtube-context-speaking.webm','./var/media/ai-host/youtube-context-speaking.webm','video/webm','bundled-ava-speaking-v2',true,false),
  ('chat-moderator','speaking','mod2.mp4','./var/media/ai-host/youtube-context-chat-moderator.webm','./var/media/ai-host/youtube-context-chat-moderator.webm','video/webm','bundled-mia-speaking-v2',true,false)
on conflict(staff_member_id,state) do nothing;
