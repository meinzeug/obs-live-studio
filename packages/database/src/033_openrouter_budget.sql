create table if not exists openrouter_usage_events(
  id uuid primary key default gen_random_uuid(),
  task text not null,
  status text not null check(status in ('reserved','completed','failed','uncertain','blocked')),
  model text,
  model_candidates jsonb not null default '[]'::jsonb,
  reserved_cost_usd numeric(14,8) not null default 0 check(reserved_cost_usd >= 0),
  actual_cost_usd numeric(14,8) check(actual_cost_usd is null or actual_cost_usd >= 0),
  prompt_tokens integer check(prompt_tokens is null or prompt_tokens >= 0),
  completion_tokens integer check(completion_tokens is null or completion_tokens >= 0),
  total_tokens integer check(total_tokens is null or total_tokens >= 0),
  blocked_reason text,
  created_at timestamptz not null default now(),
  completed_at timestamptz
);

create index if not exists idx_openrouter_usage_events_budget_day
  on openrouter_usage_events(created_at,status);
create index if not exists idx_openrouter_usage_events_recent
  on openrouter_usage_events(created_at desc);
