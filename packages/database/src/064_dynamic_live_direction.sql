-- Ereignisgesteuerte Live-Regie und dauerhaftes Playout-Watchdog.
-- Entscheidungen werden nachvollziehbar protokolliert und überleben Neustarts.

alter table ai_host_sessions
  add column if not exists direction_state jsonb not null default '{}'::jsonb,
  add column if not exists last_direction_at timestamptz,
  add column if not exists next_direction_at timestamptz;

create table if not exists ai_live_direction_events(
  id uuid primary key default gen_random_uuid(),
  session_id uuid not null references ai_host_sessions(id) on delete cascade,
  broadcast_item_id uuid references broadcast_items(id) on delete set null,
  turn_id uuid references ai_staff_turns(id) on delete set null,
  trigger text not null,
  action text not null,
  presenter_id text references ai_staff_members(id) on delete set null,
  display_mode text,
  priority int not null default 50,
  reason text not null,
  signals jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now()
);

create index if not exists idx_ai_live_direction_session
  on ai_live_direction_events(session_id,created_at desc);

create table if not exists master_control_watchdog(
  id boolean primary key default true,
  finding_code text,
  fingerprint text,
  first_detected_at timestamptz,
  last_detected_at timestamptz,
  consecutive_detections int not null default 0,
  last_action text,
  last_action_at timestamptz,
  cooldown_until timestamptz,
  observed_item_id uuid references broadcast_items(id) on delete set null,
  observed_position_ms bigint,
  position_changed_at timestamptz,
  details jsonb not null default '{}'::jsonb,
  updated_at timestamptz not null default now(),
  constraint master_control_watchdog_singleton check(id)
);

insert into master_control_watchdog(id)
values(true)
on conflict(id) do nothing;

update ai_host_sessions
set direction_state=jsonb_build_object(
      'sequence',greatest(0,phase_index),
      'pauseIndex',least(
        greatest(0,phase_index),
        coalesce(jsonb_array_length(briefing->'pauseMoments'),0)
      ),
      'lastAvaAt',coalesce(last_direction_at,started_at),
      'lastMiaAt',coalesce(last_chat_response_at,started_at),
      'closingPrompted',false
    ),
    next_direction_at=coalesce(next_direction_at,next_phase_at,now())
where ended_at is null
  and direction_state='{}'::jsonb;
