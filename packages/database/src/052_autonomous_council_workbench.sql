-- Der Sender-Rat liefert nicht nur Voten, sondern konkrete Arbeitspakete.
-- Wichtige, zweifach KI-geprüfte Änderungen warten zusätzlich auf eine
-- ausdrückliche CEO-Entscheidung. Revisionen bleiben als eigene Versionen
-- erhalten, damit kein bereits geprüftes Ergebnis still überschrieben wird.
alter table autonomous_studio_settings
  add column if not exists require_ceo_approval boolean not null default true,
  add column if not exists minimum_active_formats int not null default 3,
  add column if not exists maximum_revision_rounds int not null default 3;

alter table autonomous_studio_settings
  drop constraint if exists autonomous_studio_minimum_formats_valid;
alter table autonomous_studio_settings
  add constraint autonomous_studio_minimum_formats_valid check(minimum_active_formats between 1 and 12);
alter table autonomous_studio_settings
  drop constraint if exists autonomous_studio_revision_rounds_valid;
alter table autonomous_studio_settings
  add constraint autonomous_studio_revision_rounds_valid check(maximum_revision_rounds between 1 and 8);

alter table autonomous_studio_decisions
  add column if not exists importance text not null default 'normal',
  add column if not exists ceo_status text not null default 'not_required',
  add column if not exists ceo_feedback text,
  add column if not exists ceo_reviewed_by uuid references users(id) on delete set null,
  add column if not exists ceo_reviewed_at timestamptz,
  add column if not exists revision_number int not null default 0,
  add column if not exists revision_context jsonb not null default '{}'::jsonb,
  add column if not exists superseded_by_decision_id uuid references autonomous_studio_decisions(id) on delete set null;

alter table autonomous_studio_decisions
  drop constraint if exists autonomous_studio_decision_status_valid;
alter table autonomous_studio_decisions
  add constraint autonomous_studio_decision_status_valid check(status in (
    'queued','planning','awaiting_council','awaiting_reviews','awaiting_ceo','approved','revise','rejected',
    'applying','applied','failed','rolled_back','cancelled'
  ));
alter table autonomous_studio_decisions
  drop constraint if exists autonomous_studio_decision_importance_valid;
alter table autonomous_studio_decisions
  add constraint autonomous_studio_decision_importance_valid check(importance in ('normal','high','critical'));
alter table autonomous_studio_decisions
  drop constraint if exists autonomous_studio_decision_ceo_status_valid;
alter table autonomous_studio_decisions
  add constraint autonomous_studio_decision_ceo_status_valid check(ceo_status in (
    'not_required','pending','approved','revision_requested','rejected'
  ));
alter table autonomous_studio_decisions
  drop constraint if exists autonomous_studio_revision_number_valid;
alter table autonomous_studio_decisions
  add constraint autonomous_studio_revision_number_valid check(revision_number between 0 and 8);

update autonomous_studio_decisions
set importance=case
      when source='sendegott' or kind in ('strategy','format') then 'high'
      else importance
    end,
    ceo_status=case
      when status in ('applied','rolled_back','cancelled') then 'not_required'
      when source='sendegott' or kind in ('strategy','format') then 'pending'
      else ceo_status
    end;

create table if not exists autonomous_studio_council_messages(
  id uuid primary key default gen_random_uuid(),
  decision_id uuid references autonomous_studio_decisions(id) on delete set null,
  author_kind text not null,
  author_name text not null,
  message text not null,
  metadata jsonb not null default '{}'::jsonb,
  actor_user_id uuid references users(id) on delete set null,
  created_at timestamptz not null default now(),
  constraint autonomous_council_message_author_valid check(author_kind in ('ceo','council','system')),
  constraint autonomous_council_message_present check(length(btrim(message)) between 2 and 12000)
);

create table if not exists autonomous_studio_deliverables(
  id uuid primary key default gen_random_uuid(),
  decision_id uuid not null references autonomous_studio_decisions(id) on delete cascade,
  kind text not null,
  title text not null,
  status text not null default 'ready',
  content jsonb not null default '{}'::jsonb,
  markdown text not null default '',
  file_path text,
  mime_type text,
  size_bytes bigint,
  error text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint autonomous_deliverable_kind_valid check(kind in (
    'solution-brief','handout','format-blueprint','overlay-blueprint','schedule','production-plan'
  )),
  constraint autonomous_deliverable_status_valid check(status in ('preparing','ready','failed')),
  constraint autonomous_deliverable_title_present check(length(btrim(title))>0),
  unique(decision_id,kind,title)
);

create index if not exists idx_autonomous_council_messages_recent
  on autonomous_studio_council_messages(created_at desc);
create index if not exists idx_autonomous_deliverables_decision
  on autonomous_studio_deliverables(decision_id,created_at);
create index if not exists idx_autonomous_decisions_ceo
  on autonomous_studio_decisions(status,created_at) where status='awaiting_ceo';

create or replace function enforce_autonomous_studio_double_approval()
returns trigger language plpgsql as $$
declare
  required_quorum int;
  council_approvals int;
  approval_count int;
  model_count int;
begin
  if new.status in ('awaiting_ceo','approved','applying','applied')
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

drop index if exists idx_autonomous_studio_decisions_queue;
create index idx_autonomous_studio_decisions_queue
  on autonomous_studio_decisions(status,created_at)
  where status in ('queued','planning','awaiting_council','awaiting_reviews','awaiting_ceo','approved','applying');
