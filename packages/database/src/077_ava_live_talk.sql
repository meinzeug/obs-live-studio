alter table live_studio_settings
  add column if not exists production_mode text not null default 'studio',
  add column if not exists talk_show_id uuid,
  add column if not exists talk_title text not null default 'AVA LIVE TALK',
  add column if not exists talk_subtitle text not null default 'Menschen, Perspektiven und Fragen live im Studio',
  add column if not exists talk_accent_color text not null default '#22d3ee',
  add column if not exists talk_ava_visible boolean not null default true,
  add column if not exists talk_chat_enabled boolean not null default true;

alter table live_studio_settings
  drop constraint if exists live_studio_production_mode_valid;
alter table live_studio_settings
  add constraint live_studio_production_mode_valid
  check(production_mode=any('{studio,reaction,talk}'::text[]));

alter table live_studio_settings
  drop constraint if exists live_studio_layout_valid;
alter table live_studio_settings
  add constraint live_studio_layout_valid
  check(layout=any('{fullscreen,split,grid,pip,reaction,talk}'::text[]));

alter table live_studio_settings
  drop constraint if exists live_studio_reaction_previous_layout_valid;
alter table live_studio_settings
  add constraint live_studio_reaction_previous_layout_valid
  check(reaction_previous_layout=any('{fullscreen,split,grid,pip,talk}'::text[]));

create table if not exists live_talk_shows(
  id uuid primary key default gen_random_uuid(),
  title text not null,
  subtitle text not null default '',
  topic text not null default '',
  status text not null default 'draft',
  layout text not null default 'host-guest',
  source_ids jsonb not null default '[]'::jsonb,
  ava_enabled boolean not null default true,
  mia_enabled boolean not null default true,
  chat_enabled boolean not null default true,
  advertising_enabled boolean not null default true,
  advertising_interval_minutes integer not null default 20,
  accent_color text not null default '#22d3ee',
  planned_at timestamptz,
  started_at timestamptz,
  ended_at timestamptz,
  last_ad_at timestamptz,
  created_by uuid references users(id) on delete set null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint live_talk_status_valid check(status=any('{draft,ready,on_air,ended,archived,error}'::text[])),
  constraint live_talk_layout_valid check(layout=any('{host-guest,interview,panel,townhall}'::text[])),
  constraint live_talk_sources_array check(jsonb_typeof(source_ids)='array'),
  constraint live_talk_ad_interval_valid check(advertising_interval_minutes between 5 and 180),
  constraint live_talk_accent_valid check(accent_color ~ '^#[0-9a-fA-F]{6}$')
);

create index if not exists idx_live_talk_shows_status
  on live_talk_shows(status,coalesce(planned_at,created_at) desc);

insert into live_talk_shows(
  title,subtitle,topic,status,layout,source_ids,ava_enabled,mia_enabled,chat_enabled,
  advertising_enabled,advertising_interval_minutes,accent_color
)
select
  'AVA Live Talk',
  'Menschen, Perspektiven und Publikumsfragen live im Studio',
  'AVA führt durch ein offenes Live-Gespräch. Mia bündelt Zuschauerfragen; die Regie kann Gäste und Werbung kontrolliert übernehmen.',
  'draft',
  'host-guest',
  '[]'::jsonb,
  true,
  true,
  true,
  true,
  20,
  '#22d3ee'
where not exists(
  select 1 from live_talk_shows where title='AVA Live Talk' and status<>'archived'
);

alter table live_studio_settings
  drop constraint if exists live_studio_settings_talk_show_id_fkey;
alter table live_studio_settings
  add constraint live_studio_settings_talk_show_id_fkey
  foreign key(talk_show_id) references live_talk_shows(id) on delete set null;

create table if not exists live_talk_portal_invitations(
  id uuid primary key default gen_random_uuid(),
  show_id uuid not null references live_talk_shows(id) on delete cascade,
  portal_invitation_id uuid not null,
  display_name text not null,
  invitation_url text not null,
  status text not null default 'open',
  source_id uuid,
  expires_at timestamptz not null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique(portal_invitation_id),
  constraint live_talk_invitation_status_valid check(status=any('{open,accepted,expired,revoked}'::text[]))
);

insert into overlay_templates(name,category,snapshot)
values(
  'ava-live-talk',
  'live',
  '{
    "name":"AVA Live Talk",
    "width":1920,
    "height":1080,
    "background":"transparent",
    "slot":"live-studio",
    "elements":[
      {"id":"talk-top","type":"shape","name":"Studio Kopfzeile","x":28,"y":24,"width":1864,"height":86,"zIndex":1,"props":{"background":"rgba(3,9,17,0.88)","borderColor":"#22d3ee","borderWidth":2,"borderRadius":20}},
      {"id":"talk-kicker","type":"text","name":"Sendungsname","x":62,"y":43,"width":900,"height":48,"zIndex":2,"props":{"text":"AVA LIVE TALK","fontSize":28,"fontWeight":"900","color":"#67e8f9"}},
      {"id":"talk-live","type":"text","name":"Live Kennzeichnung","x":1650,"y":43,"width":190,"height":48,"zIndex":2,"props":{"text":"● LIVE","fontSize":25,"fontWeight":"900","color":"#fb7185"}}
    ]
  }'::jsonb
)
on conflict(name) do update set snapshot=excluded.snapshot,category=excluded.category;

with template as (
  select snapshot from overlay_templates where name='ava-live-talk'
),
project as (
  insert into overlay_projects(name,width,height,status,template,version)
  select 'AVA Live Talk · Gäste & Panel',1920,1080,'published','live-studio',1
  where not exists(
    select 1 from overlay_projects where name='AVA Live Talk · Gäste & Panel' and deleted_at is null
  )
  returning id
),
selected as (
  select id from project
  union all
  select id from overlay_projects
  where name='AVA Live Talk · Gäste & Panel' and deleted_at is null
  order by id limit 1
)
insert into overlay_versions(project_id,version,snapshot,published,status,label)
select selected.id,1,template.snapshot,true,'published','AVA Live Talk'
from selected cross join template
where not exists(select 1 from overlay_versions where project_id=selected.id);

with overlay as (
  select id from overlay_projects
  where name='AVA Live Talk · Gäste & Panel' and deleted_at is null
  order by created_at limit 1
)
insert into broadcast_templates(
  name,system_key,description,content_mode,layout,overlay_project_id,
  default_duration_minutes,default_item_count,color,icon,settings,active,is_system,flow
)
select
  'AVA Live Talk',
  'ava-live-talk',
  'Live-Gespräch mit AVA, einem oder mehreren Gästen aus dem sicheren Live-Portal, Publikumsfragen und Werbe-Cues.',
  'youtube-context',
  'custom',
  overlay.id,
  60,
  1,
  '#22d3ee',
  'radio',
  '{
    "kind":"live-talk",
    "livePortal":true,
    "avaHost":true,
    "miaAudience":true,
    "advertising":true,
    "defaultLayout":"host-guest"
  }'::jsonb,
  true,
  true,
  '{
    "version":1,
    "contentMode":"live-talk",
    "layout":"live-studio",
    "phases":["lobby","intro","talk","audience","advertising","outro"]
  }'::jsonb
from overlay
on conflict(system_key) where system_key is not null do update set
  name=excluded.name,
  description=excluded.description,
  overlay_project_id=coalesce(excluded.overlay_project_id,broadcast_templates.overlay_project_id),
  settings=broadcast_templates.settings || excluded.settings,
  flow=excluded.flow,
  active=true,
  updated_at=now();
