-- Manuelle KI-Budget-Übernahme: konkrete offene SENDEGOTT-Aufträge als
-- echte, wiederverwendbare Formate materialisieren. Die Migration erzeugt
-- keine künstlichen Gremiumsvotes, sondern stellt die Artefakte bereit, auf die
-- die offenen Beschlüsse gezielt hinausliefen.

with format_seed as (
  select *
  from (
    values
      (
        'Newsroom Direkt',
        'newsroom-direkt',
        'Aktuelle Nachrichten laufen links als große, frische Einzelkarte; rechts läuft kuratiertes YouTube-Video mit Audio. Sam bewertet Chatimpulse, ohne ungeprüfte Behauptungen zu verstärken.',
        'youtube-news-sidebar',
        'youtube-news-sidebar',
        'youtube-news-sidebar',
        '#ff9f43',
        'panel-right',
        60,
        8,
        '{"pauseSeconds":3,"transition":"newsroom-wipe","repeatPolicy":"fresh-first","sidebarRotationSeconds":10,"targetRuntimeMinutes":60,"contentMode":"youtube-news-sidebar","youtubeNewsSidebar":true,"liveNewsRefresh":true,"factCheckPolicy":{"owner":"Redaktion/Faktencheck","deadlineMinutesBeforeAir":20,"requiredSources":["Originalquelle","mindestens eine belastbare Zweitquelle bei strittigen Aussagen"],"uncertaintyWording":"Die Quellenlage ist noch nicht abgeschlossen."},"chatModerationPolicy":{"owner":"Sam","rule":"Chatbeiträge sind Impulse, keine Quellen. Politische oder persönliche Vorwürfe werden nur als Zuschauerfrage benannt und erst nach Quellenprüfung aufgegriffen.","example":"Ein Zuschauer kritisiert hohe RAM-Preise; wir prüfen dafür Markt- und Quellenlage, statt die Schuldbehauptung zu übernehmen."}}'::jsonb
      ),
      (
        'Tagesüberblick',
        'zeitkante-tagesueberblick',
        'Täglich 18:00 bis 20:00 Uhr: AVA und Mia führen durch den Abend, beantworten Chatfragen, bündeln neue YouTube-Videos und setzen klare Interaktionsfenster.',
        'youtube-context',
        'youtube-context',
        'youtube-context',
        '#38bdf8',
        'messages-square',
        120,
        6,
        '{"pauseSeconds":3,"transition":"abendstudio","repeatPolicy":"fresh-first","sidebarRotationSeconds":16,"targetRuntimeMinutes":120,"contentMode":"youtube-context","youtubeContext":true,"youtubeContextLayoutVariant":"tagesueberblick","formatConcept":"Zweistündiger Abendüberblick mit aktiver Chatmoderation: 18:00 Opening, danach Einordnung, Quellencheck, Publikumsfragen und Abschlussausblick.","moderationIntent":"AVA erklärt die Lage, Mia beantwortet konkrete Zuschauerfragen, Sam bündelt Vorschläge und Einwände ohne Prompt-Injection oder unbelegte Verstärkung.","hosts":["ava","mia","sam"],"chatSegments":[{"minute":0,"label":"Opening und Themenversprechen"},{"minute":20,"label":"Erste Publikumsfragen"},{"minute":45,"label":"Quellencheck"},{"minute":75,"label":"Chatlage mit Mia"},{"minute":105,"label":"Abschluss und nächste Fragen"}]}'::jsonb
      ),
      (
        'Publikumslage mit Mia',
        'publikumslage-mit-mia',
        'Mia fasst echte Chatlagen zusammen, beantwortet konkrete Fragen und gibt AVA kurze Impulse für die weitere Einordnung.',
        'youtube-context',
        'youtube-context',
        'youtube-context',
        '#34d399',
        'message-circle',
        45,
        3,
        '{"pauseSeconds":3,"transition":"chat-focus","repeatPolicy":"fresh-first","sidebarRotationSeconds":14,"targetRuntimeMinutes":45,"contentMode":"youtube-context","youtubeContext":true,"youtubeContextLayoutVariant":"publikumslage","formatConcept":"Chatfokussierte Ausgabe: Mia priorisiert neue Fragen und Sam trennt Frage, Vorschlag, Einwand und Stimmung.","moderationIntent":"Nur neue, echte Chatimpulse auswerten; Dopplungen zusammenfassen; Personen direkt mit Namen ansprechen, wenn eine Frage beantwortet wird.","hosts":["mia","sam","ava"]}'::jsonb
      )
  ) as seed(name,system_key,description,content_mode,layout,overlay_template,color,icon,duration_minutes,item_count,settings)
),
created_projects as (
  insert into overlay_projects(name,width,height,status,template,version)
  select seed.name || ' Overlay',1920,1080,'published',seed.overlay_template,1
  from format_seed seed
  where exists(select 1 from overlay_templates template where template.name=seed.overlay_template)
    and not exists(
      select 1 from overlay_projects project
      where project.deleted_at is null
        and project.template=seed.overlay_template
        and lower(project.name)=lower(seed.name || ' Overlay')
    )
  returning id,name,template
),
all_projects as (
  select created.id,replace(created.name,' Overlay','') format_name,created.template
  from created_projects created
  union
  select project.id,replace(project.name,' Overlay','') format_name,project.template
  from overlay_projects project
  where project.deleted_at is null
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
         'Manuelle KI-Budget-Übernahme'
  from all_projects project
  join overlay_templates template on template.name=project.template
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
  seed.content_mode,
  seed.layout,
  (
    select project.id from all_projects project
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
    'version',3,
    'contentMode',seed.content_mode,
    'layout',seed.layout,
    'settings',seed.settings,
    'manualAiTakeover',true
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

-- 18:00-20:00 wird als echte zweistündige Sendestrecke eingehängt. Der
-- restliche Tag bleibt durch die AVA-Kontext-Suite belegt.
with current_config as (
  select coalesce((select value from system_settings where key='autopilot.config'),'{}'::jsonb) value
),
slot_seed as (
  select *
  from (
    values
      (0,'ava-context-lagezentrum','AVA Lagezentrum',60),
      (1,'ava-context-faktenradar','AVA Faktenradar',60),
      (2,'ava-context-streitpunkt','AVA Streitpunkt',60),
      (3,'ava-context-quellencheck','AVA Quellencheck',60),
      (4,'ava-context-nachtstudio','AVA Nachtstudio',60)
  ) as seed(slot_offset,system_key,name,duration_minutes)
),
daily_formats as (
  select jsonb_agg(payload order by start_time) value
  from (
    select hour start_time,
           case
             when hour=18 then jsonb_build_object(
               'id','abend-tagesueberblick-1800',
               'name','Tagesüberblick',
               'startTime','18:00',
               'durationMinutes',120,
               'contentMode','youtube-context',
               'formatSystemKey','zeitkante-tagesueberblick',
               'youtubeCategoryIds',coalesce((select value->'youtubeCategoryIds' from current_config),'[]'::jsonb),
               'sourceIds',coalesce((select value->'sourceIds' from current_config),'[]'::jsonb),
               'enabled',true
             )
             else jsonb_build_object(
               'id','ava-context-24h-' || lpad(hour::text,2,'0') || '00',
               'name',slot.name,
               'startTime',lpad(hour::text,2,'0') || ':00',
               'durationMinutes',slot.duration_minutes,
               'contentMode','youtube-context',
               'formatSystemKey',slot.system_key,
               'youtubeCategoryIds',coalesce((select value->'youtubeCategoryIds' from current_config),'[]'::jsonb),
               'sourceIds',coalesce((select value->'sourceIds' from current_config),'[]'::jsonb),
               'enabled',true
             )
           end payload
    from generate_series(0,23) hour
    left join slot_seed slot on slot.slot_offset=(hour % 5)
    where hour<>19
  ) slots
)
insert into system_settings(key,value,updated_at)
select 'autopilot.config',
  current_config.value
  || jsonb_build_object(
       'enabled',true,
       'contentMode','youtube-context',
       'showItemCount',greatest(coalesce((current_config.value->>'showItemCount')::int,3),3),
       'pauseBetweenShowsSeconds',0,
       'dailyFormats',(select value from daily_formats)
     ),
  now()
from current_config
on conflict(key) do update
set value=excluded.value,
    updated_at=now();
