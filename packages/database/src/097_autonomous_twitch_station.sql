-- Production contract for the autonomous Twitch station. Codex may refuse a
-- plan when evidence is insufficient; refusal is a safe editorial outcome and
-- must never be materialised as programme.

alter table codex_newsroom_plans
  drop constraint if exists codex_newsroom_plan_status_valid;
alter table codex_newsroom_plans
  add constraint codex_newsroom_plan_status_valid
  check(status in ('planning','ready','active','superseded','blocked','error'));

alter table master_control_watchdog
  add column if not exists last_action_fingerprint text;

insert into system_settings(key,value,updated_at)
values(
  'autonomous-tv.mode',
  jsonb_build_object(
    'enabled',true,
    'primaryPlatform','twitch',
    'alwaysOnCarrier',true,
    'editorialProvider','codex-cli',
    'rollingScheduleMinutes',1440,
    'minimumUpcomingShows',24,
    'continuityPolicy','local-station-signal-current-day-ticker',
    'updatedBy','autonomous-tv-migration-097'
  ),
  now()
)
on conflict(key) do update set value=excluded.value,updated_at=now();

insert into system_settings(key,value,updated_at)
values(
  'newsroom.day-rollover-policy',
  jsonb_build_object(
    'enabled',true,
    'timeZone','Europe/Berlin',
    'rejectPreviousDayVideos',true,
    'continuityMode','local-station-signal',
    'continuityCopy','Tagesauftakt – die Redaktion prüft die ersten Quellen des neuen Tages.',
    'resumeWhenStrictReadyPackages',2
  ),
  now()
)
on conflict(key) do update set value=excluded.value,updated_at=now();

update autonomous_studio_settings
set enabled=true,
    automatic_apply=true,
    operations_enabled=true,
    automatic_operational_actions=true,
    minimum_upcoming_shows=greatest(minimum_upcoming_shows,24),
    minimum_schedule_minutes=greatest(minimum_schedule_minutes,1440),
    schedule_horizon_hours=greatest(schedule_horizon_hours,24),
    updated_at=now()
where id=true;

update system_settings
set value=value || jsonb_build_object(
      'enabled',true,
      'showItemCount',6,
      'pauseSeconds',0,
      'pauseBetweenShowsSeconds',0
    ),
    updated_at=now()
where key='autopilot.config';

update ai_host_settings
set enabled=true,
    show_avatar=true,
    show_chat=true,
    voice_enabled=true,
    avatar_voice_sync=true,
    interaction_mode='auto-safe',
    question_interval_seconds=least(question_interval_seconds,90),
    response_cooldown_seconds=least(response_cooldown_seconds,30),
    max_turns_per_hour=greatest(max_turns_per_hour,48),
    minimum_chat_messages=1,
    chat_platforms=case
      when chat_platforms @> '["twitch"]'::jsonb then chat_platforms
      else chat_platforms || '["twitch"]'::jsonb
    end,
    updated_at=now()
where id=true;

-- Older planner versions were forced to create slots even after Codex had
-- explicitly rejected the editorial pairing. Quarantine those plans and only
-- cancel their not-yet-started playlists. A running programme is handed off by
-- Master Control, not torn down in a migration.
update codex_newsroom_plans
set status='blocked',
    error=coalesce(error,'Codex-Plan enthielt eine ausdrückliche Nicht-Sendefähigkeitsentscheidung.'),
    updated_at=now()
where status in ('planning','ready','active','superseded')
  and plan::text ~* '(nicht sendefähig|nicht zur ausstrahlung|disposition ausgesetzt|keine passende.{0,80}(quelle|artikel|evidenz))';

update broadcast_playlists playlist
set status='interrupted',
    ended_at=coalesce(ended_at,now()),
    settings=jsonb_set(
      coalesce(settings,'{}'::jsonb),
      '{scheduleReconciliation}',
      '"blocked-codex-editorial-admission"'::jsonb,
      true
    )
where playlist.status='draft'
  and exists(
    select 1
    from codex_newsroom_plans plan
    where plan.id::text=playlist.settings->>'codexNewsroomPlanId'
      and plan.status='blocked'
  );
