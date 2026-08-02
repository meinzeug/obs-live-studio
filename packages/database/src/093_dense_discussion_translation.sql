-- Jede YouTube-Sendung wird vorab als lückenlose 20- bis 40-Sekunden-
-- Einordnung produziert. Fremdsprachige Beiträge erhalten zusätzlich eine
-- eigene deutsche Übersetzerstimme mit separatem On-Air-Bild.

alter table youtube_videos
  add column if not exists source_language text;

-- Bestehende deutsche Transkripte sind in der Regel Originalspuren. Bei klar
-- englisch beschrifteten Videos aus dem yt-dlp-Übersetzungsweg wird die
-- Originalsprache dagegen explizit rekonstruiert. Neue Abrufe speichern sie
-- direkt aus der Original-Caption-Spur.
update youtube_videos
set source_language=case
      when transcript_language is not null and transcript_language !~* '^de([_-]|$)' then transcript_language
      when transcript_source='yt-dlp'
       and lower(title) ~ '\m(the|and|with|from|live|breaking|news|coverage|crisis)\M.*\m(the|and|with|from|live|breaking|news|coverage|crisis)\M'
      then 'en'
      else coalesce(nullif(transcript_language,''),'de')
    end,
    updated_at=now()
where source_language is null and transcript_status='ready';

insert into ai_staff_members(
  id,display_name,job_title,role,description,enabled,autonomy,avatar_style,accent_color,instructions,config
)
values(
  'translator','Nora','KI-Sendungsübersetzerin','translator',
  'Überträgt fremdsprachige Videopassagen vollständig und sinngenau ins Deutsche, ohne eigene Einordnung hinzuzufügen.',
  true,'auto','host','#f472b6',
  'Übersetze vollständig, natürlich und bedeutungstreu ins Deutsche. Ergänze keine Bewertung, keine Fakten und keine Meta-Erklärung.',
  '{"genderPresentation":"female","discussionRole":"translator","specialties":["Übersetzung","Sprachfassung"],"liveFrequency":"source-language","contextDepth":"detailed"}'::jsonb
)
on conflict(id) do update
set display_name=excluded.display_name,
    job_title=excluded.job_title,
    role=excluded.role,
    description=excluded.description,
    enabled=true,
    autonomy='auto',
    accent_color=excluded.accent_color,
    instructions=excluded.instructions,
    config=ai_staff_members.config || excluded.config,
    updated_at=now();

insert into ai_presenter_profiles(staff_member_id,tts_provider,tts_voice)
values('translator','pocket-tts','jane')
on conflict(staff_member_id) do update
set tts_provider='pocket-tts',tts_voice='jane',updated_at=now();

-- Das eigenständige, fiktive Nora-Avatarpaket liegt reproduzierbar bei den
-- Deployment-Assets. Die Datensätze sind nicht verwaltet, damit ein späterer
-- Upload die gebündelten Quelldateien nicht löscht.
insert into ai_presenter_media(
  staff_member_id,state,original_filename,original_path,rendered_path,thumbnail_path,
  mime_type,sha256,width,height,duration_seconds,green_screen,managed
)
values
  (
    'translator','idle','nora-translator-source.png','./deploy/assets/nora-translator-source.png',
    './deploy/assets/nora-translator-idle.webm','./deploy/assets/nora-translator-thumb.webp',
    'video/webm','2d7fa9ac4a70d32b02bb3db4db582776ce02a9efa04177c8ddaff1f10568ab68',1280,720,8,true,false
  ),
  (
    'translator','speaking','nora-translator-source.png','./deploy/assets/nora-translator-source.png',
    './deploy/assets/nora-translator-speaking.webm','./deploy/assets/nora-translator-thumb.webp',
    'video/webm','608ef20450672dfe7b1fc5bd005d6b467f07290ecffca1502f61c0dcba6c9937',1280,720,6,true,false
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
    managed=false,
    updated_at=now();

alter table youtube_preproduced_cues
  add column if not exists responds_to_presenter_id text references ai_staff_members(id),
  add column if not exists handoff_to_presenter_id text references ai_staff_members(id),
  add column if not exists discussion_move text;

alter table youtube_preproduced_cues
  drop constraint if exists youtube_preproduced_cue_kind_valid;
alter table youtube_preproduced_cues
  add constraint youtube_preproduced_cue_kind_valid
  check(kind in ('intro','context','reaction','fact-check','question','translation','closing'));

alter table ai_roundtable_turns
  drop constraint if exists ai_roundtable_turn_kind_valid;
alter table ai_roundtable_turns
  add constraint ai_roundtable_turn_kind_valid
  check(kind in ('opening','position','response','fact-check','audience','translation','closing'));

create or replace function youtube_preproduced_script_is_broadcast_ready(candidate_id uuid)
returns boolean
language sql
stable
as $$
  select exists(
    select 1
    from youtube_preproduced_scripts script
    join youtube_videos video on video.id=script.youtube_video_id
    where script.id=candidate_id
      and script.status='ready'
      and script.generator_version='codex-cli-complete-show-discussion-20-40-v2'
      and script.production_model like 'codex-cli%'
      and script.cue_count>=3
      and (select count(*) from youtube_preproduced_cues cue where cue.script_id=script.id)=script.cue_count
      and (select min(cue.at_ms) from youtube_preproduced_cues cue where cue.script_id=script.id)=0
      and (select max(cue.at_ms) from youtube_preproduced_cues cue where cue.script_id=script.id)
            >=greatest(0,script.duration_ms-40000)
      and not exists(
        select 1
        from youtube_preproduced_cues cue
        where cue.script_id=script.id
          and (
            coalesce(cue.audio_path,'')='' or coalesce(cue.audio_duration_seconds,0)<=0
            or cue.ai_tier<>'codex' or cue.ai_model not like 'codex-cli%'
            or cue.discussion_move is null
            or (cue.presenter_id<>'translator' and cue.kind<>'intro' and cue.responds_to_presenter_id is null)
            or (cue.presenter_id<>'translator' and cue.kind<>'closing' and cue.handoff_to_presenter_id is null)
            or (cue.presenter_id='translator' and cue.kind<>'translation')
          )
      )
      and not exists(
        select 1
        from (
          select point.at_ms,lag(point.at_ms) over(order by point.at_ms) previous_at_ms
          from (select distinct cue.at_ms from youtube_preproduced_cues cue where cue.script_id=script.id) point
        ) spacing
        where spacing.previous_at_ms is not null
          and spacing.at_ms-spacing.previous_at_ms not between 20000 and 40000
      )
      and 6=(
        select count(distinct cue.presenter_id)
        from youtube_preproduced_cues cue
        where cue.script_id=script.id
          and cue.presenter_id in (
            'moderator','presenter-leon','presenter-lea','presenter-jonas','chat-moderator','presenter-karim'
          )
      )
      and (
        coalesce(video.source_language,'de') ~* '^de([_-]|$)'
        or not exists(
          select 1
          from (select distinct cue.at_ms from youtube_preproduced_cues cue where cue.script_id=script.id and cue.at_ms>0) point
          where not exists(
            select 1 from youtube_preproduced_cues translation
            where translation.script_id=script.id
              and translation.at_ms=point.at_ms
              and translation.presenter_id='translator'
              and translation.kind='translation'
          )
        )
      )
  )
$$;

update youtube_preproduced_scripts
set status='partial',
    error='Neuproduktion erforderlich: Einordnung muss alle 20–40 Sekunden erfolgen und hörbare Moderatorendiskussionen enthalten.',
    updated_at=now()
where status in ('ready','processing')
  and generator_version<>'codex-cli-complete-show-discussion-20-40-v2';

update broadcast_items item
set rules=item.rules || jsonb_build_object(
      'analysisStatus','dense-preproduction-required',
      'translationYoutubeVolume',0.08,
      'pauseDuringAva',true,
      'sourceLanguage',coalesce(video.source_language,'de'),
      'translationRequired',coalesce(video.source_language,'de') !~* '^de([_-]|$)'
    )
from youtube_videos video
where item.rules->>'kind'='youtube-context'
  and video.id::text=item.rules->>'youtubeLibraryId'
  and item.status in ('planned','preparing','playing');

update ai_roundtable_settings
set production_settings=production_settings || jsonb_build_object(
      'translationYoutubeVolume',0.08,
      'translatorPictureInPicture',true
    ),
    video_context=video_context || coalesce((
      select jsonb_build_object(
        'sourceLanguage',coalesce(video.source_language,'de'),
        'translationRequired',coalesce(video.source_language,'de') !~* '^de([_-]|$)'
      )
      from youtube_videos video
      where video.id::text=ai_roundtable_settings.video_context->>'youtubeLibraryId'
    ),'{}'::jsonb),
    updated_at=now()
where id=true;
