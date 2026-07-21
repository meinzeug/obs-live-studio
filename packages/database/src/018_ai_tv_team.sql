create table if not exists ai_staff_members(
  id text primary key,
  display_name text not null,
  job_title text not null,
  role text not null,
  description text not null,
  enabled boolean not null default true,
  autonomy text not null default 'auto',
  avatar_style text not null default 'studio',
  accent_color text not null default '#22d3ee',
  instructions text not null default '',
  config jsonb not null default '{}',
  updated_at timestamptz not null default now(),
  constraint ai_staff_autonomy_valid check(autonomy in ('suggest','review','auto'))
);

insert into ai_staff_members(id,display_name,job_title,role,description,autonomy,avatar_style,accent_color,instructions)
values
  ('editor','Mara','KI-Redakteurin','editor','Bereitet Videos quellennah auf und trennt Inhalt, Kontext und offene Fragen.','auto','editorial','#38bdf8','Nicht bewerten, keine Fakten erfinden und klar zwischen Videobehauptung und gesichertem Kontext unterscheiden.'),
  ('fact-checker','Viktor','Faktenprüfer','fact-checker','Prüft Behauptungen, Unsicherheiten und Formulierungsrisiken vor der Ausstrahlung.','auto','analyst','#f59e0b','Unsicherheiten konkret benennen. Keine pauschalen Warnhinweise und keine unbelegten Gegenbehauptungen.'),
  ('producer','Nova','KI-Producerin','producer','Steuert Dramaturgie, Einblendungszeitpunkte, Wiederholungsabstand und Fallbacks.','auto','producer','#a78bfa','Sendefluss schützen, Einblendungen kurz halten und Zuschauer nicht mit Hinweisen überlasten.'),
  ('moderator','Ava','Avatar-Moderatorin','moderator','Ordnet YouTube-Videos ein, stellt kritische offene Fragen und antwortet im Overlay auf Chat-Themen.','auto','host','#fb7185','Sachlich, neugierig und respektvoll moderieren. Keine Zuschauer angreifen, keine Parteinahme und keine erfundenen Zitate.'),
  ('chat-analyst','Sam','Chat-Analyst','chat-analyst','Bündelt wiederkehrende Argumente aus dem Livechat und schützt personenbezogene Inhalte.','auto','analyst','#34d399','Nur Diskussionsmuster zusammenfassen. Beleidigungen, personenbezogene Daten, Spam und Einzelangriffe nicht verstärken.')
on conflict(id) do nothing;

create table if not exists ai_host_settings(
  id boolean primary key default true,
  enabled boolean not null default true,
  live_stream_url text,
  live_chat_id text,
  chat_source_mode text not null default 'channel',
  active_moderator_id text not null default 'moderator' references ai_staff_members(id),
  overlay_position text not null default 'bottom-right',
  overlay_scale int not null default 100,
  show_avatar boolean not null default true,
  show_chat boolean not null default true,
  anonymize_authors boolean not null default true,
  voice_enabled boolean not null default true,
  avatar_voice_sync boolean not null default true,
  interaction_mode text not null default 'auto-safe',
  question_interval_seconds int not null default 90,
  response_cooldown_seconds int not null default 75,
  response_duration_seconds int not null default 24,
  max_turns_per_hour int not null default 18,
  max_chat_messages_per_turn int not null default 14,
  minimum_chat_messages int not null default 2,
  participation_prompt text not null default 'Schreib deine Meinung dazu in den Chat.',
  updated_at timestamptz not null default now(),
  constraint ai_host_singleton check(id),
  constraint ai_host_chat_source_mode_valid check(chat_source_mode in ('channel','content')),
  constraint ai_host_position_valid check(overlay_position in ('top-left','top-right','bottom-left','bottom-right')),
  constraint ai_host_interaction_valid check(interaction_mode in ('off','review','auto-safe'))
);

insert into ai_host_settings(id,enabled) values(true,true) on conflict(id) do nothing;

create table if not exists ai_host_sessions(
  id uuid primary key default gen_random_uuid(),
  broadcast_item_id uuid references broadcast_items(id) on delete set null,
  youtube_library_id uuid references youtube_videos(id) on delete set null,
  youtube_video_id text not null,
  video_title text not null,
  channel_title text not null,
  video_url text not null,
  briefing jsonb,
  briefing_model text,
  status text not null default 'preparing',
  phase_index int not null default 0,
  next_phase_at timestamptz,
  last_chat_response_at timestamptz,
  chat_page_token text,
  chat_poll_after timestamptz,
  chat_error text,
  started_at timestamptz not null default now(),
  ended_at timestamptz,
  updated_at timestamptz not null default now(),
  constraint ai_host_session_status_valid check(status in ('preparing','live','paused','ended','error'))
);

create unique index if not exists idx_ai_host_one_open_item
  on ai_host_sessions(broadcast_item_id)
  where ended_at is null and broadcast_item_id is not null;
create index if not exists idx_ai_host_sessions_active on ai_host_sessions(status,started_at desc);

create table if not exists ai_host_chat_messages(
  id uuid primary key default gen_random_uuid(),
  session_id uuid not null references ai_host_sessions(id) on delete cascade,
  provider text not null default 'youtube',
  provider_message_id text not null,
  author_name text not null,
  author_channel_id text,
  message text not null,
  message_type text not null default 'textMessageEvent',
  safe boolean not null default true,
  moderation_reason text,
  used_at timestamptz,
  published_at timestamptz not null,
  received_at timestamptz not null default now(),
  unique(provider,provider_message_id)
);

create index if not exists idx_ai_host_chat_session_unused
  on ai_host_chat_messages(session_id,published_at)
  where used_at is null and safe=true;

create table if not exists ai_staff_turns(
  id uuid primary key default gen_random_uuid(),
  session_id uuid not null references ai_host_sessions(id) on delete cascade,
  staff_member_id text not null references ai_staff_members(id),
  kind text not null,
  headline text not null,
  text text not null,
  cta text,
  chat_theme text,
  chat_excerpt text,
  source_message_ids uuid[] not null default '{}',
  status text not null default 'approved',
  model text,
  audio_path text,
  starts_at timestamptz not null default now(),
  ends_at timestamptz not null,
  created_at timestamptz not null default now(),
  constraint ai_staff_turn_kind_valid check(kind in ('intro','context','question','chat-response','cta','fallback')),
  constraint ai_staff_turn_status_valid check(status in ('pending','approved','live','expired','rejected'))
);

create index if not exists idx_ai_staff_turns_live on ai_staff_turns(session_id,starts_at desc,ends_at desc);
