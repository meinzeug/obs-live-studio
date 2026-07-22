-- Durable, operator-triggered switches between complete broadcasts or individual rundown items.
-- The active runner consumes a normal stop command first; the external runner then starts the
-- selected target. Keeping this intent in PostgreSQL makes the handover survive process restarts.

create table if not exists broadcast_show_switches(
  id uuid primary key default gen_random_uuid(),
  source_run_id uuid references broadcast_runs(id) on delete set null,
  source_playlist_id uuid references broadcast_playlists(id) on delete set null,
  target_playlist_id uuid not null references broadcast_playlists(id) on delete cascade,
  target_item_id uuid references broadcast_items(id) on delete set null,
  target_run_id uuid references broadcast_runs(id) on delete set null,
  stop_command_id uuid references broadcast_commands(id) on delete set null,
  requested_by_user_id uuid references users(id) on delete set null,
  requested_by_scope text not null,
  idempotency_key text,
  transition text not null default 'fade'
    check (transition in ('cut','fade','swipe','slide','luma_wipe')),
  transition_duration_ms integer not null default 650
    check (transition_duration_ms between 0 and 5000),
  suppress_program_intro boolean not null default true,
  status text not null default 'pending'
    check (status in ('pending','stopping','starting','completed','failed','cancelled')),
  claimed_by text,
  claimed_at timestamptz,
  started_at timestamptz,
  completed_at timestamptz,
  failed_at timestamptz,
  error_details jsonb,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create unique index if not exists idx_broadcast_show_switch_idempotency
  on broadcast_show_switches(requested_by_scope,idempotency_key)
  where idempotency_key is not null;

create unique index if not exists idx_single_active_broadcast_show_switch
  on broadcast_show_switches((true))
  where status in ('pending','stopping','starting');

create index if not exists idx_broadcast_show_switch_claimable
  on broadcast_show_switches(status,created_at)
  where status in ('pending','stopping','starting');
