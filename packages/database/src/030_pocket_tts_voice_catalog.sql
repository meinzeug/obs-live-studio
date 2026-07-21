-- Alba bleibt als auswählbare Stimme erhalten. Bestehende Installationen,
-- deren zweite Moderatorin noch Alba, keine Stimme oder die mit AVA geteilte
-- Lola-Stimme verwendet, wechseln genau einmal auf den weiblichen Anna-HQ-
-- Prompt. Der Marker verhindert, dass eine spätere manuelle Wahl überschrieben
-- wird, obwohl dieses Projekt seine idempotenten SQL-Dateien erneut ausführt.
create table if not exists migration_markers(
  key text primary key,
  applied_at timestamptz not null default now()
);

with newly_applied as (
  insert into migration_markers(key)
  values ('030_pocket_tts_voice_catalog')
  on conflict(key) do nothing
  returning key
)
update ai_presenter_profiles
set tts_voice='anna',updated_at=now()
where staff_member_id='chat-moderator'
  and tts_voice in ('','alba','lola')
  and exists(select 1 from newly_applied);
