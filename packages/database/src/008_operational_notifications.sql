alter table notifications add column if not exists component text not null default 'system';
alter table notifications add column if not exists dedupe_key text;
alter table notifications add column if not exists details jsonb not null default '{}';
alter table notifications add column if not exists resolved_at timestamptz;
alter table notifications add column if not exists last_seen_at timestamptz not null default now();
alter table notifications add column if not exists occurrences int not null default 1;

update notifications
set component=coalesce(nullif(component,''),'system'),
    details=coalesce(details,'{}'::jsonb),
    last_seen_at=coalesce(last_seen_at,created_at,now()),
    occurrences=greatest(coalesce(occurrences,1),1);

create unique index if not exists idx_notifications_open_dedupe
  on notifications(dedupe_key)
  where dedupe_key is not null and resolved_at is null;

create index if not exists idx_notifications_open_last_seen
  on notifications(resolved_at,last_seen_at desc);

create table if not exists notification_reads(
  notification_id uuid not null references notifications(id) on delete cascade,
  user_id uuid not null references users(id) on delete cascade,
  read_at timestamptz not null default now(),
  primary key(notification_id,user_id)
);

create index if not exists idx_notification_reads_user
  on notification_reads(user_id,read_at desc);
