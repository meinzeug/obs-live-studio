alter table articles add column if not exists main_text text;
create unique index if not exists idx_articles_content_hash on articles(content_hash);
create table if not exists worker_jobs(
  id uuid primary key default gen_random_uuid(),
  kind text not null,
  payload jsonb not null default '{}',
  status text not null default 'queued',
  attempts int default 0,
  max_attempts int default 5,
  scheduled_at timestamptz default now(),
  started_at timestamptz,
  finished_at timestamptz,
  error text,
  locked_at timestamptz,
  locked_by text
);
create index if not exists idx_worker_jobs_claim on worker_jobs(status,scheduled_at);
create table if not exists playback_state(
  id boolean primary key default true,
  state jsonb not null default '{}',
  updated_at timestamptz default now(),
  constraint playback_state_singleton check (id)
);
insert into playback_state(id,state) values(true,'{"status":"idle"}'::jsonb) on conflict (id) do nothing;
create index if not exists idx_worker_jobs_claim_locked on worker_jobs(status,scheduled_at,locked_at);
