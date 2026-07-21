-- Zuschauer koennen das Programm sichtbar beeinflussen, aber niemals direkt
-- aus dem Chat heraus Aktionen ausloesen. Einwaende und Vorschlaege werden als
-- nicht vertrauenswuerdige Eingaben erfasst und durchlaufen dasselbe
-- Gremiumsquorum plus zwei unabhaengige Schlusspruefungen wie CEO-Entscheidungen.
alter table autonomous_studio_settings
  add column if not exists audience_council_enabled boolean not null default true,
  add column if not exists audience_council_cooldown_minutes int not null default 120,
  add column if not exists audience_council_max_daily int not null default 12;

alter table autonomous_studio_settings
  drop constraint if exists autonomous_studio_audience_cooldown_valid;
alter table autonomous_studio_settings
  add constraint autonomous_studio_audience_cooldown_valid
  check(audience_council_cooldown_minutes between 5 and 1440);
alter table autonomous_studio_settings
  drop constraint if exists autonomous_studio_audience_daily_valid;
alter table autonomous_studio_settings
  add constraint autonomous_studio_audience_daily_valid
  check(audience_council_max_daily between 1 and 100);

alter table autonomous_studio_decisions
  drop constraint if exists autonomous_studio_decision_source_valid;
alter table autonomous_studio_decisions
  add constraint autonomous_studio_decision_source_valid
  check(source in ('automatic','sendegott','manual','audience'));

alter table autonomous_studio_announcements
  drop constraint if exists autonomous_studio_announcement_status_valid;
alter table autonomous_studio_announcements
  add constraint autonomous_studio_announcement_status_valid
  check(status in ('queued','preparing','scheduled','presented','cancelled'));

create table if not exists autonomous_studio_audience_inputs(
  id uuid primary key default gen_random_uuid(),
  chat_message_id uuid not null references ai_host_chat_messages(id) on delete cascade,
  session_id uuid not null references ai_host_sessions(id) on delete cascade,
  provider text not null,
  author_name text not null,
  author_channel_id text,
  influence_kind text not null,
  command text,
  text text not null,
  fingerprint text not null,
  status text not null default 'received',
  decision_id uuid references autonomous_studio_decisions(id) on delete set null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint autonomous_audience_kind_valid check(influence_kind in ('topic','suggestion','objection','pro','contra')),
  constraint autonomous_audience_status_valid check(status in ('received','linked','represented','ignored')),
  constraint autonomous_audience_text_present check(length(btrim(text)) between 2 and 500),
  unique(chat_message_id)
);

create index if not exists idx_autonomous_audience_inputs_session
  on autonomous_studio_audience_inputs(session_id,created_at desc);
create index if not exists idx_autonomous_audience_inputs_fingerprint
  on autonomous_studio_audience_inputs(fingerprint,created_at desc);
create index if not exists idx_autonomous_audience_inputs_decision
  on autonomous_studio_audience_inputs(decision_id) where decision_id is not null;

update ai_host_settings
set participation_prompt=
  'Schreib deine Frage oder Meinung in den Chat. Mit !frage fragst du AVA oder Mia, mit !thema schlägst du einen Schwerpunkt vor; !einwand, !pro und !contra fließen in die geprüfte Gremiumsberatung ein.',
  updated_at=now()
where participation_prompt in ('Schreib deine Meinung dazu in den Chat.','') or participation_prompt is null;

create index if not exists idx_autonomous_studio_decisions_audience
  on autonomous_studio_decisions(created_at desc)
  where source='audience';

-- Das Gremium muss exakt den Inhalt freigeben, der später angewendet wird.
-- Nach der ersten Stimme bleibt die Vorlage deshalb unveränderlich. Eine
-- bewusste Wiederaufnahme löscht zuerst Stimmen und Schlussprüfungen und kann
-- anschließend eine neue, wiederum vollständig zu prüfende Vorlage erzeugen.
create or replace function freeze_reviewed_autonomous_studio_decision()
returns trigger language plpgsql as $$
begin
  if (
       new.title is distinct from old.title
       or new.instruction is distinct from old.instruction
       or new.proposal is distinct from old.proposal
       or new.proposal_model is distinct from old.proposal_model
       or new.proposal_usage is distinct from old.proposal_usage
     ) and (
       exists(select 1 from autonomous_studio_council_votes where decision_id=old.id)
       or exists(select 1 from autonomous_studio_reviews where decision_id=old.id)
     ) then
    raise exception 'Gepruefte Studioentscheidung % darf nach Beginn der Gremiumsberatung nicht veraendert werden',old.id
      using errcode='23514';
  end if;
  return new;
end;
$$;

drop trigger if exists trg_freeze_reviewed_autonomous_studio_decision on autonomous_studio_decisions;
create trigger trg_freeze_reviewed_autonomous_studio_decision
before update of title,instruction,proposal,proposal_model,proposal_usage on autonomous_studio_decisions
for each row execute function freeze_reviewed_autonomous_studio_decision();

drop index if exists idx_autonomous_studio_decisions_queue;
create index idx_autonomous_studio_decisions_queue
  on autonomous_studio_decisions(status,created_at)
  where status in ('queued','planning','awaiting_council','awaiting_reviews','approved','applying');
