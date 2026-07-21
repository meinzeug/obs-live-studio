create table if not exists ai_staff_tasks(
  id uuid primary key default gen_random_uuid(),
  staff_member_id text not null references ai_staff_members(id) on delete cascade,
  parent_task_id uuid references ai_staff_tasks(id) on delete set null,
  kind text not null default 'assignment',
  title text not null,
  instructions text not null,
  priority text not null default 'normal',
  status text not null default 'queued',
  requested_by uuid references users(id) on delete set null,
  due_at timestamptz,
  result_summary text,
  result_text text,
  result jsonb not null default '{}',
  model text,
  error text,
  attempts int not null default 0,
  locked_at timestamptz,
  started_at timestamptz,
  completed_at timestamptz,
  cancelled_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint ai_staff_task_kind_valid check(kind in ('assignment','question','review')),
  constraint ai_staff_task_priority_valid check(priority in ('low','normal','high','urgent')),
  constraint ai_staff_task_status_valid check(status in ('queued','running','waiting_review','completed','failed','cancelled')),
  constraint ai_staff_task_title_present check(length(btrim(title)) > 0),
  constraint ai_staff_task_instructions_present check(length(btrim(instructions)) > 0)
);

create index if not exists idx_ai_staff_tasks_member_recent
  on ai_staff_tasks(staff_member_id,created_at desc);
create index if not exists idx_ai_staff_tasks_queue
  on ai_staff_tasks(priority,created_at)
  where status='queued';
create index if not exists idx_ai_staff_tasks_open
  on ai_staff_tasks(staff_member_id,status,updated_at desc)
  where status in ('queued','running','waiting_review');

create table if not exists ai_staff_activity(
  id uuid primary key default gen_random_uuid(),
  staff_member_id text not null references ai_staff_members(id) on delete cascade,
  task_id uuid references ai_staff_tasks(id) on delete set null,
  event_type text not null,
  title text not null,
  detail text,
  status text,
  metadata jsonb not null default '{}',
  actor_user_id uuid references users(id) on delete set null,
  created_at timestamptz not null default now()
);

create index if not exists idx_ai_staff_activity_member_recent
  on ai_staff_activity(staff_member_id,created_at desc);
create index if not exists idx_ai_staff_activity_task
  on ai_staff_activity(task_id,created_at desc)
  where task_id is not null;

update ai_staff_members
set config = case role
  when 'producer' then '{"tone":"decisive","responseDetail":"balanced","modelStrategy":"balanced","proactive":true,"requiresSources":false,"notifyOnCompletion":true,"specialties":["Sendedramaturgie","Ablaufplanung","Formatentwicklung"]}'::jsonb
  when 'editor' then '{"tone":"neutral","responseDetail":"detailed","modelStrategy":"quality","proactive":true,"requiresSources":true,"notifyOnCompletion":true,"specialties":["Nachrichtenaufbereitung","Themenbriefing","Sprechertexte"]}'::jsonb
  when 'fact-checker' then '{"tone":"analytical","responseDetail":"detailed","modelStrategy":"quality","proactive":false,"requiresSources":true,"notifyOnCompletion":true,"specialties":["Behauptungsprüfung","Quellenabgleich","Risikohinweise"]}'::jsonb
  when 'chat-analyst' then '{"tone":"analytical","responseDetail":"balanced","modelStrategy":"speed","proactive":true,"requiresSources":false,"notifyOnCompletion":true,"specialties":["Chat-Stimmungen","Fragencluster","Moderationssignale"]}'::jsonb
  else '{"tone":"warm","responseDetail":"balanced","modelStrategy":"balanced","proactive":true,"requiresSources":true,"notifyOnCompletion":true,"specialties":["Live-Moderation","Publikumsfragen","Video-Einordnung"]}'::jsonb
end,
updated_at=now()
where config='{}'::jsonb;

alter table ai_host_settings
  add column if not exists chat_platforms jsonb not null default '["youtube"]',
  add column if not exists twitch_channel text;

update ai_host_settings
set chat_platforms='["youtube"]'::jsonb
where jsonb_typeof(chat_platforms) is distinct from 'array' or jsonb_array_length(chat_platforms)=0;
