-- Pocket TTS 2.1 accepts the Spanish Lola prompt with german_24l, but that
-- combination can return a successful WAV containing only near-silence.
-- Move only installations still using that broken legacy default; later
-- manual voice choices remain untouched.
create table if not exists migration_markers(
  key text primary key,
  applied_at timestamptz not null default now()
);

with newly_applied as (
  insert into migration_markers(key)
  values ('045_pocket_tts_audible_voice_recovery')
  on conflict(key) do nothing
  returning key
)
update ai_presenter_profiles
set tts_voice=case
      when staff_member_id='chat-moderator' then 'vera'
      else 'anna'
    end,
    updated_at=now()
where staff_member_id in ('moderator','chat-moderator')
  and tts_voice in ('','lola')
  and exists(select 1 from newly_applied);
