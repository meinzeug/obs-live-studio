-- Harden the canonical broadcast start path.
-- Keep this migration additive/idempotent so existing development databases can adopt it safely.

drop index if exists idx_single_active_broadcast_run;
create unique index if not exists idx_single_active_broadcast_run
  on broadcast_runs((true))
  where status in ('starting','running','paused','stopping','recovering');

alter table broadcast_recovery_operations add column if not exists request_fingerprint text;
alter table broadcast_recovery_operations add column if not exists ready_at timestamptz;
alter table broadcast_recovery_operations add column if not exists playlist_id uuid references broadcast_playlists(id) on delete set null;
alter table broadcast_recovery_operations add column if not exists recovery_mode text;
alter table broadcast_recovery_operations add column if not exists initial_state_revision bigint;
alter table broadcast_recovery_operations add column if not exists obs_connection_status text;

alter table broadcast_recovery_operations drop constraint if exists broadcast_recovery_operations_operation_type_check;
alter table broadcast_recovery_operations add constraint broadcast_recovery_operations_operation_type_check
  check (operation_type in ('start','recover','takeover','reconcile-command'));

-- replaced by 007_user_scoped_broadcast_start.sql
