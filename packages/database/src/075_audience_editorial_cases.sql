-- Jeder sichere Zuschauerbeitrag erhält einen dauerhaften Redaktionsvorgang.
-- Damit sind Fragen, Einwände, Vorschläge und normale Anmerkungen unabhängig
-- von OpenRouter-Budget, On-Air-Cooldowns und Sammelanalysen nachvollziehbar.

create table if not exists ai_host_editorial_cases(
  id uuid primary key default gen_random_uuid(),
  session_id uuid not null references ai_host_sessions(id) on delete cascade,
  chat_message_id uuid not null unique references ai_host_chat_messages(id) on delete cascade,
  classification text not null default 'comment',
  status text not null default 'received',
  research_query text,
  research_sources jsonb not null default '[]',
  verified_fact jsonb,
  confidence text not null default 'none',
  summary text,
  answer text,
  turn_id uuid references ai_staff_turns(id) on delete set null,
  attempts int not null default 0,
  next_retry_at timestamptz,
  last_error text,
  researched_at timestamptz,
  reviewed_at timestamptz,
  on_air_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint ai_host_editorial_case_classification_valid check(
    classification in ('question','topic','suggestion','objection','pro','contra','comment')
  ),
  constraint ai_host_editorial_case_status_valid check(
    status in ('received','researching','reviewed','on_air','deferred','closed','failed')
  ),
  constraint ai_host_editorial_case_confidence_valid check(confidence in ('none','limited','supported')),
  constraint ai_host_editorial_case_attempts_valid check(attempts between 0 and 20)
);

create index if not exists idx_ai_host_editorial_cases_queue
  on ai_host_editorial_cases(status,next_retry_at,created_at)
  where status in ('received','deferred','failed');

create index if not exists idx_ai_host_editorial_cases_session
  on ai_host_editorial_cases(session_id,created_at desc);

insert into ai_host_editorial_cases(session_id,chat_message_id,classification,status,summary,reviewed_at)
select message.session_id,message.id,
       case
         when position('?' in message.message)>0
           or lower(message.message) ~ '^[[:space:]]*!frage([^[:alnum:]_]|$)'
           then 'question'
         else 'comment'
       end,
       case when message.used_at is null then 'received' else 'closed' end,
       case when message.used_at is null then null else 'Vor Einführung des Redaktionspostfachs verarbeitet.' end,
       case when message.used_at is null then null else message.used_at end
from ai_host_chat_messages message
where message.safe=true
on conflict(chat_message_id) do nothing;
