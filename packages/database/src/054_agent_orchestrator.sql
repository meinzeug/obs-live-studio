create table if not exists agent_orchestrator_settings(
  id boolean primary key default true,
  enabled boolean not null default false,
  mode text not null default 'stopped',
  memory_enabled boolean not null default true,
  memory_mode text not null default 'full_text',
  memory_retention_days integer not null default 365,
  max_memories integer not null default 10000,
  max_concurrent_workflows integer not null default 1,
  default_step_timeout_seconds integer not null default 180,
  default_workflow_budget_usd numeric(10,6) not null default 0.25,
  daily_budget_usd numeric(10,6) not null default 1.50,
  safe_broadcast_mode boolean not null default true,
  stopped_reason text,
  stopped_at timestamptz,
  updated_by uuid references users(id) on delete set null,
  updated_at timestamptz not null default now(),
  constraint agent_orchestrator_settings_singleton check(id),
  constraint agent_orchestrator_mode_valid check(mode in ('running','draining','stopped')),
  constraint agent_orchestrator_mode_enabled_consistent check(enabled = (mode <> 'stopped')),
  constraint agent_orchestrator_broadcast_isolation_required check(safe_broadcast_mode),
  constraint agent_orchestrator_memory_mode_valid check(memory_mode in ('full_text','disabled')),
  constraint agent_orchestrator_retention_valid check(memory_retention_days between 7 and 3650),
  constraint agent_orchestrator_memory_limit_valid check(max_memories between 100 and 1000000),
  constraint agent_orchestrator_concurrency_valid check(max_concurrent_workflows between 1 and 4),
  constraint agent_orchestrator_timeout_valid check(default_step_timeout_seconds between 30 and 900),
  constraint agent_orchestrator_workflow_budget_valid check(default_workflow_budget_usd between 0.01 and 25),
  constraint agent_orchestrator_daily_budget_valid check(daily_budget_usd between 0.01 and 1000)
);

insert into agent_orchestrator_settings(id) values(true) on conflict(id) do nothing;

create table if not exists agent_orchestrator_agents(
  id text primary key,
  display_name text not null,
  role_name text not null,
  description text not null,
  instructions text not null,
  enabled boolean not null default true,
  risk_tier text not null default 'medium',
  allowed_capabilities jsonb not null default '[]'::jsonb,
  max_cost_per_run_usd numeric(10,6) not null default 0.15,
  rate_limit_per_hour integer not null default 4,
  updated_by uuid references users(id) on delete set null,
  updated_at timestamptz not null default now(),
  constraint agent_orchestrator_agent_id_valid check(id ~ '^[a-z0-9][a-z0-9-]{2,79}$'),
  constraint agent_orchestrator_agent_name_present check(length(btrim(display_name)) between 1 and 100),
  constraint agent_orchestrator_agent_role_present check(length(btrim(role_name)) between 2 and 160),
  constraint agent_orchestrator_agent_risk_valid check(risk_tier in ('low','medium','high')),
  constraint agent_orchestrator_agent_capabilities_array check(jsonb_typeof(allowed_capabilities)='array'),
  constraint agent_orchestrator_agent_budget_valid check(max_cost_per_run_usd between 0.001 and 25),
  constraint agent_orchestrator_agent_rate_valid check(rate_limit_per_hour between 1 and 120)
);

insert into agent_orchestrator_agents(
  id,display_name,role_name,description,instructions,risk_tier,allowed_capabilities,max_cost_per_run_usd,rate_limit_per_hour
) values
  (
    'self-improvement-engineer','Nora','Self-Improvement-Engineer',
    'Analysiert Wartbarkeit, Fehlerbilder und Verbesserungspotenzial der Software.',
    'Nur Änderungsvorschläge mit Tests, Risiken und Rückrollplan. In Phase 1 niemals Code ausführen, Repository-Dateien verändern, Git bedienen, Secrets lesen oder deployen.',
    'high','["read:studio-metrics","read:guidelines","read:repository-index","propose:code-change","handoff:council"]'::jsonb,0.20,4
  ),
  (
    'growth-analytics','Leo','Growth & Analytics Agent',
    'Bewertet Programmleistung, Vielfalt, Zuschauerbindung und nachvollziehbare Wachstumschancen.',
    'Messwerte, Hypothesen und Empfehlungen trennen. Keine Reichweite erfinden und keine manipulativen Wachstumsmethoden vorschlagen.',
    'medium','["read:studio-metrics","read:channel-history","read:guidelines","propose:strategy","handoff:council"]'::jsonb,0.15,6
  ),
  (
    'dynamic-content-producer','Kian','Dynamic Content Producer / Clip-Maker',
    'Entwickelt wiederverwendbare Formate, Produktionen und Clip-Ideen aus freigegebenem Material.',
    'Nur belegte Bestände und geklärte Rechte nutzen. Produktionsentwürfe liefern; niemals selbst veröffentlichen, rendern oder schalten.',
    'medium','["read:studio-metrics","read:channel-history","read:guidelines","propose:content","handoff:council"]'::jsonb,0.15,6
  )
on conflict(id) do nothing;

create table if not exists agent_workflows(
  id uuid primary key default gen_random_uuid(),
  template_key text not null,
  template_version integer not null default 1,
  title text not null,
  goal text not null,
  source text not null default 'manual',
  status text not null default 'queued',
  risk_tier text not null default 'medium',
  input jsonb not null default '{}'::jsonb,
  result jsonb not null default '{}'::jsonb,
  requested_by uuid references users(id) on delete set null,
  requested_by_system text,
  parent_workflow_id uuid references agent_workflows(id) on delete set null,
  handoff_decision_id uuid references autonomous_studio_decisions(id) on delete set null,
  budget_limit_usd numeric(10,6) not null,
  budget_spent_usd numeric(10,6) not null default 0,
  error text,
  cancellation_reason text,
  locked_at timestamptz,
  locked_by text,
  started_at timestamptz,
  completed_at timestamptz,
  cancelled_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint agent_workflow_template_valid check(template_key ~ '^[a-z0-9][a-z0-9-]{1,79}$'),
  constraint agent_workflow_title_present check(length(btrim(title)) between 2 and 180),
  constraint agent_workflow_goal_present check(length(btrim(goal)) between 3 and 4000),
  constraint agent_workflow_source_valid check(source in ('manual','automatic','council','audience','system')),
  constraint agent_workflow_status_valid check(status in ('queued','running','awaiting_handoff','completed','blocked','failed','cancelled')),
  constraint agent_workflow_risk_valid check(risk_tier in ('low','medium','high')),
  constraint agent_workflow_budget_valid check(budget_limit_usd between 0.001 and 25),
  constraint agent_workflow_spend_valid check(budget_spent_usd >= 0)
);

create index if not exists idx_agent_workflows_status_created on agent_workflows(status,created_at);
create index if not exists idx_agent_workflows_handoff on agent_workflows(handoff_decision_id) where handoff_decision_id is not null;

create table if not exists agent_workflow_steps(
  id uuid primary key default gen_random_uuid(),
  workflow_id uuid not null references agent_workflows(id) on delete cascade,
  step_key text not null,
  position integer not null,
  title text not null,
  purpose text not null,
  agent_id text not null references agent_orchestrator_agents(id),
  capability text not null,
  depends_on text[] not null default '{}',
  status text not null default 'pending',
  input jsonb not null default '{}'::jsonb,
  output jsonb not null default '{}'::jsonb,
  attempts integer not null default 0,
  timeout_seconds integer not null default 180,
  cost_usd numeric(10,6) not null default 0,
  model text,
  tier text,
  error text,
  locked_at timestamptz,
  locked_by text,
  started_at timestamptz,
  completed_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique(workflow_id,step_key),
  unique(workflow_id,position),
  constraint agent_workflow_step_key_valid check(step_key ~ '^[a-z0-9][a-z0-9-]{1,79}$'),
  constraint agent_workflow_step_status_valid check(status in ('pending','running','completed','blocked','failed','cancelled')),
  constraint agent_workflow_step_position_valid check(position between 0 and 100),
  constraint agent_workflow_step_attempts_valid check(attempts between 0 and 10),
  constraint agent_workflow_step_timeout_valid check(timeout_seconds between 30 and 900),
  constraint agent_workflow_step_cost_valid check(cost_usd >= 0)
);

create index if not exists idx_agent_workflow_steps_ready on agent_workflow_steps(status,position,created_at);

create table if not exists agent_capability_grants(
  id uuid primary key default gen_random_uuid(),
  workflow_id uuid not null references agent_workflows(id) on delete cascade,
  workflow_step_id uuid not null references agent_workflow_steps(id) on delete cascade,
  agent_id text not null references agent_orchestrator_agents(id),
  capability text not null,
  resource_scope jsonb not null default '{}'::jsonb,
  token_hash text not null unique,
  status text not null default 'issued',
  max_invocations integer not null default 1,
  invocations integer not null default 0,
  budget_limit_usd numeric(10,6) not null,
  proposal_hash text,
  tool_plan_hash text,
  expires_at timestamptz not null,
  consumed_at timestamptz,
  revoked_at timestamptz,
  revocation_reason text,
  created_at timestamptz not null default now(),
  constraint agent_capability_grant_status_valid check(status in ('issued','consumed','revoked','expired')),
  constraint agent_capability_grant_hash_valid check(token_hash ~ '^[a-f0-9]{64}$'),
  constraint agent_capability_grant_invocations_valid check(max_invocations between 1 and 20 and invocations between 0 and max_invocations),
  constraint agent_capability_grant_budget_valid check(budget_limit_usd between 0.001 and 25)
);

create index if not exists idx_agent_capability_grants_active on agent_capability_grants(workflow_step_id,status,expires_at);

create table if not exists agent_tool_audit(
  id uuid primary key default gen_random_uuid(),
  workflow_id uuid not null references agent_workflows(id) on delete restrict,
  workflow_step_id uuid references agent_workflow_steps(id) on delete restrict,
  capability_grant_id uuid references agent_capability_grants(id) on delete restrict,
  agent_id text not null references agent_orchestrator_agents(id),
  capability text not null,
  tool_name text not null,
  status text not null,
  input_hash text not null,
  output_hash text,
  input_summary jsonb not null default '{}'::jsonb,
  output_summary jsonb not null default '{}'::jsonb,
  duration_ms integer,
  cost_usd numeric(10,6) not null default 0,
  denial_reason text,
  previous_entry_hash text,
  entry_hash text not null unique,
  created_at timestamptz not null default now(),
  constraint agent_tool_audit_status_valid check(status in ('requested','allowed','denied','completed','failed','timed_out')),
  constraint agent_tool_audit_input_hash_valid check(input_hash ~ '^[a-f0-9]{64}$'),
  constraint agent_tool_audit_output_hash_valid check(output_hash is null or output_hash ~ '^[a-f0-9]{64}$'),
  constraint agent_tool_audit_entry_hash_valid check(entry_hash ~ '^[a-f0-9]{64}$'),
  constraint agent_tool_audit_duration_valid check(duration_ms is null or duration_ms between 0 and 3600000),
  constraint agent_tool_audit_cost_valid check(cost_usd >= 0)
);

create index if not exists idx_agent_tool_audit_workflow on agent_tool_audit(workflow_id,created_at,id);

create table if not exists agent_memories(
  id uuid primary key default gen_random_uuid(),
  namespace text not null,
  kind text not null,
  content text not null,
  content_hash text not null,
  metadata jsonb not null default '{}'::jsonb,
  source_type text not null,
  source_id text,
  trust_score integer not null default 50,
  sensitivity text not null default 'internal',
  retrieval_version text not null default 'fts-simple-v1',
  search_document tsvector generated always as (to_tsvector('simple',content)) stored,
  superseded_by uuid references agent_memories(id) on delete set null,
  expires_at timestamptz,
  deleted_at timestamptz,
  created_by_workflow_id uuid references agent_workflows(id) on delete set null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique(namespace,content_hash),
  constraint agent_memory_namespace_valid check(namespace ~ '^[a-z0-9][a-z0-9:_-]{1,119}$'),
  constraint agent_memory_kind_valid check(kind in ('fact','decision','guideline','outcome','lesson')),
  constraint agent_memory_content_present check(length(btrim(content)) between 2 and 24000),
  constraint agent_memory_hash_valid check(content_hash ~ '^[a-f0-9]{64}$'),
  constraint agent_memory_trust_valid check(trust_score between 0 and 100),
  constraint agent_memory_sensitivity_valid check(sensitivity in ('public','internal','restricted')),
  constraint agent_memory_retrieval_version_valid check(retrieval_version ~ '^[a-z0-9][a-z0-9._-]{2,79}$')
);

create index if not exists idx_agent_memories_search on agent_memories using gin(search_document);
create index if not exists idx_agent_memories_namespace_created on agent_memories(namespace,created_at desc);
create index if not exists idx_agent_memories_expiry on agent_memories(expires_at) where expires_at is not null and deleted_at is null;

create table if not exists agent_memory_access(
  id uuid primary key default gen_random_uuid(),
  workflow_id uuid references agent_workflows(id) on delete set null,
  workflow_step_id uuid references agent_workflow_steps(id) on delete set null,
  agent_id text not null references agent_orchestrator_agents(id),
  memory_id uuid not null references agent_memories(id) on delete restrict,
  access_kind text not null,
  query_hash text not null,
  relevance_score numeric(8,6),
  created_at timestamptz not null default now(),
  constraint agent_memory_access_kind_valid check(access_kind in ('retrieved','written','superseded','deleted')),
  constraint agent_memory_access_hash_valid check(query_hash ~ '^[a-f0-9]{64}$')
);

create index if not exists idx_agent_memory_access_workflow on agent_memory_access(workflow_id,created_at);

create or replace function prevent_agent_audit_mutation()
returns trigger language plpgsql as $$
begin
  raise exception 'Agenten-Auditprotokolle sind unveränderlich';
end;
$$;

drop trigger if exists trg_agent_tool_audit_append_only on agent_tool_audit;
create trigger trg_agent_tool_audit_append_only
before update or delete on agent_tool_audit
for each row execute function prevent_agent_audit_mutation();

drop trigger if exists trg_agent_memory_access_append_only on agent_memory_access;
create trigger trg_agent_memory_access_append_only
before update or delete on agent_memory_access
for each row execute function prevent_agent_audit_mutation();

create or replace function freeze_started_agent_workflow_definition()
returns trigger language plpgsql as $$
begin
  if old.status <> 'queued' and (
    new.template_key is distinct from old.template_key or
    new.template_version is distinct from old.template_version or
    new.title is distinct from old.title or
    new.goal is distinct from old.goal or
    new.input is distinct from old.input or
    new.risk_tier is distinct from old.risk_tier or
    new.budget_limit_usd is distinct from old.budget_limit_usd
  ) then
    raise exception 'Gestartete Agenten-Workflows dürfen inhaltlich nicht verändert werden';
  end if;
  return new;
end;
$$;

drop trigger if exists trg_freeze_started_agent_workflow_definition on agent_workflows;
create trigger trg_freeze_started_agent_workflow_definition
before update on agent_workflows
for each row execute function freeze_started_agent_workflow_definition();
