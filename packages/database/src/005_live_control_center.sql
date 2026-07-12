alter table overlay_projects add column if not exists public_live_id text;
alter table overlay_projects add column if not exists public_url text;
alter table overlay_projects add column if not exists obs_input_name text;
alter table overlay_projects add column if not exists obs_scene_name text;
alter table overlay_projects add column if not exists obs_configured_version_id uuid;
alter table overlay_projects add column if not exists obs_configured_url text;
alter table overlay_projects add column if not exists obs_configured_at timestamptz;
alter table overlay_projects add column if not exists obs_width integer;
alter table overlay_projects add column if not exists obs_height integer;
create unique index if not exists idx_overlay_public_live_id on overlay_projects(public_live_id) where public_live_id is not null;

create table if not exists live_events(
  id bigserial primary key,
  type text not null,
  created_at timestamptz not null default now(),
  broadcast_run_id uuid references broadcast_runs(id),
  article_id uuid references articles(id),
  overlay_version_id uuid references overlay_versions(id),
  dedupe_key text,
  payload jsonb not null default '{}'
);
create unique index if not exists idx_live_events_dedupe on live_events(dedupe_key) where dedupe_key is not null;
create index if not exists idx_live_events_created on live_events(created_at desc);
create index if not exists idx_live_events_run on live_events(broadcast_run_id,id);

create table if not exists obs_overlay_sources(
  project_id uuid primary key references overlay_projects(id) on delete cascade,
  scene_name text not null,
  input_name text not null,
  url text not null,
  version_id uuid references overlay_versions(id),
  width integer not null,
  height integer not null,
  configured_at timestamptz not null default now(),
  status text not null default 'configured',
  last_error text
);

alter table media_assets add column if not exists deleted_at timestamptz;
alter table media_assets add column if not exists archived_at timestamptz;
alter table media_assets add column if not exists license_status text not null default 'unknown';

create table if not exists broadcast_commands(
  id uuid primary key default gen_random_uuid(),
  broadcast_run_id uuid not null references broadcast_runs(id) on delete cascade,
  playlist_id uuid references broadcast_playlists(id) on delete set null,
  command text not null check (command in ('pause','resume','skip','stop')),
  sequence bigint not null,
  status text not null default 'pending' check (status in ('pending','claimed','completed','rejected')),
  idempotency_key text,
  runner_id text,
  claimed_at timestamptz,
  completed_at timestamptz,
  rejected_at timestamptz,
  error_details jsonb,
  completed_state_revision bigint,
  created_at timestamptz not null default now(),
  unique(broadcast_run_id, sequence),
  unique(broadcast_run_id, idempotency_key)
);

create table if not exists broadcast_runner_leases(
  broadcast_run_id uuid primary key references broadcast_runs(id) on delete cascade,
  runner_id text not null,
  heartbeat_at timestamptz not null default now(),
  lease_expires_at timestamptz not null,
  acquired_at timestamptz not null default now(),
  last_state_revision bigint not null default 0
);

alter table playback_state add column if not exists command_sequence bigint not null default 0;
alter table playback_state add column if not exists state_revision bigint not null default 0;
alter table playback_state add column if not exists media_position_ms bigint;
alter table playback_state add column if not exists media_duration_ms bigint;
alter table playback_state add column if not exists obs_confirmed_position_ms bigint;
alter table playback_state add column if not exists recovery_mode text;
alter table playback_state add column if not exists obs_media_status text;
alter table playback_state add column if not exists last_obs_sync_at timestamptz;

create or replace function claim_broadcast_command(p_run_id uuid, p_runner_id text, p_lease_seconds integer default 15)
returns broadcast_commands
language plpgsql
as $$
declare
  v_cmd broadcast_commands;
  v_now timestamptz := now();
begin
  insert into broadcast_runner_leases(broadcast_run_id, runner_id, heartbeat_at, lease_expires_at)
  values(p_run_id, p_runner_id, v_now, v_now + make_interval(secs => p_lease_seconds))
  on conflict (broadcast_run_id) do update set
    runner_id = case when broadcast_runner_leases.lease_expires_at < v_now or broadcast_runner_leases.runner_id = p_runner_id then p_runner_id else broadcast_runner_leases.runner_id end,
    heartbeat_at = case when broadcast_runner_leases.lease_expires_at < v_now or broadcast_runner_leases.runner_id = p_runner_id then v_now else broadcast_runner_leases.heartbeat_at end,
    lease_expires_at = case when broadcast_runner_leases.lease_expires_at < v_now or broadcast_runner_leases.runner_id = p_runner_id then v_now + make_interval(secs => p_lease_seconds) else broadcast_runner_leases.lease_expires_at end;

  if not exists(select 1 from broadcast_runner_leases where broadcast_run_id=p_run_id and runner_id=p_runner_id and lease_expires_at >= v_now) then
    raise exception 'broadcast run % is leased by another runner', p_run_id using errcode = '55P03';
  end if;

  update broadcast_commands set status='claimed', runner_id=p_runner_id, claimed_at=v_now
  where id = (
    select id from broadcast_commands
    where broadcast_run_id=p_run_id and status='pending'
    order by sequence asc
    for update skip locked
    limit 1
  ) returning * into v_cmd;
  return v_cmd;
end;
$$;

alter table broadcast_commands add column if not exists expected_revision bigint;
alter table broadcast_commands add column if not exists expected_status text;
alter table broadcast_commands add column if not exists target_status text;
alter table broadcast_commands add column if not exists command_fingerprint text;
alter table broadcast_commands add column if not exists lease_generation bigint;
alter table broadcast_commands add column if not exists executing_at timestamptz;
alter table broadcast_commands add column if not exists failed_at timestamptz;
alter table broadcast_commands add column if not exists expired_at timestamptz;
alter table broadcast_commands add column if not exists error_code text;
alter table broadcast_commands drop constraint if exists broadcast_commands_status_check;
alter table broadcast_commands add constraint broadcast_commands_status_check check (status in ('pending','claimed','executing','completed','rejected','failed','expired'));
create unique index if not exists idx_broadcast_command_idempotency on broadcast_commands(broadcast_run_id,idempotency_key) where idempotency_key is not null;
create index if not exists idx_broadcast_commands_claimable on broadcast_commands(broadcast_run_id,sequence) where status='pending';

alter table broadcast_runner_leases add column if not exists lease_generation bigint not null default 1;
alter table playback_state add column if not exists recovery_reason text;

create or replace function claim_broadcast_command(p_run_id uuid, p_runner_id text, p_lease_seconds integer default 15, p_lease_generation bigint default null)
returns broadcast_commands
language plpgsql
as $$
declare
  v_cmd broadcast_commands;
  v_now timestamptz := now();
  v_generation bigint;
begin
  select lease_generation into v_generation from broadcast_runner_leases where broadcast_run_id=p_run_id for update;
  if v_generation is null then
    insert into broadcast_runner_leases(broadcast_run_id, runner_id, heartbeat_at, lease_expires_at, lease_generation)
    values(p_run_id, p_runner_id, v_now, v_now + make_interval(secs => p_lease_seconds), 1)
    on conflict (broadcast_run_id) do nothing;
    v_generation := 1;
  end if;

  update broadcast_runner_leases set
    runner_id = case when lease_expires_at < v_now or runner_id = p_runner_id then p_runner_id else runner_id end,
    heartbeat_at = case when lease_expires_at < v_now or runner_id = p_runner_id then v_now else heartbeat_at end,
    lease_expires_at = case when lease_expires_at < v_now or runner_id = p_runner_id then v_now + make_interval(secs => p_lease_seconds) else lease_expires_at end,
    lease_generation = case when lease_expires_at < v_now and runner_id <> p_runner_id then lease_generation + 1 else lease_generation end
  where broadcast_run_id=p_run_id
  returning lease_generation into v_generation;

  if not exists(select 1 from broadcast_runner_leases where broadcast_run_id=p_run_id and runner_id=p_runner_id and lease_generation=coalesce(p_lease_generation, v_generation) and lease_expires_at >= v_now) then
    raise exception 'broadcast run % is leased by another runner', p_run_id using errcode = '55P03';
  end if;

  update broadcast_commands set status='expired', expired_at=v_now, error_code='lease_expired', error_details=jsonb_build_object('reason','claimed command recovered after lease expiry')
  where broadcast_run_id=p_run_id and status='claimed' and claimed_at < v_now - make_interval(secs => p_lease_seconds);

  update broadcast_commands set status='claimed', runner_id=p_runner_id, lease_generation=coalesce(p_lease_generation, v_generation), claimed_at=v_now
  where id = (
    select id from broadcast_commands
    where broadcast_run_id=p_run_id and status='pending'
    order by sequence asc
    for update skip locked
    limit 1
  ) returning * into v_cmd;
  return v_cmd;
end;
$$;

create table if not exists broadcast_recovery_operations(
  id uuid primary key default gen_random_uuid(),
  broadcast_run_id uuid not null references broadcast_runs(id) on delete cascade,
  requested_by text,
  reason text not null,
  status text not null default 'pending' check (status in ('pending','claimed','completed','failed')),
  previous_runner_id text,
  previous_lease_generation bigint,
  new_runner_id text,
  created_at timestamptz not null default now(),
  claimed_at timestamptz,
  completed_at timestamptz,
  error_details jsonb
);
create index if not exists idx_broadcast_recovery_pending on broadcast_recovery_operations(status,created_at);
