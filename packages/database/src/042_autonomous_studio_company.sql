-- Das autonome Studio entwickelt Strategien, Formate und Produktionen. Jede
-- betriebswirksame Entscheidung braucht zwei voneinander unabhaengige KI-
-- Freigaben. Die Sperre liegt absichtlich in PostgreSQL und nicht nur in der UI.
create table if not exists autonomous_studio_settings(
  id boolean primary key default true,
  enabled boolean not null default true,
  automatic_apply boolean not null default true,
  cycle_interval_hours int not null default 24,
  planning_horizon_days int not null default 30,
  max_formats_per_week int not null default 2,
  max_productions_per_day int not null default 3,
  max_shorts_per_day int not null default 4,
  council_quorum int not null default 3,
  paid_model_strategy text not null default 'automatic',
  paid_model text not null default '',
  max_request_usd numeric(8,4) not null default 0.35,
  daily_budget_usd numeric(8,2) not null default 8.00,
  reviewer_models jsonb not null default '["~anthropic/claude-sonnet-latest","~google/gemini-pro-latest"]'::jsonb,
  last_cycle_at timestamptz,
  next_cycle_at timestamptz not null default now(),
  paused_reason text,
  updated_at timestamptz not null default now(),
  constraint autonomous_studio_settings_singleton check(id),
  constraint autonomous_studio_cycle_valid check(cycle_interval_hours between 1 and 168),
  constraint autonomous_studio_horizon_valid check(planning_horizon_days between 1 and 365),
  constraint autonomous_studio_format_limit_valid check(max_formats_per_week between 0 and 30),
  constraint autonomous_studio_production_limit_valid check(max_productions_per_day between 0 and 50),
  constraint autonomous_studio_shorts_limit_valid check(max_shorts_per_day between 0 and 50),
  constraint autonomous_studio_council_quorum_valid check(council_quorum between 3 and 5),
  constraint autonomous_studio_model_strategy_valid check(paid_model_strategy in ('automatic','fixed')),
  constraint autonomous_studio_request_budget_valid check(max_request_usd between 0.01 and 25),
  constraint autonomous_studio_daily_budget_valid check(daily_budget_usd between 0.01 and 1000),
  constraint autonomous_studio_reviewers_valid check(
    jsonb_typeof(reviewer_models)='array' and jsonb_array_length(reviewer_models)>=2
  )
);

insert into autonomous_studio_settings(id) values(true) on conflict(id) do nothing;

create table if not exists autonomous_studio_decisions(
  id uuid primary key default gen_random_uuid(),
  parent_decision_id uuid references autonomous_studio_decisions(id) on delete set null,
  previous_decision_id uuid references autonomous_studio_decisions(id) on delete set null,
  kind text not null,
  source text not null default 'automatic',
  title text not null,
  instruction text not null,
  proposal jsonb not null default '{}'::jsonb,
  proposal_model text,
  proposal_usage jsonb not null default '{}'::jsonb,
  status text not null default 'queued',
  requested_by uuid references users(id) on delete set null,
  requested_by_system text,
  snapshot_before jsonb not null default '{}'::jsonb,
  apply_result jsonb not null default '{}'::jsonb,
  error text,
  attempts int not null default 0,
  locked_at timestamptz,
  locked_by text,
  approved_at timestamptz,
  applied_at timestamptz,
  failed_at timestamptz,
  rolled_back_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint autonomous_studio_decision_kind_valid check(kind in ('strategy','format','production','directive')),
  constraint autonomous_studio_decision_source_valid check(source in ('automatic','sendegott','manual')),
  constraint autonomous_studio_decision_status_valid check(status in (
    'queued','planning','awaiting_council','awaiting_reviews','approved','revise','rejected','applying','applied','failed','rolled_back','cancelled'
  )),
  constraint autonomous_studio_decision_title_present check(length(btrim(title))>0),
  constraint autonomous_studio_decision_instruction_present check(length(btrim(instruction))>0)
);

create table if not exists autonomous_studio_council_members(
  id text primary key,
  display_name text not null,
  role_name text not null,
  perspective text not null,
  instructions text not null,
  preferred_model text not null,
  accent_color text not null default '#31c6b1',
  enabled boolean not null default true,
  sort_order int not null default 0,
  updated_at timestamptz not null default now()
);

insert into autonomous_studio_council_members(
  id,display_name,role_name,perspective,instructions,preferred_model,accent_color,sort_order
) values
  ('editorial-chair','Dr. Ada Kern','Redaktionelle Vorsitzende','Redaktion und publizistische Qualitaet',
   'Pruefe Quellennaehe, Relevanz, Fairness, Verstaendlichkeit und redaktionelle Unabhaengigkeit.',
   '~anthropic/claude-sonnet-latest','#31c6b1',1),
  ('audience-advocate','Noah Blick','Publikumsanwalt','Zuschauerinteresse und Zugaenglichkeit',
   'Pruefe, ob das Vorhaben echten Nutzwert hat, normale Menschen mitnimmt und nicht manipulativ oder unnötig kompliziert ist.',
   '~google/gemini-pro-latest','#38bdf8',2),
  ('production-director','Lina Takt','Produktionsdirektorin','Ausfuehrbarkeit und Sendesicherheit',
   'Pruefe Ressourcen, OBS- und Autopilot-Tauglichkeit, Zeitplan, Wiederholbarkeit und ausfallsichere Umsetzung.',
   '~openai/gpt-latest','#a78bfa',3),
  ('safety-officer','Viktor Klar','Sicherheits- und Compliancebeauftragter','Rechte, Risiken und Verantwortung',
   'Pruefe Faktenrisiken, Persoenlichkeitsrechte, Urheberrecht, Plattformregeln, Sicherheit und moegliche Fehlanreize.',
   '~anthropic/claude-sonnet-latest','#fb7185',4),
  ('growth-strategist','Mara Weit','Strategin fuer Reichweite','Wachstum und nachhaltige Formatentwicklung',
   'Pruefe Differenzierung, Wiedererkennbarkeit, Lernwert, Reichweitenpotenzial und ob Wachstum ohne Clickbait erreichbar ist.',
   '~google/gemini-pro-latest','#fbbf24',5)
on conflict(id) do nothing;

create table if not exists autonomous_studio_council_votes(
  id uuid primary key default gen_random_uuid(),
  decision_id uuid not null references autonomous_studio_decisions(id) on delete cascade,
  council_member_id text not null references autonomous_studio_council_members(id) on delete cascade,
  reviewer_model text not null,
  reviewer_tier text not null default 'paid',
  vote text not null,
  score int not null,
  summary text not null,
  checks jsonb not null default '[]'::jsonb,
  blockers jsonb not null default '[]'::jsonb,
  required_changes jsonb not null default '[]'::jsonb,
  usage jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now(),
  constraint autonomous_studio_council_vote_valid check(vote in ('approve','revise','reject')),
  constraint autonomous_studio_council_score_valid check(score between 0 and 100),
  unique(decision_id,council_member_id)
);

create table if not exists autonomous_studio_reviews(
  id uuid primary key default gen_random_uuid(),
  decision_id uuid not null references autonomous_studio_decisions(id) on delete cascade,
  review_slot int not null,
  reviewer_model text not null,
  reviewer_tier text not null default 'paid',
  decision text not null,
  score int not null,
  summary text not null,
  checks jsonb not null default '[]'::jsonb,
  blockers jsonb not null default '[]'::jsonb,
  required_changes jsonb not null default '[]'::jsonb,
  usage jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now(),
  constraint autonomous_studio_review_slot_valid check(review_slot in (1,2)),
  constraint autonomous_studio_review_decision_valid check(decision in ('approve','revise','reject')),
  constraint autonomous_studio_review_score_valid check(score between 0 and 100),
  unique(decision_id,review_slot),
  unique(decision_id,reviewer_model)
);

create table if not exists autonomous_studio_events(
  id uuid primary key default gen_random_uuid(),
  decision_id uuid references autonomous_studio_decisions(id) on delete cascade,
  event_type text not null,
  title text not null,
  detail text,
  metadata jsonb not null default '{}'::jsonb,
  actor_user_id uuid references users(id) on delete set null,
  created_at timestamptz not null default now()
);

create table if not exists autonomous_studio_announcements(
  id uuid primary key default gen_random_uuid(),
  decision_id uuid not null references autonomous_studio_decisions(id) on delete cascade,
  presenter_id text not null default 'moderator' references ai_staff_members(id) on delete restrict,
  headline text not null,
  text text not null,
  status text not null default 'queued',
  session_id uuid references ai_host_sessions(id) on delete set null,
  turn_id uuid references ai_staff_turns(id) on delete set null,
  scheduled_at timestamptz,
  presented_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint autonomous_studio_announcement_status_valid check(status in ('queued','scheduled','presented','cancelled')),
  unique(decision_id)
);

create table if not exists studio_operating_state(
  id boolean primary key default true,
  version int not null default 1,
  active_strategy_decision_id uuid references autonomous_studio_decisions(id) on delete set null,
  active_directive_decision_id uuid references autonomous_studio_decisions(id) on delete set null,
  strategy jsonb not null default '{}'::jsonb,
  directive jsonb not null default '{}'::jsonb,
  operating_policy text not null default
    'Sachlich, transparent, abwechslungsreich und quellennah senden. Sicherheit und Sendekontinuitaet gehen vor Wachstum.',
  updated_at timestamptz not null default now(),
  constraint studio_operating_state_singleton check(id)
);

insert into studio_operating_state(id) values(true) on conflict(id) do nothing;

create or replace function enforce_autonomous_studio_double_approval()
returns trigger language plpgsql as $$
declare
  required_quorum int;
  council_approvals int;
  approval_count int;
  model_count int;
begin
  if new.status in ('approved','applying','applied')
     and (tg_op='INSERT' or old.status is distinct from new.status) then
    select council_quorum into required_quorum from autonomous_studio_settings where id=true;
    select count(*) filter(where vote='approve') into council_approvals
    from autonomous_studio_council_votes where decision_id=new.id;
    select count(*) filter(where decision='approve'),
           count(distinct reviewer_model) filter(where decision='approve')
      into approval_count,model_count
    from autonomous_studio_reviews where decision_id=new.id;
    if council_approvals < coalesce(required_quorum,3) or approval_count < 2 or model_count < 2 then
      raise exception 'Autonome Studioentscheidung % benoetigt Gremiumsquorum und zwei unabhaengige KI-Freigaben',new.id
        using errcode='23514';
    end if;
  end if;
  return new;
end;
$$;

drop trigger if exists trg_autonomous_studio_double_approval on autonomous_studio_decisions;
create trigger trg_autonomous_studio_double_approval
before insert or update of status on autonomous_studio_decisions
for each row execute function enforce_autonomous_studio_double_approval();

create index if not exists idx_autonomous_studio_decisions_queue
  on autonomous_studio_decisions(status,created_at)
  where status in ('queued','planning','awaiting_reviews','approved','applying');
create index if not exists idx_autonomous_studio_decisions_recent
  on autonomous_studio_decisions(created_at desc);
create index if not exists idx_autonomous_studio_reviews_decision
  on autonomous_studio_reviews(decision_id,review_slot);
create index if not exists idx_autonomous_studio_council_votes_decision
  on autonomous_studio_council_votes(decision_id,council_member_id);
create index if not exists idx_autonomous_studio_events_recent
  on autonomous_studio_events(created_at desc);
create index if not exists idx_autonomous_studio_announcements_queue
  on autonomous_studio_announcements(status,created_at) where status='queued';
