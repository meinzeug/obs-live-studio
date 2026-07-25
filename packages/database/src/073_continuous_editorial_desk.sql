-- Der bisherige Quellenabruf und die Artikelaufbereitung werden zu einem
-- sichtbaren Redaktions-Schichtbetrieb verbunden. Jede Schicht besitzt
-- messbare Eingangsdaten und konkrete Übergaben an Redaktion, Faktenprüfung
-- und Produktion.

create table if not exists editorial_desk_settings(
  id boolean primary key default true,
  enabled boolean not null default true,
  cycle_interval_minutes int not null default 15,
  region_focus text not null default 'Deutschland',
  max_stories_per_cycle int not null default 12,
  minimum_distinct_sources int not null default 3,
  create_staff_assignments boolean not null default true,
  local_fallback_enabled boolean not null default true,
  next_cycle_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint editorial_desk_settings_singleton check(id),
  constraint editorial_desk_interval_valid check(cycle_interval_minutes between 5 and 180),
  constraint editorial_desk_story_limit_valid check(max_stories_per_cycle between 3 and 50),
  constraint editorial_desk_source_limit_valid check(minimum_distinct_sources between 1 and 20)
);

insert into editorial_desk_settings(id) values(true) on conflict(id) do nothing;

create table if not exists editorial_desk_cycles(
  id uuid primary key default gen_random_uuid(),
  trigger text not null default 'scheduled',
  status text not null default 'running',
  evidence_fingerprint text,
  new_articles int not null default 0,
  reviewed_articles int not null default 0,
  approved_articles int not null default 0,
  distinct_sources int not null default 0,
  topics jsonb not null default '[]',
  assignments jsonb not null default '[]',
  summary text,
  fallback_used boolean not null default false,
  error text,
  started_at timestamptz not null default now(),
  completed_at timestamptz,
  constraint editorial_desk_cycle_trigger_valid check(trigger in ('scheduled','manual','startup')),
  constraint editorial_desk_cycle_status_valid check(status in ('running','completed','degraded','failed'))
);

create index if not exists idx_editorial_desk_cycles_recent
  on editorial_desk_cycles(started_at desc);
create index if not exists idx_editorial_desk_cycle_evidence
  on editorial_desk_cycles(evidence_fingerprint,started_at desc)
  where evidence_fingerprint is not null and status in ('completed','degraded');
