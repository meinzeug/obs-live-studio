-- Ein einziges, vollständig produziertes Politik-Comedy-Format. AVA und Leon
-- wechseln sich seriell ab; alle Pointen bleiben transkriptgebunden und klar
-- als Satire markiert. Das vorhandene youtube-context Laufzeitsystem bleibt
-- die einzige Quelle für Playback, Chat, TTS und OBS-Steuerung.

update ai_staff_members
set description='Politikmoderator und Co-Host von „Politik im Schleudergang“. Leon prüft politische Floskeln, Widersprüche und Logiklücken mit trockenem Humor, ohne Personen herabzusetzen.',
    instructions='Sprich trocken, präzise und fair. Pointen richten sich ausschließlich gegen belegte Widersprüche, Floskeln, Zuständigkeits-Pingpong oder absurde Situationen aus dem vorliegenden Transkript. Erfinde keine Aussagen oder Zitate. Kein Spott über private Personen, Herkunft, Religion, Geschlecht, Behinderung, Aussehen, Krankheit, Opfer oder menschliches Leid. Bei Gewalt, Tod, Katastrophen und persönlichen Schicksalen bleibst du sachlich. Trenne Satire, Nachricht und offenen Prüfbedarf hörbar.',
    config=config || jsonb_build_object(
      'liveFrequency','active',
      'contextDepth','detailed',
      'responseDetail','compact',
      'speechPace','dynamic',
      'comedyHost',true,
      'comedyStyle','dry',
      'singleSpeakerLock',true,
      'specialties',jsonb_build_array('Politik','Gesellschaft','Recht','Satire')
    ),
    enabled=true,
    autonomy='auto',
    updated_at=now()
where id='presenter-leon';

insert into ai_presenter_media(
  staff_member_id,state,original_filename,original_path,rendered_path,thumbnail_path,
  mime_type,sha256,width,height,duration_seconds,green_screen,managed
)
values
  (
    'presenter-leon','idle','leon-presenter.png',
    './media/presenters/leon/leon-presenter.png',
    './media/presenters/leon/leon-idle.webm',
    './media/presenters/leon/leon-presenter.png',
    'video/webm','a0c3871563bcea4ab4c8d1577ed8b479218cba82807422b6bbc129e2106e0021',
    1080,1440,6,false,false
  ),
  (
    'presenter-leon','speaking','leon-presenter.png',
    './media/presenters/leon/leon-presenter.png',
    './media/presenters/leon/leon-speaking.webm',
    './media/presenters/leon/leon-presenter.png',
    'video/webm','a3205e696b08b6e333d193026894176bde4e35f192619bc1f68974e7476c55db',
    1080,1440,6,false,false
  )
on conflict(staff_member_id,state) do nothing;

insert into overlay_projects(name,width,height,status,template,version)
select 'Politik im Schleudergang Overlay',1920,1080,'published','youtube-context',1
where not exists(
  select 1 from overlay_projects
  where deleted_at is null and lower(name)=lower('Politik im Schleudergang Overlay')
);

with project as (
  select id
  from overlay_projects
  where deleted_at is null and lower(name)=lower('Politik im Schleudergang Overlay')
  order by created_at
  limit 1
),
source as (
  select snapshot
  from overlay_templates
  where name='youtube-context'
  limit 1
),
designed as (
  select
    project.id project_id,
    source.snapshot
      || jsonb_build_object(
        'name','Politik im Schleudergang Overlay',
        'formatVariant','politik-comedy',
        'formatIdentity',jsonb_build_object(
          'name','Politik im Schleudergang',
          'kicker','POLITIK · SATIRE · FAKTENCHECK',
          'accent','#fbbf24',
          'accentSoft','rgba(251,191,36,0.62)',
          'panelBackground','rgba(19,12,4,0.96)'
        ),
        'elements',
        coalesce(source.snapshot->'elements','[]'::jsonb)
        || jsonb_build_array(
          jsonb_build_object(
            'id','political-comedy-format-title','type','text','name','Sendungsformat Titel',
            'x',1312,'y',61,'width',528,'height',45,'rotation',0,'opacity',1,'zIndex',20,
            'locked',false,'hidden',false,'binding','youtubeContext.formatName',
            'props',jsonb_build_object(
              'fontFamily','Inter','fontSize',25,'fontWeight','950','color','#fde68a',
              'background','rgba(7,15,27,0.98)','borderColor','transparent','borderWidth',0,
              'borderRadius',0,'padding',5,'align','left','objectFit','contain',
              'text','Politik im Schleudergang','animation','slide'
            )
          ),
          jsonb_build_object(
            'id','political-comedy-satire-badge','type','text','name','Satire Kennzeichnung',
            'x',1648,'y',111,'width',192,'height',34,'rotation',0,'opacity',1,'zIndex',21,
            'locked',false,'hidden',false,
            'props',jsonb_build_object(
              'fontFamily','Inter','fontSize',13,'fontWeight','950','color','#120b02',
              'background','#fbbf24','borderColor','#fde68a','borderWidth',2,
              'borderRadius',17,'padding',6,'align','center','objectFit','contain',
              'text','SATIRE · BELEGT','animation','fade'
            )
          ),
          jsonb_build_object(
            'id','political-comedy-host-label','type','text','name','Moderatoren Label',
            'x',1320,'y',143,'width',310,'height',20,'rotation',0,'opacity',1,'zIndex',21,
            'locked',false,'hidden',false,
            'props',jsonb_build_object(
              'fontFamily','Inter','fontSize',13,'fontWeight','900','color','#fde68a',
              'background','transparent','borderColor','transparent','borderWidth',0,
              'borderRadius',0,'padding',0,'align','left','objectFit','contain',
              'text','AVA + LEON · POLITIK MIT POINTE','animation','slide'
            )
          )
        )
      ) snapshot
  from project cross join source
)
insert into overlay_versions(project_id,version,snapshot,published,status,label)
select
  designed.project_id,
  coalesce(
    (select max(existing.version) + 1 from overlay_versions existing where existing.project_id=designed.project_id),
    1
  ),
  designed.snapshot,
  true,
  'published',
  'Comedy-Flaggschiff Systemdesign'
from designed
where not exists(
  select 1 from overlay_versions
  where project_id=designed.project_id and status='published'
);

-- Bereits erzeugte Systemversionen erhalten Designkorrekturen idempotent.
-- Später vom Benutzer veröffentlichte Versionen besitzen ein anderes Label
-- und werden dadurch nicht überschrieben.
update overlay_versions version
set snapshot=jsonb_set(
  version.snapshot,
  '{elements}',
  (
    select jsonb_agg(
      case element->>'id'
        when 'political-comedy-format-title' then
          element
          || jsonb_build_object('x',1312,'y',61,'width',528,'height',45)
          || jsonb_build_object(
               'props',
               coalesce(element->'props','{}'::jsonb)
               || jsonb_build_object(
                    'fontSize',25,'color','#fde68a','background','rgba(7,15,27,0.98)',
                    'padding',5,'text','Politik im Schleudergang'
                  )
             )
        when 'political-comedy-satire-badge' then
          element
          || jsonb_build_object('x',1648,'y',111,'width',192,'height',34)
          || jsonb_build_object(
               'props',
               coalesce(element->'props','{}'::jsonb)
               || jsonb_build_object('fontSize',13,'borderRadius',17,'padding',6,'text','SATIRE · BELEGT')
             )
        when 'political-comedy-host-label' then
          element
          || jsonb_build_object('x',1320,'y',143,'width',310,'height',20)
          || jsonb_build_object(
               'props',
               coalesce(element->'props','{}'::jsonb)
               || jsonb_build_object('fontSize',13)
             )
        else element
      end
      order by ordinality
    )
    from jsonb_array_elements(version.snapshot->'elements') with ordinality as entry(element,ordinality)
  ),
  true
)
from overlay_projects project
where version.project_id=project.id
  and project.deleted_at is null
  and lower(project.name)=lower('Politik im Schleudergang Overlay')
  and version.label='Comedy-Flaggschiff Systemdesign';

insert into broadcast_templates(
  name,system_key,description,content_mode,layout,overlay_project_id,
  default_duration_minutes,default_item_count,color,icon,settings,is_system,active,flow
)
select
  'Politik im Schleudergang',
  'political-comedy-ava-leon',
  'AVA und Leon nehmen politische YouTube-Videos pointiert auseinander: transkriptgebunden, fair, sichtbar als Satire gekennzeichnet und mit Sams Fakten- und Chat-Radar.',
  'youtube-context',
  'youtube-context',
  (
    select id from overlay_projects
    where deleted_at is null and lower(name)=lower('Politik im Schleudergang Overlay')
    order by created_at limit 1
  ),
  60,
  3,
  '#fbbf24',
  'laugh',
  jsonb_build_object(
    'pauseSeconds',3,
    'transition','bumper',
    'repeatPolicy','fresh-first',
    'sidebarRotationSeconds',16,
    'targetRuntimeMinutes',60,
    'contentMode','youtube-context',
    'youtubeContext',true,
    'youtubeContextLayoutVariant','politik-comedy',
    'formatConcept','Politische Video-Reaction als hochwertige Late-Night-Satire: AVA liefert Orientierung, Leon den trockenen Gegencheck, Sam prüft Transkript und Chat.',
    'moderationIntent','AVA und Leon wechseln sich bei belegten Aussagen ab. Kurze Pointen entstehen nur aus dem Video-Transkript; Unsicherheit wird benannt und niemals mit einem Gag überspielt.',
    'hosts',jsonb_build_array('ava','presenter-leon','mia','sam'),
    'comedyMode',true,
    'satireLabel',true,
    'coHostId','presenter-leon',
    'avaRole',jsonb_build_object(
      'intensity','high',
      'targetIntervalSeconds',150,
      'minimumCommentariesPerHour',12,
      'role','lead-and-context',
      'prompt','Ordne die konkrete Aussage verständlich ein und übergib pointiert an Leon, wenn eine belegte Floskel oder Logiklücke vorliegt.'
    ),
    'coHostRole',jsonb_build_object(
      'id','presenter-leon',
      'name','Leon',
      'role','dry-political-satirist',
      'targetIntervalSeconds',180,
      'prompt','Formuliere höchstens zwei kurze Sätze: zuerst der konkrete Transkriptbezug, dann eine trockene Pointe. Keine erfundenen Zitate und keine persönliche Herabsetzung.'
    ),
    'miaRole',jsonb_build_object(
      'enabled',true,
      'interactionEnabled',true,
      'promptIntervalSeconds',300,
      'prompt','Welche Aussage verdient den nächsten Faktencheck? Schreibt sie in den Chat.'
    ),
    'samRole',jsonb_build_object(
      'enabled',true,
      'transcriptRequiredForComedy',true,
      'verifyClaimsBeforeComedy',true,
      'monitorChat',true,
      'suppressRepeatedTopics',true
    ),
    'hostChoreography',jsonb_build_object(
      'mode','political-comedy',
      'alternatingHosts',true,
      'openingHost','moderator',
      'coHostId','presenter-leon',
      'singleSpeakerLock',true,
      'voiceQueue','serial',
      'pauseVideoForContext',true,
      'keepVideoRollingForQuips',true,
      'maximumQuipWords',32
    ),
    'editorialSafety',jsonb_build_object(
      'transcriptGrounded',true,
      'factCheckRequired',true,
      'noFabricatedQuotes',true,
      'sameStandardForAllPoliticalActors',true,
      'noProtectedClassTargets',true,
      'noPrivatePersonRidicule',true,
      'sensitiveTopicComedy',false,
      'fallback','news-context-without-comedy'
    )
  ),
  true,
  true,
  jsonb_build_object(
    'version',1,
    'contentMode','youtube-context',
    'layout','youtube-context',
    'formatIdea','Ein pointiertes, aber quellengebundenes Politik-Comedy-Duo mit AVA und Leon.',
    'runOfShow',jsonb_build_array(
      jsonb_build_object('minute',0,'label','Cold Open mit AVA'),
      jsonb_build_object('minute',2,'label','Video und erste These'),
      jsonb_build_object('minute',8,'label','Leons Schleudergang'),
      jsonb_build_object('minute',18,'label','Sams Faktenradar'),
      jsonb_build_object('minute',28,'label','Chatfrage mit Mia'),
      jsonb_build_object('minute',45,'label','AVA/Leon Schlussrunde')
    )
  )
on conflict(system_key) where system_key is not null do update
set name=excluded.name,
    description=excluded.description,
    content_mode=excluded.content_mode,
    layout=excluded.layout,
    overlay_project_id=excluded.overlay_project_id,
    default_duration_minutes=excluded.default_duration_minutes,
    default_item_count=excluded.default_item_count,
    color=excluded.color,
    icon=excluded.icon,
    settings=broadcast_templates.settings || excluded.settings,
    flow=excluded.flow,
    is_system=true,
    active=true,
    deleted_at=null,
    updated_at=now();

-- Die derzeitige 24h-Rotation besitzt bewusst eine freie Primetime-Stunde.
-- Nur wenn 19:00 noch frei und das Format noch nicht verplant ist, wird die
-- Comedy-Ausgabe ergänzt; individuelle Nutzerpläne werden nicht überschrieben.
with current_config as (
  select coalesce(
    (select value from system_settings where key='autopilot.config'),
    '{}'::jsonb
  ) value
),
eligible as (
  select value
  from current_config
  where not exists(
          select 1
          from jsonb_array_elements(coalesce(value->'dailyFormats','[]'::jsonb)) slot
          where slot->>'formatSystemKey'='political-comedy-ava-leon'
        )
    and not exists(
          select 1
          from jsonb_array_elements(coalesce(value->'dailyFormats','[]'::jsonb)) slot
          where slot->>'startTime'='19:00' and coalesce((slot->>'enabled')::boolean,true)
        )
)
insert into system_settings(key,value,updated_at)
select
  'autopilot.config',
  eligible.value || jsonb_build_object(
    'dailyFormats',
    coalesce(eligible.value->'dailyFormats','[]'::jsonb)
    || jsonb_build_array(
      jsonb_build_object(
        'id','political-comedy-prime-1900',
        'name','Politik im Schleudergang',
        'startTime','19:00',
        'durationMinutes',60,
        'contentMode','youtube-context',
        'formatSystemKey','political-comedy-ava-leon',
        'youtubeCategoryIds',coalesce(eligible.value->'youtubeCategoryIds','[]'::jsonb),
        'sourceIds',coalesce(eligible.value->'sourceIds','[]'::jsonb),
        'enabled',true
      )
    )
  ),
  now()
from eligible
on conflict(key) do update
set value=excluded.value,
    updated_at=now();
