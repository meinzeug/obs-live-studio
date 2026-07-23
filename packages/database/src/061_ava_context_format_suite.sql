-- Fünf eigenständige AVA-Einordnungsformate für den dauerhaften
-- YouTube-Kontextbetrieb. Sie teilen die stabile youtube-context Engine,
-- unterscheiden sich aber über Format-Key, Layout-Variante, redaktionelle Idee
-- und OBS-Platzierung. Der Autopilot kann damit den Tag mit echten
-- wiederverwendbaren Sendeformaten statt einem einzigen generischen Format
-- füllen.

with format_seed as (
  select *
  from (
    values
      (
        'AVA Lagezentrum',
        'ava-context-lagezentrum',
        'Aktueller Lageüberblick: AVA sortiert neue YouTube-Quellen nach Relevanz, Chronologie und offenen Fragen.',
        '#00c8ff',
        'radar',
        60,
        3,
        '{"pauseSeconds":3,"transition":"headline","repeatPolicy":"fresh-first","sidebarRotationSeconds":16,"targetRuntimeMinutes":60,"contentMode":"youtube-context","youtubeContext":true,"youtubeContextLayoutVariant":"lagezentrum","formatConcept":"Lagezentrum mit schneller Orientierung, Quellenlage und klaren nächsten Fragen.","moderationIntent":"AVA erklärt zuerst, warum dieses Video jetzt relevant ist, und ordnet danach regelmäßig neue Aussagen ein."}'::jsonb
      ),
      (
        'AVA Faktenradar',
        'ava-context-faktenradar',
        'Behauptungen im Video werden sichtbar geprüft: Was ist belegt, was ist offen, was braucht Kontext?',
        '#22c55e',
        'shield-check',
        60,
        3,
        '{"pauseSeconds":3,"transition":"scan","repeatPolicy":"fresh-first","sidebarRotationSeconds":18,"targetRuntimeMinutes":60,"contentMode":"youtube-context","youtubeContext":true,"youtubeContextLayoutVariant":"faktenradar","formatConcept":"Faktenradar mit Claim-Karten, Beleglage und kompakten Quellenhinweisen.","moderationIntent":"AVA stoppt bei prüfbaren Aussagen, benennt Belege und macht Unsicherheiten transparent."}'::jsonb
      ),
      (
        'AVA Streitpunkt',
        'ava-context-streitpunkt',
        'Kontroverse Aussagen werden in Pro, Contra und Zuschauerfragen zerlegt, ohne den Sendefluss zu verlieren.',
        '#fb7185',
        'messages-square',
        60,
        3,
        '{"pauseSeconds":3,"transition":"debate","repeatPolicy":"fresh-first","sidebarRotationSeconds":20,"targetRuntimeMinutes":60,"contentMode":"youtube-context","youtubeContext":true,"youtubeContextLayoutVariant":"streitpunkt","formatConcept":"Debattenformat mit Gegenargumenten, Chatfragen und klar getrennten Perspektiven.","moderationIntent":"AVA formuliert die Streitfrage zugespitzt, Mia nimmt Chatimpulse auf, Sam bündelt neue Zuschauerpositionen."}'::jsonb
      ),
      (
        'AVA Quellencheck',
        'ava-context-quellencheck',
        'Die Redaktion schaut auf Herkunft, Kanal, Zitate, Primärquellen und belastbare Gegenchecks.',
        '#f59e0b',
        'files',
        60,
        3,
        '{"pauseSeconds":3,"transition":"document","repeatPolicy":"fresh-first","sidebarRotationSeconds":18,"targetRuntimeMinutes":60,"contentMode":"youtube-context","youtubeContext":true,"youtubeContextLayoutVariant":"quellencheck","formatConcept":"Quellenorientierte Einordnung mit Dokumentenlogik, Upload-Datum und Herkunft des Materials.","moderationIntent":"AVA fragt: Woher stammt die Aussage, wer belegt sie, welche Quelle fehlt noch?"}'::jsonb
      ),
      (
        'AVA Nachtstudio',
        'ava-context-nachtstudio',
        'Ruhiger Abend- und Nachtbetrieb: längere Videos, weniger Hektik, regelmäßige Zusammenfassungen und Chatantworten.',
        '#8b5cf6',
        'moon-star',
        60,
        2,
        '{"pauseSeconds":3,"transition":"soft-fade","repeatPolicy":"fresh-first","sidebarRotationSeconds":24,"targetRuntimeMinutes":60,"contentMode":"youtube-context","youtubeContext":true,"youtubeContextLayoutVariant":"nachtstudio","formatConcept":"Nachtstudio mit ruhiger Dramaturgie, Zusammenfassungen und gut lesbarer Quellenlage.","moderationIntent":"AVA fasst große Blöcke verständlich zusammen und Mia beantwortet neue Chatfragen ohne Dauerfeuer."}'::jsonb
      )
  ) as seed(name,system_key,description,color,icon,duration_minutes,item_count,settings)
),
created_projects as (
  insert into overlay_projects(name,width,height,status,template,version)
  select seed.name || ' Overlay',1920,1080,'published','youtube-context',1
  from format_seed seed
  where exists(select 1 from overlay_templates template where template.name='youtube-context')
    and not exists(
      select 1 from overlay_projects project
      where project.deleted_at is null
        and project.template='youtube-context'
        and lower(project.name)=lower(seed.name || ' Overlay')
    )
  returning id,name
),
all_projects as (
  select created.id,replace(created.name,' Overlay','') format_name
  from created_projects created
  union
  select project.id,replace(project.name,' Overlay','') format_name
  from overlay_projects project
  where project.deleted_at is null
    and project.template='youtube-context'
    and project.name in (select name || ' Overlay' from format_seed)
),
published_versions as (
  insert into overlay_versions(project_id,version,snapshot,published,status,label)
  select project.id,
         1,
         template.snapshot || jsonb_build_object(
           'name',project.format_name || ' Overlay',
           'formatVariant',(select settings->>'youtubeContextLayoutVariant' from format_seed where name=project.format_name)
         ),
         true,
         'published',
         'Systemformat'
  from all_projects project
  join overlay_templates template on template.name='youtube-context'
  where not exists(
    select 1 from overlay_versions version
    where version.project_id=project.id and version.status='published'
  )
  returning project_id
)
insert into broadcast_templates(
  name,system_key,description,content_mode,layout,overlay_project_id,
  default_duration_minutes,default_item_count,color,icon,settings,is_system,active,flow
)
select
  seed.name,
  seed.system_key,
  seed.description,
  'youtube-context',
  'youtube-context',
  (
    select project.id
    from all_projects project
    where project.format_name=seed.name
    limit 1
  ),
  seed.duration_minutes,
  seed.item_count,
  seed.color,
  seed.icon,
  seed.settings,
  true,
  true,
  jsonb_build_object(
    'version',2,
    'contentMode','youtube-context',
    'layout','youtube-context',
    'settings',seed.settings,
    'formatIdea',seed.description
  )
from format_seed seed
on conflict (system_key) where system_key is not null do update
set name=excluded.name,
    description=excluded.description,
    content_mode=excluded.content_mode,
    layout=excluded.layout,
    overlay_project_id=coalesce(excluded.overlay_project_id,broadcast_templates.overlay_project_id),
    default_duration_minutes=excluded.default_duration_minutes,
    default_item_count=excluded.default_item_count,
    color=excluded.color,
    icon=excluded.icon,
    settings=broadcast_templates.settings || excluded.settings,
    is_system=true,
    active=true,
    deleted_at=null,
    flow=excluded.flow,
    updated_at=now();

-- Konkrete Playlist-Einstellungen dürfen ein Systemformat erzwingen. Das ist
-- notwendig, damit der Autopilot nicht alle AVA-Varianten auf das generische
-- Format "youtube-context" zurückfallen lässt.
create or replace function assign_broadcast_format_to_playlist()
returns trigger language plpgsql as $$
declare
  selected_format broadcast_templates%rowtype;
  requested_key text;
  inferred_key text;
begin
  requested_key := nullif(coalesce(new.settings->>'broadcastFormatSystemKey',new.settings->>'formatSystemKey'),'');
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
  elsif requested_key is not null then
    select * into selected_format
    from broadcast_templates
    where system_key=requested_key and deleted_at is null and active=true;
    new.format_id := selected_format.id;
  else
    select * into selected_format
    from broadcast_templates
    where system_key=inferred_key and deleted_at is null and active=true;
    new.format_id := selected_format.id;
  end if;

  if selected_format.id is not null then
    new.settings := coalesce(selected_format.settings,'{}'::jsonb) || coalesce(new.settings,'{}'::jsonb);
    new.settings := jsonb_set(new.settings,'{broadcastFormatSystemKey}',to_jsonb(selected_format.system_key),true);
    new.overlay_project_id := coalesce(new.overlay_project_id,selected_format.overlay_project_id);
  end if;
  return new;
end;
$$;

-- Autopilot auf 24h AVA-Einordnungsbetrieb stellen. Es bleiben die bestehenden
-- Quellen/Kategorien erhalten; nur die Tagesstruktur wird auf die fünf
-- konkreten Formate gesetzt.
with current_config as (
  select coalesce((select value from system_settings where key='autopilot.config'),'{}'::jsonb) value
),
slot_seed as (
  select *
  from (
    values
      (0,'ava-context-lagezentrum','AVA Lagezentrum'),
      (1,'ava-context-faktenradar','AVA Faktenradar'),
      (2,'ava-context-streitpunkt','AVA Streitpunkt'),
      (3,'ava-context-quellencheck','AVA Quellencheck'),
      (4,'ava-context-nachtstudio','AVA Nachtstudio')
  ) as seed(slot_offset,system_key,name)
),
daily_formats as (
  select jsonb_agg(
    jsonb_build_object(
      'id','ava-context-24h-' || lpad((hour)::text,2,'0') || '00',
      'name',slot.name,
      'startTime',lpad((hour)::text,2,'0') || ':00',
      'durationMinutes',60,
      'contentMode','youtube-context',
      'formatSystemKey',slot.system_key,
      'youtubeCategoryIds',coalesce((select value->'youtubeCategoryIds' from current_config),'[]'::jsonb),
      'sourceIds',coalesce((select value->'sourceIds' from current_config),'[]'::jsonb),
      'enabled',true
    )
    order by hour
  ) value
  from generate_series(0,23) hour
  join slot_seed slot on slot.slot_offset=(hour % 5)
)
insert into system_settings(key,value,updated_at)
select 'autopilot.config',
  current_config.value
  || jsonb_build_object(
       'enabled',true,
       'contentMode','youtube-context',
       'showItemCount',greatest(coalesce((current_config.value->>'showItemCount')::int,3),3),
       'scanLimit',greatest(coalesce((current_config.value->>'scanLimit')::int,100),100),
       'pauseBetweenShowsSeconds',0,
       'sidebarRotationSeconds',greatest(coalesce((current_config.value->>'sidebarRotationSeconds')::int,18),18),
       'dailyFormats',(select value from daily_formats)
     ),
  now()
from current_config
on conflict(key) do update
set value=excluded.value,
    updated_at=now();

update autonomous_studio_settings
set enabled=true,
    operations_enabled=true,
    automatic_operational_actions=true,
    minimum_active_formats=greatest(minimum_active_formats,10),
    minimum_upcoming_shows=greatest(minimum_upcoming_shows,24),
    minimum_schedule_minutes=greatest(minimum_schedule_minutes,1440),
    schedule_horizon_hours=greatest(schedule_horizon_hours,24),
    updated_at=now()
where id=true;
