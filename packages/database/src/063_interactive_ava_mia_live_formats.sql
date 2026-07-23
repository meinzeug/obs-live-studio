-- Verbindliche Regie für fünf eigenständige AVA/Mia-Formate.
-- AVA liefert intensive, transkriptgestützte Einordnungen; Mia aktiviert das
-- Publikum und beantwortet konkrete Fragen. Die bestehende Turn-/TTS-Queue
-- sorgt dafür, dass beide niemals gleichzeitig sprechen.

alter table youtube_videos
  add column if not exists source_id uuid references sources(id) on delete set null,
  add column if not exists live_status text not null default 'vod',
  add column if not exists live_scheduled_start timestamptz,
  add column if not exists live_actual_start timestamptz,
  add column if not exists live_actual_end timestamptz,
  add column if not exists live_checked_at timestamptz;

do $$
begin
  if not exists(
    select 1 from pg_constraint where conname='youtube_videos_live_status_valid'
  ) then
    alter table youtube_videos
      add constraint youtube_videos_live_status_valid
      check(live_status in ('vod','upcoming','active','ended','unknown'));
  end if;
end $$;

create index if not exists idx_youtube_videos_active_live
  on youtube_videos(live_status,live_actual_start desc)
  where deleted_at is null and enabled=true;

with format_regie(system_key,name,description,settings) as (
  values
    (
      'ava-context-lagezentrum',
      'AVA Lagezentrum Live',
      'Das schnelle Live-Lagebild: AVA ordnet neue Aussagen entlang des Transkripts intensiv ein; Mia öffnet regelmäßig konkrete Publikumsfenster und beantwortet neue Fragen.',
      $json${
        "formatConcept":"Live-Lagezentrum mit hoher Einordnungsdichte: Relevanz, Chronologie, Folgen und offene Punkte werden während des Videos fortlaufend verständlich erklärt.",
        "moderationIntent":"AVA liefert mindestens sechs substanzielle Einordnungen pro Stunde. Mia spricht alle acht Minuten das Publikum an, priorisiert neue Fragen und nennt Fragende beim Namen.",
        "hosts":["ava","mia","sam"],
        "liveStreamPriority":true,
        "avaRole":{"intensity":"high","minimumCommentariesPerHour":6,"targetIntervalSeconds":420,"transcriptRequiredWhenAvailable":true,"pausePolicy":"claim-and-consequence","inlineBetweenTakeovers":true},
        "miaRole":{"interactionEnabled":true,"promptIntervalSeconds":480,"answerQuestions":true,"nameViewers":true,"prompt":"Was ist für euch an dieser Entwicklung noch unklar? Schreibt eure Frage in den Chat."},
        "samRole":{"continuousMonitoring":true,"classifyQuestions":true,"classifySuggestions":true,"deduplicate":true,"handoffTo":"mia"},
        "hostChoreography":{"singleSpeakerLock":true,"voiceQueue":"serial","avaPrimary":true,"miaAudienceLead":true,"resumeVideoVolumePercent":100}
      }$json$::jsonb
    ),
    (
      'ava-context-faktenradar',
      'AVA Faktenradar Live',
      'Der überprüfbare Faktenmodus: AVA stoppt bei zentralen Behauptungen und zeigt Beleglage und Unsicherheit; Mia sammelt Gegenbelege und beantwortet Zuschauerfragen.',
      $json${
        "formatConcept":"Faktenradar mit Claim, Beleg, Gegencheck und Urteil. Das Video bleibt sichtbar, während prüfbare Aussagen in klaren Etappen untersucht werden.",
        "moderationIntent":"AVA liefert mindestens sieben Faktenchecks pro Stunde. Mia fragt alle sieben Minuten nach Quellen, Einwänden und konkreten Rückfragen und beantwortet neue Fragen namentlich.",
        "hosts":["ava","mia","sam"],
        "liveStreamPriority":true,
        "avaRole":{"intensity":"high","minimumCommentariesPerHour":7,"targetIntervalSeconds":360,"transcriptRequiredWhenAvailable":true,"pausePolicy":"claim-evidence-verdict","inlineBetweenTakeovers":true},
        "miaRole":{"interactionEnabled":true,"promptIntervalSeconds":420,"answerQuestions":true,"nameViewers":true,"prompt":"Habt ihr einen Gegenbeleg oder eine konkrete Frage zu dieser Behauptung? Ab in den Chat."},
        "samRole":{"continuousMonitoring":true,"classifyQuestions":true,"classifySuggestions":true,"detectCounterEvidence":true,"deduplicate":true,"handoffTo":"mia"},
        "hostChoreography":{"singleSpeakerLock":true,"voiceQueue":"serial","avaPrimary":true,"miaAudienceLead":true,"resumeVideoVolumePercent":100}
      }$json$::jsonb
    ),
    (
      'ava-context-streitpunkt',
      'AVA Streitpunkt Arena',
      'Die faire Debattenstrecke: AVA trennt Behauptung, Pro, Contra und Konsequenz; Mia macht Zuschauerpositionen sichtbar und beantwortet direkte Fragen.',
      $json${
        "formatConcept":"Streitpunkt-Arena mit klar getrennten Perspektiven. AVA schärft das Argument, ohne Positionen zu vermischen; Mia bringt neue Publikumsargumente kontrolliert in die Sendung.",
        "moderationIntent":"AVA ordnet mindestens sechs Streitpunkte pro Stunde ein. Mia fordert alle sechs Minuten zu begründeten Einwänden auf und beantwortet konkrete Publikumsfragen mit Namen.",
        "hosts":["ava","mia","sam"],
        "liveStreamPriority":true,
        "avaRole":{"intensity":"high","minimumCommentariesPerHour":6,"targetIntervalSeconds":390,"transcriptRequiredWhenAvailable":true,"pausePolicy":"thesis-counterpoint-consequence","inlineBetweenTakeovers":true},
        "miaRole":{"interactionEnabled":true,"promptIntervalSeconds":360,"answerQuestions":true,"nameViewers":true,"prompt":"Welches Argument überzeugt euch – und welches fehlt? Schreibt eure Position oder Frage in den Chat."},
        "samRole":{"continuousMonitoring":true,"classifyQuestions":true,"classifySuggestions":true,"clusterPositions":true,"deduplicate":true,"handoffTo":"mia"},
        "hostChoreography":{"singleSpeakerLock":true,"voiceQueue":"serial","avaPrimary":true,"miaAudienceLead":true,"resumeVideoVolumePercent":100}
      }$json$::jsonb
    ),
    (
      'ava-context-quellencheck',
      'AVA Quellenlabor Live',
      'Das Quellenlabor: AVA verfolgt Zitate bis zur Primärquelle und erklärt fehlende Belege; Mia nimmt Recherchehinweise und Fragen aus dem Publikum auf.',
      $json${
        "formatConcept":"Quellenlabor mit Herkunft, Originalzitat, Zweitquelle und Unsicherheitsanzeige. Jede wichtige Aussage bekommt eine nachvollziehbare Quellenroute.",
        "moderationIntent":"AVA liefert mindestens sechs Quellenchecks pro Stunde. Mia öffnet alle acht Minuten ein Recherchefenster, beantwortet Fragen und nennt hilfreiche Zuschauerhinweise transparent.",
        "hosts":["ava","mia","sam"],
        "liveStreamPriority":true,
        "avaRole":{"intensity":"high","minimumCommentariesPerHour":6,"targetIntervalSeconds":420,"transcriptRequiredWhenAvailable":true,"pausePolicy":"quote-origin-crosscheck","inlineBetweenTakeovers":true},
        "miaRole":{"interactionEnabled":true,"promptIntervalSeconds":480,"answerQuestions":true,"nameViewers":true,"prompt":"Kennt ihr eine Primärquelle oder habt ihr eine Frage zur Beleglage? Schreibt sie in den Chat."},
        "samRole":{"continuousMonitoring":true,"classifyQuestions":true,"classifySuggestions":true,"detectSourceHints":true,"deduplicate":true,"handoffTo":"mia"},
        "hostChoreography":{"singleSpeakerLock":true,"voiceQueue":"serial","avaPrimary":true,"miaAudienceLead":true,"resumeVideoVolumePercent":100}
      }$json$::jsonb
    ),
    (
      'ava-context-nachtstudio',
      'AVA Nachtgespräch Live',
      'Die ausführliche Nachtstrecke: AVA erklärt längere Zusammenhänge in ruhigem Tempo; Mia hält den Chat wach, bündelt Diskussionen und beantwortet Fragen.',
      $json${
        "formatConcept":"Ruhiges Nachtgespräch für längere Videos: AVA verbindet Aussagen über größere Kapitel hinweg; Mia fasst neue Chatlinien zusammen und lädt gezielt zum Mitdenken ein.",
        "moderationIntent":"AVA liefert mindestens fünf vertiefende Einordnungen pro Stunde. Mia fragt alle neun Minuten nach offenen Punkten, kommentiert echte Diskussionen und beantwortet neue Fragen namentlich.",
        "hosts":["ava","mia","sam"],
        "liveStreamPriority":true,
        "avaRole":{"intensity":"high","minimumCommentariesPerHour":5,"targetIntervalSeconds":480,"transcriptRequiredWhenAvailable":true,"pausePolicy":"chapter-summary-context","inlineBetweenTakeovers":true},
        "miaRole":{"interactionEnabled":true,"promptIntervalSeconds":540,"answerQuestions":true,"nameViewers":true,"prompt":"Welche Verbindung oder offene Frage sollen wir als Nächstes vertiefen? Schreibt es in den Chat."},
        "samRole":{"continuousMonitoring":true,"classifyQuestions":true,"classifySuggestions":true,"summarizeDiscussion":true,"deduplicate":true,"handoffTo":"mia"},
        "hostChoreography":{"singleSpeakerLock":true,"voiceQueue":"serial","avaPrimary":true,"miaAudienceLead":true,"resumeVideoVolumePercent":100}
      }$json$::jsonb
    )
)
update broadcast_templates format
set name=regie.name,
    description=regie.description,
    settings=format.settings || regie.settings,
    flow=coalesce(format.flow,'{}'::jsonb)
      || jsonb_build_object('version',4,'interactiveEditorialTeam',true,'settings',format.settings || regie.settings),
    active=true,
    deleted_at=null,
    updated_at=now()
from format_regie regie
where format.system_key=regie.system_key;

-- Die Agenten arbeiten in den Einordnungsformaten aktiv und automatisch.
update ai_staff_members
set enabled=true,
    autonomy='auto',
    config=coalesce(config,'{}'::jsonb) || jsonb_build_object(
      'liveFrequency','active',
      'contextDepth','detailed',
      'responseDetail','detailed',
      'inlineCommentaryEnabled',true,
      'inlineCommentaryIntervalSeconds',120,
      'takeoverFrequency','frequent'
    ),
    updated_at=now()
where id='moderator';

update ai_staff_members
set enabled=true,
    autonomy='auto',
    config=coalesce(config,'{}'::jsonb) || jsonb_build_object(
      'liveFrequency','active',
      'responseDetail','detailed',
      'proactive',true,
      'proactiveChatCommentary',true,
      'chatCommentaryIntervalSeconds',180,
      'chatCommentaryDurationSeconds',24
    ),
    updated_at=now()
where id='chat-moderator';

update ai_staff_members
set enabled=true,
    autonomy='auto',
    config=coalesce(config,'{}'::jsonb) || jsonb_build_object(
      'liveFrequency','active',
      'proactive',true,
      'chatAnalysisEnabled',true,
      'chatAnalysisIntervalSeconds',180,
      'chatActivityWindowSeconds',600,
      'chatMinimumDistinctMessages',2,
      'chatMinimumUniqueAuthors',1,
      'chatDuplicateSuppressionMinutes',20,
      'proactiveChatCommentary',true,
      'chatCommentaryIntervalSeconds',180
    ),
    updated_at=now()
where id='chat-analyst';

update ai_host_settings
set enabled=true,
    show_avatar=true,
    show_chat=true,
    voice_enabled=true,
    avatar_voice_sync=true,
    interaction_mode='auto-safe',
    question_interval_seconds=120,
    response_cooldown_seconds=30,
    response_duration_seconds=28,
    max_turns_per_hour=24,
    max_chat_messages_per_turn=20,
    minimum_chat_messages=1,
    participation_prompt='Schreibt eure Fragen gerne in den Chat!',
    updated_at=now()
where id=true;

-- Bereits geplante Ausgaben erhalten die neue Regie ebenfalls. So müssen sie
-- nicht verworfen oder doppelt neu angelegt werden.
update broadcast_playlists playlist
set settings=playlist.settings || jsonb_build_object(
      'formatConcept',format.settings->'formatConcept',
      'moderationIntent',format.settings->'moderationIntent',
      'avaRole',format.settings->'avaRole',
      'miaRole',format.settings->'miaRole',
      'samRole',format.settings->'samRole',
      'hostChoreography',format.settings->'hostChoreography',
      'miaInteractionPrompt',format.settings->'miaRole'->>'prompt',
      'liveStreamPriority',true
    )
from broadcast_templates format
where playlist.status='draft'
  and playlist.scheduled_at>now()
  and playlist.settings->>'formatSystemKey'=format.system_key
  and format.system_key like 'ava-context-%';

update broadcast_items item
set rules=coalesce(item.rules,'{}'::jsonb) || jsonb_build_object(
      'avaRole',playlist.settings->'avaRole',
      'miaRole',playlist.settings->'miaRole',
      'samRole',playlist.settings->'samRole',
      'hostChoreography',playlist.settings->'hostChoreography',
      'miaInteractionPrompt',playlist.settings->>'miaInteractionPrompt',
      'liveStreamPriority',true
    )
from broadcast_playlists playlist
where item.playlist_id=playlist.id
  and playlist.status='draft'
  and playlist.scheduled_at>now()
  and playlist.settings->>'formatSystemKey' like 'ava-context-%';
