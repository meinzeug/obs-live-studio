-- Ein Sendeformat ist die wiederverwendbare redaktionelle und visuelle
-- Vorlage. broadcast_playlists bleiben konkrete Ausstrahlungen im Zeitplan.
alter table broadcast_templates
  add column if not exists system_key text,
  add column if not exists description text,
  add column if not exists content_mode text not null default 'news',
  add column if not exists layout text not null default 'main-news',
  add column if not exists overlay_project_id uuid references overlay_projects(id) on delete set null,
  add column if not exists default_duration_minutes int not null default 30,
  add column if not exists default_item_count int not null default 8,
  add column if not exists color text not null default '#5690ff',
  add column if not exists icon text not null default 'clapperboard',
  add column if not exists settings jsonb not null default '{}',
  add column if not exists active boolean not null default true,
  add column if not exists is_system boolean not null default false,
  add column if not exists created_at timestamptz not null default now(),
  add column if not exists updated_at timestamptz not null default now(),
  add column if not exists deleted_at timestamptz;

alter table broadcast_templates drop constraint if exists broadcast_templates_content_mode_check;
alter table broadcast_templates add constraint broadcast_templates_content_mode_check
  check(content_mode in ('news','youtube','mixed','youtube-news-sidebar','youtube-context'));
alter table broadcast_templates drop constraint if exists broadcast_templates_layout_check;
alter table broadcast_templates add constraint broadcast_templates_layout_check
  check(layout in ('main-news','youtube-video','youtube-news-sidebar','youtube-context','custom'));
alter table broadcast_templates drop constraint if exists broadcast_templates_duration_check;
alter table broadcast_templates add constraint broadcast_templates_duration_check
  check(default_duration_minutes between 1 and 1440);
alter table broadcast_templates drop constraint if exists broadcast_templates_item_count_check;
alter table broadcast_templates add constraint broadcast_templates_item_count_check
  check(default_item_count between 1 and 100);
alter table broadcast_templates drop constraint if exists broadcast_templates_color_check;
alter table broadcast_templates add constraint broadcast_templates_color_check
  check(color ~ '^#[0-9A-Fa-f]{6}$');

alter table broadcast_templates drop constraint if exists broadcast_templates_name_key;
create unique index if not exists idx_broadcast_formats_active_name
  on broadcast_templates(lower(name)) where deleted_at is null;
create unique index if not exists idx_broadcast_formats_system_key
  on broadcast_templates(system_key) where system_key is not null;
create index if not exists idx_broadcast_formats_active
  on broadcast_templates(active,is_system,name) where deleted_at is null;

alter table broadcast_playlists
  add column if not exists format_id uuid references broadcast_templates(id) on delete set null;
create index if not exists idx_broadcast_playlists_format
  on broadcast_playlists(format_id,scheduled_at desc);

-- Die mitgelieferten Formate bilden alle heute ausführbaren Rundown-Typen ab.
-- Das Overlay wird nach Template aufgelöst; ein später im Designer gewähltes
-- Projekt kann im Format-Manager jederzeit ersetzt werden.
insert into broadcast_templates(
  name,system_key,description,content_mode,layout,overlay_project_id,
  default_duration_minutes,default_item_count,color,icon,settings,is_system,flow
)
select
  seed.name,seed.system_key,seed.description,seed.content_mode,seed.layout,
  (
    select op.id
    from overlay_projects op
    where op.deleted_at is null and op.template=seed.overlay_template
    order by (op.status='published') desc,op.created_at desc
    limit 1
  ),
  seed.duration_minutes,seed.item_count,seed.color,seed.icon,seed.settings,true,
  jsonb_build_object(
    'version',1,
    'contentMode',seed.content_mode,
    'layout',seed.layout,
    'settings',seed.settings
  )
from (
  values
    ('Nachrichten kompakt','news','Klassische Nachrichtensendung mit Sprechertext, Bildern und Videos.','news','main-news','main-news',30,8,'#31c6b1','newspaper',
      '{"pauseSeconds":5,"transition":"fade","repeatPolicy":"recent-published","targetRuntimeMinutes":30,"contentMode":"news"}'::jsonb),
    ('YouTube Programm','youtube','YouTube-Videos mit eigenem Quellenrahmen und Folgehinweis.','youtube','youtube-video','youtube-video',60,3,'#ff4d64','youtube',
      '{"pauseSeconds":3,"transition":"fade","repeatPolicy":"none","targetRuntimeMinutes":60,"contentMode":"youtube"}'::jsonb),
    ('YouTube + News-Sidebar','youtube-news-sidebar','YouTube rechts; links rotiert jeweils eine aktuelle Nachricht ohne Sprecher-Audio.','youtube-news-sidebar','youtube-news-sidebar','youtube-news-sidebar',60,4,'#ff9f43','panel-right',
      '{"pauseSeconds":3,"transition":"fade","repeatPolicy":"none","sidebarRotationSeconds":12,"targetRuntimeMinutes":60,"contentMode":"youtube-news-sidebar","youtubeNewsSidebar":true}'::jsonb),
    ('YouTube-Einordnung mit AVA','youtube-context','AVA und das KI-Redaktionsteam ordnen ein YouTube-Video live ein.','youtube-context','youtube-context','youtube-context',60,2,'#00c8ff','sparkles',
      '{"pauseSeconds":3,"transition":"headline","repeatPolicy":"none","sidebarRotationSeconds":18,"targetRuntimeMinutes":60,"contentMode":"youtube-context","youtubeContext":true}'::jsonb),
    ('Magazin gemischt','mixed','Abwechslungsreiches Magazin aus Nachrichtenbeiträgen und YouTube-Videos.','mixed','main-news','main-news',45,10,'#9b7bff','layout-grid',
      '{"pauseSeconds":5,"transition":"bumper","repeatPolicy":"none","targetRuntimeMinutes":45,"contentMode":"mixed"}'::jsonb)
) as seed(name,system_key,description,content_mode,layout,overlay_template,duration_minutes,item_count,color,icon,settings)
where not exists(
  select 1 from broadcast_templates existing
  where existing.deleted_at is null and existing.system_key=seed.system_key
);

-- Neue Sendungen erhalten auch aus älteren Aufrufern und aus dem Autopiloten
-- automatisch ein passendes Format. Konkrete Sendungseinstellungen gewinnen
-- dabei immer gegen die Standardwerte der Vorlage.
create or replace function assign_broadcast_format_to_playlist()
returns trigger language plpgsql as $$
declare
  selected_format broadcast_templates%rowtype;
  inferred_key text;
begin
  inferred_key := case
    when coalesce(new.settings->>'contentMode','')='youtube-context'
      or coalesce((new.settings->>'youtubeContext')::boolean,false) then 'youtube-context'
    when coalesce(new.settings->>'contentMode','')='youtube-news-sidebar'
      or coalesce((new.settings->>'youtubeNewsSidebar')::boolean,false) then 'youtube-news-sidebar'
    when coalesce(new.settings->>'contentMode','')='youtube' then 'youtube'
    when coalesce(new.settings->>'contentMode','')='mixed' then 'mixed'
    else 'news'
  end;

  if new.format_id is not null then
    select * into selected_format
    from broadcast_templates
    where id=new.format_id and deleted_at is null and active=true;
  else
    select * into selected_format
    from broadcast_templates
    where system_key=inferred_key and deleted_at is null and active=true;
    new.format_id := selected_format.id;
  end if;

  if selected_format.id is not null then
    new.settings := coalesce(selected_format.settings,'{}'::jsonb) || coalesce(new.settings,'{}'::jsonb);
    new.overlay_project_id := coalesce(new.overlay_project_id,selected_format.overlay_project_id);
  end if;
  return new;
end;
$$;

drop trigger if exists trg_broadcast_playlist_format on broadcast_playlists;
create trigger trg_broadcast_playlist_format
before insert on broadcast_playlists
for each row execute function assign_broadcast_format_to_playlist();

update broadcast_playlists bp
set format_id=f.id
from broadcast_templates f
where bp.format_id is null
  and f.deleted_at is null
  and f.active=true
  and f.system_key=case
    when coalesce(bp.settings->>'contentMode','')='youtube-context'
      or coalesce((bp.settings->>'youtubeContext')::boolean,false) then 'youtube-context'
    when coalesce(bp.settings->>'contentMode','')='youtube-news-sidebar'
      or coalesce((bp.settings->>'youtubeNewsSidebar')::boolean,false) then 'youtube-news-sidebar'
    when coalesce(bp.settings->>'contentMode','')='youtube' then 'youtube'
    when coalesce(bp.settings->>'contentMode','')='mixed' then 'mixed'
    else 'news'
  end;
