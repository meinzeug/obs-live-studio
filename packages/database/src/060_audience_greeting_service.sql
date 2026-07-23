-- Revisionssicherer Grußdienst für echte Plattformereignisse. Namen werden nur
-- gespeichert und gesprochen, wenn die Plattform sie tatsächlich liefert.
alter table ai_host_settings
  add column if not exists greeting_enabled boolean not null default true,
  add column if not exists greeting_presenter_mode text not null default 'alternate',
  add column if not exists greeting_cooldown_seconds int not null default 45,
  add column if not exists greeting_like_step int not null default 3,
  add column if not exists greeting_youtube_memberships boolean not null default true,
  add column if not exists greeting_youtube_subscribers boolean not null default true,
  add column if not exists greeting_youtube_likes boolean not null default true,
  add column if not exists greeting_twitch_subscriptions boolean not null default true,
  add column if not exists greeting_twitch_follows boolean not null default true;

do $$
begin
  if not exists (select 1 from pg_constraint where conname='ai_host_greeting_presenter_mode_valid') then
    alter table ai_host_settings add constraint ai_host_greeting_presenter_mode_valid
      check(greeting_presenter_mode in ('ava','mia','alternate'));
  end if;
  if not exists (select 1 from pg_constraint where conname='ai_host_greeting_cooldown_valid') then
    alter table ai_host_settings add constraint ai_host_greeting_cooldown_valid
      check(greeting_cooldown_seconds between 15 and 900);
  end if;
  if not exists (select 1 from pg_constraint where conname='ai_host_greeting_like_step_valid') then
    alter table ai_host_settings add constraint ai_host_greeting_like_step_valid
      check(greeting_like_step between 1 and 100);
  end if;
end $$;

create table if not exists audience_greeting_events(
  id uuid primary key default gen_random_uuid(),
  provider text not null,
  provider_event_id text not null,
  event_type text not null,
  viewer_id text,
  viewer_name text,
  quantity int not null default 1,
  named boolean not null default false,
  status text not null default 'pending',
  session_id uuid references ai_host_sessions(id) on delete set null,
  turn_id uuid references ai_staff_turns(id) on delete set null,
  metadata jsonb not null default '{}',
  attempts int not null default 0,
  error text,
  occurred_at timestamptz not null,
  claimed_at timestamptz,
  greeted_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique(provider,provider_event_id),
  constraint audience_greeting_provider_valid check(provider in ('youtube','twitch','studio')),
  constraint audience_greeting_type_valid check(event_type in (
    'youtube-membership','youtube-subscription','youtube-like',
    'twitch-subscription','twitch-follow','studio-test'
  )),
  constraint audience_greeting_status_valid check(status in ('pending','claimed','scheduled','ignored','failed')),
  constraint audience_greeting_quantity_valid check(quantity between 1 and 100000)
);

create index if not exists idx_audience_greeting_events_queue
  on audience_greeting_events(status,occurred_at,created_at)
  where status in ('pending','claimed');
create index if not exists idx_audience_greeting_events_recent
  on audience_greeting_events(created_at desc);

create table if not exists audience_greeting_provider_state(
  provider_key text primary key,
  state jsonb not null default '{}',
  last_success_at timestamptz,
  retry_at timestamptz,
  error text,
  updated_at timestamptz not null default now()
);

alter table ai_staff_turns drop constraint if exists ai_staff_turn_kind_valid;
alter table ai_staff_turns add constraint ai_staff_turn_kind_valid
  check(kind in ('intro','context','question','chat-response','chat-commentary','greeting','cta','fallback'));

