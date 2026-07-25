-- Zeitkante wird als klar gekennzeichneter Satire-Sender geführt. Das
-- Nachrichtenfundament bleibt quellenorientiert; die satirische Zuspitzung
-- findet erst in Moderation und Overlay statt. Die Primetime-Show erhält eine
-- feste Viererbesetzung aus AVA, MIA, Leon und Jonas.

insert into system_settings(key,value,updated_at)
values(
  'studio.editorial-profile',
  jsonb_build_object(
    'mode','satire',
    'label','SATIRE · FAKTENBASIS GEPRÜFT',
    'claim','Nachrichten, Einordnung und Satire mit Quellencheck',
    'defaultTone','pointed',
    'factBoundaryRequired',true,
    'satireDisclosureRequired',true,
    'sensitiveTopicsMode','factual-only',
    'privatePersonProtection',true,
    'sameStandardForAllPoliticalActors',true,
    'presenterRoster',jsonb_build_array(
      'moderator','chat-moderator','presenter-leon','presenter-jonas'
    )
  ),
  now()
)
on conflict(key) do update
set value=system_settings.value || excluded.value,
    updated_at=now();

insert into system_settings(key,value,updated_at)
values(
  'studio.identity',
  jsonb_build_object(
    'channelName','Zeitkante',
    'studioName','Zeitkante - TV Studio',
    'channelGenre','satire',
    'channelClaim','Nachrichten, Einordnung und Satire mit Quellencheck'
  ),
  now()
)
on conflict(key) do update
set value=system_settings.value || jsonb_build_object(
      'channelGenre','satire',
      'channelClaim','Nachrichten, Einordnung und Satire mit Quellencheck'
    ),
    updated_at=now();

update ai_staff_members
set description='Wirtschafts- und Datenmoderator im Zeitkante-Satireensemble. Jonas übersetzt Zahlen, Anreize und wirtschaftliche Folgen in verständliche Größenordnungen und pointierte, belegte Vergleiche.',
    instructions='Sprich ruhig, analytisch und mit trockenem Understatement. Nenne zuerst die konkrete Zahl oder wirtschaftliche Folge aus Transkript beziehungsweise Quellenpaket und formuliere danach höchstens eine kurze Pointe. Kennzeichne Schätzungen. Erfinde keine Zahlen, Zitate oder Kausalitäten. Kein Spott über private Personen, geschützte Merkmale, Opfer oder Leid. Bei Gewalt, Tod, Krankheit und Katastrophen bleibst du ausschließlich sachlich.',
    config=config || jsonb_build_object(
      'liveFrequency','active',
      'contextDepth','detailed',
      'responseDetail','compact',
      'speechPace','calm',
      'comedyHost',true,
      'comedyStyle','analytical-understatement',
      'singleSpeakerLock',true,
      'specialties',jsonb_build_array('Wirtschaft','Energie','Arbeit','Daten','Satire')
    ),
    enabled=true,
    autonomy='auto',
    updated_at=now()
where id='presenter-jonas';

update ai_staff_members
set instructions=case id
      when 'moderator' then
        'AVA führt durch den Satire-Sender: verständlich, neugierig, pointiert und quellengebunden. Trenne Nachricht, belegte Einordnung und Pointe hörbar. Übergib politische Widersprüche an Leon, Zahlen und wirtschaftliche Folgen an Jonas und Zuschauerfragen an MIA. Keine erfundenen Zitate, keine persönlichen Angriffe und keine Pointen über Leid oder geschützte Merkmale.'
      when 'chat-moderator' then
        'MIA macht das Publikum zum Teil der Satire-Show. Sprich Zuschauer respektvoll mit ihrem Namen an, greife echte Chatimpulse auf und beantworte Fragen nur aus dem redaktionell geprüften Quellenpaket. Formuliere lebendig und pointiert, aber nie auf Kosten des Zuschauers. AVA, Leon, Jonas und MIA sprechen niemals gleichzeitig.'
      else instructions
    end,
    config=config || jsonb_build_object(
      'satireChannel',true,
      'singleSpeakerLock',true,
      'presenterRoster',jsonb_build_array('moderator','chat-moderator','presenter-leon','presenter-jonas')
    ),
    updated_at=now()
where id in ('moderator','chat-moderator');

insert into ai_presenter_media(
  staff_member_id,state,original_filename,original_path,rendered_path,thumbnail_path,
  mime_type,sha256,width,height,duration_seconds,green_screen,managed
)
values
  (
    'presenter-jonas','idle','jonas-presenter.png',
    './media/presenters/jonas/jonas-presenter.png',
    './media/presenters/jonas/jonas-idle.webm',
    './media/presenters/jonas/jonas-presenter.png',
    'video/webm','2c8b6d94bd0410f684935ff31d3d4925c816b0ca0d444124f9eed912ca880046',
    1080,1440,6,false,false
  ),
  (
    'presenter-jonas','speaking','jonas-presenter.png',
    './media/presenters/jonas/jonas-presenter.png',
    './media/presenters/jonas/jonas-speaking.webm',
    './media/presenters/jonas/jonas-presenter.png',
    'video/webm','6c932319e858271f154ade7707bcf52951bd8aa142d9d1337c7448bf2b96f98e',
    1080,1440,6,false,false
  )
on conflict(staff_member_id,state) do update
set original_filename=excluded.original_filename,
    original_path=excluded.original_path,
    rendered_path=excluded.rendered_path,
    thumbnail_path=excluded.thumbnail_path,
    mime_type=excluded.mime_type,
    sha256=excluded.sha256,
    width=excluded.width,
    height=excluded.height,
    duration_seconds=excluded.duration_seconds,
    green_screen=excluded.green_screen,
    managed=excluded.managed,
    updated_at=now()
where ai_presenter_media.managed=false;

update broadcast_templates
set settings=settings || jsonb_build_object(
      'satireMode',true,
      'satireLabel',true,
      'satireDisclosure','SATIRE · FAKTENBASIS GEPRÜFT',
      'hostRoster',jsonb_build_array(
        'moderator','chat-moderator','presenter-leon','presenter-jonas'
      ),
      'coHostIds',jsonb_build_array('presenter-leon','presenter-jonas'),
      'coHostRoles',jsonb_build_object(
        'presenter-leon',jsonb_build_object(
          'name','Leon',
          'role','dry-political-satirist',
          'prompt','Prüfe die konkrete politische Aussage und formuliere anschließend höchstens eine trockene, transkriptgebundene Pointe.'
        ),
        'presenter-jonas',jsonb_build_object(
          'name','Jonas',
          'role','economics-data-satirist',
          'prompt','Nenne zuerst Zahl, Größenordnung oder wirtschaftliche Folge und schließe mit höchstens einer trockenen, belegten Pointe.'
        )
      ),
      'editorialSafety',coalesce(settings->'editorialSafety','{}'::jsonb) || jsonb_build_object(
        'factBoundaryRequired',true,
        'satireDisclosureRequired',true,
        'noFabricatedQuotes',true,
        'sameStandardForAllPoliticalActors',true,
        'noProtectedClassTargets',true,
        'noPrivatePersonRidicule',true,
        'sensitiveTopicComedy',false
      )
    ),
    flow=coalesce(flow,'{}'::jsonb) || jsonb_build_object(
      'channelEditorialMode','satire',
      'presenterRoster',jsonb_build_array(
        'moderator','chat-moderator','presenter-leon','presenter-jonas'
      ),
      'singleSpeakerLock',true
    ),
    updated_at=now()
where active=true
  and deleted_at is null
  and content_mode in ('youtube-context','youtube','youtube-news-sidebar','mixed','news');

update broadcast_templates
set description='AVA, MIA, Leon und Jonas nehmen politische YouTube-Videos gemeinsam auseinander: transkriptgebunden, fair, klar als Satire gekennzeichnet und mit Fakten- und Chat-Radar.',
    settings=settings || jsonb_build_object(
      'formatConcept','Vier Stimmen, eine Sendung: AVA führt, Leon prüft politische Floskeln, Jonas zerlegt Zahlen und wirtschaftliche Folgen, MIA bringt den Livechat ins Studio.',
      'moderationIntent','AVA, Leon und Jonas rotieren bei belegten Einordnungen; MIA übernimmt echte Publikumsimpulse. Die zentrale Sprechsperre verhindert Überschneidungen.',
      'hosts',jsonb_build_array('ava','mia','presenter-leon','presenter-jonas','sam'),
      'coHostId','presenter-leon',
      'coHostIds',jsonb_build_array('presenter-leon','presenter-jonas'),
      'hostChoreography',coalesce(settings->'hostChoreography','{}'::jsonb) || jsonb_build_object(
        'mode','satire-ensemble',
        'rotation',jsonb_build_array('moderator','presenter-leon','moderator','presenter-jonas'),
        'coHostId','presenter-leon',
        'coHostIds',jsonb_build_array('presenter-leon','presenter-jonas'),
        'singleSpeakerLock',true,
        'voiceQueue','serial'
      )
    ),
    flow=coalesce(flow,'{}'::jsonb) || jsonb_build_object(
      'formatIdea','Politische Satire mit vier klar unterscheidbaren Stimmen.',
      'runOfShow',jsonb_build_array(
        jsonb_build_object('minute',0,'label','Cold Open mit AVA'),
        jsonb_build_object('minute',5,'label','Leons politischer Schleudergang'),
        jsonb_build_object('minute',14,'label','Jonas rechnet nach'),
        jsonb_build_object('minute',24,'label','MIA holt den Chat ins Studio'),
        jsonb_build_object('minute',36,'label','AVA ordnet die Beleglage'),
        jsonb_build_object('minute',48,'label','Vierer-Finale mit Publikumsfrage')
      )
    ),
    updated_at=now()
where system_key='political-comedy-ava-leon'
  and deleted_at is null;

-- Auch die bestehenden AVA-Formate gehören sichtbar zum Satire-Sender, ohne
-- zu zusätzlichen Comedy-Formaten zu werden. Nachricht und Quellenkarten
-- bleiben sachlich; nur die Moderation erhält die kontrollierte Zuspitzung.
update broadcast_templates
set settings=settings || jsonb_build_object(
      'satireMode',true,
      'satireLabel',true,
      'comedyMode',false,
      'moderationIntent',coalesce(
        nullif(settings->>'moderationIntent',''),
        'Quellenorientiert einordnen und Widersprüche mit einer kurzen, fairen Pointe verständlich machen.'
      )
    ),
    updated_at=now()
where system_key in (
  'ava-context-lagezentrum',
  'ava-context-faktenradar',
  'ava-context-streitpunkt',
  'ava-context-quellencheck',
  'ava-context-nachtstudio',
  'zeitkante-tagesueberblick'
)
and deleted_at is null;

-- Bereits geplante oder aktuell laufende Einordnungssendungen erhalten die
-- Roster- und Satirefelder ebenfalls. Dadurch muss der Nutzer nicht bis zur
-- nächsten automatisch erzeugten Playlist warten.
update broadcast_items item
set rules=item.rules || jsonb_build_object(
      'satireMode',coalesce((format.settings->>'satireMode')::boolean,false),
      'satireLabel',coalesce((format.settings->>'satireLabel')::boolean,false),
      'hostRoster',coalesce(format.settings->'hostRoster','[]'::jsonb),
      'coHostId',format.settings->>'coHostId',
      'coHostIds',coalesce(format.settings->'coHostIds','[]'::jsonb),
      'coHostRole',coalesce(format.settings->'coHostRole','{}'::jsonb),
      'coHostRoles',coalesce(format.settings->'coHostRoles','{}'::jsonb),
      'hostChoreography',coalesce(format.settings->'hostChoreography','{}'::jsonb),
      'editorialSafety',coalesce(format.settings->'editorialSafety','{}'::jsonb)
    )
from broadcast_playlists playlist
join broadcast_templates format on format.id=playlist.format_id
where item.playlist_id=playlist.id
  and item.status in ('planned','playing','paused')
  and item.rules->>'kind'='youtube-context'
  and format.deleted_at is null
  and format.active=true;
