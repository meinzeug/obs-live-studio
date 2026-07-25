-- Verbindliche menschenzentrierte Leitplanken für alle autonomen Studio-
-- entscheidungen. Die KI automatisiert Abläufe, sie optimiert aber niemals auf
-- die Beseitigung menschlicher Arbeit oder menschlicher Verantwortung.

create table if not exists human_centered_ai_charter(
  id boolean primary key default true,
  version text not null default '2026-07-24',
  enabled boolean not null default true,
  human_final_authority boolean not null default true,
  prohibit_job_elimination_objective boolean not null default true,
  prohibit_autonomous_employment_decisions boolean not null default true,
  require_explainable_proposals boolean not null default true,
  require_high_impact_human_approval boolean not null default true,
  right_to_override boolean not null default true,
  right_to_pause_automation boolean not null default true,
  purpose text not null default
    'KI unterstützt Menschen bei Recherche, Produktion und Betrieb. Sie ersetzt weder menschliche Würde noch Verantwortung und verfolgt keinen Personalabbau als Optimierungsziel.',
  updated_at timestamptz not null default now(),
  constraint human_centered_ai_charter_singleton check(id),
  constraint human_centered_ai_charter_core_enabled check(
    enabled
    and human_final_authority
    and prohibit_job_elimination_objective
    and prohibit_autonomous_employment_decisions
    and require_explainable_proposals
    and require_high_impact_human_approval
    and right_to_override
    and right_to_pause_automation
  )
);

insert into human_centered_ai_charter(id) values(true) on conflict(id) do nothing;

alter table autonomous_studio_decisions
  add column if not exists human_impact_level text not null default 'low',
  add column if not exists human_impact_assessment jsonb not null default
    '{"summary":"Bestehender Beschluss; menschenzentrierte Prüfung gilt spätestens vor der Umsetzung.","safeguards":["Menschliche Letztverantwortung","Audit und Rückrollbarkeit"],"prohibitedObjective":false}'::jsonb,
  add column if not exists human_review_required boolean not null default false;

alter table autonomous_studio_decisions
  drop constraint if exists autonomous_studio_human_impact_level_valid;
alter table autonomous_studio_decisions
  add constraint autonomous_studio_human_impact_level_valid
  check(human_impact_level in ('low','moderate','high','prohibited'));

create or replace function enforce_human_centered_autonomous_decision()
returns trigger language plpgsql as $$
begin
  if new.human_impact_level='prohibited'
     or coalesce((new.human_impact_assessment->>'prohibitedObjective')::boolean,false) then
    if new.status in ('awaiting_council','awaiting_reviews','awaiting_ceo','approved','applying','applied') then
      raise exception 'Beschluss % verletzt die menschenzentrierte KI-Charta',new.id
        using errcode='23514';
    end if;
  end if;
  if new.human_review_required and new.status in ('approved','applying','applied')
     and new.ceo_status<>'approved' then
    raise exception 'Beschluss % benötigt eine menschliche Freigabe der Folgenabschätzung',new.id
      using errcode='23514';
  end if;
  return new;
end;
$$;

drop trigger if exists trg_human_centered_autonomous_decision on autonomous_studio_decisions;
create trigger trg_human_centered_autonomous_decision
before insert or update on autonomous_studio_decisions
for each row execute function enforce_human_centered_autonomous_decision();

update studio_operating_state
set operating_policy=
  'Menschenzentriert, sachlich, transparent, abwechslungsreich und quellennah senden. KI unterstützt Redaktion und Betrieb; menschliche Verantwortung, Widerspruch, Eingriff und kreative Arbeit bleiben erhalten. Personalabbau ist kein Optimierungsziel. Sicherheit und Sendekontinuität gehen vor Wachstum.',
  updated_at=now()
where id=true
  and operating_policy not ilike '%menschenzentriert%';

