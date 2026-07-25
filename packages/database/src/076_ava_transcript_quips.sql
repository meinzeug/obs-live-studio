-- AVA spricht in Einordnungssendungen häufiger kurze transkriptbezogene
-- Zwischenrufe. Sie bleiben im Sidebar-Layout, halten das Videobild in
-- Bewegung und nutzen weiterhin die serielle Audio-/Avatar-Synchronisation.

update ai_staff_members
set config=coalesce(config,'{}'::jsonb) || jsonb_build_object(
      'liveWitEnabled',true,
      'witFrequency','frequent',
      'inlineCommentaryEnabled',true,
      'inlineCommentaryIntervalSeconds',150,
      'witStingEnabled',true
    ),
    updated_at=now()
where id='moderator';

update ai_host_settings
set max_turns_per_hour=greatest(max_turns_per_hour,36),
    question_interval_seconds=least(question_interval_seconds,120),
    voice_enabled=true,
    avatar_voice_sync=true,
    updated_at=now()
where id=true;

update broadcast_templates
set settings=jsonb_set(
      jsonb_set(
        settings,
        '{avaRole,targetIntervalSeconds}',
        to_jsonb(least(240,coalesce((settings->'avaRole'->>'targetIntervalSeconds')::int,240))),
        true
      ),
      '{avaRole,minimumCommentariesPerHour}',
      to_jsonb(greatest(12,coalesce((settings->'avaRole'->>'minimumCommentariesPerHour')::int,12))),
      true
    ),
    updated_at=now()
where system_key like 'ava-context-%'
  and deleted_at is null;

update broadcast_playlists playlist
set settings=jsonb_set(
      jsonb_set(
        playlist.settings,
        '{avaRole,targetIntervalSeconds}',
        '240'::jsonb,
        true
      ),
      '{avaRole,minimumCommentariesPerHour}',
      '12'::jsonb,
      true
    )
where playlist.settings->>'formatSystemKey' like 'ava-context-%'
  and playlist.status in ('draft','scheduled');
