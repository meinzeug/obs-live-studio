-- Ein echtes On-Air-Ensemble aus drei Frauen und drei Männern sowie eine
-- persistente Regie für KI-Diskussionsrunden. Die Avatarvideos werden bewusst
-- nicht vorgetäuscht: Das KI-Studio kann pro Person ein Ruhe- und Sprechvideo
-- hochladen, sobald das freigegebene Material vorliegt.

alter table ai_presenter_profiles
  add column if not exists tts_provider text not null default '';

insert into ai_staff_members(
  id,display_name,job_title,role,description,enabled,autonomy,avatar_style,accent_color,instructions,config
)
values
  (
    'presenter-lea','Lea','Wissenschaftsmoderatorin','moderator',
    'Erklärt Daten, Forschung und technische Zusammenhänge verständlich und trennt Befund, Interpretation und offene Frage.',
    true,'auto','host','#22d3ee',
    'Sprich klar, ruhig und quellenorientiert. Vereinfache Begriffe, aber nicht die Fakten.',
    '{"genderPresentation":"female","discussionRole":"explainer","specialties":["Wissenschaft","Technologie","Daten"],"liveFrequency":"balanced","contextDepth":"detailed"}'::jsonb
  ),
  (
    'presenter-leon','Leon','Politikmoderator','moderator',
    'Strukturiert politische Streitfragen, fordert Belege ein und achtet auf eine faire Trennung von Nachricht und Meinung.',
    true,'auto','host','#60a5fa',
    'Frage präzise nach Zuständigkeit, Beleg und konkreter Folge. Keine Partei ergreifen.',
    '{"genderPresentation":"male","discussionRole":"challenger","specialties":["Politik","Gesellschaft","Recht"],"liveFrequency":"balanced","contextDepth":"detailed"}'::jsonb
  ),
  (
    'presenter-jonas','Jonas','Wirtschaftsmoderator','moderator',
    'Ordnet wirtschaftliche Aussagen anhand von Zahlen, Anreizen, Verteilungswirkungen und zeitlichem Kontext ein.',
    true,'auto','host','#f59e0b',
    'Erkläre Zahlen in verständlichen Größenordnungen und kennzeichne Schätzungen ausdrücklich.',
    '{"genderPresentation":"male","discussionRole":"analyst","specialties":["Wirtschaft","Energie","Arbeit"],"liveFrequency":"balanced","contextDepth":"detailed"}'::jsonb
  ),
  (
    'presenter-karim','Karim','Publikumsanwalt','moderator',
    'Bringt nachvollziehbare Zuschauerperspektiven in die Runde ein und übersetzt Fachdebatten in konkrete Alltagsfragen.',
    true,'auto','host','#a78bfa',
    'Vertrete keine erfundene Mehrheitsmeinung. Benenne, ob ein Impuls aus dem Chat oder aus der Redaktion stammt.',
    '{"genderPresentation":"male","discussionRole":"audience-advocate","specialties":["Publikum","Kultur","Alltag"],"liveFrequency":"active","contextDepth":"balanced"}'::jsonb
  )
on conflict(id) do update
set display_name=excluded.display_name,
    job_title=excluded.job_title,
    description=excluded.description,
    enabled=true,
    avatar_style=excluded.avatar_style,
    accent_color=excluded.accent_color,
    instructions=excluded.instructions,
    config=ai_staff_members.config || excluded.config,
    updated_at=now();

update ai_staff_members
set config=config || jsonb_build_object(
      'genderPresentation','female',
      'discussionRole',case when id='moderator' then 'lead-moderator' else 'audience-moderator' end
    ),
    updated_at=now()
where id in ('moderator','chat-moderator')
  and (
    config->>'genderPresentation' is distinct from 'female'
    or config->>'discussionRole' is null
  );

insert into ai_presenter_profiles(staff_member_id,tts_provider,tts_voice)
values
  ('moderator','pocket-tts','anna'),
  ('chat-moderator','pocket-tts','vera'),
  ('presenter-lea','piper','de_DE-dii-high'),
  ('presenter-leon','pocket-tts','alba'),
  ('presenter-jonas','pocket-tts','juergen'),
  ('presenter-karim','piper','de_DE-thorsten-high')
on conflict(staff_member_id) do update
set tts_provider=case
      when ai_presenter_profiles.tts_provider='' then excluded.tts_provider
      else ai_presenter_profiles.tts_provider
    end,
    tts_voice=case
      when ai_presenter_profiles.tts_voice='' then excluded.tts_voice
      else ai_presenter_profiles.tts_voice
    end,
    updated_at=now();

create table if not exists ai_roundtable_settings(
  id boolean primary key default true,
  enabled boolean not null default true,
  status text not null default 'standby',
  preset text not null default 'studio-rundtisch',
  topic text not null default 'Welche Themen bewegen das Publikum heute?',
  moderator_id text not null default 'moderator' references ai_staff_members(id),
  participant_ids text[] not null default array[
    'moderator','chat-moderator','presenter-lea','presenter-leon','presenter-jonas','presenter-karim'
  ],
  current_speaker_id text references ai_staff_members(id),
  current_turn_index int not null default 0,
  turn_duration_seconds int not null default 35,
  max_rounds int not null default 3,
  chat_enabled boolean not null default true,
  fact_check_enabled boolean not null default true,
  audience_prompt text not null default 'Welche Position überzeugt euch – und warum? Schreibt es in den Chat.',
  started_at timestamptz,
  updated_at timestamptz not null default now(),
  constraint ai_roundtable_settings_singleton check(id),
  constraint ai_roundtable_status_valid check(status in ('standby','preparing','live','paused','ended','error')),
  constraint ai_roundtable_preset_valid check(preset in ('studio-rundtisch','fakten-duell','publikumsforum')),
  constraint ai_roundtable_duration_valid check(turn_duration_seconds between 12 and 180),
  constraint ai_roundtable_rounds_valid check(max_rounds between 1 and 12),
  constraint ai_roundtable_participants_valid check(cardinality(participant_ids) between 2 and 6)
);

insert into ai_roundtable_settings(id) values(true) on conflict(id) do nothing;

create table if not exists ai_roundtable_turns(
  id uuid primary key default gen_random_uuid(),
  speaker_id text not null references ai_staff_members(id),
  turn_index int not null,
  round_number int not null,
  kind text not null default 'position',
  headline text not null,
  text text not null,
  audience_prompt text,
  source_labels text[] not null default '{}',
  model text,
  tier text,
  audio_path text,
  status text not null default 'ready',
  starts_at timestamptz not null default now(),
  ends_at timestamptz not null,
  created_at timestamptz not null default now(),
  constraint ai_roundtable_turn_kind_valid check(kind in ('opening','position','response','fact-check','audience','closing')),
  constraint ai_roundtable_turn_status_valid check(status in ('preparing','ready','live','completed','failed')),
  constraint ai_roundtable_turn_tier_valid check(tier is null or tier in ('free','paid','local'))
);

create index if not exists idx_ai_roundtable_turns_current
  on ai_roundtable_turns(status,starts_at desc,turn_index desc);

-- Das Projekt macht das Format im bestehenden Overlay-Manager sichtbar und
-- editierbar. Die dynamischen Sprecherflächen rendert die Rundtisch-Route.
insert into overlay_templates(name,category,snapshot)
select
  'ai-roundtable',
  'Live & KI',
  jsonb_build_object(
    'schemaVersion',1,'template','ai-roundtable','width',1920,'height',1080,
    'updatedAt',now(),
    'elements',jsonb_build_array(
      jsonb_build_object(
        'id','roundtable-background','type','shape','name','Studio Hintergrund',
        'x',0,'y',0,'width',1920,'height',1080,'rotation',0,'opacity',1,'zIndex',0,'locked',false,'hidden',false,
        'props',jsonb_build_object('background','#030712','borderColor','transparent','borderWidth',0,'borderRadius',0,'padding',0,'animation','none')
      ),
      jsonb_build_object(
        'id','roundtable-title','type','text','name','Sendungstitel',
        'x',72,'y',52,'width',1220,'height',72,'rotation',0,'opacity',1,'zIndex',10,'locked',false,'hidden',false,
        'binding','roundtable.title',
        'props',jsonb_build_object('text','KI STUDIO RUNDE','fontFamily','Inter','fontSize',42,'fontWeight','950','color','#ffffff','background','transparent','borderColor','transparent','borderWidth',0,'borderRadius',0,'padding',0,'align','left','animation','slide')
      )
    )
  )
where not exists(select 1 from overlay_templates where name='ai-roundtable');

with created as (
  insert into overlay_projects(name,width,height,status,template,version)
  select 'KI Studio Runde Overlay',1920,1080,'published','ai-roundtable',1
  where not exists(
    select 1 from overlay_projects where deleted_at is null and template='ai-roundtable'
  )
  returning id
),
project as (
  select id from created
  union all
  select id from overlay_projects
  where deleted_at is null and template='ai-roundtable'
  order by id
  limit 1
)
insert into overlay_versions(project_id,version,snapshot,published,status,label)
select project.id,1,template.snapshot,true,'published','KI-Rundtisch Systemdesign'
from project
join overlay_templates template on template.name='ai-roundtable'
where not exists(
  select 1 from overlay_versions version where version.project_id=project.id and version.status='published'
);

with roundtable_formats(name,system_key,description,color,icon,preset,concept) as (
  values
    (
      'KI Studio Runde','ai-roundtable-studio',
      'Sechs virtuelle Moderatorinnen und Moderatoren diskutieren ein aktuelles Thema in klar getakteten Runden.',
      '#22d3ee','users-round','studio-rundtisch',
      'Ausgewogene Studiodebatte mit Eröffnung, Positionen, Gegenfragen, Faktencheck und Publikumsfenster.'
    ),
    (
      'Fakten-Duell','ai-roundtable-fakten-duell',
      'Zwei Hauptpositionen treffen auf Faktenprüfung und Quellenkarten; der Chat liefert Gegenbelege und Fragen.',
      '#f59e0b','scan-search','fakten-duell',
      'Konzentrierte Kontroverse: Behauptung, Gegenposition, Beleglage und ein verständliches Zwischenfazit.'
    ),
    (
      'Publikumsforum KI','ai-roundtable-publikumsforum',
      'Chatbeiträge aus YouTube und Twitch bestimmen die Agenda einer moderierten virtuellen Zuschauerarena.',
      '#a78bfa','messages-square','publikumsforum',
      'Zuschauerimpulse werden von Sam geclustert, von Mia moderiert und von der Runde nachvollziehbar beantwortet.'
    )
)
insert into broadcast_templates(
  name,system_key,description,content_mode,layout,overlay_project_id,
  default_duration_minutes,default_item_count,color,icon,settings,is_system,active,flow
)
select
  format.name,format.system_key,format.description,'youtube-context','custom',
  (select id from overlay_projects where deleted_at is null and template='ai-roundtable' order by created_at desc limit 1),
  60,6,format.color,format.icon,
  jsonb_build_object(
    'contentMode','youtube-context','aiRoundtable',true,'roundtablePreset',format.preset,
    'formatConcept',format.concept,'chatAudience',true,'singleSpeakerLock',true,
    'transition','studio-sweep','targetRuntimeMinutes',60
  ),
  true,true,
  jsonb_build_object(
    'version',1,'contentMode','youtube-context','layout','custom','aiRoundtable',true,
    'roundtablePreset',format.preset,'formatIdea',format.concept
  )
from roundtable_formats format
on conflict(system_key) where system_key is not null do update
set name=excluded.name,
    description=excluded.description,
    overlay_project_id=excluded.overlay_project_id,
    color=excluded.color,
    icon=excluded.icon,
    settings=broadcast_templates.settings || excluded.settings,
    flow=excluded.flow,
    active=true,
    deleted_at=null,
    updated_at=now();
