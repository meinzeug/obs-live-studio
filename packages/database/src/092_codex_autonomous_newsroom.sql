-- Codex CLI übernimmt die operative Chefredaktion. Jeder Plan speichert die
-- tatsächlich bewertete Nachrichtenlage, das strukturierte Ergebnis und die
-- daraus materialisierten Sendungen nachvollziehbar und rückrollbar.

create table if not exists codex_newsroom_plans(
  id uuid primary key default gen_random_uuid(),
  status text not null default 'planning',
  input_fingerprint text not null,
  news_snapshot jsonb not null default '{}'::jsonb,
  plan jsonb not null default '{}'::jsonb,
  model text,
  usage jsonb not null default '{}'::jsonb,
  requested_by_system text,
  error text,
  generated_at timestamptz not null default now(),
  activated_at timestamptz,
  superseded_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint codex_newsroom_plan_status_valid
    check(status in ('planning','ready','active','superseded','error'))
);

create index if not exists idx_codex_newsroom_plans_status
  on codex_newsroom_plans(status,generated_at desc);

-- Vorproduzierte und spontane Wortmeldungen tragen jetzt beide den expliziten
-- Codex-Tier. Historische Datensätze bleiben lesbar, neue Sendungen können den
-- tatsächlich verwendeten Provider ohne Constraint-Fehler protokollieren.
alter table ai_roundtable_turns
  drop constraint if exists ai_roundtable_turn_tier_valid;
alter table ai_roundtable_turns
  add constraint ai_roundtable_turn_tier_valid
  check(tier is null or tier in ('free','paid','local','codex'));

insert into system_settings(key,value,updated_at)
values('codex-newsroom.enabled','true'::jsonb,now())
on conflict(key) do update set value='true'::jsonb,updated_at=now();

-- Das alte AVA-Branding bleibt nur im technischen System-Key erhalten, damit
-- bestehende Verweise stabil bleiben. Auf Sendung und in der Redaktion treten
-- die Formate ab jetzt als Sechs-Personen-Ensemble auf.
with names(system_key,name,description,moderation_intent) as (
  values
    ('ava-context-lagezentrum','KI Lagekonferenz',
     'Sechs KI-Moderatoren bewerten gemeinsam die aktuelle Lage, ordnen Quellen und priorisieren offene Fragen.',
     'Die sechs Moderatoren eröffnen mit Nachrichtenwert und Quellenlage, verteilen Analyse, Gegencheck, Folgen und Publikumsfrage sichtbar untereinander.'),
    ('ava-context-faktenradar','Sechs Stimmen: Faktenradar',
     'Das gesamte KI-Ensemble prüft Behauptungen, Gegenbelege und Unsicherheiten aus sechs klaren Fachperspektiven.',
     'AVA, Mia, Lea, Leon, Jonas und Karim teilen Faktenprüfung, Kontext, Widerspruch, Folgenanalyse und Publikumsfenster gleichberechtigt auf.'),
    ('ava-context-streitpunkt','KI Streitforum',
     'Sechs KI-Perspektiven zerlegen Kontroversen fair in Argument, Gegenargument, Beleglage, Folge und Publikumsfrage.',
     'Keine Einzelmoderation: Alle sechs Stimmen erhalten einen eigenen, transkriptgebundenen Auftritt und reagieren inhaltlich aufeinander.'),
    ('ava-context-quellencheck','Redaktions-Quellencheck',
     'Das sechsköpfige KI-Redaktionsteam prüft Herkunft, Primärquellen, Zitate, Interessen und offene Nachweise.',
     'Die Rollen wechseln zwischen Quellenprüfung, Kontext, Gegencheck, Folgen, Verständlichkeit und Publikumsmoderation.'),
    ('ava-context-nachtstudio','KI Nachtkonferenz',
     'Ruhige Sechs-Personen-Einordnung mit längeren Quellenblöcken, Zwischenfazits und offenen Publikumsfragen.',
     'Alle sechs Moderatoren tragen die Sendung; kompakte Einzelmoderation ist nur noch ein einzelner Baustein des Ensemble-Ablaufs.')
)
update broadcast_templates format
set name=names.name,
    description=names.description,
    settings=format.settings || jsonb_build_object(
      'moderationIntent',names.moderation_intent,
      'hostRoster',jsonb_build_array(
        'moderator','chat-moderator','presenter-lea','presenter-leon','presenter-jonas','presenter-karim'
      ),
      'coHostIds',jsonb_build_array(
        'presenter-lea','presenter-leon','presenter-jonas','presenter-karim'
      ),
      'sixAgentEnsemble',true,
      'ensemblePrimary',true,
      'roundtableFallbackMode','codex-retry',
      'roundtableProductionSettings',coalesce(format.settings->'roundtableProductionSettings','{}'::jsonb) || jsonb_build_object(
        'fallbackMode','codex-retry','minimumParticipants',6,'showAllParticipants',true
      ),
      'hostChoreography',coalesce(format.settings->'hostChoreography','{}'::jsonb) || jsonb_build_object(
        'singleSpeakerLock',true,'voiceQueue','serial','avaPrimary',false,'ensemblePrimary',true,
        'miaAudienceLead',true,'minimumDistinctPresenters',6,
        'coHostIds',jsonb_build_array('presenter-lea','presenter-leon','presenter-jonas','presenter-karim')
      )
    ),
    flow=format.flow || jsonb_build_object(
      'sixAgentEnsemble',true,'minimumDistinctPresenters',6,'audienceWindows',true
    ),
    updated_at=now()
from names
where format.system_key=names.system_key and format.deleted_at is null;

update broadcast_templates format
set settings=format.settings || jsonb_build_object(
      'hostRoster',jsonb_build_array(
        'moderator','chat-moderator','presenter-lea','presenter-leon','presenter-jonas','presenter-karim'
      ),
      'coHostIds',jsonb_build_array(
        'presenter-lea','presenter-leon','presenter-jonas','presenter-karim'
      ),
      'sixAgentEnsemble',true,
      'ensemblePrimary',true,
      'roundtableParticipantIds',jsonb_build_array(
        'moderator','chat-moderator','presenter-lea','presenter-leon','presenter-jonas','presenter-karim'
      ),
      'roundtableFallbackMode','codex-retry',
      'roundtableProductionSettings',coalesce(format.settings->'roundtableProductionSettings','{}'::jsonb) || jsonb_build_object(
        'fallbackMode','codex-retry','minimumParticipants',6,'showAllParticipants',true,
        'autoDiscussVideos',true,'introductionsEnabled',true
      ),
      'hostChoreography',coalesce(format.settings->'hostChoreography','{}'::jsonb) || jsonb_build_object(
        'singleSpeakerLock',true,'voiceQueue','serial','avaPrimary',false,'ensemblePrimary',true,
        'miaAudienceLead',true,'minimumDistinctPresenters',6,
        'coHostIds',jsonb_build_array('presenter-lea','presenter-leon','presenter-jonas','presenter-karim')
      )
    ),
    flow=format.flow || jsonb_build_object(
      'sixAgentEnsemble',true,'minimumDistinctPresenters',6,'audienceWindows',true,'codexRetry',true
    ),
    updated_at=now()
where format.system_key in (
    'ai-roundtable-studio','ai-roundtable-fakten-duell','ai-roundtable-publikumsforum',
    'zeitkante-tagesueberblick','political-comedy-ava-leon'
  )
  and format.deleted_at is null;

update ai_roundtable_settings
set participant_ids=array[
      'moderator','chat-moderator','presenter-lea','presenter-leon','presenter-jonas','presenter-karim'
    ],
    preset='publikumsforum',
    production_settings=production_settings || jsonb_build_object(
      'fallbackMode','codex-retry','minimumParticipants',6,'showAllParticipants',true,
      'autoDiscussVideos',true,'introductionsEnabled',true
    ),
    status=case when show_session_key like 'manual:%' then 'ended' else status end,
    current_speaker_id=case when show_session_key like 'manual:%' then null else current_speaker_id end,
    updated_at=now()
where id=true;

-- Auch eine bereits laufende oder vorbereitete Einordnung kennt sofort das
-- vollständige Ensemble. Die vorproduzierten Codex-Cues bestimmen weiterhin
-- atomar, wer tatsächlich spricht.
update broadcast_playlists playlist
set settings=playlist.settings || jsonb_build_object(
      'hostRoster',jsonb_build_array(
        'moderator','chat-moderator','presenter-lea','presenter-leon','presenter-jonas','presenter-karim'
      ),
      'coHostIds',jsonb_build_array(
        'presenter-lea','presenter-leon','presenter-jonas','presenter-karim'
      ),
      'sixAgentEnsemble',true,
      'roundtableFallbackMode','codex-retry',
      'roundtableProductionSettings',coalesce(playlist.settings->'roundtableProductionSettings','{}'::jsonb) || jsonb_build_object(
        'fallbackMode','codex-retry','minimumParticipants',6,'showAllParticipants',true,
        'autoDiscussVideos',true,'introductionsEnabled',true
      ),
      'hostChoreography',coalesce(playlist.settings->'hostChoreography','{}'::jsonb) || jsonb_build_object(
        'singleSpeakerLock',true,'voiceQueue','serial','avaPrimary',false,'ensemblePrimary',true,
        'minimumDistinctPresenters',6,
        'coHostIds',jsonb_build_array('presenter-lea','presenter-leon','presenter-jonas','presenter-karim')
      )
    )
where playlist.status in ('draft','starting','running','paused','recovering')
  and coalesce((playlist.settings->>'youtubeContext')::boolean,false)=true;

update broadcast_items item
set rules=item.rules || jsonb_build_object(
      'hostRoster',jsonb_build_array(
        'moderator','chat-moderator','presenter-lea','presenter-leon','presenter-jonas','presenter-karim'
      ),
      'coHostIds',jsonb_build_array(
        'presenter-lea','presenter-leon','presenter-jonas','presenter-karim'
      ),
      'sixAgentEnsemble',true,
      'roundtableFallbackMode','codex-retry',
      'roundtableProductionSettings',coalesce(item.rules->'roundtableProductionSettings','{}'::jsonb) || jsonb_build_object(
        'fallbackMode','codex-retry','minimumParticipants',6,'showAllParticipants',true,
        'autoDiscussVideos',true,'introductionsEnabled',true
      ),
      'hostChoreography',coalesce(item.rules->'hostChoreography','{}'::jsonb) || jsonb_build_object(
        'singleSpeakerLock',true,'voiceQueue','serial','avaPrimary',false,'ensemblePrimary',true,
        'minimumDistinctPresenters',6,
        'coHostIds',jsonb_build_array('presenter-lea','presenter-leon','presenter-jonas','presenter-karim')
      )
    )
from broadcast_playlists playlist
where item.playlist_id=playlist.id
  and playlist.status in ('draft','starting','running','paused','recovering')
  and item.rules->>'kind'='youtube-context';

-- Sichtbarer Grundplan für die Oberfläche. Die tatsächlichen Themen, Quellen,
-- Videos, Titel und Startabstände materialisiert ausschließlich der jeweils
-- aktive Codex-Newsroom-Plan.
with current_config as (
  select coalesce((select value from system_settings where key='autopilot.config'),'{}'::jsonb) value
), daily_formats as (
  select jsonb_agg(
    jsonb_build_object(
      'id','codex-newsroom-policy-' || lpad(hour::text,2,'0') || '00',
      'name',case hour % 4
        when 0 then 'Publikumsforum KI'
        when 1 then 'KI Studio Runde'
        when 2 then 'Fakten-Duell'
        else 'KI Lagekonferenz'
      end,
      'startTime',lpad(hour::text,2,'0') || ':00',
      'durationMinutes',60,
      'contentMode',case when hour % 4=3 then 'youtube-context' else 'ai-roundtable' end,
      'formatSystemKey',case hour % 4
        when 0 then 'ai-roundtable-publikumsforum'
        when 1 then 'ai-roundtable-studio'
        when 2 then 'ai-roundtable-fakten-duell'
        else 'ava-context-lagezentrum'
      end,
      'youtubeCategoryIds',coalesce((select value->'youtubeCategoryIds' from current_config),'[]'::jsonb),
      'sourceIds',coalesce((select value->'sourceIds' from current_config),'[]'::jsonb),
      'enabled',true
    ) order by hour
  ) value
  from generate_series(0,23) hour
)
insert into system_settings(key,value,updated_at)
select 'autopilot.config',
       current_config.value || jsonb_build_object(
         'enabled',true,
         'contentMode','ai-roundtable',
         'showItemCount',least(greatest(coalesce((current_config.value->>'showItemCount')::int,3),1),4),
         'pauseBetweenShowsSeconds',0,
         'dailyFormats',(select value from daily_formats),
         'roundtableFormatSystemKeys',jsonb_build_array(
           'ai-roundtable-publikumsforum','ai-roundtable-studio',
           'ai-roundtable-publikumsforum','ai-roundtable-fakten-duell'
         )
       ),
       now()
from current_config
on conflict(key) do update set value=excluded.value,updated_at=now();

update autonomous_studio_settings
set enabled=true,
    automatic_apply=true,
    cycle_interval_hours=least(cycle_interval_hours,2),
    operations_enabled=true,
    automatic_operational_actions=true,
    minimum_upcoming_shows=least(minimum_upcoming_shows,12),
    minimum_schedule_minutes=least(minimum_schedule_minutes,720),
    updated_at=now()
where id=true;

-- Der alte fest verdrahtete AVA-Tagesplan darf nicht erneut Vorrang vor der
-- ersten Codex-Chefredaktionsplanung erhalten. Die laufende Sendung bleibt
-- unangetastet und wird erst am ersten neuen Codex-Zeitpunkt übergeben.
update broadcast_playlists
set status='interrupted',
    ended_at=coalesce(ended_at,now()),
    settings=jsonb_set(settings,'{scheduleReconciliation}','"awaiting-codex-newsroom-plan"'::jsonb,true)
where status='draft'
  and scheduled_at>now()
  and coalesce((settings->>'autopilot24h')::boolean,false)=true
  and settings->>'codexNewsroomPlanId' is null;

update notifications
set resolved_at=coalesce(resolved_at,now()),last_seen_at=now()
where dedupe_key='ai-roundtable:model-fallback' and resolved_at is null;
