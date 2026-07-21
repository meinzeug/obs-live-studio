-- Ava und Mia erhalten getrennte, im KI-Studio editierbare Live-Regeln. Die
-- einmalige Aktualisierung hebt nur die bisherigen kompakten Standardwerte an;
-- spätere Benutzerentscheidungen werden von den idempotenten Migrationen nicht
-- wieder überschrieben.
create table if not exists migration_markers(
  key text primary key,
  applied_at timestamptz not null default now()
);

do $$
begin
  if not exists(select 1 from migration_markers where key='032_ai_presenter_live_preferences') then
    update ai_staff_members
    set config=(jsonb_build_object('liveFrequency','active','contextDepth','detailed') || coalesce(config,'{}'::jsonb)) ||
      case when coalesce(config->>'responseDetail','compact')='compact'
        then '{"responseDetail":"detailed"}'::jsonb else '{}'::jsonb end,
      updated_at=now()
    where id='moderator';

    update ai_staff_members
    set config=(jsonb_build_object('liveFrequency','active','contextDepth','balanced') || coalesce(config,'{}'::jsonb)) ||
      case when coalesce(config->>'responseDetail','compact')='compact'
        then '{"responseDetail":"balanced"}'::jsonb else '{}'::jsonb end,
      updated_at=now()
    where id='chat-moderator';

    insert into migration_markers(key) values ('032_ai_presenter_live_preferences');
  end if;
end $$;
