-- Ein YouTube-Beitrag ist erst sendefertig, wenn Codex CLI das vollständige
-- zeitcodierte Manuskript erzeugt und jede Wortmeldung als geprüfte
-- TTS-Datei vorliegt. Ältere lokale Textgenerator-Pakete bleiben erhalten,
-- werden aber als unvollständig markiert und vom Playout nicht mehr benutzt.

alter table youtube_preproduced_scripts
  add column if not exists production_model text,
  add column if not exists editorial_summary text;

alter table youtube_preproduced_cues
  add column if not exists audio_path text,
  add column if not exists audio_duration_seconds double precision,
  add column if not exists ai_model text,
  add column if not exists ai_tier text,
  add column if not exists tts_engine text,
  add column if not exists tts_voice text;

do $$
begin
  if not exists(
    select 1 from pg_constraint where conname='youtube_preproduced_cue_audio_duration_valid'
  ) then
    alter table youtube_preproduced_cues
      add constraint youtube_preproduced_cue_audio_duration_valid
      check(audio_duration_seconds is null or audio_duration_seconds > 0);
  end if;
  if not exists(
    select 1 from pg_constraint where conname='youtube_preproduced_cue_ai_tier_valid'
  ) then
    alter table youtube_preproduced_cues
      add constraint youtube_preproduced_cue_ai_tier_valid
      check(ai_tier is null or ai_tier in ('codex'));
  end if;
end $$;

update youtube_preproduced_scripts
set status='partial',
    error='Neuproduktion erforderlich: Das ältere Paket enthält kein vollständiges Codex-CLI-Manuskript mit vorgerendertem TTS.',
    updated_at=now()
where status='ready'
  and (
    generator_version not like 'codex-cli-complete-show-%'
    or production_model is null
    or production_model not like 'codex-cli%'
  );

create index if not exists idx_youtube_preproduced_cues_audio_ready
  on youtube_preproduced_cues(script_id)
  where audio_path is not null and audio_duration_seconds > 0;

-- Bereits geplante Standalone-/Sidebar-Videos werden beim nächsten Lauf nur
-- noch über das moderierte Einordnungsstudio abgespielt. Das Playout-Gate
-- darunter verweigert sie, bis das neue Sendepaket bereitsteht.
update broadcast_items
set rules=(rules - 'kind') || jsonb_build_object(
      'kind','youtube-context',
      'pauseDuringAva',true,
      'analysisStatus','preproduction-required',
      'contextLayoutVariant',coalesce(rules->>'contextLayoutVariant','classic')
    )
where rules->>'kind' in ('youtube-video','youtube-news-sidebar')
  and status in ('planned','preparing','playing');
