create table if not exists advertising_campaigns(
  id uuid primary key default gen_random_uuid(),
  name text not null,
  advertiser text not null default '',
  status text not null default 'draft' check(status in ('draft','active','paused','completed','archived')),
  starts_at timestamptz,
  ends_at timestamptz,
  daily_start time,
  daily_end time,
  weekdays integer[] not null default '{1,2,3,4,5,6,7}',
  timezone text not null default 'Europe/Berlin',
  priority integer not null default 50 check(priority between 0 and 100),
  max_per_hour integer not null default 6 check(max_per_hour between 1 and 60),
  minimum_gap_seconds integer not null default 300 check(minimum_gap_seconds between 10 and 86400),
  notes text not null default '',
  created_by uuid references users(id) on delete set null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table if not exists advertising_creatives(
  id uuid primary key default gen_random_uuid(),
  campaign_id uuid not null references advertising_campaigns(id) on delete cascade,
  name text not null,
  creative_type text not null check(creative_type in ('text','banner','image','video')),
  headline text not null default '',
  body text not null default '',
  call_to_action text not null default '',
  destination_url text not null default '',
  media_id uuid references media_assets(id) on delete set null,
  placement text not null default 'lower-third' check(placement in ('fullscreen','top','lower-third','bottom-right')),
  style text not null default 'studio' check(style in ('studio','light','bold','minimal')),
  transition text not null default 'fade' check(transition in ('fade','slide','zoom','cut')),
  duration_seconds integer not null default 10 check(duration_seconds between 2 and 300),
  weight integer not null default 10 check(weight between 1 and 100),
  active boolean not null default true,
  play_count integer not null default 0,
  last_played_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table if not exists advertising_schedules(
  id uuid primary key default gen_random_uuid(),
  campaign_id uuid not null references advertising_campaigns(id) on delete cascade,
  creative_id uuid references advertising_creatives(id) on delete cascade,
  name text not null,
  schedule_type text not null default 'interval' check(schedule_type in ('fixed','interval','daypart')),
  starts_at timestamptz,
  ends_at timestamptz,
  weekdays integer[] not null default '{1,2,3,4,5,6,7}',
  daily_start time,
  daily_end time,
  interval_minutes integer not null default 30 check(interval_minutes between 1 and 1440),
  next_run_at timestamptz not null default now(),
  enabled boolean not null default true,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table if not exists advertising_playouts(
  id uuid primary key default gen_random_uuid(),
  campaign_id uuid not null references advertising_campaigns(id) on delete cascade,
  creative_id uuid not null references advertising_creatives(id) on delete cascade,
  schedule_id uuid references advertising_schedules(id) on delete set null,
  status text not null default 'on_air' check(status in ('on_air','completed','cancelled','failed')),
  trigger_type text not null default 'schedule' check(trigger_type in ('schedule','manual')),
  started_at timestamptz not null default now(),
  expires_at timestamptz not null,
  ended_at timestamptz,
  error text,
  created_by uuid references users(id) on delete set null
);

create unique index if not exists idx_advertising_single_on_air
  on advertising_playouts((status)) where status='on_air';
create index if not exists idx_advertising_schedules_due
  on advertising_schedules(next_run_at) where enabled=true;
create index if not exists idx_advertising_playouts_recent
  on advertising_playouts(started_at desc);

insert into overlay_templates(name,category,snapshot)
values(
  'advertising',
  'commercial',
  '{
    "name":"Werbung Master Overlay",
    "width":1920,
    "height":1080,
    "background":"transparent",
    "slot":"advertising",
    "elements":[
      {"id":"ad-frame","type":"shape","name":"Werberahmen","x":48,"y":48,"width":1824,"height":984,"zIndex":1,"props":{"background":"transparent","borderColor":"#20d9cd","borderWidth":2,"borderRadius":24}},
      {"id":"ad-label","type":"text","name":"Werbekennzeichnung","x":78,"y":70,"width":360,"height":48,"zIndex":2,"props":{"text":"WERBUNG","fontSize":22,"fontWeight":"900","color":"#20d9cd"}}
    ]
  }'::jsonb
)
on conflict(name) do nothing;

with created_project as (
  insert into overlay_projects(name,width,height,status,template,version)
  select 'Werbung · Master Overlay',1920,1080,'published','advertising',1
  where not exists(select 1 from overlay_projects where template='advertising' and deleted_at is null)
  returning id
),
project as (
  select id from created_project
  union all
  select id from overlay_projects where template='advertising' and deleted_at is null order by id limit 1
)
insert into overlay_versions(project_id,version,snapshot,published,status,label)
select project.id,1,template.snapshot,true,'published','Werbeverwaltung'
from project
join overlay_templates template on template.name='advertising'
where not exists(select 1 from overlay_versions ov where ov.project_id=project.id);
