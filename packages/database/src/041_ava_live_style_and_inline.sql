-- AVA kann in langen YouTube-Einordnungen kurze Kommentare im bestehenden
-- Sidebar-Studio sprechen, ohne das Video anzuhalten oder das Vollbild zu
-- übernehmen. Der Modus wird pro Turn serverseitig gespeichert, damit eine
-- Browserquelle die Pausenlogik nicht manipulieren kann.
alter table ai_staff_turns
  add column if not exists display_mode text not null default 'takeover',
  add column if not exists presentation jsonb not null default '{}'::jsonb;

do $$
begin
  if not exists (
    select 1 from pg_constraint where conname='ai_staff_turn_display_mode_valid'
  ) then
    alter table ai_staff_turns
      add constraint ai_staff_turn_display_mode_valid
      check(display_mode in ('takeover','inline'));
  end if;
end $$;

-- Bestehende individuelle Einstellungen gewinnen gegen die neuen Defaults.
-- Dadurch ist die Migration wiederholbar und überschreibt keine spätere
-- Konfiguration aus dem KI Studio.
update ai_staff_members
set config=jsonb_build_object(
      'liveWitEnabled',true,
      'shortsWitEnabled',true,
      'witFrequency','occasional',
      'witIntensity','playful',
      'witStingEnabled',true,
      'witStingDurationMs',2000,
      'witStingStyle','freeze',
      'witStingText','KURZER REALITÄTSCHECK',
      'speechPace','relaxed',
      'inlineCommentaryEnabled',true,
      'inlineCommentaryIntervalSeconds',180,
      'takeoverFrequency','balanced'
    ) || coalesce(config,'{}'::jsonb),
    updated_at=now()
where id='moderator';

create index if not exists idx_ai_staff_turns_display_mode
  on ai_staff_turns(session_id,display_mode,created_at desc);
