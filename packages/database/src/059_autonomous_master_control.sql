-- Continuous master-control supervision for the autonomous studio. Creative changes still pass
-- through council quorum and two independent reviews; known, reversible operational repairs may
-- execute directly inside the already approved Autopilot policy.

alter table autonomous_studio_settings
  add column if not exists operations_enabled boolean not null default true,
  add column if not exists automatic_operational_actions boolean not null default true,
  add column if not exists operations_interval_seconds integer not null default 60,
  add column if not exists schedule_horizon_hours integer not null default 24,
  add column if not exists minimum_upcoming_shows integer not null default 6,
  add column if not exists minimum_schedule_minutes integer not null default 1200,
  add column if not exists last_operations_cycle_at timestamptz,
  add column if not exists next_operations_cycle_at timestamptz not null default now();

alter table autonomous_studio_settings
  drop constraint if exists autonomous_studio_operations_interval_valid;
alter table autonomous_studio_settings
  add constraint autonomous_studio_operations_interval_valid
  check(operations_interval_seconds between 30 and 3600);
alter table autonomous_studio_settings
  drop constraint if exists autonomous_studio_schedule_horizon_valid;
alter table autonomous_studio_settings
  add constraint autonomous_studio_schedule_horizon_valid
  check(schedule_horizon_hours between 1 and 168);
alter table autonomous_studio_settings
  drop constraint if exists autonomous_studio_minimum_shows_valid;
alter table autonomous_studio_settings
  add constraint autonomous_studio_minimum_shows_valid
  check(minimum_upcoming_shows between 1 and 192);
alter table autonomous_studio_settings
  drop constraint if exists autonomous_studio_minimum_schedule_minutes_valid;
alter table autonomous_studio_settings
  add constraint autonomous_studio_minimum_schedule_minutes_valid
  check(minimum_schedule_minutes between 30 and 10080);

-- Existing installations used a daily strategy meeting. Six-hour editorial reviews plus a
-- minute-level deterministic operations loop are responsive without wasting paid LLM budget.
update autonomous_studio_settings
set cycle_interval_hours=6,
    next_cycle_at=least(next_cycle_at,now()),
    next_operations_cycle_at=least(next_operations_cycle_at,now()),
    updated_at=now()
where cycle_interval_hours=24;

create table if not exists autonomous_studio_operations_cycles(
  id uuid primary key default gen_random_uuid(),
  worker_id text not null,
  trigger text not null default 'timer',
  status text not null default 'running',
  snapshot_before jsonb not null default '{}'::jsonb,
  findings jsonb not null default '[]'::jsonb,
  actions jsonb not null default '[]'::jsonb,
  verification jsonb not null default '{}'::jsonb,
  error text,
  started_at timestamptz not null default now(),
  completed_at timestamptz,
  updated_at timestamptz not null default now(),
  constraint autonomous_operations_trigger_valid check(trigger in ('timer','startup','manual','recovery')),
  constraint autonomous_operations_status_valid check(status in ('running','healthy','repaired','degraded','failed')),
  constraint autonomous_operations_findings_array check(jsonb_typeof(findings)='array'),
  constraint autonomous_operations_actions_array check(jsonb_typeof(actions)='array')
);

create unique index if not exists idx_single_running_autonomous_operations_cycle
  on autonomous_studio_operations_cycles((true)) where status='running';
create index if not exists idx_autonomous_operations_cycles_recent
  on autonomous_studio_operations_cycles(started_at desc);
